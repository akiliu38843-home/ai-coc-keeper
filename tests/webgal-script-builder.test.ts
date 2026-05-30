// WebGAL Script Builder 单测
import { describe, it, expect } from 'vitest';
import {
  escapeForWebgal,
  actionToWebgalLines,
  actionsToWebgalScript,
  sceneToWebgalSection,
  buildScenarioGame,
  splitIntoPages,
  truncateChoiceLabel,
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

// ─── splitIntoPages: 把长 narrate 按句号自动拆页 ──────

describe('splitIntoPages', () => {
  it('短句不拆', () => {
    expect(splitIntoPages('你好。')).toEqual(['你好。']);
  });

  it('按中文句号拆', () => {
    const out = splitIntoPages('第一句。第二句。第三句。');
    expect(out).toEqual(['第一句。', '第二句。', '第三句。']);
  });

  it('按问号/感叹号拆', () => {
    expect(splitIntoPages('真的吗？怎么会！我不信。')).toEqual([
      '真的吗？', '怎么会！', '我不信。',
    ]);
  });

  it('单句超 maxLen 时按逗号二切', () => {
    const longSent =
      '湿冷的咸味贴在喉咙里，鱼腥味比记忆中任何渔港都浓得多，像是某种过期发酵的东西飘了上来。';
    const out = splitIntoPages(longSent, 30);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.every((p) => p.length <= 35)).toBe(true);
  });

  it('保留破折号不当切点', () => {
    const out = splitIntoPages('一段话 —— 接下来的部分。');
    expect(out).toEqual(['一段话 —— 接下来的部分。']);
  });

  it('单句无逗号超 maxLen: 不许硬切, 保持完整句', () => {
    // 一句话超过 maxLen 但内部没有任何可切标点 —— builder 必须保持原句完整
    // 不能在词中间硬切 (2026-05-28 老板反馈: 保证每个至少是一个完整的句子)
    const longNoComma = '主动把自己交出去走向螺旋祭坛闭上眼睛听见海浪和吟唱。';
    const out = splitIntoPages(longNoComma, 20);
    expect(out).toEqual([longNoComma]);
  });

  it('多句无逗号超 maxLen: 每个完整句各占一页', () => {
    const text = '主动把自己交出去走向螺旋祭坛。闭上眼听见海浪和吟唱。';
    const out = splitIntoPages(text, 20);
    expect(out).toEqual([
      '主动把自己交出去走向螺旋祭坛。',
      '闭上眼听见海浪和吟唱。',
    ]);
  });

  it('空字符串返回空', () => {
    expect(splitIntoPages('')).toEqual([]);
  });

  it('narrate action 自动拆多行', () => {
    const action: LlmAction = {
      type: 'narrate',
      text: '推开沉重的橡木大门。一股潮湿的霉味扑面而来。月光从破碎的彩绘玻璃漏进来。',
    };
    const out = actionToWebgalLines(action);
    expect(out.length).toBe(3);
    expect(out[0]).toBe('推开沉重的橡木大门。;');
  });

  it('truncateChoiceLabel: 短 label 不动', () => {
    expect(truncateChoiceLabel('上楼')).toBe('上楼');
    expect(truncateChoiceLabel('查看接待台登记簿')).toBe('查看接待台登记簿');
  });

  it('truncateChoiceLabel: 超过默认上限 truncate 加 …', () => {
    const long = '《雾港夜行》 — 1932 年新英格兰沿海小镇 Bramble 港';
    const out = truncateChoiceLabel(long);
    // 默认 14 字硬限 (经验值 — 实测中文 ≥ 14 会触发可见 truncate)
    expect(out.length).toBe(14);
    expect(out.endsWith('…')).toBe(true);
  });

  it('truncateChoiceLabel: 自定义 maxLen', () => {
    expect(truncateChoiceLabel('一二三四五六', 4)).toBe('一二三…');
  });

  it('sceneToWebgalSection terminal scene + terminalExit 加结束按钮', () => {
    const scene: Scene = {
      id: 'scene_ending',
      name: '结局',
      description: '一切到此为止。',
      // 无 exits = terminal
    };
    const out = sceneToWebgalSection(scene, {
      terminalExit: { buttonLabel: '结束这段旅程', target: 'journey_recap' },
    });
    expect(out).toContain('choose:结束这段旅程:journey_recap');
  });

  it('sceneToWebgalSection 不传 terminalExit: terminal scene 无 choose', () => {
    const scene: Scene = {
      id: 'scene_ending',
      name: '结局',
      description: '一切到此为止。',
    };
    const out = sceneToWebgalSection(scene);
    expect(out).not.toContain('choose:');
  });

  it('buildScenarioGame 只给最后一个 scene 加 terminal 按钮', () => {
    const sc: Scenario = {
      id: 'test',
      title: '测试',
      setting: '测试',
      startSceneId: 's1',
      schemaVersion: 1,
      npcs: [],
      scenes: [
        { id: 's1', name: 'A', description: 'A.', exits: [{ toScene: 's2', condition: '继续' }] },
        { id: 's2', name: 'B', description: 'B.' }, // 终结
      ],
    };
    const built = buildScenarioGame(sc, new Map(), new Map(), new Map(), {
      terminalExit: { buttonLabel: '完', target: 'journey_recap' },
    });
    const scenes = built.sceneFiles.get('scenes') ?? '';
    // s1 不应该有 journey_recap 跳转 (它有自己的 exit)
    const s1Section = scenes.split('label:s2;')[0]!;
    expect(s1Section).not.toContain('journey_recap');
    // s2 应该有结束按钮
    expect(scenes).toContain('choose:完:journey_recap');
  });

  it('V2 flag: exit.requires 渲染成 (cond)-> 前缀', () => {
    const scene: Scene = {
      id: 'scene_a',
      name: 'A',
      description: '...',
      exits: [
        { toScene: 'scene_b', condition: '走 B' },
        { toScene: 'scene_c', condition: '开锁', requires: { hasKey: true } },
        { toScene: 'scene_d', condition: '复合', requires: { sawEvidence: 2, isAngry: false } },
      ],
    };
    const out = sceneToWebgalSection(scene);
    expect(out).toContain('走 B:scene_b');
    expect(out).toContain('(hasKey==true)->开锁:scene_c');
    expect(out).toContain('(sawEvidence==2&&isAngry==false)->复合:scene_d');
  });

  it('V2 flag: exit.sets 在 transition 里 setVar', () => {
    const scene: Scene = {
      id: 'scene_a',
      name: 'A',
      description: '...',
      exits: [
        {
          toScene: 'scene_b', condition: '走 B',
          sets: { choseToTrust: true, evidenceCount: 1 },
        },
      ],
    };
    const out = sceneToWebgalSection(scene);
    // exit 设了 sets, 应该生成 trans label + setVar
    expect(out).toContain('label:trans_scene_a_0;');
    expect(out).toContain('setVar:choseToTrust=true;');
    expect(out).toContain('setVar:evidenceCount=1;');
    expect(out).toContain('jumpLabel:scene_b;');
  });

  it('V2 flag: scenario.initialFlags 在 startTxt 顶部 setVar', () => {
    const sc: Scenario = {
      id: 'test',
      title: '测试',
      setting: '...',
      startSceneId: 's1',
      schemaVersion: 1,
      npcs: [],
      scenes: [{ id: 's1', name: 'A', description: 'A.' }],
      initialFlags: { hasKey: false, evidenceCount: 0, route: 'investigation' },
    };
    const built = buildScenarioGame(sc);
    expect(built.startTxt).toContain('setVar:hasKey=false;');
    expect(built.startTxt).toContain('setVar:evidenceCount=0;');
    expect(built.startTxt).toContain('setVar:route="investigation";');
  });

  it('sceneToWebgalSection 自动 truncate 超长 exit condition', () => {
    const scene: Scene = {
      id: 'scene_test',
      name: '测试场景',
      description: '一段描述。',
      exits: [
        {
          toScene: 'next',
          condition: '走出门外去看看那边到底发生了什么以及为什么这么吵',
        },
      ],
    };
    const out = sceneToWebgalSection(scene);
    const chooseLine = out.split('\n').find((l) => l.startsWith('choose:'))!;
    const labelPart = chooseLine.match(/choose:(.*?):/)?.[1] ?? '';
    expect(labelPart.length).toBeLessThanOrEqual(18);
    expect(labelPart.endsWith('…')).toBe(true);
  });

  it('dialogue 每页都带 speaker', () => {
    const action: LlmAction = {
      type: 'dialogue',
      speaker: 'Hattie',
      text: '欢迎光临。今晚住一晚吗？外面雾很重。',
    };
    const out = actionToWebgalLines(action);
    expect(out.every((line) => line.startsWith('Hattie:'))).toBe(true);
    expect(out.length).toBe(3);
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
    // bgm 现在带 -volume/-enter 参数, 检查关键部分
    expect(out).toMatch(/bgm:horror\.mp3 -volume=\d+ -enter=\d+;/);
  });

  it('scene 含 mood (无 bgm) 时, builder 派生默认 BGM 文件名', () => {
    const scene: Scene = {
      id: 'scene_a', name: 'N', description: 'D',
      mood: 'horror',
    };
    const out = sceneToWebgalSection(scene);
    expect(out).toMatch(/bgm:mood_horror\.mp3 -volume=\d+ -enter=\d+;/);
  });

  it('scene.bgm 优先级高于 mood', () => {
    const scene: Scene = {
      id: 'scene_a', name: 'N', description: 'D',
      mood: 'horror',
      bgm: 'custom.mp3',
    };
    const out = sceneToWebgalSection(scene);
    expect(out).toContain('bgm:custom.mp3');
    expect(out).not.toContain('mood_horror');
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
