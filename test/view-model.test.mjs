import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeBuildings,broadcastPresentation,strikeFeedback,strikeNotice} from '../dist/view-model.js';

const cards=(...keys)=>keys.map((key,i)=>({id:`b${i}`,key}));
test('绿色幸存叉只在目标存活且实际损失建筑时显示',()=>{
  const lost=[{id:'solar',actor:2,role:'恒星熄灭弃置'}];
  assert.equal(strikeFeedback('survived',2,lost),'survived');
  assert.equal(strikeFeedback('survived',2,[]),null);
  assert.equal(strikeFeedback('survived',2,[{id:'bunker',actor:2,role:'打击摧毁'}]),'survived');
  assert.equal(strikeFeedback('survived',2,[{id:'solar',actor:1,role:'恒星熄灭弃置'}]),null);
  assert.equal(strikeFeedback('survived',2,[]),null);
  assert.equal(strikeFeedback('eliminated',2,lost),'eliminated');
  assert.equal(strikeFeedback('escaped',2,lost),'escaped');
});
test('仅向发起者提示自己的打击牌抵达，不区分命中或落空',()=>{
  const strike={kind:'strike',outcome:'miss',cards:[{key:'photon',actor:0,role:'结算'}]};
  assert.deepEqual(strikeNotice(strike,0),{text:'光粒打击 · 目标已抵达',cardKey:'photon'});
  assert.equal(strikeNotice(strike,1),null);
  assert.equal(strikeNotice({...strike,outcome:'hit'},0).text,'光粒打击 · 目标已抵达');
  assert.equal(strikeNotice({...strike,outcome:'eliminated',cards:[{key:'lock',actor:0,role:'已生效'}]},0).text,'科技锁死 · 目标已抵达');
  assert.equal(strikeNotice({kind:'strike',cards:[{key:'lock',actor:0,role:'已生效'}]},0).text,'科技锁死 · 目标已抵达');
  assert.equal(strikeNotice({kind:'strike',outcome:'miss',cards:[]},0),null);
});
test('能源分类汇总，保留每张实体牌 ID，不计基础产能',()=>{
  const builds=cards('fusion','antimatter','fusion','solar','dyson');
  const before=structuredClone(builds),s=summarizeBuildings(builds);
  assert.equal(s.independent.income,4);assert.equal(s.stellar.income,4);
  assert.deepEqual(s.independent.ids,['b0','b1','b2']);assert.deepEqual(s.stellar.ids,['b3','b4']);
  assert.deepEqual(builds,before);
});
test('无效恒星建设不产生显示收益，汇总不改变输入归属',()=>{
  const s=summarizeBuildings(cards('fusion','antimatter','solar','dyson'),{starActive:false});
  assert.equal(s.independent.income,3);assert.equal(s.stellar.income,0);
  assert.equal(s.stellar.inactive,true);assert.equal(s.stellar.ids.length,2);
});
test('防御取最高等级，不累加；监听简称合并计数',()=>{
  const s=summarizeBuildings(cards('bunker','ghost','bunker','listener','listener'));
  assert.equal(s.defense,3);assert.equal(s.defenseIds.length,3);
  assert.equal(s.other[0].label,'监听');assert.equal(s.other[0].count,2);
});
test('没有建设时汇总为零，不虚构基础产能、防御或监听',()=>{
  const s=summarizeBuildings([]);assert.equal(s.independent.income,0);
  assert.equal(s.stellar.income,0);assert.equal(s.defense,0);assert.deepEqual(s.other,[]);
});
test('未结算广播的展示投影不含隐藏牌型、费用、距离、合作或伪装效果',()=>{
  const c={id:'c1',key:'hyper_d',role:'回应'};
  const v=broadcastPresentation(c,{target:8,actorName:'执剑人'});
  assert.deepEqual(Object.keys(v).sort(),['id','actorName','role','target','targetName','name','revealed'].sort());
  assert.equal(v.name,'广播牌');assert.equal(v.revealed,false);
  assert.doesNotMatch(JSON.stringify(v),/伪装|合作|hyper|超距/);
});
test('翻面后发布者、回应者及未采纳的牌均公开完整信息和同一目标星系',()=>{
  for(const [role,key] of [['发布','stellar_c'],['回应','hyper_d'],['未采纳','cosmic_c']]){
    const v=broadcastPresentation({id:role,key,role},{revealed:true,target:4,actorName:role});
    assert.equal(v.target,4);assert.equal(v.targetName,'巴纳德星');assert.equal(v.role,role);
    for(const field of ['name','face','range','detail','effect'])assert.ok(v[field]);
    assert.equal(typeof v.cost,'number');assert.equal(v.revealed,true);
  }
});
