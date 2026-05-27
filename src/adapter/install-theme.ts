import { copyFile, access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 把 assets/webgal-theme/userStyleSheet.css 拷到 WebGAL public/game/.
 * WebGAL 启动时通过 initializeScript.ts 自动加载该文件, 实现深色主题.
 *
 * 在 gen:ai-game / build:launcher 落盘时一并执行.
 */
export async function installWebgalTheme(projectRoot: string): Promise<void> {
  const src = join(projectRoot, 'assets/webgal-theme/userStyleSheet.css');
  const dst = join(projectRoot, 'external/WebGAL/packages/webgal/public/game/userStyleSheet.css');
  try { await access(src); }
  catch { console.warn(`⚠️  主题文件不存在: ${src}`); return; }
  await copyFile(src, dst);
  console.log(`🎨 主题已注入 → public/game/userStyleSheet.css`);
}
