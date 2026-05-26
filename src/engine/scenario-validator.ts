// Scenario JSON 校验器 —— 不依赖 zod，纯手写 type guard + 业务规则检查
//
// 设计原则：
// - 失败时返回一份"具体哪里坏了"的报告，不抛错（让上层决定怎么处理）
// - 不仅校验"格式对"，还校验"业务一致"：startScene 在 scenes 里、npcs 引用都能解析、跳转目标都存在等
// - 严格模式：每个错误都报，不"早 return"，方便一次拿全所有问题

import type {
  Scenario,
  Scene,
  CheckDef,
  NpcDef,
  SanityTrigger,
} from '../types/scenario.js';
import type { Difficulty } from '../types/rules.js';

export interface ValidationIssue {
  path: string;       // "scenes[2].expectedChecks[0].skill"
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;     // 没有 error
  issues: ValidationIssue[];
}

// ─── 主入口 ─────────────────────────────────────────

/**
 * 校验一个 Scenario 对象。
 *
 * 返回 valid=true 表示没 error（可能仍有 warnings）。
 * 返回 valid=false 时 issues 至少有一个 error。
 */
export function validateScenario(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const ctx = { issues };

  if (typeof input !== 'object' || input === null) {
    return {
      valid: false,
      issues: [{ path: '$', message: '剧本必须是一个对象', severity: 'error' }],
    };
  }
  const obj = input as Record<string, unknown>;

  // schemaVersion
  if (obj['schemaVersion'] !== 1) {
    pushErr(ctx, '$.schemaVersion', `schemaVersion 必须是 1（实际 ${JSON.stringify(obj['schemaVersion'])}）`);
  }
  // 顶层必填字段
  requireString(ctx, obj, 'id', '$');
  requireString(ctx, obj, 'title', '$');
  requireString(ctx, obj, 'setting', '$');
  requireString(ctx, obj, 'startSceneId', '$');
  requireArray(ctx, obj, 'scenes', '$');
  requireArray(ctx, obj, 'npcs', '$');

  if (issues.some((i) => i.severity === 'error')) {
    return { valid: false, issues };
  }
  // 现在可以更安全地强转
  const sc = obj as unknown as Scenario;

  // 校验每个 scene
  const sceneIds = new Set<string>();
  sc.scenes.forEach((scene, i) => {
    validateScene(scene, `$.scenes[${i}]`, ctx);
    if (typeof (scene as Scene).id === 'string') {
      if (sceneIds.has(scene.id)) {
        pushErr(ctx, `$.scenes[${i}].id`, `场景 ID 重复: "${scene.id}"`);
      }
      sceneIds.add(scene.id);
    }
  });

  // startSceneId 必须在 scenes 里
  if (!sceneIds.has(sc.startSceneId)) {
    pushErr(ctx, '$.startSceneId', `起点场景 "${sc.startSceneId}" 不在 scenes 列表里`);
  }

  // 校验每个 NPC
  const npcIds = new Set<string>();
  sc.npcs.forEach((npc, i) => {
    validateNpc(npc, `$.npcs[${i}]`, ctx);
    if (typeof (npc as NpcDef).id === 'string') {
      if (npcIds.has(npc.id)) {
        pushErr(ctx, `$.npcs[${i}].id`, `NPC ID 重复: "${npc.id}"`);
      }
      npcIds.add(npc.id);
    }
  });

  // 跨引用校验：scene.npcs / scene.exits.toScene 必须存在
  sc.scenes.forEach((scene, i) => {
    scene.npcs?.forEach((npcRef, j) => {
      if (!npcIds.has(npcRef)) {
        pushErr(ctx, `$.scenes[${i}].npcs[${j}]`, `场景引用了未定义的 NPC: "${npcRef}"`);
      }
    });
    scene.exits?.forEach((exit, j) => {
      if (!sceneIds.has(exit.toScene)) {
        pushErr(ctx, `$.scenes[${i}].exits[${j}].toScene`, `出口指向未定义的场景: "${exit.toScene}"`);
      }
    });
    scene.expectedChecks?.forEach((check, j) => {
      check.onSuccess?.jumpScene && checkSceneRef(ctx, sceneIds, check.onSuccess.jumpScene, `$.scenes[${i}].expectedChecks[${j}].onSuccess.jumpScene`);
      check.onFailure?.jumpScene && checkSceneRef(ctx, sceneIds, check.onFailure.jumpScene, `$.scenes[${i}].expectedChecks[${j}].onFailure.jumpScene`);
    });
  });

  return { valid: !issues.some((i) => i.severity === 'error'), issues };
}

// ─── Scene 校验 ──────────────────────────────────────

