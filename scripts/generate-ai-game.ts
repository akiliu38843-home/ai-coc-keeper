// 生成 AI 叙事版 WebGAL game
//
// 跟 build-webgal-game.ts 区别：
//   - build-webgal-game: scenario JSON 原描述直接进 WebGAL（无 LLM）
//   - generate-ai-game:  跑 LLM 给每个 scene 写 narrate，预生成嵌入到 WebGAL
//
// 用法：npm run gen:ai-game [<scenario.json>]
// 默认 scenario：src/scenarios/library-demo.json

import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenarioFromJson } from '../src/engine/scenario-validator.js';
import { buildScenarioGame, type InSceneAction } from '../src/adapter/webgal-script-builder.js';
import { buildSceneContext } from '../src/llm/prompts.js';
import { loadCharacter, listCharacters } from '../src/character/save-load.js';
import { skillTotal } from '../src/types/character.js';
import { OpenAICompatibleProvider } from '../src/llm/openai-compatible.js';
import { LlmAdapter, type LlmAction, type SuggestedAction } from '../src/llm/adapter.js';
import { InMemoryNarrativeState } from '../src/engine/in-memory-narrative-state.js';
import { recomputeDerivedStats } from '../src/types/character.js';
import { rollCheck } from '../src/engine/skill-check.js';
import { rollSanityCheck } from '../src/engine/sanity.js';
import { rollInsanity } from '../src/engine/insanity-tables.js';
import { applyDamage } from '../src/engine/damage.js';
import { rollDice } from '../src/engine/dice.js';
import { DefaultRng, type Rng } from '../src/engine/rng.js';
import type { Character } from '../src/types/character.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const WEBGAL_SCENE_DIR = join(
  PROJECT_ROOT,
  'external/WebGAL/packages/webgal/public/game/scene',
);

const args = process.argv.slice(2);
const scenarioPath = resolve(
  args[0] ?? join(PROJECT_ROOT, 'src/scenarios/library-demo.json'),
);
// 可选 --character <id>，不传就用默认 makeChar()
let charIdArg: string | null = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--character' && args[i + 1]) charIdArg = args[++i]!;
}

const baseUrl = process.env['LLM_BASE_URL'];
const apiKey = process.env['LLM_API_KEY'];
const model = process.env['LLM_MODEL'] ?? 'gpt-5.4-mini';
if (!baseUrl || !apiKey) {
  console.error('❌ 缺 LLM_BASE_URL / LLM_API_KEY');
  process.exit(1);
}

/**
 * V0 fallback: 用默认技能值表（character 没传时用）
 * 当 character 传入时优先用 character.skills 的真实 total
 */
function skillTargetFallback(skill: string): number {
  const presets: Record<string, number> = {
    spot_hidden: 60, listen: 50, library_use: 70, psychology: 50,
    locksmith: 30, dodge: 30, brawl: 60, sneak: 40, stealth: 40,
    persuade: 50, fast_talk: 40, charm: 40, intimidate: 40,
    climb: 40, first_aid: 50, medicine: 30, occult: 30,
    drive_auto: 30, language_own: 80, language_other: 20,
    track: 30, jump: 25, swim: 25, throw: 25,
  };
  return presets[skill] ?? 40;
}

/** 用真实角色卡读 skill total，没有就回退到默认表 */
function skillTargetFromCharacter(char: Character | null, skill: string): number {
  if (char) {
    const sk = char.skills.get(skill);
    if (sk) return skillTotal(sk);
  }
  return skillTargetFallback(skill);
}

function makeChar(): Character {
  const c: Character = {
    id: 'demo', name: '林夏', occupation: '记者', age: 28,
    attributes: { STR: 50, DEX: 60, INT: 80, CON: 60, POW: 70, APP: 60, SIZ: 55, EDU: 80 },
    maxHp: 0, maxMp: 0, maxSanity: 0,
    currentHp: 0, currentMp: 0, currentSanity: 0,
    luck: 60, movement: 0, dodge: 0, brawl: 0,
    skills: new Map(), inventory: [], conditions: [],
  };
  recomputeDerivedStats(c);
  c.currentHp = c.maxHp; c.currentMp = c.maxMp; c.currentSanity = c.maxSanity;
  return c;
}

