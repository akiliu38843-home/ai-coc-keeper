# 海豹骰对照 · 我们的 D100 引擎是不是"自己造轮子"

> 日期：2026-05-26
> 缘起：用户问"我们骰子现在用的是海豹骰吗"。
> 答：**不是**，我们 W3 自写 D100 引擎。本文档对照海豹的实现验证我们没漏关键规则。

## TL;DR

**核心规则全对齐 ✓**。我们 V0 scope 比海豹小（无 PEG 表达式 / 无多 ruleset / 无属性 DSL），但**对单本 V0 demo 来说够用**。

**唯一海豹做了我们没做的"核心规则"**：多 ruleset 支持（Rule 0 标准 COC / Rule 11 Delta Green）。V1 加。

**我们做了海豹没做的**：BRP/COC 7e 官方的 **bonus + penalty 互相抵消**（海豹貌似没做这个，可能是简化）。

---

## 核心 D100 检定逻辑对照

| 规则点 | 海豹（rollvm.go + ext_coc7.go）| 我们（src/engine/skill-check.ts）| 对齐 |
|---|---|---|---|
| 基础检定 | d100 <= attrValue 成功 | d100 <= target 成功 | ✓ |
| Hard 难度 | threshold = attr / 2 | effectiveTarget = target / 2 | ✓ |
| Extreme 难度 | threshold = attr / 5 | effectiveTarget = target / 5 | ✓ |
| 大成功 | d100 = 1 (Rule 0/1/2) | roll === 1 | ✓ |
| 大失败 | attr<50 时 fumble = 96-100; attr≥50 时仅 100 | 同样 | ✓ |
| 6 档结果 | -2/-1/1/2/3/4 (rank) | critical_success / extreme_success / hard_success / success / failure / fumble | ✓ 命名不同语义同 |
| Rule 4 (仅大成功)| threshold = 1 | ❌ 没做 | 🟡 V1 加 |
| Rule 11 (Delta Green) | 大成功要求 units == tens | ❌ 没做 | 🟡 V1 加 |

## 奖励骰 / 惩罚骰对照

| 维度 | 海豹 | 我们 | 对齐 |
|---|---|---|---|
| 算法 | 先投一个 d100，记录个位；额外投 N 个 d10 作十位候选；bonus 取最小，penalty 取最大 | 投 1+\|net\| 个 d10 作十位；bonus 取 min，penalty 取 max；个位独立投 | ✓ 数学等价 |
| 个位处理 | `diceResult % 10`，不变 | 独立 `rollInt(0, 9)` | ✓ 概率等价 |
| 0+0 = 100 | "个位为0时允许十位=10" 隐式 | `if (chosenTens === 0 && ones === 0) return 100` 显式 | ✓ |
| **bonus + penalty 互相抵消** | ❌ 看代码没做，bonus / penalty 是 type level 互斥 | ✅ `net = bonus - penalty` 抵消后再投 | **我们对** ✓ |

**BRP/COC 7e 规则书**：
> Bonus and penalty dice cancel each other out one for one. If equal numbers, no extra dice are rolled.

所以**我们对、海豹简化了**。

## 心智耗损对照

| 规则点 | 海豹 (.sc 实现) | 我们 (src/engine/sanity.ts) | 对齐 |
|---|---|---|---|
| 心智检定 | d100 vs currentSAN | d100 vs currentSanity | ✓ |
| 成功扣值 | `expr2`（公式参数）| lossOnSuccess (固定数字) | 🟡 我们没支持表达式，但行为一致 |
| 失败扣值 | `expr3`（公式参数，如 1d6）| lossOnFailureRoll (string \| number，支持 "1d6" 等记法) | ✓ |
| 临时疯狂触发 | 单次损失 >= 5 | 同 | ✓ |
| 长期疯狂触发 | 单日累计 >= 1/5 max | 单次 >= max/5（V0 简化） | 🟡 简化但合理 |
| SAN 归 0 = 永久疯狂 | ✓ | ❌ V0 没特殊处理（current=0 时玩家仍能继续，UI 应阻止）| V1 加 |

## 骰子表达式 parser 对照

| 维度 | 海豹（roll.peg PEG grammar 10K 字节）| 我们（parseDice 简正则）| 对齐 |
|---|---|---|---|
| `NdM` / `NdM+K` / `NdM-K` | ✓ | ✓ | ✓ |
| `NdMkh` / `NdMkl` 保留最值 | ✓ | ❌ | 🟡 V0 暂不需 |
| `NdMkN` 保留前 N 个 | ✓ | ❌ | 🟡 V0 暂不需 |
| `1d100+1d4-2` 复合表达式 | ✓ | ❌ 只支持单组骰 + modifier | 🟡 V0 够用 |
| 条件 `?:` / `switch` | ✓ | ❌ | 🟡 V0 不需 |
| WOD 骰池 `NaM` / 双十字 `NcM` | ✓ | ❌ | V0 不需 (COC 不用 WOD) |
| 字符串插值 / 变量赋值 | ✓ | ❌ | V0 不需 |

