import { describe, it, expect } from 'vitest';
import {
  parseWebGalConfig,
  serializeWebGalConfig,
  setConfigValue,
} from '../src/adapter/webgal-config.js';

describe('parseWebGalConfig', () => {
  it('解析 6 行标准 config', () => {
    const text = [
      'Game_name:欢迎使用WebGAL！;',
      'Game_key:0f87dstRg;',
      'Title_img:WebGAL_New_Enter_Image.webp;',
      'Title_bgm:s_Title.mp3;',
      'Game_Logo:WebGalEnter.webp;',
      'Enable_Appreciation:true;',
    ].join('\n');
    const cfg = parseWebGalConfig(text);
    expect(cfg.entries).toHaveLength(6);
    expect(cfg.entries[0]).toEqual({ key: 'Game_name', value: '欢迎使用WebGAL！' });
    expect(cfg.entries[5]).toEqual({ key: 'Enable_Appreciation', value: 'true' });
  });

  it('忽略空行 / 注释行 / 缺尾 ;', () => {
    const text = `
;这是注释
Game_name:Test;
;另一注释
Game_key:abc
`;
    const cfg = parseWebGalConfig(text);
    expect(cfg.entries).toHaveLength(2);
    expect(cfg.entries[0]?.value).toBe('Test');
    expect(cfg.entries[1]?.value).toBe('abc');
  });
});

describe('setConfigValue', () => {
  it('改已存在的 key', () => {
    const cfg = parseWebGalConfig('Game_name:Old;\nGame_key:abc;');
    setConfigValue(cfg, 'Game_name', 'New');
    expect(cfg.entries[0]?.value).toBe('New');
    expect(cfg.entries[1]?.value).toBe('abc');
  });

  it('追加不存在的 key', () => {
    const cfg = parseWebGalConfig('Game_name:T;');
    setConfigValue(cfg, 'Title_bgm', 'horror.mp3');
    expect(cfg.entries).toHaveLength(2);
    expect(cfg.entries[1]).toEqual({ key: 'Title_bgm', value: 'horror.mp3' });
  });
});

describe('serializeWebGalConfig · roundtrip', () => {
  it('解析后再 serialize 行数相同, 顺序保留', () => {
    const original = 'Game_name:T;\nGame_key:abc;\nTitle_bgm:m.mp3;';
    const cfg = parseWebGalConfig(original);
    const out = serializeWebGalConfig(cfg);
    expect(out).toContain('Game_name:T;');
    expect(out).toContain('Game_key:abc;');
    expect(out).toContain('Title_bgm:m.mp3;');
    // 顺序保留
    const lines = out.trim().split('\n');
    expect(lines[0]).toBe('Game_name:T;');
    expect(lines[2]).toBe('Title_bgm:m.mp3;');
  });
});
