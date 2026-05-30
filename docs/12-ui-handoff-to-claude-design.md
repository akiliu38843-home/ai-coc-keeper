# ai-coc-keeper UI 重做 · Claude Design 上下文文档

> 这份文档自包含, 不依赖外部知识. 拿到这份就能开始设计.
>
> 项目: ai-coc-keeper — AI 当 Keeper 跑克苏鲁单人本平台, galgame 风可玩界面
> 当前主页: http://localhost:4300/ (本地) · https://ai-coc-keeper.vercel.app (线上)
> 当前阶段: V0 已上线, UI 走"轻路线 JS/CSS 注入", **不动 WebGAL 源码**

---

## 1. TL;DR · 你要做什么 / 不要动什么

| ✅ 可以动 (我们注入层) | ❌ 不能动 (WebGAL 源码) |
|---|---|
| 全局 CSS 主题 (color / font / spacing / 微动画) | WebGAL 自己的 React 组件 (textbox / choose / title 等) |
| 浮动按钮 + modal (角色卡, 也可加更多) | WebGAL 的脚本指令 (intro / choose / changeBg / bgm) |
| 章节卡 (intro) 的字色 / 字号 / 动画 | WebGAL 的 setVar / jumpLabel / 命令解析逻辑 |
| 结局回顾页内容布局 | WebGAL 标题 / 启动 splash 静态 HTML |
| 通过 setVar 暴露的玩家状态 (HP / 心智度 / conditions) | WebGAL 内部 Redux store |
| 注入额外 JS (DOM 监听 + 动态渲染) | dist/index.html 主体 (我们只 append 2 行 link/script) |

**核心规矩**:
- 任何改动通过 `external/WebGAL/packages/webgal/public/game/userStyleSheet.css` 注入到 WebGAL
- JS 改动通过 `dist/game/character-card.js` 类似的注入文件 (走 build 后处理)
- **不修改 WebGAL 源码** (`external/WebGAL/packages/webgal/src/**`), 它是 gitignored 的上游 clone, 升级会丢

---

## 2. 当前架构 (10 秒图)

```
+----------------------------------------------------------------+
|  浏览器 / WebGAL React app (我们不动)                            |
|  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         |
|  │  splash  │→│  title    │→│  game     │→│  recap   │         |
|  │ z-index:1│  │ z-index:1│  │ stage     │  │ via intro│         |
|  └──────────┘  └──────────┘  └──────────┘  └──────────┘         |
|                                                                 |
|  ┌────────────────────── 我们注入层 ──────────────────┐         |
|  │ userStyleSheet.css   ← 全局 CSS 主题             │         |
|  │ character-card.css   ← 浮动按钮 + modal 样式      │         |
|  │ character-card.js    ← DOM 注入按钮, fetch JSON    │         |
|  │ character.json       ← gen 时写, 给 JS fetch     │         |
|  └────────────────────────────────────────────────┘         |
+----------------------------------------------------------------+
       ↑                                                  ↑
  scenes/start.txt (WebGAL 脚本) — gen 时生成              CSS+JS 注入
```

---

## 3. 文件清单 · 你能动的几个文件

### 3.1 主题 CSS (全局视觉)

**路径**: `/Users/a26976/Desktop/ai-coc-keeper/assets/webgal-theme/userStyleSheet.css`

**部署去向**: 复制到 `external/WebGAL/packages/webgal/public/game/userStyleSheet.css`, WebGAL 启动时通过 `initializeScript.ts` 自动加载.

**当前定义的色板**:
```css
:root {
  --cthk-ink:        #d8c9a6;   /* 主文字 · 旧纸上的淡墨 */
  --cthk-ink-dim:    #a89578;   /* 弱化文字 */
  --cthk-paper:      #15110b;   /* 纸面底色 · 烟熏的暗 */
  --cthk-paper-2:    #211a10;   /* 略浅一档, 作 hover 用 */
  --cthk-amber:      #b89559;   /* 油灯黄铜 */
  --cthk-blood:      #8b2c1f;   /* 警示红 · 暗血 */
  --cthk-blood-bri:  #c44537;   /* 高亮血红 */
  --cthk-border:     #3a2e1c;   /* 木框 */
}
```

**主要 selector 段**:
- `[class*="TextBox_main"]` — 文字框
- `[class*="TextBox_textElement"]` — 文字内容
- `[class*="TextBox_showName"]` — 角色名 (旁白色: 黄铜)
- `[class*="Choose_item"]` — 选项按钮 (hover: 黄铜描边 + glow)
- `[class*="bottomControlPanel"]` — 底部菜单
- `[class*="backlog"]` — 回想/历史面板
- `::-webkit-scrollbar` — 滚动条
- `[class*="stage_"]::after` — 全局噪点遮罩 (z-index: 2, 不要超)

