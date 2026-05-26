// 规则引擎类型 —— D100 检定 / 心智耗损 / 战斗结果
// "诚实派" 原则：所有数值判定由代码确定性管，LLM 不准编规则。

export type Difficulty = 'normal' | 'hard' | 'extreme';

export type CheckOutcome =
  | 'critical_success'    // 大成功（roll = 1）
  | 'extreme_success'     // 极难成功（roll <= target/5）
  | 'hard_success'        // 困难成功（roll <= target/2）
  | 'success'             // 普通成功（roll <= target）
  | 'failure'             // 失败
  | 'fumble';             // 大失败（target<50 时 roll>=96，target>=50 时 roll=100）

export interface CheckResult {
  /** 投出的 d100 结果 (1-100) */
  roll: number;
  /** 目标值（技能值或属性×5）*/
  target: number;
  /** 难度 */
  difficulty: Difficulty;
  /** 实际比较的阈值（normal=target, hard=target/2, extreme=target/5）*/
  effectiveTarget: number;
  /** 加骰数 */
  bonusDice: number;
  /** 减骰数 */
  penaltyDice: number;
  /** 最终判定 */
  outcome: CheckOutcome;
  /** 是否触发成功（hard_success / extreme_success / success / critical_success）*/
  succeeded: boolean;
  /** 时间戳 */
  ts: number;
}

export interface SanityCheckParams {
  /** 当前心智值 */
  currentSanity: number;
  /** 成功时损失（"1/1d4" 这种格式里前一个数）*/
  lossOnSuccess: number;
  /** 失败时损失 —— roll string ("1d4" / "1d10" / "1d100"）, 或固定数（fixed: number）*/
  lossOnFailureRoll: string | number;
  /** 触发原因（用于 log）*/
  reason: string;
}

export interface SanityCheckResult {
  /** d100 投点 */
  roll: number;
  /** 阈值 = currentSanity */
  threshold: number;
  /** 是否通过 */
  succeeded: boolean;
  /** 实际损失值 */
  actualLoss: number;
  /** 损失后剩余心智 */
  remainingSanity: number;
  /** 是否触发临时疯狂（单次损失 >= 5）*/
  triggersTempInsanity: boolean;
  /** 是否触发长期疯狂（单日累计损失 >= 1/5 当前 max）*/
  triggersIndefInsanity: boolean;
  /** 时间戳 */
  ts: number;
  /** 原因（log）*/
  reason: string;
}

/** 加/减骰逻辑：bonusDice/penaltyDice 净值，正为加骰 */
export interface DiceRollOptions {
  bonusDice?: number;
  penaltyDice?: number;
  /** 注入随机源（测试可注入确定性 RNG）*/
  rng?: () => number;
}
