// 海豹骰 .pc 角色卡格式互导
//
// 海豹的角色卡 JSON 大约长这样（推断自 sealdice-core 代码 + 测试）：
//   {
//     "id": "char_xxx",
//     "name": "林夏",
//     "sheetType": "coc7",
//     "data": {
//       "力量": 60,
//       "敏捷": 60,
//       ...
//       "侦查": 65,
//       "聆听": 20,
//       "$hp": 12,
//       "$maxhp": 12,
//       "$san": 60,
//       "$maxsan": 60
//     }
//   }
//
// 我们做：
//   exportToSealdice(c): 把 Character → 海豹 JSON
//   importFromSealdice(json): 把海豹 JSON → Character
//
// 实测前提：海豹"接受英文别名"，所以即使 key 不全规范也能加载。
// 但写出去时用中文规范名最稳。

import type { Attribute, Character, Skill } from '../types/character.js';
import { recomputeDerivedStats } from '../types/character.js';
import { COC7_SKILLS, getSkillDef, baseSkillValue } from '../character/skills.js';

// ─── 中英映射 ─────────────────────────────────────────

/** 8 个基础属性 中文规范名 ↔ 英文 key */
export const ATTRIBUTE_ZH_TO_EN: Record<string, Attribute> = {
  '力量': 'STR',
  '敏捷': 'DEX',
  '体质': 'CON',
  '体型': 'SIZ',
  '意志': 'POW',
  '智力': 'INT',
  '外貌': 'APP',
  '教育': 'EDU',
};

export const ATTRIBUTE_EN_TO_ZH: Record<Attribute, string> = {
  STR: '力量', DEX: '敏捷', CON: '体质', SIZ: '体型',
  POW: '意志', INT: '智力', APP: '外貌', EDU: '教育',
};

/** 技能 中文 ↔ 英文 key（从 COC7_SKILLS 自动构造）*/
export const SKILL_ZH_TO_EN: Record<string, string> = Object.fromEntries(
  COC7_SKILLS.map((s) => [s.nameZh, s.key]),
);

// ─── 海豹 JSON 接口 ────────────────────────────────────

export interface SealdiceCharacterCard {
  id: string;
  name: string;
  sheetType: 'coc7';
  data: Record<string, number | string>;
}

// ─── Export: Character → 海豹 ──────────────────────────

/**
 * 把 Character 导出成海豹的 .pc 格式 JSON。
 *
 * 输出 key 用中文规范名（"力量" / "侦查" / "$hp"），海豹也接受英文别名。
 */
export function exportToSealdice(c: Character): SealdiceCharacterCard {
  const data: Record<string, number | string> = {};

  // 属性
  for (const [en, zh] of Object.entries(ATTRIBUTE_EN_TO_ZH)) {
    data[zh] = c.attributes[en as Attribute];
  }

  // 派生值（海豹用 $ 前缀）
  data['$hp'] = c.currentHp;
  data['$maxhp'] = c.maxHp;
  data['$mp'] = c.currentMp;
  data['$maxmp'] = c.maxMp;
  data['$san'] = c.currentSanity;
  data['$maxsan'] = c.maxSanity;
  data['$luck'] = c.luck;
  data['$dodge'] = c.dodge;
  data['$mov'] = c.movement;

  // 技能（只导有 occupational + personal 加点的，避免 200 项基础值挤爆）
  for (const skill of c.skills.values()) {
    const total = skill.base + skill.occupational + skill.personal;
    // 只导出"有意义的"：跟纯派生 base 不一样的，或职业/兴趣加过点的
    if (skill.occupational > 0 || skill.personal > 0) {
      data[skill.name] = total;
    }
  }

  // 元数据
  if (c.occupation) data['职业'] = c.occupation;
  if (c.age) data['年龄'] = c.age;
  if (c.gender) data['性别'] = c.gender;

  return {
    id: c.id,
    name: c.name,
    sheetType: 'coc7',
    data,
  };
}

// ─── Import: 海豹 → Character ──────────────────────────

/**
 * 把海豹 .pc 格式 JSON 导入成 Character。
 *
 * 接受中文规范 key（力量）和英文别名（STR）混用。
 * 派生值（$hp/$san）会优先用 JSON 里的；JSON 没的就 recompute。
 */
