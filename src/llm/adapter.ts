// LlmAdapter —— 高层接口，外部代码只跟这个打交道
//
// 职责：
// 1. 解析 LLM JSON 输出成结构化 LlmAction
// 2. 提供 narrate / resolvePlayerAction / narrateCheckResult 等业务方法
// 3. 统一错误处理：JSON parse 失败 / 字段缺失 / 类型不对 都降级处理

import type { LlmProvider, ChatMessage } from './provider.js';
import type { Difficulty } from '../types/rules.js';
import {
  SYSTEM_PROMPT_NARRATOR,
  buildSceneContext,
  userTurnPrompt,
  checkResultPrompt,
  type BuildSceneContextParams,
} from './prompts.js';

// ─── LlmAction 类型 ──────────────────────────────────

export type LlmAction =
  | { type: 'narrate'; text: string }
  | { type: 'dialogue'; text: string; speaker: string; expression?: string }
  | {
      type: 'request_check';
      text: string;
      skill: string;
      difficulty: Difficulty;
      rationale: string;
    }
  | { type: 'jump_scene'; text: string; toScene: string }
  | { type: 'set_flag'; text: string; flag: string; value: boolean | number | string };

// ─── 解析逻辑 ────────────────────────────────────────

/**
 * 把 LLM 输出（带可能的 markdown wrapper / 杂字符）解析成 LlmAction。
 * 解析失败时，降级为 narrate 包装整段原文。
 */
export function parseLlmAction(raw: string): LlmAction {
  // 剥 markdown code block
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    // JSON 解析失败 → 降级 narrate
    return { type: 'narrate', text: raw };
  }

  if (typeof obj !== 'object' || obj === null) {
    return { type: 'narrate', text: raw };
  }

  const o = obj as Record<string, unknown>;
  const type = typeof o['type'] === 'string' ? (o['type'] as string) : '';
  const text = typeof o['text'] === 'string' ? (o['text'] as string) : '';

  switch (type) {
    case 'narrate':
      return { type: 'narrate', text };

    case 'dialogue': {
      const speaker =
        typeof o['speaker'] === 'string' ? (o['speaker'] as string) : '???';
      const action: LlmAction = { type: 'dialogue', text, speaker };
      if (typeof o['expression'] === 'string') {
        (action as { expression?: string }).expression = o['expression'] as string;
      }
      return action;
    }

    case 'request_check': {
      const skill = typeof o['skill'] === 'string' ? (o['skill'] as string) : 'unknown';
      const difficulty = (typeof o['difficulty'] === 'string' &&
      ['normal', 'hard', 'extreme'].includes(o['difficulty'] as string)
        ? (o['difficulty'] as Difficulty)
        : 'normal');
      const rationale =
        typeof o['rationale'] === 'string' ? (o['rationale'] as string) : '';
      return { type: 'request_check', text, skill, difficulty, rationale };
    }

    case 'jump_scene': {
      const toScene =
        typeof o['toScene'] === 'string' ? (o['toScene'] as string) : '';
      if (!toScene) {
        return { type: 'narrate', text };
      }
      return { type: 'jump_scene', text, toScene };
    }

    case 'set_flag': {
      const flag = typeof o['flag'] === 'string' ? (o['flag'] as string) : '';
      const value = o['value'];
      if (!flag || (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string')) {
        return { type: 'narrate', text };
      }
      return { type: 'set_flag', text, flag, value };
    }

    default:
      return { type: 'narrate', text: text || raw };
  }
}

// ─── LlmAdapter 主类 ─────────────────────────────────

export interface LlmAdapterConfig {
  provider: LlmProvider;
  /** 每次调用的温度，默认 0.8 */
  temperature?: number;
  /** 历史消息上限，超过裁剪（防 prompt 膨胀）*/
  historyLimit?: number;
}

export class LlmAdapter {
  private provider: LlmProvider;
  private temperature: number;
  private historyLimit: number;
  private history: ChatMessage[] = [];

  constructor(cfg: LlmAdapterConfig) {
    this.provider = cfg.provider;
    this.temperature = cfg.temperature ?? 0.8;
    this.historyLimit = cfg.historyLimit ?? 20;
  }

  /** 重置对话历史（新场景开始时调用，避免 prompt 越积越长）*/
  resetHistory(): void {
    this.history = [];
  }

  /** 进入新场景：把 system prompt + 场景上下文压进历史 */
  async enterScene(
    sceneContextParams: BuildSceneContextParams,
  ): Promise<LlmAction> {
    this.history = [
      { role: 'system', content: SYSTEM_PROMPT_NARRATOR },
      {
        role: 'user',
        content: `${buildSceneContext(sceneContextParams)}\n\n请以场景描述开始 ${'narrate'} 这个场景。输出 JSON。`,
      },
    ];
    const res = await this.provider.chat(this.history, {
      temperature: this.temperature,
      jsonMode: true,
    });
    this.history.push({ role: 'assistant', content: res.content });
    return parseLlmAction(res.content);
  }

