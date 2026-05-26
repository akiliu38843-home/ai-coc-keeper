// 探者（Character）模型 —— V0 单人本玩家角色
// 命名取通用泛词，避开 Chaosium 商标的 "Investigator"。

export type Attribute = 'STR' | 'DEX' | 'INT' | 'CON' | 'POW' | 'APP' | 'SIZ' | 'EDU';

export interface Skill {
  /** 技能 key，如 "spot_hidden" / "listen" / "library_use" */
  key: string;
  /** 技能中文名 */
  name: string;
  /** 基础值（属性派生 + 职业模板初始）*/
  base: number;
  /** 职业点数分配 */
  occupational: number;
  /** 个人兴趣点数分配 */
  personal: number;
  /** 是否当前会话中已经"经验勾选"过（成功后可成长）*/
  experienced: boolean;
}

/** 技能当前总值（用于检定）*/
export function skillTotal(s: Skill): number {
  return s.base + s.occupational + s.personal;
}

export interface Item {
  id: string;
  name: string;
  description: string;
  qty: number;
}

export type ConditionType =
  | 'minor_wound'      // 轻伤
  | 'major_wound'      // 重伤
  | 'unconscious'      // 失去意识
  | 'dying'            // 濒死
  | 'temp_insanity'    // 临时心智失常
  | 'indef_insanity';  // 长期心智失常

export interface Condition {
  type: ConditionType;
  source: string;       // 哪个场景/检定触发
  appliedAt: number;    // unix ms
}

export interface Character {
  /** 唯一 ID */
  id: string;
  /** 玩家角色名 */
  name: string;
  /** 职业（自由文本，如"私家侦探"/"古董商"）*/
  occupation: string;
  /** 年龄 */
  age: number;
  /** 性别（可选）*/
  gender?: string;

  /** 8 项基础属性 */
  attributes: Record<Attribute, number>;

  /** 派生值 —— 上限 */
  maxHp: number;
  maxMp: number;
  maxSanity: number;

  /** 当前值 */
  currentHp: number;
  currentMp: number;
  currentSanity: number;

  /** 幸运值（独立投点）*/
  luck: number;

  /** 移动力（基于 STR/DEX/SIZ 派生）*/
  movement: number;

  /** 闪避值（DEX/2 派生）*/
  dodge: number;

  /** 拼搏（DEX×2 派生，近战命中默认值）*/
  brawl: number;

  /** 技能表 */
  skills: Map<string, Skill>;

  /** 物品栏 */
  inventory: Item[];

  /** 当前状态效果 */
  conditions: Condition[];
}

/** 派生计算：根据 attributes 计算 maxHp/maxMp/movement/dodge 等 */
export function recomputeDerivedStats(c: Character): void {
  const { CON, SIZ, POW, DEX, STR } = c.attributes;
  c.maxHp = Math.floor((CON + SIZ) / 10);
  c.maxMp = Math.floor(POW / 5);
  c.maxSanity = POW;  // 上限 = POW
  c.dodge = Math.floor(DEX / 2);
  c.brawl = STR * 2 > 100 ? 100 : STR * 2;
  // 移动力：粗略 — 实际 COC 7e 看 STR/DEX vs SIZ
  if (STR < SIZ && DEX < SIZ) c.movement = 7;
  else if (STR > SIZ && DEX > SIZ) c.movement = 9;
  else c.movement = 8;
}
