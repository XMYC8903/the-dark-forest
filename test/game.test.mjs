import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,CARDS,distance} from '../shared/game.js';

function give(g,id,key){const p=g.players[id];for(const zone of [g.deck,g.discard,...g.players.flatMap(x=>[x.hand,x.builds])]){const i=zone.findIndex(c=>c.key===key);if(i>=0){const c=zone.splice(i,1)[0];p.hand.push(c);return c;}}throw Error('Missing test card '+key);}
function conserve(g){const cards=g.allPhysicalCards();assert.equal(cards.length,64);assert.equal(new Set(cards.map(c=>c.id)).size,64);}
test('牌库为 19 种 64 张，广播/建设/打击数量正确',()=>{assert.equal(Object.keys(CARDS).length,19);for(const [type,n] of [['broadcast',28],['build',22],['strike',14]])assert.equal(Object.values(CARDS).filter(c=>c.type===type).reduce((sum,c)=>sum+c.count,0),n);for(let count=3;count<=6;count++)conserve(new Game({count}));assert.throws(()=>new Game({count:2}));assert.throws(()=>new Game({count:7}));});
test('完整星图最短路径和直径正确',()=>{assert.equal(distance(1,4),1);assert.equal(distance(4,5),1);assert.equal(distance(1,9),3);for(let i=1;i<=9;i++)for(let j=1;j<=9;j++){assert.equal(distance(i,j),distance(j,i));assert.ok(distance(i,j)<=3);}});
test('禁止打击自己的星系，失败时不消耗牌或能量',()=>{const g=new Game({count:3,demo:false});const p=g.players[0];p.energy=30;const c=give(g,0,'nuclear'),hand=p.hand.map(x=>x.id);assert.throws(()=>g.play(c.id,p.galaxy),/不能打击自己的星系/);assert.deepEqual(p.hand.map(x=>x.id),hand);assert.equal(p.energy,30);assert.equal(g.played,false);assert.equal(g.strikes.length,0);conserve(g);});
test('标准开局固定产能，没有回合开始补牌',()=>{const g=new Game({count:3,demo:false});assert.equal(g.players[0].energy,4);assert.equal(g.players[1].energy,3);g.players[1].hand.splice(0,1).forEach(c=>g.discard.push(c));g.endTurn();assert.equal(g.active,1);assert.equal(g.players[1].hand.length,3);assert.equal(g.players[1].energy,4);conserve(g);});
test('建设不立即补牌，成功出牌后禁止主动弃牌',()=>{const g=new Game();const p=g.players[0],solar=p.hand.find(c=>c.key==='solar'),before=p.energy;g.play(solar.id);assert.equal(p.energy,before-2);assert.equal(p.hand.length,3);assert.equal(g.played,true);assert.throws(()=>g.discardCards([p.hand[0].id]),/出过牌/);conserve(g);});
test('红色星系可建独立能源但不可建恒星能源；灰色星系可以广播但不能打击',()=>{const g=new Game(),p=g.players[0];g.markers[p.galaxy]='red';assert.throws(()=>g.play(p.hand.find(c=>c.key==='solar').id),/恒星已熄灭/);const fusion=give(g,0,'fusion');g.play(fusion.id);assert.equal(g.income(p),3);const h=new Game(),q=h.players[0];h.players[0].energy=20;h.markers[4]='gray';const strike=give(h,0,'nuclear');assert.throws(()=>h.play(strike.id,4),/灰色星系已不存在/);const broadcast=give(h,0,'hyper_c');h.play(broadcast.id,4);assert.equal(h.pending.target,4);conserve(g);conserve(h);});
test('科技锁死按总费用一半向下取整返给被拆者，手牌不变并记录锁死命中',()=>{const g=new Game();const victim=g.players[1];g.discard.push(...victim.builds.splice(0));for(const key of ['solar','fusion']){const c=give(g,1,key);victim.hand.splice(victim.hand.indexOf(c),1);victim.builds.push(c);}const beforeHand=victim.hand.map(c=>c.id),beforeEnergy=victim.energy;const lock=g.players[0].hand.find(c=>c.key==='lock');g.play(lock.id,victim.galaxy);assert.equal(victim.builds.length,0);assert.equal(victim.energy,beforeEnergy+2);assert.deepEqual(victim.hand.map(c=>c.id),beforeHand);assert.equal(g.latest.outcome,'locked');assert.equal(g.latest.victimId,victim.id);conserve(g);});
test('广播翻面结算前不扣能量，收益费用按各自牌统一结算',()=>{const g=new Game({count:3,demo:false});g.players[0].energy=6;g.players[1].energy=6;const a=give(g,0,'hyper_c'),b=give(g,1,'hyper_d');g.play(a.id,g.players[0].galaxy);assert.equal(g.players[0].energy,6);assert.equal(g.latest.revealed,false);g.respond(1,b.id);g.respond(2,null);assert.equal(g.players[1].energy,6);assert.equal(g.players[0].energy,6);g.settleBroadcast(1);assert.equal(g.players[0].energy,4);assert.equal(g.players[1].energy,9);assert.equal(g.latest.revealed,true);assert.equal(g.latest.cards.length,2);conserve(g);});
test('主动弃牌补到四张并结束行动，普通回合不洗回弃牌',()=>{const g=new Game();const old=g.players[0],ids=old.hand.slice(0,2).map(c=>c.id);g.discardCards(ids);assert.equal(g.active,1);assert.equal(old.hand.length,4);assert.ok(ids.every(id=>g.discard.some(c=>c.id===id)));assert.equal(g.latest.cards.length,2);conserve(g);});
test('摸空后只回收已弃置牌，不回收手牌、建筑与在飞打击',()=>{const g=new Game();const p=g.players[0];const originalBuilds=p.builds.map(c=>c.id);g.discard.push(...g.deck.splice(0));g.discard.push(p.hand.pop());g.refill(p);assert.equal(p.hand.length,4);assert.deepEqual(p.builds.map(c=>c.id),originalBuilds);assert.ok(g.deck.length>0);assert.equal(g.discard.length,0);assert.equal(g.latest,null);conserve(g);});
test('出局者的打击保留并在原座位推进，清空前不提前终局',()=>{const g=new Game({count:3,demo:false});g.players[0].galaxy=1;g.players[1].galaxy=4;g.players[2].galaxy=9;g.players[0].energy=30;const c=give(g,0,'nuclear');g.play(c.id,4);g.eliminate(g.players[0],2);assert.equal(g.strikes.length,1);g.checkEnd();assert.equal(g.over,false);g.nextSeat();g.nextSeat();g.nextSeat();assert.equal(g.strikes.length,0);assert.equal(g.players[1].alive,false);assert.equal(g.over,true);assert.equal(g.winner,2);conserve(g);});
test('同 seed 的抽牌顺序可复现',()=>{const a=new Game({count:6,demo:false,seed:1023}),b=new Game({count:6,demo:false,seed:1023});assert.deepEqual(a.players,b.players);assert.deepEqual(a.deck,b.deck);conserve(a);});
function buildForTest(g,id,key){const c=give(g,id,key),p=g.players[id];p.hand.splice(p.hand.indexOf(c),1);p.builds.push(c);return c;}
test('光粒被防御后仍弃置全部恒星建设，独立能源、防御和手牌保留',()=>{
 const g=new Game(),victim=g.players[1];const solar=victim.builds[0],dyson=buildForTest(g,1,'dyson');
 const fusion=buildForTest(g,1,'fusion'),bunker=buildForTest(g,1,'bunker'),hand=victim.hand.map(c=>c.id);
 const energy=victim.energy,photon=g.players[0].hand.find(c=>c.key==='photon');g.play(photon.id,victim.galaxy);
 const strike=g.strikes[0];strike.progress=strike.required;g.resolveDue();
 assert.equal(victim.alive,true);assert.equal(g.markers[victim.galaxy],'red');
 assert.deepEqual(victim.builds.map(c=>c.id).sort(),[fusion.id,bunker.id].sort());
 for(const c of [solar,dyson])assert.equal(g.discard.filter(x=>x.id===c.id).length,1);
 assert.deepEqual(victim.hand.map(c=>c.id),hand);assert.equal(victim.energy,energy);assert.equal(g.income(victim),2);
 assert.equal(g.latest.cards.filter(c=>c.role==='恒星熄灭弃置').length,2);conserve(g);
});
test('湮灭被三级防御挡住仍弃置全部建设，星系标红且仍可建设',()=>{
 const g=new Game();g.players[0].energy=30;const victim=g.players[1];buildForTest(g,1,'ghost');buildForTest(g,1,'dyson');buildForTest(g,1,'fusion');
 const c=give(g,0,'annihilation');g.play(c.id,victim.galaxy);const strike=g.strikes[0];strike.progress=strike.required;g.resolveDue();
 assert.equal(victim.alive,true);assert.equal(victim.builds.length,0);assert.equal(g.markers[victim.galaxy],'red');assert.equal(g.latest.outcome,'survived');
 const fusion=give(g,1,'fusion');victim.energy=10;g.active=1;g.played=false;g.play(fusion.id);assert.ok(victim.builds.some(x=>x.id===fusion.id));conserve(g);
});
test('湮灭命中无人星系也会熄灭恒星并产生有效命中结果',()=>{
 const g=new Game();g.players[0].energy=30;const c=give(g,0,'annihilation');g.play(c.id,2);const strike=g.strikes[0];strike.progress=strike.required;g.resolveDue();
 assert.equal(g.markers[2],'red');assert.equal(g.latest.outcome,'hit');assert.equal(g.latest.victimId,null);conserve(g);
});
test('降维打击将星系标为灰色并从合法落点与行动目标中移除',()=>{
 const g=new Game();g.players[0].energy=30;const victim=g.players[1];victim.energy=0;const c=give(g,0,'dimension');g.play(c.id,victim.galaxy);const strike=g.strikes[0];strike.progress=strike.required;g.resolveDue();
 assert.equal(g.markers[victim.galaxy],'gray');assert.ok(!g.emptyGalaxies(g.players[2]).some(x=>x.id===victim.galaxy));assert.equal(g.latest.outcome,'eliminated');assert.equal(g.latest.victimId,victim.id);conserve(g);
});
test('逃生选择之前已弃置恒星建设，放弃逃生后不重复弃置',()=>{
 const g=new Game();g.players[0].energy=30;const victim=g.players[1];victim.energy=12;give(g,1,'lightship');
 const solar=victim.builds[0],c=g.players[0].hand.find(c=>c.key==='photon');g.play(c.id,victim.galaxy);const strike=g.strikes[0];strike.progress=strike.required;g.resolveDue();
 assert.equal(g.pending.kind,'escape');assert.equal(victim.builds.some(c=>c.id===solar.id),false);
 assert.equal(g.discard.filter(c=>c.id===solar.id).length,1);conserve(g);g.resolveEscape(false);
 assert.equal(g.discard.filter(c=>c.id===solar.id).length,1);conserve(g);
});
test('使用光速飞船成功逃离打击时记录逃生结果供界面显示飞船反馈',()=>{
 const g=new Game();g.players[0].energy=30;const victim=g.players[1];victim.energy=12;give(g,1,'lightship');
 const c=g.players[0].hand.find(c=>c.key==='photon');g.play(c.id,victim.galaxy);const strike=g.strikes[0];strike.progress=strike.required;g.resolveDue();
 assert.equal(g.pending.kind,'escape');g.resolveEscape(true);assert.equal(g.latest.outcome,'escaped');assert.equal(g.latest.victimId,victim.id);assert.equal(victim.alive,true);assert.equal(victim.energy,3);assert.equal(victim.escapeUsed,true);conserve(g);
});
