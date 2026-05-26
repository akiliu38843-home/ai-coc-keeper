// 随机源抽象 —— 真实随机 + 测试用确定性序列
// 所有检定都注入 RNG，让单测能完全控制骰子结果。

export interface Rng {
  /** 返回 [0, 1) 的浮点 */
  next(): number;
  /** 投 1-N 整数 */
  rollInt(min: number, max: number): number;
}

/** 默认随机源：Math.random 包装 */
export class DefaultRng implements Rng {
  next(): number {
    return Math.random();
  }
  rollInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

/**
 * 确定性 RNG —— 按预设序列返回结果。
 * 测试用：明确知道每次投点结果，可以精确断言。
 *
 * @example
 * const rng = new ScriptedRng([50, 30, 90]); // 投 3 次依次返回 50/30/90
 * rng.rollInt(1, 100); // 50
 */
export class ScriptedRng implements Rng {
  private seq: number[];
  private idx = 0;
  constructor(sequence: number[]) {
    this.seq = sequence;
  }
  next(): number {
    // 不推荐用 next() —— ScriptedRng 给的是整数序列，next() 仅是兜底
    const val = this.peek();
    this.idx++;
    return val / 100;
  }
  rollInt(_min: number, _max: number): number {
    const val = this.peek();
    this.idx++;
    return val;
  }
  private peek(): number {
    if (this.idx >= this.seq.length) {
      throw new Error(
        `ScriptedRng 序列用完（已用 ${this.idx}，长度 ${this.seq.length}）`,
      );
    }
    // 在 noUncheckedIndexedAccess 严格模式下需要非空断言
    return this.seq[this.idx]!;
  }
  /** 检查是否所有预设值都用完了（测试可断言）*/
  isExhausted(): boolean {
    return this.idx === this.seq.length;
  }
}
