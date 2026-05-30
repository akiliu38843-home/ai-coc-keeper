// CLI: 把已经是纯文本的剧本 (中文 .txt) 解析成 Scenario JSON
//
// 跟 parse-scenario.ts 的区别: 跳过 PDF 抽取, 直接吃 text.
// 用于已经翻译好 / HTML 抽出来的剧本.
//
// 跑法: npm run parse:text <txt-path> [--out <out.json>] [--hint "..."]

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OpenAICompatibleProvider } from '../src/llm/openai-compatible.js';
import { parseScenarioFromText, enrichWithOriginalText } from '../src/parser/scenario-from-text.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法: npm run parse:text <txt-path> [--out <out.json>] [--hint "..."] [--truncate <N>]');
  process.exit(1);
}

const txtPath = resolve(args[0]!);
let outPath: string | null = null;
let hint: string | null = null;
let truncate: number | null = null;
let v1Mode = false;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1]) outPath = resolve(args[++i]!);
  else if (args[i] === '--hint' && args[i + 1]) hint = args[++i]!;
  else if (args[i] === '--truncate' && args[i + 1]) truncate = parseInt(args[++i]!, 10);
  else if (args[i] === '--v1') v1Mode = true;
}

const baseUrl = process.env['LLM_BASE_URL'];
const apiKey = process.env['LLM_API_KEY'];
const model = process.env['LLM_MODEL'] ?? 'gpt-5.4-mini';
if (!baseUrl || !apiKey) {
  console.error('❌ 缺 LLM_BASE_URL / LLM_API_KEY');
  process.exit(1);
}

async function main() {
  console.log(`📄 读文本: ${txtPath}`);
  const fullText = await readFile(txtPath, 'utf-8');
  // 简单估 tokens (中文 1 token ≈ 1.5 字符)
  const approxTokens = Math.ceil(fullText.length / 1.5);
  console.log(`   ${fullText.length} 字符 · ~${approxTokens} tokens`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const provider = new OpenAICompatibleProvider({
    baseUrl: baseUrl!, apiKey: apiKey!, model, timeoutMs: 180_000,
  });

  console.log(`🤖 LLM 解析（${model}）...\n`);
  const t0 = Date.now();
  // V1 用 2-pass: pass1 拿结构 (V0 风格, 因为 1-shot v1 输出量超 gateway timeout),
  // pass2 并行给每场景 enrich originalText
  const parseOpts: { hint?: string; truncateInputChars?: number } = {};
  if (hint) parseOpts.hint = hint;
  if (truncate) parseOpts.truncateInputChars = truncate;
  if (v1Mode) console.log('🔬 V1 模式 · 2-pass: pass1 抽结构, pass2 并行抽 originalText\n');
  const result = await parseScenarioFromText(fullText, provider, parseOpts);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`⏱  耗时 ${dt}s`);
  if (result.usage) {
    console.log(`   prompt ${result.usage.promptTokens} + completion ${result.usage.completionTokens} = ${result.usage.totalTokens} tokens`);
  }

  if (!result.ok) {
    console.error('\n❌ 解析失败');
    result.issues?.forEach((i) => console.error(`   [${i.severity}] ${i.path}: ${i.message}`));
    if (result.rawLlmOutput) {
      await writeFile('/tmp/parse-text-raw.txt', result.rawLlmOutput, 'utf-8');
      console.error(`\nRAW LLM 输出存到 /tmp/parse-text-raw.txt 供 debug`);
    }
    process.exit(2);
  }

  console.log(`\n✅ Pass 1 解析成功 · 《${result.scenario!.title}》`);
  console.log(`   场景数: ${result.scenario!.scenes.length}`);
  console.log(`   NPC 数: ${result.scenario!.npcs.length}`);
  console.log(`   起点:   ${result.scenario!.startSceneId}`);
  result.scenario!.scenes.forEach((s) => console.log(`     - ${s.id} · ${s.name}`));

  let finalScenario = result.scenario!;
  if (v1Mode) {
    console.log(`\n🔬 Pass 2: 并行给 ${finalScenario.scenes.length} 个场景抽 originalText...`);
    const t2 = Date.now();
    finalScenario = await enrichWithOriginalText(finalScenario, fullText, provider);
    const dt2 = ((Date.now() - t2) / 1000).toFixed(1);
    const enriched = finalScenario.scenes.filter((s) => s.originalText).length;
    console.log(`   ⏱  pass2 耗时 ${dt2}s · ${enriched}/${finalScenario.scenes.length} 场景挂上 originalText`);
    finalScenario.scenes.forEach((s) => {
      const len = s.originalText?.length ?? 0;
      console.log(`     - ${s.id}: originalText ${len} 字`);
    });
  }

  if (outPath) {
    await writeFile(outPath, JSON.stringify(finalScenario, null, 2), 'utf-8');
    console.log(`\n💾 写入 ${outPath}`);
  }
}

await main().catch((e) => {
  console.error('❌ 异常:', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