async function backupIfNeeded(path: string): Promise<void> {
  const backup = `${path}.original`;
  try { await access(backup); } catch {
    try { await access(path); await copyFile(path, backup); console.log(`📁 备份 → ${backup}`); }
    catch { /* nothing to backup */ }
  }
}

async function main(): Promise<void> {
  console.log(`📖 加载 scenario: ${scenarioPath}`);
  const json = await readFile(scenarioPath, 'utf-8');
  const loaded = loadScenarioFromJson(json);
  if (!loaded.ok) {
    console.error('❌ Scenario 校验失败:');
    loaded.issues.forEach((i) => console.error(`   ${i.path}: ${i.message}`));
    process.exit(1);
  }
  const scenario = loaded.scenario;
  console.log(`   《${scenario.title}》 · ${scenario.scenes.length} 场景\n`);

  const provider = new OpenAICompatibleProvider({
    baseUrl: baseUrl!, apiKey: apiKey!, model, timeoutMs: 60_000,
  });

  // 加载 character: 优先用 --character <id>，否则找最近一个 saved，否则默认
  let char: Character;
  if (charIdArg) {
    try {
      char = await loadCharacter(charIdArg);
      console.log(`👤 已加载角色: ${char.name} (${char.occupation})`);
    } catch (e) {
      console.error(`❌ 加载角色 ${charIdArg} 失败: ${(e as Error).message}`);
      process.exit(1);
    }
  } else {
    // 试找最近 saved character
    try {
      const list = await listCharacters();
      if (list.length > 0) {
        char = await loadCharacter(list[0]!.id);
        console.log(`👤 自动选最近角色: ${char.name} (${char.occupation})`);
      } else {
        char = makeChar();
        console.log(`👤 无 saved 角色, 用默认: ${char.name} (${char.occupation})`);
      }
    } catch {
      char = makeChar();
    }
  }
  // 跨 scene 状态追踪: rng 提到外层, 循环里复用同一份 char (currentSanity 会被 mutate)
  const rng: Rng = new DefaultRng();
  // COC 7e 规则: "单日累计损失 ≥ 1/5 maxSanity" → 长期心智失常
  // V0 简化: 整本剧本作为"一日", 累计 >= maxSanity/5 触发 (且只触发一次)
  let sanityLossAccum = 0;
  const indefThreshold = Math.floor(char.maxSanity / 5);
  let indefTriggered = char.conditions.some((c) => c.type === 'indef_insanity');
  const perSceneActions = new Map<string, LlmAction[]>();
  const perSceneTransitions = new Map<string, Map<number, LlmAction[]>>();
  const perSceneInScene = new Map<string, InSceneAction[]>();

  /** 统一处理 HP 伤害: 返回 badge 字符串. */
  function applyHpDamage(dmgSpec: number | string, reason: string, physical = true): string {
    const amount = typeof dmgSpec === 'number' ? dmgSpec : rollDice(dmgSpec, rng);
    if (amount <= 0) return '';
    const result = applyDamage(char, { amount, source: reason, physical });
    let badge = `[HP -${result.actualDamage} → ${char.currentHp}/${char.maxHp}]`;
    if (result.triggeredConditions.includes('major_wound')) badge += ' [重伤]';
    if (result.triggeredConditions.includes('unconscious')) badge += ' [昏迷]';
    if (result.triggeredConditions.includes('dying')) badge += ' [濒死]';
    return badge;
  }

  /** 统一处理 sanity 损失: 累计 / 临时 / 长期触发. 返回 badge 字符串. */
  function applySanity(actualLoss: number, reason: string): string {
    if (actualLoss <= 0) return '';
    char.currentSanity = Math.max(0, char.currentSanity - actualLoss);
    sanityLossAccum += actualLoss;
    let badge = `[心智 -${actualLoss} → ${char.currentSanity}/${char.maxSanity}]`;
    // 单次 >= 5 → 临时心智失常
    if (actualLoss >= 5 && !char.conditions.some((c) => c.type === 'temp_insanity')) {
      char.conditions.push({ type: 'temp_insanity', source: reason, appliedAt: Date.now() });
      badge += ' [临时心智失常]';
    }
    // 累计 >= maxSanity/5 → 长期心智失常 (只触发一次, 从 100 项表 roll)
    if (!indefTriggered && sanityLossAccum >= indefThreshold) {
      indefTriggered = true;
      const insanity = rollInsanity(rng);
      const tag = insanity.kind === 'phobia' ? '恐惧症' : '狂躁症';
      badge += ` [长期失常: ${tag}《${insanity.entry.nameZh}》— ${insanity.entry.description}]`;
      char.conditions.push({
        type: 'indef_insanity',
        source: reason,
        appliedAt: Date.now(),
        insanityDetail: {
          kind: insanity.kind,
          id: insanity.entry.id,
          nameZh: insanity.entry.nameZh,
          nameEn: insanity.entry.nameEn,
          description: insanity.entry.description,
        },
      });
    }
    return badge;
  }

  // 每个 scene: 1) enterScene 拿主叙事 2) 每个 exit 跑 narrateTransition
  for (let i = 0; i < scenario.scenes.length; i++) {
    const scene = scenario.scenes[i]!;
    console.log(`[${i + 1}/${scenario.scenes.length}] LLM: ${scene.id} · ${scene.name}`);
    const adapter = new LlmAdapter({ provider });
    const ns = new InMemoryNarrativeState({ startSceneId: scene.id });

    // 1) 场景主叙事
    try {
      const action = await adapter.enterScene({
        scenario: { id: scenario.id, title: scenario.title, setting: scenario.setting },
        scene: {
          id: scene.id,
          name: scene.name,
          description: scene.description,
          hints: scene.hints ?? [],
          expectedChecks: (scene.expectedChecks ?? []).map((c) => ({
            skill: c.skill, difficulty: c.difficulty, reason: c.reason,
          })),
        },
        character: char,
        narrative: ns,
      });
      // 1b) 处理 scene.sanityTriggers（作者埋的"进场就触发"恐怖点）
      const triggerBadges: string[] = [];
      for (const trigger of (scene.sanityTriggers ?? [])) {
        const sanResult = rollSanityCheck({
          currentSanity: char.currentSanity,
          lossOnSuccess: trigger.lossOnSuccess,
          lossOnFailureRoll: trigger.lossOnFailureRoll,
          reason: trigger.trigger,
        }, rng);
        const badge = applySanity(sanResult.actualLoss, trigger.trigger);
        if (badge) triggerBadges.push(badge);
      }
      // 把 trigger badges 拼到主 narrate 后
      let narrateWithBadges = action;
      if (triggerBadges.length > 0 && (action.type === 'narrate' || action.type === 'dialogue')) {
        narrateWithBadges = { ...action, text: `${action.text} ${triggerBadges.join(' ')}` };
      }
      perSceneActions.set(scene.id, [narrateWithBadges]);
      console.log(`    ✓ enterScene · ${action.type} (${(action.text ?? '').slice(0, 40)}...)${triggerBadges.length > 0 ? ` + ${triggerBadges.length} sanity 触发` : ''}`);
    } catch (e) {
      console.warn(`    ⚠ enterScene 失败, 回退原描述: ${(e as Error).message.slice(0, 80)}`);
    }

    // 2) AI 建议行动（in-scene actions, 不跳 scene）
    try {
      const sceneContext = buildSceneContext({
        scenario: { id: scenario.id, title: scenario.title, setting: scenario.setting },
        scene: { id: scene.id, name: scene.name, description: scene.description, hints: scene.hints ?? [] },
        character: char,
        narrative: ns,
      });
      const suggested = await adapter.suggestActions({ sceneContext, count: 4 });
      // 把 SuggestedAction 转成 InSceneAction (含 check 的丢骰, sanityCost 处理)
      const resolved: InSceneAction[] = suggested.map((a: SuggestedAction) => {
        // 1) 先处理 check 型 vs simple 型, 拿到 baseNarrate
        let baseNarrate: string;
        let skillBadge = '';
        let checkSucceeded = true; // simple 型默认"过"
        if (a.kind === 'check') {
          const target = skillTargetFromCharacter(char, a.check.skill);
          const result = rollCheck({ target, difficulty: a.check.difficulty }, rng);
          checkSucceeded = result.succeeded;
          const skillName = char.skills.get(a.check.skill)?.name ?? a.check.skill;
          skillBadge = `[${skillName} ${result.roll}/${result.effectiveTarget} ${result.outcome}]`;
          baseNarrate = result.succeeded ? a.successNarrate : a.failNarrate;
        } else {
          baseNarrate = a.resultNarrate;
        }

        // 2a) 处理可选的 sanityCost
        let sanityBadge = '';
        if (a.sanityCost) {
          const sanResult = rollSanityCheck({
            currentSanity: char.currentSanity,
            lossOnSuccess: a.sanityCost.onSuccess,
            lossOnFailureRoll: a.sanityCost.onFailure,
            reason: a.label,
          }, rng);
          const badge = applySanity(sanResult.actualLoss, a.label);
          if (badge) sanityBadge = ' ' + badge;
        }

        // 2b) 处理可选的 damageCost
        let damageBadge = '';
        if (a.damageCost) {
          // 通过 check 取 onSuccess (闪避成功仍可能小伤), 否则 onFailure
          const dmgSpec = checkSucceeded ? a.damageCost.onSuccess : a.damageCost.onFailure;
          const badge = applyHpDamage(dmgSpec, a.label, a.damageCost.physical ?? true);
          if (badge) damageBadge = ' ' + badge;
        }

        const fullBadge = skillBadge + sanityBadge + damageBadge;
        const prefix = fullBadge.trim() ? `${fullBadge.trim()} ` : '';
        // 防双空格 + 用 checkSucceeded 抑制 lint 警告
        void checkSucceeded;
        return { label: a.label, resultNarrate: `${prefix}${baseNarrate}` };
      });
      if (resolved.length > 0) {
        perSceneInScene.set(scene.id, resolved);
        const checkCount = suggested.filter(a => a.kind === 'check').length;
        console.log(`    ✓ 建议行动 ${resolved.length} 个 (${checkCount} 个含检定): ${resolved.map(s => s.label).join(' / ')}`);
      }
    } catch (e) {
      console.warn(`    ⚠ suggestActions 失败: ${(e as Error).message.slice(0, 60)}`);
    }
    await new Promise((r) => setTimeout(r, 300));

    // 3) 每个 exit 的过渡叙事
    if (scene.exits && scene.exits.length > 0) {
      const sceneTrans = new Map<number, LlmAction[]>();
      for (const [exitIdx, exit] of scene.exits.entries()) {
        try {
          const transAction = await adapter.narrateTransition({
            fromScene: scene.id,
            toScene: exit.toScene,
            choiceText: exit.condition,
          });
          sceneTrans.set(exitIdx, [transAction]);
          console.log(`    ✓ exit[${exitIdx}] "${exit.condition.slice(0, 25)}" → ${exit.toScene}`);
        } catch (e) {
          console.warn(`    ⚠ exit[${exitIdx}] transition 失败: ${(e as Error).message.slice(0, 60)}`);
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      if (sceneTrans.size > 0) perSceneTransitions.set(scene.id, sceneTrans);
    }
  }

  console.log(`\n🔨 构建 WebGAL game...`);
  const built = buildScenarioGame(scenario, perSceneActions, perSceneTransitions, perSceneInScene, { character: char });

  const startTxtPath = join(WEBGAL_SCENE_DIR, 'start.txt');
  await backupIfNeeded(startTxtPath);
  const fullContent = `${built.startTxt}\n\n${built.sceneFiles.get('scenes')}`;
  await writeFile(startTxtPath, fullContent, 'utf-8');
  console.log(`✏️  写入 ${startTxtPath}`);
  console.log(`   ${fullContent.length} 字符 · ${perSceneActions.size}/${scenario.scenes.length} 场景含 AI 叙事`);
  console.log(`\n✅ 完成 · 浏览器刷新 http://localhost:3000/ 看效果`);
}

await main().catch((e: unknown) => {
  console.error('❌ 异常:', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
