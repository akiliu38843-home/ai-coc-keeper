// 心智耗损（"Sanity"）检定 + 应用损失
//
// COC 7e 风规则：
// - Sanity check: roll 1d100 vs current sanity
//   - 通过 → 损失 "成功值"（如 "0/1d6" 的前 0）
//   - 失败 → 投后骰得损失值
// - 单次损失 ≥ 5 → 临时心智失常 (temp insanity)
// - 单日累计损失 ≥ 当前 max sanity 的 1/5 → 长期心智失常 (indef insanity)
//
// 用 "理智耗损" / "心智度" UI 文案替代 SAN 名词（合规）。

import type {
  SanityCheckParams,
  SanityCheckResult,
} from '../types/rules.js';
import type { Character, Condition } from '../types/character.js';
import type { Rng } from './rng.js';
import { rollDice, rollD100 } from './dice.js';
import { rollInsanity } from './insanity-tables.js';

export interface SanityApplyOptions {
  /** 用于跟踪"单日累计损失"的 sanity 起始值（决定 1/5 阈值）*/
  startOfDaySanity?: number;
  /** 长期心智失常时用的 RNG，没传就不随机 phobia/mania */
  rng?: Rng;
}

/**
 * 执行心智检定。
 *
 * @param params 包含当前 sanity / 成功损失 / 失败损失记法
 * @param rng 随机源
 *
 * @example
 * rollSanityCheck({
 *   currentSanity: 65,
 *   lossOnSuccess: 0,
 *   lossOnFailureRoll: "1d6",
 *   reason: "看到尸体"
 * }, rng);
 */
export function rollSanityCheck(
  params: SanityCheckParams,
  rng: Rng,
): SanityCheckResult {
  const roll = rollD100(rng);
  const succeeded = roll <= params.currentSanity;

  let actualLoss: number;
  if (succeeded) {
    actualLoss = params.lossOnSuccess;
  } else {
    actualLoss =
      typeof params.lossOnFailureRoll === 'number'
        ? params.lossOnFailureRoll
        : rollDice(params.lossOnFailureRoll, rng);
  }

  const remainingSanity = Math.max(0, params.currentSanity - actualLoss);
  const triggersTempInsanity = actualLoss >= 5;

  return {
    roll,
    threshold: params.currentSanity,
    succeeded,
    actualLoss,
    remainingSanity,
    triggersTempInsanity,
    triggersIndefInsanity: false, // 长期失常要 1/5 累计判定，由 applySanityLoss 算
    ts: Date.now(),
    reason: params.reason,
  };
}

/**
 * 把心智损失应用到角色上 —— 更新 currentSanity，加 condition 标记。
 *
 * @returns 是否触发长期心智失常
 */
export function applySanityLoss(
  character: Character,
  result: SanityCheckResult,
  opts: SanityApplyOptions = {},
): { triggersIndefInsanity: boolean } {
  character.currentSanity = result.remainingSanity;

  // 临时心智失常 → 加 condition
  if (result.triggersTempInsanity) {
    character.conditions.push({
      type: 'temp_insanity',
      source: result.reason,
      appliedAt: result.ts,
    });
  }

  // 长期心智失常判定：单事件损失 ≥ 1/5 当前 max
  const indefThreshold = Math.floor(
    (opts.startOfDaySanity ?? character.maxSanity) / 5,
  );
  const triggersIndef = result.actualLoss >= indefThreshold && indefThreshold > 0;

  if (triggersIndef) {
    const cond: Condition = {
      type: 'indef_insanity',
      source: result.reason,
      appliedAt: result.ts,
    };
    // 如果给了 RNG，从海豹的 100 项表 roll 一条具体 phobia/mania
    if (opts.rng) {
      const insanity = rollInsanity(opts.rng);
      cond.insanityDetail = {
        kind: insanity.kind,
        id: insanity.entry.id,
        nameZh: insanity.entry.nameZh,
        nameEn: insanity.entry.nameEn,
        description: insanity.entry.description,
      };
    }
    character.conditions.push(cond);
  }

  return { triggersIndefInsanity: triggersIndef };
}
