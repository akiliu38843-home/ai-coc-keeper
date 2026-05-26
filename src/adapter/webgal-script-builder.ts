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
export interface SceneSectionOptions {
  /** 这个 scene 里跑过的 LLM actions（来自 game session）*/
  actions?: ReadonlyArray<LlmAction>;
  /** 场景背景图文件名（如 "library_entrance.webp"），如不填用默认 */
  background?: string;
  /** BGM 文件名 */
  bgm?: string;
  /**
   * 每个 exit 的过渡叙事（小 W8.3 新增）。
   * key: 该 scene exits[] 数组里的 index
   * value: 过渡叙事 actions（通常只 1 个 narrate）
   * 生成 WebGAL 时变成 transition label，玩家选择 → 跳 transition → 过渡叙事 → jumpLabel 到目标 scene
   */
  transitionActions?: Map<number, ReadonlyArray<LlmAction>>;
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

  // 场景描述（如果没有 actions，就只放 description）
  if (!opts.actions || opts.actions.length === 0) {
    lines.push(`${escapeForWebgal(scene.description)};`);
  } else {
    lines.push(...opts.actions.flatMap((a) => actionToWebgalLines(a)));
  }

  // exits → choose（如果有 transitionActions 就跳 transition label 不直接 toScene）
  if (scene.exits && scene.exits.length > 0) {
    const choices = scene.exits
      .map((e, i) => {
        const target = opts.transitionActions?.has(i)
          ? transitionLabelName(scene.id, i)
          : e.toScene;
        return `${escapeForWebgal(e.condition)}:${target}`;
      })
      .join('|');
    lines.push(`choose:${choices};`);

    // 追加 transition label 块
    if (opts.transitionActions) {
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
  }

  return lines.join('\n');
}

function transitionLabelName(fromSceneId: string, exitIndex: number): string {
  return `trans_${fromSceneId}_${exitIndex}`;
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
export function buildScenarioGame(
  scenario: Scenario,
  perSceneActions: Map<string, ReadonlyArray<LlmAction>> = new Map(),
  perSceneTransitions: Map<string, Map<number, ReadonlyArray<LlmAction>>> = new Map(),
): BuildScenarioGameResult {
  // start.txt：直接 jumpLabel 到起点
  const startTxt = [
    `;${scenario.title}`,
    `;${scenario.setting}`,
    `setVar:scenarioId="${scenario.id}";`,
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
      return sceneToWebgalSection(s, opts);
    })
    .join('\n\n');
  sceneFiles.set('scenes', allScenesTxt);

  return { startTxt, sceneFiles };
}
