// OpenAI 兼容 provider —— DeepSeek / OpenAI / Anthropic-via-proxy 都用
// 不依赖任何 SDK，纯 fetch（让用户能随时换 endpoint）

import type {
  LlmProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
} from './provider.js';

export interface OpenAICompatibleConfig {
  /** API base URL,如 https://api.deepseek.com / https://api.openai.com/v1 */
  baseUrl: string;
  /** API key */
  apiKey: string;
  /** 模型名，如 deepseek-chat / gpt-4o-mini */
  model: string;
  /** provider 显示名 */
  displayName?: string;
  /** 网络请求 timeout (ms) */
  timeoutMs?: number;
}

export class OpenAICompatibleProvider implements LlmProvider {
  name: string;
  private cfg: OpenAICompatibleConfig;

  constructor(cfg: OpenAICompatibleConfig) {
    this.cfg = cfg;
    this.name = cfg.displayName ?? cfg.model;
  }

  async chat(
    messages: ChatMessage[],
    opts: ChatOptions = {},
  ): Promise<ChatResponse> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
    };
    if (opts.temperature !== undefined) body['temperature'] = opts.temperature;
    if (opts.maxTokens !== undefined) body['max_tokens'] = opts.maxTokens;
    if (opts.stop !== undefined) body['stop'] = opts.stop;
    if (opts.seed !== undefined) body['seed'] = opts.seed;
    if (opts.jsonMode) body['response_format'] = { type: 'json_object' };

    const controller = new AbortController();
    const timeoutMs = this.cfg.timeoutMs ?? 60_000;
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `LLM provider ${this.name} HTTP ${res.status}: ${text.slice(0, 200)}`,
        );
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
        model?: string;
      };
      const choice = data.choices?.[0];
      const content = choice?.message?.content ?? '';
      const response: ChatResponse = {
        content,
      };
      if (choice?.finish_reason) response.finishReason = choice.finish_reason;
      if (data.model) response.model = data.model;
      if (data.usage) {
        response.usage = {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        };
      }
      return response;
    } finally {
      clearTimeout(t);
    }
  }
}

/** 预设的几个常用 provider 配置 helper */
export const PRESETS = {
  deepseekChat: (apiKey: string): OpenAICompatibleConfig => ({
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey,
    model: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
  }),
  openaiGpt4oMini: (apiKey: string): OpenAICompatibleConfig => ({
    baseUrl: 'https://api.openai.com/v1',
    apiKey,
    model: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
  }),
};
