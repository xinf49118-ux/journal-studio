/* 全局状态、常量与通用工具 */

/**
 * 应用根目录。用模块自身的 URL 反推，因此本地服务（/）和 GitHub Pages 子路径（/repo/）
 * 两种部署方式下，素材与接口的相对路径都能自动解析正确。
 */
export const APP_ROOT = new URL('../../', import.meta.url);

export const PAGE_SIZES = { A5: [148, 210], A6: [105, 148], A4: [210, 297], B5: [176, 250] };
export const PAGE_NAMES = { A5: 'A5', A6: 'A6', A4: 'A4', B5: 'B5' };

/** 各类素材的参考 dpi：换算成毫米时的「自然尺寸」 */
export const CAT_REF_DPI = { paper: 150 };
export const CAT_NAMES = {
  paper: '底纹纸', tape: '和纸胶带', sticker: '贴纸', frame: '边框花边',
  divider: '分割线', stamp: '印章邮戳', title: '标题日期条', icon: '小图标',
  imported: '我的导入', web: '联网素材',
};

export const state = {
  page: { size: 'A5', orientation: 'portrait', dpi: 300, bleed_mm: 3, crop_marks: true },
  background: { type: 'color', value: '#fffdf7', tile: false },
  layers: [],
  selection: null,
  zoom: 1,
  autoZoom: true,
  materials: { categories: [], items: [] },
  library: [],
  analysis: null,
  sourceFile: null,
};

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, []);
  listeners.get(evt).push(fn);
}
export function emit(evt, payload) {
  (listeners.get(evt) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
}

/* ---------------- 页面尺寸 ---------------- */

export function pageDims(page = state.page) {
  let [w, h] = PAGE_SIZES[page.size] || [page.w_mm || 148, page.h_mm || 210];
  if (page.orientation === 'landscape') [w, h] = [Math.max(w, h), Math.min(w, h)];
  return [w, h];
}

/* ---------------- 工具 ---------------- */

let idSeq = 0;
export function uid(prefix = 'L') {
  idSeq += 1;
  return `${prefix}${Date.now().toString(36)}${idSeq}`;
}

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
export function round(v, n = 2) { const p = 10 ** n; return Math.round(v * p) / p; }

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (s.length < 6) return [200, 200, 200];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
export function colorDist(a, b) {
  const A = hexToRgb(a); const B = hexToRgb(b);
  return Math.sqrt((A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2);
}
export function lighten(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount]);
}

/* ---------------- 素材 ---------------- */

export function materialById(id) {
  return state.materials.items.find((m) => m.id === id) || null;
}

export function materialUrl(item) {
  return new URL(`assets/materials/${item.file}`, APP_ROOT).href;
}

/** 素材的自然尺寸（毫米） */
export function naturalMm(item, cat) {
  const dpi = CAT_REF_DPI[cat || item.cat] || 300;
  return [(item.w / dpi) * 25.4, (item.h / dpi) * 25.4];
}

/**
 * 用户素材的地址。
 * 服务端版由 /media/<id> 提供；静态版存在浏览器 IndexedDB 里，条目自带 blob: 的 url 字段。
 */
export function libraryUrl(itemOrId) {
  const id = typeof itemOrId === 'string' ? itemOrId : itemOrId?.id;
  const found = state.library.find((l) => l.id === id);
  if (found && found.url) return found.url;
  return `/media/${id}`;
}

/* ---------------- 图层工厂 ---------------- */

export function makeMaterialLayer(item, opts = {}) {
  const [nw, nh] = naturalMm(item);
  const [pw, ph] = pageDims();
  const scale = opts.scale || 1;
  const w = opts.w_mm || nw * scale;
  const h = opts.h_mm || nh * scale;
  return {
    id: uid('M'),
    kind: 'material',
    ref: item.id,
    name: item.name,
    x_mm: opts.x_mm ?? (pw - w) / 2,
    y_mm: opts.y_mm ?? (ph - h) / 2,
    w_mm: w,
    h_mm: h,
    rotate: opts.rotate || 0,
    opacity: 1,
    flip_x: false,
    flip_y: false,
    tile: false,
    blend: 'normal',
    locked: false,
  };
}

export function makeImageLayer(libItem, opts = {}) {
  const [pw, ph] = pageDims();
  // 以 300dpi 视作自然尺寸，默认缩放成能舒适放进页面（占页面 80% 以内）
  const natW = Math.max(1, (libItem.w / 300) * 25.4);
  const natH = Math.max(1, (libItem.h / 300) * 25.4);
  const scale = Math.min((pw * 0.8) / natW, (ph * 0.8) / natH);
  const w = opts.w_mm || natW * scale;
  const h = opts.h_mm || natH * scale;
  return {
    id: uid('I'),
    kind: 'image',
    ref: libItem.id,
    name: libItem.name,
    x_mm: opts.x_mm ?? (pw - w) / 2,
    y_mm: opts.y_mm ?? (ph - h) / 2,
    w_mm: w,
    h_mm: h,
    rotate: 0, opacity: 1, flip_x: false, flip_y: false, tile: false, blend: 'normal', locked: false,
  };
}

