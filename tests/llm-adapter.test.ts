// W4 验收：LlmAdapter prompt 组装 + JSON 解析 + history 管理
// 全部用 MockLlmProvider，不触发真 API。

import { describe, it, expect } from 'vitest';
import { MockLlmProvider } from '../src/llm/provider.js';
import {
  parseLlmAction,
  LlmAdapter,
  type LlmAction,
} from '../src/llm/adapter.js';
import { buildSceneContext } from '../src/llm/prompts.js';
import { InMemoryNarrativeState } from '../src/engine/in-memory-narrative-state.js';
import { recomputeDerivedStats } from '../src/types/character.js';
import type { Character } from '../src/types/character.js';
import type { CheckResult } from '../src/types/rules.js';

function makeChar(opts: { withInsanity?: boolean } = {}): Character {
  const c: Character = {
    id: 'c1', name: '林夏', occupation: '记者', age: 28,
    attributes: { STR: 50, DEX: 60, INT: 80, CON: 60, POW: 70, APP: 60, SIZ: 55, EDU: 80 },
    maxHp: 0, maxMp: 0, maxSanity: 0,
    currentHp: 0, currentMp: 0, currentSanity: 0,
    luck: 60, movement: 0, dodge: 0, brawl: 0,
    skills: new Map(),
    inventory: [],
    conditions: opts.withInsanity ? [{
      type: 'indef_insanity',
      source: '看到 Cthulhu',
      appliedAt: 0,
      insanityDetail: {
        kind: 'mania', id: 39, nameZh: '漂泊症', nameEn: 'Drapetomania',
        description: '执着于逃离',
      },
    }] : [],
  };
  recomputeDerivedStats(c);
  c.currentHp = c.maxHp;
  c.currentMp = c.maxMp;
  c.currentSanity = c.maxSanity;
  return c;
}

// ─── parseLlmAction ───────────────────────────────────

describe('parseLlmAction · 各 type 解析', () => {
  it('narrate', () => {
    const r = parseLlmAction(JSON.stringify({ type: 'narrate', text: '门吱嘎一声开了' }));
    expect(r).toEqual({ type: 'narrate', text: '门吱嘎一声开了' });
  });

  it('dialogue 含 speaker', () => {
    const r = parseLlmAction(JSON.stringify({
      type: 'dialogue', text: '你来了。', speaker: '老馆长', expression: 'neutral',
    }));
    expect(r.type).toBe('dialogue');
    if (r.type === 'dialogue') {
      expect(r.speaker).toBe('老馆长');
      expect(r.expression).toBe('neutral');
    }
  });

  it('request_check 含 skill / difficulty', () => {
    const r = parseLlmAction(JSON.stringify({
      type: 'request_check',
      text: '需要仔细观察',
      skill: 'spot_hidden',
      difficulty: 'normal',
      rationale: '房间里有暗格',
    }));
    expect(r.type).toBe('request_check');
    if (r.type === 'request_check') {
      expect(r.skill).toBe('spot_hidden');
      expect(r.difficulty).toBe('normal');
    }
  });

  it('request_check difficulty 非法 → 默认 normal', () => {
    const r = parseLlmAction(JSON.stringify({
      type: 'request_check', text: 'X', skill: 'x', difficulty: 'super_hard', rationale: '',
    }));
    if (r.type === 'request_check') {
      expect(r.difficulty).toBe('normal');
    }
  });

  it('jump_scene 缺 toScene 降级 narrate', () => {
    const r = parseLlmAction(JSON.stringify({
      type: 'jump_scene', text: 'X',  // 缺 toScene
    }));
    expect(r.type).toBe('narrate');
  });

  it('set_flag', () => {
    const r = parseLlmAction(JSON.stringify({
      type: 'set_flag', text: '日记找到了', flag: 'found_diary', value: true,
    }));
    expect(r.type).toBe('set_flag');
    if (r.type === 'set_flag') {
      expect(r.flag).toBe('found_diary');
      expect(r.value).toBe(true);
    }
  });
});

