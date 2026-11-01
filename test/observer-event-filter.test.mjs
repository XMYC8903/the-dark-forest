import test from 'node:test';
import assert from 'node:assert/strict';
import {eventPlayerIds,matchesObserverEvent} from '../dist/observer-event-filter.js';

test('event and player selections combine and empty selections include all',()=>{
  const event={type:'impact',actor:0,victim:2,target:5};
  assert.equal(matchesObserverEvent(event,new Set(),new Set()),true);
  assert.equal(matchesObserverEvent(event,new Set(['build','impact']),new Set([2,4])),true);
  assert.equal(matchesObserverEvent(event,new Set(['build']),new Set([0])),false);
  assert.equal(matchesObserverEvent(event,new Set(['impact']),new Set([5])),false);
});

test('player matching includes broadcast participants and winners without interpreting galaxies as players',()=>{
  const event={type:'broadcast_settled',actor:0,selected:1,target:3,cards:[{actor:0},{actor:2}],energyChanges:[{player:4}]};
  assert.deepEqual([...eventPlayerIds(event)],[0,1,2,4]);
  assert.equal(matchesObserverEvent(event,new Set(),new Set([2])),true);
  assert.equal(matchesObserverEvent(event,new Set(),new Set([3])),false);
  assert.equal(matchesObserverEvent({type:'gameover',winner:3},new Set(),new Set([3])),true);
});
