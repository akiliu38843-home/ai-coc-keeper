// 多剧本启动选择器
//
// 跑法: npm run build:launcher
// 行为:
//   1. 扫 src/scenarios/*.json
//   2. 每个 scenario 用 labelPrefix 隔离 (避免 label 冲突)
//   3. 生成统一 start.txt: 启动页 choose 菜单 + 各 scenario sections
//
// 不调 LLM, 各 scenario 用原文 description (没 AI 改编).
// 想要 AI 叙事的话, 跑 npm run gen:ai-game <scenario>.json 单独跑.

import { readFile, writeFile, copyFile, access, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarioFromJson } from '../src/engine/scenario-validator.js';
import { buildScenarioGame, truncateChoiceLabel } from '../src/adapter/webgal-script-builder.js';
import { updateWebGalConfig } from '../src/adapter/webgal-config.js';
import { installWebgalTheme } from '../src/adapter/install-theme.js';
import { listCharacters, loadCharacter } from '../src/character/save-load.js';
import type { Character } from '../src/types/character.js';
import type { Scenario } from '../src/types/scenario.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SCENARIOS_DIR = join(PROJECT_ROOT, 'src/scenarios');
const WEBGAL_SCENE_DIR = join(
  PROJECT_ROOT,
  'external/WebGAL/packages/webgal/public/game/scene',
);

async function backupIfNeeded(path: string): Promise<void> {
  const backup = `${path}.original`;
  try { await access(backup); } catch {
    try { await access(path); await copyFile(path, backup); console.log(`📁 备份 → ${backup}`); }
    catch { /* */ }
  }
}

function escapeForWebgal(text: string): string {
  return text.replace(/;/g, '；').replace(/:/g, '：').replace(/\|/g, '｜').replace(/\r/g, '').replace(/\n/g, ' ');
}

async function loadFirstCharacter(): Promise<Character | undefined> {
  try {
    const list = await listCharacters();
    if (list.length === 0) return undefined;
    return await loadCharacter(list[0]!.id);
  } catch { return undefined; }
}

