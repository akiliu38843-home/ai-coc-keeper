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
import type { Scene, Scenario, SceneMood } from '../types/scenario.js';
import type { Character } from '../types/character.js';
import { skillTotal } from '../types/character.js';

/**
 * 按 mood 选择默认 BGM 文件名。
 * V0 文件不一定都存在，玩家可往 external/WebGAL/.../public/game/bgm/ 自己加。
 * 默认 fallback 是 WebGAL 自带的 s_Title.mp3（一定存在）。
 */
export function defaultBgmForMood(mood: SceneMood | undefined): string {
  switch (mood) {
    case 'calm':    return 'mood_calm.mp3';
    case 'mystery': return 'mood_mystery.mp3';
    case 'tension': return 'mood_tension.mp3';
    case 'horror':  return 'mood_horror.mp3';
    case 'climax':  return 'mood_climax.mp3';
    case 'ending':  return 'mood_ending.mp3';
    default:        return 's_Title.mp3';
  }
}

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

/**
 * 把一段叙事 / 对话拆成多条 "页", 每条变成 WebGAL 独立的一行 (玩家点击推进).
 *
 * 策略:
 *   1. 先按中文 / 英文句号 / 问号 / 感叹号断句, 保留标点
 *   2. 单句仍超过 maxLen (默认 42 字) 时, 在句中最后一个 ，/ 、/ ；/ ;/ ,/ — 处再切一刀
 *   3. trim, 去掉空段
 *
 * 这样 LLM 写得再长, 文字框也不会被切掉 —— 每页都能完整看完, 玩家点一下翻下一页.
 */
// 单页字符上限. 设小一点宁可多翻几页, 也不让任何一页溢出文字框.
// 经验值: 30 中文字符 ≈ 文字框 1-2 行, 永远不会到第 3 行触底.
const MAX_PAGE_LEN = 30;

/**
 * 把一段长 narrate / dialogue 切成多页 (WebGAL 一行一页, 玩家点击推进).
 *
 * 规则 (按优先级):
 *   1. 先按句号 / 问号 / 感叹号断句, 保留标点 (这一步保证每页至少是完整句)
 *   2. 单句仍 > maxLen 时, 在 maxLen 窗口内最后一个 ，/ 、/ ；/ — 处再切
 *   3. 没有任何可切点 (一句话没有逗号) —— **保持原句完整**, 哪怕超过 maxLen.
 *      宁可让单页字数多一点, 也绝不在词中间硬切.
 *      ↑ 这条是 2026-05-28 老板提醒的: "保证每个至少是一个完整的句子"
 */
