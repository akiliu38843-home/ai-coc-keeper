// 端到端 console demo —— 真 LLM 跑一个最简场景
//
// 跑法：npm run demo
// 需要 .env 文件含 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL

import { OpenAICompatibleProvider } from '../src/llm/openai-compatible.js';
import { LlmAdapter } from '../src/llm/adapter.js';
import { InMemoryNarrativeState } from '../src/engine/in-memory-narrative-state.js';
import { rollCheck } from '../src/engine/skill-check.js';
import { DefaultRng } from '../src/engine/rng.js';
import { recomputeDerivedStats } from '../src/types/character.js';
import type { Character } from '../src/types/character.js';

// ─── 读环境变量 ─────────────────────────────────────

const baseUrl = process.env['LLM_BASE_URL'];
const apiKey = process.env['LLM_API_KEY'];
const model = process.env['LLM_MODEL'] ?? 'deepseek-chat';

if (!baseUrl || !apiKey) {
  console.error('❌ 缺 LLM_BASE_URL / LLM_API_KEY 环境变量。检查 .env 文件。');
  process.exit(1);
}

console.log(`🔌 Provider: ${baseUrl}`);
console.log(`🤖 Model:    ${model}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ─── 造一个最简单的角色 + 场景 ───────────────────────

function makeChar(): Character {
  const c: Character = {
    id: 'demo',
    name: '林夏',
    occupation: '记者',
    age: 28,
    attributes: { STR: 50, DEX: 60, INT: 80, CON: 60, POW: 70, APP: 60, SIZ: 55, EDU: 80 },
    maxHp: 0, maxMp: 0, maxSanity: 0,
    currentHp: 0, currentMp: 0, currentSanity: 0,
    luck: 60, movement: 0, dodge: 0, brawl: 0,
    skills: new Map(),
    inventory: [],
    conditions: [],
  };
  recomputeDerivedStats(c);
  c.currentHp = c.maxHp;
  c.currentMp = c.maxMp;
  c.currentSanity = c.maxSanity;
  return c;
}

// ─── 跑 ────────────────────────────────────────────

async function main() {
  const provider = new OpenAICompatibleProvider({
    baseUrl,
    apiKey,
    model,
    displayName: model,
    timeoutMs: 45_000,
  });
  const adapter = new LlmAdapter({ provider });
  const char = makeChar();
  const ns = new InMemoryNarrativeState({ startSceneId: 'scene_entrance' });
  const rng = new DefaultRng();

  // ── 步骤 1: 进入场景 ──
  console.log('🎬 [步骤 1] 进入场景：图书馆门厅\n');
  const action1 = await adapter.enterScene({
    scenario: {
      id: 'demo_lib',
      title: '失踪的馆长',
      setting: '1928 年新英格兰小镇，一家废弃图书馆',
    },
    scene: {
      id: 'scene_entrance',
      name: '图书馆门厅',
      description:
        '推开沉重的橡木大门，一股潮湿的霉味扑面而来。月光从破碎的彩绘玻璃漏进来，照在堆满灰尘的接待台上。空气里有一种奇怪的甜腻味道。',
      hints: ['接待台抽屉里有一本访客登记簿', '墙上挂着馆长的照片，眼睛部分被人挖空'],
      expectedChecks: [
        { skill: 'spot_hidden', difficulty: 'normal', reason: '观察接待台' },
        { skill: 'listen', difficulty: 'normal', reason: '楼上似乎有动静' },
      ],
    },
    character: char,
    narrative: ns,
  });

  printAction(action1);

  // ── 步骤 2: 玩家行动 → AI 决定该不该检定 ──
  console.log('\n🎬 [步骤 2] 玩家行动：我仔细观察接待台\n');
  const action2 = await adapter.resolvePlayerAction('我仔细观察接待台和周围');
  printAction(action2);

  // ── 步骤 3: 如果 AI 要求检定，丢骰子 + 让 AI 叙事结果 ──
  if (action2.type === 'request_check') {
    console.log(`\n🎲 [步骤 3] 引擎丢骰子：${action2.skill} (${action2.difficulty})`);
    const targetMap: Record<string, number> = {
      spot_hidden: 60, listen: 50, library_use: 70, psychology: 50,
    };
    const target = targetMap[action2.skill] ?? 50;
    const result = rollCheck({ target, difficulty: action2.difficulty }, rng);
    console.log(`   投出: ${result.roll} vs 目标 ${result.effectiveTarget} → ${result.outcome} (${result.succeeded ? '成功' : '失败'})\n`);

    console.log('🎬 [步骤 4] 让 AI 叙事检定结果\n');
    const action3 = await adapter.narrateCheckResult(result, {
      skill: action2.skill,
      intent: '仔细观察接待台',
    });
    printAction(action3);
  } else {
    console.log('\n(AI 没有要求检定，跳过 step 3-4)');
  }

  // ── 步骤 5: Token 消耗汇总 ──
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Demo 完成');
}

function printAction(a: import('../src/llm/adapter.js').LlmAction): void {
  const typeEmoji: Record<string, string> = {
    narrate: '📖',
    dialogue: '🗣️',
    request_check: '🎯',
    jump_scene: '🚪',
    set_flag: '🚩',
  };
  console.log(`${typeEmoji[a.type] ?? '❓'}  ${a.type}`);
  console.log(`   ${a.text}`);
  if (a.type === 'request_check') {
    console.log(`   → 需要检定: ${a.skill} (${a.difficulty})`);
    console.log(`   → 原因: ${a.rationale}`);
  } else if (a.type === 'dialogue') {
    console.log(`   → 角色: ${a.speaker}${a.expression ? ` (${a.expression})` : ''}`);
  } else if (a.type === 'jump_scene') {
    console.log(`   → 跳到: ${a.toScene}`);
  } else if (a.type === 'set_flag') {
    console.log(`   → flag: ${a.flag} = ${a.value}`);
  }
}

main().catch((err: unknown) => {
  console.error('\n❌ Demo 失败:');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