export function importFromSealdice(card: SealdiceCharacterCard): Character {
  if (card.sheetType !== 'coc7') {
    throw new Error(`不支持的 sheetType: ${card.sheetType}（只支持 coc7）`);
  }

  const attributes: Record<Attribute, number> = {
    STR: 0, DEX: 0, CON: 0, SIZ: 0, POW: 0, INT: 0, APP: 0, EDU: 0,
  };
  const skills = new Map<string, Skill>();

  // 先初始化所有技能（基础值）
  for (const skillDef of COC7_SKILLS) {
    skills.set(skillDef.key, {
      key: skillDef.key,
      name: skillDef.nameZh,
      base: 0,
      occupational: 0,
      personal: 0,
      experienced: false,
    });
  }

  // 解析 data
  let occupation = '';
  let age = 28;
  let gender: string | undefined;
  let dollarHp: number | undefined;
  let dollarMaxhp: number | undefined;
  let dollarMp: number | undefined;
  let dollarMaxmp: number | undefined;
  let dollarSan: number | undefined;
  let dollarMaxsan: number | undefined;
  let dollarLuck: number | undefined;

  for (const [key, raw] of Object.entries(card.data)) {
    // 属性 (中文 / 英文别名)
    const enAttr =
      ATTRIBUTE_ZH_TO_EN[key] ??
      (key as Attribute in ATTRIBUTE_EN_TO_ZH ? (key as Attribute) : undefined);
    if (enAttr && typeof raw === 'number') {
      attributes[enAttr] = raw;
      continue;
    }

    // 派生 $-prefixed
    if (key === '$hp' && typeof raw === 'number') { dollarHp = raw; continue; }
    if (key === '$maxhp' && typeof raw === 'number') { dollarMaxhp = raw; continue; }
    if (key === '$mp' && typeof raw === 'number') { dollarMp = raw; continue; }
    if (key === '$maxmp' && typeof raw === 'number') { dollarMaxmp = raw; continue; }
    if (key === '$san' && typeof raw === 'number') { dollarSan = raw; continue; }
    if (key === '$maxsan' && typeof raw === 'number') { dollarMaxsan = raw; continue; }
    if (key === '$luck' && typeof raw === 'number') { dollarLuck = raw; continue; }
    if (key === '$dodge' || key === '$mov') continue;  // 派生，recompute 时算

    // 元数据
    if (key === '职业' && typeof raw === 'string') { occupation = raw; continue; }
    if (key === '年龄' && typeof raw === 'number') { age = raw; continue; }
    if (key === '性别' && typeof raw === 'string') { gender = raw; continue; }

    // 技能：中文名 → key
    const skillKey = SKILL_ZH_TO_EN[key];
    if (skillKey && typeof raw === 'number') {
      const skill = skills.get(skillKey);
      if (skill) {
        // 把整个 total 当 occupational 加点（base 一会儿用 attributes 算）
        skill.occupational = raw;
      }
      continue;
    }

    // 其他未识别 key 不报错，跳过
  }

  // 用 attributes 算每个 skill 的 base，并从 occupational 减回去得到 "纯职业加点"
  for (const skillDef of COC7_SKILLS) {
    const skill = skills.get(skillDef.key)!;
    skill.base = baseSkillValue(skillDef, attributes);
    // 调整：导入时 occupational 存的是 total；减去 base 才是纯加点
    if (skill.occupational > 0 && skill.occupational >= skill.base) {
      skill.occupational = skill.occupational - skill.base;
    }
  }

  const c: Character = {
    id: card.id,
    name: card.name,
    occupation,
    age,
    ...(gender !== undefined ? { gender } : {}),
    attributes,
    maxHp: 0, maxMp: 0, maxSanity: 0,
    currentHp: 0, currentMp: 0, currentSanity: 0,
    luck: dollarLuck ?? 50,
    movement: 0, dodge: 0, brawl: 0,
    skills,
    inventory: [],
    conditions: [],
  };

  // 重新算派生（HP/MP/Sanity/Dodge/Brawl/Move）
  recomputeDerivedStats(c);

  // 派生值如果 JSON 里有就用它（current 状态优先 JSON）
  c.currentHp = dollarHp ?? c.maxHp;
  if (dollarMaxhp !== undefined) c.maxHp = dollarMaxhp;
  c.currentMp = dollarMp ?? c.maxMp;
  if (dollarMaxmp !== undefined) c.maxMp = dollarMaxmp;
  c.currentSanity = dollarSan ?? c.maxSanity;
  if (dollarMaxsan !== undefined) c.maxSanity = dollarMaxsan;

  return c;
}
