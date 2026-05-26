// CLI: 把 PDF 剧本解析成 Scenario JSON
//
// 跑法：npm run parse <pdf-path> [--out <output.json>] [--hint "CYOA 编号体"]
// 例：  npm run parse .test-scenarios/Alone_Against_the_Flames.pdf --out /tmp/aatf.json

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OpenAICompatibleProvider } from '../src/llm/openai-compatible.js';
import { extractTextFromPdf } from '../src/parser/pdf-extract.js';
import { parseScenarioFromText } from '../src/parser/scenario-from-text.js';

// ─── 简易 CLI 参数解析 ──────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法: npm run parse <pdf-path> [--out <out.json>] [--hint "..."]');
  process.exit(1);
}

const pdfPath = resolve(args[0]!);
let outPath: string | null = null;
let hint: string | null = null;
let truncate: number | null = null;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1]) {
    outPath = resolve(args[++i]!);
  } else if (args[i] === '--hint' && args[i + 1]) {
    hint = args[++i]!;
  } else if (args[i] === '--truncate' && args[i + 1]) {
    truncate = parseInt(args[++i]!, 10);
  }
}

// ─── env ─────────────────────────────────────────────

const baseUrl = process.env['LLM_BASE_URL'];
const apiKey = process.env['LLM_API_KEY'];
const model = process.env['LLM_MODEL'] ?? 'gpt-5.4-mini';
if (!baseUrl || !apiKey) {
  console.error('❌ 缺 LLM_BASE_URL / LLM_API_KEY');
  process.exit(1);
}

// ─── 主流程 ────────────────────────────────────────

async function main() {
  console.log(`📄 抽取 PDF: ${pdfPath}`);
  const extracted = await extractTextFromPdf(pdfPath);
  console.log(`   ${extracted.totalPages} 页 · ${extracted.fullText.length} 字符 · ~${extracted.approxTokens} tokens`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (extracted.approxTokens > 80_000) {
    console.warn(`⚠️  文本估算 ${extracted.approxTokens} tokens 可能超出某些模型 context；如解析失败需要分块`);
  }

  const provider = new OpenAICompatibleProvider({
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    model,
    timeoutMs: 180_000,  // PDF 解析慢，给 3 分钟
  });

  console.log(`🤖 LLM 解析（${model}）...\n`);
  const t0 = Date.now();
  const parseOpts: { hint?: string; truncateInputChars?: number } = {};
  if (hint) parseOpts.hint = hint;
  if (truncate) parseOpts.truncateInputChars = truncate;
  if (truncate) console.log(`✂️  截断输入到前 ${truncate} 字符（兜底 gateway timeout）\n`);
  const result = await parseScenarioFromText(extracted.fullText, provider, parseOpts);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`⏱  耗时 ${dt}s`);
  if (result.usage) {
    console.log(`   prompt ${result.usage.promptTokens} + completion ${result.usage.completionTokens} = ${result.usage.totalTokens} tokens`);
  }

  if (!result.ok) {
    console.error('\n❌ 解析失败');
    result.issues?.forEach((i) => {
      console.error(`   [${i.severity}] ${i.path}: ${i.message}`);
    });
    if (result.rawLlmOutput) {
      // 把 raw 输出写到磁盘方便诊断
      const debugPath = '/tmp/parse-scenario-raw.txt';
      await writeFile(debugPath, result.rawLlmOutput, 'utf-8');
      console.error(`\nRAW LLM 输出存到 ${debugPath} 供 debug`);
    }
    process.exit(2);
  }

  console.log(`\n✅ 解析成功 · 《${result.scenario!.title}》`);
  console.log(`   场景数: ${result.scenario!.scenes.length}`);
  console.log(`   NPC 数: ${result.scenario!.npcs.length}`);
  console.log(`   起点:   ${result.scenario!.startSceneId}`);
  console.log(`   场景列表:`);
  result.scenario!.scenes.forEach((s) => {
    console.log(`     - ${s.id} · ${s.name}`);
  });

  // 保存
  const finalOut = outPath ?? '/tmp/scenario-out.json';
  await writeFile(finalOut, JSON.stringify(result.scenario, null, 2), 'utf-8');
  console.log(`\n💾 写入 ${finalOut}`);
}

await main().catch((err: unknown) => {
  console.error('\n❌ 异常:');
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
