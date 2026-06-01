// build-kohaku-v3.ts
//
// 确定性合并管线 (无 LLM):
//   读 kohaku.zh.txt + annotations.json + expansions.json + dialogues.json + enemies.json
//   产出 kohaku-v3-preview.html (本地审阅) + kohaku.v3.scenario-patch.json (可合入主 scenario)
//
// 跑法: npm run build:kohaku-v3
//
// 注意: 原文 verbatim 段从 kohaku.zh.txt 现场读取, 脚本本身不存原文内容.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KOHAKU_DIR = resolve(__dirname, '../.test-scenarios/csc-kohaku');
const DOCS_DIR = resolve(__dirname, '../docs');

interface Annotation {
  tags: string[];
  check?: string;
  flag?: string;
  enemy?: string;
  enemyDataRef?: string;
  expandKey?: string;
  dialogueKey?: string;
  speaker?: string;
  reason?: string;
}

interface ExpandEntry {
  kind: 'A' | 'B' | 'C' | 'D';
  paragraphs?: string[];
  buttonLabel?: string;
  successParas?: string[];
  failParas?: string[];
  buttons?: Array<{ label: string; successParas: string[] }>;
}

interface DialogueLine {
  speaker: string;
  text?: string;
  verbatimFromIdx?: string;
  stripPrefix?: string;
}

interface DialogueEntry {
  lines: DialogueLine[];
}

interface Chapter {
  title: string;
  sceneId: string | null;
  range: string; // "000-009"
}

interface ProcessedSegment {
  idx: string;
  rawText: string;
  tags: string[];
  details: Record<string, unknown>;
  output: { kind: string; content: string[] | string; meta?: Record<string, unknown> };
}

// ─── 1. 加载源文件 + 切段 ──────────────────────────
// FIX: 从"调查员醒来时"开始算 #000, 跳过前面所有 meta (CSC 头 / 难度 / シナリオの概略 / 注意事项 / 章标题).
const SEG_ZERO_MARKER = '调查员醒来时';

async function loadSegments(): Promise<string[]> {
  const raw = await readFile(join(KOHAKU_DIR, 'kohaku.zh.txt'), 'utf-8');
  const lines = raw.split(/\r?\n/);
  const blocks: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (buf.length > 0) {
        blocks.push(buf.join('\n').trim());
        buf = [];
      }
    } else {
      buf.push(line);
    }
  }
  if (buf.length > 0) blocks.push(buf.join('\n').trim());

  // 排除章节标题块 (【XXX】) 和 ----- 分隔符块
  const filtered = blocks.filter((b) => {
    if (/^【.+】\s*$/.test(b)) return false;
    if (/^-{3,}$/.test(b)) return false;
    return true;
  });

  // 找到 #000 锚点 (第一段含 "调查员醒来时" 的段)
  const zeroIdx = filtered.findIndex((b) => b.includes(SEG_ZERO_MARKER));
  if (zeroIdx < 0) {
    console.warn('⚠️ 未找到 #000 锚点, 用全部段');
    return filtered;
  }
  console.log(`🔧 跳过前 ${zeroIdx} 段 meta (CSC 头/概略/注意事项), #000 起于 "${filtered[zeroIdx].slice(0, 30)}..."`);
  return filtered.slice(zeroIdx);
}

