import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {decideAI} from '../server/ai.js';
import {seeded} from '../dist/game.js';
const base=process.argv[2]||'http://127.0.0.1:8787';
async function client() {
  const r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'联机验证'+crypto.randomUUID().slice(0,7),password:crypto.randomUUID()})});assert.equal(r.status,201);
  const cookie=r.headers.get('set-cookie').split(';')[0];
  return {cookie,async request(path,body){
    const response=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(response.status===429){await new Promise(resolve=>setTimeout(resolve,5000));return this.request(path,body);}
    return {status:response.status,data:await response.json()};
  }};
}
const clients=await Promise.all(Array.from({length:7},client));
const [host,guest]=clients;
let result=await host.request('/rooms',{name:'联机验证（自动测试）',username:'验证房主'});
assert.equal(result.status,201);let room=result.data;const prefix='/rooms/'+room.id;
const listed=await host.request('/rooms');assert.equal(listed.status,405);assert.match(room.id,/^[A-Z0-9]{6}$/);
const commands=(who,op,body={})=>who.request(prefix+'/'+op,{...body,requestId:crypto.randomUUID()});
assert.equal((await clients[6].request(prefix)).status,403);
result=await commands(guest,'join',{username:'访客1'});assert.equal(result.status,200);
assert.equal((await commands(guest,'bot',{level:'hard'})).status,403);
assert.equal((await commands(host,'start')).status,400);
for(const level of ['easy','normal','hard']){
  result=await commands(host,'bot',{level});assert.equal(result.status,200);assert.equal(result.data.members.at(-1).bot,level);
}
for(let index=4;index>=2;index--)assert.equal((await commands(host,'remove',{index})).status,200);
for(let i=2;i<6;i++)assert.equal((await commands(clients[i],'join',{username:'访客'+i})).status,200);
assert.equal((await commands(clients[6],'join',{username:'第七位'})).status,400);
assert.equal((await commands(host,'bot',{level:'easy'})).status,400);
const socket=new WebSocket(base.replace(/^http/,'ws')+'/api'+prefix+'/ws',{headers:{Cookie:guest.cookie}});
let lastPush=null;
socket.on('message',bytes=>{const event=JSON.parse(bytes.toString());if(event.type==='state')lastPush=event.room;});
await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
result=await commands(host,'start');assert.equal(result.status,200);room=result.data;
await new Promise(resolve=>setTimeout(resolve,50));
assert.ok(lastPush?.game);assert.equal(lastPush.me,1);assert.equal(lastPush.game.players[0].hand,undefined);assert.equal(lastPush.game.players[0].galaxy,undefined);
assert.equal((await commands(guest,'action',{revision:room.revision,action:{type:'end'}})).status,403);
const requestId=crypto.randomUUID(),payload={requestId,revision:room.revision,action:{type:'end'}};
result=await host.request(prefix+'/action',payload);assert.equal(result.status,200);room=result.data;
const duplicate=await host.request(prefix+'/action',payload);assert.equal(duplicate.status,200);assert.equal(duplicate.data.revision,room.revision);assert.equal(duplicate.data.game.active,room.game.active);
assert.equal((await commands(host,'action',{revision:room.revision-1,action:{type:'end'}})).status,409);
const rng=seeded(44);let moves=0;
while(!room.game.over&&moves++<1500){
  let acted=false;
  for(let me=0;me<6;me++){
    const own=await clients[me].request(prefix);assert.equal(own.status,200);
    const action=decideAI(own.data.game,me,['easy','normal','hard'][me%3],[],rng);if(!action)continue;
    const reply=await commands(clients[me],'action',{revision:own.data.revision,action:{...action,phase:own.data.game.pending?.id}});
    assert.equal(reply.status,200,JSON.stringify(reply.data));room=reply.data;acted=true;break;
  }
  assert.ok(acted,'online game must progress');
}
assert.ok(room.game.over,'online game should finish');
assert.equal((await commands(host,'rematch')).status,200);
for(let me=5;me>=0;me--)assert.equal((await commands(clients[me],'leave')).status,200);
socket.close();
console.log(JSON.stringify({ok:true,base,players:6,actions:moves,checks:['room list','join','host permission','three AI levels','capacity','personalized WebSocket','turn authority','idempotence','stale revisions','complete game','rematch','leave']}));