async function main(): Promise<void> {
  console.log(`📂 扫 ${SCENARIOS_DIR}`);
  const files = (await readdir(SCENARIOS_DIR)).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('❌ src/scenarios/ 下没有 .json 剧本');
    process.exit(1);
  }
  const scenarios: Scenario[] = [];
  for (const f of files) {
    const json = await readFile(join(SCENARIOS_DIR, f), 'utf-8');
    const r = loadScenarioFromJson(json);
    if (!r.ok) {
      console.warn(`⚠ ${f} 校验失败, 跳过`);
      continue;
    }
    scenarios.push(r.scenario);
    console.log(`   ✓ ${f}: 《${r.scenario.title}》 ${r.scenario.scenes.length} scene`);
  }

  // 加载第一个 character (intro 显示用)
  const char = await loadFirstCharacter();

  // 拼 launcher start.txt
  const lines: string[] = [
    ';=========================================',
    ';  ai-coc-keeper · 多剧本启动选择器',
    ';=========================================',
    `setVar:launcherMode=true;`,
    `label:_launcher;`,
    `旁白:${escapeForWebgal('选择一本剧本')} -fontSize=large;`,
  ];

  if (char) {
    lines.push(`旁白:${escapeForWebgal(`扮演 —— ${char.name}（${char.occupation}, ${char.age} 岁）  HP ${char.maxHp}  心智 ${char.maxSanity}  幸运 ${char.luck}`)};`);
  }

  // 把每本剧本的副标题作为 narrate 提前展示, 玩家先读到 setting 再做选择,
  // 而 choose 按钮本身保持极简 (只放 "《标题》" 不带描述).
  scenarios.forEach((s, i) => {
    lines.push(`旁白:${escapeForWebgal(`${i + 1}. 《${s.title}》 — ${s.setting}`)};`);
  });

  // 启动 choose: 每本剧本一项, 跳到 <scenarioId>__<startSceneId>
  // WebGAL choose 按钮单行宽度有限, label 总长收紧到 ≤ 18 字 (Latin 字符更占位).
  const choiceParts = scenarios.map((s) => {
    const label = buildChoiceLabel(s.title);
    return `${escapeForWebgal(label)}:${s.id}__${s.startSceneId}`;
  });
  lines.push(`choose:${choiceParts.join('|')};`);
  lines.push('');

  // 每个 scenario 的内容 (labelPrefix 隔离)
  // launcher 模式没有 char state tracking, 但仍然要给玩家一张"你完成了 X"的结局卡,
  // 不能让最后一个 scene 直接弹回菜单 (太突兀).
  // 流程: terminal scene → "结束这段旅程" 按钮 → <id>__recap → "回剧本选择" → _launcher
  for (const s of scenarios) {
    lines.push(`;------ ${s.title} ------`);
    const recapLabel = `${s.id}__recap`;
    const baseOpts = {
      labelPrefix: s.id,
      terminalExit: { buttonLabel: '结束这段旅程', target: recapLabel },
    };
    const opts = char ? { ...baseOpts, character: char } : baseOpts;
    const built = buildScenarioGame(s, new Map(), new Map(), new Map(), opts);
    lines.push(built.sceneFiles.get('scenes') ?? '');
    // 每剧本的简版 recap.
    // ★ 一张 intro 多行卡 (用 | 分隔), 一次性把 4 行依次淡入显示, 不切到底部文字框.
    // 之前用 "intro 1 行 + 旁白 N 行" 两段式, 实测用户卡在 intro 后, 看不到旁白接力.
    const sceneList = s.scenes.slice(0, 6).map((sc) => sc.name).join(' → ');
    const introLines = [
      '你的旅程',
      `你走完了 《${s.title}》`,
      `走过：${sceneList}`,
      '你回来了。',
    ];
    // intro 自带 | 做分隔符, 内容里不能含 | (这里是我们自己写的, 控)
    const introContent = introLines.map(escapeForWebgal).join('|');
    lines.push('');
    lines.push(`;------ recap: ${s.title} ------`);
    lines.push(`label:${recapLabel};`);
    lines.push(`intro:${introContent} -animation=fadeIn -fontColor=rgba(216, 201, 166, 1) -fontSize=medium -delayTime=2200;`);
    lines.push(`choose:回剧本选择:_launcher;`);
    lines.push('');
  }

  // 落盘
  const startTxtPath = join(WEBGAL_SCENE_DIR, 'start.txt');
  await backupIfNeeded(startTxtPath);
  await writeFile(startTxtPath, lines.join('\n'), 'utf-8');
  console.log(`\n✏️  写入 ${startTxtPath}`);
  console.log(`   ${scenarios.length} 个剧本 · ${lines.join('\n').length} 字符`);

  // config.txt 改成 launcher 标题
  const configPath = join(WEBGAL_SCENE_DIR, '..', 'config.txt');
  await backupIfNeeded(configPath);
  await updateWebGalConfig(configPath, { gameName: 'ai-coc-keeper · 单人本平台' });

  await installWebgalTheme(PROJECT_ROOT);

  console.log(`\n✅ 完成 · 浏览器刷新看启动选择器`);
}

// 注意: buildScenarioGame 还不支持 labelPrefix 在 startTxt 里, 这里先用 sceneFiles 拼.
// 一个限制: intro 段会在每个 scenario 的 startTxt 里, 但我们只用 sceneFiles, 所以 intro 丢了.
// 折衷: launcher 自己显示玩家角色信息, 不再每剧本重复 intro.

/**
 * 把 scenario 标题做成 WebGAL choose 按钮 label.
 * 实际 truncate 走 truncateChoiceLabel (18 字硬限), 详细 setting 放在 narrate 里展示.
 */
function buildChoiceLabel(title: string): string {
  return truncateChoiceLabel(`《${title}》`);
}

await main().catch((e: unknown) => {
  console.error('❌', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
