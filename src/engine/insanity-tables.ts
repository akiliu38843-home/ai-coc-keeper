// 心智失常随机表 —— 100 项恐惧症 + 100 项狂躁症
//
// 数据来自 sealdice/sealdice-core (MIT)，见 src/data/coc7-tables/README.md。
// 引擎在玩家触发长期疯狂时 d100 选一条，写入 Character.conditions[N].insanityDetail。

import fearJson from '../data/coc7-tables/fear.json' with { type: 'json' };
import maniaJson from '../data/coc7-tables/mania.json' with { type: 'json' };
import type { Rng } from './rng.js';

export interface InsanityEntry {
  id: number;          // 1-100
  nameZh: string;
  nameEn: string;
  description: string;
}

export const PHOBIA_TABLE: ReadonlyArray<InsanityEntry> = fearJson;
export const MANIA_TABLE: ReadonlyArray<InsanityEntry> = maniaJson;

/** d100 roll 一条恐惧症 */
export function rollPhobia(rng: Rng): InsanityEntry {
  const idx = rng.rollInt(0, PHOBIA_TABLE.length - 1);
  return PHOBIA_TABLE[idx]!;
}

/** d100 roll 一条狂躁症 */
export function rollMania(rng: Rng): InsanityEntry {
  const idx = rng.rollInt(0, MANIA_TABLE.length - 1);
  return MANIA_TABLE[idx]!;
}

/**
 * 长期心智失常时根据触发性质二选一 phobia 或 mania。
 * V0 简化：50/50。COC 7e 实际规则更复杂（看触发场景的"性质"），先粗暴随机。
 */
export function rollInsanity(rng: Rng): { kind: 'phobia' | 'mania'; entry: InsanityEntry } {
  if (rng.rollInt(0, 1) === 0) {
    return { kind: 'phobia', entry: rollPhobia(rng) };
  }
  return { kind: 'mania', entry: rollMania(rng) };
}