function validateScene(scene: unknown, path: string, ctx: { issues: ValidationIssue[] }): void {
  if (typeof scene !== 'object' || scene === null) {
    pushErr(ctx, path, '场景必须是对象');
    return;
  }
  const s = scene as Record<string, unknown>;
  requireString(ctx, s, 'id', path);
  requireString(ctx, s, 'name', path);
  requireString(ctx, s, 'description', path);

  if (s['expectedChecks'] !== undefined) {
    if (!Array.isArray(s['expectedChecks'])) {
      pushErr(ctx, `${path}.expectedChecks`, '必须是数组');
    } else {
      (s['expectedChecks'] as unknown[]).forEach((c, i) => {
        validateCheck(c, `${path}.expectedChecks[${i}]`, ctx);
      });
    }
  }

  if (s['sanityTriggers'] !== undefined) {
    if (!Array.isArray(s['sanityTriggers'])) {
      pushErr(ctx, `${path}.sanityTriggers`, '必须是数组');
    } else {
      (s['sanityTriggers'] as unknown[]).forEach((t, i) => {
        validateSanityTrigger(t, `${path}.sanityTriggers[${i}]`, ctx);
      });
    }
  }
}

// ─── Check 校验 ──────────────────────────────────────

const VALID_DIFFICULTIES: ReadonlySet<Difficulty> = new Set(['normal', 'hard', 'extreme'] as const);

function validateCheck(check: unknown, path: string, ctx: { issues: ValidationIssue[] }): void {
  if (typeof check !== 'object' || check === null) {
    pushErr(ctx, path, 'check 必须是对象');
    return;
  }
  const c = check as Record<string, unknown>;
  requireString(ctx, c, 'skill', path);
  requireString(ctx, c, 'reason', path);
  if (typeof c['difficulty'] !== 'string') {
    pushErr(ctx, `${path}.difficulty`, '必须是 normal / hard / extreme 之一');
  } else if (!VALID_DIFFICULTIES.has(c['difficulty'] as Difficulty)) {
    pushErr(ctx, `${path}.difficulty`, `非法难度 "${c['difficulty']}"`);
  }
}

// ─── SanityTrigger 校验 ───────────────────────────────

function validateSanityTrigger(t: unknown, path: string, ctx: { issues: ValidationIssue[] }): void {
  if (typeof t !== 'object' || t === null) {
    pushErr(ctx, path, '必须是对象');
    return;
  }
  const s = t as Record<string, unknown>;
  requireString(ctx, s, 'trigger', path);
  if (typeof s['lossOnSuccess'] !== 'number') {
    pushErr(ctx, `${path}.lossOnSuccess`, '必须是数字');
  }
  const lof = s['lossOnFailureRoll'];
  if (typeof lof !== 'number' && typeof lof !== 'string') {
    pushErr(ctx, `${path}.lossOnFailureRoll`, '必须是数字或骰子记法字符串');
  }
}

// ─── NPC 校验 ────────────────────────────────────────

function validateNpc(npc: unknown, path: string, ctx: { issues: ValidationIssue[] }): void {
  if (typeof npc !== 'object' || npc === null) {
    pushErr(ctx, path, 'NPC 必须是对象');
    return;
  }
  const n = npc as Record<string, unknown>;
  requireString(ctx, n, 'id', path);
  requireString(ctx, n, 'name', path);
  requireString(ctx, n, 'persona', path);
}

// ─── helpers ─────────────────────────────────────────

function requireString(ctx: { issues: ValidationIssue[] }, obj: Record<string, unknown>, key: string, parentPath: string): void {
  if (typeof obj[key] !== 'string' || (obj[key] as string).trim() === '') {
    pushErr(ctx, `${parentPath}.${key}`, `必须是非空字符串`);
  }
}

function requireArray(ctx: { issues: ValidationIssue[] }, obj: Record<string, unknown>, key: string, parentPath: string): void {
  if (!Array.isArray(obj[key])) {
    pushErr(ctx, `${parentPath}.${key}`, `必须是数组`);
  }
}

function pushErr(ctx: { issues: ValidationIssue[] }, path: string, message: string): void {
  ctx.issues.push({ path, message, severity: 'error' });
}

function checkSceneRef(ctx: { issues: ValidationIssue[] }, sceneIds: Set<string>, sceneId: string, path: string): void {
  if (!sceneIds.has(sceneId)) {
    pushErr(ctx, path, `指向未定义的场景: "${sceneId}"`);
  }
}

// ─── 加载 JSON 文件 ───────────────────────────────────

/**
 * 从 JSON 字符串加载 + 校验 scenario。
 *
 * @returns 校验通过返回 scenario，失败返回 issues
 */
export function loadScenarioFromJson(
  jsonString: string,
): { ok: true; scenario: Scenario } | { ok: false; issues: ValidationIssue[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    return {
      ok: false,
      issues: [{ path: '$', message: `JSON 解析失败: ${(e as Error).message}`, severity: 'error' }],
    };
  }
  const result = validateScenario(parsed);
  if (!result.valid) return { ok: false, issues: result.issues };
  return { ok: true, scenario: parsed as Scenario };
}
