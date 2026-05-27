// CLI 调查员向导 —— 交互式问问题 / 投点 / 选职业 / 落盘
//
// 跑法：npm run create:character
// 输出：~/.ai-coc-keeper/characters/<id>.json

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { DefaultRng } from '../src/engine/rng.js';
import {
  generateCharacter,
  rollAttributes,
  STANDARD_ARRAY,
} from '../src/character/generator.js';
import { OCCUPATIONS } from '../src/character/occupations.js';
import { saveCharacter } from '../src/character/save-load.js';
import { skillTotal } from '../src/types/character.js';
import type { Attribute } from '../src/types/character.js';

const rl = readline.createInterface({ input, output });
const ask = (q: string): Promise<string> => rl.question(q);

const rng = new DefaultRng();

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('   ai-coc-keeper · 调查员创建向导 (COC 7e)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

async function main(): Promise<void> {
  // 1) 名字
  const nameInput = (await ask('调查员姓名（默认"林夏"）: ')).trim();
  const name = nameInput || '林夏';

  // 2) 年龄
  const ageInput = (await ask('年龄（15-90，默认 28）: ')).trim();
  const age = parseInt(ageInput, 10) || 28;

  // 3) 性别（可选）
  const gender = (await ask('性别（可选）: ')).trim() || undefined;

  // 4) 职业
  console.log('\n职业列表:');
  OCCUPATIONS.forEach((o, i) => {
    console.log(`  ${i + 1}. ${o.nameZh.padEnd(8)} - ${o.flavor.slice(0, 35)}...`);
  });
  const occInput = (await ask('\n选职业（1-8，默认 2=记者）: ')).trim();
  const occIdx = (parseInt(occInput, 10) || 2) - 1;
  const occupation = OCCUPATIONS[Math.max(0, Math.min(occIdx, OCCUPATIONS.length - 1))]!;
  console.log(`✓ 选了: ${occupation.nameZh}`);

  // 5) 属性方案
  console.log('\n属性投点:');
  console.log('  1. 标准点数包（推荐：STR60 CON60 DEX60 APP60 POW60 SIZ60 INT80 EDU80）');
  console.log('  2. 投随机骰子（3d6×5 / (2d6+6)×5，可能很烂或很好）');
  const attrInput = (await ask('选 1 / 2 （默认 1）: ')).trim();
  const useRandom = attrInput === '2';

  let attributes: Record<Attribute, number>;
  if (useRandom) {
    attributes = rollAttributes(rng);
    console.log('\n投出的属性:');
  } else {
    attributes = { ...STANDARD_ARRAY };
    console.log('\n使用标准点数包:');
  }
  console.log(`  STR ${attributes.STR}   CON ${attributes.CON}   DEX ${attributes.DEX}   APP ${attributes.APP}`);
  console.log(`  POW ${attributes.POW}   SIZ ${attributes.SIZ}   INT ${attributes.INT}   EDU ${attributes.EDU}`);

  // 6) 生成 Character
  const character = generateCharacter({
    rng,
    name,
    age,
    ...(gender !== undefined ? { gender } : {}),
    occupationId: occupation.id,
    attributeMethod: useRandom ? 'random' : 'standard',
    explicitAttributes: attributes,
    autoAllocateSkills: true,
  });

  // 7) 展示派生 + 关键技能
  console.log('\n派生值:');
  console.log(`  HP ${character.maxHp}   MP ${character.maxMp}   心智 ${character.maxSanity}   幸运 ${character.luck}`);
  console.log(`  移动 ${character.movement}   闪避 ${character.dodge}   拼搏 ${character.brawl}`);

  console.log('\n职业技能（已自动分配点数）:');
  for (const skillKey of occupation.occupationalSkills) {
    const skill = character.skills.get(skillKey);
    if (skill) {
      const total = skillTotal(skill);
      console.log(`  ${skill.name.padEnd(8)} ${total} (基础 ${skill.base} + 职业 ${skill.occupational})`);
    }
  }

  // 8) 保存
  const confirm = (await ask('\n保存到本机？(Y/n): ')).trim().toLowerCase();
  if (confirm === 'n') {
    console.log('已放弃，未保存');
  } else {
    const path = await saveCharacter(character);
    console.log(`\n✅ 保存到 ${path}`);
    console.log(`   ID: ${character.id}`);
  }

  rl.close();
}

await main().catch((e: unknown) => {
  console.error('❌', e instanceof Error ? e.message : String(e));
  rl.close();
  process.exit(1);
});
