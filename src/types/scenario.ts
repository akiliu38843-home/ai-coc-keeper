// Scenario 数据模型 —— "AI 当 Keeper 跑的剧本"的结构化定义
//
// 设计原则:
// - 给 LLM 的是"作者意图"，不是"硬编流程"
//   场景里包含: 描述 / 暗示给 LLM 的提示 / 期望可能触发的检定 / 分支条件
// - LLM 看到这些后自己叙事；引擎只校验状态变化（jumpScene / setFlag 等是否合法）
// - 不强求作者写得多详细 —— LLM 能补足合理的细节

import type { Difficulty } from './rules.js';

// ─── 检定预设（场景里可能触发的） ────────────────────

export interface CheckDef {
  /** 技能 key，如 "spot_hidden" / "listen" / "library_use" / "psychology" */
  skill: string;
  /** 默认难度 —— LLM 可根据玩家描述上下浮动 */
  difficulty: Difficulty;
  /** 这次检定的语义：要找什么 / 看什么 / 听什么 */
  reason: string;
  /** 成功时触发的 flag 改变 / 跳转（可选 —— 给 LLM 做参考）*/
  onSuccess?: {
    setFlags?: Record<string, boolean | number | string>;
    jumpScene?: string;
    revealText?: string;  // 给玩家看的成功后线索文本
  };
  /** 失败时（可选）*/
  onFailure?: {
    setFlags?: Record<string, boolean | number | string>;
    jumpScene?: string;
    revealText?: string;
  };
}

// ─── 心智耗损触发（场景里的恐怖刺激）─────────────────

export interface SanityTrigger {
  /** 触发条件，自由文本给 LLM 参考 */
  trigger: string;
  /** 心智检定参数（"X/YdZ" 格式）*/
  lossOnSuccess: number;
  /** "1d4" / "1d6" 等记法，或固定数字 */
  lossOnFailureRoll: string | number;
  /** 触发时给玩家看的提示 */
  description?: string;
}

// ─── NPC 定义 ───────────────────────────────────────

export interface NpcDef {
  id: string;
  name: string;
  /** 给 LLM 的人设 prompt */
  persona: string;
  /** 初始态度 -100~100，默认 0 */
  initialAttitude?: number;
  /** 已知信息（NPC 可能说出来的话题列表）*/
  knowledge?: { topic: string; willing: 'always' | 'if_friendly' | 'if_check'; content: string }[];
  /** 立绘资源 ID（V0 用文件名）*/
  portraitId?: string;
}

// ─── 场景定义 ───────────────────────────────────────

export interface Scene {
  /** 场景唯一 ID */
  id: string;
  /** 场景名 (UI 展示用) */
  name: string;
  /** 给 LLM 的场景背景描述 */
  description: string;
  /**
   * V1: 此场景对应的原作完整段落 (parser 切段时保留, 不再压缩).
   *
   * 跟 description 的区别:
   *   - description: 2-4 句压缩摘要, 给 LLM 看建立场景认知
   *   - originalText: 原作 800-2000 字完整段落, 给 LLM 在 enterScene 时
   *     做"忠实改编"参考, 让 narrate 贴近原作具体情节
   *
   * 不在 V0 路径上的 scenario (手写本) 可以省略, builder 自动 fallback 用 description.
   */
  originalText?: string;
  /**
   * V1: 此场景必须发生的强制事件 (战斗 / 检定), 不放进可选 4 个行动里.
   * builder 自动把这些塞进 main narrate 而非 in-scene action.
   *
   * 例: { kind: 'combat', skill: 'brawl', narrate: '走廊尽头扑上来一只...' }
   */
  mandatoryEvents?: MandatoryEvent[];
  /** 作者埋的暗示 (给 LLM 看, 不直接给玩家) */
  hints?: string[];
  /** 此场景里 NPC 列表（id 引用 scenario.npcs）*/
  npcs?: string[];
  /** 可能触发的检定（给 LLM 参考；LLM 也可以临时定其他检定）*/
  expectedChecks?: CheckDef[];
  /** 心智耗损触发点 */
  sanityTriggers?: SanityTrigger[];
  /** 从这个场景能跳到哪些场景（白名单 —— LLM 不能擅自跳到不在这里的场景）*/
  exits?: { toScene: string; condition: string }[];
  /** 进入此场景前必须满足的 flags（用于引擎校验）*/
  requiredFlags?: Record<string, boolean | number | string>;
  /** 此场景的 BGM / 背景图（资源 ID） */
  bgm?: string;
  background?: string;
  /** 场景氛围 —— 给 builder 选默认 BGM 用 */
  mood?: SceneMood;
}

/**
 * V1: 此场景必须发生的强制事件 (战斗 / 检定 / 心智冲击).
 *
 * 跟 expectedChecks 的区别:
 *   - expectedChecks: LLM 可能在 in-scene action 里建议的检定 (玩家选了才发生)
 *   - mandatoryEvents: builder 强制塞进 main narrate (玩家无法跳过)
 *
 * 用于"原作明确说战斗必然发生"的场景 (例: 琥珀の牢 在総裁室必须打 boss).
 */
export type MandatoryEvent =
  | { kind: 'combat'; skill: string; narrate: string; onSuccess?: string; onFailure?: string; damageOnFailure?: string }
  | { kind: 'check'; skill: string; difficulty?: 'normal' | 'hard' | 'extreme'; narrate: string }
  | { kind: 'sanity'; trigger: string; lossOnSuccess: number; lossOnFailureRoll: string };

/** 场景氛围分类，决定默认 BGM */
export type SceneMood =
  | 'calm'        // 开场 / 平和 / 探索初期
  | 'mystery'     // 谜团 / 调查 / 线索
  | 'tension'     // 紧张 / 监视 / 即将出事
  | 'horror'      // 直面恐怖 / 心智冲击
  | 'climax'      // 高潮 / 战斗 / 仪式
  | 'ending';     // 结局 / 余韵

// ─── 整本剧本 ───────────────────────────────────────

export interface Scenario {
  /** 剧本唯一 ID */
  id: string;
  /** 标题 */
  title: string;
  /** 作者（可选，作者可放署名）*/
  author?: string;
  /** 设定背景（年代 / 地点 / 风格）*/
  setting: string;
  /** 给 LLM 看的剧本"作者意图"概述 */
  authorNotes?: string;
  /** 起点场景 ID */
  startSceneId: string;
  /** 所有场景 */
  scenes: Scene[];
  /** 所有 NPC */
  npcs: NpcDef[];
  /** Scenario 文件的 schema version（未来兼容用）*/
  schemaVersion: 1;
}
