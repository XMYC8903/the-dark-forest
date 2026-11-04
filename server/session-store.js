import { logParts, readLog } from './private-logs.js';

async function gzipBase64(text) {
  const bytes = new TextEncoder().encode(text);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < packed.length; i += 0x8000)
    binary += String.fromCharCode(...packed.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function packSession(sessionText) {
  const key = 'dss:' + crypto.randomUUID();
  const parts = logParts(key, { text: await gzipBase64(sessionText) });
  return { writes: parts, ref: { key, parts: parts[key].parts } };
}

export async function readSession(storage, ref) {
  // Propagate all read/decompression errors: callers must never overwrite a
  // conversation they failed to load, even when the failure is transient.
  const packed = await readLog(storage, ref.key, ref);
  const binary = atob(packed.text);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

export async function dropSession(storage, ref) {
  const keys = Array.from({ length: ref.parts }, (_, i) => ref.key + ':part:' + i);
  keys.push(ref.key);
  for (const key of keys) await storage.delete(key);
}
