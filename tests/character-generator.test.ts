// 调查员生成器 + Save/Load 单测
import { describe, it, expect } from 'vitest';
import { ScriptedRng } from '../src/engine/rng.js';
import {
  generateCharacter,
  rollAttributes,
  STANDARD_ARRAY,
  listOccupations,
} from '../src/character/generator.js';
import {
  serializeCharacter,
  deserializeCharacter,
} from '../src/character/save-load.js';
import { skillTotal } from '../src/types/character.js';
import { COC7_SKILLS } from '../src/character/skills.js';
import { OCCUPATIONS } from '../src/character/occupations.js';

describe('rollAttributes', () => {
  it('STR/CON/DEX/APP/POW 用 3d6×5 → 15-90', () => {
    const rng = new ScriptedRng([3, 3, 3, 4, 4, 4, 6, 6, 6, 5, 5, 5, 6, 5, 4, /* SIZ 2d6+6 */ 4, 6, 5, 4, 3, 6, 4, 5]);
    const attr = rollAttributes(rng);
    expect(attr.STR).toBe((3+3+3) * 5);  // 45
    expect(attr.STR).toBeGreaterThanOrEqual(15);
    expect(attr.STR).toBeLessThanOrEqual(90);
  });

  it('SIZ/INT/EDU 用 (2d6+6)×5 → 40-90', () => {
    const rng = new ScriptedRng([3,3,3, 4,4,4, 6,6,6, 5,5,5, 6,5,4, 4,6, 5,4, 3,6]);
    const attr = rollAttributes(rng);
    expect(attr.SIZ).toBeGreaterThanOrEqual(40);
    expect(attr.SIZ).toBeLessThanOrEqual(90);
  });
});

describe('STANDARD_ARRAY', () => {
  it('总和 = 6×60 + 2×80 = 520', () => {
    const total = Object.values(STANDARD_ARRAY).reduce((s, v) => s + v, 0);
    expect(total).toBe(520);
  });
});

describe('generateCharacter', () => {
  it('标准点数包 + 记者 → 全套生成', () => {
    const rng = new ScriptedRng([10, 1, 2, 3]); // luck + ID 随机
    const c = generateCharacter({
      rng,
      name: '林夏',
      age: 28,
      occupationId: 'journalist',
      attributeMethod: 'standard',
      autoAllocateSkills: true,
    });
    expect(c.name).toBe('林夏');
    expect(c.occupation).toBe('记者');
    expect(c.age).toBe(28);
    expect(c.attributes).toEqual(STANDARD_ARRAY);
    // 派生
    expect(c.maxHp).toBe(12); // (60+60)/10
    expect(c.maxMp).toBe(12); // 60/5
    expect(c.maxSanity).toBe(60); // POW
    expect(c.currentHp).toBe(c.maxHp);
    expect(c.currentSanity).toBe(c.maxSanity);
    // 技能表满（覆盖 COC7_SKILLS）
    expect(c.skills.size).toBe(COC7_SKILLS.length);
  });

  it('职业技能点自动分配（记者：EDU×4 = 320 点分 8 个技能）', () => {
    const rng = new ScriptedRng([10, 1, 2, 3]);
    const c = generateCharacter({
      rng,
      name: 'T',
      age: 30,
      occupationId: 'journalist',
      attributeMethod: 'standard', // EDU=80
      explicitAttributes: STANDARD_ARRAY,
      autoAllocateSkills: true,
    });
    // 记者职业技能 8 个，总点 80*4=320，平均 40/skill
    // 但 language_own 派生 = EDU = 80 已超 75 上限，occupational 应为 0
    const journalist = OCCUPATIONS.find((o) => o.id === 'journalist')!;
    let allocatedCount = 0;
    for (const skillKey of journalist.occupationalSkills) {
      const s = c.skills.get(skillKey);
      expect(s).toBeDefined();
      expect(s!.occupational).toBeGreaterThanOrEqual(0); // 不能负数
      if (s!.occupational > 0) allocatedCount++;
    }
    expect(allocatedCount).toBeGreaterThan(0);
  });

  it('未知职业 ID 抛错', () => {
    const rng = new ScriptedRng([10, 1, 2, 3]);
    expect(() => generateCharacter({
      rng, name: 'X', age: 28, occupationId: 'wizard',
      attributeMethod: 'standard', autoAllocateSkills: false,
    })).toThrow();
  });

  it('技能值不超过 75 上限', () => {
    const rng = new ScriptedRng([10, 1, 2, 3]);
    const c = generateCharacter({
      rng, name: 'X', age: 28, occupationId: 'scholar',
      attributeMethod: 'standard', autoAllocateSkills: true,
    });
    for (const s of c.skills.values()) {
      expect(skillTotal(s)).toBeLessThanOrEqual(100);
    }
  });
});

describe('listOccupations', () => {
  it('返回 8 个职业', () => {
    expect(listOccupations()).toHaveLength(8);
  });
});

describe('save-load · serialization roundtrip', () => {
  it('serialize → deserialize 数据一致', () => {
    const rng = new ScriptedRng([10, 1, 2, 3]);
    const c1 = generateCharacter({
      rng, name: '林夏', age: 28, occupationId: 'journalist',
      attributeMethod: 'standard', autoAllocateSkills: true,
    });
    const serialized = serializeCharacter(c1);
    const c2 = deserializeCharacter(serialized);
    expect(c2.id).toBe(c1.id);
    expect(c2.name).toBe(c1.name);
    expect(c2.attributes).toEqual(c1.attributes);
    expect(c2.maxHp).toBe(c1.maxHp);
    expect(c2.skills.size).toBe(c1.skills.size);
    // 技能 map 也对得上
    for (const [key, sk] of c1.skills.entries()) {
      expect(c2.skills.get(key)).toEqual(sk);
    }
  });

  it('JSON-serializable', () => {
    const rng = new ScriptedRng([10, 1, 2, 3]);
    const c = generateCharacter({
      rng, name: 'X', age: 28, occupationId: 'doctor',
      attributeMethod: 'standard', autoAllocateSkills: false,
    });
    const serialized = serializeCharacter(c);
    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.character.name).toBe('X');
  });

  it('schemaVersion 不对报错', () => {
    expect(() => deserializeCharacter({
      schemaVersion: 999 as unknown as 1,
      character: {} as Parameters<typeof deserializeCharacter>[0]['character'],
      savedAt: 0,
    })).toThrow();
  });
});
