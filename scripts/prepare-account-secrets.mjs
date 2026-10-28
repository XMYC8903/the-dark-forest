import fs from 'node:fs';
import crypto from 'node:crypto';
fs.mkdirSync('.secrets',{recursive:true});
let vars=fs.existsSync('.dev.vars')?fs.readFileSync('.dev.vars','utf8'):'';
for(const name of ['AUTH_PEPPER','ADMIN_LOG_TOKEN']){
  const file='.secrets/'+name;
  if(!fs.existsSync(file))fs.writeFileSync(file,crypto.randomBytes(32).toString('hex'),{mode:0o600});
  if(!new RegExp('^'+name+'=','m').test(vars))vars+='\n'+name+'='+fs.readFileSync(file,'utf8').trim()+'\n';
}
fs.writeFileSync('.dev.vars',vars,{mode:0o600});
console.log('Account secrets prepared locally; secret values are not printed.');