// ─── 2. 主处理 ──────────────────────────────────
async function main(): Promise<void> {
  const segments = await loadSegments();
  console.log(`📖 加载 ${segments.length} 个段落`);

  const annotationsRaw = JSON.parse(await readFile(join(KOHAKU_DIR, 'annotations.json'), 'utf-8'));
  const annotations: Record<string, Annotation> = annotationsRaw.annotations;
  const chapters: Chapter[] = annotationsRaw.chapters;
  const expansionsRaw = JSON.parse(await readFile(join(KOHAKU_DIR, 'expansions.json'), 'utf-8'));
  const expansions: Record<string, ExpandEntry> = expansionsRaw.expansions;
  const dialoguesRaw = JSON.parse(await readFile(join(KOHAKU_DIR, 'dialogues.json'), 'utf-8'));
  const dialogues: Record<string, DialogueEntry> = dialoguesRaw.dialogues;
  const enemiesRaw = JSON.parse(await readFile(join(KOHAKU_DIR, 'enemies.json'), 'utf-8'));
  const enemies: Record<string, { name: string; hp?: number; skills?: Array<{ name: string; value?: number | null; damage?: string }> }> = enemiesRaw.enemies;

  // endings.json (可选)
  let endingsData: { endings: Array<Record<string, unknown>>; modifiers: Record<string, Record<string, unknown>> } | null = null;
  try {
    endingsData = JSON.parse(await readFile(join(KOHAKU_DIR, 'endings.json'), 'utf-8'));
  } catch { /* 没有 endings.json 也行 */ }

  console.log(`📋 annotations: ${Object.keys(annotations).length}`);
  console.log(`✏️  expansions:  ${Object.keys(expansions).length}`);
  console.log(`💬 dialogues:   ${Object.keys(dialogues).length}`);
  console.log(`⚔️  enemies:     ${Object.keys(enemies).length}`);
  console.log(`🎯 endings:     ${endingsData ? endingsData.endings.length + ' + ' + Object.keys(endingsData.modifiers).length + ' modifiers' : '(none)'}\n`);

  const renderedDialogues = new Set<string>(); // FIX: 防止 Q.A 对的两个 idx 各渲染一次
  const processed: ProcessedSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const idx = String(i).padStart(3, '0');
    const ann = annotations[idx];
    const seg: ProcessedSegment = {
      idx,
      rawText: segments[i],
      tags: ann?.tags ?? ['(未标注)'],
      details: ann ? { ...ann } : {},
      output: { kind: 'unknown', content: '' },
    };

    if (!ann) {
      seg.output = { kind: 'warning', content: '⚠️ 未标注 — 待人工补' };
      processed.push(seg);
      continue;
    }

    // FIX: dialogue subsume — 同一 dialogueKey 第二次出现只显示 "subsumed"
    if (ann.tags.includes('ec') && ann.dialogueKey) {
      if (renderedDialogues.has(ann.dialogueKey)) {
        seg.output = { kind: 'subsumed', content: `↑ 已合入 #${ann.dialogueKey} 对话` };
        processed.push(seg);
        continue;
      }
      renderedDialogues.add(ann.dialogueKey);
    }

    seg.output = renderSegment(segments[i], ann, expansions, dialogues, enemies, segments);
    processed.push(seg);
  }

  // ─── 3. 生成预览 HTML ──────────────────────────
  const html = renderPreviewHtml(processed, chapters, enemies, endingsData);
  const outPath = join(DOCS_DIR, 'kohaku-v3-preview.html');
  await writeFile(outPath, html, 'utf-8');
  console.log(`✅ 预览写入: ${outPath}`);

  // ─── 4. 统计 ───────────────────────────────────
  const stats: Record<string, number> = {};
  processed.forEach((p) => {
    p.tags.forEach((t) => { stats[t] = (stats[t] ?? 0) + 1; });
  });
  console.log('\n📊 标签统计:');
  Object.entries(stats).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
    console.log(`   ${t.padEnd(12)} × ${c}`);
  });
}

