// W3 验收：D100 / Dice / Skill check / Sanity / Damage 全套单测
import { describe, it, expect } from 'vitest';
import { ScriptedRng, DefaultRng } from '../src/engine/rng.js';
import { parseDice, rollDice, rollD100 } from '../src/engine/dice.js';
import {
  rollCheck,
  effectiveTargetForDifficulty,
} from '../src/engine/skill-check.js';
import {
  rollSanityCheck,
  applySanityLoss,
} from '../src/engine/sanity.js';
import { applyDamage, healHp, hasCondition } from '../src/engine/damage.js';
import { recomputeDerivedStats } from '../src/types/character.js';
import type { Character } from '../src/types/character.js';

// ─── 测试用工厂 ────────────────────────────────────────

function makeChar(overrides: Partial<Character> = {}): Character {
  const c: Character = {
    id: 'c1',
    name: '测试探者',
    occupation: '医生',
    age: 30,
    attributes: { STR: 60, DEX: 60, INT: 70, CON: 60, POW: 70, APP: 60, SIZ: 60, EDU: 70 },
    maxHp: 0, maxMp: 0, maxSanity: 0,
    currentHp: 0, currentMp: 0, currentSanity: 0,
    luck: 50, movement: 0, dodge: 0, brawl: 0,
    skills: new Map(),
    inventory: [],
    conditions: [],
    ...overrides,
  };
  recomputeDerivedStats(c);
  c.currentHp = c.maxHp;
  c.currentMp = c.maxMp;
  c.currentSanity = c.maxSanity;
  return c;
}

// ─── RNG ───────────────────────────────────────────────

describe('ScriptedRng', () => {
  it('按序列返回 rollInt', () => {
    const r = new ScriptedRng([1, 50, 100]);
    expect(r.rollInt(1, 100)).toBe(1);
    expect(r.rollInt(1, 100)).toBe(50);
    expect(r.rollInt(1, 100)).toBe(100);
  });
  it('用完报错', () => {
    const r = new ScriptedRng([1]);
    r.rollInt(1, 100);
    expect(() => r.rollInt(1, 100)).toThrow();
  });
  it('isExhausted 反映状态', () => {
    const r = new ScriptedRng([1, 2]);
    expect(r.isExhausted()).toBe(false);
    r.rollInt(1, 100);
    r.rollInt(1, 100);
    expect(r.isExhausted()).toBe(true);
  });
});

