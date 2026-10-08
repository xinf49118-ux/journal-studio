/**
 * 跨语言一致性测试：web/js/analysis.js（浏览器 JS 版） vs server/analysis.py（Python 基准）。
 *
 * 夹具由 tests/fixtures/make_analysis_fixtures.py 生成：
 *   tests/fixtures/analysis/<name>.rgba.gz —— 与 Python 分析时**完全相同**的 RGBA 字节（gzip，压完不到十分之一）
 *   tests/fixtures/analysis/<name>.json —— Python analyze_image() 的结果（期望值）
 *
 * 容差（题目规定）：
 *   background.hex 每通道 ≤ 3；image.w/h、background.plain/texture、style.*、suggest.page_size 必须全等
 *   palette 长度 ±1、最近邻匹配后通道差 ≤ 12；whitespace ≤ 0.06
 *   regions 数量 ±1，最优匹配后平均 IoU ≥ 0.6，type 命中率 ≥ 0.8
 *
 * 用法：node tests/test_analysis_js.mjs
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { analyzePixels, analyzeImageBlob, blobToPreviewDataUri, _NumpyRng } from '../web/js/analysis.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX_DIR = path.join(HERE, 'fixtures', 'analysis');

const MAX_CHANNEL_BG = 3;
const MAX_CHANNEL_PALETTE = 12;
const MAX_WS_DIFF = 0.06;
const MIN_AVG_IOU = 0.6;
const MIN_TYPE_HIT = 0.8;
const PERF_BUDGET_MS = 2000;

const report = [];

// ---------------------------------------------------------------- 小工具

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const channelDiff = (a, b) => {
  const x = hexToRgb(a); const y = hexToRgb(b);
  return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2]));
};

function iou(a, b) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni <= 0 ? 0 : inter / uni;
}

/** 贪心最优匹配：所有配对按 IoU 降序，逐个占用（每个区块只用一次）。 */
function matchRegions(jsRegions, pyRegions) {
  const pairs = [];
  for (let i = 0; i < jsRegions.length; i++) {
    for (let j = 0; j < pyRegions.length; j++) {
      pairs.push({ i, j, iou: iou(jsRegions[i], pyRegions[j]) });
    }
  }
  pairs.sort((a, b) => b.iou - a.iou);
  const usedJs = new Set(); const usedPy = new Set();
  const matched = [];
  for (const p of pairs) {
    if (usedJs.has(p.i) || usedPy.has(p.j)) continue;
    usedJs.add(p.i); usedPy.add(p.j);
    matched.push(p);
  }
  const denom = Math.max(jsRegions.length, pyRegions.length);
  const avgIou = denom === 0 ? 1 : matched.reduce((s, p) => s + p.iou, 0) / denom;
  const typeHits = matched.filter((p) => jsRegions[p.i].type === pyRegions[p.j].type).length;
  const typeHit = denom === 0 ? 1 : typeHits / denom;
  return { avgIou, typeHit, matched, typeHits };
}

/** 最近邻配色匹配：颜色差越小越先配对。 */
function matchPalette(jsPal, pyPal) {
  const pairs = [];
  for (let i = 0; i < jsPal.length; i++) {
    for (let j = 0; j < pyPal.length; j++) {
      pairs.push({ i, j, diff: channelDiff(jsPal[i].hex, pyPal[j].hex) });
    }
  }
  pairs.sort((a, b) => a.diff - b.diff);
  const usedJs = new Set(); const usedPy = new Set();
  const matched = [];
  for (const p of pairs) {
    if (usedJs.has(p.i) || usedPy.has(p.j)) continue;
    usedJs.add(p.i); usedPy.add(p.j);
    matched.push(p);
  }
  const worst = matched.reduce((m, p) => Math.max(m, p.diff), 0);
  return { matched, worst, unmatchedJs: jsPal.length - usedJs.size, unmatchedPy: pyPal.length - usedPy.size };
}

function loadFixture(name) {
  const rgba = new Uint8Array(gunzipSync(readFileSync(path.join(FIX_DIR, `${name}.rgba.gz`))));
  const expected = JSON.parse(readFileSync(path.join(FIX_DIR, `${name}.json`), 'utf8'));
  return { rgba, expected };
}

// ---------------------------------------------------------------- 夹具清单

