// 多 pass Scenario Parser —— W7 实战调优
//
// W6.2 单 pass 的问题：
//   - 全文 54K tokens 喂 LLM + 要求 16K 输出 → gateway 504 超时
//   - 限制 6K 输出 + truncate 15K 字符 → 只能解析前 1/10 剧本
//
// W7 多 pass 解法：
//   1. OUTLINE PASS：喂全文给 LLM，只让出 scene 骨架（id/name/2 句话描述/原文页码引用）
//      → 输出短，gateway 安全
//   2. DETAIL PASS：对每个 outline scene，喂"全部 outline + 当前 scene 对应的原文页"
//      → 输入小，输出小，gateway 安全
//   3. ASSEMBLY：合成完整 Scenario JSON + 校验

import type { LlmProvider } from '../llm/provider.js';
import type { Scenario, Scene, NpcDef } from '../types/scenario.js';
import type { PdfExtractResult } from './pdf-extract.js';
import {
  validateScenario,
  type ValidationIssue,
} from '../engine/scenario-validator.js';

// ─── Pass 1 · Outline ────────────────────────────────

export interface OutlineScene {
  id: string;
  name: string;
  /** 给后续 detail pass 看的简短摘要 */
  shortDescription: string;
  /** 关联原文页码范围（含端点）*/
  pageRange: { from: number; to: number };
  /** 大致类型，给 detail pass 当 hint */
  kind?: 'intro' | 'exploration' | 'encounter' | 'climax' | 'ending';
}

export interface ScenarioOutline {
  id: string;
  title: string;
  setting: string;
  authorNotes: string;
  startSceneId: string;
  scenes: OutlineScene[];
  /** Pass 1 顺手识别出的 NPC */
  npcs: NpcDef[];
}

const OUTLINE_SYSTEM_PROMPT = `你是 COC 剧本结构分析器。任务：把一份原文本剧本"骨架化"成 ScenarioOutline JSON。

只输出 outline —— 不要写场景细节、不要写检定、不要写心智耗损触发。这些后续会另跑 detail pass。

【输出 JSON schema】
{
  "id": "kebab-case",
  "title": "剧本标题",
  "setting": "时代+地点+风格一句话",
  "authorNotes": "整本剧本结构概述 + 真相要点（给 LLM 后续 pass 看，不给玩家）",
  "startSceneId": "起点场景 ID",
  "scenes": [
    {
      "id": "scene_xxx",
      "name": "场景名",
      "shortDescription": "1-2 句话描述这个场景发生什么",
      "pageRange": { "from": 3, "to": 5 },
      "kind": "intro" | "exploration" | "encounter" | "climax" | "ending"
    }
    ...
  ],
  "npcs": [
    {
      "id": "npc_xxx",
      "name": "NPC 名",
      "persona": "1-2 句人设：身份 / 性格 / 目的"
    }
  ]
}

【关键规则】
1. 识别所有有意义的场景节点（CYOA 编号体里每个有意义的"段"做一个 scene；非编号体按地点/转折分）
2. pageRange 必须填，方便后续 pass 找原文
3. 输出 8-25 个 scenes（少则丢内容，多则过细）
4. 严格 JSON，不带 markdown wrapper
5. 不解释你的逻辑`;

async function runOutlinePass(
  pdfResult: PdfExtractResult,
  provider: LlmProvider,
): Promise<ScenarioOutline> {
  // 输入用 fullText（含 [Page N] 标记），保留页码信息
  const response = await provider.chat(
    [
      { role: 'system', content: OUTLINE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `请把下面这份 COC 单人本骨架化成 ScenarioOutline JSON。\n\n原文（共 ${pdfResult.totalPages} 页）:\n"""\n${pdfResult.fullText}\n"""\n\n输出 JSON。`,
      },
    ],
    {
      temperature: 0.3,
      jsonMode: true,
      maxTokens: 5000,
    },
  );

  const cleaned = response.content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const parsed = JSON.parse(cleaned) as ScenarioOutline;

  if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error('Outline pass 没返回 scenes');
  }
  return parsed;
}

