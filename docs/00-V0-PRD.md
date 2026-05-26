# V0 PRD · AI COC 单人本 Galgame 引擎

> 起草日期：2026-05-26
> 状态：草案 v0（基于调研周期所有产物综合）
> 上游产物：00-DECISION-SUMMARY / 02-竞品报告 / 03-产品方向 v0 / 04-office-hours / 05-content-licensing / 06-orc-license / 07-vn-engine / 08-long-form-engines
> 本文档覆盖 03-product-direction-v0.md（V0 因多轮 pivot 已大幅简化）

---

## 1. 产品定位（一句话）

**一个完全开源的"AI 当 Keeper 跑 COC 单人本"游戏引擎，输出 galgame 风可玩界面，玩家自带本子，本地运行。**

不卖本子。不卖账号。不卖流量包。Code is law、Content is yours。

---

## 2. 我们在做什么 / 不在做什么

### 在做（V0）

- ✅ 一个 web 应用（FOSS）
- ✅ 用户上传 COC 单人本（PDF/MD/txt）→ 系统解析 → AI 当 KP 跑
- ✅ Galgame 风渲染（立绘 + 对话框 + 选择支 + 背景）
- ✅ COC 7e 风规则引擎（D100 检定 + 心智耗损 + HP）
- ✅ 调查员（投属性 / 选职业 / 分技能点）向导
- ✅ 本机 save/load（localStorage / IndexedDB）
- ✅ 用户自带 LLM API key（OpenAI / DeepSeek / Anthropic 等）
- ✅ "诚实派"规则引擎：D100 / 心智 / HP 由代码硬控，AI 只负责描述 + 选择该检定的技能 + 叙事结果

### 不做（V0 砍刀）

- ❌ 多人本 / 在线协作
- ❌ 账号系统 / 服务器持久化
- ❌ 剧本商店 / 内容分发
- ❌ 海豹骰兼容（角色卡互导推迟 V1+）
- ❌ TTS 配音（V1+）
- ❌ AI 立绘动态生成（V0 用静态素材）
- ❌ 视频导出（V0 只做截图）
- ❌ 多语言（V0 中文）
- ❌ 移动端原生 App（V0 响应式 web）
- ❌ 任何商业化（V0 完全免费 + 开源）

---

## 3. 目标用户

### V0 用户 = Founder 本人 + 圈内朋友 ≤ 10 人

- 中文 COC 重度玩家（玩过 ≥ 5 本）
- 跑团跑不齐人的痛点持有者（office-hours Q1 验证）
- 能自己搞 LLM API key + 本子 PDF
- 接受半成品、愿意提交 bug 反馈
- **不是付费用户** —— 是 design partner

### V1+ 才考虑的扩展用户

- 想玩 COC 但完全没跑过团的小白（**需要内置 LLM 余额这层不做就进不来**）
- B 站 replay 内容创作者（**需要导出视频功能**）
- 中文 COC 圈作者（**用我们的引擎自验证本子设计**）

---

## 4. 用户故事（V0 必做）

### US-1 · 上传剧本

**作为玩家，我能上传一份 COC 单人本 PDF/Markdown 文件，让系统理解里面的场景结构。**

- 接受输入：PDF / Markdown / 纯文本 / WebGAL Script
- 输出：解析后的结构化 scenario JSON（场景节点 + 检定点 + 分支）
- 验收：能正确解析《Alone Against the Flames》《追书人》《蠕虫》《霜寒独行》4 本测试本

### US-2 · 创建调查员

**作为玩家，我能用向导创建调查员，投属性、选职业、分技能点。**

- 8 项基础属性（STR/DEX/INT/CON/POW/APP/SIZ/EDU）
- 投点支持：3d6 / 标准点数包 / 自定义
- 职业列表（V0 列 5-8 个：医生 / 记者 / 警察 / 学者 / 私家侦探 / 大学生 / 古董商 / 牧师）
- 技能点分配
- **导出**：本机 JSON 文件 (将来 V1 用作海豹骰兼容入口)

### US-3 · 跑本

**作为玩家，我能选定调查员 + 剧本，开始跑本，AI 当 Keeper 描述场景、判定检定、推进剧情。**

- 主循环：场景描述 → 玩家行动（自由文本 or 选择支）→ 规则引擎判定检定 → AI 描述结果
- D100 检定：选定技能 + 投骰 + 判定 → 返回 大成功 / 极难成功 / 困难成功 / 普通成功 / 失败 / 大失败
- 心智耗损：触发节点扣值 + POW×5 检定 + 失败再扣
- HP：受伤扣值 + 死亡判定
- **AI 不能编规则**：所有检定通过规则引擎 API，AI 只能描述

### US-4 · Galgame 体验

**作为玩家，我看到的不是聊天框，而是带立绘 / 对话框 / 选择支 / 背景的 galgame 界面。**

