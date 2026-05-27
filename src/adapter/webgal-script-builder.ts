// WebGAL Script Builder —— 把我们的 LlmAction[] / Scene 转成 WebGAL Script .txt
//
// WebGAL DSL 关键命令 (参考 packages/webgal/public/game/scene/demo_zh_cn.txt):
//   - changeBg:file.webp -next;          切换背景
//   - bgm:music.mp3 -volume=80;          BGM
//   - changeFigure:stand.webp -left;     切换立绘
//   - Speaker:对话;                       Speaker 说话
//   - 旁白文本;                           (无 speaker 前缀)
//   - choose:选项 A:label_a|选项 B:label_b;  选择支跳 label
//   - label:xxx;                          跳转标签
//   - jumpLabel:xxx;                      跳到 label
//   - setTransition: -target=bg-main -enter=shockwaveIn -next;  过场
//   - getUserInput:name -title=如何称呼你; 拿玩家输入
//   - end;                                 结束游戏（不必须）
//   - ;注释                                注释
//
// 我们的映射策略：
//   - 每个 Scene → 一个 label
//   - LlmAction[narrate/dialogue] → 文本行
//   - LlmAction[request_check] → 注释 + UI 待补（V0 不在 WebGAL 里丢骰子，仍由引擎）
//   - LlmAction[jump_scene]   → jumpLabel:<scene_id>;
//   - LlmAction[set_flag]     → setVar:<flag>=<val>;
//   - Scene.exits             → 转 choose: 命令

import type { LlmAction } from '../llm/adapter.js';
import type { Scene, Scenario } from '../types/scenario.js';
import type { Character } from '../types/character.js';
import { skillTotal } from '../types/character.js';

// ─── 字符串转义（WebGAL 不爱 ; 和 : ) ─────────────────

/**
 * WebGAL 文本里出现 ; / : / | 会被当 DSL 分隔符。
 * 转义：将这些字符替换为全角等价物，或用 \ 转义。
 * V0 用全角替代（最稳）。
 */
export function escapeForWebgal(text: string): string {
  return text
    .replace(/;/g, '；')
    .replace(/:/g, '：')
    .replace(/\|/g, '｜')
    .replace(/\r/g, '')
    .replace(/\n/g, ' '); // 单行 DSL，多行折成一行
}

// ─── 单个 LlmAction → WebGAL 行 ──────────────────────

export function actionToWebgalLines(action: LlmAction): string[] {
  const lines: string[] = [];
  switch (action.type) {
    case 'narrate':
      lines.push(`${escapeForWebgal(action.text)};`);
      break;

    case 'dialogue':
      lines.push(`${escapeForWebgal(action.speaker)}:${escapeForWebgal(action.text)};`);
      break;

    case 'request_check':
      // V0：检定由引擎处理，这里只标记给后续 adapter 用
      lines.push(`;[check] skill=${action.skill} difficulty=${action.difficulty}`);
      lines.push(`${escapeForWebgal(action.text)};`);
      lines.push(`;[/check] rationale=${escapeForWebgal(action.rationale)}`);
      break;

    case 'jump_scene':
      if (action.text) lines.push(`${escapeForWebgal(action.text)};`);
      lines.push(`jumpLabel:${action.toScene};`);
      break;

    case 'set_flag':
      // WebGAL setVar 只支持数字/字符串/布尔，字符串需引号
      let valLiteral: string;
      if (typeof action.value === 'boolean') valLiteral = action.value ? 'true' : 'false';
      else if (typeof action.value === 'number') valLiteral = String(action.value);
      else valLiteral = `"${escapeForWebgal(action.value)}"`;
      lines.push(`setVar:${action.flag}=${valLiteral};`);
      if (action.text) lines.push(`${escapeForWebgal(action.text)};`);
      break;
  }
  return lines;
}

// ─── 一组 actions → script 片段 ─────────────────────

export function actionsToWebgalScript(actions: ReadonlyArray<LlmAction>): string {
  return actions.flatMap((a) => actionToWebgalLines(a)).join('\n');
}

// ─── Scene → label section (含 exits choose) ─────────

