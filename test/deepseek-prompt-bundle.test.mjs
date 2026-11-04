import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../shared/game.js';
import {newRoom,appendDeepSeekUpdates} from '../server/room-core.js';
import {decideDeepSeek} from '../server/deepseek.js';

const UUID_GLOBAL=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function uuidRoom(){
  const room=newRoom('A2C4E6','host','测试','host');
  room.members=Array.from({length:3},(_,i)=>({id:'bot'+i,name:'AI'+i,bot:'deepseek'}));
  room.game=new Game({count:3,demo:false,seed:31});
  // Online rooms replace every physical card id with a UUID.
  room.game.allPhysicalCards().forEach(c=>c.id=crypto.randomUUID());
  room.status='playing';
  appendDeepSeekUpdates(room);
  return room;
}

test('提示词里的长 UUID 折叠成会话内短别名，且同一 id 始终同一别名',()=>{
  const room=uuidRoom(),session=room.deepseekSessions.bot0;
  const text=session.messages.map(m=>m.content).join('\n');
  assert.equal(text.match(UUID_GLOBAL),null,'提示词不应残留 36 字符 UUID');
  const aliases=Object.values(session.aliases);
  assert.ok(aliases.length>0);
  for(const alias of aliases)assert.match(alias,/^k\d+$/);
  const firstUuid=Object.keys(session.aliases)[0],alias=session.aliases[firstUuid];
  assert.equal(session.aliases[firstUuid],alias,'同一 UUID 的别名必须稳定');
});

test('别名只作用于提示词，动作仍能按真实 id 结算',async()=>{
  const room=uuidRoom();
  const seat=room.deepseekSessions.bot0;
  const before=room.game.allPhysicalCards().length;
  const action=await decideDeepSeek(room.game,0,room.intel,'fake',async(_url,init)=>{
    const body=JSON.parse(init.body);
    const payload=JSON.parse(body.messages.at(-1).content.split('当前局面：')[1]);
    // The model only ever sees aliases and never returns ids.
    assert.equal(body.messages.at(-1).content.match(UUID_GLOBAL),null);
    const play=payload.legalActions.find(x=>x.action.type==='play')||payload.legalActions[0];
    return Response.json({choices:[{message:{content:JSON.stringify({choice:play.choice})}}]});
  },seat,null,null,{observationWindow:3});
  assert.ok(action);
  assert.equal(room.game.allPhysicalCards().length,before,'模型回复不应改变牌堆总数');
});
