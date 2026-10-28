import test from 'node:test';
import assert from 'node:assert/strict';
import {AccountHub,randomCode} from '../server/accounts.js';
import worker,{GameRoom} from '../server/worker.js';
import {newRoom} from '../server/room-core.js';
import {logParts,readLog} from '../server/private-logs.js';
import {Game} from '../dist/game.js';
import {decideDeepSeek} from '../server/deepseek.js';
class Storage {
  map=new Map();
  async get(key){return Array.isArray(key)?new Map(key.filter(k=>this.map.has(k)).map(k=>[k,structuredClone(this.map.get(k))])):structuredClone(this.map.get(key));}
  async put(key,value){for(const [k,v] of typeof key==='object'?Object.entries(key):[[key,value]])this.map.set(k,structuredClone(v));}
  async delete(key){this.map.delete(key);}
  async list({prefix='',startAfter='',limit=10000}={}){return new Map([...this.map].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit));}
}
function fixture(){
  const storage=new Storage(),ctx={storage,blockConcurrencyWhile:fn=>fn()},hub=new AccountHub(ctx,{AUTH_PEPPER:'test-only-not-a-real-secret'});
  let seq=0;
  const call=async(path,body={},token='')=>{const r=await hub.fetch(new Request('https://internal'+path,{method:'POST',headers:{'x-auth-token':token,'x-client-ip':'test-'+seq++},body:JSON.stringify(body)}));return {status:r.status,...await r.json()};};
  const register=(name)=>call('/auth/register',{name,password:'test-password-123'});return {storage,call,register,hub};
}
test('账号与房间码固定长度且同时包含字母和数字',()=>{
  const ids=new Set();for(let i=0;i<2000;i++){const code=randomCode(i%2?6:8);assert.match(code,/^[A-Z0-9]+$/);assert.match(code,/[A-Z]/);assert.match(code,/\d/);assert.equal(code.length,i%2?6:8);ids.add(code);}assert.equal(ids.size,2000);
});
test('密码加盐保存，账号名唯一，跨会话登录回到相同 ID',async()=>{
  const f=fixture(),a=await f.register('罗辑账号');assert.equal(a.status,201);assert.equal(a.account.id.length,8);
  const stored=await f.storage.get('account:'+a.account.id);assert.equal(stored.password,undefined);assert.equal(stored.hash.length,64);assert.notEqual(stored.hash,'test-password-123');
  assert.equal((await f.register('罗辑账号')).status,409);
  const bad=await f.call('/auth/login',{name:'罗辑账号',password:'wrong-password'});assert.equal(bad.status,401);
  const login=await f.call('/auth/login',{name:'罗辑账号',password:'test-password-123'});assert.equal(login.account.id,a.account.id);assert.notEqual(login.token,a.token);
  const resolved=await f.call('/internal/resolve',{token:login.token});assert.deepEqual(resolved.account,a.account);assert.equal(JSON.stringify(resolved).includes(stored.hash),false);
  await f.call('/auth/logout',{},login.token);assert.equal((await f.call('/internal/resolve',{token:login.token})).account,null);
  assert.ok((await f.call('/internal/resolve',{token:a.token})).account);
});
test('名称规范化避免重复，拒绝短密码与未登录读取',async()=>{
  const f=fixture();await f.register('Alice');assert.equal((await f.register('ＡＬＩＣＥ')).status,409);
  assert.equal((await f.call('/auth/register',{name:'新账号',password:'123'})).status,400);
  assert.equal((await f.call('/social/state')).status,401);
});
test('好友需本人同意，旁人不能接受申请，拒绝与重复申请可处理',async()=>{
  const f=fixture(),a=await f.register('好友甲'),b=await f.register('好友乙'),c=await f.register('旁观者');
  assert.equal((await f.call('/social/request',{id:b.account.id},a.token)).status,200);
  assert.equal((await f.call('/social/state',{},a.token)).friends.length,0);
  assert.equal((await f.call('/social/respond',{id:a.account.id,accept:true},c.token)).status,409);
  assert.equal((await f.call('/social/respond',{id:a.account.id,accept:true},b.token)).status,200);
  assert.equal((await f.call('/social/state',{},a.token)).friends[0].id,b.account.id);
  assert.equal((await f.call('/social/state',{},b.token)).friends[0].id,a.account.id);
  assert.equal((await f.call('/social/request',{id:a.account.id},a.token)).status,400);
});
test('状态区分在线离线对局观战，普通搜索不泄漏非好友状态',async()=>{
  const f=fixture(),a=await f.register('状态甲'),b=await f.register('状态乙');
  assert.equal((await f.call('/social/profile',{id:b.account.id},a.token)).status,null);
  assert.equal((await f.call('/social/profile',{id:b.account.id},a.token)).relationship,'none');
  await f.call('/social/request',{id:b.account.id},a.token);await f.call('/social/respond',{id:a.account.id,accept:true},b.token);
  const state=()=>f.call('/social/state',{},a.token);
  assert.equal((await state()).friends[0].status,'online');
  await f.call('/internal/presence',{room:{id:'A2C4E6',revision:1,status:'playing',members:[{accountId:b.account.id}],spectator:null}});
  assert.equal((await state()).friends[0].status,'playing');
  await f.call('/internal/presence',{room:{id:'A2C4E6',revision:2,status:'playing',members:[],spectator:{accountId:b.account.id}}});
  assert.equal((await state()).friends[0].status,'spectating');
  await f.call('/internal/presence',{room:{id:'A2C4E6',revision:1,status:'playing',members:[{accountId:b.account.id}],spectator:null}});
  assert.equal((await state()).friends[0].status,'spectating');
  await f.call('/auth/logout',{},b.token);assert.equal((await state()).friends[0].status,'offline');
});
test('邀请只允许好友且不能冒领；预览不消费，成功加入后才消费',async()=>{
  const f=fixture(),a=await f.register('邀请甲'),b=await f.register('邀请乙');
  assert.equal((await f.call('/social/invite',{id:b.account.id,room:'A2C4E6'},a.token)).status,403);
  await f.call('/social/request',{id:b.account.id},a.token);await f.call('/social/respond',{id:a.account.id,accept:true},b.token);
  await f.call('/social/invite',{id:b.account.id,room:'A2C4E6',roomName:'好友房'},a.token);
  const i=(await f.call('/social/state',{},b.token)).invites[0];assert.equal(i.fromName,a.account.name);
  assert.equal((await f.call('/social/invitation',{id:i.id,accept:true},a.token)).status,409);
  assert.equal((await f.call('/social/invitation',{id:i.id,accept:true},b.token)).invite.room,'A2C4E6');
  assert.equal((await f.call('/social/state',{},b.token)).invites.length,1);
  await f.call('/social/invitation',{id:i.id,consume:true},b.token);assert.equal((await f.call('/social/state',{},b.token)).invites.length,0);
});
test('登录尝试有限流，退出的会话不可继续访问好友接口',async()=>{
  const f=fixture(),a=await f.register('限流账号');
  for(let i=0;i<11;i++)assert.equal((await f.call('/auth/login',{name:'限流账号',password:'bad-password'})).status,401);
  assert.equal((await f.call('/auth/login',{name:'限流账号',password:'test-password-123'})).status,429);
  await f.call('/auth/logout',{},a.token);assert.equal((await f.call('/social/state',{},a.token)).status,401);
});
test('日志分片完整保留中文大提示词，后台接口拒绝普通用户和跨域',async()=>{
  const store=new Storage(),data={kind:'deepseek',matchId:crypto.randomUUID(),request:{messages:[{role:'system',content:'三体规则🚀'.repeat(20000)}]},response:{choices:[{message:{content:'{"choice":2}',reasoning_content:'模型思考'}}]}};
  const parts=logParts('audit:test',data);assert.ok(Object.keys(parts).length>3);await store.put(parts);assert.deepEqual(await readLog(store,'audit:test',parts['audit:test']),data);
  for(const value of Object.values(parts))assert.ok(new TextEncoder().encode(JSON.stringify(value)).byteLength<128000);
  assert.equal((await worker.fetch(new Request('https://game.test/api/admin/logs'),{ADMIN_LOG_TOKEN:'secret'})).status,403);
  assert.equal((await worker.fetch(new Request('https://game.test/api/auth/login',{method:'POST',headers:{Origin:'https://attacker.test'},body:'{}'}),{})).status,403);
});
test('DeepSeek 私有日志包含实际请求、原始输出、思考和用量，不包含 API Key',async()=>{
  const game=new Game({count:3}),entries=[];let sent;
  const action=await decideDeepSeek(game,0,[],'private-secret',async(url,options)=>{sent=JSON.parse(options.body);return Response.json({choices:[{message:{content:'{"choice":0}',reasoning_content:'思考过程'},finish_reason:'stop'}],usage:{total_tokens:42}});},null,null,entry=>entries.push(entry));
  assert.ok(action);assert.equal(entries[0].stage,'request');assert.deepEqual(entries[0].request,sent);assert.equal(entries[1].response.choices[0].message.reasoning_content,'思考过程');assert.equal(entries[1].response.usage.total_tokens,42);assert.equal(JSON.stringify(entries).includes('private-secret'),false);
});
test('DeepSeek HTTP 失败也保存错误响应',async()=>{
  const entries=[],action=await decideDeepSeek(new Game({count:3}),0,[],'key',async()=>new Response('quota exceeded',{status:429}),null,null,e=>entries.push(e));
  assert.equal(action,null);assert.equal(entries[1].status,429);assert.equal(entries[1].response,'quota exceeded');
});
test('大对话分片保存房间，休眠恢复完整且清理旧状态分片',async()=>{
  const storage=new Storage(),jobs=[],ctx={storage,blockConcurrencyWhile:fn=>{const p=fn();jobs.push(p);return p;}};
  const room=new GameRoom(ctx,{});await jobs.at(-1);room.room=newRoom('A2C4E6','host','测试','房主');room.room.deepseekSessions={bot:{messages:[{role:'system',content:'大提示词🚀'.repeat(40000)}]}};
  await room.persistRoom();const first=await storage.get('room');assert.ok(first.chunked);assert.ok(first.parts>10);
  const restored=new GameRoom(ctx,{});await jobs.at(-1);assert.deepEqual(restored.room.deepseekSessions,room.room.deepseekSessions);
  restored.room.revision++;await restored.persistRoom();assert.equal(await storage.get(first.key),undefined);assert.ok((await storage.get('room')).chunked);
});
test('旧匿名座位只允许原 cookie 继承，不能冒领已绑定账号的座位',async()=>{
  const jobs=[],ctx={storage:new Storage(),blockConcurrencyWhile:fn=>{const p=fn();jobs.push(p);return p;}};
  const r=new GameRoom(ctx,{});await jobs.at(-1);r.room=newRoom('12345678','original-cookie','旧房间','旧名称');r.commit=async()=>{};
  const claim=(session,id='A2C4E6G8')=>r.fetch(new Request('https://internal/internal/claim-legacy',{method:'POST',body:JSON.stringify({session,account:{id,name:'账号名称'}})}));
  assert.equal((await claim('someone-else')).status,403);
  assert.equal((await claim('original-cookie')).status,200);assert.equal(r.room.host,'account:A2C4E6G8');assert.equal(r.room.members[0].accountId,'A2C4E6G8');
  assert.equal((await claim('original-cookie','B2D4F6H8')).status,403);assert.equal(r.room.members[0].accountId,'A2C4E6G8');
});
