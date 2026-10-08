/**
 * web/js/pdf.js 自检（node:test）。
 *
 *   运行： node --test tests/test_pdf_js.mjs
 *   或：   node tests/test_pdf_js.mjs
 *
 * 思路：
 *  1. 先用 Python + Pillow 生成 3 张**真实 JPEG**（第三方编码器产物，不是我们编的）；
 *  2. 用 buildPdf 组装 PDF，逐字节校验 xref / trailer / startxref / %%EOF 等结构；
 *  3. 把 PDF 写盘，再交给 Python + Pillow 按 xref 与 /Length 反解出内嵌 JPEG，
 *     与输入文件**逐字节比对**并复检格式/像素；
 *  4. 额外用 Windows 原生 PDF 解析器（WinRT Windows.Data.Pdf）读 PageCount 交叉验证。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildPdf, canvasToJpeg, canvasesToPdfBlob, mmToPt, utf16Hex, DEFAULT_TITLE } from '../web/js/pdf.js';

const PYTHON = process.env.JOURNAL_PYTHON
  || 'C:\\Users\\AT1556\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';

/* ------------------------------------------------------------ 夹具准备 */

let tmpDir = null;
let fixtures = null;

const GEN_PY = `
import json, os, sys
from PIL import Image

out_dir = sys.argv[1]
specs = [
    ((1240, 1754), (244, 214, 227), "page_a"),
    ((1240, 1754), (206, 224, 240), "page_b"),
    ((900, 600),   (210, 240, 214), "page_c"),
]
pages = []
for size, color, name in specs:
    image = Image.new("RGB", size, color)
    # 撒一点噪点，避免纯色块压出来的 JPEG 过小、不具代表性
    pixels = image.load()
    for y in range(0, size[1], 7):
        for x in range(0, size[0], 11):
            pixels[x, y] = ((color[0] + x) % 256, (color[1] + y) % 256, (color[2] + x + y) % 256)
    file_path = os.path.join(out_dir, name + ".jpg")
    image.save(file_path, format="JPEG", quality=88, optimize=True)
    pages.append({
        "path": file_path,
        "bytes": os.path.getsize(file_path),
        "width": size[0],
        "height": size[1],
    })
print(json.dumps(pages))
`;

/** Python + Pillow：按 xref 找对象、按 /Length 切出内嵌 JPEG，与源文件逐字节比对。 */
const CHECK_PY = `
import io, json, re, sys
from PIL import Image

pdf_path = sys.argv[1]
sources = json.loads(sys.argv[2])
data = open(pdf_path, "rb").read()

report = {"pdf_bytes": len(data), "objects": 0, "images": [], "errors": []}

match = re.search(rb"startxref\\s+(\\d+)\\s*%%EOF", data)
if not match:
    report["errors"].append("找不到 startxref")
    print(json.dumps(report)); sys.exit(0)
xref_off = int(match.group(1))
report["startxref_points_to_xref"] = data[xref_off:xref_off + 4] == b"xref"

header = re.match(rb"xref\\r?\\n(\\d+) (\\d+)\\r?\\n", data[xref_off:])
start_num, size = int(header.group(1)), int(header.group(2))
report["xref_start"] = start_num
report["xref_size"] = size
entries = xref_off + header.end()

offsets = {}
for number in range(1, size):
    entry = data[entries + 20 * number: entries + 20 * number + 20]
    offset = int(entry[:10])
    offsets[number] = offset
report["objects"] = len(offsets)

for number in sorted(offsets):
    seg = data[offsets[number]:offsets[number] + 2000]
    info = re.match(
        rb"\\d+ 0 obj\\n<< /Type /XObject /Subtype /Image /Width (\\d+) /Height (\\d+) "
        rb"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length (\\d+) >>\\nstream\\n",
        seg)
    if not info:
        continue
    width, height, length = (int(info.group(i)) for i in (1, 2, 3))
    body = offsets[number] + info.end()
    blob = data[body:body + length]
    entry_report = {
        "object_number": number,
        "declared_width": width,
        "declared_height": height,
        "declared_length": length,
        "extracted_bytes": len(blob),
        "jpeg_magic": blob[:3] == b"\\xff\\xd8\\xff",
    }
    try:
        with Image.open(io.BytesIO(blob)) as image:
            image.load()
            entry_report["pillow_format"] = image.format
            entry_report["pillow_size"] = list(image.size)
    except Exception as exc:
        entry_report["pillow_error"] = str(exc)
    image_index = len(report["images"])
    source_path = sources[image_index]["path"] if image_index < len(sources) else None
    if source_path:
        original = open(source_path, "rb").read()
        entry_report["identical_to_source"] = (original == blob)
    report["images"].append(entry_report)

print(json.dumps(report))
`;

