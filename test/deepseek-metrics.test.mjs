import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../shared/game.js';
import {decideDeepSeek} from '../server/deepseek.js';
import {summarize} from '../scripts/summarize-deepseek.mjs';

test('metrics preserve usage even for truncated or invalid choices, without retaining content',async()=>{
  for(const [content,reason,status] of [['{"choice":0}','stop','success'],['{"choice":999999}','stop','invalid_choice'],['incomplete','length','truncated'],['not JSON','stop','invalid_choice']]){
    const records=[];
    await decideDeepSeek(new Game({count:3}),0,[],'secret',async()=>Response.json({choices:[{message:{content,reasoning_content:'private thought'},finish_reason:reason}],usage:{prompt_tokens:100,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20,completion_tokens:12,completion_tokens_details:{reasoning_tokens:10},total_tokens:112}}),null,null,e=>records.push(e));
    assert.equal(records.length,1);const record=records[0];
    assert.equal(record.status,status);assert.equal(record.usage.cacheHitTokens,80);assert.equal(record.usage.reasoningTokens,10);assert.ok(record.requestBytes>0);assert.ok(record.messageCount>0);
    for(const key of ['messages','content','reasoning_content','request','response','apiKey'])assert.equal(record[key],undefined);
  }
});

test('forced decisions, timeouts, and failing metrics callbacks do not break play',async()=>{
  const game=new Game({count:3});game.pending={kind:'broadcast',caster:0,decisions:[1,2],responses:[]};
  const records=[];let requests=0;
  assert.deepEqual(await decideDeepSeek(game,0,[],'secret',async()=>{requests++;},null,null,e=>records.push(e)),{type:'settle',chosen:null});
  assert.equal(requests,0);assert.equal(records[0].apiCalled,false);assert.equal(records[0].status,'forced');
  await decideDeepSeek(new Game({count:3}),0,[],'secret',async()=>{throw Object.assign(new Error('private'),{name:'AbortError'});},null,null,e=>records.push(e));
  assert.equal(records[1].status,'timeout');assert.equal(records[1].usage,undefined);
  const action=await decideDeepSeek(new Game({count:3}),0,[],'secret',async()=>Response.json({choices:[{message:{content:'{"choice":0}'}}]}),null,null,()=>{throw Error('metrics unavailable');});
  assert.ok(action);
});

test('summary counts unknown usage separately and reasoning is not added to completion tokens',()=>{
  const base={kind:'deepseek',schemaVersion:1,phase:'turn',promptVersion:'v1',apiCalled:true};
  const summary=summarize([{...base,status:'success',durationMs:20,usage:{promptTokens:100,cacheHitTokens:80,cacheMissTokens:20,completionTokens:12,reasoningTokens:10}}, {...base,status:'timeout',durationMs:30,fallback:true,applied:true},{...base,status:'forced',apiCalled:false}]);
  assert.equal(summary.apiCalls,2);assert.equal(summary.forced,1);assert.equal(summary.cacheHitRate,.8);assert.equal(summary.usage.promptTokens.unknownCalls,1);assert.equal(summary.usage.completionTokens.sum,12);assert.equal(summary.fallbacks,1);assert.equal(summary.p95LatencyMs,30);
});
