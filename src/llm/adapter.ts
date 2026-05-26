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