// ─── Pass 2 · Per-scene Detail ───────────────────────

const DETAIL_SYSTEM_PROMPT = `你是 COC 剧本场景细化器。给你一个场景的简短大纲 + 它对应的原文片段，请输出完整的 Scene JSON。

【输出 JSON schema】
{
  "id": "<scene 已确定的 ID>",
  "name": "<scene 已确定的 name>",
  "description": "给玩家看的场景文本（2-4 句，保留原文意境，可微调）",
  "hints": ["作者埋的 3-5 个细节（给 LLM 看，不直接告诉玩家）"],
  "expectedChecks": [
    {
      "skill": "spot_hidden" | "listen" | "library_use" | "psychology" | "locksmith" | ...,
      "difficulty": "normal" | "hard" | "extreme",
      "reason": "为什么会在这里触发这个检定",
      "onSuccess": { "setFlags": {...}, "revealText": "成功后揭示" }
    }
  ],
  "sanityTriggers": [
    {
      "trigger": "什么场景导致心智耗损",
      "lossOnSuccess": 0,
      "lossOnFailureRoll": "1d4",
      "description": "看到时的具体内容"
    }
  ],
  "exits": [
    { "toScene": "<目标 scene ID>", "condition": "玩家做什么时跳到那里" }
  ]
}

【关键规则】
1. id 和 name 用大纲给的，别改
2. exits.toScene 必须是大纲里实际存在的 scene ID
3. skill key 用小写英文：spot_hidden / listen / library_use / psychology / locksmith / first_aid / medicine / persuade / sneak / fast_talk / charm / intimidate / language_own / language_other / brawl / dodge / drive_auto / drive_horsecart / firearms_handgun / firearms_rifle / occult / accounting / law / track / climb / jump / swim / throw
4. 严格 JSON，不带 markdown wrapper`;

async function runDetailPassForScene(
  outline: ScenarioOutline,
  scene: OutlineScene,
  pdfResult: PdfExtractResult,
  provider: LlmProvider,
): Promise<Scene> {
  // 取这个 scene 的原文页（+ 前后各 1 页作为上下文）
  const fromIdx = Math.max(0, scene.pageRange.from - 2);
  const toIdx = Math.min(pdfResult.pages.length - 1, scene.pageRange.to);
  const relevantPages = pdfResult.pages.slice(fromIdx, toIdx + 1);
  const relevantText = relevantPages
    .map((p) => `[Page ${p.pageNumber}]\n${p.text}`)
    .join('\n\n');

  // 完整 outline 上下文（让 LLM 知道 exits 能指向哪些 scene）
  const outlineSummary = outline.scenes
    .map((s) => `  - ${s.id} (${s.name}): ${s.shortDescription}`)
    .join('\n');

  const response = await provider.chat(
    [
      { role: 'system', content: DETAIL_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `【剧本】${outline.title} (${outline.setting})

【全部场景列表】（exits.toScene 只能用这些 ID）
${outlineSummary}

【当前要细化的场景】
- id: ${scene.id}
- name: ${scene.name}
- 大纲简述: ${scene.shortDescription}
- 对应原文页: ${scene.pageRange.from} - ${scene.pageRange.to}

【相关原文片段】
"""
${relevantText}
"""

请输出这个场景的完整 Scene JSON。`,
      },
    ],
    {
      temperature: 0.3,
      jsonMode: true,
      maxTokens: 2500,
    },
  );

  const cleaned = response.content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  return JSON.parse(cleaned) as Scene;
}

// ─── 主入口 ──────────────────────────────────────────

export interface MultiPassParseResult {
  ok: boolean;
  scenario?: Scenario;
  issues?: ValidationIssue[];
  /** 调试用：分别记录 outline 和每个 detail pass 的 token 用量 */
  passInfo?: {
    outlineTokens: number;
    detailTokensTotal: number;
    detailCallCount: number;
    failedScenes: string[];
  };
}

