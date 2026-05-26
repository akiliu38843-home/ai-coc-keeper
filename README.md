# ai-coc-keeper

> 工作名 · 公开发布前请改名（避开 Chaosium 商标）

一个完全开源的"AI 当 Keeper 跑 COC 单人本"游戏引擎，输出 galgame 风可玩界面。玩家自带本子，本地运行。

**不卖本子。不卖账号。不卖流量包。Code is law、Content is yours。**

## 当前状态

📋 **V0 PRD 阶段** —— 起步周（W1）

详细 PRD 见 [`docs/00-V0-PRD.md`](docs/00-V0-PRD.md)。

## 架构（V0）

```
WebGAL Renderer (fork, MPL-2.0)
    ↑ WebGAL Script (动态生成)
WebGAL Adapter Layer (自写, MIT)
    ↑
Game Engine Core (自写, MIT)
    ├── NarrativeState 抽象 (V0 自写 / V1 ink runtime)
    ├── Rules Engine (D100 / 心智 / HP)
    ├── LLM Adapter (描述 / NPC / 叙事)
    └── Scenario Parser (PDF/MD → JSON)
    ↑
External: OpenAI/DeepSeek/Anthropic API + 用户上传本子
```

## 协议组合

| 模块 | 协议 |
|---|---|
| 主仓 / 引擎核心 | MIT |
| `external/WebGAL/` fork 改动 | MPL-2.0（WebGAL 强制） |
| 自写组件 | MIT |

未来商业化保持灵活（无 AGPL 紧箍咒）。

## 目录结构

```
ai-coc-keeper/
├── src/                    业务代码
├── docs/                   PRD + 调研文档
├── external/
│   └── WebGAL/             upstream clone（参考用，未来 fork 改造）
├── .test-scenarios/        私有本地测试本（不入 git）
├── README.md
├── .gitignore
└── LICENSE
```

## 测试用本子（私有，不入 git）

放在 `.test-scenarios/`，仅本机开发使用，**绝不分发**。

| # | 本子 | 来源 | 复杂度 | 时长 | 状态 |
|---|---|---|---|---|---|
| 1 | 《Alone Against the Flames》 | [Chaosium 官方免费 PDF](https://www.chaosium.com/content/FreePDFs/CoC/Adventures/CHA23145%20-%20Alone%20Against%20the%20Flames.pdf) | ⭐⭐ 入门 | 60-90 min | ✅ 自动下载 |
| 2 | 《追书人》 | [cnmods Wiki](https://wiki.cnmods.org/user/%E4%BF%AE%E5%8F%BD/%E8%BF%BD%E4%B9%A6%E4%BA%BA) | ⭐⭐⭐ 中等 | 2-3h | ⚠️ 需手动下载（cnmods 登录）|
| 3 | 《蠕虫》 | [cnmods](https://cnmods.net/mobile/moduleDetail?keyId=4609) | ⭐⭐⭐⭐ 偏难 | 3-4h | ⚠️ 需手动下载 |
| 4 | 《霜寒独行》 | [cnmods](https://cnmods.net/mobile/moduleDetail?keyId=4595) | ⭐⭐ 短 | 1-2h | ⚠️ 需手动下载 |

## 法律边界

- **开发期**本机测试 OK
- **永不打包**任何用户上传/作者私有本子进产品分发
- **Chaosium 严格 IP**：不挂 "Call of Cthulhu" 商标、"SAN" 改名"心智耗损"、"Investigator" 改名"调查员/探者"
- **基于** [BRP / ORC License](https://www.chaosium.com/orc-license/) 规则 + [Lovecraft 中国 public domain](https://en.wikipedia.org/wiki/H._P._Lovecraft) 原文
- 详见 [`docs/02-orc-license-deep-dive.md`](docs/02-orc-license-deep-dive.md)

## V0 里程碑（10 周）

| 周 | 工作 |
|---|---|
| W1 | 本机 clone WebGAL，理解 DSL |
| W2 | 设计 NarrativeState 接口 + 自写状态机 |
| W3 | D100 / 心智 / HP / 技能表 Rules Engine |
| W4-5 | LLM Adapter prompt 工程 |
| W6-7 | Scenario Parser |
| W8 | WebGAL Adapter + UI 改造 |
| W9 | Save/Load + 调查员向导 |
| W10 | 整合 4 本测试本 + 自玩 |

详见 PRD 第 7 节。

## License

[MIT](./LICENSE)（主仓） · `external/WebGAL/` fork 修改部分继承 MPL-2.0