if (!existsSync(FIX_DIR)) {
  throw new Error(`找不到夹具目录 ${FIX_DIR}，请先运行：python tests/fixtures/make_analysis_fixtures.py`);
}
const NAMES = readdirSync(FIX_DIR).filter((f) => f.endsWith('.rgba.gz')).map((f) => f.replace(/\.rgba\.gz$/, '')).sort();
if (!NAMES.length) throw new Error(`夹具目录为空：${FIX_DIR}，请先运行 make_analysis_fixtures.py`);

// ---------------------------------------------------------------- 接口契约

test('接口契约：三个导出都在，结构字段齐全', () => {
  assert.equal(typeof analyzePixels, 'function');
  assert.equal(typeof analyzeImageBlob, 'function');
  assert.equal(typeof blobToPreviewDataUri, 'function');

  const { rgba, expected } = loadFixture(NAMES[0]);
  const got = analyzePixels(rgba, expected.image.w, expected.image.h);
  assert.deepEqual(
    Object.keys(got).sort(),
    ['background', 'image', 'ok', 'palette', 'regions', 'style', 'suggest', 'whitespace'],
  );
  assert.deepEqual(Object.keys(got.image).sort(), ['aspect', 'h', 'preview', 'w']);
  assert.deepEqual(Object.keys(got.background).sort(), ['hex', 'plain', 'texture']);
  assert.deepEqual(Object.keys(got.style).sort(), ['density', 'mood', 'warmth']);
  assert.deepEqual(Object.keys(got.suggest).sort(), ['dpi', 'page_size']);
  assert.ok(Array.isArray(got.palette) && Array.isArray(got.regions));
  for (const r of got.regions) {
    assert.deepEqual(Object.keys(r).sort(), ['aspect', 'density', 'fill', 'h', 'type', 'w', 'x', 'y']);
  }
  assert.equal(got.ok, true);
  assert.equal(got.suggest.dpi, 300);
});

test('接口契约：坐标归一化、类型取值合法', () => {
  for (const name of NAMES) {
    const { rgba, expected } = loadFixture(name);
    const got = analyzePixels(rgba, expected.image.w, expected.image.h);
    assert.equal(got.image.w, expected.image.w, `${name} 原图宽`);
    assert.equal(got.image.h, expected.image.h, `${name} 原图高`);
    assert.equal(got.image.preview, '', `${name} analyzePixels 不该产出预览图`);
    for (const r of got.regions) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.02 && r.y + r.h <= 1.02, `${name} 坐标越界 ${JSON.stringify(r)}`);
      assert.ok(['photo', 'text', 'tape', 'decor', 'frame'].includes(r.type), `${name} 未知类型 ${r.type}`);
      assert.match(r.fill, /^#[0-9a-f]{6}$/);
    }
    assert.ok(got.whitespace >= 0 && got.whitespace <= 1, `${name} whitespace 越界`);
    for (const p of got.palette) {
      assert.match(p.hex, /^#[0-9a-f]{6}$/);
      assert.ok(p.ratio > 0 && p.ratio <= 1, `${name} ratio 越界`);
    }
  }
});

test('接口契约：analyzePixels 里不含任何 DOM 依赖', () => {
  const src = readFileSync(path.join(HERE, '..', 'web', 'js', 'analysis.js'), 'utf8');
  const start = src.indexOf('export function analyzePixels');
  assert.ok(start > 0, '找不到 analyzePixels');
  const rest = src.slice(start + 10);
  const end = rest.indexOf('\nexport ');
  const body = (end > 0 ? rest.slice(0, end) : rest)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const bad of ['document', 'window', 'canvas', 'OffscreenCanvas', 'ImageData', 'createImageBitmap']) {
    assert.ok(!new RegExp(`\\b${bad}\\b`).test(body), `analyzePixels 里不该出现 ${bad}`);
  }
});

test('错误处理：太小的图与坏数据要报错', () => {
  assert.throws(() => analyzePixels(new Uint8ClampedArray(4 * 20 * 20), 20, 20), /太小/);
  assert.throws(() => analyzePixels(new Uint8ClampedArray(16), 100, 100), /长度/);
});

