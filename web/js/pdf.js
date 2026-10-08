/**
 * 纯前端 PDF 1.4 写出器（server/pdfwrite.py 的浏览器移植版）。
 *
 * 目标：GitHub Pages 纯静态部署（没有后端），在浏览器里把若干张 canvas 变成
 * 一个合法 PDF：图片按「铺满整页」的方式内嵌为 JPEG（`/DCTDecode`），
 * xref / trailer / startxref 全部手写，**不依赖任何第三方库**。
 *
 * 结构完全对齐 server/pdfwrite.py：
 *
 *   1 0 obj  Catalog
 *   2 0 obj  Pages（/Count n）
 *   3 0 obj  Info（中文标题写成 UTF-16BE 十六进制串）
 *   之后每页 3 个对象：Page / Contents / Image XObject
 *
 * 注意 JS 的字符串→字节：PDF 结构部分是纯 ASCII，这里用手写字节拼装
 * （latin1 语义），绝不走 TextEncoder 之外的二进制编码；JPEG 字节原样拼入。
 *
 * `buildPdf` 是纯函数（不碰 DOM），可在 Node 里直接测试。
 */

/* ------------------------------------------------------------------ 常量 */

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72.0;
export const DEFAULT_TITLE = 'Journal Studio 手账';
export const DEFAULT_PAGE_W_MM = 148; // A5 竖版
export const DEFAULT_PAGE_H_MM = 210;
export const DEFAULT_CANVAS_QUALITY = 0.92;

/* ------------------------------------------------------------ 小工具 */

/** 毫米 → PDF 点（1 pt = 1/72 英寸）。 */
export function mmToPt(mm) {
  return (Number(mm) / MM_PER_INCH) * PT_PER_INCH;
}

/** `%.4f` 的固定小数格式化（与 Python 版输出逐字节一致）。 */
function fmt4(value) {
  return Number(value).toFixed(4);
}

/** 把 ASCII/latin1 字符串写成字节（每个 charCode 取低 8 位）。 */
function latin1(text) {
  const str = String(text);
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

/**
 * PDF 十六进制字符串（UTF-16BE 带 BOM），用于中文 /Title 等。
 * 非 BMP 码位按 UTF-16 代理对输出，与 Python 的 `encode("utf-16-be")` 一致。
 */
export function utf16Hex(text) {
  const bytes = [0xfe, 0xff];
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const rest = cp - 0x10000;
      const hi = 0xd800 + (rest >> 10);
      const lo = 0xdc00 + (rest & 0x3ff);
      bytes.push(hi >> 8, hi & 0xff, lo >> 8, lo & 0xff);
    } else {
      bytes.push(cp >> 8, cp & 0xff);
    }
  }
  let hex = '<';
  for (const byte of bytes) hex += byte.toString(16).toUpperCase().padStart(2, '0');
  return `${hex}>`;
}

/** 自增长的字节缓冲：按「块」累加，最后一次性拼成 Uint8Array。 */
class ByteWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  /** 写入 latin1/ASCII 文本。 */
  text(str) {
    this.push(latin1(str));
  }

  /** 写入原始字节（JPEG 走这里，原样拼进去）。 */
  push(bytes) {
    if (!bytes || !bytes.length) return;
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  toUint8Array() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

function toBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new Error(`${label}不是有效的字节数据`);
}

function positiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.max(1, Math.round(num));
}

