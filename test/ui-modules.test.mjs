import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReplayArchive,sanitizeReplayArchive} from '../dist/replay-archive.js';
import {svgArt,shipArt} from '../dist/card-art.js';

test('回放模块校验并净化导入数据',()=>{
  assert.throws(()=>validateReplayArchive({}),/有效/);
  const players=[0,1,2].map(i=>({name:'玩家'+i,alive:true,energy:3,galaxy:i+1,hand:[],builds:[]}));
  const replay={format:'dark-forest-replay',version:1,matchId:'12345678-1234-1234-1234-123456789abc',events:[],frames:[{eventCount:0,game:{players,strikes:[],markers:{}}}]};
  validateReplayArchive(replay);
  const result=sanitizeReplayArchive(replay);
  assert.equal(result.frames[0].game.players.length,3);
  assert.equal(result.frames[0].game.players[0].name,'玩家0');
  assert.equal(result.frames[0].eventCount,0);
});

test('回放动画保留回合生产的产能数值，多次净化后仍可读取',()=>{
  const players=[0,1,2].map(i=>({name:'玩家'+i,alive:true,energy:3,galaxy:i+1,hand:[],builds:[]}));
  const replay={format:'dark-forest-replay',version:1,matchId:'12345678-1234-1234-1234-123456789abc',events:[],frames:[{eventCount:0,game:{players,strikes:[],markers:{},motionBatches:[{sequence:1,events:[{type:'production',player:1,gain:4}],energyChanges:[]}]}}]};
  const clean=sanitizeReplayArchive(sanitizeReplayArchive(replay));
  assert.equal(clean.frames[0].game.motionBatches[0].events[0].gain,4);
});

test('回放保留事件发生时的观战目标，并区分空目标和旧记录',()=>{
  const players=[0,1,2].map(i=>({name:'玩家'+i,alive:true,energy:3,galaxy:i+1,hand:[],builds:[]}));
  const events=[{type:'launch',actor:0,target:2,targetPlayerId:1},{type:'launch',actor:0,target:4,targetPlayerId:null},{type:'launch',actor:0,target:3}];
  const replay={format:'dark-forest-replay',version:1,matchId:'12345678-1234-1234-1234-123456789abc',events,frames:[{eventCount:3,game:{players,strikes:[],markers:{}}}]};
  const clean=sanitizeReplayArchive(sanitizeReplayArchive(replay));
  assert.equal(clean.events[0].targetPlayerId,1);
  assert.equal(clean.events[1].targetPlayerId,null);
  assert.equal(Object.hasOwn(clean.events[2],'targetPlayerId'),false);
});

test('卡牌插图模块输出 SVG 并支持缺省图案',()=>{
  assert.match(svgArt({art:'solar'}),/^<svg/);
  assert.match(shipArt,/<path/);assert.ok(svgArt({art:'ship'}).includes(shipArt));
  assert.match(svgArt({art:'unknown'}),/<ellipse/);
});
