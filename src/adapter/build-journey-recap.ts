// 结局回顾页 builder
//
// 把整本剧本的关键 stats 编排成"你的旅程"WebGAL script.
// 显示形式: 全屏 intro 卡 + 旁白 N 行 + end;
//
// 流转: 玩家走完最后 scene narrate, 控制自然 fall through 到 label:journey_recap,
// 然后看到自己心智 / HP / 触发的失常 / 走过的场景 + 一句结语.

import type { Character } from '../types/character.js';

export interface JourneyRecapInput {
  character: Character;
  initial: { sanity: number; hp: number };
  finalSanity: number;
  finalHp: number;
  minSanity: number;
  minHp: number;
  sanityLossAccum: number;
  hpLossAccum: number;
  conditions: Character['conditions'];
  visitedSceneNames: string[];
}

export function buildJourneyRecap(input: JourneyRecapInput): string {
  const c = input.character;
  const indef = input.conditions.find((cn) => cn.type === 'indef_insanity');
  const tempCount = input.conditions.filter((cn) => cn.type === 'temp_insanity').length;

  const lines: string[] = [
    `;------------------- journey recap ------------------`,
    `label:journey_recap;`,
    `intro:你的旅程 -animation=fadeIn -fontColor=rgba(216, 201, 166, 1) -fontSize=large -delayTime=2500;`,
    `旁白:${c.name}（${c.occupation}）走完了这一程。;`,
    `旁白:心智度 ${input.initial.sanity} → ${input.finalSanity}（损失 ${input.sanityLossAccum}，最低跌到 ${input.minSanity}）;`,
    `旁白:HP ${input.initial.hp} → ${input.finalHp}（最低 ${input.minHp}）;`,
  ];

  if (indef && indef.insanityDetail) {
    const kind = indef.insanityDetail.kind === 'phobia' ? '恐惧症' : '狂躁症';
    const desc = indef.insanityDetail.description.slice(0, 25);
    lines.push(`旁白:你患上了长期${kind}：《${indef.insanityDetail.nameZh}》 — ${desc};`);
  } else if (tempCount > 0) {
    lines.push(`旁白:你在过程中崩溃过 ${tempCount} 次，但最终从临时失常中走了出来。;`);
  } else {
    lines.push(`旁白:你的心智在这一程里没有真正崩塌。;`);
  }

  const visitedShort = input.visitedSceneNames.slice(0, 6).join(' → ');
  lines.push(`旁白:走过：${visitedShort};`);

  if (input.finalSanity <= 0) {
    lines.push(`旁白:但你已经不是那个出发时的人。;`);
  } else if (input.finalSanity <= input.initial.sanity / 3) {
    lines.push(`旁白:你回来了，但有些东西被永远留在了那里。;`);
  } else {
    lines.push(`旁白:你回来了。;`);
  }

  lines.push(`end;`);
  return lines.join('\n');
}
