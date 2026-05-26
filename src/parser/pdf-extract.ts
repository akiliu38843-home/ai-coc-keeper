// PDF → 纯文本抽取 —— 用 unpdf（pdfjs-dist 的 serverless-friendly 重打包）
//
// 选 unpdf 而非 pdfjs-dist 直接：
// - unpdf 修了 Node ESM 兼容
// - 同样基于 Mozilla pdfjs，但 dist 更小、API 更现代
// 不做 OCR；扫描版 PDF 不在 V0 scope。
//
// 注意：如果 PDF 文件被代理截断 / 损坏，会在 getDocumentProxy 阶段
// 报 "Invalid Root reference" / "missing trailer" 等错。
// 重新下载完整 PDF（用更长 --max-time）即可。

import { readFile } from 'node:fs/promises';

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface PdfExtractResult {
  totalPages: number;
  pages: PdfPage[];
  fullText: string;
  /** 粗略 token 估算（英文 ~4 字符 = 1 token，中文 ~1.5 字符 = 1 token，混合取中）*/
  approxTokens: number;
}

/**
 * 从 PDF 文件抽取所有文本。
 *
 * @example
 * const result = await extractTextFromPdf('./scenario.pdf');
 * console.log(`${result.totalPages} 页, ~${result.approxTokens} tokens`);
 */
export async function extractTextFromPdf(
  filePath: string,
): Promise<PdfExtractResult> {
  const { getDocumentProxy, extractText } = await import('unpdf');

  const buf = await readFile(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const result = await extractText(pdf, { mergePages: false });
  const textArray = result.text as string[];

  const pages: PdfPage[] = textArray.map((text, i) => ({
    pageNumber: i + 1,
    text,
  }));
  const fullText = pages
    .map((p) => `[Page ${p.pageNumber}]\n${p.text}`)
    .join('\n\n');
  // 取 ~3 字符/token 折中（中英混合）
  const approxTokens = Math.ceil(fullText.length / 3);

  return {
    totalPages: pdf.numPages,
    pages,
    fullText,
    approxTokens,
  };
}
