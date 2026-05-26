// Scenario 校验器单测
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateScenario,
  loadScenarioFromJson,
} from '../src/engine/scenario-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 真实 library demo fixture ────────────────────

describe('validateScenario · 真实 library demo 通过校验', () => {
  it('加载内置 library-demo.json 校验通过', () => {
    const json = readFileSync(
      join(__dirname, '..', 'src', 'scenarios', 'library-demo.json'),
      'utf-8',
    );
    const result = loadScenarioFromJson(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scenario.title).toBe('失踪的馆长');
      expect(result.scenario.scenes.length).toBe(3);
      expect(result.scenario.startSceneId).toBe('scene_entrance');
    }
  });
});

// ─── 必填字段缺失 ──────────────────────────────────

describe('validateScenario · 必填字段', () => {
  it('完全空对象 → 多个 error', () => {
    const r = validateScenario({});
    expect(r.valid).toBe(false);
    expect(r.issues.length).toBeGreaterThanOrEqual(5);
  });

  it('缺 title', () => {
    const r = validateScenario({
      schemaVersion: 1, id: 'x', setting: 's', startSceneId: 's1',
      scenes: [{ id: 's1', name: 'X', description: 'D' }], npcs: [],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.path.includes('title'))).toBe(true);
  });

  it('schemaVersion 错', () => {
    const r = validateScenario({
      schemaVersion: 99, id: 'x', title: 'T', setting: 's', startSceneId: 's1',
      scenes: [{ id: 's1', name: 'X', description: 'D' }], npcs: [],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.path.includes('schemaVersion'))).toBe(true);
  });
});

// ─── 跨引用校验 ───────────────────────────────────

describe('validateScenario · 跨引用一致性', () => {
  it('startSceneId 不在 scenes 列表 → 报错', () => {
    const r = validateScenario({
      schemaVersion: 1, id: 'x', title: 'T', setting: 's',
      startSceneId: 'missing',
      scenes: [{ id: 's1', name: 'X', description: 'D' }], npcs: [],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes('起点场景'))).toBe(true);
  });

  it('scene.exits 指向不存在的场景 → 报错', () => {
    const r = validateScenario({
      schemaVersion: 1, id: 'x', title: 'T', setting: 's', startSceneId: 's1',
      scenes: [
        { id: 's1', name: 'X', description: 'D',
          exits: [{ toScene: 'ghost_scene', condition: '' }],
        },
      ], npcs: [],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes('未定义的场景'))).toBe(true);
  });

  it('scene.npcs 引用不存在的 NPC → 报错', () => {
    const r = validateScenario({
      schemaVersion: 1, id: 'x', title: 'T', setting: 's', startSceneId: 's1',
      scenes: [
        { id: 's1', name: 'X', description: 'D', npcs: ['ghost_npc'] },
      ], npcs: [],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes('未定义的 NPC'))).toBe(true);
  });

  it('expectedChecks.onSuccess.jumpScene 指向不存在场景 → 报错', () => {
    const r = validateScenario({
      schemaVersion: 1, id: 'x', title: 'T', setting: 's', startSceneId: 's1',
      scenes: [
        {
          id: 's1', name: 'X', description: 'D',
          expectedChecks: [
            { skill: 'spot_hidden', difficulty: 'normal', reason: 'X',
              onSuccess: { jumpScene: 'nowhere' } },
          ],
        },
      ], npcs: [],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.path.includes('expectedChecks[0].onSuccess.jumpScene'))).toBe(true);
  });

  it('场景 ID 重复 → 报错', () => {
    const r = validateScenario({
      schemaVersion: 1, id: 'x', title: 'T', setting: 's', startSceneId: 's1',
      scenes: [
        { id: 's1', name: 'A', description: 'A' },
        { id: 's1', name: 'B', description: 'B' },
      ], npcs: [],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes('场景 ID 重复'))).toBe(true);
  });
});

// ─── check.difficulty 校验 ────────────────────────

describe('validateScenario · check 难度', () => {
  it('非法 difficulty → 报错', () => {
    const r = validateScenario({
      schemaVersion: 1, id: 'x', title: 'T', setting: 's', startSceneId: 's1',
      scenes: [
        {
          id: 's1', name: 'X', description: 'D',
          expectedChecks: [
            { skill: 'spot_hidden', difficulty: 'mega_hard', reason: 'X' },
          ],
        },
      ], npcs: [],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes('非法难度'))).toBe(true);
  });
});

// ─── loadScenarioFromJson · JSON 解析失败 ──────────

describe('loadScenarioFromJson', () => {
  it('坏 JSON → 返回错误', () => {
    const r = loadScenarioFromJson('{ broken json');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.message).toContain('JSON 解析失败');
    }
  });

  it('合法 JSON 但不是 Scenario → 返回校验错误', () => {
    const r = loadScenarioFromJson('{}');
    expect(r.ok).toBe(false);
  });
});