// ---------------------------------------------------------------- numpy 随机流回归
//
// analysis.js 里写死了 np.random.PCG64(20260930) 的初始 state/inc（k-means++ 选种要跟 Python 完全一致），
// 这里用 numpy 实测出来的值锁住它，防止以后被误改：
//   np.random.default_rng(20260930).integers(...) / .random() / .choice(n, p=...)
const NUMPY_REF = {
  integers24713: [14423, 10314, 11520, 9059, 18715, 7488, 19607, 8146, 9171, 3886, 11695, 9575],
  integers3e9: [1750905039, 1252105074, 1398512250, 1099782388],   // 走拒绝采样分支
  random: [0.41736835836983166, 0.36659412958337234, 0.3030079465260095, 0.3296533142666772],
  choiceArange24713: [15965, 14962, 13603, 14188],
};

test('numpy 随机流：PCG64 + integers + random + choice 与 Python 逐位一致', () => {
  let rng = new _NumpyRng();
  assert.deepEqual(NUMPY_REF.integers24713.map(() => rng.integers(24713)), NUMPY_REF.integers24713);

  rng = new _NumpyRng();
  assert.deepEqual(NUMPY_REF.integers3e9.map(() => rng.integers(3000000000)), NUMPY_REF.integers3e9);

  rng = new _NumpyRng();
  assert.deepEqual(NUMPY_REF.random.map(() => rng.nextDouble()), NUMPY_REF.random);

  const n = 24713;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = i + 1;         // 对应 numpy 的 p = arange(1, n+1)/sum
  let total = 0;
  for (let i = 0; i < n; i++) total += d[i];
  rng = new _NumpyRng();
  assert.deepEqual(NUMPY_REF.choiceArange24713.map(() => rng.choiceWeighted(d, total)), NUMPY_REF.choiceArange24713);
});

// ---------------------------------------------------------------- 浏览器路径（最小 canvas 垫片）

/** Node 里没有 canvas，用最小垫片把 analyzeImageBlob / blobToPreviewDataUri 这条链路跑通。 */
function installCanvasShim(origW, origH) {
  const calls = { drawImage: [], previews: 0 };
  const saved = {
    OffscreenCanvas: globalThis.OffscreenCanvas,
    createImageBitmap: globalThis.createImageBitmap,
    FileReader: globalThis.FileReader,
  };
  class Ctx {
    constructor(canvas) { this.canvas = canvas; this.imageSmoothingEnabled = false; this.imageSmoothingQuality = 'low'; this.fillStyle = ''; }
    fillRect() {}
    drawImage(_bmp, _dx, _dy, dw, dh) { calls.drawImage.push([this.canvas.width, this.canvas.height, dw, dh]); }
    getImageData(_x, _y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const solid = x > w * 0.15 && x < w * 0.55 && y > h * 0.15 && y < h * 0.45;
          const p = (y * w + x) * 4;
          data[p] = solid ? 58 : 255;
          data[p + 1] = solid ? 92 : 253;
          data[p + 2] = solid ? 130 : 247;
          data[p + 3] = 255;
        }
      }
      return { data, width: w, height: h };
    }
  }
  class FakeCanvas {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() { return new Ctx(this); }
    async convertToBlob({ type }) { calls.previews += 1; return new Blob([new Uint8Array([1, 2, 3])], { type }); }
  }
  globalThis.OffscreenCanvas = FakeCanvas;
  globalThis.createImageBitmap = async () => ({ width: origW, height: origH, close() {} });
  globalThis.FileReader = class {
    readAsDataURL() { this.result = 'data:image/jpeg;base64,SHIM'; setTimeout(() => this.onload(), 0); }
  };
  return {
    calls,
    restore() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete globalThis[k];
        else globalThis[k] = v;
      }
    },
  };
}

test('浏览器路径：analyzeImageBlob 用 1024 缩略图分析、但 image.w/h 保留原图尺寸', async () => {
  const shim = installCanvasShim(1600, 1200);
  try {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const res = await analyzeImageBlob(blob);
    assert.equal(res.image.w, 1600, 'image.w 必须是原图宽');
    assert.equal(res.image.h, 1200, 'image.h 必须是原图高');
    assert.equal(res.image.aspect, 1.3333);
    assert.equal(res.suggest.page_size, 'A5');
    assert.match(res.image.preview, /^data:image\/jpeg;base64,/);
    assert.ok(res.regions.length >= 1, '垫片页面应能识别出区块');
    assert.equal(shim.calls.drawImage.length, 2, '一次画分析缩略图，一次画预览图');
    assert.deepEqual(shim.calls.drawImage[0], [1024, 768, 1024, 768], '分析用的是最长边 1024 的缩略图');
    assert.deepEqual(shim.calls.drawImage[1], [900, 675, 900, 675], '预览图最长边 900');
  } finally {
    shim.restore();
  }
});