describe('parseLlmAction · 降级处理', () => {
  it('完全不是 JSON → narrate 包裹原文', () => {
    const r = parseLlmAction('门吱嘎一声开了，门里是无尽黑暗');
    expect(r.type).toBe('narrate');
    if (r.type === 'narrate') {
      expect(r.text).toContain('门吱嘎');
    }
  });

  it('markdown code block 包裹的 JSON 能解析', () => {
    const r = parseLlmAction('```json\n{"type":"narrate","text":"X"}\n```');
    expect(r.type).toBe('narrate');
  });

  it('未知 type 降级 narrate', () => {
    const r = parseLlmAction(JSON.stringify({ type: 'wat', text: 'fallback' }));
    expect(r.type).toBe('narrate');
  });

  it('JSON 解析失败 → narrate', () => {
    const r = parseLlmAction('{ "type": "narrate", "text": broken json');
    expect(r.type).toBe('narrate');
  });

  it('null / 非 object → narrate', () => {
    expect(parseLlmAction('null').type).toBe('narrate');
    expect(parseLlmAction('"string only"').type).toBe('narrate');
    expect(parseLlmAction('42').type).toBe('narrate');
  });
});

// ─── buildSceneContext ────────────────────────────────

describe('buildSceneContext', () => {
  it('拼出包含场景 / 探者 / 选择历史的文本', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns.logChoice('c1', '走进图书馆');
    ns.jumpToScene('scene_b');
    ns.logChoice('c2', '翻开第二本书');

    const text = buildSceneContext({
      scenario: { id: 's1', title: '追书人', setting: '1920 美国新英格兰' },
      scene: { id: 'scene_b', name: '图书馆深处', description: '昏黄灯光下，书架摇摇欲坠。' },
      character: makeChar(),
      narrative: ns,
    });

    expect(text).toContain('追书人');
    expect(text).toContain('图书馆深处');
    expect(text).toContain('林夏');
    expect(text).toContain('走进图书馆');
    expect(text).toContain('翻开第二本书');
  });

  it('expectedChecks 跟 hints 可选 / 缺省安全', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 's1' });
    const text = buildSceneContext({
      scenario: { id: 's', title: 'T', setting: 'X' },
      scene: { id: 's1', name: 'N', description: 'D' },
      character: makeChar(),
      narrative: ns,
    });
    expect(text).not.toContain('作者提示');
    expect(text).not.toContain('可能触发的检定');
  });

  it('character 含长期心智失常时, 加【探者当前状态】段', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 's1' });
    const text = buildSceneContext({
      scenario: { id: 's', title: 'T', setting: 'X' },
      scene: { id: 's1', name: 'N', description: 'D' },
      character: makeChar({ withInsanity: true }),
      narrative: ns,
    });
    expect(text).toContain('探者当前状态');
    expect(text).toContain('漂泊症');
    expect(text).toContain('Drapetomania');
    expect(text).toContain('执着于逃离');
  });
});

// ─── LlmAdapter ───────────────────────────────────────

describe('LlmAdapter · enterScene', () => {
  it('首次 enterScene 注入 system + scene context', async () => {
    const mock = new MockLlmProvider([
      JSON.stringify({ type: 'narrate', text: '昏暗的玄关你看到一具尸体' }),
    ]);
    const adapter = new LlmAdapter({ provider: mock });

    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    const action = await adapter.enterScene({
      scenario: { id: 's', title: '追书人', setting: 'X' },
      scene: { id: 'scene_a', name: '玄关', description: '木质门把手冰凉' },
      character: makeChar(),
      narrative: ns,
    });

    expect(action.type).toBe('narrate');
    if (action.type === 'narrate') expect(action.text).toContain('尸体');

    // 验证 prompt 组装
    expect(mock.calls).toHaveLength(1);
    const sentMessages = mock.calls[0]!.messages;
    expect(sentMessages[0]?.role).toBe('system');
    expect(sentMessages[0]?.content).toContain('不准丢骰子');
    expect(sentMessages[1]?.role).toBe('user');
    expect(sentMessages[1]?.content).toContain('追书人');
    expect(mock.calls[0]!.opts?.jsonMode).toBe(true);
  });
});

