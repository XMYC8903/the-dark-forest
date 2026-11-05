import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../shared/game.js';
import { decideDeepSeek } from '../server/deepseek.js';
import { summarize } from '../scripts/summarize-deepseek.mjs';

test('metrics preserve usage even for truncated or invalid choices, without retaining content', async () => {
  for (const [content, reason, status] of [
    ['{"type":"end"}', 'stop', 'success'],
    ['{"type":"play","card":"不存在"}', 'stop', 'invalid_action'],
    ['incomplete', 'length', 'truncated'],
    ['not JSON', 'stop', 'invalid_action']
  ]) {
    const records = [];
    await decideDeepSeek(
      new Game({ count: 3 }),
      0,
      [],
      'secret',
      async () =>
        Response.json({
          choices: [
            { message: { content, reasoning_content: 'private thought' }, finish_reason: reason }
          ],
          usage: {
            prompt_tokens: 100,
            prompt_cache_hit_tokens: 80,
            prompt_cache_miss_tokens: 20,
            completion_tokens: 12,
            completion_tokens_details: { reasoning_tokens: 10 },
            total_tokens: 112
          }
        }),
      null,
      null,
      (e) => records.push(e)
    );
    assert.equal(records.length, 1);
    const record = records[0];
    assert.equal(record.status, status);
    const attempts = status === 'invalid_action' ? 2 : 1;
    assert.equal(record.attempts.length, attempts);
    assert.equal(record.usage.cacheHitTokens, 80 * attempts);
    assert.equal(record.usage.reasoningTokens, 10 * attempts);
    assert.ok(record.requestBytes > 0);
    assert.ok(record.messageCount > 0);
    for (const key of ['messages', 'content', 'reasoning_content', 'request', 'response', 'apiKey'])
      assert.equal(record[key], undefined);
  }
});

test('非法行动只重试一次，统计两次实际用量', async () => {
  let requests = 0;
  const metrics = [];
  const result = await decideDeepSeek(
    new Game({ count: 3 }),
    0,
    [],
    'secret',
    async () => {
      requests++;
      return Response.json({
        choices: [
          {
            message: {
              content: requests === 1 ? '{"type":"play","card":"不存在"}' : '{"type":"end"}'
            }
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      });
    },
    null,
    null,
    (value) => metrics.push(value)
  );
  assert.deepEqual(result, { type: 'end' });
  assert.equal(requests, 2);
  assert.equal(metrics[0].usage.promptTokens, 20);
  assert.equal(metrics[0].usage.completionTokens, 10);
  assert.equal(metrics[0].attempts[0].status, 'invalid_action');
  assert.equal(metrics[0].attempts[1].status, 'success');
  assert.equal(summarize([{ ...metrics[0], kind: 'deepseek', schemaVersion: 1 }]).apiCalls, 2);
});

test('forced decisions, timeouts, and failing metrics callbacks do not break play', async () => {
  const game = new Game({ count: 3 });
  game.pending = { kind: 'broadcast', caster: 0, decisions: [1, 2], responses: [] };
  const records = [];
  let requests = 0;
  assert.deepEqual(
    await decideDeepSeek(
      game,
      0,
      [],
      'secret',
      async () => {
        requests++;
      },
      null,
      null,
      (e) => records.push(e)
    ),
    { type: 'settle', chosen: null }
  );
  assert.equal(requests, 0);
  assert.equal(records[0].apiCalled, false);
  assert.equal(records[0].status, 'forced');
  await decideDeepSeek(
    new Game({ count: 3 }),
    0,
    [],
    'secret',
    async () => {
      throw Object.assign(new Error('private'), { name: 'AbortError' });
    },
    null,
    null,
    (e) => records.push(e)
  );
  assert.equal(records[1].status, 'timeout');
  assert.equal(records[1].usage, undefined);
  const action = await decideDeepSeek(
    new Game({ count: 3 }),
    0,
    [],
    'secret',
    async () => Response.json({ choices: [{ message: { content: '{"type":"end"}' } }] }),
    null,
    null,
    () => {
      throw Error('metrics unavailable');
    }
  );
  assert.ok(action);
});

test('返回的思考内容可单独记录，日志回调异常不影响决策', async () => {
  const thoughts = [];
  const fake = async () =>
    Response.json({
      choices: [
        { message: { content: '{"type":"end"}', reasoning_content: '先检查防御。\n再选择行动。' } }
      ]
    });
  const action = await decideDeepSeek(
    new Game({ count: 3 }),
    0,
    [],
    'secret',
    fake,
    null,
    null,
    null,
    {
      onReasoning: (value) => thoughts.push(value)
    }
  );
  assert.ok(action);
  assert.deepEqual(thoughts, ['先检查防御。\n再选择行动。']);
  assert.ok(
    await decideDeepSeek(new Game({ count: 3 }), 0, [], 'secret', fake, null, null, null, {
      onReasoning: () => {
        throw Error('storage failed');
      }
    })
  );
});

test('summary counts unknown usage separately and reasoning is not added to completion tokens', () => {
  const base = {
    kind: 'deepseek',
    schemaVersion: 1,
    phase: 'turn',
    promptVersion: 'v1',
    apiCalled: true
  };
  const summary = summarize([
    {
      ...base,
      status: 'success',
      durationMs: 20,
      usage: {
        promptTokens: 100,
        cacheHitTokens: 80,
        cacheMissTokens: 20,
        completionTokens: 12,
        reasoningTokens: 10
      }
    },
    { ...base, status: 'timeout', durationMs: 30, fallback: true, applied: true },
    { ...base, status: 'forced', apiCalled: false }
  ]);
  assert.equal(summary.apiCalls, 2);
  assert.equal(summary.forced, 1);
  assert.equal(summary.cacheHitRate, 0.8);
  assert.equal(summary.usage.promptTokens.unknownCalls, 1);
  assert.equal(summary.usage.completionTokens.sum, 12);
  assert.equal(summary.fallbacks, 1);
  assert.equal(summary.p95LatencyMs, 30);
});
