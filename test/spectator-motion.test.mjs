import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../dist/game.js';
import {newRoom,applyGameAction,roomView,mutateRoom} from '../server/room-core.js';
import {GameRoom} from '../server/worker.js';
import {OrderedStatePlayback} from '../dist/spectator-motion.js';
import {nextAIActionAt} from '../server/ai-timing.js';

function fixture(){
  const room=newRoom('12345678','a','动画测试','甲');room.members.push({id:'b',name:'乙'},{id:'c',name:'丙'});
  room.spectator={id:'watch',name:'观众'};room.game=new Game({count:3,demo:true});room.status='playing';
  for(const p of room.game.players){room.game.discard.push(...p.hand.splice(0),...p.builds.splice(0));p.energy=12;}
  return room;
}
test('广播回应与同一请求内自动结算按服务器顺序保留，仅观战出口获得动画数据',()=>{
  const room=fixture(),g=room.game,caster=g.take('stellar_c'),response=g.take('hyper_c');
  g.players[0].hand.push(caster);g.players[1].hand.push(response);
  applyGameAction(room,0,{type:'play',cardId:caster.id,target:5});
  applyGameAction(room,1,{type:'respond',cardId:response.id});
  assert.equal(g.pending,null);
  const observer=roomView(room,'watch').game,batch=observer.motionBatches.at(-1);
  assert.deepEqual(batch.events.map(e=>e.type),['response','broadcast_resolved']);
  assert.equal(batch.events[0].target,5);
  assert.equal(batch.events[1].cards[0].id,caster.id);assert.equal(batch.events[1].cards[1].id,response.id);
  assert.deepEqual(observer.motionBatches.map(b=>b.sequence),[1,2]);
  assert.deepEqual(batch.energyChanges.map(c=>[c.player,c.after-c.before]),[[0,3],[1,1]]);
  const player=roomView(room,'a').game;assert.equal(player.motionBatches,undefined);assert.equal(player.players[1].hand,undefined);
});
test('打击先抵达，再弃建设和防御结算，动画不会修改牌局守恒',()=>{
  const room=fixture(),g=room.game;
  g.players[1].builds.push(g.take('solar'),g.take('bunker'));
  const card=g.take('photon');g.strikes.push({id:card.id,card,owner:0,target:1,progress:0,required:1});g.active=2;
  applyGameAction(room,2,{type:'end'});
  const types=room.motionBatches.at(-1).events.map(e=>e.type);
  assert.ok(types.indexOf('strike_arriving')<types.indexOf('star_discard'));
  assert.ok(types.indexOf('star_discard')<types.indexOf('defended'));
  assert.ok(types.indexOf('defended')<types.indexOf('strike_resolved'));
  assert.equal(g.players[1].alive,true);assert.equal(g.markers[1],'red');assert.equal(g.allPhysicalCards().length,64);
});
test('科技锁死动画包含被拆建设及准确能量差，未改变退款逻辑',()=>{
  const room=fixture(),g=room.game,lock=g.take('lock');g.players[0].hand.push(lock);g.players[1].builds.push(g.take('solar'),g.take('fusion'));
  applyGameAction(room,0,{type:'play',cardId:lock.id,target:1});
  const batch=room.motionBatches.at(-1);assert.equal(batch.events.find(e=>e.type==='lock').removedCards.length,2);
  assert.deepEqual(batch.energyChanges.map(c=>[c.player,c.after-c.before]),[[0,-4],[1,2]]);
  assert.equal(g.players[1].builds.length,0);assert.equal(g.allPhysicalCards().length,64);
});
const view=(revision,sequence)=>({id:'12345678',revision,game:{active:0,motionBatches:[{sequence,events:[]}]}});
test('连续状态按序播放，不覆盖或重复中间动作',async()=>{
  const played=[],rendered=[];let release,done;
  const gate=new Promise(r=>release=r),finished=new Promise(r=>done=r);
  const playback=new OrderedStatePlayback({render:v=>{rendered.push(v.revision);if(v.revision===4)done();},play:async(before,after,signal,sequence)=>{played.push([before.revision,after.revision,sequence]);if(after.revision===2)await gate;}});
  playback.reset(view(1,1));playback.enqueue(view(2,2));playback.enqueue(view(3,3));playback.enqueue(view(4,4));playback.enqueue(view(3,3));playback.enqueue(view(4,4));
  assert.deepEqual(rendered,[1]);release();await finished;
  assert.deepEqual(rendered,[1,2,3,4]);assert.deepEqual(played,[[1,2,1],[2,3,2],[3,4,3]]);
});
test('退出或切换观战时取消旧动画，不覆盖新的画面',async()=>{
  const rendered=[];let release;
  const gate=new Promise(r=>release=r);let signal;
  const playback=new OrderedStatePlayback({render:v=>rendered.push(v.revision),play:async(a,b,s)=>{signal=s;await gate;}});
  playback.reset(view(1,1));playback.enqueue(view(2,2));playback.reset(view(10,10));
  assert.equal(signal.aborted,true);release();await new Promise(setImmediate);assert.deepEqual(rendered,[1,10]);
});
test('仅修订号改变时不重绘观战牌桌',async()=>{
  const rendered=[];let played=0;const playback=new OrderedStatePlayback({render:v=>rendered.push(v.revision),play:async()=>played++});
  playback.reset(view(1,1));playback.enqueue(view(2,1));await new Promise(setImmediate);
  assert.deepEqual(rendered,[1]);assert.equal(played,0);assert.equal(playback.current.revision,2);
});
test('本地 AI 每次行动等待 5 秒，观战加入等元数据不重启计时，DeepSeek 不额外等待',()=>{
  const room=fixture(),bot={me:0,level:'hard'};
  assert.equal(nextAIActionAt(room,bot,1000),6000);
  room.revision++;assert.equal(nextAIActionAt(room,bot,2000),6000);
  room.motionSequence=1;assert.equal(nextAIActionAt(room,bot,7000),12000);
  const saved=JSON.parse(JSON.stringify({...room,game:{turnIndex:room.game.turnIndex,pending:room.game.pending}}));assert.equal(nextAIActionAt(saved,bot,8000),12000);
  assert.equal(nextAIActionAt(room,null,8000),Infinity);
  assert.equal(nextAIActionAt(room,{me:0,level:'deepseek'},9000),9000);
});
test('AI 对局结束后最后观众退出，房间也会关闭',()=>{
  const room=fixture();room.status='finished';room.members.forEach(p=>p.bot='easy');
  mutateRoom(room,'watch','watch');assert.equal(room.status,'closed');assert.equal(room.spectator,null);
});
test('已关闭房间不会因遗留广播结算闹钟重新运行',async()=>{
  let deleted=0;const jobs=[];
  const ctx={storage:{get:async()=>null,deleteAlarm:async()=>deleted++},blockConcurrencyWhile:fn=>{const p=fn();jobs.push(p);return p;}};
  const worker=new GameRoom(ctx,{});await jobs[0];worker.room={status:'closed',game:{pending:{autoSettleAt:1}}};
  await worker.alarm();assert.equal(deleted,1);assert.equal(worker.room.status,'closed');
});