describe('LlmAdapter · resolvePlayerAction', () => {
  it('多轮对话累积 history', async () => {
    const mock = new MockLlmProvider([
      JSON.stringify({ type: 'narrate', text: '场景描述' }),
      JSON.stringify({
        type: 'request_check', text: '需要观察',
        skill: 'spot_hidden', difficulty: 'normal', rationale: '可能有暗格',
      }),
    ]);
    const adapter = new LlmAdapter({ provider: mock });

    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    await adapter.enterScene({
      scenario: { id: 's', title: 'T', setting: 'X' },
      scene: { id: 'scene_a', name: 'N', description: 'D' },
      character: makeChar(),
      narrative: ns,
    });
    const a2 = await adapter.resolvePlayerAction('我仔细打量房间');

    expect(a2.type).toBe('request_check');
    if (a2.type === 'request_check') {
      expect(a2.skill).toBe('spot_hidden');
      expect(a2.difficulty).toBe('normal');
    }

    // 第二次调用 history 应该包含第一次的 assistant 回复
    const secondCall = mock.calls[1]!;
    expect(secondCall.messages.length).toBeGreaterThan(2);
    expect(secondCall.messages.some((m) => m.role === 'assistant')).toBe(true);
  });
});

describe('LlmAdapter · narrateCheckResult', () => {
  it('把检定结果详情发给 LLM', async () => {
    const mock = new MockLlmProvider([
      JSON.stringify({ type: 'narrate', text: '场景' }),
      JSON.stringify({ type: 'narrate', text: '你成功发现了暗格' }),
    ]);
    const adapter = new LlmAdapter({ provider: mock });
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });

    await adapter.enterScene({
      scenario: { id: 's', title: 'T', setting: 'X' },
      scene: { id: 'scene_a', name: 'N', description: 'D' },
      character: makeChar(),
      narrative: ns,
    });

    const checkResult: CheckResult = {
      roll: 25, target: 60, difficulty: 'normal', effectiveTarget: 60,
      bonusDice: 0, penaltyDice: 0,
      outcome: 'success', succeeded: true,
      ts: Date.now(),
    };

    const action = await adapter.narrateCheckResult(checkResult, {
      skill: 'spot_hidden',
      intent: '观察房间',
    });

    expect(action.type).toBe('narrate');
    const checkCall = mock.calls[1]!;
    expect(checkCall.messages[checkCall.messages.length - 1]!.content).toContain('25');
    expect(checkCall.messages[checkCall.messages.length - 1]!.content).toContain('spot_hidden');
    expect(checkCall.messages[checkCall.messages.length - 1]!.content).toContain('普通成功');
  });
});

describe('LlmAdapter · history 管理', () => {
  it('resetHistory 清空', async () => {
    const mock = new MockLlmProvider([
      JSON.stringify({ type: 'narrate', text: '1' }),
      JSON.stringify({ type: 'narrate', text: '2' }),
    ]);
    const adapter = new LlmAdapter({ provider: mock });
    const ns = new InMemoryNarrativeState({ startSceneId: 's' });

    await adapter.enterScene({
      scenario: { id: 's', title: 'T', setting: 'X' },
      scene: { id: 's', name: 'N', description: 'D' },
      character: makeChar(),
      narrative: ns,
    });
    expect(adapter.getHistory().length).toBeGreaterThan(0);

    adapter.resetHistory();
    expect(adapter.getHistory().length).toBe(0);
  });

  it('trimHistory 保留 system 在最前', async () => {
    const mock = new MockLlmProvider(
      Array.from({ length: 30 }, () => JSON.stringify({ type: 'narrate', text: 'x' })),
    );
    const adapter = new LlmAdapter({ provider: mock, historyLimit: 5 });
    const ns = new InMemoryNarrativeState({ startSceneId: 's' });

    await adapter.enterScene({
      scenario: { id: 's', title: 'T', setting: 'X' },
      scene: { id: 's', name: 'N', description: 'D' },
      character: makeChar(),
      narrative: ns,
    });
    for (let i = 0; i < 10; i++) {
      await adapter.resolvePlayerAction(`第 ${i} 次行动`);
    }
    const history = adapter.getHistory();
    expect(history[0]?.role).toBe('system');
    // trim 在 chat 调用前跑，假设 historyLimit=5：
    //   trim 后 ≤ 6（含 system），再 push assistant → ≤ 7
    expect(history.length).toBeLessThanOrEqual(7);
  });
});