test('浏览器路径：blobToPreviewDataUri 按 maxSide 缩放并返回 JPEG dataURI', async () => {
  const shim = installCanvasShim(1600, 1200);
  try {
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
    const uri = await blobToPreviewDataUri(blob);
    assert.match(uri, /^data:image\/jpeg;base64,/);
    assert.deepEqual(shim.calls.drawImage[0], [900, 675, 900, 675], '默认最长边 900');
    const small = await blobToPreviewDataUri(blob, 320, 0.5);
    assert.match(small, /^data:image\/jpeg;base64,/);
    assert.deepEqual(shim.calls.drawImage[1], [320, 240, 320, 240]);
  } finally {
    shim.restore();
  }
});

test('浏览器路径：原图小于 40×40 要报错', async () => {
  const shim = installCanvasShim(30, 30);
  try {
    await assert.rejects(analyzeImageBlob(new Blob([new Uint8Array([1])])), /太小/);
  } finally {
    shim.restore();
  }
});

// ---------------------------------------------------------------- 逐张夹具比对

for (const name of NAMES) {
  test(`夹具 ${name}：与 Python 结果一致`, () => {
    const { rgba, expected } = loadFixture(name);
    const w = expected.image.w;
    const h = expected.image.h;
    assert.equal(rgba.length, w * h * 4, `${name} 夹具字节数应与宽高匹配`);

    const got = analyzePixels(rgba, w, h);

    // ---- 必须完全相等：尺寸 / 素底判定 / 纹理 / 风格 / 纸张建议
    assert.equal(got.image.w, expected.image.w, `${name} image.w`);
    assert.equal(got.image.h, expected.image.h, `${name} image.h`);
    assert.equal(got.background.plain, expected.background.plain, `${name} background.plain`);
    assert.equal(got.background.texture, expected.background.texture, `${name} background.texture`);
    assert.deepEqual(got.style, expected.style, `${name} style`);
    assert.equal(got.suggest.page_size, expected.suggest.page_size, `${name} suggest.page_size`);
    assert.equal(got.suggest.dpi, expected.suggest.dpi, `${name} suggest.dpi`);
    assert.equal(got.image.aspect, expected.image.aspect, `${name} image.aspect`);

    // ---- 背景色：每通道 ≤ 3
    const bgDiff = channelDiff(got.background.hex, expected.background.hex);
    assert.ok(bgDiff <= MAX_CHANNEL_BG,
      `${name} background.hex ${got.background.hex} vs ${expected.background.hex}（差 ${bgDiff} > ${MAX_CHANNEL_BG}）`);

    // ---- 留白：差 ≤ 0.06
    const wsDiff = Math.abs(got.whitespace - expected.whitespace);
    assert.ok(wsDiff <= MAX_WS_DIFF,
      `${name} whitespace ${got.whitespace} vs ${expected.whitespace}（差 ${wsDiff.toFixed(3)}）`);

    // ---- 配色：长度 ±1，最近邻匹配通道差 ≤ 12
    const palDiff = Math.abs(got.palette.length - expected.palette.length);
    assert.ok(palDiff <= 1, `${name} palette 长度 ${got.palette.length} vs ${expected.palette.length}`);
    const pm = matchPalette(got.palette, expected.palette);
    assert.ok(pm.worst <= MAX_CHANNEL_PALETTE,
      `${name} palette 最近邻最大通道差 ${pm.worst} > ${MAX_CHANNEL_PALETTE}`);
    assert.ok(pm.unmatchedJs <= 1 && pm.unmatchedPy <= 1, `${name} palette 匹配残留过多`);

    // ---- 区块：数量 ±1，平均 IoU ≥ 0.6，type 命中率 ≥ 0.8
    const cntDiff = Math.abs(got.regions.length - expected.regions.length);
    assert.ok(cntDiff <= 1,
      `${name} regions 数量 ${got.regions.length} vs ${expected.regions.length}`);
    const rm = matchRegions(got.regions, expected.regions);
    assert.ok(rm.avgIou >= MIN_AVG_IOU,
      `${name} 平均 IoU ${rm.avgIou.toFixed(3)} < ${MIN_AVG_IOU}`);
    assert.ok(rm.typeHit >= MIN_TYPE_HIT,
      `${name} type 命中率 ${(rm.typeHit * 100).toFixed(1)}% < ${MIN_TYPE_HIT * 100}%`);

    report.push({
      name,
      w, h,
      bgDiff,
      ws: `${got.whitespace} / ${expected.whitespace}`,
      palLen: `${got.palette.length} / ${expected.palette.length}`,
      palWorst: pm.worst,
      regions: `${got.regions.length} / ${expected.regions.length}`,
      avgIou: rm.avgIou,
      typeHit: rm.typeHit,
      types: got.regions.map((r) => r.type).join(','),
      expTypes: expected.regions.map((r) => r.type).join(','),
    });
  });
}

