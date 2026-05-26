// 心智失常表 + applySanityLoss 集成测试
import { describe, it, expect } from 'vitest';
import { PHOBIA_TABLE, MANIA_TABLE, rollPhobia, rollMania, rollInsanity } from '../src/engine/insanity-tables.js';
import { applySanityLoss } from '../src/engine/sanity.js';
import { ScriptedRng } from '../src/engine/rng.js';
import { recomputeDerivedStats } from '../src/types/character.js';
import type { Character } from '../src/types/character.js';
import type { SanityCheckResult } from '../src/types/rules.js';

function makeChar(): Character {
  const c: Character = {
    id: 'c1', name: 'T', occupation: 'X', age: 30,
    attributes: { STR: 60, DEX: 60, INT: 70, CON: 60, POW: 70, APP: 60, SIZ: 60, EDU: 70 },
    maxHp: 0, maxMp: 0, maxSanity: 0, currentHp: 0, currentMp: 0, currentSanity: 0,
    luck: 50, movement: 0, dodge: 0, brawl: 0,
    skills: new Map(), inventory: [], conditions: [],
  };
  recomputeDerivedStats(c);
  c.currentHp = c.maxHp; c.currentMp = c.maxMp; c.currentSanity = c.maxSanity;
  return c;
}

describe('PHOBIA / MANIA 表', () => {
  it('两张表各 100 项', () => {
    expect(PHOBIA_TABLE.length).toBe(100);
    expect(MANIA_TABLE.length).toBe(100);
  });

  it('每项含 id / nameZh / nameEn / description', () => {
    const p1 = PHOBIA_TABLE[0]!;
    expect(p1.id).toBe(1);
    expect(p1.nameZh).toContain('恐惧症');
    expect(p1.nameEn).toBeTruthy();
    expect(p1.description).toBeTruthy();
  });

  it('id 1-100 全有', () => {
    const phobiaIds = new Set(PHOBIA_TABLE.map((x) => x.id));
    const maniaIds = new Set(MANIA_TABLE.map((x) => x.id));
    for (let i = 1; i <= 100; i++) {
      expect(phobiaIds.has(i)).toBe(true);
      expect(maniaIds.has(i)).toBe(true);
    }
  });
});

describe('rollPhobia / rollMania', () => {
  it('rollPhobia 用确定 RNG 投出指定项', () => {
    const rng = new ScriptedRng([42]); // rollInt(0, 99) → 42 → 表 index 42 → id 43
    const p = rollPhobia(rng);
    expect(p.id).toBe(43);
    expect(p.nameZh).toBeTruthy();
  });

  it('rollMania 同样可控', () => {
    const rng = new ScriptedRng([7]);
    const m = rollMania(rng);
    expect(m.id).toBe(8);
  });
});

describe('rollInsanity · 50/50 phobia or mania', () => {
  it('第一投 0 → phobia', () => {
    const rng = new ScriptedRng([0, 10]); // 选 phobia + index 10
    const r = rollInsanity(rng);
    expect(r.kind).toBe('phobia');
    expect(r.entry.id).toBe(11);
  });

  it('第一投 1 → mania', () => {
    const rng = new ScriptedRng([1, 20]);
    const r = rollInsanity(rng);
    expect(r.kind).toBe('mania');
    expect(r.entry.id).toBe(21);
  });
});

describe('applySanityLoss · 长期心智失常时附加 phobia/mania', () => {
  it('给了 rng 时, indef_insanity condition 含 insanityDetail', () => {
    const c = makeChar(); // maxSanity=70, 阈值 14
    const result: SanityCheckResult = {
      roll: 99, threshold: c.currentSanity, succeeded: false,
      actualLoss: 15, // >= 14 触发 indef
      remainingSanity: c.currentSanity - 15,
      triggersTempInsanity: true, triggersIndefInsanity: false, ts: 0,
      reason: '看到 Cthulhu',
    };
    const rng = new ScriptedRng([0, 5]); // phobia + index 5
    const r = applySanityLoss(c, result, { rng });
    expect(r.triggersIndefInsanity).toBe(true);

    const indefCond = c.conditions.find((cnd) => cnd.type === 'indef_insanity');
    expect(indefCond).toBeDefined();
    expect(indefCond?.insanityDetail).toBeDefined();
    expect(indefCond?.insanityDetail?.kind).toBe('phobia');
    expect(indefCond?.insanityDetail?.id).toBe(6);
    expect(indefCond?.insanityDetail?.nameZh).toBeTruthy();
  });

  it('没给 rng 时, indef_insanity 没 insanityDetail (向后兼容)', () => {
    const c = makeChar();
    const result: SanityCheckResult = {
      roll: 99, threshold: c.currentSanity, succeeded: false,
      actualLoss: 15,
      remainingSanity: c.currentSanity - 15,
      triggersTempInsanity: true, triggersIndefInsanity: false, ts: 0,
      reason: 'X',
    };
    applySanityLoss(c, result); // 不传 rng
    const indefCond = c.conditions.find((cnd) => cnd.type === 'indef_insanity');
    expect(indefCond).toBeDefined();
    expect(indefCond?.insanityDetail).toBeUndefined();
  });

  it('损失 < 阈值时不加 indef_insanity', () => {
    const c = makeChar();
    const result: SanityCheckResult = {
      roll: 99, threshold: c.currentSanity, succeeded: false,
      actualLoss: 5, // < 14
      remainingSanity: c.currentSanity - 5,
      triggersTempInsanity: true, triggersIndefInsanity: false, ts: 0,
      reason: 'X',
    };
    const rng = new ScriptedRng([0, 5]);
    const r = applySanityLoss(c, result, { rng });
    expect(r.triggersIndefInsanity).toBe(false);
    expect(c.conditions.find((cnd) => cnd.type === 'indef_insanity')).toBeUndefined();
  });
});
