// D100 技能检定 —— BRP / COC 7e 风
//
// 规则参考（基于 BRP/ORC SRD + COC 7e 通用机制）：
// - roll 1d100 vs target
// - 1            → 大成功 (critical_success)
// - <= target/5  → 极难成功 (extreme_success)
// - <= target/2  → 困难成功 (hard_success)
// - <= target    → 成功 (success)
// - > target     → 失败
// - 大失败 (fumble)：
//     target < 50 时 roll >= 96
//     target >= 50 时 roll = 100
//
// 难度修正：
//   normal: target = target
//   hard:   target = target / 2
//   extreme: target = target / 5
//
// 奖励骰 / 惩罚骰（bonus / penalty dice）：
//   投多个 d10 作十位，
//   奖励骰：取最低（对玩家好）
//   惩罚骰：取最高（对玩家坏）
//   一个奖励骰抵一个惩罚骰，最后只剩同向骰子

import type { CheckResult, CheckOutcome, Difficulty } from '../types/rules.js';
import type { Rng } from './rng.js';

/**
 * 把内部 CheckOutcome 英文枚举翻成跑团圈通用中文术语 (展示给玩家用).
 * ⚠️ 任何往 narrate / badge / 玩家可见 UI 写 outcome 的代码, 必须过这一函数,
 * 不许直接拼 outcome 英文字符串. 老板看见 "fumble" 一次了, 不能再有第二次.
 */
const OUTCOME_ZH: Record<CheckOutcome, string> = {
  critical_success: '大成功',
  extreme_success: '极难成功',
  hard_success: '困难成功',
  success: '成功',
  failure: '失败',
  fumble: '大失败',
};
export function outcomeToZh(outcome: CheckOutcome): string {
  return OUTCOME_ZH[outcome] ?? outcome;
}

/**
 * 内部 skill id (英文 snake_case) → 跑团圈通用中文名 兜底.
 * 优先级: char.skills.get(id)?.name → SKILL_NAME_ZH[id] → 原 id.
 * 任何展示 skill 名给玩家的代码必须过这层, 别让 "brawl" / "dodge" 流到 UI.
 */
const SKILL_NAME_ZH: Record<string, string> = {
  brawl: '格斗',
  dodge: '闪避',
  spot_hidden: '侦查',
  listen: '聆听',
  library_use: '图书馆使用',
  psychology: '心理学',
  persuade: '说服',
  fast_talk: '话术',
  intimidate: '恐吓',
  charm: '魅惑',
  occult: '神秘学',
  cthulhu_mythos: '克苏鲁神话',
  locksmith: '锁匠',
  first_aid: '急救',
  medicine: '医学',
  climb: '攀爬',
  swim: '游泳',
  jump: '跳跃',
  throw: '投掷',
  drive_auto: '驾驶 (汽车)',
  language_own: '母语',
  language_other: '其他语言',
  track: '追踪',
  sneak: '潜行',
  stealth: '隐匿',
  history: '历史',
  archaeology: '考古学',
  art_craft: '艺术与制作',
  science: '科学',
  navigate: '导航',
  natural_world: '博物学',
  mechanical_repair: '机械维修',
  electrical_repair: '电气维修',
  computer_use: '计算机使用',
  accounting: '会计',
  law: '法律',
  appraise: '估价',
  disguise: '乔装',
  pilot: '驾驶 (船 / 飞行器)',
  ride: '骑乘',
  firearms_handgun: '射击 (手枪)',
  firearms_rifle: '射击 (步枪)',
  firearms_shotgun: '射击 (霰弹枪)',
};
export function skillIdToZh(id: string): string {
  return SKILL_NAME_ZH[id] ?? id;
}

export interface RollCheckParams {
  target: number;
  difficulty?: Difficulty;
  bonusDice?: number;
  penaltyDice?: number;
}

