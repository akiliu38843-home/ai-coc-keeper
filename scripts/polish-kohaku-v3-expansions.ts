// polish-kohaku-v3-expansions.ts
//
// LLM 只 polish 我自己写的 expansions, 不看原文, 不生成新内容.
// 用 OpenAI 兼容 endpoint (复用项目 .env 的 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL).
//
// 输入: expansions.json (我的 scaffold)
// 输出: expansions.json 覆盖, 备份到 .pre-polish.bak

import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const EXPANSIONS_PATH = join(PROJECT_ROOT, '.test-scenarios/csc-kohaku/expansions.json');
const BACKUP_PATH = EXPANSIONS_PATH + '.pre-polish.bak';

const BASE_URL = process.env.LLM_BASE_URL ?? '';
const API_KEY = process.env.LLM_API_KEY ?? '';
const MODEL = process.env.POLISH_MODEL ?? process.env.LLM_MODEL ?? '';

if (!BASE_URL || !API_KEY || !MODEL) {
  console.error('❌ 缺 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL (.env)');
  process.exit(1);
}

interface ExpandEntry {
  kind: 'A' | 'B' | 'C' | 'D';
  paragraphs?: string[];
  buttonLabel?: string;
  successParas?: string[];
  failParas?: string[];
  buttons?: Array<{ label: string; successParas: string[] }>;
}

interface Expansions {
  _meta: unknown;
  expansions: Record<string, ExpandEntry>;
}

const SYSTEM_PROMPT = `你是一名互动叙事文本润色师, 专门改写 TRPG → galgame 适配里的扩写段.

任务: 用户给你一段他自己写的扩写 (中文创作 scaffold), 你做的是**只 polish 这段创作**, 不写新场景, 不偏离结构.

风格规则 (硬性):
1. 每段 ≤60 个汉字字符, 1-2 句为单位
2. 卷宗 / 克苏鲁 mood: 冷峻、感官细节 (光、味、声、触), 内心收敛
3. 林夏第三人称限定视角 (主角名"林夏")
4. 禁止 TRPG 黑话: "调查员" / "KP" / "〈技能〉" / "SAN" / "DEX" / "投骰子" 等
5. 段数维持原 scaffold 段数 (3-4 段最佳, 不许压缩成 1 段)
6. 关键结构 (谁做了什么 / 拿到什么物品 / 谁出现) 一字不许动
7. 只改: 节奏、感官 detail、句序、副词、形容词

输出严格 JSON 对象 (无 markdown 包裹): {"polished": ["段1", "段2", ...]}`;

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function callLlm(paragraphs: string[], context: { kind: string; key: string; subType?: string }): Promise<string[] | null> {
  const userPrompt = `场景类型: expand-${context.kind} (key=${context.key})${context.subType ? ` · ${context.subType}` : ''}

我的 scaffold (${paragraphs.length} 段):
${paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n')}

请按系统规则 polish, 输出 JSON.`;

  const url = `${BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 90_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`   ⚠️ HTTP ${res.status}: ${text.slice(0, 120)}`);
      return null;
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? '';
    const match = raw.match(/\{[\s\S]*"polished"[\s\S]*\}/);
    if (!match) {
      console.warn(`   ⚠️ 解析失败: ${raw.slice(0, 120)}`);
      return null;
    }
    const parsed = JSON.parse(match[0]) as { polished?: unknown };
    if (!Array.isArray(parsed.polished)) return null;
    return parsed.polished.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  } catch (e) {
    console.warn(`   ⚠️ 请求失败: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function main(): Promise<void> {
  if (!await fileExists(BACKUP_PATH)) {
    await copyFile(EXPANSIONS_PATH, BACKUP_PATH);
    console.log(`💾 备份 ${BACKUP_PATH}`);
  }

  const raw = await readFile(EXPANSIONS_PATH, 'utf-8');
  const data = JSON.parse(raw) as Expansions;
  const entries = Object.entries(data.expansions);
  console.log(`📖 加载 ${entries.length} 条 expansions, 模型 ${MODEL}\n`);

  let polished = 0, skipped = 0, failed = 0;
  const t0 = Date.now();

  for (let i = 0; i < entries.length; i++) {
    const [key, entry] = entries[i];
    const prefix = `[${(i + 1).toString().padStart(2, '0')}/${entries.length}] ${key}`;

    if (entry.paragraphs && entry.paragraphs.length > 0) {
      const result = await callLlm(entry.paragraphs, { kind: entry.kind, key });
      if (result && result.length > 0) {
        entry.paragraphs = result;
        polished++;
        console.log(`✏️  ${prefix} · ${result.length} 段 polish`);
      } else { failed++; console.log(`❌ ${prefix} · 保留 scaffold`); }
    } else if (entry.successParas && entry.successParas.length > 0) {
      const result = await callLlm(entry.successParas, { kind: entry.kind, key, subType: `按钮 [${entry.buttonLabel ?? '?'}]` });
      if (result && result.length > 0) {
        entry.successParas = result;
        polished++;
        console.log(`✏️  ${prefix} · 按钮 ${result.length} 段 polish`);
      } else { failed++; console.log(`❌ ${prefix} · 失败`); }
    } else if (entry.buttons && entry.buttons.length > 0) {
      let anyOk = false;
      for (const btn of entry.buttons) {
        const result = await callLlm(btn.successParas, { kind: entry.kind, key, subType: `按钮 [${btn.label}]` });
        if (result && result.length > 0) {
          btn.successParas = result;
          anyOk = true;
        }
      }
      if (anyOk) { polished++; console.log(`✏️  ${prefix} · 多按钮 polish`); }
      else { failed++; console.log(`❌ ${prefix} · 多按钮全失败`); }
    } else {
      skipped++;
      console.log(`⏭️  ${prefix} · 无可 polish 字段`);
    }

    if (i < entries.length - 1) await new Promise((r) => setTimeout(r, 200));
  }

  await writeFile(EXPANSIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ ${polished} polish · ${skipped} skip · ${failed} fail · ${dt}s`);
}

await main().catch((e: unknown) => {
  console.error('❌', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
