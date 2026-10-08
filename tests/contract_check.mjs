/**
 * 前后端契约自检（Node 侧）。
 *
 * 直接 import 前端真实的 core.js，用它造图层和渲染请求，再打到真实服务端的 /api/render，
 * 验证「前端生成的数据结构 = 服务端能正确渲染的数据结构」。
 *
 * 用法：
 *   node tests/contract_check.mjs            # 默认 http://127.0.0.1:8765
 *   node tests/contract_check.mjs http://127.0.0.1:8800
 */
import {
  state, PAGE_SIZES, pageDims, makeTextLayer, makeShapeLayer, makeMaterialLayer,
  makeImageLayer, buildRenderRequest, resetHistory, naturalMm, colorDist, mulberry32,
} from '../web/js/core.js';

const BASE = process.argv[2] || 'http://127.0.0.1:8765';
let pass = 0; let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${detail ? '  —— ' + detail : ''}`); }
  else { fail += 1; console.log(`  ❌ ${name}${detail ? '  —— ' + detail : ''}`); }
};

const post = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
};

const pngSize = (buf) => {
  // PNG IHDR: 宽高各 4 字节，偏移 16 和 20
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

console.log(`== 前后端契约自检：${BASE} ==\n`);

console.log('[1] 纯逻辑函数');
check('pageDims A5 竖版', JSON.stringify(pageDims({ size: 'A5', orientation: 'portrait' })) === '[148,210]');
check('pageDims A5 横版', JSON.stringify(pageDims({ size: 'A5', orientation: 'landscape' })) === '[210,148]');
check('mulberry32 确定性', mulberry32(42)() === mulberry32(42)());
check('colorDist 自反为 0', colorDist('#123456', '#123456') === 0);
check('colorDist 黑白最大', colorDist('#000000', '#ffffff') > 440);

console.log('\n[2] 四类图层的渲染请求结构');
state.page = { size: 'A5', orientation: 'portrait', dpi: 300, bleed_mm: 3, crop_marks: true };
state.background = { type: 'color', value: '#fffdf7' };
state.layers = [
  makeShapeLayer({ shape: 'rect', fill: '#f6dfe3', x_mm: 12, y_mm: 15, w_mm: 60, h_mm: 40 }),
  makeShapeLayer({ shape: 'ellipse', fill: '#cfe3da', x_mm: 90, y_mm: 15, w_mm: 40, h_mm: 40 }),
  makeTextLayer({ text: '2026.09.30\n手账工坊', size_mm: 9, x_mm: 12, y_mm: 70 }),
];
const req = buildRenderRequest();
check('请求含 page/background/layers', !!req.page && !!req.background && Array.isArray(req.layers));
check('图层已剥离前端字段 name/locked', req.layers.every((l) => !('name' in l) && !('locked' in l)));
check('坐标单位是毫米且为数字', req.layers.every((l) => typeof l.x_mm === 'number' && l.x_mm >= 0));
check('JSON 可序列化', typeof JSON.stringify(req) === 'string');

const r1 = await post('/api/render', req);
const size1 = pngSize(r1.buf);
check('服务端接受该请求并返回 PNG', r1.status === 200 && !!size1, `status=${r1.status}`);
check('尺寸 = (148+6)mm × (210+6)mm @300dpi',
  size1 && size1[0] === Math.round(154 * 300 / 25.4) && size1[1] === Math.round(216 * 300 / 25.4),
  size1 ? size1.join('×') : '无');

console.log('\n[3] 内置素材图层');
const manifest = await (await fetch(BASE + '/api/materials')).json();
const items = manifest.items || [];
console.log(`  素材总数：${items.length}`);
if (!items.length) {
  console.log('  ⚠️  还没有内置素材，跳过素材图层检查（先运行 python tools/make_materials.py）');
} else {
  const cats = ['tape', 'sticker', 'paper', 'frame', 'divider', 'stamp', 'title', 'icon'];
  let tested = 0;
  for (const cat of cats) {
    const item = items.find((m) => m.cat === cat);
    if (!item) { check(`分类 ${cat} 有素材`, false); continue; }
    const [nw, nh] = naturalMm(item);
    check(`分类 ${cat} 自然尺寸合理`, nw > 1 && nh > 1 && nw < 700 && nh < 700, `${item.id} ${nw.toFixed(1)}×${nh.toFixed(1)}mm`);
    state.layers = [makeMaterialLayer(item, { x_mm: 10, y_mm: 10, w_mm: Math.min(nw, 80), h_mm: Math.min(nh, 60) })];
    const r = await post('/api/render', buildRenderRequest());
    check(`分类 ${cat} 能渲染`, r.status === 200 && !!pngSize(r.buf), `status=${r.status}`);
    tested += 1;
  }
  check('八大分类全部通过渲染', tested === 8, `实测 ${tested} 类`);

  // 平铺背景
  const paper = items.find((m) => m.cat === 'paper');
  if (paper) {
    state.background = { type: 'material', value: paper.id, tile: !!paper.tile };
    state.layers = [];
    const r = await post('/api/render', buildRenderRequest());
    check('底纹纸当背景可渲染', r.status === 200 && !!pngSize(r.buf), `status=${r.status}`);
  }
}

console.log('\n[4] 边界情况');
state.background = { type: 'color', value: '#ffffff' };
state.layers = [makeTextLayer({ text: '', size_mm: 8 })];
check('空文字图层不报错', (await post('/api/render', buildRenderRequest())).status === 200);

state.layers = [];
state.page = { size: 'A4', orientation: 'landscape', dpi: 600, bleed_mm: 5, crop_marks: true };
const r4 = await post('/api/render', buildRenderRequest());
const size4 = pngSize(r4.buf);
check('A4 横版 600dpi 5mm 出血',
  r4.status === 200 && size4 && size4[0] === Math.round(307 * 600 / 25.4) && size4[1] === Math.round(220 * 600 / 25.4),
  size4 ? size4.join('×') : `status=${r4.status}`);

const bad = await post('/api/render', { page: { size: 'A5' }, background: { type: 'color', value: '#fff' }, layers: [{ kind: 'material', ref: '不存在的素材id' }] });
check('引用不存在的素材不会让服务崩溃', bad.status === 200);

resetHistory();
console.log('\n' + '='.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
