// WebGAL Script Builder 单测
import { describe, it, expect } from 'vitest';
import {
  escapeForWebgal,
  actionToWebgalLines,
  actionsToWebgalScript,
  sceneToWebgalSection,
  buildScenarioGame,
} from '../src/adapter/webgal-script-builder.js';
import type { LlmAction } from '../src/llm/adapter.js';
import type { Scene, Scenario } from '../src/types/scenario.js';

// ─── escapeForWebgal ────────────────────────────────

describe('escapeForWebgal', () => {
  it('普通文本不动', () => {
    expect(escapeForWebgal('你好世界')).toBe('你好世界');
  });

  it('转义 ; → ；', () => {
    expect(escapeForWebgal('多事;一行')).toBe('多事；一行');
  });

  it('转义 : → ：', () => {
    expect(escapeForWebgal('a:b')).toBe('a：b');
  });

  it('转义 | → ｜', () => {
    expect(escapeForWebgal('A|B')).toBe('A｜B');
  });

  it('换行折单行', () => {
    expect(escapeForWebgal('一行\n二行')).toBe('一行 二行');
  });
});

// ─── actionToWebgalLines ────────────────────────────

describe('actionToWebgalLines · narrate', () => {
  it('普通旁白 → 文本行', () => {
    const a: LlmAction = { type: 'narrate', text: '月光照进图书馆' };
    expect(actionToWebgalLines(a)).toEqual(['月光照进图书馆;']);
  });

  it('文本含 ; 自动转义', () => {
    const a: LlmAction = { type: 'narrate', text: '看;别看' };
    expect(actionToWebgalLines(a)).toEqual(['看；别看;']);
  });
});

describe('actionToWebgalLines · dialogue', () => {
  it('Speaker: 对话 —— WebGAL DSL 分隔符是半角 :', () => {
    const a: LlmAction = { type: 'dialogue', text: '你来了', speaker: '老馆长' };
    expect(actionToWebgalLines(a)).toEqual(['老馆长:你来了;']);
  });
});

describe('actionToWebgalLines · request_check', () => {
  it('包成 [check]/[/check] 注释 + 文本', () => {
    const a: LlmAction = {
      type: 'request_check',
      text: '需要仔细观察',
      skill: 'spot_hidden',
      difficulty: 'normal',
      rationale: '房间里有暗格',
    };
    const lines = actionToWebgalLines(a);
    expect(lines[0]).toBe(';[check] skill=spot_hidden difficulty=normal');
    expect(lines[1]).toBe('需要仔细观察;');
    expect(lines[2]).toBe(';[/check] rationale=房间里有暗格');
  });
});

describe('actionToWebgalLines · jump_scene', () => {
  it('过渡文本 + jumpLabel', () => {
    const a: LlmAction = { type: 'jump_scene', text: '你上了楼', toScene: 'scene_upstairs' };
    expect(actionToWebgalLines(a)).toEqual([
      '你上了楼;',
      'jumpLabel:scene_upstairs;',
    ]);
  });
});

describe('actionToWebgalLines · set_flag', () => {
  it('boolean 值', () => {
    const a: LlmAction = { type: 'set_flag', text: '日记找到', flag: 'found_diary', value: true };
    expect(actionToWebgalLines(a)).toEqual([
      'setVar:found_diary=true;',
      '日记找到;',
    ]);
  });

  it('number 值', () => {
    const a: LlmAction = { type: 'set_flag', text: '', flag: 'coins', value: 50 };
    expect(actionToWebgalLines(a)).toEqual(['setVar:coins=50;']);
  });

  it('string 值带引号', () => {
    const a: LlmAction = { type: 'set_flag', text: '', flag: 'mood', value: 'happy' };
    expect(actionToWebgalLines(a)).toEqual(['setVar:mood="happy";']);
  });
});

// ─── actionsToWebgalScript ─────────────────────────

describe('actionsToWebgalScript', () => {
  it('多 action 拼成多行', () => {
    const actions: LlmAction[] = [
      { type: 'narrate', text: '你推门' },
      { type: 'dialogue', text: '欢迎', speaker: 'NPC' },
    ];
    expect(actionsToWebgalScript(actions)).toBe('你推门;\nNPC:欢迎;');
  });
});

// ─── sceneToWebgalSection ───────────────────────────

describe('sceneToWebgalSection', () => {
  it('最小 scene：label + description', () => {
    const scene: Scene = {
      id: 'scene_a',
      name: '玄关',
      description: '门厅潮湿',
    };
    const out = sceneToWebgalSection(scene);
    expect(out).toContain('label:scene_a;');
    expect(out).toContain('门厅潮湿;');
  });

  it('scene 带 actions + exits', () => {
    const scene: Scene = {
      id: 'scene_a',
      name: '玄关',
      description: '门厅潮湿',
      exits: [
        { toScene: 'scene_b', condition: '上楼' },
        { toScene: 'scene_c', condition: '回到门厅' },
      ],
    };
    const actions: LlmAction[] = [{ type: 'narrate', text: '月光' }];
    const out = sceneToWebgalSection(scene, { actions });
    expect(out).toContain('label:scene_a;');
    expect(out).toContain('月光;');
    expect(out).toContain('choose:上楼:scene_b|回到门厅:scene_c;');
  });

  it('scene 含 background + bgm', () => {
    const scene: Scene = {
      id: 'scene_a',
      name: 'N',
      description: 'D',
      background: 'lib.webp',
      bgm: 'horror.mp3',
    };
    const out = sceneToWebgalSection(scene);
    expect(out).toContain('changeBg:lib.webp -next;');
    expect(out).toContain('bgm:horror.mp3;');
  });
});

// ─── buildScenarioGame · 全景 ───────────────────────

describe('buildScenarioGame', () => {
  it('start.txt + scenes 合一', () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      id: 'test',
      title: 'Test',
      setting: 'X',
      startSceneId: 'scene_a',
      scenes: [
        { id: 'scene_a', name: 'A', description: 'A 描述', exits: [{ toScene: 'scene_b', condition: '走' }] },
        { id: 'scene_b', name: 'B', description: 'B 描述' },
      ],
      npcs: [],
    };
    const result = buildScenarioGame(scenario);
    expect(result.startTxt).toContain('jumpLabel:scene_a;');
    expect(result.sceneFiles.get('scenes')).toContain('label:scene_a;');
    expect(result.sceneFiles.get('scenes')).toContain('label:scene_b;');
    expect(result.sceneFiles.get('scenes')).toContain('choose:走:scene_b;');
  });

  it('perSceneActions 注入到对应 scene', () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      id: 'test', title: 'T', setting: 'X', startSceneId: 's1',
      scenes: [{ id: 's1', name: 'N', description: '描述' }], npcs: [],
    };
    const actions: LlmAction[] = [{ type: 'narrate', text: 'AI 写的' }];
    const result = buildScenarioGame(scenario, new Map([['s1', actions]]));
    const text = result.sceneFiles.get('scenes')!;
    expect(text).toContain('AI 写的;');
    // 注入了 actions 时不再放原 description
    expect(text).not.toContain('描述;');
  });
});
