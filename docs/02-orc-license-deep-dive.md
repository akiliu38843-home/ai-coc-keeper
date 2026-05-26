# ORC License 法律 Due Diligence · Path 2 是否可行

> 调研日期：2026-05-26
> 缘起：05-content-licensing-landscape.md 推荐 Path 1（谈作者授权）+ Path 2（自创克苏鲁风原创本）并行。本文档专门做 Path 2 的法律可行性深挖。

## TL;DR

**Path 2 可行，但有 4 条硬约束必须接受**：

1. ✅ **ORC License 明确允许商业使用 + AI 衍生内容** —— 没有 AI 限制
2. ⚠️ **规则引擎部分必须开源回馈**（ORC 传染性，类似 AGPL）
3. ⚠️ **Chaosium 的 IP（克苏鲁专名 / SAN / 调查员 / 神话名词）仍是 Reserved Material** —— 不能用
4. ⚠️ **必须给"理智值"等机制改名 + 用 Lovecraft 原文（中国 public domain）做主题**

实操路径：**BRP 规则引擎（ORC 下开源）+ Lovecraft 原文改编（中国 public domain）+ 自创术语命名（避开 Chaosium 商标）**。

---

## ORC License 全景

### 是什么

**Open RPG Creative License** = Paizo 联合 Azora Law 在 2023 年 6 月 finalize 的开源 TTRPG 协议，**系统中立、永久不可撤销**。

定位：业界开源 TTRPG 规则的事实标准（继 2023 年 WotC OGL 风波之后）。

**Chaosium 已在 2023/2024 起把 BRP Universal Game Engine 完整放到 ORC License 下**，旧版 BRP-OGL 已 supersede。

### 4 个关键条款

| 条款 | 内容 | 翻译过来 |
|---|---|---|
| **II.a · License Grant** | "worldwide, royalty-free, non-exclusive, irrevocable license to exercise the Licensed Rights in the Licensed Material in all media and formats whether now known or hereafter created" | 全球免版税 + 不可撤销 + **明确包含未来技术（含 AI）** |
| **II.b · ShareAlike Obligation** | "you must grant to every recipient an irrevocable offer to exercise the Licensed Rights in the Adapted Licensed Material" | **衍生作品必须开源回馈给所有人**（强制 ShareAlike）|
| **I.h · Reserved Material** | "trademarks, trade dress, and creative expressions that are not essential to ... ideas or methods of operation" | 商标 / 视觉艺术 / 故事 / 角色 / 世界观 **可保留私有**，规则机制不能保留 |
| Designation | 发行商可主动声明 "Expressly Designated Licensed Material" | 作者愿意 share 的故事可标为 Licensed |

### 跟其他协议对照

| 协议 | 商业用 | AI 用 | 衍生开源 | 适合场景 |
|---|---|---|---|---|
| **ORC** | ✅ | ✅ 明确 | ⚠️ 强制 ShareAlike | TTRPG 规则系统 |
| AGPL-3.0 | ✅ | ✅ | ⚠️ 强制 + 网络部署也算 | 服务端代码 (SillyTavern) |
| CC BY-NC-SA 4.0 | ❌ NC | ✅ 但非商用 | ⚠️ SA | 中文模组 (cnmods) |
| Chaosium 商业 license | ✅ 收费 | 未明确 | 否 | 想用 COC IP |

---

## Chaosium IP 的 Reserved Material 边界

**绝对不能用的（即使在 ORC 下）**：

- 商标："Call of Cthulhu" / "Cthulhu" 作为商品标识
- 神话专名：纳格、犹格索托斯、克苏鲁神（作为 Chaosium 设定的版本）
- COC 7e 调查员职业模板 + 技能列表
- COC 特有的 SAN 机制（如果实现与 COC 完全一致）
- 其他 Chaosium IP：Glorantha / RuneQuest / Pendragon / King Arthur 等

**可以用的**：

- BRP **d100 检定** + 技能值机制（这是 ORC Licensed Material）
- BRP 的 hit location / 受伤判定 / magic 抽象框架
- BRP 的角色属性骨架（STR / DEX / INT / POW / CON 等通用骨架）

**灰色但可绕**：

- "Lovecraft 神话" 本身的角色（克苏鲁、达贡、深潜者等出自 Lovecraft 原文的）：**Lovecraft 1937 去世，中国 1988+ public domain**，可以用 → 但避免用 Chaosium 版本的设定（如 Chaosium 给克苏鲁加的"召唤代价"具体数值表）
- "理智值"概念：**概念本身不受版权保护**，但**SAN 这个名字 + COC 的具体算法**是 Chaosium 的 → 改名 + 改算法即可（如"心智度""精神耐久度""Resonance Drain"）