export function makeTextLayer(opts = {}) {
  return {
    id: uid('T'),
    kind: 'text',
    text: opts.text ?? '2026.09.30',
    font: opts.font || 'sans',
    size_mm: opts.size_mm || 8,
    color: opts.color || '#5b4a3f',
    x_mm: opts.x_mm ?? 12,
    y_mm: opts.y_mm ?? 12,
    rotate: 0, opacity: 1, align: opts.align || 'left',
    blend: 'normal', locked: false, name: '文字',
  };
}

export function makeShapeLayer(opts = {}) {
  const [pw] = pageDims();
  const w = opts.w_mm || pw * 0.5;
  const h = opts.h_mm || w * 0.6;
  return {
    id: uid('S'),
    kind: 'shape',
    shape: opts.shape || 'rect',
    fill: opts.fill || '#f6dfe3',
    stroke: opts.stroke || null,
    stroke_mm: opts.stroke_mm || 0.4,
    x_mm: opts.x_mm ?? (pw - w) / 2,
    y_mm: opts.y_mm ?? 20,
    w_mm: w, h_mm: h,
    rotate: 0, opacity: 1,
    blend: 'normal', locked: false, name: opts.shape === 'ellipse' ? '椭圆' : (opts.shape === 'line' ? '线条' : '色块'),
  };
}

export function layerLabel(layer) {
  if (layer.kind === 'text') return layer.text.slice(0, 10) || '文字';
  if (layer.kind === 'shape') return layer.name || '色块';
  if (layer.kind === 'material') return materialById(layer.ref)?.name || '素材';
  if (layer.kind === 'image') {
    const it = state.library.find((l) => l.id === layer.ref);
    return it?.name || '图片';
  }
  return '图层';
}

export function layerSrc(layer) {
  if (layer.kind === 'material') {
    const item = materialById(layer.ref);
    return item ? materialUrl(item) : null;
  }
  if (layer.kind === 'image') return libraryUrl({ id: layer.ref });
  return null;
}

/* ---------------- 渲染请求（与服务端契约一致） ---------------- */

export function buildRenderRequest(extra = {}) {
  const [w, h] = pageDims();
  return {
    page: {
      size: state.page.size,
      w_mm: w, h_mm: h,
      dpi: state.page.dpi || 300,
      bleed_mm: state.page.bleed_mm ?? 0,
      crop_marks: !!state.page.crop_marks,
      orientation: state.page.orientation || 'portrait',
    },
    background: { ...state.background },
    layers: state.layers.map((l) => {
      const o = { ...l };
      delete o.name; delete o.locked;
      return o;
    }),
    ...extra,
  };
}

/* ---------------- 历史记录 ---------------- */

const history = { stack: [], index: -1, limit: 80 };

export function snapshot() {
  return JSON.stringify({ page: state.page, background: state.background, layers: state.layers });
}

export function pushHistory() {
  const snap = snapshot();
  if (history.stack[history.index] === snap) return;
  history.stack = history.stack.slice(0, history.index + 1);
  history.stack.push(snap);
  if (history.stack.length > history.limit) history.stack.shift();
  history.index = history.stack.length - 1;
  emit('history');
}

export function resetHistory() {
  history.stack = [snapshot()];
  history.index = 0;
  emit('history');
}

function applySnap(snap) {
  const data = JSON.parse(snap);
  state.page = data.page;
  state.background = data.background;
  state.layers = data.layers;
}

export function undo() {
  if (history.index <= 0) return false;
  history.index -= 1;
  applySnap(history.stack[history.index]);
  emit('history');
  return true;
}

export function redo() {
  if (history.index >= history.stack.length - 1) return false;
  history.index += 1;
  applySnap(history.stack[history.index]);
  emit('history');
  return true;
}

export function canUndo() { return history.index > 0; }
export function canRedo() { return history.index < history.stack.length - 1; }

export function serializeProject() {
  return { version: 1, page: state.page, background: state.background, layers: state.layers };
}

export function loadProject(data) {
  if (!data) return;
  state.page = { ...state.page, ...(data.page || {}) };
  state.background = { ...state.background, ...(data.background || {}) };
  state.layers = Array.isArray(data.layers) ? data.layers : [];
  state.selection = null;
  resetHistory();
  emit('project');
}
