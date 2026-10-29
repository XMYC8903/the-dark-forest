import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,CARDS,seeded} from '../dist/game.js';
import {newRoom,mutateRoom,roomView,gameView,saveGame,restoreGame,applyGameAction,appendDeepSeekUpdates} from '../server/room-core.js';
import {decideAI} from '../server/ai.js';

test('房间仅房主可添加 AI、开始与移除，容量为 3–6',()=>{
  const room=newRoom('12345678','host','测试森林','房主');
  assert.throws(()=>mutateRoom(room,'host','start'),/3–6/);
  mutateRoom(room,'guest','join',{username:'朋友'});
  assert.throws(()=>mutateRoom(room,'guest','bot',{level:'hard'}),/只有房主/);
  for(const level of ['easy','normal','hard'])mutateRoom(room,'host','bot',{level});
  assert.deepEqual(room.members.filter(p=>p.bot).map(p=>p.name),['汪淼','章北海','智子']);
  mutateRoom(room,'other','join',{username:'第三位真人'});
  assert.equal(room.members.length,6);
  assert.throws(()=>mutateRoom(room,'extra','join'),/已满/);
  assert.throws(()=>mutateRoom(room,'host','bot',{level:'easy'}),/已满/);
  mutateRoom(room,'host','start');
  assert.equal(room.game.players.length,6);assert.equal(room.game.demo,false);
  assert.equal(saveGame(room.game).rngState,null);
  assert.ok(room.game.allPhysicalCards().every(c=>/^[a-f0-9-]{36}$/.test(c.id)));
  assert.throws(()=>mutateRoom(room,'host','remove',{index:1}),/开始后/);
  assert.throws(()=>roomView(room,'outsider'),/尚未加入|已退出/);
  assert.equal(roomView(room,'guest').me,1);
});
test('房主可将 DeepSeek 作为独立 AI 难度加入房间',()=>{
  const room=newRoom('87654321','host','DeepSeek 房间','房主');
  room.members.push({id:'guest-a',name:'玩家甲',bot:null},{id:'guest-b',name:'玩家乙',bot:null});
  mutateRoom(room,'host','bot',{level:'deepseek'});
  assert.equal(room.members[3].bot,'deepseek');assert.equal(room.members[3].name,'DeepSeek');
  mutateRoom(room,'host','start');assert.equal(room.game.players.length,4);assert.equal(room.game.players[3].name,'DeepSeek');
});
test('等待室可切换观战席并在退出时恢复原玩家座位',()=>{
  const room=newRoom('87654321','host','观战测试','房主');
  room.members.push({id:'guest-a',name:'朋友甲',bot:null},{id:'guest-b',name:'朋友乙',bot:null});
  const playerView=roomView(room,'guest-a');
  assert.equal(playerView.role,'player');assert.equal(playerView.members.length,3);assert.equal(playerView.spectator,undefined);
  mutateRoom(room,'guest-a','watch',{username:'朋友甲'});
  assert.equal(room.members.length,2);assert.equal(room.spectator.id,'guest-a');
  const observerView=roomView(room,'guest-a');
  assert.equal(observerView.role,'spectator');assert.equal(observerView.members.length,2);assert.equal(observerView.spectatorOccupied,true);
  mutateRoom(room,'guest-b','watch');assert.equal(room.spectators.length,2);
  mutateRoom(room,'guest-b','watch');assert.equal(roomView(room,'guest-b').role,'player');
  assert.throws(()=>mutateRoom(room,'guest-a','action',{action:{type:'end'}}),/退出这个房间|观战者/);
  mutateRoom(room,'guest-a','watch');
  assert.equal(room.members.length,3);assert.equal(room.members[1].id,'guest-a');
  assert.equal(room.spectator,null);assert.equal(roomView(room,'guest-a').role,'player');
  room.members[0].name='不应公开的观战昵称';
  mutateRoom(room,'host','watch');
  const otherPlayer=roomView(room,'guest-a');
  assert.equal(otherPlayer.hostName,'观战席房主');assert.doesNotMatch(JSON.stringify(otherPlayer),/不应公开的观战昵称/);
  mutateRoom(room,'host','watch');assert.equal(room.members.length,3);
});
test('观战视角获取全场手牌摘要、坐标与打击进度，玩家视角仍保密',()=>{
  const room=newRoom('87654321','host','明牌观战','房主');
  room.members.push({id:'guest-a',name:'玩家甲',bot:null},{id:'guest-b',name:'玩家乙',bot:null});
  mutateRoom(room,'host','start');
  const g=room.game;g.players[0].hand[0].key='photon';g.players[0].hand[0].id='known-card';
  g.strikes.push({id:'flight-1',card:{id:'strike-card',key:'photon'},owner:0,target:2,progress:2,required:4});
  mutateRoom(room,'observer','watch',{username:'观战者'});
  const observer=roomView(room,'observer'),player=roomView(room,'guest-a');
  assert.equal(observer.role,'spectator');assert.equal(observer.game.players[0].galaxy,g.players[0].galaxy);
  assert.equal(observer.game.players[1].galaxy,g.players[1].galaxy);
  assert.ok(observer.game.players.every(p=>Array.isArray(p.hand)&&p.hand.length>0));
  assert.deepEqual(observer.game.strikes[0]&&[observer.game.strikes[0].progress,observer.game.strikes[0].required],[2,4]);
  assert.equal(observer.game.players[0].hand.find(c=>c.id==='known-card').name,'光粒打击');
  assert.equal(observer.game.players[0].hand.find(c=>c.id==='known-card').key,undefined);
  assert.equal(player.game.players[0].hand,undefined);assert.equal(player.game.players[0].galaxy,undefined);
  assert.equal(player.spectator,undefined);
});
test('每个 DeepSeek 座位开局获得独立规则上下文，并只接收自己的私有牌局变化',()=>{
  const room=newRoom('87654321','host','记忆测试','房主');
  room.members.push({id:'guest',name:'朋友',bot:null});mutateRoom(room,'host','bot',{level:'deepseek'});mutateRoom(room,'host','start');
  appendDeepSeekUpdates(room);
  const seat=room.members.findIndex(p=>p.bot==='deepseek'),session=room.deepseekSessions[room.members[seat].id];
  assert.ok(session.messages[0].content.includes('航线如下'));
  assert.ok(session.messages[0].content.includes('科技锁死'));
  const opening=JSON.parse(session.messages[1].content.split('\n').at(-1));
  assert.ok(opening.players[seat].hand.length);
  for(const player of opening.players.filter(p=>p.id!==seat))assert.equal(player.hand,undefined);
  room.game.players[(seat+1)%room.game.players.length].energy++;
  appendDeepSeekUpdates(room);
  const update=session.messages.at(-1).content;
  assert.ok(update.includes('牌局出现新信息')&&update.includes('energy'));
  assert.equal(session.messages.length,3);
});
test('进行中的真人主动退出后由 AI 接管，最后一位真人退出时房间关闭',()=>{
  const room=newRoom('87654321','host','离开测试','房主');
  room.members.push({id:'guest-a',name:'玩家甲',bot:null},{id:'guest-b',name:'玩家乙',bot:null});
  mutateRoom(room,'host','start');
  mutateRoom(room,'host','leave');
  assert.equal(room.status,'playing');assert.equal(room.members[0].exited,true);assert.equal(room.members[0].bot,'easy');
  assert.equal(room.host,'guest-a');assert.throws(()=>roomView(room,'host'),/已退出/);assert.equal(roomView(room,'guest-a').isHost,true);
  mutateRoom(room,'guest-a','leave');assert.equal(room.status,'playing');assert.equal(room.host,'guest-b');
  mutateRoom(room,'guest-b','leave');assert.equal(room.status,'closed');assert.equal(room.members.filter(p=>!p.bot&&!p.exited).length,0);
});
test('每个在线视角只包含自己的私牌、坐标与打击总时长',()=>{
  const g=new Game({count:3});
  g.play(g.players[0].hand.find(c=>c.key==='photon').id,1);
  const own=gameView(g,0),other=gameView(g,1);
  assert.ok(own.players[0].galaxy);assert.ok(own.players[0].hand[0].key);
  assert.ok(own.strikes[0].required);
  assert.equal(other.strikes[0].required,undefined);
  for(const p of other.players.filter(p=>p.id!==1)){
    assert.equal(p.hand,undefined);assert.equal(p.galaxy,undefined);assert.equal(typeof p.handCount,'number');
  }
  assert.equal(other.deck,undefined);assert.equal(other.discard,undefined);assert.equal(other.rngState,undefined);
  assert.equal(other.strikes[0].progress,0);
});
test('星系状态和打击命中结果向客户端公开，旧标记在恢复时迁移',()=>{
  const g=new Game({count:3});g.markers[1]='red';g.latest={kind:'strike',target:1,revealed:true,outcome:'survived',victimId:1,cards:[{id:'x',key:'photon',actor:0,role:'结算'}]};
  const view=gameView(g,2);assert.equal(view.markers[1],'red');assert.equal(view.latest.outcome,'survived');assert.equal(view.latest.victimId,1);
  const old=saveGame(g);delete old.markerSchemaVersion;old.markers={1:'black',2:'red'};const restored=restoreGame(old);assert.deepEqual(restored.markers,{1:'red',2:'gray'});
  const v2=saveGame(g);v2.markerSchemaVersion=2;v2.markers={1:'purple',2:'red',3:'gray'};assert.deepEqual(restoreGame(v2).markers,{1:'red',2:'red',3:'gray'});
});
test('未揭示广播在所有网络出口隐藏牌型，服务器拒绝越权与重复行动',()=>{
  const room=newRoom('12345678','host','房间','房主');
  room.members.push({id:'b',name:'b'},{id:'c',name:'c'});room.game=new Game({count:3});room.status='playing';
  const g=room.game,id=g.players[0].hand.find(c=>c.key==='stellar_c').id;
  assert.throws(()=>applyGameAction(room,1,{type:'end'}),/还没轮到/);
  assert.throws(()=>mutateRoom(room,'host','action',{revision:0,action:{type:'end'}}),/牌桌已更新/);
  applyGameAction(room,0,{type:'play',cardId:id,target:5});
  for(let me=0;me<3;me++){
    const v=gameView(g,me);assert.equal(v.latest.cards[0].key,undefined);assert.equal(v.pending.card,undefined);
  }
  assert.throws(()=>applyGameAction(room,1,{type:'settle',chosen:null}),/只能由发布者/);
  applyGameAction(room,1,{type:'respond'});
  assert.throws(()=>applyGameAction(room,1,{type:'respond'}),/重复回应/);
  assert.equal(g.allPhysicalCards().length,64);
});
test('没有可回应广播牌的在线玩家自动跳过回应，并等待三秒后结算',()=>{
  const room=newRoom('12345678','host','自动跳过','房主');room.members.push({id:'b',name:'b'},{id:'c',name:'c'});
  room.game=new Game({count:3});room.status='playing';const g=room.game;
  for(const p of g.players.slice(1)){const removed=p.hand.filter(c=>CARDS[c.key].type==='broadcast');p.hand=p.hand.filter(c=>CARDS[c.key].type!=='broadcast');g.discard.push(...removed);}
  assert.deepEqual(g.players.slice(1).map(p=>g.responseOptions(p.id).length),[0,0]);
  applyGameAction(room,0,{type:'play',cardId:g.players[0].hand.find(c=>c.key==='stellar_c').id,target:5});
  assert.equal(g.pending.kind,'broadcast');assert.equal(g.pending.autoSettleAt>=Date.now()+2900,true);assert.equal(g.latest.revealed,false);
  const due=g.pending.autoSettleAt,now=Date.now;Date.now=()=>due;
  try{applyGameAction(room,0,{type:'settle',chosen:null});}finally{Date.now=now;}
  assert.equal(g.pending,null);assert.equal(g.latest.revealed,true);assert.equal(g.latest.cards.length,1);assert.equal(g.allPhysicalCards().length,64);
});
test('对局序列化保存随机数进度，恢复后摸牌与结算一致',()=>{
  const g=new Game({count:4,demo:false,seed:31});
  for(let n=0;n<7;n++)g.endTurn();
  const saved=JSON.parse(JSON.stringify(saveGame(g))),restored=restoreGame(saved);
  for(let n=0;n<12;n++){
    const ids=g.players[g.active].hand.map(c=>c.id);
    g.discardCards(ids);restored.discardCards(ids);
  }
  assert.deepEqual(saveGame(restored),saveGame(g));assert.equal(restored.allPhysicalCards().length,64);
});
test('无人回应的广播保留 3 秒窗口，旧批次不能提前结算',()=>{
  const room=newRoom('12345678','host','测试','测试');room.members.push({id:'b',name:'b'},{id:'c',name:'c'});
  room.game=new Game({count:3});room.status='playing';
  applyGameAction(room,0,{type:'play',cardId:room.game.players[0].hand.find(c=>c.key==='stellar_c').id,target:5});
  const phase=room.game.pending.publicId;
  mutateRoom(room,'b','action',{revision:0,action:{type:'respond',phase}});
  assert.throws(()=>mutateRoom(room,'c','action',{revision:room.revision,action:{type:'respond',phase:'old-broadcast'}}),/广播已经结束/);
  mutateRoom(room,'c','action',{revision:0,action:{type:'respond',phase}});
  assert.equal(room.game.pending.kind,'broadcast');assert.ok(room.game.pending.autoSettleAt);assert.equal(room.game.latest.revealed,false);
  const due=room.game.pending.autoSettleAt,now=Date.now;Date.now=()=>due;
  try{applyGameAction(room,0,{type:'settle',chosen:null});}finally{Date.now=now;}
  assert.equal(room.game.pending,null);assert.equal(room.game.latest.revealed,true);
});
test('未揭示广播使用每批独立的公开标识，不能凭旧牌 ID 追踪牌面',()=>{
  const hidden=[];
  for(let n=0;n<2;n++){
    const room=newRoom('12345678','host','测试','测试');room.game=new Game({count:3});room.status='playing';
    const card=room.game.players[0].hand.find(c=>c.key==='stellar_c');
    applyGameAction(room,0,{type:'play',cardId:card.id,target:5});
    assert.equal(gameView(room.game,0).latest.cards[0].id,card.id);
    const other=gameView(room.game,1).latest.cards[0];
    assert.notEqual(other.id,card.id);assert.equal(other.key,undefined);hidden.push(other.id);
  }
  assert.notEqual(hidden[0],hidden[1]);
});
test('困难 AI 长局面对低评分打击时仍尝试出手',()=>{
  const game=new Game({count:3,demo:false,seed:123}),me=game.players[0];game.round=30;me.energy=20;
  const view=gameView(game,0);view.players[0].hand=[{id:'shot',key:'nuclear'}];
  for(const p of view.players.slice(1))p.builds=[{id:'shield'+p.id,key:'ghost'}];
  const history=Array.from({length:9},(_,i)=>({type:'launch',actor:0,target:i+1}));
  const action=decideAI(view,0,'hard',history,()=>0);
  assert.equal(action.type,'play');assert.equal(action.cardId,'shot');assert.notEqual(action.target,me.galaxy);
});
test('AI 策略只使用公开观察与自身视角，并能完成多人数整局',()=>{
  const results=[];
  for(const count of [3,4,6])for(const level of ['easy','normal','hard']){
    const room=newRoom('12345678','host','测试','测试');
    room.members=Array.from({length:count},(_,i)=>({id:'bot'+i,name:'AI'+i,bot:level}));
    room.game=new Game({count,demo:false,seed:100+count});room.status='playing';
    const rng=seeded(900+count);let steps=0;
    while(!room.game.over&&steps++<5000){
      let moved=false;
      if(room.game.pending?.autoSettleAt){const due=room.game.pending.autoSettleAt,now=Date.now;Date.now=()=>due;try{applyGameAction(room,room.game.pending.caster,{type:'settle',chosen:null});}finally{Date.now=now;}moved=true;}
      for(let me=0;me<count;me++){
        if(moved)break;
        const view=gameView(room.game,me),action=decideAI(view,me,level,room.intel,rng);
        if(!action)continue;
        applyGameAction(room,me,action);moved=true;
        assert.equal(room.game.allPhysicalCards().length,64);
        break;
      }
      assert.ok(moved,'不能停滞：'+count+'人 '+level);
    }
    if(!room.game.over)console.log('AI stalled',level,room.game.round,room.game.players.map(p=>({id:p.id,alive:p.alive,energy:p.energy,galaxy:p.galaxy,hand:p.hand.map(c=>c.key),builds:p.builds.map(c=>c.key)})));
    assert.ok(room.game.over,'应在有限步数完成：'+count+'人 '+level);
    results.push({count,level,steps,winner:room.game.winner});
  }
  console.log('AI 完整对局：',JSON.stringify(results));
});