// ---------------------------------------------------------------- 性能

function makeSyntheticPage(w, h) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = (y * w + x) * 4;
    rgba[p] = r; rgba[p + 1] = g; rgba[p + 2] = b; rgba[p + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, 255, 253, 247);
  for (let y = 80; y < 340; y++) for (let x = 60; x < 460; x++) put(x, y, 58, 92, 130);
  for (let y = 120; y < 165; y++) for (let x = 540; x < 960; x++) put(x, y, 246, 184, 200);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let line = 0; line < 8; line++) {
    const y = 420 + line * 56;
    for (let x = 60; x < 60 + 600 - line * 30; x++) {
      if (rnd() > 0.25) for (let t = 0; t < 3; t++) put(x, y + t, 80, 72, 66);
    }
  }
  for (let i = 0; i < 40; i++) {
    const cx = Math.floor(rnd() * (w - 60)); const cy = Math.floor(rnd() * (h - 60));
    for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) put(cx + x, cy + y, 200, 160, 220);
  }
  return rgba;
}

test(`性能：1024×1024 分析耗时 < ${PERF_BUDGET_MS}ms`, () => {
  const rgba = makeSyntheticPage(1024, 1024);
  const t0 = performance.now();
  const got = analyzePixels(rgba, 1024, 1024);
  const ms = performance.now() - t0;
  report.push({ name: 'perf-1024', ms });
  console.log(`\n⏱  1024×1024 分析耗时：${ms.toFixed(1)} ms（区块 ${got.regions.length} 个，类型 ${got.regions.map((r) => r.type).join(',') || '-'}）`);
  assert.ok(got.ok && got.regions.length >= 3, '合成页应识别出区块');
  assert.ok(ms < PERF_BUDGET_MS, `1024×1024 耗时 ${ms.toFixed(1)}ms 超过 ${PERF_BUDGET_MS}ms`);
});

// ---------------------------------------------------------------- 汇总报告

after(() => {
  const fixtures = report.filter((r) => r.avgIou !== undefined);
  console.log('\n' + '='.repeat(118));
  console.log('跨语言一致性报告（JS vs Python）');
  console.log('='.repeat(118));
  console.log(
    'fixture'.padEnd(15) + 'size'.padEnd(11) + 'bgΔ'.padEnd(6) + 'whitespace'.padEnd(18) +
    'palette(L/Δ)'.padEnd(15) + 'regions(A/B)'.padEnd(15) + 'avgIoU'.padEnd(9) + 'type命中'.padEnd(10) + 'types',
  );
  for (const r of fixtures) {
    console.log(
      r.name.padEnd(15) + `${r.w}x${r.h}`.padEnd(11) + String(r.bgDiff).padEnd(6) +
      r.ws.padEnd(18) + `${r.palLen}/${r.palWorst}`.padEnd(15) + r.regions.padEnd(15) +
      r.avgIou.toFixed(3).padEnd(9) + (r.typeHit * 100).toFixed(1).padEnd(10) + r.types,
    );
  }
  const avgIou = fixtures.reduce((s, r) => s + r.avgIou, 0) / Math.max(1, fixtures.length);
  const avgHit = fixtures.reduce((s, r) => s + r.typeHit, 0) / Math.max(1, fixtures.length);
  const perf = report.find((r) => r.ms !== undefined);
  console.log('-'.repeat(118));
  console.log(`夹具数 ${fixtures.length}｜平均 IoU ${avgIou.toFixed(3)}｜平均 type 命中率 ${(avgHit * 100).toFixed(1)}%` +
    (perf ? `｜1024×1024 耗时 ${perf.ms.toFixed(1)}ms` : ''));
  console.log('='.repeat(118) + '\n');
});
