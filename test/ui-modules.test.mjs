import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReplayArchive,sanitizeReplayArchive} from '../dist/replay-archive.js';
import {svgArt} from '../dist/card-art.js';

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

test('卡牌插图模块输出 SVG 并支持缺省图案',()=>{
  assert.match(svgArt({art:'solar'}),/^<svg/);
  assert.match(svgArt({art:'unknown'}),/<ellipse/);
});
