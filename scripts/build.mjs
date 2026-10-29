import {copyFile, readFile} from 'node:fs/promises';
const source=new URL('../shared/game.js',import.meta.url);
const output=new URL('../dist/game.js',import.meta.url);
if(process.argv.includes('--check')){
  const [a,b]=await Promise.all([readFile(source),readFile(output)]);
  if(!a.equals(b))throw new Error('dist/game.js 已过期，请运行 pnpm build 并提交生成文件');
}else await copyFile(source,output);
