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
  /**
   * V1 模式: 不压缩, 每个场景挂上完整原文段落 (originalText).
   * gen:ai-game 在 enterScene 时把 originalText 喂给 LLM 做"忠实改编",
   * 玩家看到的 narrate 贴近原作具体情节, 不是 AI 自由脑补.
   *
   * V0 模式 (默认): 只输出 3-6 场景 + 摘要 description, AI gen 时自由发挥.
   */
  v1Mode?: boolean;
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
  const userPrompt = opts.v1Mode
    ? `请把下面这份剧本原文**切分**成 Scenario JSON. ${hint}${truncNote}

【V1 模式 · 切分而不压缩】

1. **场景数**: 按原文自然章节切, 5-12 个场景. 不要少于 5 个 (避免压缩过狠), 不要超过 12 个 (避免过碎)
2. **每个场景必须包含 originalText 字段**: 该场景对应的原文**完整段落, 原样从原文里抠出来**, 不要重写, 不要总结, 不要省略. 这是 V1 的核心: gen 时 LLM 看着原文做改编, 不让它自由脑补.
3. **description 字段**: 仍然写 2-4 句**摘要** (给 LLM 当 hint 用, 跟原文呼应但不重复 originalText)
4. **mandatoryEvents 字段** (新, 重要): 原文里**明确写了必然发生**的战斗 / 检定 / 心智冲击, 列在这里. 例如:
   - 原文 "敌人冲过来, 调查员必须做战斗检定" → mandatoryEvents: [{ kind: 'combat', skill: 'brawl', narrate: '...', damageOnFailure: '1d4' }]
   - 原文 "看到尸体, SAN 检定" → mandatoryEvents: [{ kind: 'sanity', trigger: '看到尸体', lossOnSuccess: 0, lossOnFailureRoll: '1d6' }]
   - 不放进 expectedChecks (那是可选), 放进 mandatoryEvents (强制)
5. expectedChecks 仍写, 是"玩家**可能选**的探索动作", 跟 mandatoryEvents 互补
6. **不允许偏离原文**: 不要发明原文没有的角色 / 场景 / 桥段. 原文有什么写什么.

原文:
"""
${trimmed}
"""

输出严格 JSON, 不带 markdown wrapper.`
    : `请把下面这份剧本原文解析成 Scenario JSON。${hint}${truncNote}

【V0 模式 · 重要约束】限输出规模：
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
      // V0: 6000 token 出 5-8 个场景; V1 要 originalText 完整复制原文段, 但 gateway ~90s timeout 不允许 16k
      maxTokens: opts.maxTokens ?? (opts.v1Mode ? 8000 : 6000),
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

// ─── V1 第 2 趟: 并行给每个场景挂 originalText ───────────

/**
 * V1 模式的 Pass 2: 已经有 V0 风格 scenario (结构 + 摘要 description), 现在
 * 给每个场景**并行**调 LLM, 从源文本里抠出对应的原文段落, 挂到 scene.originalText.
 *
 * 为什么不 1-shot 让 LLM 同时切结构 + 输出 originalText:
 * - 1-shot 输出 ~14k tokens 触发 gateway 504. 实测过.
 * - 2-pass 每次输出 ~1.5k tokens, 5 个场景并行 ~30s 全完, gateway 友好.
 *
 * 每个场景一次 LLM 调用:
 * - input: 完整源文本 + 该场景的 description 和 hints
 * - output: 该场景对应的源文本 verbatim 段落 (纯文本)
 */
export async function enrichWithOriginalText(
  scenario: Scenario,
  sourceText: string,
  provider: LlmProvider,
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<Scenario> {
  const tasks = scenario.scenes.map(async (scene, idx) => {
    const prompt = `下面是一个 COC 跑团本的源文本 (共 ${sourceText.length} 字), 以及一个已切好的场景元数据.

任务: 从源文本里**逐字逐句抠出**这个场景对应的完整原文段落. 严格 verbatim, 不许重写, 不许省略, 不许总结. 直接返回那一段原文.

【场景 ${idx + 1} 元数据】
ID: ${scene.id}
名: ${scene.name}
摘要: ${scene.description}
${(scene.hints && scene.hints.length > 0) ? `提示: ${scene.hints.join(' / ')}` : ''}

【源文本】
"""
${sourceText}
"""

输出: 直接给原文段落, 不带任何 markdown / 解释 / 引号. 段落应该和摘要 / 提示语义匹配, 长度通常 500-2000 字, 跨越一个完整章节边界.`;

    try {
      const response = await provider.chat(
        [{ role: 'user', content: prompt }],
        {
          temperature: opts.temperature ?? 0.1,
          maxTokens: opts.maxTokens ?? 4000,
        },
      );
      const passage = response.content.trim()
        .replace(/^"""\s*/, '').replace(/\s*"""$/, '')
        .replace(/^```[a-z]*\s*/, '').replace(/\s*```$/, '');
      return { ...scene, originalText: passage };
    } catch (e) {
      console.warn(`  ⚠ 场景 ${scene.id} 抽 originalText 失败: ${(e as Error).message.slice(0, 80)}`);
      return scene;
    }
  });

  const enrichedScenes = await Promise.all(tasks);
  return { ...scenario, scenes: enrichedScenes };
}
