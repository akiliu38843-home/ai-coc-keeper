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