### 3.2 角色卡 (浮动按钮 + modal)

**路径**:
- `/Users/a26976/Desktop/ai-coc-keeper/assets/character-card/character-card.css`
- `/Users/a26976/Desktop/ai-coc-keeper/assets/character-card/character-card.js`

**部署去向**: 复制到 `dist/game/character-card.{css,js}` + post-process `dist/index.html` 注入 link/script.

**当前实现**:
- 右下角浮动按钮 "📜 角色卡"
- 点击弹出居中 modal
- modal 内容: 姓名 / 职业 / 8 项属性 / HP/心智度/MP/幸运 / 主要技能前 10 / 当前 condition
- 数据来源: `/game/character.json` (gen 时写好)

**可见性逻辑** (重要):
- splash 时隐藏 (`.html-body__title-enter` 还可见时)
- 标题菜单时隐藏 (`[class*="Title_main"]` 存在时)
- 游戏中显示
- 用 MutationObserver 监听 body 子树变化
- 检测用 `offsetParent !== null` 不是 querySelector (splash 是 display:none 不是 unmount, 这个坑见 [feedback_dom_injection_checklist])

### 3.3 章节卡 (intro 命令)

**生成位置**: `src/adapter/webgal-script-builder.ts:235` 的 `buildSceneIntroLine()`

**产物示例** (WebGAL 脚本指令):
```
intro:第 三 幕|海风教堂 -animation=fadeIn -delayTime=2200 -fontColor=rgba(196, 69, 55, 1) -fontSize=medium;
```

**字色按 mood 分**:
- `calm` / `mystery` → `rgba(216, 201, 166, 1)` (旧纸黄)
- `tension` → `rgba(220, 180, 110, 1)` (暖琥珀)
- `horror` / `climax` → `rgba(196, 69, 55, 1)` (暗血红)
- `ending` → `rgba(168, 149, 120, 1)` (灰烬)

样式 (intro 自带的全屏黑底淡入卡, WebGAL 渲染) **你不能直接改它的样式表**, 只能通过命令参数控制. 但如果想让 intro 卡更像电影标题/做更复杂动画, 可以走 CSS 改 `[class*="introContainer"]`.

### 3.4 结局回顾页

**生成位置**: `src/adapter/build-journey-recap.ts`

**形式**: 也是一个 intro 多行卡, `|` 分隔 4-7 行依次淡入. 内容:
```
你的旅程
林夕(记者) 走完了这一程
心智度 60 → 30 (损失 30, 最低 25)
HP 11 → 8 (最低 6)
你患上了长期恐惧症: 《恐女症》— 害怕女性
走过: 码头 → 客栈 → 教堂 → 黎明
你回来了
```

---

## 4. 视觉 Token (color / type / spacing)

### 4.1 配色 (深色克苏鲁主题)

```
纸面背景    #15110b  (烟熏黑) → #0a0805 (更暗, 渐变深处)
次级背景    #211a10  (深木色, hover 用)
主文字      #d8c9a6  (旧纸黄)
弱文字      #a89578  (灰烬)
高亮文字    #b89559  (黄铜) — 角色名 / 标题 / hover 描边
警示       #c44537  (暗血红) — 长期失常 / 严重伤害
边框       #3a2e1c  (老木框)
```

### 4.2 字体栈

```css
font-family:
  "Noto Serif SC",        /* 中文衬线 (思源宋体) */
  "Songti SC",            /* macOS 宋体 */
  "STSong",
  "Source Han Serif",
  "Hiragino Mincho ProN", /* macOS 日文衬线 */
  "Yu Mincho",
  "Times New Roman",
  serif;
```

**为什么衬线**: 克苏鲁 / 跑团本子 / 旧时代叙事感, 黑体太现代.

### 4.3 间距 (从 TextBox 推断)

```
line-height: 1.55
letter-spacing: 0.04em (正文) / 0.08em (角色名)
padding (内容块): 16-22px 18-28px
modal padding: 28px 36px
```

---

## 5. WebGAL DOM 速查 + z-index 表

| 元素 | 类名匹配 | z-index | 备注 |
|---|---|---|---|
| 背景图 | `[class*="stage_main"]` 内 | 1 | WebGAL 渲染 |
| 我们的噪点遮罩 | `[class*="stage_"]::after` | **2** | 别动 |
| 文字框 | `[class*="TextBox_main"]` | 3 | WebGAL 主 textbox |
| 选项按钮容器 | `[class*="Choose_Main"]` | (auto) | 玩家选择 |
| intro 全屏卡 | `#introContainer` | **11** | 章节卡 / 回顾页, 别盖它 |
| 底部控制栏 | `[class*="bottomControlPanel"]` | (在内) | 隐藏/回想/重播/...12 个 |
| 我们的角色卡按钮 | `.cthk-card-btn` | 50 | 浮动 |
| 我们的角色卡 modal | `.cthk-card-backdrop` | 100 | 半透明遮罩 |
| 标题菜单 | `[class*="Title_main"]` | (conditional render) | showTitle=true 时显示 |
| splash | `.html-body__title-enter` | (顶层) | display:none 后隐 |