function ensureFixtures() {
  if (fixtures) return fixtures;
  tmpDir = mkdtempSync(path.join(tmpdir(), 'journal-pdf-js-'));
  const raw = execFileSync(PYTHON, ['-c', GEN_PY, tmpDir], { encoding: 'utf8', timeout: 120000 });
  const parsed = JSON.parse(raw.trim().split(/\r?\n/).pop());
  fixtures = parsed.map((item) => ({ ...item, data: new Uint8Array(readFileSync(item.path)) }));
  return fixtures;
}

function pdfPages(limit) {
  return ensureFixtures().slice(0, limit).map((item) => ({
    jpeg: item.data,
    width: item.width,
    height: item.height,
  }));
}

function writeTempPdf(bytes, name = 'out.pdf') {
  ensureFixtures();
  const target = path.join(tmpDir, name);
  writeFileSync(target, Buffer.from(bytes));
  return target;
}

function latin1(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let text = '';
  const step = 8192;
  for (let i = 0; i < bytes.length; i += step) {
    text += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return text;
}

// 3 页 PDF（A5 @300dpi），整个文件只生成一次，多个断言共用
let pdf3 = null;
let text3 = null;
const pdf3Path = () => writeTempPdf(pdf3, 'three-pages.pdf');

before(() => {
  ensureFixtures();
  pdf3 = buildPdf(pdfPages(3), { pageWmm: 148, pageHmm: 210, dpi: 300, title: '手账工坊 2026' });
  text3 = latin1(pdf3);
});

after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------ 测试用例 */

test('Python/Pillow 生成了 3 张真实 JPEG', () => {
  const items = ensureFixtures();
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.deepEqual(Array.from(item.data.subarray(0, 3)), [0xff, 0xd8, 0xff], '缺少 JPEG 魔数');
    assert.deepEqual(Array.from(item.data.subarray(-2)), [0xff, 0xd9], '缺少 JPEG 结束标记');
    assert.equal(item.data.length, item.bytes);
    assert.ok(item.bytes > 20000, `JPEG 太小，不像真实图：${item.bytes}`);
  }
  console.log(`  输入 JPEG：${items.map((i) => `${i.width}×${i.height} ${i.bytes}B`).join('，')}`);
});

test('3 页 PDF：文件头 / Catalog / Count / DCTDecode / %%EOF 齐全', () => {
  assert.ok(pdf3 instanceof Uint8Array);
  assert.ok(text3.startsWith('%PDF-1.4'));
  assert.equal(text3.slice(9, 15), '%\u00e2\u00e3\u00cf\u00d3\n', '缺少二进制标记行');
  assert.ok(text3.includes('/Type /Catalog'));
  assert.ok(text3.includes('/Type /Pages'));
  assert.ok(text3.includes('/Count 3'));
  assert.equal((text3.match(/\/Type \/Page[^s]/g) || []).length, 3, '应有 3 个 /Type /Page');
  assert.equal((text3.match(/\/DCTDecode/g) || []).length, 3);
  assert.ok(text3.includes('/MediaBox [0 0 419.5276 595.2756]'), '148×210mm 应换算成 419.5276×595.2756pt');
  assert.ok(text3.trimEnd().endsWith('%%EOF'));
  assert.ok(text3.includes('/Root 1 0 R'));
  assert.ok(text3.includes('/Info 3 0 R'));
});

