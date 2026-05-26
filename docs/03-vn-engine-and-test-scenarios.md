# VN 引擎选型 + 测试本子候选清单

> 调研日期：2026-05-26
> 缘起：MVP pivot 到"galgame 风可玩界面 + 用户自带本子 + 完全开源" → 需要重选前端骨架 + 准备测试本子
> 决策影响：本文档结果将覆盖 03-product-direction-v0.md 里的"前端 = fork SillyTavern"决定

## TL;DR

- **前端骨架推荐：WebGAL** (3809★, MPL-2.0, 中文社区事实标准, web 原生, 极活跃)。**不再 fork SillyTavern**，UI 哲学完全不同。
- **测试本子推荐先抓 4 本**：
  1. 《Alone Against the Flames》(Chaosium 官方免费 PDF, 英文, 标杆参照)
  2. 《追书人》(cnmods, 新手推荐, 半开放地图)
  3. 《蠕虫》(cnmods, 中等复杂度)
  4. 《Alone Against the Frost》(Chaosium 官方付费 / 部分免费, 北极探险, 节奏紧)
- **关键工程任务**：写一个"LLM 输出 → WebGAL Script DSL" 的适配层（约 1-2 周）

---

## 前端骨架对比

### 候选引擎横向数据

| Engine | ★ | +3m | +12m | contrib | 4w | 52w | License | Lang | 主场 | 状态 |
|---|---:|---:|---:|---:|---:|---:|---|---|---|---|
| **OpenWebGAL/WebGAL** | 3809 | +17 | +286 | 43 | **45** | 352 | **MPL-2.0** ✅ | TS | Web | 🔥 活跃 |
| renpy/renpy | 6515 | +56 | +422 | 265 | **102** | 1351 | LGPL (隐式) | Ren'Py | 桌面 | 🔥 活跃 |
| DRincs-Productions/pixi-vn | 122 | +7 | +44 | 3 | **122** | 1140 | LGPL-2.1 | TS | Web | 🔥🔥 极活跃 (单人 burn) |
| Monogatari/Monogatari | 843 | +5 | +31 | 34 | **0** | 38 | MIT | TS | Web | 💀 已停滞 |
| Lunatic-Works/Nova | 707 | +4 | +40 | 12 | 0 | 45 | MIT | C# (Unity) | Unity | ⚠️ 缓 |
| RimoChan/Librian | 790 | +5 | +26 | 7 | 0 | **0** | MPL-2.0 | Python | 桌面 | 💀 2021 后已死 |
| Kirilllive/tuesday-js | 651 | +8 | +41 | 6 | 3 | 85 | Apache-2.0 | HTML | Web | ⚠️ 缓 |
| NarraLeaf/narraleaf-react | 50 | +5 | +25 | 2 | 0 | 85 | MPL-2.0 | TS | Web | 🌱 太早 |

### 候选引擎 4 维度评分

| 维度 | WebGAL | Ren'Py | pixi-vn | Monogatari |
|---|---|---|---|---|
| 中文社区契合度 | 🟢 母语项目 | 🟡 老牌英文 | 🟡 英文 | 🟡 英文 |
| Web 原生 | 🟢 浏览器跑 | 🔴 桌面优先 (web 弱) | 🟢 Pixi 原生 | 🟢 web 原生 |
| 商业可商用 | 🟢 MPL-2.0 | 🟢 LGPL (动态链接 OK) | 🟢 LGPL-2.1 | 🟢 MIT |
| 跟我们 AGPL+ORC 兼容 | 🟢 兼容 | 🟢 兼容 | 🟢 兼容 | 🟢 兼容 |
| LLM 动态生成支持 | 🔴 无原生，要自写适配 | 🔴 无原生 | 🟡 现代框架易接入 | 🔴 无原生 |
| 立绘/CG/动效成熟度 | 🟢 完整 (Pixi-Spine) | 🟢 老牌完整 | 🟡 Pixi 基础但 VN 框架早期 | 🟡 简单 |
| 中文用户认知度 | 🟢 大批 UP 主用过 | 🟡 小众但有 | 🔴 无 | 🔴 无 |
| 工程接入难度 | 🟡 自定义 DSL 要学 | 🟢 Python 通用 | 🟢 TypeScript 现代 | 🟢 简单 |
| **综合** | **🟢🟢 推荐主选** | 🟡 备选（桌面专向） | 🟡 长期备选（极活跃但太早） | 🔴 不选 |

### WebGAL 的关键 "gotchas"

1. **自定义 DSL（WebGAL Script）** —— 文档里说"3 分钟学会"，但**我们要让 LLM 实时生成**这件事意味着要写：
   - "LLM 自由文本 → WebGAL Script" 的适配器（1-2 周工程）
   - 检定结果 → 触发对应 WebGAL 分支
   - 立绘选择 / 表情切换 / 场景切换 也要从游戏状态变成 Script 命令

2. **无原生 LLM 集成** —— 没有现成范例可抄。我们做这件事就是**填空位**，但意味着没有"参考实现"

3. **MPL-2.0 协议影响** —— 你修改的 WebGAL 文件必须开源回馈，但**单独的新文件可以保留任何协议**。意味着：
   - 我们 fork WebGAL 改 UI 那部分 → 必须 MPL
   - 我们写的"LLM 适配器""规则引擎"作为独立模块 → 可保持其他协议
   - **跟 AGPL 不冲突**（不同模块）

### 推荐决策

**WebGAL 作为前端骨架，自写"LLM-to-WebGAL-Script 适配层"**。