- 立绘：V0 用静态素材库（含一组通用立绘 + 玩家可上传）
- 对话框：标准 VN 风格（底部宽 + 角色名 + 文字打字机效果）
- 选择支：浮层按钮
- 背景：场景切换 + fade 转场
- 检定动效：D100 骰子动画 + 结果浮层

### US-5 · 存档 / 读档

**作为玩家，我能随时存档、关浏览器、之后从同一个地方继续。**

- 多存档槽（≥ 5 个）
- 自动存档（每个场景节点）
- 手动存档
- 存档内容：调查员 + 剧本 + NarrativeState 全部 snapshot
- 存储：localStorage / IndexedDB（本机）

### US-6 · 设置 LLM

**作为玩家，我能在设置里填自己的 LLM API key（OpenAI / DeepSeek / Anthropic / 自部署 endpoint）。**

- 多 provider 切换
- API key 本机 localStorage 加密存储
- 测试连接按钮
- 默认推荐 DeepSeek（中文成本最低）

---

## 5. 架构

### 总览

```
┌─────────────────────────────────────────────────────────┐
│  WebGAL Renderer  (fork, MPL-2.0)                       │
│  ┌─ 立绘  ┌─ 对话框  ┌─ 选择支  ┌─ 背景  ┌─ 骰子动画     │
└───────────────────────▲─────────────────────────────────┘
                        │ WebGAL Script (动态生成)
┌───────────────────────┴─────────────────────────────────┐
│  WebGAL Adapter Layer (自写, ORC 或 MIT)                 │
│  从 game state 翻译成 WebGAL Script 命令                  │
└───────────────────────▲─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│  Game Engine Core  (自写, MIT)                          │
│                                                         │
│  ┌─ NarrativeState 抽象接口                              │
│  │   (V0: 自写状态机) (V1: ink runtime)                 │
│  │                                                      │
│  ├─ Rules Engine                                        │
│  │   D100 / 心智耗损 / HP / 技能表 / 检定判定             │
│  │                                                      │
│  ├─ LLM Adapter                                         │
│  │   prompt 工程 / 描述生成 / NPC 对话 / 检定结果叙事     │
│  │                                                      │
│  └─ Scenario Parser                                     │
│      PDF/MD/txt → Structured Scenario JSON              │
│      (内部用 LLM + 规则后处理)                            │
└───────────────────────▲─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│  External                                               │
│  ┌─ OpenAI / DeepSeek / Anthropic API                  │
│  └─ 用户上传 scenario 文件                                │
└─────────────────────────────────────────────────────────┘
```

### NarrativeState 接口定义（V0 关键抽象）

```typescript
interface NarrativeState {
  // 进度
  current_scene_id: string;
  visited_scenes: Set<string>;
  choice_history: { scene: string; choice: string; ts: number }[];

  // 调查员
  investigator: Investigator;

  // 游戏状态
  sanity: number;        // 心智度（不叫 SAN，避开 Chaosium IP）
  hp: number;
  mp: number;
  inventory: Item[];
  npc_relations: Map<string, NpcRel>;
  flags: Map<string, boolean>;

  // API
  apply_check_result(skill: string, result: CheckResult): void;
  apply_sanity_loss(amount: number, reason: string): void;
  jump_to_scene(scene_id: string): void;
  save(): Snapshot;
  load(s: Snapshot): void;
}
```

V0 用自写实现；V1 把内部换成 ink runtime（外部接口不变）。

---

## 6. 技术栈

| 层 | 选型 | 协议 |
|---|---|---|
| 前端框架 | fork OpenWebGAL/WebGAL | MPL-2.0 |
| 语言 | TypeScript | - |
| 状态管理 | 自写 NarrativeState (V0) / ink runtime (V1) | MIT / MIT |
| Rules Engine | 自写 D100 / Sanity / HP | MIT |
| LLM SDK | OpenAI SDK + 多 provider 适配 | MIT |
| Scenario Parser | LLM-assisted + 规则后处理 | MIT |
| 持久化 | localStorage / IndexedDB | (浏览器原生) |
| 部署 | 静态 SPA + GitHub Pages / Vercel | - |
| 包管理 | pnpm / bun | - |

**协议组合最终**：
- WebGAL 改动部分 → MPL-2.0 强制
- 自写的核心引擎 + 适配层 → 选 MIT 或 ORC（推荐 MIT，简单）
- 整体仓库根目录 → MIT（独立模块各自标自己协议）
- **无 AGPL**（因为不再 fork SillyTavern）—— **重大变化**

> ⚠️ 注意：之前文档（03 / 05 / 06）里多次提到 AGPL 是基于 fork SillyTavern 的假设。**V0 改 fork WebGAL 后，AGPL 不再适用**。商业模式约束相应松绑（但 V0 本来就不打算商业化，影响不大）。

---

## 7. 里程碑（10 周）

