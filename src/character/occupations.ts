// COC 7e 职业模板 —— V0 列 8 个最常见的
//
// 职业技能点公式因人而异，COC 7e 规则书给每个职业一个公式（如 EDU×4 / EDU×2 + DEX×2 等）。
// 我们用最稳的"EDU×4"作为 V0 简化（绝大多数职业都是这个）。

import type { Attribute } from '../types/character.js';

export interface OccupationTemplate {
  id: string;
  nameZh: string;
  nameEn: string;
  /** 职业技能点公式系数（key 是 attribute，value 是乘数）*/
  skillPointFormula: Partial<Record<Attribute, number>>;
  /** 职业关键技能 key 列表（用于自动加点 / 检定提示）*/
  occupationalSkills: string[];
  /** 信用评级范围（COC 7e 概念：credit_rating skill），如 9-30 (普通工人) / 30-60 (中产)*/
  creditRatingMin: number;
  creditRatingMax: number;
  /** 给 LLM 看的人设描述提示 */
  flavor: string;
}

/** V0 8 个职业模板（来自 COC 7e 核心规则书） */
export const OCCUPATIONS: ReadonlyArray<OccupationTemplate> = [
  {
    id: 'doctor',
    nameZh: '医生',
    nameEn: 'Doctor of Medicine',
    skillPointFormula: { EDU: 4 },
    occupationalSkills: [
      'first_aid', 'medicine', 'psychology', 'language_other',
      'science', 'sleight_of_hand', 'spot_hidden', 'language_own',
    ],
    creditRatingMin: 30,
    creditRatingMax: 80,
    flavor: '受过专业医学训练，能识别疾病、急救伤者。在恐怖故事里是冷静的理性派，但医学认知也让他更清楚某些事不该存在。',
  },
  {
    id: 'journalist',
    nameZh: '记者',
    nameEn: 'Journalist',
    skillPointFormula: { EDU: 4 },
    occupationalSkills: [
      'fast_talk', 'history', 'language_own', 'library_use',
      'persuade', 'psychology', 'spot_hidden', 'language_other',
    ],
    creditRatingMin: 9,
    creditRatingMax: 30,
    flavor: '靠笔吃饭，跟陌生人套话的能力比常人强。会因为"有故事可写"主动钻进危险，对怪异事件嗅觉敏锐。',
  },
  {
    id: 'police',
    nameZh: '警察',
    nameEn: 'Police Detective',
    skillPointFormula: { EDU: 2, STR: 2 },
    occupationalSkills: [
      'firearms_handgun', 'fighting', 'law', 'psychology',
      'spot_hidden', 'stealth', 'intimidate', 'persuade',
    ],
    creditRatingMin: 20,
    creditRatingMax: 50,
    flavor: '受过执法训练，会用枪也会查证物。习惯用"程序正义"思维处理事情，但在克苏鲁神话面前可能用不上。',
  },
  {
    id: 'scholar',
    nameZh: '学者',
    nameEn: 'Academic',
    skillPointFormula: { EDU: 4 },
    occupationalSkills: [
      'library_use', 'language_other', 'language_own', 'history',
      'occult', 'science', 'psychology', 'law',
    ],
    creditRatingMin: 20,
    creditRatingMax: 70,
    flavor: '在图书馆与象牙塔里度过大半人生，擅长查阅古籍与解读符号。可能正是这种 curiosity 让他撞上禁忌知识。',
  },
  {
    id: 'private_eye',
    nameZh: '私家侦探',
    nameEn: 'Private Investigator',
    skillPointFormula: { EDU: 2, STR: 2 },
    occupationalSkills: [
      'art_craft_photography', 'disguise', 'law', 'library_use',
      'psychology', 'spot_hidden', 'stealth', 'firearms_handgun',
    ],
    creditRatingMin: 9,
    creditRatingMax: 30,
    flavor: '靠跟踪、伪装、敲门问话维生。常年在灰色地带打转，对"看上去不对劲的事"已经麻木 —— 直到他遇到这次。',
  },
  {
    id: 'antiquarian',
    nameZh: '古董商',
    nameEn: 'Antiquarian',
    skillPointFormula: { EDU: 4 },
    occupationalSkills: [
      'appraise', 'art_craft', 'history', 'library_use',
      'language_other', 'spot_hidden', 'navigate', 'occult',
    ],
    creditRatingMin: 30,
    creditRatingMax: 70,
    flavor: '懂得辨别真品赝品，常出入古宅、拍卖会、私人收藏。"那本不该存在的书"很可能正是他的客户托他找的。',
  },
  {
    id: 'priest',
    nameZh: '牧师',
    nameEn: 'Priest',
    skillPointFormula: { EDU: 4 },
    occupationalSkills: [
      'accounting', 'history', 'language_other', 'language_own',
      'library_use', 'listen', 'psychology', 'occult',
    ],
    creditRatingMin: 9,
    creditRatingMax: 60,
    flavor: '受过神学教育，听过太多人的告解。他的"信仰"在面对真正的神话存在时会受到根本动摇。',
  },
  {
    id: 'student',
    nameZh: '大学生',
    nameEn: 'Student / Intern',
    skillPointFormula: { EDU: 4 },
    occupationalSkills: [
      'language_other', 'language_own', 'library_use', 'history',
      'psychology', 'science', 'spot_hidden', 'computer_use',
    ],
    creditRatingMin: 5,
    creditRatingMax: 10,
    flavor: '20 岁出头，知识储备丰富但社会经验不足。冲动、好奇心强、可能为了"做选题"踏进不该去的地方。',
  },
];

/** 职业 ID → 模板 */
export function getOccupation(id: string): OccupationTemplate | undefined {
  return OCCUPATIONS.find((o) => o.id === id);
}

/**
 * 计算某职业给某属性的"职业技能点总数"
 * @example skillPoints({ EDU: 4 }, { EDU: 80, STR: 50, ... }) → 320
 */
export function calculateOccupationalSkillPoints(
  occupation: OccupationTemplate,
  attributes: Record<Attribute, number>,
): number {
  let total = 0;
  for (const [attr, mult] of Object.entries(occupation.skillPointFormula)) {
    total += (attributes[attr as Attribute] ?? 0) * mult;
  }
  return total;
}

/** 兴趣技能点 = INT × 2，COC 7e 通用 */
export function calculateInterestSkillPoints(attributes: Record<Attribute, number>): number {
  return attributes.INT * 2;
}
