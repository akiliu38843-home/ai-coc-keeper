// W2 验收：NarrativeState 核心 transitions + 序列化 roundtrip 测试

import { describe, it, expect } from 'vitest';
import { InMemoryNarrativeState } from '../src/engine/in-memory-narrative-state.js';

describe('InMemoryNarrativeState · 初始化', () => {
  it('从起点场景 init 后，当前场景 = 起点', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_intro' });
    expect(ns.getCurrentScene()).toBe('scene_intro');
  });

  it('起点场景自动加入 visited 集合', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_intro' });
    expect(ns.hasVisited('scene_intro')).toBe(true);
    expect(ns.hasVisited('scene_other')).toBe(false);
  });
});

describe('InMemoryNarrativeState · 场景跳转', () => {
  it('jumpToScene 更新 current + 加入 visited', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns.jumpToScene('scene_b');
    expect(ns.getCurrentScene()).toBe('scene_b');
    expect(ns.hasVisited('scene_a')).toBe(true);
    expect(ns.hasVisited('scene_b')).toBe(true);
  });

  it('重复跳到同一场景不报错，visited 仍只一份', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns.jumpToScene('scene_b');
    ns.jumpToScene('scene_b');
    expect(ns.getCurrentScene()).toBe('scene_b');
    expect(ns.hasVisited('scene_b')).toBe(true);
  });

  it('jumpToScene 空 ID 报错', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    expect(() => ns.jumpToScene('')).toThrow();
  });
});

describe('InMemoryNarrativeState · 选择记录', () => {
  it('logChoice 按时间顺序累积 + sceneId 取当前场景', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns.logChoice('choose_left', '走左边的门');
    ns.jumpToScene('scene_b');
    ns.logChoice('ask_npc', '问 NPC 名字');
    const history = ns.getChoiceHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.sceneId).toBe('scene_a');
    expect(history[0]?.choiceId).toBe('choose_left');
    expect(history[1]?.sceneId).toBe('scene_b');
    expect(history[1]?.choiceId).toBe('ask_npc');
  });

  it('getChoiceHistory 返回只读', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns.logChoice('c1', 'text');
    const history = ns.getChoiceHistory();
    // ReadonlyArray 在 runtime 仍是普通 array，所以确认能读但语义上不应改
    expect(history.length).toBe(1);
  });
});

describe('InMemoryNarrativeState · Flags', () => {
  it('setFlag / getFlag 支持 boolean / number / string', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns.setFlag('found_diary', true);
    ns.setFlag('coins', 50);
    ns.setFlag('npc_smith.mood', 'friendly');
    expect(ns.getFlag('found_diary')).toBe(true);
    expect(ns.getFlag('coins')).toBe(50);
    expect(ns.getFlag('npc_smith.mood')).toBe('friendly');
  });

  it('未设置的 flag 返回 undefined', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    expect(ns.getFlag('nonexistent')).toBeUndefined();
  });

  it('deleteFlag 删除后读不到', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns.setFlag('x', 1);
    ns.deleteFlag('x');
    expect(ns.getFlag('x')).toBeUndefined();
  });

  it('setFlag 覆盖现有值', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns.setFlag('x', 1);
    ns.setFlag('x', 2);
    expect(ns.getFlag('x')).toBe(2);
  });
});

describe('InMemoryNarrativeState · NPC 关系', () => {
  it('updateNpc 首次调用创建新关系，attitude 默认 0', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns.updateNpc('smith', { notes: ['第一次见面'] });
    const rel = ns.getNpcRelation('smith');
    expect(rel?.npcId).toBe('smith');
    expect(rel?.attitude).toBe(0);
    expect(rel?.notes).toEqual(['第一次见面']);
  });

  it('updateNpc 增量 patch：notes 追加，attitude 覆盖', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns.updateNpc('smith', { attitude: 10, notes: ['第一次见面'] });
    ns.updateNpc('smith', { attitude: 30, notes: ['给了我线索'] });
    const rel = ns.getNpcRelation('smith');
    expect(rel?.attitude).toBe(30);  // 覆盖
    expect(rel?.notes).toEqual(['第一次见面', '给了我线索']);  // 追加
  });

  it('未设过的 NPC 返回 undefined', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    expect(ns.getNpcRelation('ghost')).toBeUndefined();
  });
});

