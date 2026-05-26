# 长时长作品 VN/叙事前端选型 · 拓展调研

> 调研日期：2026-05-26
> 缘起：07-vn-engine-and-test-scenarios.md 推荐 WebGAL，用户问"能扛长时长作品的还有哪些"
> 本文档拓展视野：**业界长时长作品的真实架构是"两层" —— 叙事脚本语言 + 渲染层**

## TL;DR

- **业界长时长作品（10+ 小时 / 20+ 万字 / 复杂分支）的事实架构是两层**：
  1. **叙事脚本语言层**：ink (inkle) / Yarn Spinner / Twine SugarCube / ChoiceScript — 管分支、状态、变量、save/load
  2. **渲染层**：WebGAL / Ren'Py / Naninovel / 自写 React VN — 管立绘、对话框、CG、音效
- **我们的 MVP V0**（60-120 分钟单本）：WebGAL **单层就够**，不用上 ink
- **但 V1+**（多本平台 / AI 长 campaign / 复杂状态记忆）：**强烈建议引入 ink runtime 作为叙事状态管理**
- **总建议**：MVP **WebGAL only**，但**架构 day 0 就预留 ink 集成位**（写一个 NarrativeState 抽象层），未来无痛切换

---

## 业界长时长作品的真实做法

### 标杆游戏 → 用的什么引擎

| 游戏 | 时长 | 字数级 | 用的引擎 / 语言 |
|---|---|---|---|
| **80 Days** (inkle, 2014) | 8-20h | 50w 字 | **ink** + 自有 Unity 渲染 |
| **Heaven's Vault** (inkle, 2019) | 20-40h | 100w+ 字 | **ink** + 自有 Unity 渲染 + procedural narrative |
| **Sorcery!** 系列 (inkle) | 10-15h × 4 | - | **ink** + 自有 Unity 渲染 |
| **Night in the Woods** | 8-12h | 大量 | **Yarn Spinner** + Unity |
| **A Short Hike** | 1-2h | 中等 | **Yarn Spinner** + Unity |
| **Steins;Gate** 系列 | 30-50h | 60-100w 字 | **吉里吉里 KiriKiri** + KAG3 (商业闭源) |
| **Choice of Robots** (CoG) | 5-15h | 30-50w 字 | **ChoiceScript** + 自家网页 |
| **Disco Elysium** | 25-40h | 100w+ 字 | 自研 ZA/UM 引擎 |

### 模式总结

| 类型 | 例子 | 模式 |
|---|---|---|
| **小型 / 短篇 / 单线** (< 2h) | 大量同人 VN | 引擎一层搞定（Ren'Py / WebGAL / TyranoBuilder） |
| **中型 / 多结局** (3-8h) | 多数商业 VN | 引擎 + DSL（KAG3 / Ren'Py script / WebGAL Script） |
| **大型 / 复杂分支** (10h+) | inkle 全部 / Night in the Woods | **两层**：narrative scripting (ink/Yarn) + custom rendering |
| **巨型 / 程序生成** (40h+) | Heaven's Vault / Disco Elysium | 全自研叙事系统 / 自定义 DSL |

---

## 候选引擎横向（含长时长适配能力）

### 数据对比（GitHub）

| 项目 | ★ | +3m | 4w commits | 协议 | 主语言 | 长时长能力 | AI 集成易度 |
|---|---:|---:|---:|---|---|---|---|
| **inkle/ink** | 4772 | +24 | 6 | MIT | C# | 🟢🟢 标杆 (80 Days/Heaven's Vault 都用) | 🟢 runtime API 友好 |
| inkle/inky | 2665 | +10 | 5 | - | JS | (是 ink 的 IDE) | - |
| **YarnSpinnerTool/YarnSpinner** | 2770 | +14 | 14 | MIT | C# | 🟢 (Night in the Woods 长篇用过) | 🟢 |
| renpy/renpy | 6515 | +56 | 102 | LGPL | Ren'Py | 🟢 桌面老牌长篇王 | 🟡 Python 接 LLM 还行 |
| **OpenWebGAL/WebGAL** | 3809 | +17 | 45 | MPL-2.0 | TS | 🟡 中等（DSL 强但状态不专长）| 🔴 需自写适配 |
| Twine/SugarCube | (Twine ★2k) | - | 活跃 | GPL | JS | 🟢 IF 圈长篇标准 | 🟡 web 友好但 LLM 集成要写 |
| Naninovel | 闭源 ($150) | - | - | 商业 | C# | 🟢 商业标准 | 🟡 Unity 内嵌 |

### Inkle ink 是最适合"AI 长 campaign" 的工具

**关键能力**：
- **runtime API**：可以从外部代码动态注入 ink 内容、查询状态、跳转节点 → **跟 LLM 实时生成完美适配**
- **变量 / state 持久化**：built-in，支持 save/load
- **分支语法极简**：`* [选择项 A]` / `* [选择项 B]` 即可，作家友好
- **procedural narrative 支持**：inkle 用它做 Heaven's Vault 的"AI 般" 对话池
- **runtime 跨平台**：C# 官方，社区有 ts-ink (TypeScript) / ink-go (Go) / tinta (Lua) / inkpy (Python) / inkjs

