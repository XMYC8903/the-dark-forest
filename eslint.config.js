export default [
  {ignores:['node_modules/**','dist/game.js','artifacts/**','.wrangler/**']},
  {files:['server/**/*.js','shared/**/*.js','dist/**/*.js','scripts/**/*.mjs','test/**/*.mjs','serve.mjs'],languageOptions:{ecmaVersion:'latest',sourceType:'module'},rules:{'no-dupe-keys':'error','no-duplicate-case':'error','no-unreachable':'error','no-constant-binary-expression':'error'}}
];