| 周 | 工作 | 验收 |
|---|---|---|
| W1 | 本机 clone WebGAL，跑通官方 sample，理解 DSL | 能改一句对白看到效果 |
| W2 | 设计 NarrativeState 接口 + 调查员模型，自写状态机 | unit test 覆盖核心 transitions |
| W3 | D100 / 心智 / HP / 技能表 Rules Engine | 单元测试 + 跟 COC 7e 规则比对 |
| W4-5 | LLM Adapter prompt 工程：场景描述 / NPC 对话 / 检定叙事 | 能在 console 里跟 AI 跑一个最简场景 |
| W6-7 | Scenario Parser：从《追书人》PDF 提取场景 JSON | 一本完整本子能解析成结构化数据 |
| W8 | WebGAL Adapter Layer + UI 改造 | 端到端跑通《追书人》第一个场景 |
| W9 | Save/Load + 调查员向导 | 完整功能可玩 |
| W10 | 整合 4 本测试本 + 自玩 + 改 bug | 4 本都能跑完整轮，截图分享得出去 |

---

## 8. 验证 gate（V0 达成什么算完）

- ✅ 至少 1 本测试本（《追书人》优先）能跑完整轮
- ✅ Founder 自己玩完一轮觉得"比看 B 站 replay 视频强"
- ✅ 截图能直接发 B 站动态 / Twitter / Lofter
- ✅ 圈内 10 个 COC 玩家能拿到 demo 链接跑出来
- ✅ 至少 3 个玩家说"这玩意儿挺有意思"

V0 不验证：商业化 / 留存 / 增长 / 任何商业指标。

---

## 9. 已识别风险

| # | 风险 | 应对 |
|---|---|---|
| 1 | **Scenario Parser 是 V0 工程命脉** —— PDF 解析准确度差则全套垮 | W6-7 做技术 spike，必要时改 "本子需先转 markdown 格式" 的限制（用户多花 30 分钟整理）|
| 2 | LLM 还是会偶尔编规则 | prompt 里加严格"你不能丢骰子，丢骰子是引擎工作"，UI 上检定结果有显式动画 |
| 3 | WebGAL DSL 学习 + 适配工程量大于预期 | 备选：放弃 WebGAL，用 vnjs / 自写 React VN 组件 |
| 4 | 心智耗损 / 调查员命名仍然太像 COC，被 Chaosium 注意 | 改命名 → "理智耗损"/"清醒值"，文档明确说"克苏鲁风" 不挂 COC 名 |
| 5 | Founder 实际工程能力不够独立完成 | 找 1-2 个工程师朋友（不需要懂跑团，懂 TS/React 就行）|
| 6 | 10 周内做不完 | 砍 US-6（默认 hardcode 一个 LLM provider）/ 砍 US-4 一部分（不做动效）|

---

## 10. V1+ 路线（不在 V0 scope，但 v0 架构必须为之留位）

| 功能 | 升级时机 | 架构预留 |
|---|---|---|
| ink runtime 接入 | V1 (10w+ 字 campaign) | NarrativeState 接口 |
| 海豹骰人物卡互导 | V1 | 调查员模型从 V0 就支持 export JSON |
| TTS 配音 | V2 | LLM Adapter 输出已经是结构化的 dialogue events |
| 视频导出 | V2 | 截图功能 + 多帧拼接 |
| 多人本（远期）| V3+ | NarrativeState 现在是单玩家状态，要重写为 multi-player 状态 |
| 商业化（远期）| V3+ | 现在完全 FOSS，未来考虑 "open core + 服务" 模式 |

---

## 11. 立刻可做的 3 件事（开发启动）

1. `git clone https://github.com/OpenWebGAL/WebGAL.git`，本机跑通官方 sample
2. 下载 4 本测试本（《Alone Against the Flames》/《追书人》/《蠕虫》/《霜寒独行》）放本地 `/test-scenarios/`（不入 git）
3. 起一个新 repo（建议名：`ai-coc-keeper` 或 `cthuluvn-engine`，避开 Chaosium 商标），写 README 把这份 PRD 简化版放上去

---

## 附录：本调研周期所有决策一句话回顾

| 节点 | 决定了啥 |
|---|---|
| 00-DECISION-SUMMARY | 赛道有空位，MVP 切"中文 COC 单人本"|
| 03-product-direction-v0 | 三件套：海豹生态 + Project_Infinity + 酒馆前端 |
| 04-office-hours | Q4 选了"1 本具体的 COC 单人本·AI 带跑"|
| 05-content-licensing | 中文模组 CC NC，Chaosium 严，Path 1 + Path 2 并行 |
| 06-orc-license | ORC + AGPL + Reserved Material 三重组合合法 |
| 07-vn-engine | 砍掉 ST fork，选 WebGAL |
| 08-long-form-engines | V0 WebGAL only，V1 加 ink runtime；NarrativeState 接口预留 |
| **09-v0-prd（本文档）** | **V0 完全开源 / 用户自带本 / WebGAL + 自写引擎 / 10 周 / Founder 自玩 = 验收**|