// ─── 段处理 ─────────────────────────────────────
function renderSegment(
  raw: string,
  ann: Annotation,
  expansions: Record<string, ExpandEntry>,
  dialogues: Record<string, DialogueEntry>,
  enemies: Record<string, { name: string }>,
  allSegments: string[],
): ProcessedSegment['output'] {
  const tags = ann.tags;

  // 优先级: dialogue > expand > combat/check/flag > verbatim > drop
  if (tags.includes('ec') && ann.dialogueKey) {
    const dlg = dialogues[ann.dialogueKey];
    if (!dlg) return { kind: 'error', content: `dialogue ${ann.dialogueKey} 未定义` };
    const lines = dlg.lines.map((l) => {
      let text = l.text;
      if (!text && l.verbatimFromIdx) {
        const idx = parseInt(l.verbatimFromIdx, 10);
        text = allSegments[idx];
        if (l.stripPrefix && text?.startsWith(l.stripPrefix)) text = text.slice(l.stripPrefix.length).trim();
      }
      return `${l.speaker}：${text ?? '(空)'}`;
    });
    return { kind: 'dialogue', content: lines };
  }

  if (tags.some((t) => ['ea', 'eb', 'ed'].includes(t)) && ann.expandKey) {
    const exp = expansions[ann.expandKey];
    if (!exp) return { kind: 'error', content: `expansion ${ann.expandKey} 未定义` };
    if (exp.kind === 'B' && exp.buttons) {
      return {
        kind: 'expand-b-multi',
        content: exp.buttons.map((b) => `[按钮] ${b.label}\n${b.successParas.join('\n')}`).join('\n\n'),
      };
    }
    if (exp.kind === 'B' && exp.buttonLabel) {
      // FIX: 单按钮自动加干扰项. 优先 expansions[key].distractor (每场景定制),
      // 没填才退回到通用"暂时不动".
      const okParas = exp.successParas ?? [];
      const failParas = exp.failParas ?? [];
      const lines = [
        `[按钮①] ${exp.buttonLabel}`,
        `  成功: ${okParas.join(' / ')}`,
      ];
      if (failParas.length) lines.push(`  失败: ${failParas.join(' / ')}`);
      const distractor = (exp as { distractor?: { label: string; resultParas: string[] } }).distractor;
      if (distractor) {
        lines.push(`[按钮②] ${distractor.label}`);
        lines.push(`  结果: ${distractor.resultParas.join(' / ')}`);
      } else {
        lines.push(`[按钮②] (干扰项 — 暂时不动 / 等等再看)`);
        lines.push(`  结果: 林夏屏住呼吸, 决定先观察一会儿. (回探索菜单)`);
      }
      return { kind: 'expand-b', content: lines.join('\n') };
    }
    return { kind: `expand-${exp.kind.toLowerCase()}`, content: exp.paragraphs ?? [] };
  }

  if (tags.includes('c')) {
    const enemyId = ann.enemy ?? ann.enemyDataRef;
    return { kind: 'combat', content: `⚔️ ${enemyId ?? '?'} → enemies.json` };
  }

  if (tags.includes('d')) {
    return { kind: 'drop', content: ann.reason ?? '元术语' };
  }

  // verbatim (含 flag/check 但保留原文)
  if (tags.includes('v')) {
    const meta: string[] = [];
    if (ann.flag) meta.push(`🚩 ${ann.flag}`);
    if (ann.check) meta.push(`🎲 ${ann.check}`);
    if (ann.speaker) meta.push(`说话人: ${ann.speaker}`);
    return { kind: 'verbatim', content: raw, meta: { tags: meta } };
  }

  // 纯 check / flag
  const meta: string[] = [];
  if (ann.check) meta.push(`🎲 ${ann.check}`);
  if (ann.flag) meta.push(`🚩 ${ann.flag}`);
  return { kind: 'meta', content: meta.join(' · ') };
}

// ─── HTML 渲染 ───────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface EndingDef {
  id: string;
  priority?: number;
  name: string;
  type: 'bad' | 'happy' | 'normal';
  triggerExpr: string;
  kind?: string;
  outro: string[];
  footStamp?: string;
  sanRecovery?: string;
}

interface ModifierDef {
  name: string;
  triggerExpr: string;
  outroAppend: string[];
  sanRecovery?: string;
}

