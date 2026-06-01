# CHANGELOG · ai-coc-keeper

## v0.3.0 — 2026-06-01 · "v3 管线 + B 路重构"

**当前产品状态**：从单本 kohaku 调研 → 可复用 "原文 → 互动叙事" 5 步流水线。卷宗 B 主题前端从外挂注入升级为 WebGAL 内部组件（fork）。

### 数据流水线（核心交付）

5 个并列 metadata 文件 + 2 个脚本，跟剧本目录 1:1 绑定：

```
.test-scenarios/<scenario>/
├── source.txt              ← 原作翻译 (gitignored, 本地保留)
├── annotations.json        ← 282 段标签 metadata (无原文)
├── expansions.json         ← 我原创扩写 (47 段, 含 LLM polish 版)
├── dialogues.json          ← Q.A → 对话 转换规则
├── enemies.json            ← NPC 数值表 (6 组)
└── endings.json            ← 结局决策表 (9 结局 + 3 modifiers)

scripts/
├── build-kohaku-v3.ts            ← 确定性合并 → 预览 HTML
├── generate-kohaku-v3-scenario.ts ← 注入到 scenario.json 给游戏跑
└── polish-kohaku-v3-expansions.ts ← LLM 只 polish 我的扩写
```

**6 标签 + 4 expand 子型**：verbatim / expand-A 加感官 / expand-B 探索按钮（含干扰项）/ expand-C Q.A→对话 / expand-D 骨架自由发挥 / drop / combat / check / flag

### 引擎改造

- **WebGAL 引擎 fork（B 路）** — `external/WebGAL/` 内部组件改造（gitignored）：
  - `Stage/CocUI/` 新 React 组件：`SpeakerOverlay` / `StatHud` / `VoidOverlay` / `CharacterCard` / `RollReveal`
  - 新 WebGAL 命令 `cocRoll:<base64>;` + 解析器扩展
  - 新 redux slice `cocState` 用于骰检动画
  - 旧外挂注入路径（assets/coc-ui/ + install-coc-ui.ts）保留备份，已下线
- **builder 升级**：
  - hub-spoke 2 层菜单（探索 / 前进）
  - `Scene.inSceneActions[]` 作者预写探索动作
  - `InSceneAction.sets` 触发 flag
- **flag 系统**（V2 P1.A）+ 多 exit 真分叉（V2 P1.B）+ 多结局 router（V2 P1.C）

### 内容

**kohaku.v3.scenario.json** 已落地，浏览器 localhost:3300 可玩：
- 18 场景 + 9 结局 + 3 modifiers
- 14 场景的 narrate 由 v3 管线覆盖
- 282 段标注 / 47 段我原创扩写 / 3 个 Q.A 对话 / 6 NPC 数值 / 10 干扰项

### 方法论

**记忆已存** `feedback_scenario_text_adaptation_method.md`：以后任何"原文 → 互动叙事"任务跑同一流水线，IP 隔离保证（LLM 只 polish 我的扩写，不看原文；verbatim 段由确定性 builder 现场读用户本地源）。

---

## v0.2.x — V1 + V2 P0/P1（早期，未单独发版）

- V1 忠实改编原作（2-pass parser + originalText 字段）
- V2 P0 入场目标展示 / 死亡判定基础
- V2 P1.A flag 系统底座
- V2 P1.B 多 exit 真分叉
- V2 P1.C 多结局 router

## v0.1.x — V0 基线

- WebGAL 集成 + scenario JSON 数据模型
- LLM 驱动叙事生成 + 检定结算
- 卷宗 B 主题前端（外挂注入版）
- 底部角色卡浮动按钮

---

## 下一步候选（v0.4.0）

- **V2 P2** 渐进恐怖（HP/SAN 低触发氛围 CSS + narrate modifier）— task #59 pending
- **kohaku v3 死亡分支结构化**（#044 加 choose gate, 不自动触发）
- **第二剧本验证流水线复用性**（用同一管线跑一个新本子）
- **WebGAL fork 子目录补丁化**（把 Stage/CocUI 抽出来作为可应用 patch 进 git）