test('obj 与 endobj 一一配对', () => {
  const objects = (text3.match(/\d+ 0 obj/g) || []).length;
  const ends = (text3.match(/endobj/g) || []).length;
  assert.equal(objects, ends, `obj=${objects} endobj=${ends}`);
  assert.equal(objects, 3 + 3 * 3, '3 个固定对象 + 每页 3 个');
});

test('xref：编号/条目数正确，每条偏移都指向 <n> 0 obj', () => {
  const xrefOffset = Number(/startxref\s+(\d+)\s*%%EOF/.exec(text3.slice(-200))[1]);
  assert.equal(text3.slice(xrefOffset, xrefOffset + 5), 'xref\n');
  const header = /^xref\n(\d+) (\d+)\n/.exec(text3.slice(xrefOffset));
  assert.ok(header, 'xref 头格式不对');
  assert.equal(Number(header[1]), 0);
  const size = Number(header[2]);
  assert.equal(size, 13, '3 + 3×3 个对象 + 0 号自由对象');
  assert.equal((text3.match(/\d+ 0 obj/g) || []).length, size - 1);

  const entriesStart = xrefOffset + header[0].length;
  for (let number = 1; number < size; number += 1) {
    const entry = text3.slice(entriesStart + 20 * number, entriesStart + 20 * number + 20);
    assert.equal(entry.length, 20, `第 ${number} 条 xref 不是 20 字节`);
    assert.ok(entry.endsWith(' n \n'), `第 ${number} 条 xref 标记不对：${JSON.stringify(entry)}`);
    const offset = Number(entry.slice(0, 10));
    assert.ok(Number.isInteger(offset) && offset > 0, `第 ${number} 条偏移非法`);
    const expected = `${number} 0 obj`;
    assert.equal(text3.slice(offset, offset + expected.length), expected,
      `第 ${number} 条 xref 偏移 ${offset} 没指向 "${expected}"`);
  }
});

test('startxref 指向 xref，/Size = 最高对象号 + 1', () => {
  const tail = text3.slice(-200);
  const match = /startxref\s+(\d+)\s*%%EOF/.exec(tail);
  assert.ok(match, '找不到 startxref');
  const offset = Number(match[1]);
  assert.equal(text3.slice(offset, offset + 5), 'xref\n');
  assert.ok(text3.slice(offset).includes(`/Size ${13}`));
  const maxObject = Math.max(...(text3.match(/(\d+) 0 obj/g) || []).map((s) => Number(s.split(' ')[0])));
  assert.equal(13, maxObject + 1);
});

test('2 页 PDF 的 /Count 是 2', () => {
  const two = latin1(buildPdf(pdfPages(2), { pageWmm: 148, pageHmm: 210, title: '两页' }));
  assert.ok(two.includes('/Count 2'));
  assert.ok(!two.includes('/Count 3'));
  assert.equal((two.match(/\/Type \/Page[^s]/g) || []).length, 2);
  assert.equal((two.match(/\/DCTDecode/g) || []).length, 2);
  const header = /xref\n0 (\d+)\n/.exec(two);
  assert.equal(Number(header[1]), 10, '2 页 → 3 + 2×3 + 1 = 10');
});

test('单页 PDF 的 /Count 是 1（默认 A5 页面尺寸）', () => {
  const one = latin1(buildPdf(pdfPages(1)));
  assert.ok(one.includes('/Count 1'));
  assert.ok(one.includes('/MediaBox [0 0 419.5276 595.2756]'));
  assert.ok(one.trimEnd().endsWith('%%EOF'));
});

