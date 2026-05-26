// 骰子记法解析 + 滚动
// 支持："1d6" / "1d4+1" / "2d6" / "1d100" / "1d10-1" / 纯数字 "3"

import type { Rng } from './rng.js';

export interface ParsedDice {
  count: number;       // 骰子个数
  sides: number;       // 每个骰子面数
  modifier: number;    // 加/减常数
}

/**
 * 解析骰子记法字符串。
 *
 * @example
 * parseDice("1d6")    → { count: 1, sides: 6, modifier: 0 }
 * parseDice("1d4+1")  → { count: 1, sides: 4, modifier: 1 }
 * parseDice("2d6-1")  → { count: 2, sides: 6, modifier: -1 }
 * parseDice("3")      → { count: 0, sides: 0, modifier: 3 } (纯加数)
 */
export function parseDice(spec: string): ParsedDice {
  const trimmed = spec.trim().toLowerCase().replace(/\s+/g, '');
  // 纯数字
  if (/^-?\d+$/.test(trimmed)) {
    return { count: 0, sides: 0, modifier: parseInt(trimmed, 10) };
  }
  // NdM 或 NdM+K / NdM-K
  const m = trimmed.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!m) {
    throw new Error(`骰子记法无法解析: "${spec}"`);
  }
  const count = parseInt(m[1]!, 10);
  const sides = parseInt(m[2]!, 10);
  const modifier = m[3] ? parseInt(m[3], 10) : 0;
  if (count <= 0 || sides <= 0) {
    throw new Error(`骰子记法无效: "${spec}" (count/sides 必须 > 0)`);
  }
  return { count, sides, modifier };
}

/** 滚动一组骰子，返回总和 */
export function rollDice(spec: string | ParsedDice, rng: Rng): number {
  const parsed = typeof spec === 'string' ? parseDice(spec) : spec;
  let total = parsed.modifier;
  for (let i = 0; i < parsed.count; i++) {
    total += rng.rollInt(1, parsed.sides);
  }
  return total;
}

/** 单 d100（百分骰）—— 检定用 */
export function rollD100(rng: Rng): number {
  return rng.rollInt(1, 100);
}
