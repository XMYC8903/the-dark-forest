import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{GameRoom} from '../server/worker.js';

test('DeepSeek cleanup paginates and deletes only dedicated DeepSeek audit keys',async()=>{
  const match='12345678-1234-1234-1234-123456789abc',data=new Map();
  for(let i=0;i<220;i++)data.set(`audit:${match}:deepseek:${String(i).padStart(4,'0')}`,{private:true});
  for(let i=0;i<150;i++)data.set(`audit:${match}:game:${String(i).padStart(4,'0')}`,{game:true});
  data.set('room',{preserve:true});data.set('audit:not-a-match:deepseek:0',{preserve:true});
  const storage={
    async get(key){return key==='room'?null:data.get(key);},
    async list({prefix,startAfter='',limit}){return new Map([...data].filter(([key])=>key.startsWith(prefix)&&key>startAfter).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit));},
    async delete(keys){for(const key of keys)data.delete(key);}
  };
  const jobs=[],ctx={storage,blockConcurrencyWhile(fn){const job=fn();jobs.push(job);return job;}};
  const room=new GameRoom(ctx,{});await jobs[0];
  const scan=async method=>{let cursor='',found=0,deleted=0,pages=0;do{
    const url=new URL('https://internal/internal/deepseek-cleanup');if(cursor)url.searchParams.set('cursor',cursor);
    const response=await room.fetch(new Request(url,{method}));assert.equal(response.status,200);
    const page=await response.json();found+=page.matched;deleted+=page.deleted;cursor=page.nextCursor||'';pages++;
  }while(cursor);return {found,deleted,pages};};
  const preview=await scan('GET');assert.equal(preview.found,220);assert.equal(preview.deleted,0);assert.ok(preview.pages>2);
  const result=await scan('DELETE');assert.equal(result.deleted,220);
  assert.equal((await scan('GET')).found,0);
  assert.equal([...data.keys()].filter(key=>key.includes(':game:')).length,150);
  assert.equal(data.has('room'),true);assert.equal(data.has('audit:not-a-match:deepseek:0'),true);
});

test('cleanup endpoint requires the administrator token and valid object identifier',async()=>{
  const object='a'.repeat(64),calls=[];
  const env={ADMIN_LOG_TOKEN:'secret',ROOMS:{idFromString:id=>id,get:id=>({fetch:request=>{calls.push({id,method:request.method});return Response.json({ok:true});}})}};
  const url=`https://example.com/api/admin/deepseek-cleanup/${object}`;
  assert.equal((await worker.fetch(new Request(url,{method:'DELETE'}),env)).status,403);
  assert.equal((await worker.fetch(new Request(url,{method:'POST',headers:{Authorization:'Bearer secret'}}),env)).status,405);
  assert.equal((await worker.fetch(new Request(url,{method:'DELETE',headers:{Authorization:'Bearer secret'}}),env)).status,200);
  assert.deepEqual(calls,[{id:object,method:'DELETE'}]);
});
