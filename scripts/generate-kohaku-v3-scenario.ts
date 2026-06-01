// generate-kohaku-v3-scenario.ts
//
// 把 v3 的 annotations + expansions + dialogues + endings 注入到 kohaku.v2.scenario.json,
// 输出 kohaku.v3.scenario.json (与 v2 同构, 但 narrate/inSceneActions/endings 由 v3 metadata 填).
//
// 跑完后用现有的 build:test 路径就能产 WebGAL start.txt.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const KOHAKU_DIR = join(PROJECT_ROOT, '.test-scenarios/csc-kohaku');

const SEG_ZERO_MARKER = '调查员醒来时';

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
  distractor?: { label: string; resultParas: string[] };
}

interface DialogueLine {
  speaker: string;
  text?: string;
  verbatimFromIdx?: string;
  stripPrefix?: string;
}

interface Chapter {
  title: string;
  sceneId: string | null;
  range: string;
}

interface EndingDef {
  id: string;
  priority?: number;
  name: string;
  type: 'bad' | 'happy' | 'normal';
  triggerExpr: string;
  outro: string[];
  footStamp?: string;
}

interface Scene {
  id: string;
  name: string;
  description: string;
  originalText?: string;
  inSceneActions?: Array<{ label: string; resultNarrate: string; sets?: Record<string, boolean | number | string> }>;
  exits?: Array<{ toScene: string; condition: string; requires?: Record<string, boolean | number | string>; sets?: Record<string, boolean | number | string> }>;
  [k: string]: unknown;
}

interface Scenario {
  scenes: Scene[];
  endings?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

async function loadSegments(): Promise<string[]> {
  const raw = await readFile(join(KOHAKU_DIR, 'kohaku.zh.txt'), 'utf-8');
  const lines = raw.split(/\r?\n/);
  const blocks: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (buf.length > 0) { blocks.push(buf.join('\n').trim()); buf = []; }
    } else { buf.push(line); }
  }
  if (buf.length > 0) blocks.push(buf.join('\n').trim());
  const filtered = blocks.filter((b) => !/^【.+】\s*$/.test(b) && !/^-{3,}$/.test(b));
  const z = filtered.findIndex((b) => b.includes(SEG_ZERO_MARKER));
  return z < 0 ? filtered : filtered.slice(z);
}

function parseRange(r: string): [number, number] {
  const [a, b] = r.split('-').map((x) => parseInt(x, 10));
  return [a, b];
}

function transformVerbatim(text: string): string {
  // 用户规则: "调查员" → "林夏"
  return text.replace(/调查员/g, '林夏');
}

