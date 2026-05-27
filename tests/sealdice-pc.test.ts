// 海豹 .pc 互导单测
import { describe, it, expect } from 'vitest';
import { ScriptedRng } from '../src/engine/rng.js';
import { generateCharacter, STANDARD_ARRAY } from '../src/character/generator.js';
import {
  exportToSealdice,
  importFromSealdice,
  ATTRIBUTE_EN_TO_ZH,
  SKILL_ZH_TO_EN,
} from '../src/adapter/sealdice-pc.js';
import { skillTotal } from '../src/types/character.js';

function makeJournalist() {
  const rng = new ScriptedRng([10, 1, 2, 3]);
  return generateCharacter({
    rng, name: '林夏', age: 28, gender: '女',
    occupationId: 'journalist',
    attributeMethod: 'standard',
    explicitAttributes: STANDARD_ARRAY,
    autoAllocateSkills: true,
  });
}

// ─── 映射表 ────────────────────────────────────────

describe('属性中英映射', () => {
  it('8 项属性都有中文规范名', () => {
    expect(Object.keys(ATTRIBUTE_EN_TO_ZH)).toEqual(['STR', 'DEX', 'CON', 'SIZ', 'POW', 'INT', 'APP', 'EDU']);
    expect(ATTRIBUTE_EN_TO_ZH.STR).toBe('力量');
    expect(ATTRIBUTE_EN_TO_ZH.EDU).toBe('教育');
  });
});

describe('技能映射', () => {
  it('侦查 ↔ spot_hidden', () => {
    expect(SKILL_ZH_TO_EN['侦查']).toBe('spot_hidden');
  });
  it('图书馆使用 ↔ library_use', () => {
    expect(SKILL_ZH_TO_EN['图书馆使用']).toBe('library_use');
  });
});

// ─── exportToSealdice ─────────────────────────────────

describe('exportToSealdice', () => {
  it('顶层字段对', () => {
    const c = makeJournalist();
    const card = exportToSealdice(c);
    expect(card.id).toBe(c.id);
    expect(card.name).toBe('林夏');
    expect(card.sheetType).toBe('coc7');
  });

  it('属性用中文名写入', () => {
    const c = makeJournalist();
    const card = exportToSealdice(c);
    expect(card.data['力量']).toBe(60);
    expect(card.data['教育']).toBe(80);
    expect(card.data['STR']).toBeUndefined();
  });

  it('派生用 $-prefix', () => {
    const c = makeJournalist();
    const card = exportToSealdice(c);
    expect(card.data['$maxhp']).toBe(12);
    expect(card.data['$maxsan']).toBe(60);
    expect(card.data['$mov']).toBe(8);
  });

  it('只导职业 / 兴趣加过点的技能', () => {
    const c = makeJournalist();
    const card = exportToSealdice(c);
    // 记者职业技能 (spot_hidden / library_use 等) 应该有 → 中文 "侦查" / "图书馆使用"
    expect(card.data['侦查']).toBeGreaterThan(0);
    expect(card.data['图书馆使用']).toBeGreaterThan(0);
    // 没加点的技能不应导出（如 climb, jump）
    expect(card.data['攀爬']).toBeUndefined();
    expect(card.data['跳跃']).toBeUndefined();
  });

  it('职业 / 年龄 / 性别', () => {
    const c = makeJournalist();
    const card = exportToSealdice(c);
    expect(card.data['职业']).toBe('记者');
    expect(card.data['年龄']).toBe(28);
    expect(card.data['性别']).toBe('女');
  });
});

// ─── importFromSealdice ────────────────────────────────

describe('importFromSealdice', () => {
  it('解析海豹 JSON 还原 Character', () => {
    const card = {
      id: 'sealchar1',
      name: '老王',
      sheetType: 'coc7' as const,
      data: {
        '力量': 70, '敏捷': 60, '体质': 60, '体型': 60,
        '意志': 70, '智力': 70, '外貌': 50, '教育': 80,
        '侦查': 65, '图书馆使用': 60,
        '$hp': 12, '$maxhp': 12, '$maxsan': 70, '$san': 70,
        '职业': '私家侦探', '年龄': 45, '性别': '男',
      },
    };
    const c = importFromSealdice(card);
    expect(c.id).toBe('sealchar1');
    expect(c.name).toBe('老王');
    expect(c.attributes.STR).toBe(70);
    expect(c.attributes.EDU).toBe(80);
    expect(c.occupation).toBe('私家侦探');
    expect(c.age).toBe(45);
    expect(c.gender).toBe('男');
    expect(c.maxHp).toBe(12);
    expect(c.maxSanity).toBe(70);
    // 侦查 65 = 25 base + 40 occupational
    const spot = c.skills.get('spot_hidden')!;
    expect(skillTotal(spot)).toBe(65);
  });

  it('sheetType 不对报错', () => {
    expect(() => importFromSealdice({
      id: 'x', name: 'X', sheetType: 'dnd5' as 'coc7', data: {},
    })).toThrow();
  });
});

// ─── Roundtrip ────────────────────────────────────────

describe('roundtrip · export → import 还原一致', () => {
  it('属性 / 派生 / 技能加点都对齐', () => {
    const c1 = makeJournalist();
    const card = exportToSealdice(c1);
    const c2 = importFromSealdice(card);

    expect(c2.name).toBe(c1.name);
    expect(c2.occupation).toBe(c1.occupation);
    expect(c2.age).toBe(c1.age);
    expect(c2.gender).toBe(c1.gender);
    expect(c2.attributes).toEqual(c1.attributes);
    expect(c2.maxHp).toBe(c1.maxHp);
    expect(c2.maxSanity).toBe(c1.maxSanity);

    // 记者职业技能 total 应该对齐
    const skillsToCheck = ['spot_hidden', 'library_use', 'psychology', 'fast_talk'];
    for (const k of skillsToCheck) {
      expect(skillTotal(c2.skills.get(k)!)).toBe(skillTotal(c1.skills.get(k)!));
    }
  });
});
