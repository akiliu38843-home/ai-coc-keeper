// WebGAL config.txt 解析 + 修改
//
// 格式: 每行 "Key:value;"
// 关键字段:
//   Game_name         游戏名 (标题栏 / 启动器)
//   Game_key          游戏唯一 key (存档识别用,不动)
//   Title_img         启动页背景图
//   Title_bgm         启动页 BGM
//   Game_Logo         logo 图
//   Enable_Appreciation 是否启用鉴赏模式

export interface WebGalConfig {
  /** 原始 key/value 顺序（保留写回时的顺序） */
  entries: Array<{ key: string; value: string }>;
}

/** 解析 config.txt 文本 */
export function parseWebGalConfig(text: string): WebGalConfig {
  const entries: WebGalConfig['entries'] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const m = line.match(/^([^:]+):(.*?);?\s*$/);
    if (!m) continue;
    entries.push({ key: m[1]!.trim(), value: m[2]!.trim() });
  }
  return { entries };
}

/** 序列化回 config.txt */
export function serializeWebGalConfig(cfg: WebGalConfig): string {
  return cfg.entries.map((e) => `${e.key}:${e.value};`).join('\n') + '\n';
}

/** 设置一个 key 的值（保留顺序，没有就追加） */
export function setConfigValue(cfg: WebGalConfig, key: string, value: string): void {
  const idx = cfg.entries.findIndex((e) => e.key === key);
  if (idx >= 0) {
    cfg.entries[idx]!.value = value;
  } else {
    cfg.entries.push({ key, value });
  }
}

/**
 * 高层 API: 读 config.txt → 改 Game_name → 写回。
 * Game_name 里含 ; 或 : 会被全角替换，避免 WebGAL DSL 误解。
 */
export async function updateWebGalConfig(
  configPath: string,
  updates: { gameName?: string },
): Promise<void> {
  const { readFile, writeFile } = await import('node:fs/promises');
  let cfg: WebGalConfig;
  try {
    const text = await readFile(configPath, 'utf-8');
    cfg = parseWebGalConfig(text);
  } catch {
    // 没有 config.txt 时新建一个最小的
    cfg = { entries: [] };
  }
  if (updates.gameName) {
    const safeName = updates.gameName.replace(/;/g, '；').replace(/:/g, '：');
    setConfigValue(cfg, 'Game_name', safeName);
  }
  await writeFile(configPath, serializeWebGalConfig(cfg), 'utf-8');
}
