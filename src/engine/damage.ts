// HP 损伤 + 重伤 / 昏迷 / 濒死判定
//
// COC 7e 风规则：
// - 单次损失 ≥ maxHP/2 → 重伤 (major wound)，触发 CON 检定，失败则 unconscious
// - HP 降到 0 → 昏迷 + 濒死
// - 0 HP 时每轮 CON 检定，连续失败则死亡（这部分留给上层游戏循环处理）

import type { Character, ConditionType } from '../types/character.js';

export interface DamageEvent {
  /** 损失量 */
  amount: number;
  /** 损伤来源（log）*/
  source: string;
  /** 是否物理攻击（影响重伤判定）*/
  physical?: boolean;
}

export interface DamageResult {
  /** 实际扣的 HP（不会扣到负数）*/
  actualDamage: number;
  /** 当前 HP */
  remainingHp: number;
  /** 触发的新增 conditions */
  triggeredConditions: ConditionType[];
}

/**
 * 把伤害应用到角色上。
 *
 * @example
 * const r = applyDamage(character, { amount: 7, source: "刀伤", physical: true });
 * if (r.triggeredConditions.includes('major_wound')) { ... }
 */
export function applyDamage(
  character: Character,
  event: DamageEvent,
): DamageResult {
  const before = character.currentHp;
  const actualDamage = Math.min(event.amount, before);
  character.currentHp = Math.max(0, before - event.amount);

  const triggeredConditions: ConditionType[] = [];
  const now = Date.now();
  const physical = event.physical ?? true;

  // 重伤判定：单次 >= maxHP/2 且是物理伤害
  if (physical && actualDamage >= Math.ceil(character.maxHp / 2)) {
    triggeredConditions.push('major_wound');
    character.conditions.push({
      type: 'major_wound',
      source: event.source,
      appliedAt: now,
    });
  } else if (actualDamage > 0 && !hasCondition(character, 'minor_wound')) {
    // 普通伤害也算一次"轻伤"标记（一日内）
    triggeredConditions.push('minor_wound');
    character.conditions.push({
      type: 'minor_wound',
      source: event.source,
      appliedAt: now,
    });
  }

  // 0 HP → 昏迷 + 濒死
  if (character.currentHp === 0) {
    if (!hasCondition(character, 'unconscious')) {
      triggeredConditions.push('unconscious');
      character.conditions.push({
        type: 'unconscious',
        source: event.source,
        appliedAt: now,
      });
    }
    if (!hasCondition(character, 'dying')) {
      triggeredConditions.push('dying');
      character.conditions.push({
        type: 'dying',
        source: event.source,
        appliedAt: now,
      });
    }
  }

  return {
    actualDamage,
    remainingHp: character.currentHp,
    triggeredConditions,
  };
}

/** 是否当前有某 condition */
export function hasCondition(c: Character, type: ConditionType): boolean {
  return c.conditions.some((cond) => cond.type === type);
}

/** 治疗 HP，不超过 maxHp */
export function healHp(c: Character, amount: number): number {
  const before = c.currentHp;
  c.currentHp = Math.min(c.maxHp, before + amount);
  return c.currentHp - before;
}
