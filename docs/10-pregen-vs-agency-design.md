# 预生成 vs 玩家能动性 · 设计思路

> 缘起：用户指出"预生成最大优势是减缓用户等待焦虑 + 节奏可控（不一口气看很多字）"，但要思考怎么做到"玩家操作对剧情真的有影响"。
>
> 这份文档不写代码，只把"如何同时拿到两件事"的设计空间画清楚，让我们能选一条最值得做的路径。

---

## 1. 当前两种模式的对比

| 维度 | 预生成 (`gen:ai-game`) | 真实时 (`server:live`) |
|---|---|---|
| 等待时间 | **0**（玩家点立刻看到结果）| **5-60s/次**（LLM 调用 + 网络 + tokens 输出） |
| 节奏控制 | 文本被切成 narrate / 选项 / 反馈三段，可慢看 | 整段 narrate 一次性吐 + 玩家容易跳过 |
| 玩家选择影响剧情 | **有限**：选 A 还是 B → 看到不同的 baked 结果；但 narrate 内容**不知道**玩家上一 scene 干了什么 | **完整**：每次 LLM 调用都看到 character 当前状态 / conditions / history |
| 工程复杂度 | 中（脚本 + 静态文件）| 高（HTTP server + session 管理） |
| Deploy 成本 | 低（任何 CDN）| 高（要 host LLM 调用 / API 流量）|
| LLM Token 成本 | 一次性预 burn ~1-3 元/本 | 每位玩家 ~0.5-3 元/局，玩多了贵 |

**预生成赢在 UX 体验 + 部署成本**，**真实时赢在剧情真实响应**。

---

## 2. 玩家"卡壳"焦虑的核心来源

不是单纯"等 LLM"，而是**期望与反馈断裂**：

| 状况 | 玩家心理 |
|---|---|
| 点按钮 → 0.3s 内出现新文字 | "我在玩游戏" |
| 点按钮 → 1-2s 后出文字 | "网速不错" |
| 点按钮 → 3-5s 后出文字 | "在加载" |
| 点按钮 → **8s+ 后**才出文字 + 没有进度提示 | **"卡了 / AI 死了 / 我要刷新"** |
| 点按钮 → 看到 spinner + "AI 思考中" | 焦虑减半，但仍**不是游戏体验** |

实测真实时 server 现在 `enterScene` 要 30-60s（含 2 次 LLM 调用 + JSON parse）。**这是把玩家从"沉浸"扔到"等服务器"**。

---

## 3. 玩家"操作真影响剧情"的核心

不是单纯"选项数 > 1"，而是**记忆 + 因果**：

| 层次 | 例子 |
|---|---|
| 0. 假分支 | "上楼 / 下楼" 通向不同 narrate，但下一 scene 完全独立 |
| 1. 状态影响 | 选了"杀 NPC" → currentSanity -10 → 下一 scene 玩家心智度低 |
| 2. **叙事记忆** | scene 5 narrate 主动提到 "你在 scene 2 撒过的谎" |
| 3. 永久分支 | 选 A → 看到 scene 3，选 B → 看到完全不同的 scene 3' |
| 4. 玩家身份固化 | 多次选"懦弱避战" → AI 在 scene 7 写"你已经习惯了往后退一步" |

V0 真实时已经做到层次 1-2，但**预生成版本目前只到层次 0**（每个 scene 独立 gen，不知前情）。

---

## 4. 解题的核心洞察

**人读字速度 << LLM 生成速度**

| 内容长度 | 中文人读 (150-300 字/min) | LLM 输出 (~50-80 tok/s) |
|---|---|---|
| 100 字 narrate | 30-40s | 3-5s |
| 200 字 narrate | 1-1.5 min | 5-10s |
| 一整 scene (~600 字+ 4 选项 + 6 反馈) | 5-10 min | 30-60s |

**玩家在一个 scene 上停留的时间远大于生成下一 scene 的时间**。这是设计窗口期。

---

## 5. 四种解法 · 按工程复杂度递增

### 解法 A · 状态-aware 多变体预生成（"分支树" 模式）

**思路**：游戏开始时一次性预生成全部 scene 的 narrate，**但每个 scene 生成多个变体**（基于关键 state 组合）。

```
scene_basement narrate:
  variant_low_san        (SAN < 30)
  variant_high_san       (SAN >= 30)
  variant_has_phobia     (有 phobia condition)
  variant_no_phobia      (无)
```

玩家进 scene 时 server 按当前 state 选 variant。

**优点**：
- 玩家 0 等待
- 选择真有影响（不同 state → 不同 narrate）
- 静态可部署

**缺点**：
- 变体数爆炸：scenes × states 可能是 6 × 8 = 48 个变体
- 预生成时间 / token 成本 ×N
- 设计变体的"维度"很难：哪些 state 值得分变体？

### 解法 B · 后台续航生成（"无感预热" 模式）

**思路**：玩家在 scene N 阅读时，**后台开始 generate scene N+1**（基于当前 state）。等玩家做完选择，scene N+1 已经生成好。

```
T=0   玩家进 scene 1 (预生成已有)
T=2   玩家开始读 scene 1 narrate (200字, ~1.5 min)
T=2   后台:LLM call 开始 generate scene 2 variants (5-15s)
T=15  scene 2 准备好
T=90  玩家读完 + 选 exit → 立刻看到 scene 2 ✓
```

