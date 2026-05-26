// LLM Provider 抽象 —— OpenAI / DeepSeek / Anthropic 等多家适配
// 所有 provider 走 OpenAI 兼容协议（绝大多数中文 LLM 都支持）

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatOptions {
  /** 温度，0-2，COC 叙事建议 0.7-0.9 */
  temperature?: number;
  /** 是否要求 JSON 输出 */
  jsonMode?: boolean;
  /** 最大输出 token */
  maxTokens?: number;
  /** Stop sequences */
  stop?: string[];
  /** 注入 RNG / seed（少数 provider 支持 deterministic）*/
  seed?: number;
}

export interface ChatResponse {
  /** 完整文本回复 */
  content: string;
  /** Token 使用统计（用于成本追踪）*/
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Provider 自身报的 model 名 */
  model?: string;
  /** finish reason: stop / length / content_filter / tool_calls */
  finishReason?: string;
}

/**
 * LLM Provider 接口。
 *
 * 测试用 MockLlmProvider 替代真 API 调用。
 */
export interface LlmProvider {
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
  /** Provider 显示名 (logging) */
  name: string;
}

/** 测试 mock —— 按预设序列返回响应 */
export class MockLlmProvider implements LlmProvider {
  name = 'mock';
  private responses: ChatResponse[];
  private idx = 0;
  public calls: { messages: ChatMessage[]; opts?: ChatOptions }[] = [];

  constructor(responses: (string | ChatResponse)[]) {
    this.responses = responses.map((r) =>
      typeof r === 'string' ? { content: r } : r,
    );
  }

  async chat(
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): Promise<ChatResponse> {
    // 深拷贝 messages —— 防止上层 push assistant 后污染历史调用记录
    this.calls.push({
      messages: messages.map((m) => ({ ...m })),
      ...(opts !== undefined ? { opts: { ...opts } } : {}),
    });
    if (this.idx >= this.responses.length) {
      throw new Error(
        `MockLlmProvider: 响应序列用尽（已用 ${this.idx}，长度 ${this.responses.length}）`,
      );
    }
    return this.responses[this.idx++]!;
  }
}
