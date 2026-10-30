export default [
  {ignores:['node_modules/**','dist/game.js','artifacts/**','.wrangler/**']},
  {files:['server/**/*.js','shared/**/*.js','dist/**/*.js','scripts/**/*.mjs','test/**/*.mjs','serve.mjs'],languageOptions:{ecmaVersion:'latest',sourceType:'module'},rules:{'no-dupe-keys':'error','no-duplicate-case':'error','no-unreachable':'error','no-constant-binary-expression':'error'}},
  {files:['dist/app.js'],languageOptions:{globals:Object.fromEntries(['document','window','matchMedia','setTimeout','clearTimeout','requestAnimationFrame','cancelAnimationFrame','CustomEvent','structuredClone','queueMicrotask','localStorage','crypto','navigator','performance','innerWidth','innerHeight'].map(name=>[name,'readonly']))},rules:{'no-undef':'error'}}
];
