// post-build 钩子 — yarn build 之后跑.
//
// 为什么需要: vite 每次 build 都会从 source 重新生成 dist/index.html,
// 把我们 inject 的 <link>/<script> 抹掉. 这个脚本重新做一遍 inject,
// 同时确保 css/js 在 dist/game/ 里.
//
// character.json 不动 (yarn build 已经从 public/ copy 过去了).

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { installWebgalTheme } from '../src/adapter/install-theme.js';
import { installCharacterCard } from '../src/adapter/install-character-card.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await installWebgalTheme(PROJECT_ROOT);
await installCharacterCard(PROJECT_ROOT, null); // charData=null → 不覆盖 character.json
console.log('✅ post-build 注入完成');
