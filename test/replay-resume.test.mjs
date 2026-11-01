import test from 'node:test';
import assert from 'node:assert/strict';
import {saveResumeArchive,loadResumeArchive,deleteResumeArchive} from '../dist/replay-resume.js';

function fakeIndexedDB(){
  const entries=new Map();let created=false;
  return {open(){
    const request={};
    request.result={createObjectStore(){created=true;},close(){},transaction(){
      const transaction={objectStore(){
        const run=fn=>{const operation={};setImmediate(()=>{operation.result=fn();transaction.oncomplete();});return operation;};
        return {put:(value,key)=>run(()=>{entries.set(key,structuredClone(value));return key;}),get:key=>run(()=>entries.get(key)),delete:key=>run(()=>entries.delete(key))};
      }};
      return transaction;
    }};
    setImmediate(()=>{if(!created)request.onupgradeneeded();request.onsuccess();});
    return request;
  }};
}

test('replay cache stores, reloads and removes each archive independently',async()=>{
  const original=globalThis.indexedDB;globalThis.indexedDB=fakeIndexedDB();
  try{
    const first={matchId:'first',frames:[{round:2}]},second={matchId:'second',frames:[{round:3}]};
    await saveResumeArchive('tab-a',first);await saveResumeArchive('tab-b',second);
    assert.deepEqual(await loadResumeArchive('tab-a'),first);
    await deleteResumeArchive('tab-a');
    assert.equal(await loadResumeArchive('tab-a'),undefined);
    assert.deepEqual(await loadResumeArchive('tab-b'),second);
  }finally{globalThis.indexedDB=original;}
});
