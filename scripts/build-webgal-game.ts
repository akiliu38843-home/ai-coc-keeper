// 把 Scenario JSON → WebGAL game 文件，落到 external/WebGAL/packages/webgal/public/game/scene/
// 这样浏览器刷新就能看到 galgame UI 渲染我们的剧本。
//
// 注意：覆盖 WebGAL 默认 start.txt。备份在 start.txt.original。

import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarioFromJson } from '../src/engine/scenario-validator.js';
import { buildScenarioGame } from '../src/adapter/webgal-script-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const WEBGAL_SCENE_DIR = join(
  PROJECT_ROOT,
  'external/WebGAL/packages/webgal/public/game/scene',
);

const args = process.argv.slice(2);
const scenarioPath = resolve(
  args[0] ?? join(PROJECT_ROOT, 'src/scenarios/library-demo.json'),
);

async function backupIfNeeded(path: string): Promise<void> {
  const backup = `${path}.original`;
  try {
    await access(backup);
    // backup 存在，跳过
  } catch {
    try {
      await access(path);
      await copyFile(path, backup);
      console.log(`📁 备份: ${path} → ${backup}`);
    } catch {
      // 原文件不存在，无需备份
    }
  }
}

async function main(): Promise<void> {
  console.log(`📖 加载 scenario: ${scenarioPath}`);
  const json = await readFile(scenarioPath, 'utf-8');
  const loaded = loadScenarioFromJson(json);
  if (!loaded.ok) {
    console.error('❌ Scenario 校验失败:');
    loaded.issues.forEach((i) => console.error(`   [${i.severity}] ${i.path}: ${i.message}`));
    process.exit(1);
  }
  const scenario = loaded.scenario;
  console.log(`   《${scenario.title}》· ${scenario.scenes.length} 场景`);

  const built = buildScenarioGame(scenario);

  // 备份 + 写入
  const startTxtPath = join(WEBGAL_SCENE_DIR, 'start.txt');
  await backupIfNeeded(startTxtPath);
  await writeFile(startTxtPath, built.startTxt, 'utf-8');
  console.log(`✏️  写入 ${startTxtPath}`);

  // 所有 scene 合一个 scenes.txt（label 区分）—— 但 WebGAL 默认从 start.txt 跳过去
  // 实际上 jumpLabel 在同文件内才工作，所以把 scenes 拼到 start.txt 后面
  const fullStart = `${built.startTxt}\n\n${built.sceneFiles.get('scenes')}`;
  await writeFile(startTxtPath, fullStart, 'utf-8');
  console.log(`✏️  拼入 ${scenario.scenes.length} 个 scene labels 到 start.txt`);

  console.log('\n✅ 完成');
  console.log('   现在去浏览器刷新 http://localhost:3000/ 看效果');
}

await main().catch((e: unknown) => {
  console.error('❌ 异常:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
