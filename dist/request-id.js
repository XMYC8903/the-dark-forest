export function requestId(cryptoApi=globalThis.crypto,random=Math.random){
  if(typeof cryptoApi?.randomUUID==='function')return cryptoApi.randomUUID();
  const bytes=new Uint8Array(16);
  try{
    if(typeof cryptoApi?.getRandomValues==='function')cryptoApi.getRandomValues(bytes);
    else throw Error('secure random source unavailable');
  }catch{
    for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(random()*256);
  }
  bytes[6]=(bytes[6]&15)|64;
  bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
