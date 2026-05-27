// COC 7e 通用技能表 —— V0 选最常用的 30 个
//
// 每个技能有 base 值（不学就有的最低值）+ 派生公式（基于属性）。
// 玩家创角时往这些技能上加点（职业点 + 兴趣点）。

import type { Attribute } from '../types/character.js';

export interface SkillDef {
  key: string;
  nameZh: string;
  /** 起始基础值（不分点也有的最低值，如 spot_hidden 起 25）*/
  baseValue: number;
  /** 如果有派生公式（如 dodge = DEX/2），优先用公式 */
  derived?: { attribute: Attribute; multiplier: number };
}

export const COC7_SKILLS: ReadonlyArray<SkillDef> = [
  // 感官 / 探查
  { key: 'spot_hidden', nameZh: '侦查', baseValue: 25 },
  { key: 'listen', nameZh: '聆听', baseValue: 20 },
  { key: 'psychology', nameZh: '心理学', baseValue: 10 },
  { key: 'track', nameZh: '追踪', baseValue: 10 },

  // 社交
  { key: 'persuade', nameZh: '说服', baseValue: 10 },
  { key: 'fast_talk', nameZh: '话术', baseValue: 5 },
  { key: 'charm', nameZh: '魅惑', baseValue: 15 },
  { key: 'intimidate', nameZh: '恐吓', baseValue: 15 },

  // 战斗
  { key: 'firearms_handgun', nameZh: '手枪', baseValue: 20 },
  { key: 'firearms_rifle', nameZh: '步枪/霰弹', baseValue: 25 },
  { key: 'fighting', nameZh: '近战格斗', baseValue: 25 },
  { key: 'dodge', nameZh: '闪避', baseValue: 0, derived: { attribute: 'DEX', multiplier: 0.5 } },

  // 知识
  { key: 'library_use', nameZh: '图书馆使用', baseValue: 20 },
  { key: 'history', nameZh: '历史', baseValue: 5 },
  { key: 'law', nameZh: '法律', baseValue: 5 },
  { key: 'science', nameZh: '科学', baseValue: 1 },
  { key: 'medicine', nameZh: '医学', baseValue: 1 },
  { key: 'occult', nameZh: '神秘学', baseValue: 5 },
  { key: 'language_own', nameZh: '母语', baseValue: 0, derived: { attribute: 'EDU', multiplier: 1 } },
  { key: 'language_other', nameZh: '其他语言', baseValue: 1 },

  // 行动
  { key: 'stealth', nameZh: '潜行', baseValue: 20 },
  { key: 'sneak', nameZh: '隐匿', baseValue: 20 },
  { key: 'climb', nameZh: '攀爬', baseValue: 20 },
  { key: 'jump', nameZh: '跳跃', baseValue: 20 },
  { key: 'swim', nameZh: '游泳', baseValue: 20 },
  { key: 'throw', nameZh: '投掷', baseValue: 20 },

  // 实用 / 杂项
  { key: 'first_aid', nameZh: '急救', baseValue: 30 },
  { key: 'locksmith', nameZh: '锁匠', baseValue: 1 },
  { key: 'drive_auto', nameZh: '驾驶 (汽车)', baseValue: 20 },
  { key: 'appraise', nameZh: '估价', baseValue: 5 },
  { key: 'navigate', nameZh: '导航', baseValue: 10 },
  { key: 'sleight_of_hand', nameZh: '巧手', baseValue: 10 },
  { key: 'art_craft', nameZh: '艺术/工艺', baseValue: 5 },
  { key: 'art_craft_photography', nameZh: '艺术/摄影', baseValue: 5 },
  { key: 'accounting', nameZh: '会计', baseValue: 5 },
  { key: 'disguise', nameZh: '伪装', baseValue: 5 },
  { key: 'computer_use', nameZh: '电脑使用', baseValue: 1 },
];

/** 计算技能起始基础值（处理 derived 公式）*/
export function baseSkillValue(
  def: SkillDef,
  attributes: Record<Attribute, number>,
): number {
  if (def.derived) {
    return Math.floor((attributes[def.derived.attribute] ?? 0) * def.derived.multiplier);
  }
  return def.baseValue;
}

/** 按 key 查技能定义 */
export function getSkillDef(key: string): SkillDef | undefined {
  return COC7_SKILLS.find((s) => s.key === key);
}