test('中文标题写成 UTF-16BE 十六进制串', () => {
  assert.ok(text3.includes('/Title <FEFF'));
  const expected = Buffer.concat([
    Buffer.from([0xfe, 0xff]),
    Buffer.from('手账工坊 2026', 'utf16le').swap16(),
  ]).toString('hex').toUpperCase();
  assert.ok(text3.includes(expected), 'UTF-16BE 十六进制串不匹配');
  // 无标题时回落到默认标题
  const fallback = latin1(buildPdf(pdfPages(1)));
  const defaultHex = Buffer.concat([
    Buffer.from([0xfe, 0xff]),
    Buffer.from(DEFAULT_TITLE, 'utf16le').swap16(),
  ]).toString('hex').toUpperCase();
  assert.ok(fallback.includes(defaultHex));
  assert.equal(utf16Hex('A'), '<FEFF0041>');
  assert.equal(utf16Hex('😀'), '<FEFFD83DDE00>', '非 BMP 码位应输出代理对');
});

test('PDF 体积 > 输入 JPEG 总字节数（图片被内嵌而非丢失）', () => {
  const items = ensureFixtures();
  const jpegTotal = items.reduce((sum, item) => sum + item.bytes, 0);
  assert.ok(pdf3.length > jpegTotal, `pdf=${pdf3.length} jpegTotal=${jpegTotal}`);
  // 结构开销应当很小：多出来的不足 5%
  assert.ok(pdf3.length - jpegTotal < jpegTotal * 0.05 + 4096,
    `结构开销异常：${pdf3.length - jpegTotal} 字节`);
  console.log(`  PDF 体积 ${pdf3.length}B；输入 JPEG 合计 ${jpegTotal}B；结构开销 ${pdf3.length - jpegTotal}B`);
});

test('Python + Pillow 反解：内嵌 JPEG 与源文件逐字节一致', () => {
  const target = pdf3Path();
  const sources = JSON.stringify(ensureFixtures().map((item) => ({ path: item.path })));
  const raw = execFileSync(PYTHON, ['-c', CHECK_PY, target, sources], { encoding: 'utf8', timeout: 120000 });
  const report = JSON.parse(raw.trim().split(/\r?\n/).pop());

  assert.deepEqual(report.errors, []);
  assert.equal(report.startxref_points_to_xref, true);
  assert.equal(report.xref_start, 0);
  assert.equal(report.xref_size, 13);
  assert.equal(report.objects, 12);
  assert.equal(report.images.length, 3, '应能反解出 3 张内嵌 JPEG');

  const items = ensureFixtures();
  report.images.forEach((image, index) => {
    assert.equal(image.jpeg_magic, true);
    assert.equal(image.pillow_format, 'JPEG');
    assert.deepEqual(image.pillow_size, [items[index].width, items[index].height],
      `第 ${index + 1} 页像素尺寸与声明不符`);
    assert.equal(image.declared_width, items[index].width);
    assert.equal(image.declared_height, items[index].height);
    assert.equal(image.declared_length, items[index].bytes, `/Length 与真实 JPEG 长度不符`);
    assert.equal(image.extracted_bytes, items[index].bytes);
    assert.equal(image.identical_to_source, true, `第 ${index + 1} 页内嵌 JPEG 与源文件不一致`);
  });
  console.log(`  交叉验证：3 张内嵌 JPEG 逐字节一致，PDF ${report.pdf_bytes}B`);
});

