# COC 7e 心智失常随机表

100 项恐惧症 + 100 项狂躁症，玩家心智失常时引擎 d100 随机出一项。

## 数据来源

- 原始 .txt：来自 [sealdice/sealdice-core](https://github.com/sealdice/sealdice-core)（MIT license）
- 文件：`dice/coc7_fear.txt` / `dice/coc7_mania.txt`
- 转 JSON 解析脚本一次性跑：`N) 中文名（English）：描述。` → `{ id, nameZh, nameEn, description }`

## 法律状态

- sealdice 是 MIT，允许复用 + 二次发布
- 内容本身是 COC 7e 规则书里的"100 项 phobia / mania 随机表"翻译版（中文 + 英文术语）
- 翻译版本归属 sealdice 项目，我们引用并保留出处

## 文件

- `fear.json` — 恐惧症 100 项
- `mania.json` — 狂躁症 100 项

## 使用

引擎在 `applySanityLoss` 检测到长期心智失常时（单次损失 ≥ maxSanity/5），
随机 roll d100 选取一条 phobia 或 mania（具体哪种由触发场景的"性质"决定，
或简单二选一），写入 `Character.conditions`。
