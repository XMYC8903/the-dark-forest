import test from 'node:test';
import assert from 'node:assert/strict';
import {requestId} from '../dist/request-id.js';

test('使用浏览器原生 randomUUID 时沿用原生实现',()=>{
  assert.equal(requestId({randomUUID:()=> 'native-id'}),'native-id');
});

test('旧浏览器使用 getRandomValues 生成标准 UUID v4',()=>{
  const id=requestId({getRandomValues(bytes){bytes.fill(0);return bytes;}});
  assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('缺少 Web Crypto 时仍能生成格式正确的请求 ID',()=>{
  const id=requestId(undefined,()=>0.5);
  assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
