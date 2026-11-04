import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function summarize(entries, groups = true) {
  const records = entries.filter((e) => e.kind === 'deepseek' && e.schemaVersion === 1),
    calls = records.filter((e) => e.apiCalled),
    statuses = {},
    usage = {};
  for (const row of records) statuses[row.status] = (statuses[row.status] || 0) + 1;
  for (const field of [
    'promptTokens',
    'cacheHitTokens',
    'cacheMissTokens',
    'completionTokens',
    'reasoningTokens',
    'totalTokens'
  ]) {
    const known = calls.map((e) => e.usage?.[field]).filter(Number.isSafeInteger);
    usage[field] = {
      sum: known.reduce((n, v) => n + v, 0),
      knownCalls: known.length,
      unknownCalls: calls.length - known.length
    };
  }
  const paired = calls.filter(
    (e) =>
      Number.isSafeInteger(e.usage?.cacheHitTokens) &&
      Number.isSafeInteger(e.usage?.cacheMissTokens)
  );
  const hit = paired.reduce((n, e) => n + e.usage.cacheHitTokens, 0),
    miss = paired.reduce((n, e) => n + e.usage.cacheMissTokens, 0);
  const latency = calls
    .map((e) => e.durationMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const result = {
    decisions: records.length,
    apiCalls: calls.length,
    forced: statuses.forced || 0,
    statuses,
    fallbacks: records.filter((e) => e.fallback === true).length,
    notApplied: records.filter((e) => e.applied === false).length,
    usage,
    cacheHitRate: hit + miss ? hit / (hit + miss) : null,
    cacheRateKnownCalls: paired.length,
    averageLatencyMs: latency.length ? latency.reduce((n, v) => n + v, 0) / latency.length : null,
    p95LatencyMs: latency.length ? latency[Math.ceil(latency.length * 0.95) - 1] : null,
    requestBytes: calls.reduce((n, e) => n + (e.requestBytes || 0), 0)
  };
  if (groups)
    for (const field of ['phase', 'promptVersion'])
      result['by_' + field] = Object.fromEntries(
        [...new Set(records.map((e) => e[field] || 'unknown'))].map((value) => [
          value,
          summarize(
            records.filter((e) => (e[field] || 'unknown') === value),
            false
          )
        ])
      );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (!files.length) throw Error('请提供导出的 DeepSeek JSON 日志文件，可指定多个文件');
  const entries = files.flatMap((file) => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : data.entries || [];
  });
  // Overlapping exports must not count the same decision twice.
  const unique = new Map();
  for (const e of entries) unique.set(JSON.stringify([e.matchId, e.revision, e.player, e.at]), e);
  console.log(JSON.stringify(summarize([...unique.values()]), null, 2));
}
