import {requireThat,roomSpectators} from './room-core.js';
import {logParts,readLog,putRecords} from './private-logs.js';

const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const enc=new TextEncoder();
const hex=data=>Array.from(new Uint8Array(data),b=>b.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/../g)||[],b=>parseInt(b,16));
export const accountPrincipal=id=>'account:'+id;
export function randomCode(length){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let code;
  do{code=Array.from(crypto.getRandomValues(new Uint8Array(length)),b=>alphabet[b%32]).join('');}while(!/[A-Z]/.test(code)||!/[0-9]/.test(code));
  return code;
}
export function accountName(raw){
  requireThat(typeof raw==='string','请输入账号名');const name=raw.normalize('NFKC').trim();
  requireThat(name.length>=2&&name.length<=16&&!/[\p{Cc}\p{Cf}]/u.test(name),'账号名需为 2–16 个字符');return name;
}
async function sessionKey(token){return 'session:'+hex(await crypto.subtle.digest('SHA-256',enc.encode(token)));}
async function passwordHash(password,salt,pepper){
  requireThat(typeof password==='string'&&password.length>=8&&password.length<=128,'密码需为 8–128 个字符');
  const pepperKey=await crypto.subtle.importKey('raw',enc.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const protectedPassword=await crypto.subtle.sign('HMAC',pepperKey,enc.encode(password));
  const key=await crypto.subtle.importKey('raw',protectedPassword,'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(salt),iterations:100000},key,256));
}
function equalHash(a,b){let mismatch=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return mismatch===0;}
const profile=a=>({id:a.id,name:a.name,createdAt:a.createdAt});
const relationKey=(a,b)=>'relation:'+([a,b].sort().join(':'));
const memberIds=room=>[...room.members.filter(p=>!p.bot&&!p.exited).map(p=>({id:p.accountId,role:'player'})),...roomSpectators(room).map(p=>({id:p.accountId,role:'spectator'}))].filter(p=>p.id);

// A SQLite-backed Durable Object is the account database. All relationship and
// account-name changes are serialized here; no password data leaves this object.
export class AccountHub {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async limit(key,max,windowMs){
    const now=Date.now(),k='rate:'+key,old=await this.ctx.storage.get(k),r=old&&old.until>now?old:{until:now+windowMs,count:0};
    r.count++;await this.ctx.storage.put(k,r);requireThat(r.count<=max,'尝试过于频繁，请稍后再试',429);
  }
  async authenticate(token,{touch=false}={}){
    const key=await sessionKey(token||''),s=await this.ctx.storage.get(key);
    if(!s||s.expiresAt<Date.now())return null;
    const a=await this.ctx.storage.get('account:'+s.accountId);if(!a)return null;
    if(touch){s.lastSeen=Date.now();await this.ctx.storage.put(key,s);}
    return {account:a,key,session:s};
  }
  async status(a){
    const sessions=await this.ctx.storage.get(a.sessions||[]);
    const online=[...sessions.values()].some(s=>s.expiresAt>Date.now()&&s.lastSeen>Date.now()-75000);
    if(!online)return 'offline';
    const r=await this.ctx.storage.get('presence:'+a.id);
    return r?.status==='playing'?(r.role==='spectator'?'spectating':'playing'):r?.room?'in_room':'online';
  }
  async fetch(request){
    return this.ctx.blockConcurrencyWhile(async()=>{
      try{return await this.handle(request);}catch(e){return json({error:e.message||'账号服务暂时不可用'},e.status||400);}
    });
  }
  async handle(request){
    const path=new URL(request.url).pathname,body=request.method==='POST'?await request.json():{},store=this.ctx.storage;
    if(path==='/internal/replay-save'){
      requireThat(request.method==='POST'&&body.replay?.format==='dark-forest-replay'&&body.replay.version===1,'回放数据格式无效');
      const replay=body.replay,matchId=String(replay.matchId||'');requireThat(/^[a-f0-9-]{36}$/.test(matchId),'回放对局编号无效');
      const recipients=[...new Set((body.accountIds||[]).filter(id=>/^[A-Z0-9]{8}$/.test(id)))];
      let saved=0;
      for(const id of recipients){
        const account=await store.get('account:'+id);if(!account)continue;
        const indexPrefix=`replay-index:${id}:`,dataKey=`replay-data:${id}:${matchId}`,indexKey=indexPrefix+matchId,old=await store.get(indexKey);
        if(old){for(let n=0;n<old.parts;n++)await store.delete(`${old.dataKey}:part:${n}`);await store.delete(old.dataKey);}
        const chunks=logParts(dataKey,replay),metadata={matchId,dataKey,parts:chunks[dataKey].parts,name:String(replay.name||'黑暗森林对局').slice(0,80),players:(replay.players||[]).map(p=>({name:String(p.name||'文明').slice(0,24),bot:Boolean(p.bot)})),winner:replay.winner??null,rounds:Math.max(1,Number(replay.rounds)||1),startedAt:Number(replay.startedAt)||Date.now(),finishedAt:Number(replay.finishedAt)||Date.now(),frameCount:Array.isArray(replay.frames)?replay.frames.length:0,eventCount:Array.isArray(replay.events)?replay.events.length:0};
        await putRecords(store,{...chunks,[indexKey]:metadata});
        saved++;
        const entries=[...(await store.list({prefix:indexPrefix})).entries()].filter(([key])=>!key.includes(':part:')).sort((a,b)=>b[1].finishedAt-a[1].finishedAt);
        for(const [key,stale] of entries.slice(5)){for(let n=0;n<stale.parts;n++)await store.delete(`${stale.dataKey}:part:${n}`);await store.delete(stale.dataKey);await store.delete(key);}
      }
      return json({ok:true,saved,recipients:recipients.length});
    }
    if(path==='/internal/resolve'){
      const auth=await this.authenticate(body.token,{touch:Boolean(body.touch)});
      return json({account:auth?profile(auth.account):null});
    }
    if(path==='/internal/room-access'){
      await this.limit('room-access:'+body.id,40,60000);
      const p=await store.get('presence:'+body.id);
      requireThat(!p?.room||p.room===body.room,'你已在另一个房间，请先返回并退出',409);return json({ok:true});
    }
    if(path==='/internal/presence'){
      const room=body.room,previous=await store.get('room-presence:'+room.id);
      if(previous&&previous.revision>=room.revision)return json({ok:true});
      const people=room.status==='closed'?[]:memberIds(room),ids=new Set(people.map(p=>p.id));
      for(const id of previous?.ids||[])if(!ids.has(id)){
        const p=await store.get('presence:'+id);if(p?.room===room.id)await store.delete('presence:'+id);
      }
      for(const p of people)await store.put('presence:'+p.id,{room:room.id,status:room.status,role:p.role,at:Date.now()});
      await store.put('room-presence:'+room.id,{revision:room.revision,ids:[...ids]});return json({ok:true});
    }
    if(path==='/auth/register'||path==='/auth/login'){
      requireThat(this.env.AUTH_PEPPER,'账号服务尚未配置',503);
      const name=accountName(body.name),normalized=name.toLocaleLowerCase('en-US');
      const ip=request.headers.get('x-client-ip')||'local';
      await this.limit('auth-ip:'+ip,30,900000);await this.limit('auth-name:'+normalized,12,900000);
      let id=await store.get('name:'+normalized),a=id?await store.get('account:'+id):null;
      if(path==='/auth/register'){
        requireThat(!a,'这个账号名已被使用',409);
        do{id=randomCode(8);}while(await store.get('account:'+id));
        const salt=hex(crypto.getRandomValues(new Uint8Array(16)));
        const hash=await passwordHash(body.password,salt,this.env.AUTH_PEPPER);
        a={id,name,normalized,salt,hash,hashVersion:'pbkdf2-sha256-100k-hmac-pepper-v1',createdAt:Date.now(),relations:[],sessions:[]};
        await store.put('name:'+normalized,id);
      }else{
        // Derive even for an absent name so account existence is not a shortcut.
        const valid=await passwordHash(body.password,a?.salt||'00000000000000000000000000000000',this.env.AUTH_PEPPER);
        requireThat(a&&equalHash(valid,a.hash),'账号名或密码不正确',401);
      }
      const token=crypto.randomUUID(),key=await sessionKey(token),now=Date.now();
      a.sessions||=[];
      const old=await store.get(a.sessions);a.sessions=a.sessions.filter(k=>old.get(k)?.expiresAt>now);
      while(a.sessions.length>=12)await store.delete(a.sessions.shift());
      a.sessions.push(key);
      await store.put({[key]:{accountId:a.id,createdAt:now,lastSeen:now,expiresAt:now+2592000000},['account:'+a.id]:a});
      return json({account:profile(a),token},path.endsWith('register')?201:200);
    }
    const auth=await this.authenticate(request.headers.get('x-auth-token'),{touch:true});requireThat(auth,'请先登录账号',401);
    const a=auth.account;
    if(path==='/auth/logout'){await store.delete(auth.key);return json({ok:true});}
    if(path==='/replays/list'){
      const prefix=`replay-index:${a.id}:`,items=[...(await store.list({prefix})).entries()].filter(([key])=>!key.includes(':part:')).map(([,value])=>value).sort((x,y)=>y.finishedAt-x.finishedAt).slice(0,5);
      return json({replays:items.map(({dataKey,parts,...item})=>item)});
    }
    if(path==='/replays/get'){
      const matchId=String(body.matchId||'');requireThat(/^[a-f0-9-]{36}$/.test(matchId),'回放编号无效');
      const metadata=await store.get(`replay-index:${a.id}:${matchId}`);requireThat(metadata,'没有找到这局回放',404);
      return json({replay:await readLog(store,metadata.dataKey,metadata)});
    }
    if(path==='/social/state'){
      const friends=[],requests=[];
      for(const id of a.relations||[]){
        const r=await store.get(relationKey(a.id,id)),other=await store.get('account:'+id);if(!r||!other)continue;
        if(r.status==='accepted')friends.push({...profile(other),status:await this.status(other)});
        else if(r.status==='pending')requests.push({...profile(other),incoming:r.from!==a.id});
      }
      const invites=[...(await store.list({prefix:'invite:'+a.id+':'})).values()].filter(i=>i.status==='pending'&&i.expiresAt>Date.now());
      const presence=await store.get('presence:'+a.id);
      const cooldownPrefix='invite-cooldown:'+a.id+':',inviteCooldowns={};
      for(const [key,at] of await store.list({prefix:cooldownPrefix})){if(at+10000>Date.now())inviteCooldowns[key.slice(cooldownPrefix.length)]=at+10000;else await store.delete(key);}
      return json({account:profile(a),friends,requests,invites,inviteCooldowns,currentRoom:presence?.room||null});
    }
    if(path==='/social/profile'){
      await this.limit('profile:'+a.id,80,60000);
      const id=String(body.id||'').toUpperCase(),other=await store.get('account:'+id);requireThat(other,'没有找到这个账号',404);
      const r=await store.get(relationKey(a.id,id));
      return json({account:profile(other),status:id===a.id||r?.status==='accepted'?await this.status(other):null,
        relationship:id===a.id?'self':r?.status==='accepted'?'friend':r?.status==='pending'?(r.from===a.id?'sent':'received'):'none'});
    }
    if(path==='/social/watch-friend'){
      await this.limit('social-watch:'+a.id,30,60000);
      const id=String(body.id||'').toUpperCase(),relation=await store.get(relationKey(a.id,id));
      requireThat(id!==a.id&&relation?.status==='accepted','只能观战好友的对局',403);
      const friend=await store.get('account:'+id),presence=await store.get('presence:'+id);
      requireThat(friend&&['playing','spectating'].includes(await this.status(friend))&&presence?.status==='playing'&&presence.room,'好友当前没有可观战的对局',409);
      return json({room:presence.room,friendId:id});
    }
    if(path==='/social/request'){
      await this.limit('social:'+a.id,40,60000);
      const id=String(body.id||'').toUpperCase();requireThat(id!==a.id,'不能添加自己');
      const other=await store.get('account:'+id);requireThat(other,'没有找到这个账号',404);
      const key=relationKey(a.id,id),r=await store.get(key);
      requireThat(r?.status!=='accepted','你们已经是好友');
      if(r?.status==='pending')return json({ok:true,pending:true});
      requireThat((a.relations||[]).length<500&&(other.relations||[]).length<500,'好友和申请数量已达上限');
      a.relations=[...new Set([...(a.relations||[]),id])];other.relations=[...new Set([...(other.relations||[]),a.id])];
      await store.put({[key]:{status:'pending',from:a.id,to:id,at:Date.now()},['account:'+a.id]:a,['account:'+id]:other});return json({ok:true});
    }
    if(path==='/social/respond'){
      const id=String(body.id||'').toUpperCase(),key=relationKey(a.id,id),r=await store.get(key);
      requireThat(r?.status==='pending'&&r.to===a.id,'好友申请不存在或已处理',409);
      if(body.accept===true){r.status='accepted';r.acceptedAt=Date.now();await store.put(key,r);}
      else await store.delete(key);
      return json({ok:true});
    }
    if(path==='/social/remove'){
      const id=String(body.id||'').toUpperCase(),key=relationKey(a.id,id),r=await store.get(key);
      requireThat(r?.status==='accepted','你们还不是好友',409);
      const other=await store.get('account:'+id);if(other){other.relations=(other.relations||[]).filter(friend=>friend!==a.id);await store.put('account:'+id,other);}
      a.relations=(a.relations||[]).filter(friend=>friend!==id);await store.put('account:'+a.id,a);await store.delete(key);return json({ok:true});
    }
    if(path==='/social/invite'){
      await this.limit('invite:'+a.id,15,60000);
      const id=String(body.id||'').toUpperCase(),r=await store.get(relationKey(a.id,id));requireThat(r?.status==='accepted','只能邀请好友',403);
      const other=await store.get('account:'+id);requireThat(other&&await this.status(other)==='online','只能邀请在线好友',403);
      const cooldownKey='invite-cooldown:'+a.id+':'+id,now=Date.now(),last=await store.get(cooldownKey);
      requireThat(!last||now-last>=10000,'邀请过于频繁，请稍后再试',429);
      const pending=[...(await store.list({prefix:'invite:'+id+':'})).entries()];
      for(const [key,i] of pending)if(i.expiresAt<Date.now()||i.status!=='pending')await store.delete(key);
      requireThat(pending.filter(([,i])=>i.expiresAt>Date.now()&&i.status==='pending').length<30,'对方待处理邀请过多');
      const duplicate=pending.find(([,i])=>i.from===a.id&&i.room===body.room&&i.status==='pending'&&i.expiresAt>Date.now());
      if(duplicate){await store.put(cooldownKey,now);return json({ok:true});}
      const invite={id:crypto.randomUUID(),from:a.id,fromName:a.name,room:body.room,roomName:body.roomName,status:'pending',createdAt:Date.now(),expiresAt:Date.now()+600000};
      await store.put({['invite:'+id+':'+invite.id]:invite,[cooldownKey]:now});return json({ok:true});
    }
    if(path==='/social/invitation'){
      const key='invite:'+a.id+':'+String(body.id||''),i=await store.get(key);
      requireThat(i?.status==='pending'&&i.expiresAt>Date.now(),'邀请不存在或已过期',409);
      if(body.accept===false){await store.delete(key);return json({ok:true});}
      // Preview only. Consume after the room has actually accepted the join.
      if(body.consume){i.status='accepted';await store.put(key,i);}
      return json({invite:i});
    }
    throw Object.assign(new Error('接口不存在'),{status:404});
  }
}