  /** 玩家输入一个行动 */
  async resolvePlayerAction(playerInput: string): Promise<LlmAction> {
    this.history.push({ role: 'user', content: userTurnPrompt(playerInput) });
    this.trimHistory();
    const res = await this.provider.chat(this.history, {
      temperature: this.temperature,
      jsonMode: true,
    });
    this.history.push({ role: 'assistant', content: res.content });
    return parseLlmAction(res.content);
  }

  /**
   * 让 LLM 基于当前 scene 给出 3-5 个"建议行动"+ 每个的结果叙事。
   * 用在"AI DM 提供选项"模式 —— 玩家不用自由输入。
   *
   * 输出包含:
   *   - label: 玩家看到的按钮文字（≤ 8 个字）
   *   - resultNarrate: 玩家点这个选项后看到的 AI 叙事
   *
   * 注意: 这些行动**不跳场景**, 都是当前 scene 内的探索 / 互动
   */
  async suggestActions(params: {
    sceneContext: string;
    count?: number;
  }): Promise<Array<{ label: string; resultNarrate: string }>> {
    const count = params.count ?? 4;
    const msg = `请基于上面那个场景, 生成 ${count} 个"玩家可能想做的小行动" + 每个的结果叙事。

【硬约束】
1. 行动**不能跳场景** —— 只在当前 scene 内的探索 / 观察 / 简短对话 / 尝试小动作
2. 不能触发离开场景的逻辑 (那是 exits 的事, 这里别管)
3. 不能丢骰子 / 不能解决场景核心谜题 (那是真版玩家行动 + 引擎检定要做的)
4. 行动 label ≤ 8 个汉字, 像 "查抽屉" / "看照片" / "敲墙壁"
5. resultNarrate 是 1-3 句叙事, 描述玩家做了之后看到/听到/感受到的东西
6. 不要给玩家直接揭示关键剧情, 用暗示 / 氛围渲染填充

【输出 JSON schema】 (严格 JSON, 不带 markdown wrapper)
{
  "actions": [
    { "label": "短按钮文字", "resultNarrate": "结果叙事" },
    ...
  ]
}`;

    this.history.push({ role: 'user', content: msg });
    this.trimHistory();
    const res = await this.provider.chat(this.history, {
      temperature: this.temperature,
      jsonMode: true,
    });
    this.history.push({ role: 'assistant', content: res.content });

    const cleaned = res.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    try {
      const parsed = JSON.parse(cleaned) as { actions?: Array<{ label?: string; resultNarrate?: string }> };
      if (!Array.isArray(parsed.actions)) return [];
      return parsed.actions
        .filter((a): a is { label: string; resultNarrate: string } =>
          typeof a.label === 'string' && typeof a.resultNarrate === 'string'
        )
        .slice(0, count);
    } catch {
      return [];
    }
  }

  /** 玩家做了一个选择 / 过渡，要 LLM 写过渡叙事（1-3 句） */
  async narrateTransition(params: {
    fromScene: string;
    toScene: string;
    choiceText: string;
  }): Promise<LlmAction> {
    this.history.push({
      role: 'user',
      content: `玩家做了选择："${params.choiceText}"。这个选择把他从场景 ${params.fromScene} 带向 ${params.toScene}。请用 1-3 句话写一段过渡叙事，描述他做出动作的瞬间到抵达新场景前的感受 / 视觉 / 声音。不要描述目标场景的内容（那是下一个 scene 的事）。**只输出 narrate type**——不要用 jump_scene，jumpLabel 由代码处理。`,
    });
    this.trimHistory();
    const res = await this.provider.chat(this.history, {
      temperature: this.temperature,
      jsonMode: true,
    });
    this.history.push({ role: 'assistant', content: res.content });
    const action = parseLlmAction(res.content);
    // 防御：LLM 偶尔返回 jump_scene type，强制降级为 narrate
    if (action.type !== 'narrate' && action.type !== 'dialogue') {
      return { type: 'narrate', text: action.text };
    }
    return action;
  }

  /** 检定刚出结果，请 LLM 叙事 */
  async narrateCheckResult(
    checkResult: import('../types/rules.js').CheckResult,
    context: { skill: string; intent: string },
  ): Promise<LlmAction> {
    this.history.push({
      role: 'user',
      content: checkResultPrompt(checkResult, context),
    });
    this.trimHistory();
    const res = await this.provider.chat(this.history, {
      temperature: this.temperature,
      jsonMode: true,
    });
    this.history.push({ role: 'assistant', content: res.content });
    return parseLlmAction(res.content);
  }

  /** 取当前 history（用于 debug / 存档）*/
  getHistory(): ReadonlyArray<ChatMessage> {
    return this.history;
  }

  /** 修剪历史，保留 system + 最近 N 轮 */
  private trimHistory(): void {
    if (this.history.length <= this.historyLimit) return;
    const system = this.history.filter((m) => m.role === 'system');
    const recent = this.history.slice(-this.historyLimit);
    // 确保 system 在最前
    if (recent[0]?.role !== 'system' && system.length > 0) {
      this.history = [system[0]!, ...recent];
    } else {
      this.history = recent;
    }
  }
}