function clampQuality(quality, fallback, min, max) {
  const num = Number(quality);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/* ------------------------------------------------------- 核心：buildPdf */

/**
 * 把若干页 JPEG 组装成一个合法的 PDF 1.4 文件。
 *
 * @param {Array<{jpeg: Uint8Array, width: number, height: number}>} pages
 *        每页一张已经编码好的 JPEG 与它的像素尺寸。
 * @param {object} [options]
 * @param {number} [options.pageWmm=148] 页面宽（毫米，含出血尺寸）
 * @param {number} [options.pageHmm=210] 页面高（毫米）
 * @param {number} [options.dpi=300]     目标分辨率（仅用于声明/兼容，图片已按此编码）
 * @param {number} [options.quality]     兼容 Python 版签名；canvas 编码质量由调用方决定
 * @param {string} [options.title]       文档标题（中文写入 UTF-16BE 十六进制串）
 * @returns {Uint8Array} 完整 PDF 字节
 */
export function buildPdf(pages, { pageWmm = DEFAULT_PAGE_W_MM, pageHmm = DEFAULT_PAGE_H_MM, dpi = 300, quality, title } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error('没有可导出的页面');
  }

  const widthMm = Number(pageWmm);
  const heightMm = Number(pageHmm);
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm)) {
    throw new Error('页面尺寸不合法');
  }
  if (widthMm <= 0 || heightMm <= 0) {
    throw new Error('页面尺寸必须大于 0');
  }
  const safeDpi = positiveInt(dpi, 300);
  // quality / dpi 保留在签名里（与 Python 版同构）；JPEG 编码在 canvas 阶段完成
  void clampQuality(quality, 92, 1, 100);
  void safeDpi;

  const encoded = [];
  pages.forEach((page, index) => {
    if (!page || typeof page !== 'object') {
      throw new Error(`第 ${index + 1} 页缺少图片数据`);
    }
    const jpeg = toBytes(page.jpeg, `第 ${index + 1} 页图片`);
    if (jpeg.length === 0) throw new Error(`第 ${index + 1} 页图片是空的`);
    const pixelW = positiveInt(page.width, 0);
    const pixelH = positiveInt(page.height, 0);
    if (!pixelW || !pixelH) throw new Error(`第 ${index + 1} 页图片尺寸非法`);
    encoded.push({ jpeg, pixelW, pixelH });
  });

  const widthPt = mmToPt(widthMm);
  const heightPt = mmToPt(heightMm);
  const pageCount = encoded.length;
  const size = 3 + 3 * pageCount + 1; // 1 Catalog + 2 Pages + 3 Info + 每页 3 个，再含 0 号自由对象
  const kids = [];
  for (let i = 0; i < pageCount; i += 1) kids.push(`${4 + 3 * i} 0 R`);

  const out = new ByteWriter();
  const offsets = new Float64Array(size);

  const begin = (number) => {
    offsets[number] = out.length;
    out.text(`${number} 0 obj\n`);
  };

  // 文件头（第二行是 PDF 规范建议的二进制标记）
  out.push(latin1('%PDF-1.4\n'));
  out.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // 1 —— 文档目录
  begin(1);
  out.text('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2 —— 页面树
  begin(2);
  out.text(`<< /Type /Pages /Count ${pageCount} /Kids [${kids.join(' ')}] >>\nendobj\n`);

  // 3 —— 文档信息（中文标题用 UTF-16BE 十六进制串）
  begin(3);
  out.text(
    `<< /Title ${utf16Hex(title || DEFAULT_TITLE)}`
    + ' /Producer (Journal Studio 1.0)'
    + ' /Creator (Journal Studio 1.0) >>\nendobj\n',
  );

  // 每页：Page / Contents / Image XObject
  encoded.forEach((page, index) => {
    const pageNumber = 4 + 3 * index;
    const contentNumber = pageNumber + 1;
    const imageNumber = pageNumber + 2;
    const content = latin1(`q\n${fmt4(widthPt)} 0 0 ${fmt4(heightPt)} 0 0 cm\n/Im0 Do\nQ\n`);

    begin(pageNumber);
    out.text(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt4(widthPt)} ${fmt4(heightPt)}] `
      + `/Resources << /XObject << /Im0 ${imageNumber} 0 R >> /ProcSet [/PDF /ImageC] >> `
      + `/Contents ${contentNumber} 0 R >>\nendobj\n`,
    );

    begin(contentNumber);
    out.text(`<< /Length ${content.length} >>\nstream\n`);
    out.push(content);
    out.text('\nendstream\nendobj\n');

    begin(imageNumber);
    out.text(
      `<< /Type /XObject /Subtype /Image /Width ${page.pixelW} /Height ${page.pixelH} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    out.push(page.jpeg);
    out.text('\nendstream\nendobj\n');
  });

  // xref 表（每条固定 20 字节）
  const xrefOffset = out.length;
  out.text(`xref\n0 ${size}\n`);
  out.text('0000000000 65535 f \n');
  for (let number = 1; number < size; number += 1) {
    out.text(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
  }

  // trailer + startxref + EOF
  out.text(
    `trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return out.toUint8Array();
}

/* --------------------------------------------------- 浏览器：canvas 路径 */

/** 把 canvas 转 JPEG 字节。支持 HTMLCanvasElement 与 OffscreenCanvas。 */
export async function canvasToJpeg(canvas, quality = DEFAULT_CANVAS_QUALITY) {
  if (!canvas || typeof canvas !== 'object') throw new Error('缺少画布对象');
  const width = positiveInt(canvas.width, 0);
  const height = positiveInt(canvas.height, 0);
  if (!width || !height) throw new Error('画布尺寸不合法，无法导出');

  const q = clampQuality(quality, DEFAULT_CANVAS_QUALITY, 0.01, 1);
  let blob = null;

  if (typeof canvas.convertToBlob === 'function') {
    // OffscreenCanvas
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: q });
  } else if (typeof canvas.toBlob === 'function') {
    blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('画布导出 JPEG 失败（可能是跨域图片污染了画布）'))),
        'image/jpeg',
        q,
      );
    });
  } else {
    throw new Error('当前画布不支持导出 JPEG');
  }

  const jpeg = new Uint8Array(await blob.arrayBuffer());
  if (!jpeg.length) throw new Error('画布导出的 JPEG 为空');
  return { jpeg, width, height };
}

/** 多张 canvas → PDF Blob（浏览器里直接下载用）。 */
export async function canvasesToPdfBlob(canvases, opts = {}) {
  const list = Array.from(canvases || []);
  if (!list.length) throw new Error('没有可导出的页面');

  const {
    quality = DEFAULT_CANVAS_QUALITY,
    pageWmm = DEFAULT_PAGE_W_MM,
    pageHmm = DEFAULT_PAGE_H_MM,
    dpi = 300,
    title,
  } = opts || {};

  const pages = [];
  for (const canvas of list) pages.push(await canvasToJpeg(canvas, quality));

  const bytes = buildPdf(pages, { pageWmm, pageHmm, dpi, quality, title });
  if (typeof Blob === 'undefined') throw new Error('当前环境不支持 Blob');
  return new Blob([bytes], { type: 'application/pdf' });
}

export default { buildPdf, canvasToJpeg, canvasesToPdfBlob, mmToPt, utf16Hex };
