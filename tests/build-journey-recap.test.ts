// 结局回顾页 builder 单测
import { describe, it, expect } from 'vitest';
import { buildJourneyRecap } from '../src/adapter/build-journey-recap.js';
import type { Character } from '../src/types/character.js';

function makeChar(overrides: Partial<Character> = {}): Character {
  const base: Character = {
    id: 'test-char',
    name: '林夕',
    occupation: '记者',
    age: 29,
    gender: '女',
    luck: 55,
    maxHp: 11, currentHp: 11,
    maxSanity: 60, currentSanity: 60,
    maxMp: 12, currentMp: 12,
    attributes: { STR: 50, DEX: 60, INT: 70, CON: 55, APP: 60, POW: 60, SIZ: 50, EDU: 75 },
    movement: 7,
    dodge: 30,
    brawl: 25,
    skills: new Map(),
    inventory: [],
    conditions: [],
  };
  return { ...base, ...overrides };
}

describe('buildJourneyRecap', () => {
  it('基础: 起点 vs 终点 + scene 顺序 + end;', () => {
    const out = buildJourneyRecap({
      character: makeChar(),
      initial: { sanity: 60, hp: 11 },
      finalSanity: 45,
      finalHp: 9,
      minSanity: 38,
      minHp: 7,
      sanityLossAccum: 15,
      hpLossAccum: 2,
      conditions: [],
      visitedSceneNames: ['图书馆门厅', '接待台', '主阅览大厅'],
    });
    expect(out).toContain('label:journey_recap;');
    expect(out).toContain('intro:你的旅程');
    expect(out).toContain('心智度 60 → 45');
    expect(out).toContain('最低跌到 38');
    expect(out).toContain('HP 11 → 9');
    expect(out).toContain('图书馆门厅 → 接待台 → 主阅览大厅');
    expect(out).toContain('你回来了');
    expect(out).toContain('end;');
  });

  it('心智 SAN 跌到 0: 不是同一个人结语', () => {
    const out = buildJourneyRecap({
      character: makeChar({ currentSanity: 0 }),
      initial: { sanity: 60, hp: 11 },
      finalSanity: 0,
      finalHp: 4,
      minSanity: 0,
      minHp: 4,
      sanityLossAccum: 60,
      hpLossAccum: 7,
      conditions: [],
      visitedSceneNames: ['图书馆'],
    });
    expect(out).toContain('你已经不是那个出发时的人');
  });

  it('心智度跌到 1/3 以下: 留下一些东西 结语', () => {
    const out = buildJourneyRecap({
      character: makeChar(),
      initial: { sanity: 60, hp: 11 },
      finalSanity: 15,
      finalHp: 8,
      minSanity: 15,
      minHp: 8,
      sanityLossAccum: 45,
      hpLossAccum: 3,
      conditions: [],
      visitedSceneNames: ['图书馆'],
    });
    expect(out).toContain('有些东西被永远留在了那里');
  });

  it('触发长期 phobia: 名字 + 简介出现', () => {
    const out = buildJourneyRecap({
      character: makeChar(),
      initial: { sanity: 60, hp: 11 },
      finalSanity: 30,
      finalHp: 11,
      minSanity: 25,
      minHp: 11,
      sanityLossAccum: 30,
      hpLossAccum: 0,
      conditions: [{
        type: 'indef_insanity',
        source: '看见尸体',
        appliedAt: Date.now(),
        insanityDetail: {
          kind: 'phobia',
          id: 38,
          nameZh: '恐女症',
          nameEn: 'Gynophobia',
          description: '害怕女性。看见女性需做心智检定。',
        },
      }],
      visitedSceneNames: ['图书馆', '地下室'],
    });
    expect(out).toContain('长期恐惧症');
    expect(out).toContain('《恐女症》');
    expect(out).toContain('害怕女性');
  });

  it('只有临时失常: 报告崩溃次数', () => {
    const out = buildJourneyRecap({
      character: makeChar(),
      initial: { sanity: 60, hp: 11 },
      finalSanity: 50,
      finalHp: 11,
      minSanity: 45,
      minHp: 11,
      sanityLossAccum: 10,
      hpLossAccum: 0,
      conditions: [
        { type: 'temp_insanity', source: '看见尸体', appliedAt: 1 },
        { type: 'temp_insanity', source: '听见低语', appliedAt: 2 },
      ],
      visitedSceneNames: ['图书馆'],
    });
    expect(out).toContain('崩溃过 2 次');
  });

  it('心智无损: 心智没真正崩塌 结语', () => {
    const out = buildJourneyRecap({
      character: makeChar(),
      initial: { sanity: 60, hp: 11 },
      finalSanity: 60,
      finalHp: 11,
      minSanity: 58,
      minHp: 10,
      sanityLossAccum: 2,
      hpLossAccum: 1,
      conditions: [],
      visitedSceneNames: ['图书馆'],
    });
    expect(out).toContain('心智在这一程里没有真正崩塌');
  });

  it('scene 列表超过 6 个: 只显示前 6', () => {
    const out = buildJourneyRecap({
      character: makeChar(),
      initial: { sanity: 60, hp: 11 },
      finalSanity: 45,
      finalHp: 9,
      minSanity: 38,
      minHp: 7,
      sanityLossAccum: 15,
      hpLossAccum: 2,
      conditions: [],
      visitedSceneNames: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'],
    });
    expect(out).toContain('S1 → S2 → S3 → S4 → S5 → S6');
    expect(out).not.toContain('S7');
  });
});
