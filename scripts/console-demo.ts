// 端到端 console demo —— 真 LLM + 真 Scenario JSON 跑场景
//
// 跑法：npm run demo
// 需要 .env 文件含 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAICompatibleProvider } from '../src/llm/openai-compatible.js';
import { LlmAdapter } from '../src/llm/adapter.js';
import { InMemoryNarrativeState } from '../src/engine/in-memory-narrative-state.js';
import { rollCheck } from '../src/engine/skill-check.js';
import { DefaultRng } from '../src/engine/rng.js';
import { recomputeDerivedStats } from '../src/types/character.js';
import { loadScenarioFromJson } from '../src/engine/scenario-validator.js';
import type { Character } from '../src/types/character.js';
import type { Scenario, Scene } from '../src/types/scenario.js';

// ─── 读环境变量 ─────────────────────────────────────

const baseUrl = process.env['LLM_BASE_URL'];
const apiKey = process.env['LLM_API_KEY'];
const model = process.env['LLM_MODEL'] ?? 'deepseek-chat';
if (!baseUrl || !apiKey) {
  console.error('❌ 缺 LLM_BASE_URL / LLM_API_KEY 环境变量');
  process.exit(1);
}

// ─── 加载剧本 ───────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenarioPath = join(__dirname, '..', 'src', 'scenarios', 'library-demo.json');
const json = readFileSync(scenarioPath, 'utf-8');
const loaded = loadScenarioFromJson(json);
if (!loaded.ok) {
  console.error('❌ Scenario 校验失败:');
  loaded.issues.forEach((i) => console.error(`   [${i.severity}] ${i.path}: ${i.message}`));
  process.exit(1);
}
const scenario: Scenario = loaded.scenario;
console.log(`🔌 Provider: ${baseUrl}`);
console.log(`🤖 Model:    ${model}`);
console.log(`📖 剧本:     《${scenario.title}》 · ${scenario.scenes.length} 个场景`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ─── 造一个最简单的角色 ──────────────────────────────

function makeChar(): Character {
  const c: Character = {
    id: 'demo', name: '林夏', occupation: '记者', age: 28,
    attributes: { STR: 50, DEX: 60, INT: 80, CON: 60, POW: 70, APP: 60, SIZ: 55, EDU: 80 },
    maxHp: 0, maxMp: 0, maxSanity: 0, currentHp: 0, currentMp: 0, currentSanity: 0,
    luck: 60, movement: 0, dodge: 0, brawl: 0,
    skills: new Map(), inventory: [], conditions: [],
  };
  recomputeDerivedStats(c);
  c.currentHp = c.maxHp; c.currentMp = c.maxMp; c.currentSanity = c.maxSanity;
  return c;
}

// ─── 跑 ────────────────────────────────────────────

async function main() {
  const provider = new OpenAICompatibleProvider({
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    model,
    displayName: model,
    timeoutMs: 45_000,
  });
  const adapter = new LlmAdapter({ provider });
  const char = makeChar();
  const ns = new InMemoryNarrativeState({ startSceneId: scenario.startSceneId });
  const rng = new DefaultRng();

  const startScene = scenario.scenes.find((s) => s.id === scenario.startSceneId)!;

  // ── 步骤 1: 进入起点场景 ──
  console.log(`🎬 [步骤 1] 进入场景：${startScene.name}\n`);
  const action1 = await adapter.enterScene({
    scenario: { id: scenario.id, title: scenario.title, setting: scenario.setting },
    scene: {
      id: startScene.id,
      name: startScene.name,
      description: startScene.description,
      hints: startScene.hints ?? [],
      expectedChecks: (startScene.expectedChecks ?? []).map((c) => ({
        skill: c.skill,
        difficulty: c.difficulty,
        reason: c.reason,
      })),
    },
    character: char,
    narrative: ns,
  });
  printAction(action1);

  // ── 步骤 2: 玩家行动 ──
  console.log('\n🎬 [步骤 2] 玩家行动：我仔细观察接待台\n');
  const action2 = await adapter.resolvePlayerAction('我仔细观察接待台和周围');
  printAction(action2);

  // ── 步骤 3: 如果要求检定，引擎丢骰 + AI 叙事 ──
  if (action2.type === 'request_check') {
    // 从剧本里查这个 check 的预设难度 / target 推导
    const checkDef = startScene.expectedChecks?.find((c) => c.skill === action2.skill);
    const target = checkDef ? targetForSkill(action2.skill) : targetForSkill(action2.skill);

    console.log(`\n🎲 [步骤 3] 引擎丢骰子：${action2.skill} (${action2.difficulty}, target=${target})`);
    const result = rollCheck({ target, difficulty: action2.difficulty }, rng);
    console.log(`   投出: ${result.roll} vs 有效目标 ${result.effectiveTarget} → ${result.outcome} (${result.succeeded ? '成功' : '失败'})\n`);

    // 应用 onSuccess / onFailure 的 flag 变化
    if (result.succeeded && checkDef?.onSuccess?.setFlags) {
      for (const [k, v] of Object.entries(checkDef.onSuccess.setFlags)) {
        ns.setFlag(k, v);
        console.log(`   🚩 flag set: ${k} = ${v}`);
      }
    }
    if (!result.succeeded && checkDef?.onFailure?.setFlags) {
      for (const [k, v] of Object.entries(checkDef.onFailure.setFlags)) {
        ns.setFlag(k, v);
        console.log(`   🚩 flag set: ${k} = ${v}`);
      }
    }

    console.log('\n🎬 [步骤 4] AI 叙事检定结果\n');
    const action3 = await adapter.narrateCheckResult(result, {
      skill: action2.skill,
      intent: '仔细观察接待台',
    });
    printAction(action3);
  }

  // ── 收尾 ──
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Demo 完成 · 当前场景: ${ns.getCurrentScene()}`);
  console.log(`   visited: ${[...new Set(ns.getChoiceHistory().map((c) => c.sceneId))].length} 个场景`);
  const flags = scenario.scenes.flatMap((s) => s.expectedChecks ?? [])
    .flatMap((c) => Object.keys(c.onSuccess?.setFlags ?? {}))
    .filter((k) => ns.getFlag(k) !== undefined);
  console.log(`   flags: ${flags.length > 0 ? flags.join(', ') : '(无)'}`);
}

function targetForSkill(skill: string): number {
  // V0 简化：默认 skill 50；后期改成从 Character.skills 读
  const presets: Record<string, number> = {
    spot_hidden: 60, listen: 50, library_use: 70, psychology: 50,
    locksmith: 30, dodge: 30, brawl: 60,
  };
  return presets[skill] ?? 50;
}

function printAction(a: import('../src/llm/adapter.js').LlmAction): void {
  const typeEmoji: Record<string, string> = {
    narrate: '📖', dialogue: '🗣️', request_check: '🎯',
    jump_scene: '🚪', set_flag: '🚩',
  };
  console.log(`${typeEmoji[a.type] ?? '❓'}  ${a.type}`);
  console.log(`   ${a.text}`);
  if (a.type === 'request_check') {
    console.log(`   → 检定: ${a.skill} (${a.difficulty})`);
    console.log(`   → 原因: ${a.rationale}`);
  } else if (a.type === 'dialogue') {
    console.log(`   → 角色: ${a.speaker}${a.expression ? ` (${a.expression})` : ''}`);
  } else if (a.type === 'jump_scene') {
    console.log(`   → 跳到: ${a.toScene}`);
  } else if (a.type === 'set_flag') {
    console.log(`   → flag: ${a.flag} = ${a.value}`);
  }
}

// 顶级 await 兼容（Node 22+ 支持 top-level await）
await main().catch((err: unknown) => {
  console.error('\n❌ Demo 失败:');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