/** 单次纯 d100 检定（不带 bonus/penalty）—— 内部用 */
function evaluateOutcome(roll: number, effectiveTarget: number): {
  outcome: CheckOutcome;
  succeeded: boolean;
} {
  // 1 永远大成功
  if (roll === 1) return { outcome: 'critical_success', succeeded: true };

  // 大失败判定
  const fumble =
    (effectiveTarget < 50 && roll >= 96) ||
    (effectiveTarget >= 50 && roll === 100);

  if (roll > effectiveTarget) {
    return { outcome: fumble ? 'fumble' : 'failure', succeeded: false };
  }

  // roll <= effectiveTarget
  if (roll <= Math.floor(effectiveTarget / 5)) {
    return { outcome: 'extreme_success', succeeded: true };
  }
  if (roll <= Math.floor(effectiveTarget / 2)) {
    return { outcome: 'hard_success', succeeded: true };
  }
  return { outcome: 'success', succeeded: true };
}

/**
 * 滚动奖励/惩罚骰，得到 d100 的"十位"修正后的最终 roll。
 *
 * 算法：
 *   1. 抵消奖励骰 vs 惩罚骰，得到净骰子数
 *   2. 个位 d10 直接出
 *   3. 十位投 (1 + |净骰子|) 次 d10：
 *        - 净奖励：取最低
 *        - 净惩罚：取最高
 *   4. 0 在十位代表 100（10 在十位代表 10）—— BRP 惯例
 */
function rollWithBonusPenalty(
  bonus: number,
  penalty: number,
  rng: Rng,
): number {
  const net = bonus - penalty;
  const ones = rng.rollInt(0, 9);

  // 投 (1 + |net|) 次十位 d10
  const tensRolls: number[] = [];
  for (let i = 0; i < 1 + Math.abs(net); i++) {
    tensRolls.push(rng.rollInt(0, 9));
  }

  let chosenTens: number;
  if (net > 0) {
    chosenTens = Math.min(...tensRolls);
  } else if (net < 0) {
    chosenTens = Math.max(...tensRolls);
  } else {
    chosenTens = tensRolls[0]!;
  }

  // 必须先做 "0 + 0 = 100" 调整
  // 但只对"个位 = 0 且 十位 = 0"特殊
  if (chosenTens === 0 && ones === 0) return 100;

  // 否则普通组合: tens*10 + ones, tens=0 时表示个位值
  const roll = chosenTens * 10 + ones;
  return roll === 0 ? 100 : roll;
}

/**
 * 计算难度修正后的有效目标值
 */
export function effectiveTargetForDifficulty(
  target: number,
  difficulty: Difficulty,
): number {
  switch (difficulty) {
    case 'normal':
      return target;
    case 'hard':
      return Math.floor(target / 2);
    case 'extreme':
      return Math.floor(target / 5);
  }
}

/**
 * 执行一次完整的 D100 检定。
 *
 * @example
 * const result = rollCheck({ target: 60, difficulty: 'normal' }, rng);
 * if (result.succeeded) { ... }
 */
export function rollCheck(params: RollCheckParams, rng: Rng): CheckResult {
  const { target, difficulty = 'normal', bonusDice = 0, penaltyDice = 0 } = params;
  if (target < 1 || target > 100) {
    throw new Error(`rollCheck: target ${target} 越界（1-100）`);
  }
  const effectiveTarget = effectiveTargetForDifficulty(target, difficulty);

  let roll: number;
  if (bonusDice === 0 && penaltyDice === 0) {
    roll = rng.rollInt(1, 100);
  } else {
    roll = rollWithBonusPenalty(bonusDice, penaltyDice, rng);
  }

  const { outcome, succeeded } = evaluateOutcome(roll, effectiveTarget);

  return {
    roll,
    target,
    difficulty,
    effectiveTarget,
    bonusDice,
    penaltyDice,
    outcome,
    succeeded,
    ts: Date.now(),
  };
}
