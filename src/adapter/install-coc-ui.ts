// install-coc-ui.ts
//
// ⚠️ B 路重构 (2026-06): coc-ui 已搬进 WebGAL 内部 React 组件 (Stage/CocUI/),
// 这个文件保留但不再被调用 (post-build / build-launcher / build-test 都已注释).
// 留底为了将来万一回退到外挂方案.
//
// 把 assets/coc-ui/{css,js} 注入到 WebGAL dist/public.
// 跟 install-character-card.ts 同一套路: 拷文件 + 在 dist/index.html 末尾追加 link + script.
//
// 注入顺序要求 (来自前端 README):
//   <link rel="stylesheet" href="game/character-card.css">
//   <link rel="stylesheet" href="game/coc-ui.css">         ← coc-ui CSS 在 character-card 之后
//   <script src="game/character-card.js"></script>
//   <script src="game/coc-ui.js"></script>                  ← coc-ui JS 在 character-card 之后
//
// install-character-card 先跑, 注入它的 2 行;  installCocUi 在 character-card 注入块之后再追加 2 行.

import { copyFile, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const INJECTION_MARKER = '<!-- ai-coc-keeper · coc-ui injected -->';

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function installCocUi(projectRoot: string): Promise<void> {
  const srcCss = join(projectRoot, 'assets/coc-ui/coc-ui.css');
  const srcJs  = join(projectRoot, 'assets/coc-ui/coc-ui.js');
  const publicGame = join(projectRoot, 'external/WebGAL/packages/webgal/public/game');
  const distGame   = join(projectRoot, 'external/WebGAL/packages/webgal/dist/game');
  const distHtml   = join(projectRoot, 'external/WebGAL/packages/webgal/dist/index.html');

  if (!await fileExists(srcCss) || !await fileExists(srcJs)) {
    console.warn(`⚠️  coc-ui 源文件缺失: ${srcCss}`);
    return;
  }

  await copyFile(srcCss, join(publicGame, 'coc-ui.css'));
  await copyFile(srcJs,  join(publicGame, 'coc-ui.js'));

  const distExists = await fileExists(join(projectRoot, 'external/WebGAL/packages/webgal/dist'));
  if (distExists) {
    await copyFile(srcCss, join(distGame, 'coc-ui.css'));
    await copyFile(srcJs,  join(distGame, 'coc-ui.js'));
  }

  if (await fileExists(distHtml)) {
    let html = await readFile(distHtml, 'utf-8');
    if (!html.includes(INJECTION_MARKER)) {
      const insertion = [
        `\n${INJECTION_MARKER}`,
        `<link rel="stylesheet" href="/game/coc-ui.css">`,
        `<script src="/game/coc-ui.js" defer></script>\n`,
      ].join('\n');
      html = html.replace('</body>', `${insertion}</body>`);
      await writeFile(distHtml, html, 'utf-8');
      console.log(`🩸 coc-ui 已注入 dist/index.html`);
    } else {
      console.log(`🩸 coc-ui dist/index.html 已含注入 (跳过)`);
    }
  }

  console.log(`🩸 coc-ui 资源 已写入 public/game/ ${distExists ? '+ dist/game/' : ''}`);
}
