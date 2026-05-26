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
import { buildScenarioGame, type InSceneAction } from '../src/adapter/webgal-script-builder.js';
import { buildSceneContext } from '../src/llm/prompts.js';
import { OpenAICompatibleProvider } from '../src/llm/openai-compatible.js';
import { LlmAdapter, type LlmAction } from '../src/llm/adapter.js';
import { InMemoryNarrativeState } from '../src/engine/in-memory-narrative-state.js';
import { recomputeDerivedStats } from '../src/types/character.js';
import { rollCheck } from '../src/engine/skill-check.js';
import { DefaultRng } from '../src/engine/rng.js';
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

/** V0: 默认技能值表 (后续 W9 调查员向导生成真实角色卡时替换) */
function skillTarget(skill: string): number {
  const presets: Record<string, number> = {
    spot_hidden: 60, listen: 50, library_use: 70, psychology: 50,
    locksmith: 30, dodge: 30, brawl: 60, sneak: 40, stealth: 40,
    persuade: 50, fast_talk: 40, charm: 40, intimidate: 40,
    climb: 40, first_aid: 50, medicine: 30, occult: 30,
    drive_auto: 30, language_own: 80, language_other: 20,
    track: 30, jump: 25, swim: 25, throw: 25,
  };
  return presets[skill] ?? 40;
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
  const perSceneTransitions = new Map<string, Map<number, LlmAction[]>>();
  const perSceneInScene = new Map<string, InSceneAction[]>();

  // 每个 scene: 1) enterScene 拿主叙事 2) 每个 exit 跑 narrateTransition
  for (let i = 0; i < scenario.scenes.length; i++) {
    const scene = scenario.scenes[i]!;
    console.log(`[${i + 1}/${scenario.scenes.length}] LLM: ${scene.id} · ${scene.name}`);
    const adapter = new LlmAdapter({ provider });
    const ns = new InMemoryNarrativeState({ startSceneId: scene.id });

    // 1) 场景主叙事
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
      perSceneActions.set(scene.id, [action]);
      console.log(`    ✓ enterScene · ${action.type} (${(action.text ?? '').slice(0, 40)}...)`);
    } catch (e) {
      console.warn(`    ⚠ enterScene 失败, 回退原描述: ${(e as Error).message.slice(0, 80)}`);
    }

    // 2) AI 建议行动（in-scene actions, 不跳 scene）
    try {
      const sceneContext = buildSceneContext({
        scenario: { id: scenario.id, title: scenario.title, setting: scenario.setting },
        scene: { id: scene.id, name: scene.name, description: scene.description, hints: scene.hints ?? [] },
        character: char,
        narrative: ns,
      });
      const suggested = await adapter.suggestActions({ sceneContext, count: 4 });
      // 把 SuggestedAction 转成 InSceneAction (含 check 的丢骰)
      const rng = new DefaultRng();
      const resolved: InSceneAction[] = suggested.map((a) => {
        if (a.kind === 'simple') {
          return { label: a.label, resultNarrate: a.resultNarrate };
        }
        // check 型 → 引擎丢 D100
        const target = skillTarget(a.check.skill);
        const result = rollCheck({ target, difficulty: a.check.difficulty }, rng);
        const badge = `[${a.check.skill} ${result.roll}/${result.effectiveTarget} ${result.outcome}]`;
        const narrate = result.succeeded ? a.successNarrate : a.failNarrate;
        return { label: a.label, resultNarrate: `${badge} ${narrate}` };
      });
      if (resolved.length > 0) {
        perSceneInScene.set(scene.id, resolved);
        const checkCount = suggested.filter(a => a.kind === 'check').length;
        console.log(`    ✓ 建议行动 ${resolved.length} 个 (${checkCount} 个含检定): ${resolved.map(s => s.label).join(' / ')}`);
      }
    } catch (e) {
      console.warn(`    ⚠ suggestActions 失败: ${(e as Error).message.slice(0, 60)}`);
    }
    await new Promise((r) => setTimeout(r, 300));

    // 3) 每个 exit 的过渡叙事
    if (scene.exits && scene.exits.length > 0) {
      const sceneTrans = new Map<number, LlmAction[]>();
      for (const [exitIdx, exit] of scene.exits.entries()) {
        try {
          const transAction = await adapter.narrateTransition({
            fromScene: scene.id,
            toScene: exit.toScene,
            choiceText: exit.condition,
          });
          sceneTrans.set(exitIdx, [transAction]);
          console.log(`    ✓ exit[${exitIdx}] "${exit.condition.slice(0, 25)}" → ${exit.toScene}`);
        } catch (e) {
          console.warn(`    ⚠ exit[${exitIdx}] transition 失败: ${(e as Error).message.slice(0, 60)}`);
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      if (sceneTrans.size > 0) perSceneTransitions.set(scene.id, sceneTrans);
    }
  }

  console.log(`\n🔨 构建 WebGAL game...`);
  const built = buildScenarioGame(scenario, perSceneActions, perSceneTransitions, perSceneInScene);

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