**铁律**: 你新加任何浮动 / 遮罩元素, z-index 不要超过 11, 否则会盖住 intro 全屏卡导致玩家看不到章节卡 / 回顾页. 历史上踩过这个坑.

---

## 6. 内容约束 (改 layout 前必读)

### 6.1 文字框单页 ≤ 30 字

**Why**: WebGAL 文字框高度固定 (330px @ 2560×1440 设计稿). 单页 ≥ 40 字会换行到 3 行, 第 3 行被底部控制栏盖掉.

**做法**: builder 在 `splitIntoPages()` 时按句号/逗号自动切. 但**单句无逗号超长时不许硬切**, 整句一页. 视觉溢出靠 CSS 解决, 不靠切字.

**对 UI 设计的影响**: 如果你想加大字号 / 增加 line-height, 必须同步把 `MAX_PAGE_LEN` 调小, 或者把 textbox 加高.

### 6.2 choose 按钮单 label ≤ 14 字

**Why**: 按钮宽度有限, 中文 ≥ 14 字触发右侧 truncate 显 "…".

**做法**: builder 通过 `truncateChoiceLabel(label, 14)` 兜底.

**对 UI 设计的影响**: 如果你想给按钮变窄/变长, 同步改 `MAX_CHOICE_LABEL_LEN`. 但不要超过 18 字 (再宽就要做多行按钮 layout).

### 6.3 intro 多行卡

**支持参数** (WebGAL intro 命令):
- `-fontColor=rgba(R,G,B,A)` — 字色
- `-fontSize=small|medium|large` (280%|350%|420%)
- `-animation=fadeIn|slideIn|typingEffect|pixelateEffect|revealAnimation`
- `-delayTime=<ms>` (每行 stagger)
- `-hold=true` (不自动消失)
- `-userForward=true` (玩家必须手动推进)
- `-backgroundImage=<file>` (背景图, 默认黑)
- `-backgroundColor=<rgba>` (默认 rgba(0,0,0,1))

**多行用 `|` 分隔**, 每行 stagger fadeIn.

---

## 7. 当前 UI 痛点 (你可以重点解决)

按"玩家最先抱怨"排序:

### 7.1 大片黑屏 (P0)

游戏中 (有 textbox 时) 屏幕上半 70% 是纯黑, 因为没设 `changeBg:` 背景图. 玩家觉得是没加载完.

**解决方向 (任选其一)**:
- A. 给 4 个 mood (calm/mystery/horror/ending) 各做一张 CSS 渐变背景 + 微动画 (画面颗粒 / 火焰呼吸 / 雾气飘动). 零图片资产, 全 CSS.
- B. 找 4 张 CC0 氛围图 (Pixabay / Unsplash) 配上, builder 自动按 mood 选.
- C. 留黑但加一层"画面噪点 + 油灯 vignette" 让人觉得是设计, 不是空.

### 7.2 BGM 没落 (P1)

builder 已经 emit `bgm:mood_calm.mp3 -volume=60 -enter=2000;` 这种指令, 但 `mood_calm.mp3` 这些 mp3 文件**不存在**, WebGAL 静默忽略. 玩家全程无声.

**解决方向**:
- 找 4-6 段 CC0 / loyalty-free 克苏鲁 / 跑团氛围乐 (Freesound / Pixabay Music), 放到 `external/WebGAL/packages/webgal/public/game/bgm/`, 命名跟我们的 mood 对齐.

### 7.3 角色卡按钮位置感 (P2)

现在固定右下 `bottom: 96px; right: 24px`. 跟 WebGAL 内置的 P 角标 (Pixiv 图标) / A 角标 (翻译图标) 经常重叠. 可以重设位置.

### 7.4 章节卡 / 回顾页可以更"电影感" (P2)

现在就是中央淡入文字 + 黑底. 可以:
- 加 typewriter 打字机效果
- 加扫描线 / 老电影 grain
- 加边缘暗角 vignette

### 7.5 选项按钮 hover 状态可以更克苏鲁 (P3)

现在 hover 是简单黄铜描边 + box-shadow. 可以:
- hover 时按钮微震 / 文字闪烁
- 配油灯火焰边框 (CSS keyframe)

---

## 8. 你能新增什么 (在轻路线允许范围)

