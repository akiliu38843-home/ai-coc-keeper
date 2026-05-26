// 生成 AI 叙事版 WebGAL game
//
// 跟 build-webgal-game.ts 区别：
//   - build-webgal-game: scenario JSON 原描述直接进 WebGAL（无 LLM）
//   - generate-ai-game:  跑 LLM 给每个 scene 写 narrate，预生成嵌入到 WebGAL
//
// 用法：npm run gen:ai-game [<scenario.json>]
// 默认 scenario：src/scenarios/library-demo.json

import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarioFromJson } from '../src/engine/scenario-validator.js';
import { buildScenarioGame } from '../src/adapter/webgal-script-builder.js';
import { OpenAICompatibleProvider } from '../src/llm/openai-compatible.js';
import { LlmAdapter, type LlmAction } from '../src/llm/adapter.js';
import { InMemoryNarrativeState } from '../src/engine/in-memory-narrative-state.js';
import { recomputeDerivedStats } from '../src/types/character.js';
import type { Character } from '../src/types/character.js';

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

const baseUrl = process.env['LLM_BASE_URL'];
const apiKey = process.env['LLM_API_KEY'];
const model = process.env['LLM_MODEL'] ?? 'gpt-5.4-mini';
if (!baseUrl || !apiKey) {
  console.error('❌ 缺 LLM_BASE_URL / LLM_API_KEY');
  process.exit(1);
}

function makeChar(): Character {
  const c: Character = {
    id: 'demo', name: '林夏', occupation: '记者', age: 28,
    attributes: { STR: 50, DEX: 60, INT: 80, CON: 60, POW: 70, APP: 60, SIZ: 55, EDU: 80 },
    maxHp: 0, maxMp: 0, maxSanity: 0,
    currentHp: 0, currentMp: 0, currentSanity: 0,
    luck: 60, movement: 0, dodge: 0, brawl: 0,
    skills: new Map(), inventory: [], conditions: [],
  };
  recomputeDerivedStats(c);
  c.currentHp = c.maxHp; c.currentMp = c.maxMp; c.currentSanity = c.maxSanity;
  return c;
}

async function backupIfNeeded(path: string): Promise<void> {
  const backup = `${path}.original`;
  try { await access(backup); } catch {
    try { await access(path); await copyFile(path, backup); console.log(`📁 备份 → ${backup}`); }
    catch { /* nothing to backup */ }
  }
}

async function main(): Promise<void> {
  console.log(`📖 加载 scenario: ${scenarioPath}`);
  const json = await readFile(scenarioPath, 'utf-8');
  const loaded = loadScenarioFromJson(json);
  if (!loaded.ok) {
    console.error('❌ Scenario 校验失败:');
    loaded.issues.forEach((i) => console.error(`   ${i.path}: ${i.message}`));
    process.exit(1);
  }
  const scenario = loaded.scenario;
  console.log(`   《${scenario.title}》 · ${scenario.scenes.length} 场景\n`);

  const provider = new OpenAICompatibleProvider({
    baseUrl: baseUrl!, apiKey: apiKey!, model, timeoutMs: 60_000,
  });
  const char = makeChar();
  const perSceneActions = new Map<string, LlmAction[]>();

  // 每个 scene 跑一次 LLM 拿场景描述
  for (let i = 0; i < scenario.scenes.length; i++) {
    const scene = scenario.scenes[i]!;
    console.log(`[${i + 1}/${scenario.scenes.length}] LLM 叙事: ${scene.id} · ${scene.name}`);
    // 每个 scene 用独立 LlmAdapter 实例，避免 history 互相污染
    const adapter = new LlmAdapter({ provider });
    const ns = new InMemoryNarrativeState({ startSceneId: scene.id });

    try {
      const action = await adapter.enterScene({
        scenario: { id: scenario.id, title: scenario.title, setting: scenario.setting },
        scene: {
          id: scene.id,
          name: scene.name,
          description: scene.description,
          hints: scene.hints ?? [],
          expectedChecks: (scene.expectedChecks ?? []).map((c) => ({
            skill: c.skill, difficulty: c.difficulty, reason: c.reason,
          })),
        },
        character: char,
        narrative: ns,
      });
      // 只取 narrate / dialogue 的 LLM 结果（其它类型 V0 不用）
      const actions: LlmAction[] = [];
      if (action.type === 'narrate' || action.type === 'dialogue') {
        actions.push(action);
      } else {
        // 其它类型如 request_check / jump_scene 也 keep, builder 自动处理
        actions.push(action);
      }
      perSceneActions.set(scene.id, actions);
      console.log(`    ✓ ${action.type} (${(action.text ?? '').slice(0, 40)}...)`);
    } catch (e) {
      console.warn(`    ⚠ LLM 失败, 回退原描述: ${(e as Error).message.slice(0, 80)}`);
    }

    // 节流防 rate-limit
    if (i < scenario.scenes.length - 1) await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n🔨 构建 WebGAL game...`);
  const built = buildScenarioGame(scenario, perSceneActions);

  const startTxtPath = join(WEBGAL_SCENE_DIR, 'start.txt');
  await backupIfNeeded(startTxtPath);
  const fullContent = `${built.startTxt}\n\n${built.sceneFiles.get('scenes')}`;
  await writeFile(startTxtPath, fullContent, 'utf-8');
  console.log(`✏️  写入 ${startTxtPath}`);
  console.log(`   ${fullContent.length} 字符 · ${perSceneActions.size}/${scenario.scenes.length} 场景含 AI 叙事`);
  console.log(`\n✅ 完成 · 浏览器刷新 http://localhost:3000/ 看效果`);
}

await main().catch((e: unknown) => {
  console.error('❌ 异常:', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
