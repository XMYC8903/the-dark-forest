import test from 'node:test';
import assert from 'node:assert/strict';
import {EVENT_FILTER_CATEGORIES,deduplicatePublicHistoryEvents,eventPlayerIds,isPublicHistoryEvent,matchesObserverEvent,observerEventCategories,observerEventCategoryLabel,observerEventRoles} from '../dist/observer-event-filter.js';
import {gatherIntel} from '../server/room-core.js';

test('event and player selections combine and empty selections include all',()=>{
  const event={type:'impact',actor:0,victim:2,target:5};
  assert.equal(matchesObserverEvent(event,new Set(),new Set()),true);
  assert.equal(matchesObserverEvent(event,new Set(['build','impact_hit']),new Set([0,4]),new Set([2])),true);
  assert.equal(matchesObserverEvent(event,new Set(['build']),new Set([0])),false);
  assert.equal(matchesObserverEvent(event,new Set(['impact_hit']),new Set([5])),false);
  assert.equal(matchesObserverEvent(event,new Set(),new Set([2])),false);
  assert.equal(matchesObserverEvent(event,new Set(),new Set(),new Set([2])),true);
  assert.equal(matchesObserverEvent(event,new Set(),new Set([0]),new Set([0])),false);
});

test('打击结算按结果分类，能量变化可与其他分类重叠',()=>{
  assert.deepEqual(EVENT_FILTER_CATEGORIES.map(([,label])=>label),['建设','广播发布','广播结算','打击发射','打击命中','防御打击','打击落空','科技锁死','光速跃迁','文明消逝','能量变化']);
  assert.deepEqual([...observerEventCategories({type:'impact',outcome:'survived'})],['defense']);
  assert.deepEqual([...observerEventCategories({type:'impact',outcome:'miss'})],['miss']);
  for(const outcome of ['hit','eliminated','escaped'])assert.deepEqual([...observerEventCategories({type:'impact',outcome,victim:2})],['impact_hit']);
  assert.deepEqual([...observerEventCategories({type:'impact',outcome:'hit',victim:null})],['miss']);
  assert.deepEqual([...observerEventCategories({type:'impact',outcome:'hit'})],['miss']);
  assert.equal(matchesObserverEvent({type:'production'},new Set(['energy']),new Set()),true);
  assert.equal(matchesObserverEvent({type:'broadcast_settled',energyChanges:[{before:1,after:4}]},new Set(['energy']),new Set()),true);
  assert.equal(matchesObserverEvent({type:'build',cost:3},new Set(['build','energy']),new Set()),true);
  assert.equal(observerEventCategoryLabel({type:'impact',outcome:'survived'}),'防御打击');
  assert.equal(observerEventCategoryLabel({type:'impact',outcome:'escaped'}),'打击命中');
  assert.equal(matchesObserverEvent({type:'impact',outcome:'escaped'},new Set(['impact_hit']),new Set()),true);
  assert.equal(matchesObserverEvent({type:'impact',outcome:'escaped'},new Set(['miss']),new Set()),false);
  assert.equal(observerEventCategoryLabel({type:'system_hit'}),'打击落空');
  assert.equal(observerEventCategoryLabel({type:'impact',outcome:'hit',victim:null}),'打击落空');
  assert.equal(matchesObserverEvent({type:'impact',outcome:'hit',victim:null},new Set(['miss']),new Set()),true);
  assert.equal(matchesObserverEvent({type:'impact',outcome:'hit',victim:null},new Set(['impact_hit']),new Set()),false);
  assert.equal(observerEventCategoryLabel({type:'production'}),'能量变化');
  assert.equal(observerEventCategoryLabel({type:'build',cost:3}),'建设');
  assert.equal(observerEventCategoryLabel({type:'gameover'}),null);
});

test('按发起者和目标筛选，并且不将回应者或星系误判为目标',()=>{
  const event={type:'broadcast_settled',actor:0,selected:2,target:3,targetPlayerId:1,cards:[{actor:0},{actor:2}],energyChanges:[{player:4}]};
  assert.deepEqual([...eventPlayerIds(event)],[0,2,1,4]);
  assert.deepEqual([...observerEventRoles(event).initiators],[0]);
  assert.deepEqual([...observerEventRoles(event).targets],[1]);
  assert.equal(matchesObserverEvent(event,new Set(),new Set([0]),new Set([1])),true);
  assert.equal(matchesObserverEvent(event,new Set(),new Set(),new Set([2])),false);
  assert.equal(matchesObserverEvent(event,new Set(),new Set(),new Set([3])),false);
  assert.equal(matchesObserverEvent({type:'launch',actor:0,target:3},new Set(),new Set(),new Set([3])),false);
  assert.equal(matchesObserverEvent({type:'broadcast_settled',actor:0,selected:2,target:3},new Set(),new Set(),new Set([2])),false);
  assert.deepEqual([...observerEventRoles({type:'eliminated',actor:2}).targets],[2]);
  assert.equal(observerEventRoles({type:'eliminated',actor:2}).initiators.size,0);
  assert.deepEqual([...eventPlayerIds({type:'gameover',winner:3})],[3]);
});

test('公开记录仅展示指定分类，不展示弃牌、撤回打击、对局结束等事件',()=>{
  for(const type of ['discard','withdraw','gameover','unknown']){
    const event={type,cost:1,energyChanges:[{before:2,after:1}]};
    assert.equal(isPublicHistoryEvent(event),false);
    assert.equal(matchesObserverEvent(event,new Set(),new Set()),false);
    assert.equal(matchesObserverEvent(event,new Set(['energy']),new Set()),false);
  }
  for(const type of ['build','broadcast_published','broadcast_settled','broadcast','launch','impact','system_hit','damage','miss','lock','escaped','eliminated','production'])assert.equal(isPublicHistoryEvent({type}),true,type);
});

test('同一枚打击的结算和落空记录只展示结算，独立打击仍保留',()=>{
  const room={game:{round:8,turnIndex:23,players:[]},intel:[]};
  gatherIntel(room,[
    {type:'strike_arriving',owner:0,target:4,strikeId:'strike-a',card:{key:'nuke'}},
    {type:'strike_resolved',owner:0,target:4,key:'nuke',strikeId:'strike-a',progress:3,outcome:'miss'},
    {type:'miss',target:4}
  ]);
  assert.deepEqual(room.intel.map(event=>event.type),['impact','miss']);
  const deduped=deduplicatePublicHistoryEvents(room.intel);
  assert.equal(deduped.length,1);assert.equal(deduped[0].progress,3);
  const unrelated={...room.intel[1],strikeId:'strike-b'};
  assert.deepEqual(deduplicatePublicHistoryEvents([room.intel[0],unrelated]),[room.intel[0],unrelated]);
  const standalone={...room.intel[1],strikeId:undefined};
  assert.deepEqual(deduplicatePublicHistoryEvents([room.intel[0],standalone]),[room.intel[0],standalone]);
});

test('同一枚打击的星系效果与结算只展示一条',()=>{
  const impact={type:'impact',strikeId:'strike-a',round:2,turnIndex:4,outcome:'hit'};
  const effect={type:'system_hit',strikeId:'strike-a',round:2,turnIndex:4};
  assert.deepEqual(deduplicatePublicHistoryEvents([impact,effect]),[impact]);
  assert.deepEqual(deduplicatePublicHistoryEvents([impact,{...effect,turnIndex:5}]),[impact,{...effect,turnIndex:5}]);
});