/**
 * 把一个 Scene 翻译成一段 WebGAL script：
 *   label:<scene.id>;
 *   <场景描述>;
 *   ... (actions)
 *   choose:<exit1>:<scene>|<exit2>:<scene>;
 */
export interface InSceneAction {
  /** 按钮文字（≤ 8 字）*/
  label: string;
  /** 点选后 AI 叙事 */
  resultNarrate: string;
}

export interface SceneSectionOptions {
  /** 这个 scene 里跑过的 LLM actions（来自 game session）*/
  actions?: ReadonlyArray<LlmAction>;
  /** 场景背景图文件名（如 "library_entrance.webp"），如不填用默认 */
  background?: string;
  /** BGM 文件名 */
  bgm?: string;
  /**
   * 每个 exit 的过渡叙事（W8.3-mini）。
   * key: 该 scene exits[] 数组里的 index
   * value: 过渡叙事 actions（通常只 1 个 narrate）
   * 生成 WebGAL 时变成 transition label，玩家选择 → 跳 transition → 过渡叙事 → jumpLabel 到目标 scene
   */
  transitionActions?: Map<number, ReadonlyArray<LlmAction>>;
  /**
   * AI 在场景内建议的行动（W8.3-AI）。
   * 玩家点选 → 看到 resultNarrate → 回到该 scene 的选项菜单（不跳 scene）
   */
  inSceneActions?: ReadonlyArray<InSceneAction>;
}

export function sceneToWebgalSection(
  scene: Scene,
  opts: SceneSectionOptions = {},
): string {
  const lines: string[] = [`label:${scene.id};`];

  // 背景 / BGM
  if (opts.background ?? scene.background) {
    lines.push(`changeBg:${opts.background ?? scene.background} -next;`);
  }
  if (opts.bgm ?? scene.bgm) {
    lines.push(`bgm:${opts.bgm ?? scene.bgm};`);
  }

  // 场景主叙事
  if (!opts.actions || opts.actions.length === 0) {
    lines.push(`${escapeForWebgal(scene.description)};`);
  } else {
    lines.push(...opts.actions.flatMap((a) => actionToWebgalLines(a)));
  }

  const hasExits = scene.exits && scene.exits.length > 0;
  const hasInScene = opts.inSceneActions && opts.inSceneActions.length > 0;

  if (!hasExits && !hasInScene) {
    return lines.join('\n');
  }

  // 选项菜单 label（行动后 loop 回这里）
  const choicesLabel = `${scene.id}_choices`;
  lines.push('');
  lines.push(`label:${choicesLabel};`);

  // 拼 choose 命令：先 in-scene actions，后 exits
  const choiceParts: string[] = [];
  if (opts.inSceneActions) {
    opts.inSceneActions.forEach((a, i) => {
      choiceParts.push(`${escapeForWebgal(a.label)}:${inSceneActionLabelName(scene.id, i)}`);
    });
  }
  if (scene.exits) {
    scene.exits.forEach((e, i) => {
      const target = opts.transitionActions?.has(i)
        ? transitionLabelName(scene.id, i)
        : e.toScene;
      choiceParts.push(`${escapeForWebgal(e.condition)}:${target}`);
    });
  }
  lines.push(`choose:${choiceParts.join('|')};`);

  // in-scene action labels（loop back）
  if (opts.inSceneActions) {
    for (const [i, action] of opts.inSceneActions.entries()) {
      lines.push('');
      lines.push(`label:${inSceneActionLabelName(scene.id, i)};`);
      lines.push(`${escapeForWebgal(action.resultNarrate)};`);
      lines.push(`jumpLabel:${choicesLabel};`);
    }
  }

  // exit transition labels（跳到下个 scene）
  if (scene.exits && opts.transitionActions) {
    for (const [i, exit] of scene.exits.entries()) {
      const transActs = opts.transitionActions.get(i);
      if (transActs && transActs.length > 0) {
        lines.push('');
        lines.push(`label:${transitionLabelName(scene.id, i)};`);
        lines.push(...transActs.flatMap((a) => actionToWebgalLines(a)));
        lines.push(`jumpLabel:${exit.toScene};`);
      }
    }
  }

  return lines.join('\n');
}

function transitionLabelName(fromSceneId: string, exitIndex: number): string {
  return `trans_${fromSceneId}_${exitIndex}`;
}

