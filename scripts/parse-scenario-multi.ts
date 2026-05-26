// W7 多 pass CLI: 全本 PDF → 完整 Scenario JSON
//
// 跑法：
//   npm run parse:multi <pdf> [--out <out.json>] [--outline-only] [--detail-limit N]

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OpenAICompatibleProvider } from '../src/llm/openai-compatible.js';
import { extractTextFromPdf } from '../src/parser/pdf-extract.js';
import { multiPassParse } from '../src/parser/multi-pass-parser.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法: npm run parse:multi <pdf> [--out <out>] [--outline-only] [--detail-limit N]');
  process.exit(1);
}

const pdfPath = resolve(args[0]!);
let outPath: string | null = null;
let outlineOnly = false;
let detailLimit: number | null = null;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1]) outPath = resolve(args[++i]!);
  else if (args[i] === '--outline-only') outlineOnly = true;
  else if (args[i] === '--detail-limit' && args[i + 1]) detailLimit = parseInt(args[++i]!, 10);
}

const baseUrl = process.env['LLM_BASE_URL'];
const apiKey = process.env['LLM_API_KEY'];
const model = process.env['LLM_MODEL'] ?? 'gpt-5.4-mini';
if (!baseUrl || !apiKey) {
  console.error('❌ 缺 LLM_BASE_URL / LLM_API_KEY');
  process.exit(1);
}

async function main() {
  console.log(`📄 抽取 PDF: ${pdfPath}`);
  const extracted = await extractTextFromPdf(pdfPath);
  console.log(`   ${extracted.totalPages} 页 · ${extracted.fullText.length} 字符 · ~${extracted.approxTokens} tokens`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const provider = new OpenAICompatibleProvider({
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    model,
    timeoutMs: 90_000,
  });

  console.log(`🤖 LLM: ${model}`);
  console.log(`📐 Mode: ${outlineOnly ? 'outline-only' : `multi-pass (detail limit: ${detailLimit ?? 'all'})`}\n`);

  const t0 = Date.now();
  const result = await multiPassParse(extracted, provider, {
    ...(outlineOnly ? { outlineOnly: true } : {}),
    ...(detailLimit != null ? { detailLimit } : {}),
    detailDelayMs: 500,
    onProgress: (info) => {
      if (info.stage === 'outline') {
        console.log(`[outline] 跑 pass 1...`);
      } else {
        console.log(`[detail ${info.current}/${info.total}] ${info.sceneName ?? ''}`);
      }
    },
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n⏱  总耗时 ${dt}s`);
  if (result.passInfo) {
    console.log(`   detail 调用: ${result.passInfo.detailCallCount}`);
    if (result.passInfo.failedScenes.length > 0) {
      console.log(`   失败 scene: ${result.passInfo.failedScenes.join(', ')}`);
    }
  }

  if (!result.ok) {
    console.error('\n❌ 解析失败');
    result.issues?.forEach((i) => console.error(`   [${i.severity}] ${i.path}: ${i.message}`));
    if (result.scenario) {
      const debugOut = '/tmp/scenario-partial.json';
      await writeFile(debugOut, JSON.stringify(result.scenario, null, 2), 'utf-8');
      console.error(`部分产出已存到 ${debugOut} 供 debug`);
    }
    process.exit(2);
  }

  console.log(`\n✅ 解析成功 · 《${result.scenario!.title}》`);
  console.log(`   场景数: ${result.scenario!.scenes.length}`);
  console.log(`   NPC 数: ${result.scenario!.npcs.length}`);
  console.log(`   检定总数: ${result.scenario!.scenes.reduce((n, s) => n + (s.expectedChecks?.length ?? 0), 0)}`);
  console.log(`   心智触发总数: ${result.scenario!.scenes.reduce((n, s) => n + (s.sanityTriggers?.length ?? 0), 0)}`);
  console.log(`\n   场景列表:`);
  result.scenario!.scenes.forEach((s) => {
    const c = s.expectedChecks?.length ?? 0;
    const st = s.sanityTriggers?.length ?? 0;
    console.log(`     - ${s.id} · ${s.name} (checks:${c} sanity:${st})`);
  });

  const finalOut = outPath ?? '/tmp/scenario-multi.json';
  await writeFile(finalOut, JSON.stringify(result.scenario, null, 2), 'utf-8');
  console.log(`\n💾 写入 ${finalOut}`);
}

await main().catch((err: unknown) => {
  console.error('\n❌ 异常:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