**优点**：
- 玩家 0 等待（如果阅读 > 生成时间）
- 选择真影响（scene N+1 看得到 scene N 之后的 state）
- 不需要预生成全树

**缺点**：
- 需要 HTTP server（不能纯静态部署）
- 玩家阅读快 → 偶尔会有 "稍等..." 闪一下
- 玩家在 scene 1 没选时，不知 generate 哪个 variant；要么全 variants 都 gen，要么猜最可能的

### 解法 C · 微动态化（"快+慢" 混合）

**思路**：把 scene 拆成 **"慢内容"（pre-gen） + "快内容"（live）**：

| 内容 | 模式 | 玩家体验 |
|---|---|---|
| 场景主 narrate (200-400 字) | **预生成** | 立刻看 |
| 在场景内的小行动结果 (50-100 字) | **真实时** | 5-10s 等 = 类似 "loading 翻页" 节奏 |
| 关键 transition (跳 scene) | **真实时** | 10-20s = 戏剧性停顿 (有意义的等) |

**优点**：
- 大段叙事零等待
- 小段动作是 "AI 正在写" 反而有沉浸感（戏剧性）
- 不预生成全树

**缺点**：
- 仍需 server
- 小动作的等仍是等
- 设计哪些算"慢"哪些算"快"要细心拿捏

### 解法 D · 离线深度预生成（"游戏书" 模式）

**思路**：把整本剧本生成成一个 **巨大的 CYOA 树**（类似 80 Days/Heaven's Vault 的 ink 模式）—— 每个 scene 都有多重 narrate，每个选择对应一条 ink 路径。

```
ink 节点:
  scene_basement_first_time
  scene_basement_after_killed_npc
  scene_basement_after_seeing_corpse  
  ...
```

LLM 在游戏开始前**一次性** generate 整本 ink，玩家玩时纯静态。

**优点**：
- 最彻底的"0 等待 + 选择真影响"
- 部署是静态的（一份 ink + WebGAL）
- 玩家可以反复玩看不同结局

**缺点**：
- LLM 一次性 gen 整本树 = token 几十块钱+
- 树状结构设计 / 校验难
- 每个变体的覆盖率取决于 LLM 想象力

---

## 6. 推荐路径 · V1 应该走的方向

**V1 主推：解法 B（后台续航） + 局部 C（关键 transition 是 live 戏剧停顿）**

理由：

1. **B 工程量适中**：在现有 HTTP server 基础上加 "background prefetch queue" 即可，~1-2 周
2. **C 几乎免费**：把现有"过渡叙事" prompt 升级，给玩家戏剧性 1-2s 停顿 (实际是 5-10s 但用 CSS 动画掩饰)
3. **A 留长期**：变体爆炸问题严重，等真有数据再做
4. **D 不做**：CYOA 树是 inkle 的玩法，不是我们 V0 的产品形态

### 实现 B 的最小可行版本（"V1.1 prefetch"）

1. server 当前 enterScene 已 gen "narrate + actions + transitions"
2. 新增：**enterScene 返回后立刻 trigger gen scene N+1 (all variants)** in async queue
3. variant 维度先做 1 个：基于 currentSanity bucket（<30 / 30-60 / 60+）
4. 玩家选择 exit 时 → 直接读 cached variant，**0 等待**
5. 若 cache miss (变体太多生成没跟上)，fallback 到 live gen

### 实现 C 的最小可行版本

1. 当前 `narrateTransition` (玩家选 exit) 已经是 LLM 调用，5-10s
2. **不要让等待变 spinner**，改成 WebGAL 转场动画（fade out 旧场景 + 黑屏淡入 + 字幕"你走过/穿过/逃离..."）
3. 玩家心理上感受是"戏剧停顿"，不是"等服务器"

---

## 7. 还需要回答的问题

| 问题 | 影响决策 |
|---|---|
| 玩家平均一 scene 停留多久？ | 决定 prefetch window 大小 |
| 一次 LLM 调用平均多久？ | 决定 prefetch 能否真覆盖等待 |
| 变体维度按 SAN 分够不够？还要 HP？conditions？flags？ | 决定 A/B 维度 |
| Token 成本预算上限？/ 局 | 决定能否多变体 |
| 玩家行为数据收集？ | 决定 prefetch 能否"预测"玩家选择 |

---

## 8. 下一步推荐顺序

| 优先 | 内容 | 工程量 |
|---|---|---|
| 1 | 把"过渡叙事"包装成戏剧性转场（解法 C 的最小版）| 半天 |
| 2 | server 加 background prefetch queue (解法 B v1)| 2-3 天 |
| 3 | 用真实玩家数据测一次 — 实测玩家阅读时长 vs 生成时长 gap | 1 周 |
| 4 | 加 SAN bucket variants（解法 A 的最小切片）| 1 周 |
| 5 | 视实测调整 prefetch 策略 | - |

**不**做：
- 解法 D 全树 CYOA（投入产出比差）
- 全 state 维度 variants（变体爆炸）
- 客户端 ink runtime（V1 太早）
