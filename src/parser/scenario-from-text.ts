// LLM-driven Scenario JSON 生成 —— 文本剧本 → 结构化 Scenario
//
// 工作流：
// 1. 把原文本（PDF 抽取后或纯文本）发给 LLM
// 2. LLM 输出 Scenario JSON
// 3. 校验 + 返回结构化结果或错误列表

import type { LlmProvider } from '../llm/provider.js';
import type { Scenario } from '../types/scenario.js';
import {
  validateScenario,
  type ValidationIssue,
} from '../engine/scenario-validator.js';

// ─── Parser system prompt ───────────────────────────

export const SYSTEM_PROMPT_SCENARIO_PARSER = `你是一个 COC 单人本剧本解析器。任务：把一份原文本剧本转换成 Scenario JSON。

【输出格式】严格 JSON，schema 如下：

{
  "schemaVersion": 1,
  "id": "kebab-case-id",
  "title": "剧本标题",
  "author": "作者（如果原文有署名）",
  "setting": "时代+地点+风格一句话",
  "authorNotes": "整体剧本结构 / 核心谜题 / 真相的概述（给后续 LLM 读，不给玩家）",
  "startSceneId": "第一个场景的 ID",
  "scenes": [
    {
      "id": "scene_xxx",
      "name": "场景显示名",
      "description": "给玩家看的场景文本（保留原文意境，可以稍微改写）",
      "hints": ["作者埋的细节 1（不直接给玩家，给 LLM 当提示）", "..."],
      "expectedChecks": [
        {
          "skill": "spot_hidden",
          "difficulty": "normal",
          "reason": "玩家为什么会触发这个检定",
          "onSuccess": { "setFlags": {...}, "revealText": "成功后揭示" },
          "onFailure": { "setFlags": {...}, "revealText": "失败后描述" }
        }
      ],
      "sanityTriggers": [
        {
          "trigger": "什么场景导致心智耗损",
          "lossOnSuccess": 0,
          "lossOnFailureRoll": "1d6",
          "description": "看到时的具体内容"
        }
      ],
      "exits": [
        { "toScene": "scene_yyy", "condition": "玩家选择 X 时" }
      ]
    }
  ],
  "npcs": [
    {
      "id": "npc_xxx",
      "name": "NPC 名",
      "persona": "给 LLM 的人设 prompt（性格 / 目的 / 知道什么 / 不知道什么）",
      "initialAttitude": 0
    }
  ]
}

【关键规则】
1. ID 用小写英文 + 下划线（如 "scene_library_entrance"）
2. skill key 用小写英文（spot_hidden / listen / library_use / psychology / locksmith / brawl / dodge / drive_auto / first_aid / medicine / occult / persuade / sneak / stealth / track）
3. difficulty 只能是 normal / hard / extreme
4. exits.toScene 必须是 scenes 数组里实际存在的 ID
5. startSceneId 必须是 scenes[0] 或其他存在的 scene id
6. 如果原文本是 CYOA / Choose Your Own Adventure 风格（每段编号），把每个有意义的"选择节点"做成一个 scene
7. 不在原文里的细节不要凭空发挥；可以重述 / 微调表达，但不增删核心剧情

【输出要求】
- 严格 JSON
- 不带 markdown code block
- 不解释你的逻辑
- 不增加 ${'```'} json ${'```'} 标签`;

// ─── 调用 LLM 解析 ──────────────────────────────────

export interface ParseScenarioOptions {
  /** 提示 LLM 用什么风格解析，如 "CYOA 编号体" / "传统多场景探索体" */
  hint?: string;
  /** 最大输出 token */
  maxTokens?: number;
  /** 温度 —— 默认 0.3（解析任务要稳定，不要发挥）*/
  temperature?: number;
  /** 截断输入到前 N 字符（gateway timeout 兜底）。默认不截断 */
  truncateInputChars?: number;
}

export interface ParseScenarioResult {
  ok: boolean;
  scenario?: Scenario;
  issues?: ValidationIssue[];
  rawLlmOutput?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * 用 LLM 把原文本剧本解析成 Scenario JSON。
 *
 * @example
 * const result = await parseScenarioFromText(text, provider);
 * if (result.ok) console.log(result.scenario);
 * else result.issues.forEach(i => console.error(i.message));
 */
export async function parseScenarioFromText(
  text: string,
  provider: LlmProvider,
  opts: ParseScenarioOptions = {},
): Promise<ParseScenarioResult> {
  const hint = opts.hint ? `\n\n【格式提示】${opts.hint}` : '';
  const trimmed = opts.truncateInputChars
    ? text.slice(0, opts.truncateInputChars)
    : text;
  const truncNote = opts.truncateInputChars && text.length > opts.truncateInputChars
    ? `\n\n【注意】原文有 ${text.length} 字符，本次只给你前 ${opts.truncateInputChars} 字符（V0 演示限制）。请只解析你看到的部分，剩余场景留空但 startSceneId 要指向你确实创建的场景。`
    : '';
  const userPrompt = `请把下面这份剧本原文解析成 Scenario JSON。${hint}${truncNote}

【重要约束】V0 限输出规模：
- 只创建 **3-6 个最重要的场景**（开头、关键转折、结尾各 1 个；中间挑重要的）
- 每个场景的 description 写 2-4 句即可，不要逐字翻译原文
- 不要写超过 6 个 expectedChecks
- 输出总长度 **不超过 5000 tokens**

原文:
"""
${trimmed}
"""

输出 JSON。`;

  const response = await provider.chat(
    [
      { role: 'system', content: SYSTEM_PROMPT_SCENARIO_PARSER },
      { role: 'user', content: userPrompt },
    ],
    {
      temperature: opts.temperature ?? 0.3,
      jsonMode: true,
      // 6000 token 出 5-8 个场景够，避免 gateway 60s 超时
      maxTokens: opts.maxTokens ?? 6000,
    },
  );

  const result: ParseScenarioResult = { ok: false, rawLlmOutput: response.content };
  if (response.usage) result.usage = response.usage;

  // 剥可能的 markdown wrapper
  const cleaned = response.content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    result.issues = [
      {
        path: '$',
        message: `LLM 输出不是合法 JSON: ${(e as Error).message}`,
        severity: 'error',
      },
    ];
    return result;
  }

  const validation = validateScenario(parsed);
  if (!validation.valid) {
    result.issues = validation.issues;
    return result;
  }

  result.ok = true;
  result.scenario = parsed as Scenario;
  return result;
}