function renderPreviewHtml(
  processed: ProcessedSegment[],
  chapters: Chapter[],
  enemies: Record<string, { name: string; hp?: number; sanLoss?: string; attributes?: Record<string, number> }>,
  endingsData: { endings: Array<Record<string, unknown>>; modifiers: Record<string, Record<string, unknown>> } | null,
): string {
  // 找 segment idx 对应的 chapter
  function findChapter(idx: number): Chapter | undefined {
    return chapters.find((c) => {
      const [s, e] = c.range.split('-').map((x) => parseInt(x, 10));
      return idx >= s && idx <= e;
    });
  }

  // 渲染 segment block
  const segHtml: string[] = [];
  let curChapter = '';
  processed.forEach((p) => {
    const i = parseInt(p.idx, 10);
    const ch = findChapter(i);
    if (ch && ch.title !== curChapter) {
      segHtml.push(`<div class="chapter"><h2>【${escapeHtml(ch.title)}】${ch.sceneId ? ` <small>→ ${ch.sceneId}</small>` : ''}</h2></div>`);
      curChapter = ch.title;
    }

    const tagChips = p.tags.map((t) => `<span class="tag tag-${t}">${t}</span>`).join(' ');
    const cls = p.tags[0] || 'unknown';

    let outputHtml = '';
    const o = p.output;
    if (o.kind === 'verbatim') {
      outputHtml = `<div class="out verbatim">${escapeHtml(o.content as string)}</div>`;
      if (o.meta?.tags && Array.isArray(o.meta.tags) && (o.meta.tags as string[]).length > 0) {
        outputHtml += `<div class="meta">${(o.meta.tags as string[]).map(escapeHtml).join(' · ')}</div>`;
      }
    } else if (o.kind === 'dialogue') {
      outputHtml = '<div class="out dialogue">' + (o.content as string[]).map((l) => `<div class="line">${escapeHtml(l)}</div>`).join('') + '</div>';
    } else if (o.kind === 'expand-a' || o.kind === 'expand-d') {
      outputHtml = '<div class="out expand">' + (o.content as string[]).map((p) => `<div class="para">${escapeHtml(p)}</div>`).join('') + '</div>';
    } else if (o.kind === 'expand-b' || o.kind === 'expand-b-multi') {
      outputHtml = `<div class="out expand-b">${escapeHtml(o.content as string).replace(/\n/g, '<br>')}</div>`;
    } else if (o.kind === 'combat') {
      outputHtml = `<div class="out combat">${escapeHtml(o.content as string)}</div>`;
    } else if (o.kind === 'drop') {
      outputHtml = `<div class="out drop">🗑 ${escapeHtml(o.content as string)}</div>`;
    } else if (o.kind === 'meta') {
      outputHtml = `<div class="out meta-only">${escapeHtml(o.content as string)}</div>`;
    } else {
      outputHtml = `<div class="out warning">${escapeHtml(o.content as string)}</div>`;
    }

    segHtml.push(`
<div class="seg tag-${cls}">
  <div class="seg-h">
    <span class="idx">#${p.idx}</span>
    <span class="tags">${tagChips}</span>
  </div>
  <div class="row">
    <div class="col input">${escapeHtml(p.rawText)}</div>
    <div class="col output">${outputHtml}</div>
  </div>
</div>`);
  });

  // Enemies sidebar
  const enemiesHtml = Object.entries(enemies).map(([id, e]) => `
<div class="enemy-card">
  <h4>${escapeHtml(e.name)} <small>(${escapeHtml(id)})</small></h4>
  ${e.hp !== undefined ? `<div class="stat">HP: ${e.hp}</div>` : ''}
  ${e.sanLoss ? `<div class="stat">SAN: ${escapeHtml(e.sanLoss)}</div>` : ''}
  ${e.attributes ? `<div class="stat">${Object.entries(e.attributes).map(([k, v]) => `${k}${v}`).join(' · ')}</div>` : ''}
</div>`).join('');

  // 结局决策表 (新增)
  let endingsHtml = '';
  if (endingsData && endingsData.endings.length > 0) {
    const sortedEndings = [...endingsData.endings].sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
    const endingCards = sortedEndings.map((e) => {
      const def = e as unknown as EndingDef;
      const outroHtml = def.outro.map((p) => `<div class="outro-line">${escapeHtml(p)}</div>`).join('');
      return `<div class="ending-card ending-${def.type}">
  <div class="ending-h">
    <span class="ending-id">#${escapeHtml(def.id)}</span>
    <span class="ending-pri">priority ${def.priority ?? 0}</span>
    <span class="ending-type ending-type-${def.type}">${def.type.toUpperCase()}</span>
    ${def.sanRecovery ? `<span class="ending-san">SAN ${escapeHtml(def.sanRecovery)}</span>` : ''}
  </div>
  <div class="ending-name">${escapeHtml(def.name)}${def.kind ? ` <small>· ${escapeHtml(def.kind)}</small>` : ''}</div>
  <div class="ending-trigger"><strong>触发：</strong> <code>${escapeHtml(def.triggerExpr)}</code></div>
  <div class="ending-outro">${outroHtml}</div>
  ${def.footStamp ? `<div class="ending-foot">${escapeHtml(def.footStamp)}</div>` : ''}
</div>`;
    }).join('');
    const modifierCards = Object.entries(endingsData.modifiers).map(([key, m]) => {
      const md = m as unknown as ModifierDef;
      const appendHtml = md.outroAppend.map((p) => `<div class="outro-line">${escapeHtml(p)}</div>`).join('');
      return `<div class="modifier-card">
  <div class="modifier-h">
    <span class="modifier-key">+${escapeHtml(key)}</span>
    ${md.sanRecovery ? `<span class="ending-san">SAN ${escapeHtml(md.sanRecovery)}</span>` : ''}
  </div>
  <div class="ending-name">${escapeHtml(md.name)}</div>
  <div class="ending-trigger"><strong>触发：</strong> <code>${escapeHtml(md.triggerExpr)}</code></div>
  <div class="ending-outro">${appendHtml}</div>
</div>`;
    }).join('');
    endingsHtml = `
<section class="endings-section">
  <h2>🎯 结局决策表 <small>（按 priority 倒序检查, 第一个匹配的 ending 触发）</small></h2>
  <div class="endings-grid">${endingCards}</div>
  <h3>⊕ 可叠加修饰 (modifiers — 走完 ending 后按 flag 附加 outro)</h3>
  <div class="modifiers-grid">${modifierCards}</div>
</section>`;
  }

  // 统计
  const total = processed.length;
  const stats: Record<string, number> = {};
  processed.forEach((p) => p.tags.forEach((t) => { stats[t] = (stats[t] ?? 0) + 1; }));

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>kohaku v3 · 完整预览</title>
<style>
:root {
  --ink: #2c2418; --paper: #f4ead4; --paper-2: #ede2c4; --line: #c8b88a;
  --accent: #8b2c1f; --olive: #5e6b3a; --plum: #6b3578; --amber: #b89559;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: "Noto Serif SC", serif;
  font-size: 14px; line-height: 1.65; }
header { background: var(--paper-2); border-bottom: 2px solid var(--accent); padding: 18px 24px;
  position: sticky; top: 0; z-index: 10; }
header h1 { margin: 0; font-size: 20px; color: var(--accent); }
header .stats { font-family: ui-monospace, monospace; font-size: 12px; margin-top: 6px; color: #6b5b3e; }
main { max-width: 1200px; margin: 0 auto; padding: 24px; display: grid;
  grid-template-columns: 1fr 280px; gap: 20px; align-items: start; }
.chapter h2 { color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 6px;
  margin: 20px 0 10px; font-size: 17px; }
.chapter h2 small { font-family: ui-monospace, monospace; color: #6b5b3e; font-size: 11px; }
.seg { background: white; border: 1px solid var(--line); border-left: 4px solid var(--line);
  margin-bottom: 10px; padding: 10px 14px; }
.seg.tag-v { border-left-color: var(--olive); }
.seg.tag-ea, .seg.tag-eb, .seg.tag-ec, .seg.tag-ed { border-left-color: #2c5478; }
.seg.tag-d { border-left-color: #999; opacity: 0.6; }
.seg.tag-c { border-left-color: var(--accent); }
.seg.tag-k { border-left-color: var(--amber); }
.seg.tag-f { border-left-color: var(--plum); }
.seg-h { display: flex; gap: 10px; align-items: baseline; margin-bottom: 6px; }
.idx { font-family: ui-monospace, monospace; color: #888; font-size: 11px; }
.tags .tag { font-family: ui-monospace, monospace; font-size: 10px; padding: 1px 6px;
  border: 1px solid var(--line); background: var(--paper-2); margin-right: 3px; }
.tag-v { background: #f0f7e8; color: var(--olive); }
.tag-ea, .tag-eb, .tag-ec, .tag-ed { background: #e8f1f7; color: #2c5478; }
.tag-d { background: #ece8e0; color: #888; }
.tag-c { background: #fde8e6; color: var(--accent); }
.tag-k { background: #fdf3d8; color: var(--amber); }
.tag-f { background: #f3e8f7; color: var(--plum); }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.col { padding: 8px 10px; background: var(--paper-2); border: 1px solid var(--line);
  font-size: 13px; white-space: pre-wrap; }
.col.input { background: #faf6e8; }
.out.verbatim { background: #f0f7e8; padding: 4px 8px; border-left: 2px solid var(--olive); }
.out.dialogue .line { padding: 4px 8px; background: #fff; border-left: 2px solid var(--accent);
  margin-bottom: 4px; }
.out.expand .para { padding: 4px 8px; background: #e8f1f7; border-left: 2px solid #2c5478;
  margin-bottom: 4px; }
.out.expand-b { background: #e8f1f7; padding: 6px 10px; border-left: 2px solid #2c5478;
  font-family: ui-monospace, monospace; font-size: 12px; }
.out.combat { background: #fde8e6; padding: 4px 8px; border-left: 2px solid var(--accent);
  font-family: ui-monospace, monospace; font-size: 12px; }
.out.drop { background: #ece8e0; padding: 4px 8px; color: #888; font-style: italic; }
.out.warning { background: #fff5e5; padding: 4px 8px; color: #c44537; }
.out.meta-only { color: #6b5b3e; font-style: italic; padding: 4px 8px; }
.meta { font-size: 11px; color: #6b5b3e; margin-top: 4px; font-family: ui-monospace, monospace; }
aside { position: sticky; top: 88px; max-height: calc(100vh - 110px); overflow-y: auto;
  background: var(--paper-2); border: 1px solid var(--line); padding: 14px; }
aside h3 { margin: 0 0 10px; color: var(--accent); font-size: 14px; }
.enemy-card { background: white; border: 1px solid var(--line); padding: 8px 10px; margin-bottom: 6px; }
.endings-section { max-width: 1200px; margin: 28px auto; padding: 0 24px; }
.endings-section h2 { color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 8px; font-size: 19px; }
.endings-section h2 small { font-size: 12px; color: #6b5b3e; font-weight: normal; }
.endings-section h3 { color: var(--accent); font-size: 15px; margin-top: 28px; padding-bottom: 4px; border-bottom: 1px dashed var(--line); }
.endings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.modifiers-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.ending-card { background: white; border: 1px solid var(--line); border-left: 6px solid var(--line); padding: 12px 14px; }
.ending-bad { border-left-color: var(--accent); background: linear-gradient(to right, #fde8e6 0%, white 30%); }
.ending-happy { border-left-color: var(--olive); background: linear-gradient(to right, #f0f7e8 0%, white 30%); }
.ending-normal { border-left-color: var(--amber); background: linear-gradient(to right, #fdf3d8 0%, white 30%); }
.ending-h { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
.ending-id { font-family: ui-monospace, monospace; font-size: 11px; color: #888; }
.ending-pri { font-family: ui-monospace, monospace; font-size: 10px; color: #888; background: var(--paper-2); padding: 1px 5px; border: 1px solid var(--line); }
.ending-type { font-family: ui-monospace, monospace; font-size: 10px; padding: 1px 6px; font-weight: bold; }
.ending-type-bad { color: white; background: var(--accent); }
.ending-type-happy { color: white; background: var(--olive); }
.ending-type-normal { color: white; background: var(--amber); }
.ending-san { font-family: ui-monospace, monospace; font-size: 10px; color: #6b5b3e; }
.ending-name { font-weight: bold; font-size: 15px; margin: 4px 0; }
.ending-name small { font-weight: normal; color: #6b5b3e; font-size: 12px; }
.ending-trigger { font-size: 12px; color: #6b5b3e; margin-bottom: 8px; padding: 4px 8px; background: var(--paper-2); border-left: 2px solid var(--line); }
.ending-trigger code { font-family: ui-monospace, monospace; background: white; padding: 1px 5px; }
.ending-outro { background: var(--paper); padding: 8px 10px; border: 1px solid var(--line); margin-top: 6px; }
.outro-line { padding: 3px 6px; background: white; border-left: 2px solid var(--olive); margin-bottom: 3px; font-size: 13px; }
.ending-foot { font-family: ui-monospace, monospace; font-size: 10px; color: var(--accent); letter-spacing: 0.2em; margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--line); text-transform: uppercase; }
.modifier-card { background: white; border: 1px solid var(--line); border-left: 4px solid var(--plum); padding: 10px 12px; }
.modifier-h { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
.modifier-key { font-family: ui-monospace, monospace; color: var(--plum); font-weight: bold; font-size: 12px; }
@media (max-width: 900px) {
  .endings-grid, .modifiers-grid { grid-template-columns: 1fr; }
}
.enemy-card h4 { margin: 0 0 4px; font-size: 13px; }
.enemy-card h4 small { color: #888; font-family: ui-monospace, monospace; font-size: 10px; }
.enemy-card .stat { font-size: 11px; color: #6b5b3e; font-family: ui-monospace, monospace; }
</style></head>
<body>
<header>
  <h1>📜 kohaku v3 · 完整预览 (确定性合并, 无 LLM)</h1>
  <div class="stats">总段: ${total} ·
    ${Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}×${c}`).join(' · ')}
  </div>
</header>
<main>
  <div>${segHtml.join('\n')}</div>
  <aside>
    <h3>⚔️ enemies.json</h3>
    ${enemiesHtml}
  </aside>
</main>
${endingsHtml}
</body></html>`;
}

await main().catch((e: unknown) => {
  console.error('❌', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