describe('DefaultRng', () => {
  it('rollInt 在范围内', () => {
    const r = new DefaultRng();
    for (let i = 0; i < 100; i++) {
      const v = r.rollInt(1, 100);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

// ─── Dice ──────────────────────────────────────────────

describe('parseDice', () => {
  it('1d6 → count 1, sides 6', () => {
    expect(parseDice('1d6')).toEqual({ count: 1, sides: 6, modifier: 0 });
  });
  it('1d4+1 含 modifier', () => {
    expect(parseDice('1d4+1')).toEqual({ count: 1, sides: 4, modifier: 1 });
  });
  it('2d6-1 负 modifier', () => {
    expect(parseDice('2d6-1')).toEqual({ count: 2, sides: 6, modifier: -1 });
  });
  it('纯数字 → modifier only', () => {
    expect(parseDice('3')).toEqual({ count: 0, sides: 0, modifier: 3 });
  });
  it('无效记法报错', () => {
    expect(() => parseDice('garbage')).toThrow();
    expect(() => parseDice('0d6')).toThrow();
    expect(() => parseDice('1d0')).toThrow();
  });
});

describe('rollDice', () => {
  it('1d6 投出 4 → 总和 4', () => {
    const r = new ScriptedRng([4]);
    expect(rollDice('1d6', r)).toBe(4);
  });
  it('2d6+1 投出 [3, 5] → 9', () => {
    const r = new ScriptedRng([3, 5]);
    expect(rollDice('2d6+1', r)).toBe(9);
  });
  it('rollD100 投出 50', () => {
    const r = new ScriptedRng([50]);
    expect(rollD100(r)).toBe(50);
  });
});

// ─── Skill Check ───────────────────────────────────────

describe('effectiveTargetForDifficulty', () => {
  it('normal 不变', () => {
    expect(effectiveTargetForDifficulty(60, 'normal')).toBe(60);
  });
  it('hard 折半', () => {
    expect(effectiveTargetForDifficulty(60, 'hard')).toBe(30);
  });
  it('extreme 1/5', () => {
    expect(effectiveTargetForDifficulty(60, 'extreme')).toBe(12);
  });
});

describe('rollCheck · 基础结果分级 (target=60)', () => {
  const target = 60;
  it('roll=1 → critical_success', () => {
    const r = rollCheck({ target }, new ScriptedRng([1]));
    expect(r.outcome).toBe('critical_success');
    expect(r.succeeded).toBe(true);
  });
  it('roll=12 (=60/5) → extreme_success', () => {
    const r = rollCheck({ target }, new ScriptedRng([12]));
    expect(r.outcome).toBe('extreme_success');
  });
  it('roll=30 (=60/2) → hard_success', () => {
    const r = rollCheck({ target }, new ScriptedRng([30]));
    expect(r.outcome).toBe('hard_success');
  });
  it('roll=60 (= target) → success', () => {
    const r = rollCheck({ target }, new ScriptedRng([60]));
    expect(r.outcome).toBe('success');
  });
  it('roll=61 → failure', () => {
    const r = rollCheck({ target }, new ScriptedRng([61]));
    expect(r.outcome).toBe('failure');
    expect(r.succeeded).toBe(false);
  });
  it('roll=100 (target>=50) → fumble', () => {
    const r = rollCheck({ target }, new ScriptedRng([100]));
    expect(r.outcome).toBe('fumble');
  });
  it('roll=96 (target>=50) → 普通失败而非大失败', () => {
    const r = rollCheck({ target }, new ScriptedRng([96]));
    expect(r.outcome).toBe('failure');
  });
});

describe('rollCheck · 低 target (40) 的 fumble 范围', () => {
  it('target=40, roll=96 → fumble', () => {
    const r = rollCheck({ target: 40 }, new ScriptedRng([96]));
    expect(r.outcome).toBe('fumble');
  });
  it('target=40, roll=95 → 普通失败', () => {
    const r = rollCheck({ target: 40 }, new ScriptedRng([95]));
    expect(r.outcome).toBe('failure');
  });
});

describe('rollCheck · 难度修正', () => {
  it('hard 难度让原本 success 的变 fail', () => {
    // target=60, hard → effectiveTarget=30. roll=45 vs 30 → fail
    const r = rollCheck({ target: 60, difficulty: 'hard' }, new ScriptedRng([45]));
    expect(r.effectiveTarget).toBe(30);
    expect(r.succeeded).toBe(false);
  });
  it('extreme 难度让 hard_success 变 fail', () => {
    // target=60, extreme → effectiveTarget=12. roll=20 vs 12 → fail
    const r = rollCheck({ target: 60, difficulty: 'extreme' }, new ScriptedRng([20]));
    expect(r.effectiveTarget).toBe(12);
    expect(r.succeeded).toBe(false);
  });
});

describe('rollCheck · 越界保护', () => {
  it('target=0 报错', () => {
    expect(() => rollCheck({ target: 0 }, new ScriptedRng([1]))).toThrow();
  });
  it('target=101 报错', () => {
    expect(() => rollCheck({ target: 101 }, new ScriptedRng([1]))).toThrow();
  });
});

describe('rollCheck · 奖励骰 / 惩罚骰', () => {
  it('1 奖励骰：投 2 个十位，取低（个位 5；十位 3,7 → 取 3 → 35）', () => {
    // ScriptedRng 顺序: 个位5, 十位3, 十位7
    const r = rollCheck(
      { target: 60, bonusDice: 1 },
      new ScriptedRng([5, 3, 7]),
    );
    expect(r.roll).toBe(35);
  });
  it('1 惩罚骰：投 2 个十位，取高（个位 5；十位 3,7 → 取 7 → 75）', () => {
    const r = rollCheck(
      { target: 60, penaltyDice: 1 },
      new ScriptedRng([5, 3, 7]),
    );
    expect(r.roll).toBe(75);
  });
  it('1 bonus 1 penalty 互相抵消 → 普通投', () => {
    // net = 0, 应该投 1 个十位 1 个个位
    const r = rollCheck(
      { target: 60, bonusDice: 1, penaltyDice: 1 },
      new ScriptedRng([5, 3]),
    );
    expect(r.roll).toBe(35); // tens=3, ones=5
  });
  it('十位与个位都是 0 → roll=100', () => {
    const r = rollCheck(
      { target: 60 },
      new ScriptedRng([100]), // 直接喂 100
    );
    expect(r.roll).toBe(100);
  });
});

// ─── Sanity ────────────────────────────────────────────

describe('rollSanityCheck', () => {
  it('roll 通过 → 损失 lossOnSuccess', () => {
    const r = rollSanityCheck(
      {
        currentSanity: 65,
        lossOnSuccess: 0,
        lossOnFailureRoll: '1d6',
        reason: '看到尸体',
      },
      new ScriptedRng([30]), // 30 <= 65 → 通过
    );
    expect(r.succeeded).toBe(true);
    expect(r.actualLoss).toBe(0);
    expect(r.remainingSanity).toBe(65);
    expect(r.triggersTempInsanity).toBe(false);
  });
  it('roll 失败 → 投损失骰', () => {
    const r = rollSanityCheck(
      {
        currentSanity: 65,
        lossOnSuccess: 0,
        lossOnFailureRoll: '1d6',
        reason: 'X',
      },
      new ScriptedRng([90, 4]), // d100=90 失败, d6=4 损失
    );
    expect(r.succeeded).toBe(false);
    expect(r.actualLoss).toBe(4);
    expect(r.remainingSanity).toBe(61);
  });
  it('单次损失 >= 5 触发临时心智失常', () => {
    const r = rollSanityCheck(
      {
        currentSanity: 65,
        lossOnSuccess: 0,
        lossOnFailureRoll: '1d6+5',
        reason: 'X',
      },
      new ScriptedRng([90, 3]), // 失败 + d6=3 → 3+5=8 损失
    );
    expect(r.actualLoss).toBe(8);
    expect(r.triggersTempInsanity).toBe(true);
  });
  it('lossOnFailureRoll 为固定数字（不投骰）', () => {
    const r = rollSanityCheck(
      {
        currentSanity: 65,
        lossOnSuccess: 1,
        lossOnFailureRoll: 10,
        reason: 'X',
      },
      new ScriptedRng([99]),
    );
    expect(r.actualLoss).toBe(10);
  });
});

describe('applySanityLoss', () => {
  it('更新 currentSanity', () => {
    const c = makeChar();
    const before = c.currentSanity;
    applySanityLoss(
      c,
      {
        roll: 90,
        threshold: before,
        succeeded: false,
        actualLoss: 3,
        remainingSanity: before - 3,
        triggersTempInsanity: false,
        triggersIndefInsanity: false,
        ts: 0,
        reason: 'X',
      },
    );
    expect(c.currentSanity).toBe(before - 3);
  });
  it('临时心智失常 → 加 condition', () => {
    const c = makeChar();
    applySanityLoss(c, {
      roll: 90,
      threshold: c.currentSanity,
      succeeded: false,
      actualLoss: 6,
      remainingSanity: c.currentSanity - 6,
      triggersTempInsanity: true,
      triggersIndefInsanity: false,
      ts: 0,
      reason: '看到尸体',
    });
    expect(c.conditions.some((cnd) => cnd.type === 'temp_insanity')).toBe(true);
  });
  it('单次损失 >= maxSanity/5 → 长期心智失常 condition', () => {
    const c = makeChar(); // maxSanity=70, 1/5=14
    const r = applySanityLoss(c, {
      roll: 99,
      threshold: c.currentSanity,
      succeeded: false,
      actualLoss: 15, // >= 14
      remainingSanity: c.currentSanity - 15,
      triggersTempInsanity: true,
      triggersIndefInsanity: false,
      ts: 0,
      reason: '看到 Cthulhu',
    });
    expect(r.triggersIndefInsanity).toBe(true);
    expect(c.conditions.some((cnd) => cnd.type === 'indef_insanity')).toBe(true);
  });
});

// ─── Damage ────────────────────────────────────────────

describe('applyDamage', () => {
  it('普通伤害扣 HP + 加 minor_wound', () => {
    const c = makeChar(); // maxHp=(60+60)/10=12, 重伤阈值 6
    const r = applyDamage(c, { amount: 3, source: '刀伤', physical: true });
    expect(r.actualDamage).toBe(3);
    expect(r.remainingHp).toBe(9);
    expect(r.triggeredConditions).toContain('minor_wound');
  });
  it('单次 >= maxHp/2 → major_wound', () => {
    const c = makeChar(); // maxHp=12, 阈值 6
    const r = applyDamage(c, { amount: 7, source: '枪伤', physical: true });
    expect(r.triggeredConditions).toContain('major_wound');
    expect(c.conditions.some((cnd) => cnd.type === 'major_wound')).toBe(true);
  });
  it('HP 扣到 0 → unconscious + dying', () => {
    const c = makeChar();
    const r = applyDamage(c, { amount: 100, source: '陷阱', physical: true });
    expect(r.remainingHp).toBe(0);
    expect(r.triggeredConditions).toContain('unconscious');
    expect(r.triggeredConditions).toContain('dying');
    expect(c.currentHp).toBe(0);
  });
  it('非物理伤害（精神/中毒）不触发 major_wound', () => {
    const c = makeChar();
    const r = applyDamage(c, { amount: 8, source: '剧毒', physical: false });
    expect(r.triggeredConditions).not.toContain('major_wound');
  });
  it('actualDamage 不超过当前 HP', () => {
    const c = makeChar();
    c.currentHp = 3;
    const r = applyDamage(c, { amount: 100, source: 'X' });
    expect(r.actualDamage).toBe(3);
    expect(r.remainingHp).toBe(0);
  });
});

describe('healHp / hasCondition', () => {
  it('healHp 不超过 maxHp', () => {
    const c = makeChar();
    c.currentHp = 5;
    const restored = healHp(c, 100);
    expect(restored).toBe(c.maxHp - 5);
    expect(c.currentHp).toBe(c.maxHp);
  });
  it('hasCondition 检测', () => {
    const c = makeChar();
    c.conditions.push({ type: 'major_wound', source: 'X', appliedAt: 0 });
    expect(hasCondition(c, 'major_wound')).toBe(true);
    expect(hasCondition(c, 'temp_insanity')).toBe(false);
  });
});