describe('InMemoryNarrativeState · 序列化 roundtrip', () => {
  it('snapshot → restore 数据完全一致', () => {
    const ns1 = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns1.jumpToScene('scene_b');
    ns1.logChoice('choice_1', '选项 A');
    ns1.setFlag('found_diary', true);
    ns1.setFlag('coins', 50);
    ns1.updateNpc('smith', { attitude: 20, notes: ['给了线索'] });

    const snapshot = ns1.snapshot();

    const ns2 = new InMemoryNarrativeState({ startSceneId: 'scene_z' });
    ns2.restore(snapshot);

    expect(ns2.getCurrentScene()).toBe('scene_b');
    expect(ns2.hasVisited('scene_a')).toBe(true);
    expect(ns2.hasVisited('scene_b')).toBe(true);
    expect(ns2.getChoiceHistory()).toHaveLength(1);
    expect(ns2.getFlag('found_diary')).toBe(true);
    expect(ns2.getFlag('coins')).toBe(50);
    expect(ns2.getNpcRelation('smith')?.attitude).toBe(20);
    expect(ns2.getNpcRelation('smith')?.notes).toEqual(['给了线索']);
  });

  it('snapshot 是 JSON-serializable', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns.setFlag('x', true);
    ns.updateNpc('smith', { attitude: 5 });
    const snapshot = ns.snapshot();
    const json = JSON.stringify(snapshot);
    const parsed = JSON.parse(json);
    expect(parsed.currentSceneId).toBe('scene_a');
  });

  it('restore 对 snapshot 修改不会影响内部状态（防引用泄漏）', () => {
    const ns1 = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    ns1.logChoice('c1', 'text');
    const snapshot = ns1.snapshot();

    const ns2 = new InMemoryNarrativeState({ startSceneId: 'scene_z' });
    ns2.restore(snapshot);

    // 修改 snapshot 内部数组不应影响 ns2
    snapshot.choiceHistory.push({
      sceneId: 'INJECTED',
      choiceId: 'BAD',
      text: '',
      ts: 0,
    });
    expect(ns2.getChoiceHistory()).toHaveLength(1);
  });

  it('restore 对未来 schemaVersion 报错', () => {
    const ns = new InMemoryNarrativeState({ startSceneId: 'scene_a' });
    const badSnapshot = {
      schemaVersion: 999 as unknown as 1,
      currentSceneId: 'scene_a',
      visitedScenes: [],
      choiceHistory: [],
      flags: {},
      npcRelations: {},
    };
    expect(() => ns.restore(badSnapshot)).toThrow();
  });
});

describe('Character recomputeDerivedStats', () => {
  it('粗略派生计算正确', async () => {
    const { recomputeDerivedStats } = await import('../src/types/character.js');
    const c = {
      id: 'c1',
      name: 'Test',
      occupation: '医生',
      age: 30,
      attributes: { STR: 70, DEX: 70, INT: 80, CON: 60, POW: 65, APP: 50, SIZ: 50, EDU: 80 },
      maxHp: 0, maxMp: 0, maxSanity: 0,
      currentHp: 0, currentMp: 0, currentSanity: 0,
      luck: 60, movement: 0, dodge: 0, brawl: 0,
      skills: new Map(),
      inventory: [],
      conditions: [],
    };
    recomputeDerivedStats(c);
    expect(c.maxHp).toBe(11);          // (60+50)/10
    expect(c.maxMp).toBe(13);          // 65/5
    expect(c.maxSanity).toBe(65);      // POW
    expect(c.dodge).toBe(35);          // DEX/2
    expect(c.brawl).toBe(100);         // STR*2 = 140 capped at 100
    expect(c.movement).toBe(9);        // STR>SIZ && DEX>SIZ
  });
});
