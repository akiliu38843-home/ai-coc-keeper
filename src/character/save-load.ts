// Character 角色卡持久化 —— V0 落本机 JSON
//
// 路径约定：~/.ai-coc-keeper/characters/<id>.json
// W9 不做云存储, 简单粗暴文件即可

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Character, Item, Condition } from '../types/character.js';

const STORAGE_DIR = join(homedir(), '.ai-coc-keeper', 'characters');

/** Character 持久化序列化形式（Map → 数组）*/
export interface SerializedCharacter {
  schemaVersion: 1;
  character: Omit<Character, 'skills'> & {
    skills: Array<{
      key: string;
      name: string;
      base: number;
      occupational: number;
      personal: number;
      experienced: boolean;
    }>;
  };
  savedAt: number;
}

/** 序列化 Character (Map 转 array) */
export function serializeCharacter(c: Character): SerializedCharacter {
  return {
    schemaVersion: 1,
    character: {
      ...c,
      skills: Array.from(c.skills.values()).map((s) => ({ ...s })),
    },
    savedAt: Date.now(),
  };
}

/** 反序列化 (array 转 Map) */
export function deserializeCharacter(s: SerializedCharacter): Character {
  if (s.schemaVersion !== 1) {
    throw new Error(`不支持的 schemaVersion: ${s.schemaVersion}`);
  }
  const c = s.character;
  return {
    ...c,
    skills: new Map(c.skills.map((sk) => [sk.key, { ...sk }])),
    inventory: c.inventory.map((i: Item) => ({ ...i })),
    conditions: c.conditions.map((cd: Condition) => ({ ...cd })),
  };
}

// ─── 文件操作 ─────────────────────────────────────────

async function ensureDir(): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
}

/** 把角色保存到 ~/.ai-coc-keeper/characters/<id>.json */
export async function saveCharacter(c: Character): Promise<string> {
  await ensureDir();
  const path = join(STORAGE_DIR, `${c.id}.json`);
  const serialized = serializeCharacter(c);
  await writeFile(path, JSON.stringify(serialized, null, 2), 'utf-8');
  return path;
}

/** 加载角色 by id */
export async function loadCharacter(id: string): Promise<Character> {
  const path = join(STORAGE_DIR, `${id}.json`);
  const data = await readFile(path, 'utf-8');
  const parsed = JSON.parse(data) as SerializedCharacter;
  return deserializeCharacter(parsed);
}

/** 列出所有已保存角色 */
export async function listCharacters(): Promise<Array<{ id: string; name: string; occupation: string; savedAt: number }>> {
  await ensureDir();
  const files = await readdir(STORAGE_DIR);
  const results = await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map(async (f) => {
        const data = await readFile(join(STORAGE_DIR, f), 'utf-8');
        const parsed = JSON.parse(data) as SerializedCharacter;
        return {
          id: parsed.character.id,
          name: parsed.character.name,
          occupation: parsed.character.occupation,
          savedAt: parsed.savedAt,
        };
      }),
  );
  return results.sort((a, b) => b.savedAt - a.savedAt);
}

/** 删除角色 */
export async function deleteCharacter(id: string): Promise<void> {
  const path = join(STORAGE_DIR, `${id}.json`);
  await unlink(path);
}

/** 测试用：返回 storage dir 路径 */
export function getStorageDir(): string {
  return STORAGE_DIR;
}
