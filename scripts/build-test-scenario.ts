// CLI: 把一个手写的 scenario JSON 直接 build 成 WebGAL game, 不走 LLM
//
// 用于:
//   - 手写完 kohaku.v2.scenario.json 后, 想立刻看 flag/分支/ending router 是否正确工作
//   - 跳过 gen:ai-game 的 LLM 调用 (省钱 + 省时)
//   - 用 scene.description (或 originalText 前 200 字) 作为占位 narrate, 玩起来不漂亮但能验证 routing
//
// 跑法: npm run build:test <scenario-path>
// 例:   npm run build:test .test-scenarios/csc-kohaku/kohaku.v2.scenario.json

import { readFile, writeFile, access, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarioFromJson } from '../src/engine/scenario-validator.js';
import { buildScenarioGame } from '../src/adapter/webgal-script-builder.js';
import { updateWebGalConfig } from '../src/adapter/webgal-config.js';
import { installWebgalTheme } from '../src/adapter/install-theme.js';
import { installCharacterCard, buildCharacterCardData } from '../src/adapter/install-character-card.js';
// B 路: coc-ui 已搬进 WebGAL 内部组件, 不再外挂
// import { installCocUi } from '../src/adapter/install-coc-ui.js';
import { recomputeDerivedStats } from '../src/types/character.js';
import type { Character } from '../src/types/character.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const WEBGAL_SCENE_DIR = join(
  PROJECT_ROOT,
  'external/WebGAL/packages/webgal/public/game/scene',
);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法: npm run build:test <scenario-path>');
  process.exit(1);
}

const scenarioPath = resolve(args[0]!);

async function backupIfNeeded(path: string): Promise<void> {
  const backup = `${path}.original`;
  try { await access(backup); } catch {
    try { await access(path); await copyFile(path, backup); }
    catch {}
  }
}

function makeDefaultChar(): Character {
  const c: Character = {
    id: 'test-char',
    name: '林夏',
    occupation: '记者',
    age: 28,
    gender: '女',
    luck: 40,
    attributes: {
      STR: 60, CON: 60, SIZ: 60, DEX: 60,
      APP: 60, INT: 80, POW: 60, EDU: 80,
    },
    maxHp: 0, currentHp: 0,
    maxMp: 0, currentMp: 0,
    maxSanity: 0, currentSanity: 0,
    movement: 0, dodge: 0, brawl: 0,
    skills: new Map([
      ['language_own', { key: 'language_own', name: '母语', base: 0, occupational: 80, personal: 0 }],
      ['spot_hidden',  { key: 'spot_hidden',  name: '侦查', base: 25, occupational: 40, personal: 0 }],
      ['library_use',  { key: 'library_use',  name: '图书馆使用', base: 20, occupational: 40, personal: 0 }],
      ['psychology',   { key: 'psychology',   name: '心理学', base: 10, occupational: 40, personal: 0 }],
      ['persuade',     { key: 'persuade',     name: '说服', base: 10, occupational: 40, personal: 0 }],
      ['listen',       { key: 'listen',       name: '聆听', base: 20, occupational: 25, personal: 0 }],
      ['brawl',        { key: 'brawl',        name: '格斗', base: 25, occupational: 35, personal: 0 }],
      ['dodge',        { key: 'dodge',        name: '闪避', base: 30, occupational: 0, personal: 0 }],
      ['first_aid',    { key: 'first_aid',    name: '急救', base: 30, occupational: 0, personal: 0 }],
      ['computer_use', { key: 'computer_use', name: '计算机使用', base: 5, occupational: 40, personal: 0 }],
    ]),
    inventory: [],
    conditions: [],
  };
  recomputeDerivedStats(c);
  c.currentHp = c.maxHp;
  c.currentMp = c.maxMp;
  c.currentSanity = c.maxSanity;
  return c;
}

async function main() {
  console.log(`📖 加载 scenario: ${scenarioPath}`);
  const json = await readFile(scenarioPath, 'utf-8');
  const loaded = loadScenarioFromJson(json);
  if (!loaded.ok) {
    console.error('❌ 校验失败:');
    loaded.issues.forEach((i) => console.error(`   ${i.path}: ${i.message}`));
    process.exit(1);
  }
  const scenario = loaded.scenario;
  console.log(`   《${scenario.title}》 · ${scenario.scenes.length} 场景 · ${scenario.endings?.length ?? 0} 结局\n`);

  const char = makeDefaultChar();
  console.log(`👤 测试角色: ${char.name} (${char.occupation}, HP ${char.maxHp}, 心智 ${char.maxSanity})\n`);

  // perSceneEndState (起始值, 死亡判定起作用)
  const perSceneEndState = new Map();
  for (const s of scenario.scenes) {
    perSceneEndState.set(s.id, {
      currentHp: char.currentHp,
      currentSanity: char.currentSanity,
      maxHp: char.maxHp,
      maxSanity: char.maxSanity,
    });
  }

  // V3 探索动作: 用作者手写的 scene.inSceneActions.
  // 没写就不塞 -- builder 会走单层 choose 模式 (纯导航 hub 适合这样).
  const perSceneInScene = new Map<string, Array<{ label: string; resultNarrate: string; sets?: Record<string, boolean | number | string> }>>();
  for (const s of scenario.scenes) {
    const authored = s.inSceneActions;
    if (authored && authored.length > 0) {
      perSceneInScene.set(s.id, authored.map((a) => ({
        label: a.label,
        resultNarrate: a.resultNarrate,
        ...(a.sets ? { sets: a.sets } : {}),
      })));
    }
  }

  const built = buildScenarioGame(scenario, new Map(), new Map(), perSceneInScene, {
    character: char,
    terminalExit: { buttonLabel: '结束这段旅程', target: 'journey_recap' },
    perSceneEndState,
  });

  const configPath = join(WEBGAL_SCENE_DIR, '..', 'config.txt');
  await backupIfNeeded(configPath);
  await updateWebGalConfig(configPath, { gameName: scenario.title });

  const startTxtPath = join(WEBGAL_SCENE_DIR, 'start.txt');
  await backupIfNeeded(startTxtPath);
  const fullContent = `${built.startTxt}\n\n${built.sceneFiles.get('scenes')}`;
  await writeFile(startTxtPath, fullContent, 'utf-8');
  console.log(`✏️  写入 ${startTxtPath}`);
  console.log(`   ${fullContent.length} 字符\n`);

  await installWebgalTheme(PROJECT_ROOT);
  await installCharacterCard(PROJECT_ROOT, buildCharacterCardData(char));
  // await installCocUi(PROJECT_ROOT);  // B 路

  console.log(`\n✅ 完成 · 跑 npm run build:dist 或 cd external/WebGAL && yarn build 看效果`);
}

await main().catch((e: unknown) => {
  console.error('❌ 异常:', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
