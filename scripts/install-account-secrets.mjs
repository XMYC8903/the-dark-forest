import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const cli='node_modules/wrangler/bin/wrangler.js';
const list=spawnSync(process.execPath,[cli,'secret','list'],{encoding:'utf8'});
if(list.status!==0)throw Error('无法读取 Cloudflare 密钥名称，请先登录 Wrangler');
const names=new Set(JSON.parse(list.stdout).map(s=>s.name));
for(const name of ['AUTH_PEPPER','ADMIN_LOG_TOKEN']){
  if(names.has(name)){console.log(name+' 已存在，保留现有值');continue;}
  const value=fs.readFileSync('.secrets/'+name,'utf8').trim();if(!/^[a-f0-9]{64}$/.test(value))throw Error('本地密钥格式异常');
  const result=spawnSync(process.execPath,[cli,'secret','put',name],{input:value+'\n',encoding:'utf8'});
  if(result.status!==0)throw Error('Cloudflare 密钥配置失败：'+name+'\n'+result.stderr);
  console.log(name+' 已配置（不输出密钥值）');
}