- 主框架：fork WebGAL
- 新增层：LLM 适配器 + 规则引擎（D100 + 心智耗损）+ 剧本解析器
- 协议组合：WebGAL 部分 MPL / 适配层 ORC / 整体 AGPL（如果选 SaaS 部署）

**SillyTavern fork 计划取消** —— 它的 chat UI 范式跟 galgame 不搭，World Info / Lorebook 在 V0 用不上。

---

## 测试本子候选清单（V0 开发阶段用）

### 筛选维度

| 维度 | 重要性 |
|---|---|
| **能否拿到完整文本** | 🔴 必备（PDF/Markdown 可解析） |
| **是否单人本** | 🔴 必备（MVP 只做 1 人团） |
| **复杂度梯度** | 🟢 要 3 档（线性/中等/分支密集） |
| **协议状态** | 🟡 开发测试用 OK，**不分发** |
| **中文用户认知度** | 🟢 优先选有名的 |
| **长度** | 🟢 60-180 分钟最理想 |

### 推荐 4 本（按复杂度梯度）

#### 1. 《Alone Against the Flames》— 简单线性 · 标杆参照

- **来源**：Chaosium 官方免费 PDF (https://www.chaosium.com/content/FreePDFs/CoC/Adventures/CHA23145%20-%20Alone%20Against%20the%20Flames.pdf)
- **格式**：50 页 PDF，英文，纯文本可 OCR
- **结构**：选择支冒险书风格（Choose Your Own Adventure），章节用编号跳转
- **长度**：60-90 分钟单本
- **复杂度**：⭐⭐ 入门款，线性 + 少数分支
- **测试价值**：**业界 baseline**，所有 AI KP 项目都拿它做参照
- **协议**：Chaosium 官方版权，免费下载允许，**不能分发改编版** → 开发测试 OK
- **抓取**：直接下载 PDF

#### 2. 《追书人》— 中等 · 中文新手友好

- **来源**：cnmods (魔都) https://wiki.cnmods.org/user/%E4%BF%AE%E5%8F%BD/%E8%BF%BD%E4%B9%A6%E4%BA%BA
- **格式**：cnmods 模组页（HTML / 可下载 PDF 看个别作者发布版本）
- **结构**：1920 年背景半开放地图单人本，多个 NPC 互动 + 选择性触发
- **长度**：约 2-3 小时
- **复杂度**：⭐⭐⭐ 中等 — 不大的地图 + 不夸张的怪 + 不困难的交涉 + 不复杂的真相
- **测试价值**：**中文圈最常被推荐给新手的单人本**，能验证"半开放地图"的处理
- **协议**：CC BY-NC-SA 4.0
- **抓取**：cnmods 注册账号可下载

#### 3. 《蠕虫》(以太蠕虫) — 中等偏难 · 中文知名

- **来源**：cnmods https://cnmods.net/mobile/moduleDetail?keyId=4609
- **格式**：cnmods PDF
- **长度**：未确认（cnmods 标注，估 3-4 小时）
- **复杂度**：⭐⭐⭐⭐ — 知名中文单人本，叙事密度高 + 检定密集
- **测试价值**：**检定密集场景压力测试**
- **协议**：CC BY-NC-SA 4.0

#### 4. 《霜寒独行》— 现代版 · 简短

- **来源**：cnmods https://cnmods.net/mobile/moduleDetail?keyId=4595
- **格式**：cnmods PDF
- **长度**：预估 1-2 小时
- **复杂度**：⭐⭐ — 现代背景，叙事紧凑
- **测试价值**：**短本 + 现代设定**，跟前面 1920 经典互补
- **协议**：CC BY-NC-SA 4.0

### 备选 3 本（pool 扩充用）

- **《棺木与百合》** —— 中文经典，需查 cnmods 找具体页
- **《觅真系列》** (cnmods keyId=3804) —— 系列本，可挑系列 1
- **CSC ソロシナリオ：琥珀の牢** —— 日语版本，用于验证多语种解析（出海铺路用）

### 法律边界提醒

| 用途 | 法律状态 |
|---|---|
| 开发期下载 + 本机测试 | ✅ 合法（"个人非商用阅读使用"） |
| 把本子打包进产品分发 | ❌ 违反 Chaosium / CC BY-NC |
| 用本子内容训练 LLM fine-tune | ⚠️ 灰色（看 jurisdiction） |
| 让用户上传本子在产品里跑 | ✅ 用户自带，平台不分发 |
| 截屏放营销材料 | ⚠️ 看具体 fair use 边界 |

**V0 设计原则**：**产品永远不下载/缓存用户没上传的本子**。用户带本进来，本地处理，session 结束清空。这条原则同时解决了授权问题 + 内容版权问题。

---

## 立刻可做的 3 件具体事

1. **本机 clone WebGAL 跑一个 demo** —— 拿官方 sample 跑通，熟悉 DSL（30 分钟）
2. **下载 4 本测试本子放到本地 `/test-scenarios/` 目录** —— 注意：私有目录，不入 git
3. **画一张 "LLM 输出 → WebGAL Script" 的转换 schema 草图** —— 决定 V0 工程切入点

## 数据来源

- GitHub Search/REST API + OSSInsight (raw-vn-engine-metrics.json)
- Chaosium 官方页（Alone Against the Flames）
- WebFetch WebGAL GitHub README
- cnmods.net + wiki.cnmods.org
- 知乎 / CSDN 中文 WebGAL 评测
