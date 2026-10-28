import fs from 'node:fs';
const base=process.env.GAME_URL||'https://xmyc.dpdns.org';
const token=process.env.ADMIN_LOG_TOKEN||fs.readFileSync(new URL('../.secrets/ADMIN_LOG_TOKEN',import.meta.url),'utf8').trim();
const [room,match,kind='game']=process.argv.slice(2);
async function get(path){const r=await fetch(base+path,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('后台日志读取失败：'+r.status);return r.json();}
if(!room){console.log(JSON.stringify(await get('/api/admin/logs'),null,2));process.exit(0);}
if(!/^[A-Za-z0-9]{6,8}$/.test(room))throw Error('房间码无效');
if(!['game','deepseek'].includes(kind))throw Error('日志类型应为 game 或 deepseek');
let cursor='',entries=[],matchId=match;
do{const query=new URLSearchParams({kind,...(match?{match}:{}),...(cursor?{cursor}:{})});const data=await get('/api/admin/logs/'+room+'?'+query);entries.push(...data.entries);cursor=data.nextCursor;matchId=data.matchId;}while(cursor);
fs.mkdirSync('artifacts/private-logs',{recursive:true});
const file='artifacts/private-logs/'+room+'-'+matchId+'-'+kind+'.json';
fs.writeFileSync(file,JSON.stringify({room,matchId,kind,entries},null,2),{mode:0o600});console.log('已导出 '+entries.length+' 条日志：'+file);
