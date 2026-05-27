// 调查员生成器 —— 投属性 / 选职业 / 算派生
//
// 用法：
//   import { generateRandomCharacter } from './generator.js';
//   const c = generateRandomCharacter({ rng, name: '林夏', occupationId: 'journalist' });
//
// V0 用 COC 7e 标准投点（3d6×5 / (2d6+6)×5）。

import type { Attribute, Character } from '../types/character.js';
import { recomputeDerivedStats } from '../types/character.js';
import { rollDice } from '../engine/dice.js';
import type { Rng } from '../engine/rng.js';
import {
  getOccupation,
  OCCUPATIONS,
  type OccupationTemplate,
} from './occupations.js';
import { COC7_SKILLS, baseSkillValue, type SkillDef } from './skills.js';

// ─── 属性投点 ─────────────────────────────────────────

/**
 * COC 7e 标准投点：
 *   STR/CON/DEX/APP/POW: 3d6 × 5
 *   SIZ/INT/EDU:         (2d6+6) × 5
 */
export function rollAttributes(rng: Rng): Record<Attribute, number> {
  const v3d6 = () => rollDice('3d6', rng) * 5;
  const v2d6p6 = () => (rollDice('2d6', rng) + 6) * 5;
  return {
    STR: v3d6(),
    CON: v3d6(),
    DEX: v3d6(),
    APP: v3d6(),
    POW: v3d6(),
    SIZ: v2d6p6(),
    INT: v2d6p6(),
    EDU: v2d6p6(),
  };
}

/** 标准点数包（让玩家不投随机骰）—— 来自 COC 7e Investigator Handbook */
export const STANDARD_ARRAY: Record<Attribute, number> = {
  STR: 60, CON: 60, DEX: 60, APP: 60, POW: 60,
  SIZ: 60, INT: 80, EDU: 80,
};

// ─── 创角主流程 ────────────────────────────────────────

export interface GenerateCharacterParams {
  rng: Rng;
  /** 角色名 */
  name: string;
  /** 职业 ID（OCCUPATIONS 里的）*/
  occupationId: string;
  /** 年龄 */
  age: number;
  /** 性别（可选）*/
  gender?: string;
  /** 属性方案：random = 投骰 / standard = 标准点数包 / explicit = 调用方传入 */
  attributeMethod?: 'random' | 'standard';
  /** explicit 模式直接给属性 */
  explicitAttributes?: Record<Attribute, number>;
  /** 是否自动分配技能点（V0 = 平均分给职业技能，留 W9.2 玩家手动分）*/
  autoAllocateSkills?: boolean;
}

/**
 * 创建一个完整的 Character。
 */
export function generateCharacter(params: GenerateCharacterParams): Character {
  // 1. 属性
  let attributes: Record<Attribute, number>;
  if (params.explicitAttributes) {
    attributes = params.explicitAttributes;
  } else if (params.attributeMethod === 'standard') {
    attributes = { ...STANDARD_ARRAY };
  } else {
    attributes = rollAttributes(params.rng);
  }

  // 2. 职业
  const occupation = getOccupation(params.occupationId);
  if (!occupation) {
    throw new Error(`未知职业 ID: ${params.occupationId}`);
  }

  // 3. 基础 Character 骨架
  const c: Character = {
    id: `char_${Date.now()}_${Math.floor(params.rng.next() * 10000)}`,
    name: params.name,
    occupation: occupation.nameZh,
    age: params.age,
    ...(params.gender !== undefined ? { gender: params.gender } : {}),
    attributes,
    maxHp: 0, maxMp: 0, maxSanity: 0,
    currentHp: 0, currentMp: 0, currentSanity: 0,
    luck: rollDice('3d6', params.rng) * 5,
    movement: 0, dodge: 0, brawl: 0,
    skills: new Map(),
    inventory: [],
    conditions: [],
  };

  // 4. 初始化技能表（所有技能用 baseSkillValue 算基础值）
  for (const skillDef of COC7_SKILLS) {
    c.skills.set(skillDef.key, {
      key: skillDef.key,
      name: skillDef.nameZh,
      base: baseSkillValue(skillDef, attributes),
      occupational: 0,
      personal: 0,
      experienced: false,
    });
  }

  // 5. 派生值（HP / MP / Sanity / Dodge / Brawl / Move）
  recomputeDerivedStats(c);
  c.currentHp = c.maxHp;
  c.currentMp = c.maxMp;
  c.currentSanity = c.maxSanity;

  // 6. 自动分配技能点（V0 平均分给职业技能）
  if (params.autoAllocateSkills !== false) {
    allocateOccupationalSkillsEvenly(c, occupation);
  }

  return c;
}

/** 把职业技能点平均分给职业技能 */
function allocateOccupationalSkillsEvenly(
  c: Character,
  occupation: OccupationTemplate,
): void {
  // 计算职业技能点总数
  let total = 0;
  for (const [attr, mult] of Object.entries(occupation.skillPointFormula)) {
    total += (c.attributes[attr as Attribute] ?? 0) * mult;
  }
  const perSkill = Math.floor(total / occupation.occupationalSkills.length);

  for (const skillKey of occupation.occupationalSkills) {
    const skill = c.skills.get(skillKey);
    if (skill) {
      // 单技能上限通常 75 + 职业增益（V0 简化：不超过 75）
      // 已经超 75 的派生技能（如 language_own = EDU = 80）就不再加 occupational 点
      const cap = Math.max(0, 75 - skill.base);
      skill.occupational = Math.min(perSkill, cap);
    }
  }
}

// ─── 辅助 ──────────────────────────────────────────────

export function listOccupations(): ReadonlyArray<OccupationTemplate> {
  return OCCUPATIONS;
}

export function listSkills(): ReadonlyArray<SkillDef> {
  return COC7_SKILLS;
}