test('Windows 原生解析器（WinRT Windows.Data.Pdf）能读出 3 页', (t) => {
  if (process.platform !== 'win32') {
    t.skip('非 Windows 平台');
    return;
  }
  const target = pdf3Path();
  const script = [
    '$ProgressPreference = \'SilentlyContinue\'',
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq \'AsTask\' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like \'IAsyncOperation*\' })[0]',
    'function Await($op, $type) { $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }',
    '$sf = Await ([Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]::GetFileFromPathAsync($env:JOURNAL_PDF)) ([Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime])',
    '$doc = Await ([Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]::LoadFromFileAsync($sf)) ([Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime])',
    'Write-Output ("PageCount=" + $doc.PageCount)',
  ].join('\n');

  let output;
  try {
    // 用 -EncodedCommand（UTF-16LE + base64）避免多行脚本在命令行上的转义问题
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, JOURNAL_PDF: target },
    });
  } catch (exc) {
    t.skip(`WinRT 解析器不可用：${exc.message}`);
    return;
  }
  const match = /PageCount=(\d+)/.exec(output);
  assert.ok(match, `没读到 PageCount：${output}`);
  assert.equal(Number(match[1]), 3);
  console.log(`  WinRT Windows.Data.Pdf 读到 PageCount=${match[1]}`);
});

test('参数校验：非法输入抛出可读错误', () => {
  assert.throws(() => buildPdf([]), /没有可导出的页面/);
  assert.throws(() => buildPdf(null), /没有可导出的页面/);
  assert.throws(() => buildPdf(pdfPages(1), { pageWmm: 0 }), /页面尺寸必须大于 0/);
  assert.throws(() => buildPdf(pdfPages(1), { pageHmm: 'x' }), /页面尺寸不合法/);
  assert.throws(() => buildPdf([{ width: 10, height: 10 }]), /不是有效的字节数据/);
  assert.throws(() => buildPdf([{ jpeg: new Uint8Array(0), width: 10, height: 10 }]), /图片是空的/);
  assert.throws(() => buildPdf([{ jpeg: new Uint8Array([1]), width: 0, height: 10 }]), /图片尺寸非法/);
});

test('mmToPt 与 Python 版一致', () => {
  assert.equal(mmToPt(25.4), 72);
  assert.ok(Math.abs(mmToPt(148) - 419.5275590551181) < 1e-9);
  assert.equal(mmToPt(210).toFixed(4), '595.2756');
});

test('canvas 路径：无 canvas 时给出可读错误（Node 里没有 DOM）', async () => {
  await assert.rejects(() => canvasToJpeg(null), /缺少画布对象/);
  await assert.rejects(() => canvasToJpeg({ width: 0, height: 0 }), /画布尺寸不合法/);
  await assert.rejects(() => canvasToJpeg({ width: 10, height: 10 }), /不支持导出 JPEG/);
  await assert.rejects(() => canvasesToPdfBlob([]), /没有可导出的页面/);
});

test('canvas 路径：有 toBlob 的假 canvas 能生成 PDF Blob', async () => {
  const items = ensureFixtures();
  const fakeCanvas = (item) => ({
    width: item.width,
    height: item.height,
    toBlob(callback, type, quality) {
      assert.equal(type, 'image/jpeg');
      assert.ok(quality > 0 && quality <= 1);
      setTimeout(() => callback(new Blob([item.data], { type: 'image/jpeg' })), 0);
    },
  });
  const blob = await canvasesToPdfBlob(items.map(fakeCanvas), { pageWmm: 148, pageHmm: 210, title: '手账' });
  assert.equal(blob.type, 'application/pdf');
  assert.ok(blob.size > 0);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = latin1(bytes);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.includes('/Count 3'));
  assert.equal(bytes.length, blob.size);

  // OffscreenCanvas 走 convertToBlob 分支
  const offscreen = {
    width: items[0].width,
    height: items[0].height,
    async convertToBlob(options) {
      assert.equal(options.type, 'image/jpeg');
      return new Blob([items[0].data], { type: 'image/jpeg' });
    },
  };
  const one = await canvasToJpeg(offscreen);
  assert.equal(one.jpeg.length, items[0].data.length);
  assert.equal(one.width, items[0].width);
  assert.equal(one.height, items[0].height);
});
