// DeepSeek conversations dominate a room's persisted size, so they are stored
// apart from the room blob, gzip-compressed, and only rewritten when a seat's
// conversation actually changed. The room blob keeps a small reference instead.
import {logParts,readLog} from './private-logs.js';

export const SESSION_PREFIX='dss:';

async function gzipBase64(text){
  const bytes=new TextEncoder().encode(text);
  const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const packed=new Uint8Array(await new Response(stream).arrayBuffer());
  let binary='';const step=0x8000;
  for(let i=0;i<packed.length;i+=step)binary+=String.fromCharCode(...packed.subarray(i,i+step));
  return btoa(binary);
}
async function gunzipBase64(base64){
  const binary=atob(base64),bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0));
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

/** Pack a seat map into a small reference plus its stored chunks. */
export async function packSessions(storage,revision,sessions){
  const key=SESSION_PREFIX+revision;
  const base64=await gzipBase64(JSON.stringify(sessions||{}));
  const parts=logParts(key,{text:base64});
  return {writes:parts,ref:{key,parts:parts[key].parts,bytes:base64.length}};
}
export async function readSessions(storage,ref){
  if(!ref?.key)return {};
  try{
    const packed=await readLog(storage,ref.key,{parts:ref.parts});
    return JSON.parse(await gunzipBase64(packed.text));
  }catch{
    // A damaged conversation must never block the room; the seat is rebuilt from
    // the public record by newDeepSeekSession on its next decision.
    return {};
  }
}
export async function dropSessions(storage,ref){
  if(!ref?.key)return;
  const keys=Array.from({length:ref.parts||0},(_,i)=>ref.key+':part:'+i);
  keys.push(ref.key);
  for(const key of keys)await storage.delete(key);
}