/**
 * 游戏开场 intro 段：显示剧本标题 / 设定 + 玩家角色信息
 * 返回 WebGAL 行数组（不带 label 包裹，调用方拼到 startTxt 里）
 */
function buildIntroSection(scenario: Scenario, character?: Character): string[] {
  const lines: string[] = [];

  // 标题 + 设定
  lines.push(`旁白:${escapeForWebgal(`《${scenario.title}》`)} -fontSize=large;`);
  lines.push(`旁白:${escapeForWebgal(scenario.setting)};`);

  // 角色卡信息
  if (character) {
    const gender = character.gender ? ` (${character.gender})` : '';
    lines.push(`旁白:${escapeForWebgal(
      `你将扮演 —— ${character.name}${gender}，${character.age} 岁，${character.occupation}。`,
    )};`);

    // 派生属性快报
    lines.push(`旁白:${escapeForWebgal(
      `HP ${character.currentHp}/${character.maxHp}  |  心智度 ${character.currentSanity}/${character.maxSanity}  |  幸运 ${character.luck}`,
    )};`);

    // 主要技能（前 5 个非零 occupational）
    const topSkills = Array.from(character.skills.values())
      .filter((s) => s.occupational > 0)
      .sort((a, b) => skillTotal(b) - skillTotal(a))
      .slice(0, 5);
    if (topSkills.length > 0) {
      const skillText = topSkills.map((s) => `${s.name} ${skillTotal(s)}`).join('  ');
      lines.push(`旁白:${escapeForWebgal(`主要技能 —— ${skillText}`)};`);
    }

    lines.push(`旁白:${escapeForWebgal('深呼吸，你将独自面对接下来的一切。')};`);
  }

  return lines;
}

function inSceneActionLabelName(sceneId: string, actionIndex: number): string {
  return `act_${sceneId}_${actionIndex}`;
}

// ─── Scenario → 完整 game 目录布局 ─────────────────────

export interface BuildScenarioGameResult {
  /** start.txt 内容（WebGAL 入口）*/
  startTxt: string;
  /** 每个 scene 的 .txt 内容（key 是 sceneId）*/
  sceneFiles: Map<string, string>;
}

/**
 * 把整个 Scenario 转成 WebGAL game 文件布局。
 *
 * 落盘策略（由调用方决定）：
 *   public/game/scene/start.txt
 *   public/game/scene/<sceneId>.txt
 */
export interface BuildScenarioGameInputOptions {
  /** 把角色信息显示在游戏开场（W10 新增）*/
  character?: Character;
}

export function buildScenarioGame(
  scenario: Scenario,
  perSceneActions: Map<string, ReadonlyArray<LlmAction>> = new Map(),
  perSceneTransitions: Map<string, Map<number, ReadonlyArray<LlmAction>>> = new Map(),
  perSceneInSceneActions: Map<string, ReadonlyArray<InSceneAction>> = new Map(),
  opts: BuildScenarioGameInputOptions = {},
): BuildScenarioGameResult {
  // start.txt：开场 intro → jumpLabel 到起点
  const introLines = buildIntroSection(scenario, opts.character);
  const startTxt = [
    `;${scenario.title}`,
    `;${scenario.setting}`,
    `setVar:scenarioId="${scenario.id}";`,
    ...introLines,
    `jumpLabel:${scenario.startSceneId};`,
  ].join('\n');

  // 所有 scenes 写到一个文件里（用 label 区分），简化 routing
  const sceneFiles = new Map<string, string>();
  const allScenesTxt = scenario.scenes
    .map((s) => {
      const opts: SceneSectionOptions = {};
      const actions = perSceneActions.get(s.id);
      if (actions !== undefined) opts.actions = actions;
      const trans = perSceneTransitions.get(s.id);
      if (trans !== undefined) opts.transitionActions = trans;
      const inScene = perSceneInSceneActions.get(s.id);
      if (inScene !== undefined) opts.inSceneActions = inScene;
      return sceneToWebgalSection(s, opts);
    })
    .join('\n\n');
  sceneFiles.set('scenes', allScenesTxt);

  return { startTxt, sceneFiles };
}
