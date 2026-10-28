// Each chunk remains below Durable Object's per-value byte limit even with CJK.
export function logParts(prefix,data){
  const text=JSON.stringify(data),parts={};let count=0;
  for(let i=0;i<text.length;i+=16000)parts[prefix+':part:'+count++]=text.slice(i,i+16000);
  parts[prefix]={parts:count,at:data.at||Date.now(),kind:data.kind,matchId:data.matchId};return parts;
}
export async function readLog(storage,key,meta){
  const keys=Array.from({length:meta.parts},(_,i)=>key+':part:'+i),values=await storage.get(keys);
  return JSON.parse(keys.map(k=>values.get(k)||'').join(''));
}
export async function putRecords(storage,records){
  const entries=Object.entries(records);for(let i=0;i<entries.length;i+=100)await storage.put(Object.fromEntries(entries.slice(i,i+100)));
}