**对我们的意义**：
- AI 实时生成的剧情可以直接被打包成 ink 片段，runtime 接管状态
- 心智耗损 / 检定结果 / NPC 关系 全部用 ink 变量管理
- save/load 不用自己重新发明轮子

---

## 4 档架构方案（按野心从小到大）

### Tier 1 · 简单单层 · MVP V0 适用

```
LLM 实时生成文本 → WebGAL Script → WebGAL 渲染
                ↑
            自写的 D100 规则引擎 + 状态机
```

- **时长支持**：1-3 小时单本
- **工程量**：4-6 周
- **优点**：架构简单、快速迭代、跟现在的 MVP scope 完全对齐
- **缺点**：到 5-10 小时长 campaign 时状态机会膨胀失控
- **推荐**：**V0 走这个**

### Tier 2 · 两层 web · V1 平台化适用

```
LLM 实时生成 ink 片段 → ink runtime (TS/JS) → 状态管理
                                          ↓
                                 渲染指令 → WebGAL / 自写 React VN
```

- **时长支持**：5-15 小时多场景多分支
- **工程量**：8-12 周（额外 4-6 周做 ink 集成 + 状态层）
- **优点**：行业事实标准 + 长 campaign 不崩 + save/load 免费
- **缺点**：双层架构需要明确边界划分
- **推荐**：**V1 升级到这个**

### Tier 3 · 桌面长篇 · 类 inkle 路线

```
ink 脚本 + LLM 注入 → ink runtime → Unity / Ren'Py 桌面
```

- **时长支持**：20h+
- **工程量**：6 月+
- **不推荐**：跟 MVP 不匹配，桌面分发跟我们 Web FOSS 定位冲突

### Tier 4 · 全自研叙事引擎 · 类 inkle / Disco Elysium 终态

- **不推荐**：MVP 不该考虑

---

## 推荐路径

### MVP V0 (现在) — Tier 1

**WebGAL + 自写 LLM 适配 + 自写规则引擎**

V0 范围明确：1 本 × 1-3 小时 × 单线性流程 + 少量分支。这个 scope 下 ink 是 overkill，自写状态机够用。

**但**：**架构 day 0 就预留 ink 集成位** —— 写一个 `NarrativeState` 抽象层，未来升级 V1 时无痛切换到 ink runtime。

具体说就是 NarrativeState 接口先写好：
```typescript
interface NarrativeState {
  current_scene: string;
  choice_history: Choice[];
  sanity: number;
  hp: number;
  skills: Map<string, number>;
  flags: Map<string, boolean>;
  save(): Snapshot;
  load(s: Snapshot): void;
}
```

V0 用自写实现；V1 换 ink runtime 实现，外部接口不变 → 上层代码 0 改动。

### V1 升级 (3-6 月后) — Tier 2

加 ink runtime 作为底层叙事状态管理：

- `inkle/ink` 官方 C# → 用 **ts-ink (TypeScript)** 或 **inkjs** web runtime
- AI 生成的剧情按 ink 格式封装写到 runtime
- 心智耗损 / SAN / HP / 关系等全部用 ink 变量
- save/load 跨设备同步用 ink snapshot

### 为什么不直接 V0 上 ink？

- ink 学习曲线 (1-2 周) + WebGAL 集成 (1-2 周) → MVP 启动延迟
- V0 单本场景不需要复杂分支管理
- 但**架构预留接口**保证了未来升级 0 痛

---

## WebGAL 跟 ink 各自的局限

### WebGAL 局限（针对长时长）

- 自定义 DSL 没有现成"长 campaign 范式" → 状态管理要自己写
- 内部用 JSON 存档，复杂分支跨场景管理不是它专长
- 中文社区案例多是中短篇（同人本、demo）

### ink 局限（针对我们的场景）

- 标杆游戏全部是 Unity，**web runtime（inkjs / ts-ink）社区比官方小很多**
- 跟视觉层完全解耦 = 你必须自己写视觉层（或挂 WebGAL）
- ink 语法对非英语作家有学习曲线（虽然简单但需要写"剧本"思维）

---

## 一句话决策

**V0：WebGAL + 自写 NarrativeState 抽象层**（不上 ink）。**V1：把 NarrativeState 切换到 ink runtime 实现，业务代码 0 改动**。

这条路径既保住了 MVP 速度，又保住了未来扩张能力。

## 数据来源

- GitHub Search/REST + OSSInsight
- 80 Days / Heaven's Vault / Sorcery 公开访谈（GameDeveloper / TouchArcade / MCV）
- Inkle Studios 官方页 + GDC Vault
- Choice of Games / Hosted Games platform
- VNDev Wiki（KiriKiri 6800 个游戏，TyranoBuilder 4700 个，Ren'Py 23000 个）