export function splitIntoPages(text: string, maxLen: number = MAX_PAGE_LEN): string[] {
  if (!text) return [];
  const sentences = text
    .split(/(?<=[。！？!?])(?=\s*\S)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const pages: string[] = [];
  for (const sent of sentences) {
    if (sent.length <= maxLen) { pages.push(sent); continue; }
    let remaining = sent;
    let progressed = true;
    while (progressed && remaining.length > maxLen) {
      const window = remaining.slice(0, maxLen);
      const cutMatch = window.match(/^(.*[，、；,—])([^，、；,—]*)$/);
      if (cutMatch && cutMatch[1] && cutMatch[1].length > 0) {
        pages.push(cutMatch[1].trim());
        remaining = (cutMatch[2] + remaining.slice(maxLen)).trim();
      } else {
        // ★ 没有可切点 — 不硬切, 让剩余整句作为单页输出, break.
        progressed = false;
      }
    }
    if (remaining.length > 0) pages.push(remaining);
  }
  return pages;
}

/** 把一段叙事文本转成多条 WebGAL narrate 行 (旁白模式, 无 speaker 前缀). */
export function narrateTextToLines(text: string): string[] {
  return splitIntoPages(text).map((p) => `${escapeForWebgal(p)};`);
}

/** 把一段对话转成多条 WebGAL dialogue 行, speaker 在每页前都重复出现. */
export function dialogueTextToLines(speaker: string, text: string): string[] {
  const esc = escapeForWebgal(speaker);
  return splitIntoPages(text).map((p) => `${esc}:${escapeForWebgal(p)};`);
}

// ─── 单个 LlmAction → WebGAL 行 ──────────────────────

export function actionToWebgalLines(action: LlmAction): string[] {
  const lines: string[] = [];
  switch (action.type) {
    case 'narrate':
      lines.push(...narrateTextToLines(action.text));
      break;

    case 'dialogue':
      lines.push(...dialogueTextToLines(action.speaker, action.text));
      break;

    case 'request_check':
      // V0：检定由引擎处理，这里只标记给后续 adapter 用
      lines.push(`;[check] skill=${action.skill} difficulty=${action.difficulty}`);
      lines.push(...narrateTextToLines(action.text));
      lines.push(`;[/check] rationale=${escapeForWebgal(action.rationale)}`);
      break;

    case 'jump_scene':
      if (action.text) lines.push(...narrateTextToLines(action.text));
      lines.push(`jumpLabel:${action.toScene};`);
      break;

    case 'set_flag':
      // WebGAL setVar 只支持数字/字符串/布尔，字符串需引号
      let valLiteral: string;
      if (typeof action.value === 'boolean') valLiteral = action.value ? 'true' : 'false';
      else if (typeof action.value === 'number') valLiteral = String(action.value);
      else valLiteral = `"${escapeForWebgal(action.value)}"`;
      lines.push(`setVar:${action.flag}=${valLiteral};`);
      if (action.text) lines.push(...narrateTextToLines(action.text));
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
  /** label 前缀（多剧本 launcher 时用，避免不同 scenario 间 label 冲突）*/
  labelPrefix?: string;
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
  /**
   * 这个 scene 在剧本里的序号（从 1 开始），用于章节卡 intro。
   * 不传则不显示"第 N 幕"前缀。
   */
  sceneIndex?: number;
  /**
   * V2 (death L1): gen-time 算好的"该场景结束时玩家状态".
   * builder 在主 narrate 末尾插 setVar 同步给 WebGAL, 后面用 -when=currentHp<=0
   * 等条件跳转触发 bad_end.
   *
   * 不传则 builder 不插任何 setVar, 死亡判定不会触发 (兼容老路径).
   */
  stateAfterScene?: {
    currentHp: number;
    currentSanity: number;
    maxHp: number;
    maxSanity: number;
  };
  /**
   * V2 (death L1): bad_end label 名 (调用方决定).
   * 设了, builder 会在 stateAfterScene 之后插 2 个条件 jumpLabel:
   *   jumpLabel:<deadEndLabel> -when=currentHp<=0;
   *   jumpLabel:<madEndLabel> -when=currentSanity<=0;
   * 没设则不插 (兼容老路径).
   */
  deadEndLabel?: string;
  madEndLabel?: string;
  /**
   * 终结场景（无 exits）追加一个"出口选项"，跳到指定 label。
   *
   *   { buttonLabel: '结束这段旅程', target: 'journey_recap' }
   *
   * 不传则保持默认: terminal scene 走完 narrate 自然 fall through
   * 到文件下一行 (适合 builder 调用方在外部追加 recap label).
   * 传了则插一个 choose 按钮让玩家"主动收尾".
   */
  terminalExit?: { buttonLabel: string; target: string };
}

const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function toChineseDigit(n: number): string {
  if (n <= 10) return CHINESE_DIGITS[n] ?? String(n);
  if (n < 20) return `十${CHINESE_DIGITS[n - 10]}`;
  return String(n);
}

/**
 * mood → intro 卡片字体颜色 (RGBA)。
 * 配色跟 userStyleSheet.css 的 --cthk-* 调色板对齐：
 *   calm/mystery → 旧纸黄 (#d8c9a6)
 *   tension      → 暖琥珀 (#dcb46e)
 *   horror/climax → 暗血红 (#c44537)
 *   ending       → 灰烬 (#a89578)
 */
function moodIntroColor(mood: SceneMood | undefined): string {
  switch (mood) {
    case 'tension':         return 'rgba(220, 180, 110, 1)';
    case 'horror':
    case 'climax':          return 'rgba(196, 69, 55, 1)';
    case 'ending':          return 'rgba(168, 149, 120, 1)';
    case 'calm':
    case 'mystery':
    default:                return 'rgba(216, 201, 166, 1)';
  }
}

/**
 * 生成 scene 开场的 intro 章节卡。
 * 形式: `intro:第 X 幕|<scene.name> -animation=fadeIn -delayTime=2200 -fontColor=... -fontSize=medium;`
 *   - 用 fadeIn 动画 (1.5s 淡入)
 *   - 每行 delayTime=2200ms, 2 行总停留约 4.4s + endWait 1s ≈ 5.4s
 *   - 玩家点击可提前推进
 */
function buildSceneIntroLine(scene: Scene, sceneIndex: number | undefined): string | null {
  if (sceneIndex === undefined) return null;
  const actLabel = `第 ${toChineseDigit(sceneIndex)} 幕`;
  const subtitle = escapeForWebgal(scene.name);
  const color = moodIntroColor(scene.mood);
  return `intro:${actLabel}|${subtitle} -animation=fadeIn -delayTime=2200 -fontColor=${color} -fontSize=medium;`;
}

/** 加 prefix 到 label name（避免多 scenario 冲突）*/
function pfx(name: string, prefix?: string): string {
  return prefix ? `${prefix}__${name}` : name;
}

/**
 * choose 按钮文字硬上限. WebGAL 按钮宽度有限,
 * 实测中文 ≥ 14 字会触发可见的右侧 truncate.
 * 已经是经验值, 老板被截字提醒过 3 次. 不要再上调.
 */
const MAX_CHOICE_LABEL_LEN = 14;
export function truncateChoiceLabel(label: string, maxLen: number = MAX_CHOICE_LABEL_LEN): string {
  if (label.length <= maxLen) return label;
  return label.slice(0, maxLen - 1) + '…';
}

export function sceneToWebgalSection(
  scene: Scene,
  opts: SceneSectionOptions = {},
): string {
  const p = opts.labelPrefix;
  const lines: string[] = [`label:${pfx(scene.id, p)};`];

  // 章节卡 (intro): 黑底淡入 "第 X 幕" + scene 名, 强化"翻页"感
  const introLine = buildSceneIntroLine(scene, opts.sceneIndex);
  if (introLine) lines.push(introLine);

  // 背景 / BGM
  if (opts.background ?? scene.background) {
    lines.push(`changeBg:${opts.background ?? scene.background} -next;`);
  }
  // BGM 优先级: opts.bgm > scene.bgm > scene.mood 派生
  const bgmFile = opts.bgm ?? scene.bgm ?? (scene.mood ? defaultBgmForMood(scene.mood) : undefined);
  if (bgmFile) {
    // -volume=60 让叙事文字比 BGM 突出, -enter=2000 渐入
    lines.push(`bgm:${bgmFile} -volume=60 -enter=2000;`);
  }

  // 场景主叙事
  if (!opts.actions || opts.actions.length === 0) {
    lines.push(...narrateTextToLines(scene.description));
  } else {
    lines.push(...opts.actions.flatMap((a) => actionToWebgalLines(a)));
  }

  // V2 (death L1): 主叙事后同步玩家状态到 WebGAL 变量 + 死亡判定
  // gen-time 算好的 currentHp / currentSanity 写进 setVar, 然后用 -when= 条件跳
  // jumpLabel 触发对应 bad_end intro 卡, 整本 game over.
  if (opts.stateAfterScene) {
    const s = opts.stateAfterScene;
    lines.push(`setVar:currentHp=${s.currentHp};`);
    lines.push(`setVar:currentSanity=${s.currentSanity};`);
    lines.push(`setVar:maxHp=${s.maxHp};`);
    lines.push(`setVar:maxSanity=${s.maxSanity};`);
    if (opts.deadEndLabel) {
      lines.push(`jumpLabel:${opts.deadEndLabel} -when=currentHp<=0;`);
    }
    if (opts.madEndLabel) {
      lines.push(`jumpLabel:${opts.madEndLabel} -when=currentSanity<=0;`);
    }
  }

  const hasExits = scene.exits && scene.exits.length > 0;
  const hasInScene = opts.inSceneActions && opts.inSceneActions.length > 0;
  const isTerminal = !hasExits;
  const wantTerminalBtn = isTerminal && opts.terminalExit;

  if (!hasExits && !hasInScene && !wantTerminalBtn) {
    return lines.join('\n');
  }

  // 选项菜单 label（行动后 loop 回这里）
  const choicesLabel = pfx(`${scene.id}_choices`, p);
  lines.push('');
  lines.push(`label:${choicesLabel};`);

  // 拼 choose 命令：先 in-scene actions，后 exits
  // 所有按钮 label 都过 truncateChoiceLabel — WebGAL 按钮宽度有限不能溢出.
  const choiceParts: string[] = [];
  if (opts.inSceneActions) {
    opts.inSceneActions.forEach((a, i) => {
      const safeLabel = escapeForWebgal(truncateChoiceLabel(a.label));
      choiceParts.push(`${safeLabel}:${pfx(inSceneActionLabelName(scene.id, i), p)}`);
    });
  }
  if (scene.exits) {
    scene.exits.forEach((e, i) => {
      const target = opts.transitionActions?.has(i)
        ? pfx(transitionLabelName(scene.id, i), p)
        : pfx(e.toScene, p);
      const safeLabel = escapeForWebgal(truncateChoiceLabel(e.condition));
      choiceParts.push(`${safeLabel}:${target}`);
    });
  }
  // terminal scene 末尾追加 "结束" 按钮 → 跳到 recap/launcher (调用方决定 target).
  // 注意: terminalExit.target 不过 pfx (调用方传的就是最终 label, 跨 prefix 全局可达).
  if (wantTerminalBtn && opts.terminalExit) {
    const safeLabel = escapeForWebgal(truncateChoiceLabel(opts.terminalExit.buttonLabel));
    choiceParts.push(`${safeLabel}:${opts.terminalExit.target}`);
  }
  lines.push(`choose:${choiceParts.join('|')};`);

  // in-scene action labels（loop back）
  if (opts.inSceneActions) {
    for (const [i, action] of opts.inSceneActions.entries()) {
      lines.push('');
      lines.push(`label:${pfx(inSceneActionLabelName(scene.id, i), p)};`);
      lines.push(...narrateTextToLines(action.resultNarrate));
      lines.push(`jumpLabel:${choicesLabel};`);
    }
  }

  // exit transition labels（跳到下个 scene）
  if (scene.exits && opts.transitionActions) {
    for (const [i, exit] of scene.exits.entries()) {
      const transActs = opts.transitionActions.get(i);
      if (transActs && transActs.length > 0) {
        lines.push('');
        lines.push(`label:${pfx(transitionLabelName(scene.id, i), p)};`);
        lines.push(...transActs.flatMap((a) => actionToWebgalLines(a)));
        lines.push(`jumpLabel:${pfx(exit.toScene, p)};`);
      }
    }
  }

  return lines.join('\n');
}

function transitionLabelName(fromSceneId: string, exitIndex: number): string {
  return `trans_${fromSceneId}_${exitIndex}`;
}

/**
 * V2 (story L1): 从 scenario.authorNotes 提炼"玩家目标"作为入场卡内容.
 *
 * authorNotes 是给 LLM 看的剧本主干概述, 通常 100-300 字, 包含:
 *   - 背景设定
 *   - 关键谜题
 *   - 真相
 *   - 推荐技能
 *
 * 我们只取**前 2-3 句**作为玩家目标提示 (避免剧透真相).
 * 如果 authorNotes 没设置, 返回 null 让调用方走旁白兜底.
 */
function extractGoalFromAuthorNotes(notes: string | undefined): string[] | null {
  if (!notes || notes.length < 20) return null;
  // 按 。/.！?  断句, 取前 2-3 句
  const sentences = notes
    .split(/[。！？!?]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3)
    .map((s) => (s.endsWith('。') || s.endsWith('.') ? s : s + '。'));
  if (sentences.length === 0) return null;
  return sentences;
}

/**
 * 游戏开场 intro 段：显示剧本标题 / 设定 + 玩家角色信息 + V2 入场目标卡
 * 返回 WebGAL 行数组（不带 label 包裹，调用方拼到 startTxt 里）
 *
 * V2 (story L1): 开场加一张 "你是谁 / 在哪 / 要干嘛" intro 卡, 玩家不再迷茫.
 * 内容从 scenario.setting + scenario.authorNotes 提炼.
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
  }

  // V2 入场目标卡: 从 authorNotes 第一段提炼"目标" (作者意图概述)
  // 多行 intro 卡: 标题 + 1-3 行目标 + 准备好按钮意识
  const goal = extractGoalFromAuthorNotes(scenario.authorNotes);
  if (goal) {
    const goalLines = [
      '你的处境',
      ...goal.map((g) => escapeForWebgal(g)),
      '深呼吸. 你将独自面对接下来的一切.',
    ];
    lines.push(
      `intro:${goalLines.join('|')} -animation=fadeIn -fontColor=rgba(216, 201, 166, 1) -fontSize=medium -delayTime=2400;`,
    );
  } else if (character) {
    // 兜底: 没 authorNotes 时仍然给一句"准备好" 旁白
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
  /** label 前缀（多剧本 launcher 时避免 label 冲突）*/
  labelPrefix?: string;
  /**
   * 最后一个 scene (无 exits) 末尾追加的 "结束" 按钮.
   * 比如 gen:ai-game 传 `{ buttonLabel: '结束这段旅程', target: 'journey_recap' }`,
   * launcher 传 `{ buttonLabel: '回到剧本选择', target: '_launcher' }`.
   * 不传则 terminal scene 走完 narrate 后只能停留在 choose 菜单循环.
   */
  terminalExit?: { buttonLabel: string; target: string };
  /**
   * V2 (death L1): 每场景结束后的玩家状态 (HP/SAN). gen-time 算好.
   * Map key = sceneId, value = { currentHp, currentSanity, maxHp, maxSanity }.
   *
   * 设了:
   *   - 每场景主 narrate 后插 setVar 同步状态
   *   - 自动生成 2 张 bad_end intro 卡 (你死了 / 你疯了)
   *   - 每场景之后插条件 jumpLabel 跳 bad_end
   *
   * 不设: 沿用 V0 路径, 无死亡判定.
   */
  perSceneEndState?: Map<string, {
    currentHp: number;
    currentSanity: number;
    maxHp: number;
    maxSanity: number;
  }>;
}

export function buildScenarioGame(
  scenario: Scenario,
  perSceneActions: Map<string, ReadonlyArray<LlmAction>> = new Map(),
  perSceneTransitions: Map<string, Map<number, ReadonlyArray<LlmAction>>> = new Map(),
  perSceneInSceneActions: Map<string, ReadonlyArray<InSceneAction>> = new Map(),
  opts: BuildScenarioGameInputOptions = {},
): BuildScenarioGameResult {
  const p = opts.labelPrefix;
  // start.txt：开场 intro → jumpLabel 到起点
  const introLines = buildIntroSection(scenario, opts.character);
  const startTxt = [
    `;${scenario.title}`,
    `;${scenario.setting}`,
    `setVar:scenarioId="${scenario.id}";`,
    ...introLines,
    `jumpLabel:${p ? `${p}__${scenario.startSceneId}` : scenario.startSceneId};`,
  ].join('\n');

  // V2: bad_end label 名 (本剧本内唯一, 走 prefix 兼容 launcher 多本)
  const deadEndLabel = p ? `${p}__bad_end_dead` : 'bad_end_dead';
  const madEndLabel = p ? `${p}__bad_end_mad` : 'bad_end_mad';
  const hasDeathCheck = !!opts.perSceneEndState;

  // 所有 scenes 写到一个文件里（用 label 区分），简化 routing
  const sceneFiles = new Map<string, string>();
  const lastSceneIdx = scenario.scenes.length - 1;
  const allScenesTxt = scenario.scenes
    .map((s, i) => {
      const sceneOpts: SceneSectionOptions = { sceneIndex: i + 1 };
      if (p) sceneOpts.labelPrefix = p;
      const actions = perSceneActions.get(s.id);
      if (actions !== undefined) sceneOpts.actions = actions;
      const trans = perSceneTransitions.get(s.id);
      if (trans !== undefined) sceneOpts.transitionActions = trans;
      const inScene = perSceneInSceneActions.get(s.id);
      if (inScene !== undefined) sceneOpts.inSceneActions = inScene;
      // 只给最后一个 scene 注入 terminal exit (其他 scene 即使没 exits 也不需要)
      if (i === lastSceneIdx && opts.terminalExit) {
        sceneOpts.terminalExit = opts.terminalExit;
      }
      // V2 (death L1): 每场景注入"主路径走完时的状态" + 死亡跳转
      const endState = opts.perSceneEndState?.get(s.id);
      if (endState) {
        sceneOpts.stateAfterScene = endState;
        sceneOpts.deadEndLabel = deadEndLabel;
        sceneOpts.madEndLabel = madEndLabel;
      }
      return sceneToWebgalSection(s, sceneOpts);
    })
    .join('\n\n');

  // V2 (death L1): 末尾追加 2 张 bad_end intro 卡 (死亡 / 心智崩溃)
  const badEndsTxt = hasDeathCheck ? buildBadEndSection(deadEndLabel, madEndLabel) : '';

  sceneFiles.set('scenes', allScenesTxt + (badEndsTxt ? '\n\n' + badEndsTxt : ''));

  return { startTxt, sceneFiles };
}

/**
 * V2 (death L1): 生成 2 张 bad_end 全屏 intro 卡 (死亡 / 心智崩溃).
 * 玩家被 -when=currentHp<=0 / -when=currentSanity<=0 跳到这里, 没有出口, end;.
 */
function buildBadEndSection(deadEndLabel: string, madEndLabel: string): string {
  return [
    `;----- bad_end · 死亡 -----`,
    `label:${deadEndLabel};`,
    `intro:你死了。|身体先于意识停下。|这场调查不会有你的回声。 -animation=fadeIn -fontColor=rgba(196, 69, 55, 1) -fontSize=large -delayTime=2600;`,
    `end;`,
    ``,
    `;----- bad_end · 心智崩溃 -----`,
    `label:${madEndLabel};`,
    `intro:你的心智彻底碎了。|身体活着, 但里面的人已经不在。|余下的故事, 不是你写的。 -animation=fadeIn -fontColor=rgba(168, 149, 120, 1) -fontSize=large -delayTime=2600;`,
    `end;`,
  ].join('\n');
}