export interface MultiPassOptions {
  /** 跳过 detail pass，只跑 outline（快速预览模式）*/
  outlineOnly?: boolean;
  /** detail pass 时跳过的 scene 数（如 outline 已有 20 个但只想跑前 5 个 detail 验证）*/
  detailLimit?: number;
  /** 每个 detail pass 之间间隔毫秒（防止 rate limit）*/
  detailDelayMs?: number;
  /** 进度回调 */
  onProgress?: (info: { stage: 'outline' | 'detail'; current: number; total: number; sceneName?: string }) => void;
}

/**
 * 多 pass 解析：outline → 每个 scene 单独 detail → 合并 → 校验。
 */
export async function multiPassParse(
  pdfResult: PdfExtractResult,
  provider: LlmProvider,
  opts: MultiPassOptions = {},
): Promise<MultiPassParseResult> {
  const passInfo = {
    outlineTokens: 0,
    detailTokensTotal: 0,
    detailCallCount: 0,
    failedScenes: [] as string[],
  };

  // PASS 1: Outline
  opts.onProgress?.({ stage: 'outline', current: 0, total: 1 });
  let outline: ScenarioOutline;
  try {
    outline = await runOutlinePass(pdfResult, provider);
  } catch (e) {
    return {
      ok: false,
      issues: [
        {
          path: '$',
          message: `Outline pass 失败: ${(e as Error).message}`,
          severity: 'error',
        },
      ],
      passInfo,
    };
  }

  if (opts.outlineOnly) {
    // 仅返回骨架，不跑 detail（debug 模式）
    const stubScenario: Scenario = {
      schemaVersion: 1,
      id: outline.id,
      title: outline.title,
      setting: outline.setting,
      authorNotes: outline.authorNotes,
      startSceneId: outline.startSceneId,
      scenes: outline.scenes.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.shortDescription,
      })),
      npcs: outline.npcs,
    };
    return { ok: true, scenario: stubScenario, passInfo };
  }

  // PASS 2: 每个 scene 单独 detail
  const detailLimit = opts.detailLimit ?? outline.scenes.length;
  const toProcess = outline.scenes.slice(0, detailLimit);
  const detailedScenes: Scene[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const outlineScene = toProcess[i]!;
    opts.onProgress?.({
      stage: 'detail',
      current: i + 1,
      total: toProcess.length,
      sceneName: outlineScene.name,
    });
    try {
      const detailed = await runDetailPassForScene(outline, outlineScene, pdfResult, provider);
      detailedScenes.push(detailed);
      passInfo.detailCallCount++;
    } catch (e) {
      passInfo.failedScenes.push(outlineScene.id);
      // 失败的 scene 用 outline 信息兜底（避免 scenario 残缺）
      detailedScenes.push({
        id: outlineScene.id,
        name: outlineScene.name,
        description: outlineScene.shortDescription,
        hints: [`[detail pass 失败: ${(e as Error).message.slice(0, 100)}]`],
      });
    }
    if (opts.detailDelayMs && i < toProcess.length - 1) {
      await new Promise((r) => setTimeout(r, opts.detailDelayMs));
    }
  }

  // 如果只跑前 N 个 detail，剩余 scene 用 outline 信息补
  for (let i = detailLimit; i < outline.scenes.length; i++) {
    const s = outline.scenes[i]!;
    detailedScenes.push({
      id: s.id,
      name: s.name,
      description: s.shortDescription,
    });
  }

  // PASS 3: Assembly
  const scenario: Scenario = {
    schemaVersion: 1,
    id: outline.id,
    title: outline.title,
    setting: outline.setting,
    authorNotes: outline.authorNotes,
    startSceneId: outline.startSceneId,
    scenes: detailedScenes,
    npcs: outline.npcs,
  };

  // 校验
  const validation = validateScenario(scenario);
  if (!validation.valid) {
    return { ok: false, scenario, issues: validation.issues, passInfo };
  }
  return { ok: true, scenario, passInfo };
}
