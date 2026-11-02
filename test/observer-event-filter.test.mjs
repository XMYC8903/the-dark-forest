import test from 'node:test';
import assert from 'node:assert/strict';
import {EVENT_FILTER_CATEGORIES,eventPlayerIds,matchesObserverEvent,observerEventCategories,observerEventCategoryLabel} from '../dist/observer-event-filter.js';

test('event and player selections combine and empty selections include all',()=>{
  const event={type:'impact',actor:0,victim:2,target:5};
  assert.equal(matchesObserverEvent(event,new Set(),new Set()),true);
  assert.equal(matchesObserverEvent(event,new Set(['build','impact_hit']),new Set([2,4])),true);
  assert.equal(matchesObserverEvent(event,new Set(['build']),new Set([0])),false);
  assert.equal(matchesObserverEvent(event,new Set(['impact_hit']),new Set([5])),false);
});

test('打击结算按结果分类，能量变化可与其他分类重叠',()=>{
  assert.deepEqual(EVENT_FILTER_CATEGORIES.map(([,label])=>label),['建设','广播发布','广播结算','打击发射','打击命中','防御打击','打击落空','科技锁死','光速跃迁','文明消逝','能量变化']);
  assert.deepEqual([...observerEventCategories({type:'impact',outcome:'survived'})],['defense']);
  for(const outcome of ['miss','escaped'])assert.deepEqual([...observerEventCategories({type:'impact',outcome})],['miss']);
  for(const outcome of ['hit','eliminated'])assert.deepEqual([...observerEventCategories({type:'impact',outcome})],['impact_hit']);
  assert.equal(matchesObserverEvent({type:'production'},new Set(['energy']),new Set()),true);
  assert.equal(matchesObserverEvent({type:'broadcast_settled',energyChanges:[{before:1,after:4}]},new Set(['energy']),new Set()),true);
  assert.equal(matchesObserverEvent({type:'build',cost:3},new Set(['build','energy']),new Set()),true);
  assert.equal(observerEventCategoryLabel({type:'impact',outcome:'survived'}),'防御打击');
  assert.equal(observerEventCategoryLabel({type:'impact',outcome:'escaped'}),'打击落空');
  assert.equal(observerEventCategoryLabel({type:'system_hit'}),'打击命中');
  assert.equal(observerEventCategoryLabel({type:'production'}),'能量变化');
  assert.equal(observerEventCategoryLabel({type:'build',cost:3}),'建设');
  assert.equal(observerEventCategoryLabel({type:'gameover'}),null);
});

test('player matching includes broadcast participants and winners without interpreting galaxies as players',()=>{
  const event={type:'broadcast_settled',actor:0,selected:1,target:3,cards:[{actor:0},{actor:2}],energyChanges:[{player:4}]};
  assert.deepEqual([...eventPlayerIds(event)],[0,1,2,4]);
  assert.equal(matchesObserverEvent(event,new Set(),new Set([2])),true);
  assert.equal(matchesObserverEvent(event,new Set(),new Set([3])),false);
  assert.equal(matchesObserverEvent({type:'gameover',winner:3},new Set(),new Set([3])),true);
});
