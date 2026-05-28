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

  // ★ 整个回顾页是 ONE 多行 intro 卡 (用 | 分隔每行依次淡入), 不切到底部文字框.
  // 两段式 (intro 切到旁白) 用户体验差: intro 后底部接力不直观, 老板已反馈过.
  const introLines: string[] = [
    '你的旅程',
    `${c.name}（${c.occupation}）走完了这一程`,
    `心智度 ${input.initial.sanity} → ${input.finalSanity}（损失 ${input.sanityLossAccum}，最低 ${input.minSanity}）`,
    `HP ${input.initial.hp} → ${input.finalHp}（最低 ${input.minHp}）`,
  ];

  if (indef && indef.insanityDetail) {
    const kind = indef.insanityDetail.kind === 'phobia' ? '恐惧症' : '狂躁症';
    const desc = indef.insanityDetail.description.slice(0, 20);
    introLines.push(`你患上了长期${kind}：《${indef.insanityDetail.nameZh}》— ${desc}`);
  } else if (tempCount > 0) {
    introLines.push(`你在过程中崩溃过 ${tempCount} 次，但最终从临时失常中走了出来`);
  } else {
    introLines.push('你的心智在这一程里没有真正崩塌');
  }

  introLines.push(`走过：${input.visitedSceneNames.slice(0, 6).join(' → ')}`);

  if (input.finalSanity <= 0) {
    introLines.push('但你已经不是那个出发时的人');
  } else if (input.finalSanity <= input.initial.sanity / 3) {
    introLines.push('你回来了，但有些东西被永远留在了那里');
  } else {
    introLines.push('你回来了');
  }

  // intro 用 | 做分隔符, 内容里的 |（如有）需替成全角
  const introContent = introLines
    .map((l) => l.replace(/\|/g, '｜'))
    .join('|');

  return [
    `;------------------- journey recap ------------------`,
    `label:journey_recap;`,
    `intro:${introContent} -animation=fadeIn -fontColor=rgba(216, 201, 166, 1) -fontSize=medium -delayTime=2200;`,
    `end;`,
  ].join('\n');
}