| 新元素 | 怎么实现 |
|---|---|
| 新的浮动按钮 (例如 "📖 原文" / "🎲 骰子日志" / "📜 任务进度") | 写一个新的 `xxx-card.css/js`, 同 character-card 套路注入 |
| 自定义动画 / loading 状态 | CSS `@keyframes` + 监听 WebGAL state 变化 |
| 玩家状态 HUD (左上角永久显示 HP/SAN) | 同浮动按钮路径, 多一个 fixed 元素 + 监听 setVar |
| 自定义弹窗 (剧情切换 / 死亡画面) | modal 同 character-card 套路 |
| 鼠标轨迹 / 点击粒子 | 全局 JS + canvas |

**铁律**: 不增加新的 WebGAL 命令 (intro/choose/changeBg 这些), 不动 WebGAL 路由逻辑.

---

## 9. 不能踩的坑 (已踩过的)

1. **z-index 不能超 11** — 否则盖住 intro 全屏卡, 玩家点完结束按钮看不到 "你的旅程"
2. **检测元素可见用 `offsetParent !== null`, 不是 querySelector** — WebGAL splash 是 display:none 不是 unmount
3. **WebGAL DOM 是 React 异步渲染** — 不能在 init 时拍快照, 必须 MutationObserver 监听变化
4. **任何用户可见英文 enum 都要翻成中文** — 比如 `fumble` 必须翻 "大失败", `temp_insanity` 必须翻 "临时心智失常"
5. **textbox 文字单页 ≤ 30 字** — 超了第 3 行被底栏盖
6. **choose 按钮 label ≤ 14 字** — 超了右侧 truncate
7. **vite 每次 build 都重生成 dist/index.html** — 我们 inject 的 link/script 会被抹, 必须 post-build 再注入一次 (我们有 `scripts/post-build.ts` 处理)

---

## 10. 当前完整文件结构 (相关部分)

```
ai-coc-keeper/
├── assets/
│   ├── webgal-theme/
│   │   └── userStyleSheet.css         ← 主题 CSS (复制到 WebGAL public)
│   └── character-card/
│       ├── character-card.css         ← 浮动按钮 + modal 样式
│       └── character-card.js          ← DOM 注入逻辑
├── src/
│   └── adapter/
│       ├── install-theme.ts           ← 部署主题 helper
│       ├── install-character-card.ts  ← 部署角色卡 helper
│       ├── webgal-script-builder.ts   ← 章节卡 / 回顾页 / 选项按钮 truncate
│       └── build-journey-recap.ts     ← 结局回顾页内容生成
├── scripts/
│   ├── generate-ai-game.ts            ← gen:ai-game 主流程
│   ├── build-launcher.ts              ← 多剧本启动菜单
│   └── post-build.ts                  ← yarn build 后再注入一次 link/script
└── external/
    └── WebGAL/                        ← upstream clone, gitignored, 不动
        └── packages/webgal/
            ├── public/game/           ← 复制资源到这 (yarn build 进 dist)
            └── dist/                  ← 最终部署, index.html 在这被 post-process
```

---

## 11. 想看实际效果

```
o http://localhost:4300/
```

进游戏选剧本 → 玩到选项 → 看章节卡 → 走到结尾看回顾页. 截图对比想改的地方.

---

## 12. 改完怎么部署

1. 改 `assets/webgal-theme/userStyleSheet.css` 或加新 `assets/<feature>/<feature>.{css,js}`
2. 写对应 `src/adapter/install-<feature>.ts` (照 install-character-card.ts 套路)
3. 在 `scripts/generate-ai-game.ts` / `scripts/build-launcher.ts` 末尾调一次
4. 在 `scripts/post-build.ts` 加一次 (防 yarn build 抹掉 index.html 注入)
5. `npm run build:dist` 重 build 看效果

如果只是改 CSS, 步骤 1+5 就够 (CSS 直接进 public, yarn build 自然进 dist).

---

## 13. 已知设计取向 (供参考, 不是约束)

我们一开始定的克苏鲁风:
- **不要现代扁平 / Material / 卡通可爱风**
- **要旧时代 / 烟雾 / 油灯 / 木质感 / 手稿感**
- **配色克制** — 主色不超过 5 个, 黄铜+暗红+暗墨黄+烟黑+灰烬
- **字体衬线为主** — 黑体太现代
- **微动画** OK, 不要弹跳/旋转/缤纷转场
- **noise / grain / vignette** 可以叠, 别叠到看不清字

但这些**不是 hard requirement**, 你觉得别的方向更好可以提.

---

## 14. 跟我同步

我并行在做 V1 改造 (parser 切段不压缩 + gen 忠实改编原作). 完成后会让现在的 5 场景从 688 字描述涨到 7000+ 字, 但**WebGAL 输出格式不变, 你的设计不会受影响**.

UI 改完后我们 merge, 没冲突.

需要任何额外上下文 (具体看某个 CSS 段 / 某个组件 / WebGAL 某个内部行为), 跟我说我补.