## 海豹的 .ra / .sc / .st DSL 命令

海豹是 **QQ 机器人**，所以有大量"群里发命令"的 DSL：

| 命令 | 例 | 我们对应 |
|---|---|---|
| `.ra 侦查` | 投 d100 vs 角色侦查值 | `rollCheck({ target: chr.skills.spotHidden.total, difficulty: 'normal' }, rng)` |
| `.ra 60` | 投 d100 vs 60 (临时检定) | 同上 |
| `.ra b 60` | bonus 1 投 d100 vs 60 | `rollCheck({ target: 60, bonusDice: 1 }, rng)` |
| `.ra p2 60` | penalty 2 投 d100 vs 60 | `rollCheck({ target: 60, penaltyDice: 2 }, rng)` |
| `.sc 0/1d6` | 心智检定，成功 0 失败 1d6 | `rollSanityCheck({ currentSanity, lossOnSuccess: 0, lossOnFailureRoll: '1d6' }, rng)` |
| `.st 力量+1d4` | 给力量加 1d4 | ❌ 我们 Character 模型没这种命令解析 |
| `.st show` | 显示属性表 | ❌ |

**结论**：我们的**库**已经能 cover 海豹大部分**核心计算**。差的是：
- DSL 命令解析层（V0 不需要，UI 直接调函数）
- 属性表达式修改（V0 不需要，角色卡是 JSON 静态）

## 海豹的 COC 7e 心智失常表

海豹仓库里有：
- `dice/coc7_fear.txt` (6.5K) — COC 7e 恐惧症随机表（100 项）
- `dice/coc7_mania.txt` (6.8K) — COC 7e 狂躁症随机表（100 项）

**这是 V0 可以直接借的内容**（MIT license，行为表，不是核心代码）。需要时直接 fetch + 转换成 JSON。

## 多 ruleset 支持

海豹支持多套 ruleset（推断的，没看代码全貌）：

| Rule ID | 名称 | 主要差异 |
|---|---|---|
| 0 | Standard COC 7e | 我们 V0 实现的 |
| 1, 2 | COC 变体 | 大成功/大失败阈值微调 |
| 4 | "仅大成功" | threshold = 1 |
| 11 | Delta Green | 大成功要求个位 == 十位 + 成功条件 |

**V0 不需要**。V1 如果做 Delta Green 风格内容，再加。

## 我们应不应该改用海豹骰当骰子引擎？

**不应该**。理由：

| 方面 | 理由 |
|---|---|
| 跨技术栈 | 海豹 Go，我们 TS，集成成本极高 |
| Scope 不重叠 | 海豹是"群里 .ra 跑团骰"，我们是"galgame 引擎"，UX 完全不同 |
| 自己 519 行已经写完 | W3 已经过了 46 个测试，重写没价值 |
| ScriptedRng 测试可注入 | 我们的可以精确单测，海豹是黑盒 |
| LICENSE 干净 | 我们 MIT，海豹也 MIT，但绑死 Go 二进制集成 license/打包麻烦 |

## "海豹兼容"在 V0 应该怎么做

按 PRD 的"借生态不对抗"思路：

| 兼容点 | 含义 | V0 必要性 |
|---|---|---|
| 角色卡 `.pc` 格式互导 | 我们生成 → 海豹能读 | V1 做（W9 角色卡向导可以同时支持）|
| log 格式 | 我们的 game log → 海豹能 replay | V1 做 |
| `.ra` / `.sc` 命令字面兼容 | 用户能用海豹命令在我们 UI 里跑 | V0 不需（我们 UI 是 galgame，没命令行） |
| 投点数学规则 | d100 / 难度 / fumble / 奖励骰 | **V0 已经对齐** ✓ |

---

## 给将来想做"海豹兼容"的实操清单

如果未来要做 `.pc` 角色卡互导（W9 同步做 or V1）：

1. 找一个真实的海豹 `.pc` 文件样本（社区里能找到）
2. 看它的 JSON 结构（应该跟我们 Character 接口大体接近）
3. 写 `src/adapter/sealdice-import.ts` + `sealdice-export.ts`
4. 测试：导出我们的 → 拷到海豹 QQ 群 → 用户用 `.st show` 能看到属性 ✓

## 数据来源

- 海豹骰仓库：https://github.com/sealdice/sealdice-core (master 分支)
- 关键文件：`dice/roll.peg`, `dice/rollvm.go`, `dice/ext_coc7.go`, `dice/rollvm_misc.go`
- BRP/COC 7e 规则书 (Chaosium)
- 我们的实现：`src/engine/skill-check.ts`, `src/engine/sanity.ts`, `src/engine/dice.ts`, `src/engine/rng.ts`