---

## ORC ShareAlike 传染性 vs 你的 V0 商业模式

### 问题

ORC 强制 "Adapted Licensed Material" 开源回馈。意味着：

- 你用 BRP 的 d100 检定逻辑 → 你写的检定逻辑必须 ORC 开源
- 你用 BRP 的 hit location → 你的 hit location 实现必须 ORC 开源
- 你用 BRP 的角色属性骨架 → 必须开源

### 跟你之前定的 SillyTavern AGPL 路径有冲突吗？

**没冲突，反而对齐**：

- 你已经选了 fork SillyTavern → 整个前端必须 AGPL 开源
- 加上 ORC 规则引擎 → 规则部分必须 ORC 开源
- **两个协议都强制开源代码，所以 V0 整个产品代码本来就是开源的**
- 商业模式都靠"内容 + 服务"（剧本商店、LLM 流量、托管）

**实际上 AGPL + ORC 组合是 V0 最干净的合规组合**，没有版权地雷。

### 但有一个细节要注意

**Reserved Material 章节让你能保留你写的剧本本身**：

- 你写的"原创克苏鲁风剧本"本身 = Reserved Material → **可以私有 / 收费销售**
- 你用 BRP 规则跑这本子 = Licensed Material → 那部分代码开源
- **最终：剧本卖钱 + 规则引擎开源**（这正是 V0 商业模式想要的）

---

## Path 2 的具体执行方案（V0 可用）

### 技术层

```
[ 前端 / 交互 ]   fork SillyTavern         (AGPL-3.0 开源)
        ↓
[ 规则引擎 ]     基于 BRP-ORC d100         (ORC 开源)
                + 自创"心智度"机制         (Reserved 私有)
                + 自创"调查员"等角色模板术语  (Reserved 私有)
        ↓
[ 剧本内容 ]     原创克苏鲁风剧本           (Reserved 私有，收费销售)
                基于 Lovecraft public domain 原文
                避开 Chaosium 特有设定
```

### 内容层

**第 1 本 V0 候选**：

- 主题来源：Lovecraft 短篇 **《The Shadow over Innsmouth》(印斯茅斯之影)** 或 **《Pickman's Model》(皮克曼的模特)** 或 **《The Music of Erich Zann》(埃里希·赞恩的音乐)**
- 玩法形态：单人调查者 + 60-90 分钟单线流程
- AI 角色：你（调查者）的"导引者"（不能叫 Keeper，那是 COC 名）
- 替代命名：**"理智耗损"**（不叫 SAN）/ **"洞察值"**（不叫 INT）/ **"探者"**（不叫 Investigator）

### 工程层

- BRP d100 检定算法 → 写在独立 module，发到 GitHub ORC 下开源
- 你的产品代码（用 BRP module 那部分）→ ORC 开源
- 你的产品代码（其他部分）→ AGPL（因为 fork ST）开源
- 剧本 JSON / Markdown 内容 → 私有，加密存数据库
- AI prompt → 自有 IP，私有

---

## 5 个风险点（Path 2 走通前要先想清楚）

| # | 风险 | 应对 |
|---|---|---|
| 1 | **Chaosium 看到产品后认为"理智耗损"跟 SAN 实质同质** | 算法故意改：不只 d100 vs POW×5，加入"长期 trauma 累积"机制 |
| 2 | **用户认为这"不是真 COC 体验"** | 营销话术：定位"克苏鲁风新派" / "AI 时代的洛夫克拉夫特" |
| 3 | **ORC ShareAlike 让对手直接抄走规则引擎** | 接受 — 反正这本来不是护城河，内容 + AI prompt 才是 |
| 4 | **AGPL + ORC 双开源吓退潜在投资人** | 同上 — 这赛道护城河就不在代码，在内容 + 网络效应 |
| 5 | **你写不出"原创克苏鲁风"剧本质量** | Plan B 还原回 Path 1（谈作者授权） |

---

## 一句话决策

**Path 2 法律通路完全可走**，组合：fork SillyTavern (AGPL) + BRP/ORC d100 规则 + Lovecraft 中国 public domain 改编 + 自创术语命名。代码全开源接受、内容私有保留作为商业资产。

但**风险 #5（founder 能不能写出像样的本子）是真正的 critical path**。先答这道，再决定路径 1 vs 路径 2 的混合比例。

## 数据来源

- Paizo ORC License 官方页 + 完整条款 (II.a / II.b / I.h)
- Chaosium "BRP Universal Game Engine ... under the ORC license" (2023)
- Chaosium Fan-Use and Licensing Q&A
- 中国版权法 50 年规则（Lovecraft 1937 去世 → 1988+ 中国 public domain）
