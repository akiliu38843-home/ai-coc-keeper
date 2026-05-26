// 所有 LLM prompt 模板 —— 集中放，方便调优
//
// 设计原则：
// - **LLM 永远不准丢骰子**（rule engine 的活）
// - LLM 只做：描述场景 / 扮 NPC / 决定该检定哪个技能 / 叙述检定结果
// - 强制 JSON 输出，方便解析

import type { Character } from '../types/character.js';
import type { NarrativeState } from '../types/narrative.js';
import type { CheckResult } from '../types/rules.js';

/**
 * 全局 system prompt —— 告诉 LLM "你是谁、不准干什么、规则边界"。
 *
 * 关键约束：
 * 1. 不准丢骰子 / 编规则
 * 2. 不准擅自跳场景（要 jump_scene action）
 * 3. 不准改 character 数值（要 request_check / report 数值变化建议）
 * 4. 输出必须 JSON
 */
export const SYSTEM_PROMPT_NARRATOR = `你是一个克苏鲁风单人本游戏的叙事者(Narrator)。
玩家扮演一个"探者"在调查神秘事件。

【核心规则·必读】
1. 你**永远不准丢骰子或宣称检定结果**。当玩家行动需要骰子判定（如观察、撬锁、说服）时，
   你输出一个 "request_check" action，由游戏引擎丢骰子。
2. 你**永远不准擅自修改角色数值**（HP、心智、技能）。只能输出"建议"由引擎确认。
3. 你**永远不准擅自跳到剧本之外的场景**。只在剧本明确列出的场景间跳转。
4. 你扮演 NPC 时要符合 NPC 的人设，但**不能透露玩家不该知道的剧本设定**。
5. 描述要让人毛骨悚然但不直白血腥；克苏鲁风重点是"无名恐惧"，不是 splatter。

【输出格式】
始终输出严格 JSON，结构如下：

{
  "type": "narrate" | "request_check" | "jump_scene" | "set_flag" | "dialogue",
  "text": "给玩家看的文本（必填）",
  ... 其他字段按 type 不同而不同
}

【各 type 详解】
- "narrate"：纯叙述。{ type, text }
- "request_check"：需要检定。{ type, text (引出检定的描述), skill (技能 key), difficulty: "normal"|"hard"|"extreme", rationale (为什么需要这个检定) }
- "jump_scene"：要跳到另一个场景。{ type, text (过渡描述), toScene (目标场景 ID) }
- "set_flag"：故事 flag 变化。{ type, text, flag (key), value (新值) }
- "dialogue"：NPC 在说话。{ type, text, speaker (NPC 名), expression?: "neutral"|"angry"|"scared"|"smile" }

不要解释你的逻辑。不要 wrap 在 markdown code block 里。直接输出 JSON。`;

export interface BuildSceneContextParams {
  scenario: {
    id: string;
    title: string;
    setting: string;
  };
  scene: {
    id: string;
    name: string;
    description: string;
    /** 此场景的探索点 / 已知线索 (作者写好的提示)  */
    hints?: string[];
    /** 可触发的检定（作者预设的）*/
    expectedChecks?: { skill: string; difficulty: string; reason: string }[];
  };
  character: Pick<Character, 'name' | 'occupation' | 'currentHp' | 'currentSanity' | 'maxHp' | 'maxSanity'>;
  narrative: NarrativeState;
  /** 最近 N 个选择历史 */
  recentChoicesLimit?: number;
}

/**
 * 把当前游戏状态拼成给 LLM 看的"场景上下文"。
 */
export function buildSceneContext(p: BuildSceneContextParams): string {
  const recentChoices = p.narrative
    .getChoiceHistory()
    .slice(-(p.recentChoicesLimit ?? 5))
    .map((c) => `  - 在场景 ${c.sceneId}：${c.text}`)
    .join('\n');

  return `【剧本】${p.scenario.title}（${p.scenario.setting}）
【当前场景】${p.scene.id} · ${p.scene.name}
${p.scene.description}

【探者】${p.character.name}（${p.character.occupation}）
  - HP: ${p.character.currentHp}/${p.character.maxHp}
  - 心智度: ${p.character.currentSanity}/${p.character.maxSanity}

【最近选择】
${recentChoices || '  (尚无)'}

${p.scene.hints?.length ? `【作者提示】\n${p.scene.hints.map((h) => `  - ${h}`).join('\n')}` : ''}

${p.scene.expectedChecks?.length ? `【可能触发的检定】\n${p.scene.expectedChecks.map((c) => `  - ${c.skill}（${c.difficulty}）：${c.reason}`).join('\n')}` : ''}
`.trim();
}

/**
 * "玩家说了/做了 X，请你叙事推进" prompt。
 */
export function userTurnPrompt(playerInput: string): string {
  return `玩家行动：${playerInput}

请输出 JSON action（参考 system prompt 的格式）。`;
}

/**
 * "检定刚出结果，请你叙事这个结果" prompt。
 */
export function checkResultPrompt(
  checkResult: CheckResult,
  context: { skill: string; intent: string },
): string {
  const outcomeText = {
    critical_success: '大成功',
    extreme_success: '极难成功',
    hard_success: '困难成功',
    success: '普通成功',
    failure: '失败',
    fumble: '大失败',
  }[checkResult.outcome];

  return `检定刚出结果：
  - 技能：${context.skill}
  - 投点：${checkResult.roll}（目标 ${checkResult.effectiveTarget}，原始目标 ${checkResult.target}，难度 ${checkResult.difficulty}）
  - 结果：${outcomeText}（${checkResult.succeeded ? '成功' : '失败'}）
  - 玩家意图：${context.intent}

请输出一段"narrate" type 的 JSON，把这个检定结果叙事出来。
注意：${checkResult.outcome === 'fumble' ? '大失败 → 描述显著的负面后果。' : ''}${checkResult.outcome === 'critical_success' ? '大成功 → 描述超预期的好结果。' : ''}`;
}
