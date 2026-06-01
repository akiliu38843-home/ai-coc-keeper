// install-character-card.ts
// 把 assets/character-card/{css,js} + 角色 JSON 注入到 WebGAL dist/public.
// 通过 post-process dist/index.html 给 </body> 前加 2 行 <link> + <script>.
// 完全不动 WebGAL 源码, 升级 WebGAL 也能复用.

import { copyFile, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Character } from '../types/character.js';
import { skillTotal } from '../types/character.js';

const INJECTION_MARKER = '<!-- ai-coc-keeper · character-card injected -->';

export interface CharacterCardData {
  name: string;
  occupation: string;
  age: number;
  gender?: string;
  attributes?: Record<string, number>;
  maxHp: number;
  currentHp: number;
  maxSanity: number;
  currentSanity: number;
  maxMp: number;
  currentMp: number;
  luck: number;
  movement?: number;
  dodge?: number;
  topSkills: { name: string; value: number }[];
  conditions?: Character['conditions'];
}

/** 把 Character 转成给前端 modal 渲染用的 JSON. */
export function buildCharacterCardData(char: Character, topN: number = 10): CharacterCardData {
  const topSkills = Array.from(char.skills.values())
    .map((s) => ({ name: s.name, value: skillTotal(s) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);

  const data: CharacterCardData = {
    name: char.name,
    occupation: char.occupation,
    age: char.age,
    maxHp: char.maxHp, currentHp: char.currentHp,
    maxSanity: char.maxSanity, currentSanity: char.currentSanity,
    maxMp: char.maxMp, currentMp: char.currentMp,
    luck: char.luck,
    topSkills,
  };
  if (char.gender) data.gender = char.gender;
  if (char.attributes) data.attributes = { ...char.attributes };
  if (char.movement !== undefined) data.movement = char.movement;
  if (char.dodge !== undefined) data.dodge = char.dodge;
  if (char.conditions && char.conditions.length > 0) data.conditions = char.conditions;
  return data;
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/**
 * 把 character-card.{css,js} + character.json 装到 WebGAL public/game/ + dist/game/,
 * post-process dist/index.html 注入 link + script tag.
 *
 * @param projectRoot ai-coc-keeper repo root
 * @param charData 由 buildCharacterCardData 出的 JSON (可选, 没角色时只装 css/js)
 */
export async function installCharacterCard(
  projectRoot: string,
  charData: CharacterCardData | null,
): Promise<void> {
  const srcCss = join(projectRoot, 'assets/character-card/character-card.css');
  const srcJs  = join(projectRoot, 'assets/character-card/character-card.js');
  const publicGame = join(projectRoot, 'external/WebGAL/packages/webgal/public/game');
  const distGame   = join(projectRoot, 'external/WebGAL/packages/webgal/dist/game');
  const distHtml   = join(projectRoot, 'external/WebGAL/packages/webgal/dist/index.html');

  if (!await fileExists(srcCss) || !await fileExists(srcJs)) {
    console.warn(`⚠️  character-card 源文件缺失: ${srcCss}`);
    return;
  }

  // B 路 (2026-06): 不再拷 css/js (已搬进 WebGAL src)
  void srcCss; void srcJs;
  const distExists = await fileExists(join(projectRoot, 'external/WebGAL/packages/webgal/dist'));

  // 3) 写 character.json (public 和 dist 同步) -- React 组件 fetch 读这份
  if (charData) {
    const jsonStr = JSON.stringify(charData, null, 2);
    await writeFile(join(publicGame, 'character.json'), jsonStr, 'utf-8');
    if (distExists) await writeFile(join(distGame, 'character.json'), jsonStr, 'utf-8');
  }

  // B 路 (2026-06): 角色卡已搬进 WebGAL 内部 React 组件 (CharacterCard.tsx),
  // 不再外挂注入 <link>/<script>. 只保留 character.json 文件同步.
  void distHtml; // keep var for legacy compat checks
  void INJECTION_MARKER;

  console.log(`📜 character.json 已写入 public/game/ ${distExists ? '+ dist/game/' : ''}`);
}