// ─── 主合并逻辑 ──────────────────────────────────
async function main() {
  const segments = await loadSegments();
  const annotationsRaw = JSON.parse(await readFile(join(KOHAKU_DIR, 'annotations.json'), 'utf-8'));
  const annotations: Record<string, Annotation> = annotationsRaw.annotations;
  const chapters: Chapter[] = annotationsRaw.chapters;
  const expansions: Record<string, ExpandEntry> = JSON.parse(await readFile(join(KOHAKU_DIR, 'expansions.json'), 'utf-8')).expansions;
  const dialogues: Record<string, { lines: DialogueLine[] }> = JSON.parse(await readFile(join(KOHAKU_DIR, 'dialogues.json'), 'utf-8')).dialogues;
  const endingsRaw = JSON.parse(await readFile(join(KOHAKU_DIR, 'endings.json'), 'utf-8'));
  const endings: EndingDef[] = endingsRaw.endings;

  const v2: Scenario = JSON.parse(await readFile(join(KOHAKU_DIR, 'kohaku.v2.scenario.json'), 'utf-8'));
  console.log(`📖 v2: ${v2.scenes.length} 场景 · ${segments.length} 源段 · ${Object.keys(annotations).length} 标注`);

  const renderedDialogues = new Set<string>();

  // 每个 scene id 收集 narrate / inSceneActions
  const sceneNarrate = new Map<string, string[]>();
  const sceneInScene = new Map<string, Array<{ label: string; resultNarrate: string; sets?: Record<string, boolean | number | string> }>>();

  for (const ch of chapters) {
    if (!ch.sceneId) continue;
    const [start, end] = parseRange(ch.range);
    const lines = sceneNarrate.get(ch.sceneId) ?? [];

    for (let i = start; i <= end; i++) {
      const idx = String(i).padStart(3, '0');
      const ann = annotations[idx];
      if (!ann) continue;
      if (ann.tags.includes('d')) continue;
      const raw = segments[i] ?? '';

      // 优先级: ec dialogue > eb explore > expand A/D > verbatim > combat/check/flag
      if (ann.tags.includes('ec') && ann.dialogueKey) {
        if (renderedDialogues.has(ann.dialogueKey)) continue;
        renderedDialogues.add(ann.dialogueKey);
        const dlg = dialogues[ann.dialogueKey];
        if (dlg) {
          for (const l of dlg.lines) {
            let text = l.text;
            if (!text && l.verbatimFromIdx) {
              const sIdx = parseInt(l.verbatimFromIdx, 10);
              text = segments[sIdx];
              if (l.stripPrefix && text?.startsWith(l.stripPrefix)) text = text.slice(l.stripPrefix.length).trim();
              if (text) text = transformVerbatim(text);
            }
            if (text) lines.push(`${l.speaker}:${text}`);
          }
        }
        continue;
      }

      if (ann.expandKey && (ann.tags.includes('ea') || ann.tags.includes('ed'))) {
        const exp = expansions[ann.expandKey];
        if (exp?.paragraphs) lines.push(...exp.paragraphs);
        continue;
      }

      if (ann.expandKey && ann.tags.includes('eb')) {
        const exp = expansions[ann.expandKey];
        if (!exp) continue;
        if (exp.buttons && exp.buttons.length > 0) {
          for (const btn of exp.buttons) {
            sceneInScene.set(ch.sceneId, [
              ...(sceneInScene.get(ch.sceneId) ?? []),
              {
                label: btn.label,
                resultNarrate: btn.successParas.join(' '),
                ...(ann.flag ? { sets: parseFlagSets(ann.flag) } : {}),
              },
            ]);
          }
        } else if (exp.buttonLabel && exp.successParas) {
          const sets = ann.flag ? parseFlagSets(ann.flag) : undefined;
          sceneInScene.set(ch.sceneId, [
            ...(sceneInScene.get(ch.sceneId) ?? []),
            { label: exp.buttonLabel, resultNarrate: exp.successParas.join(' '), ...(sets ? { sets } : {}) },
          ]);
          if (exp.distractor) {
            sceneInScene.set(ch.sceneId, [
              ...(sceneInScene.get(ch.sceneId) ?? []),
              { label: exp.distractor.label, resultNarrate: exp.distractor.resultParas.join(' ') },
            ]);
          }
        }
        continue;
      }

      if (ann.tags.includes('v')) {
        if (raw) lines.push(transformVerbatim(raw));
        continue;
      }

      // combat / check / flag 不带 verbatim 时, 只 setVar (narrate 留给场景的主线)
      if (ann.tags.includes('c') && (ann.enemy || ann.enemyDataRef)) {
        // 战斗段不重复 narrate (已在前面战斗 narrate 处理), 跳过
        continue;
      }
    }

    sceneNarrate.set(ch.sceneId, lines);
  }

  // 把 sceneNarrate 写入对应 v2 scene
  let updated = 0;
  for (const scene of v2.scenes) {
    const lines = sceneNarrate.get(scene.id);
    if (lines && lines.length > 0) {
      const v3Text = lines.join('\n\n');
      scene.description = v3Text;
      // builder 的 pickPlaceholderNarrate 优先用 originalText, 必须同时覆盖
      scene.originalText = v3Text;
      updated++;
    }
    const inSceneActions = sceneInScene.get(scene.id);
    if (inSceneActions && inSceneActions.length > 0) {
      // 合并已有 (例如 v2 已经手写过的) + v3
      scene.inSceneActions = [...(scene.inSceneActions ?? []), ...inSceneActions];
    }
  }
  console.log(`✏️  ${updated} 场景的 description 被 v3 narrate 覆盖`);

  // 更新 endings (替换 v2.endings)
  v2.endings = endings.map((e) => ({
    id: e.id,
    name: e.name,
    narrate: e.outro,
    conditionExpr: e.triggerExpr === 'true' ? '' : e.triggerExpr,
  }));
  console.log(`🎯 ${endings.length} 结局已注入`);

  const outPath = join(KOHAKU_DIR, 'kohaku.v3.scenario.json');
  await writeFile(outPath, JSON.stringify(v2, null, 2), 'utf-8');
  console.log(`✅ 写入 ${outPath}`);
  console.log(`\n下一步: npm run build:test .test-scenarios/csc-kohaku/kohaku.v3.scenario.json`);
}

function parseFlagSets(spec: string): Record<string, boolean> {
  // "hasGun=true" / "hasGun,hasDoctrine" → {hasGun:true, hasDoctrine:true}
  const sets: Record<string, boolean> = {};
  for (const part of spec.split(/[,\s]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('=')) {
      const [k, v] = trimmed.split('=');
      sets[k.trim()] = v.trim() === 'true';
    } else if (/^[a-zA-Z_]\w*$/.test(trimmed)) {
      sets[trimmed] = true;
    }
  }
  return sets;
}

await main().catch((e: unknown) => {
  console.error('❌', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
