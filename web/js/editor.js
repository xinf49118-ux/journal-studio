/* 可视化编辑器：毫米坐标画布 + 拖拽/缩放/旋转/吸附 + 图层管理 + 撤销重做 */

import {
  state, pageDims, layerLabel, materialById, makeTextLayer, makeShapeLayer,
  makeMaterialLayer, makeImageLayer, pushHistory, undo, redo, canUndo, canRedo,
  clamp, round, materialThumbUrl, naturalMm, emit, on,
} from './core.js';
import { buildStage, elementSizeMm, div, transformOf, PX_PER_MM, measureTextMm, cssFontFamily, TEXT_LINE_HEIGHT } from './stage.js';
import { $, el, ok, err, toast } from './ui.js';

let ctx = { stageEl: null, layerEls: new Map(), pxPerMm: PX_PER_MM, totalW: 0, totalH: 0, bleed: 0, pw: 0, ph: 0 };
let drag = null;

/* ---------------------------------------------------------------- 尺寸计算 */

export function layerBoxMm(layer) {
  if (layer.kind === 'text') {
    const node = ctx.layerEls.get(layer.id);
    if (node && ctx.stageEl) {
      const [w, h] = elementSizeMm(node, ctx.stageEl);
      return [layer.x_mm, layer.y_mm, w, h];
    }
    return [layer.x_mm, layer.y_mm, 20, 8];
  }
  return [layer.x_mm, layer.y_mm, layer.w_mm || 10, layer.h_mm || 10];
}

/* ---------------------------------------------------------------- 渲染 */

export function render() {
  const scaler = $('#stage-scaler');
  if (!scaler) return;
  scaler.innerHTML = '';
  const built = buildStage({
    interactive: true,
    showGuides: true,
    showGrid: $('#chk-grid')?.checked !== false,
  });
  const stage = built.el;
  stage.style.transformOrigin = 'top left';
  stage.style.position = 'absolute';
  stage.style.left = '0';
  stage.style.top = '0';
  stage.style.transform = `scale(${state.zoom})`;
  scaler.appendChild(stage);

  const layoutW = stage.offsetWidth || 1;
  scaler.style.width = `${layoutW * state.zoom}px`;
  scaler.style.height = `${(stage.offsetHeight || 1) * state.zoom}px`;

  ctx = {
    stageEl: stage,
    layerEls: built.layerEls,
    pxPerMm: layoutW / built.totalW,
    totalW: built.totalW,
    totalH: built.totalH,
    bleed: built.bleed,
    pw: built.pw,
    ph: built.ph,
  };

  if (!stage.dataset.bound) {
    stage.addEventListener('pointerdown', onPointerDown);
    stage.dataset.bound = '1';
  }
  drawSelection();
  renderLayerList();
  renderProps();
  updateZoomLabel();
  updateSummary();
}

/** 只更新单个图层的 DOM（避免重建导致输入框失焦） */
function applyLayerToDom(layer) {
  const node = ctx.layerEls.get(layer.id);
  if (!node) return;
  node.style.left = `${layer.x_mm + ctx.bleed}mm`;
  node.style.top = `${layer.y_mm + ctx.bleed}mm`;
  node.style.opacity = layer.opacity ?? 1;
  const tf = transformOf(layer);
  node.style.transform = tf || '';
  if (layer.kind === 'text') {
    node.textContent = layer.text ?? '';
    node.style.fontSize = `${layer.size_mm}mm`;
    node.style.lineHeight = String(TEXT_LINE_HEIGHT);
    node.style.color = layer.color;
    node.style.textAlign = layer.align || 'left';
    node.style.fontFamily = cssFontFamily(layer.font);
    const [tw, th] = measureTextMm(layer);
    node.style.width = `${tw}mm`;
    node.style.height = `${th}mm`;
  } else if (layer.kind === 'shape') {
    node.style.width = `${layer.w_mm}mm`;
    node.style.height = `${layer.h_mm}mm`;
    if (layer.shape === 'line') {
      const t = Math.max(0.2, layer.stroke_mm || 0.4);
      const c = layer.fill || '#c9b8aa';
      node.style.background = 'none';
      node.style.backgroundImage = `linear-gradient(to bottom, transparent calc(50% - ${t / 2}mm), ${c} calc(50% - ${t / 2}mm), ${c} calc(50% + ${t / 2}mm), transparent calc(50% + ${t / 2}mm))`;
    } else {
      node.style.background = layer.fill || '#f6dfe3';
    }
  } else {
    node.style.width = `${layer.w_mm}mm`;
    node.style.height = `${layer.h_mm}mm`;
  }
}

function updateSummary() {
  const [w, h] = pageDims();
  const s = $('#page-summary');
  if (s) s.textContent = `${state.page.size} · ${w}×${h}mm · ${state.page.dpi}dpi`;
}

function updateZoomLabel() {
  const l = $('#zoom-label');
  if (l) l.textContent = `缩放 ${Math.round(state.zoom * 100)}%`;
  const u = $('#btn-undo'); const r = $('#btn-redo');
  if (u) u.disabled = !canUndo();
  if (r) r.disabled = !canRedo();
}

/* ---------------------------------------------------------------- 选中框 */

function drawSelection() {
  if (!ctx.stageEl) return;
  ctx.stageEl.querySelectorAll('.sel-outline, .snap-line').forEach((n) => n.remove());
  const layer = state.layers.find((l) => l.id === state.selection);
  if (!layer) return;
  const [x, y, w, h] = layerBoxMm(layer);
  const holder = div('sel-outline');
  holder.style.left = `${x + ctx.bleed}mm`;
  holder.style.top = `${y + ctx.bleed}mm`;
  holder.style.width = `${w}mm`;
  holder.style.height = `${h}mm`;
  const tf = transformOf(layer);
  if (tf) { holder.style.transform = tf; holder.style.transformOrigin = 'center center'; }

  const dirs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const pos = {
    nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50],
    se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50],
  };
  for (const d of dirs) {
    const hd = div('handle');
    hd.dataset.handle = d;
    hd.style.left = `${pos[d][0]}%`;
    hd.style.top = `${pos[d][1]}%`;
    hd.style.cursor = ({ nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' })[d];
    holder.appendChild(hd);
  }
  const rot = div('handle rot');
  rot.dataset.handle = 'rot';
  rot.style.left = '50%';
  rot.style.top = '0';
  rot.style.marginTop = '-22px';
  rot.style.cursor = 'grab';
  holder.appendChild(rot);
  ctx.stageEl.appendChild(holder);
}

function showSnapLines(lines) {
  ctx.stageEl.querySelectorAll('.snap-line').forEach((n) => n.remove());
  for (const ln of lines) {
    const d = div('snap-line');
    if (ln.axis === 'x') d.style.cssText = `left:${ln.at}mm;top:0;width:0.3mm;height:100%;`;
    else d.style.cssText = `top:${ln.at}mm;left:0;height:0.3mm;width:100%;`;
    ctx.stageEl.appendChild(d);
  }
}

/* ---------------------------------------------------------------- 吸附 */

function snapCandidates(excludeId) {
  const xs = [0, ctx.pw / 2, ctx.pw, 5, ctx.pw - 5];
  const ys = [0, ctx.ph / 2, ctx.ph, 5, ctx.ph - 5];
  for (const l of state.layers) {
    if (l.id === excludeId) continue;
    const [x, y, w, h] = layerBoxMm(l);
    xs.push(x, x + w, x + w / 2);
    ys.push(y, y + h, y + h / 2);
  }
  return { xs, ys };
}

function snapValue(v, list, tol) {
  let best = null;
  for (const c of list) {
    if (Math.abs(c - v) <= tol && (best === null || Math.abs(c - v) < Math.abs(best - v))) best = c;
  }
  return best;
}

/* ---------------------------------------------------------------- 交互 */

function onPointerDown(e) {
  if (e.button !== 0) return;
  const handleEl = e.target.closest('.handle');
  const layerEl = e.target.closest('.layer-el');

  if (handleEl && state.selection) {
    const layer = state.layers.find((l) => l.id === state.selection);
    if (!layer || layer.locked) return;
    e.preventDefault();
    const box = layerBoxMm(layer);
    drag = {
      mode: handleEl.dataset.handle === 'rot' ? 'rotate' : 'resize',
      dir: handleEl.dataset.handle,
      layer, start: box, sx: e.clientX, sy: e.clientY,
      moved: false, pointerId: e.pointerId,
    };
    bindDrag();
    return;
  }

  if (!layerEl) {
    select(null);
    return;
  }
  const layer = state.layers.find((l) => l.id === layerEl.dataset.layerId);
  if (!layer) return;
  select(layer.id);
  if (layer.locked) { toast('这个图层已锁定，先在右侧解锁'); return; }
  e.preventDefault();
  drag = {
    mode: 'move',
    layer,
    start: [layer.x_mm, layer.y_mm],
    sx: e.clientX, sy: e.clientY,
    moved: false,
    pointerId: e.pointerId,
  };
  bindDrag();
}

function bindDrag() {
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
}

function mmPerPx() {
  return 1 / (ctx.pxPerMm * state.zoom);
}

function onPointerMove(e) {
  if (!drag) return;
  const dx = (e.clientX - drag.sx) * mmPerPx();
  const dy = (e.clientY - drag.sy) * mmPerPx();
  if (Math.abs(dx) > 0.15 || Math.abs(dy) > 0.15) drag.moved = true;
  const layer = drag.layer;
  const tol = 1.2;
  const cand = snapCandidates(layer.id);

  if (drag.mode === 'move') {
    let nx = drag.start[0] + dx;
    let ny = drag.start[1] + dy;
    const [w, h] = layerBoxMm(layer);
    const lines = [];
    const sxL = snapValue(nx, cand.xs, tol); if (sxL !== null) { nx = sxL; lines.push({ axis: 'x', at: sxL + ctx.bleed }); }
    const sxC = snapValue(nx + w / 2, cand.xs, tol); if (sxC !== null) { nx = sxC - w / 2; lines.push({ axis: 'x', at: sxC + ctx.bleed }); }
    const sxR = snapValue(nx + w, cand.xs, tol); if (sxR !== null) { nx = sxR - w; lines.push({ axis: 'x', at: sxR + ctx.bleed }); }
    const syT = snapValue(ny, cand.ys, tol); if (syT !== null) { ny = syT; lines.push({ axis: 'y', at: syT + ctx.bleed }); }
    const syC = snapValue(ny + h / 2, cand.ys, tol); if (syC !== null) { ny = syC - h / 2; lines.push({ axis: 'y', at: syC + ctx.bleed }); }
    const syB = snapValue(ny + h, cand.ys, tol); if (syB !== null) { ny = syB - h; lines.push({ axis: 'y', at: syB + ctx.bleed }); }
    layer.x_mm = round(nx);
    layer.y_mm = round(ny);
    showSnapLines(lines);
    applyLayerToDom(layer);
    drawSelection();
    return;
  }

  if (drag.mode === 'resize') {
    const [ox, oy, ow, oh] = drag.start;
    let x = ox; let y = oy; let w = ow; let h = oh;
    const d = drag.dir;
    if (d.includes('e')) w = Math.max(1, ow + dx);
    if (d.includes('s')) h = Math.max(1, oh + dy);
    if (d.includes('w')) { w = Math.max(1, ow - dx); x = ox + (ow - w); }
    if (d.includes('n')) { h = Math.max(1, oh - dy); y = oy + (oh - h); }

    if (layer.kind === 'text') {
      // 文字：缩放高度等于改字号
      const ratio = oh > 0 ? h / oh : 1;
      layer.size_mm = round(clamp(layer.size_mm * ratio, 2, 60), 2);
      applyLayerToDom(layer);
      drawSelection();
      return;
    }
    const keepAspect = e.shiftKey || layer.kind === 'material';
    if (keepAspect && ow > 0 && oh > 0 && (d.length === 2)) {
      const ar = ow / oh;
      if (Math.abs(w / ar) > Math.abs(h)) h = w / ar; else w = h * ar;
      if (d.includes('w')) x = ox + (ow - w);
      if (d.includes('n')) y = oy + (oh - h);
    }
    layer.x_mm = round(x); layer.y_mm = round(y);
    layer.w_mm = round(Math.max(1, w)); layer.h_mm = round(Math.max(1, h));
    applyLayerToDom(layer);
    drawSelection();
    return;
  }

  if (drag.mode === 'rotate') {
    const node = ctx.layerEls.get(layer.id);
    const rect = node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const ang = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
    let deg = -(ang + 90);
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    layer.rotate = round(((deg % 360) + 360) % 360 > 180 ? deg - 360 : deg, 1);
    applyLayerToDom(layer);
    drawSelection();
    const r = $('#prop-rotate');
    if (r) r.value = String(layer.rotate);
  }
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove);
  if (drag && drag.moved) {
    pushHistory();
    emit('changed');
    renderProps();
  } else if (drag && !drag.moved) {
    /* 只是点选，不记历史 */
  }
  drag = null;
  if (ctx.stageEl) ctx.stageEl.querySelectorAll('.snap-line').forEach((n) => n.remove());
}

/* ---------------------------------------------------------------- 图层操作 */

export function select(id) {
  state.selection = id;
  drawSelection();
  renderLayerList();
  renderProps();
}

export function addLayer(layer, { silent = false } = {}) {
  state.layers.push(layer);
  state.selection = layer.id;
  pushHistory();
  render();
  emit('changed');
  if (!silent) ok(`已加入：${layerLabel(layer)}`);
  return layer;
}

export function addMaterial(item) {
  const [pw, ph] = pageDims();
  const [nw, nh] = naturalMm(item);
  const maxW = pw * 0.6;
  const scale = Math.min(1, maxW / Math.max(1, nw));
  const layer = makeMaterialLayer(item, {
    w_mm: nw * scale,
    h_mm: nh * scale,
    x_mm: (pw - nw * scale) / 2 + (Math.random() - 0.5) * 10,
    y_mm: Math.max(6, (ph - nh * scale) / 2 + (Math.random() - 0.5) * 10),
    rotate: item.cat === 'tape' ? (Math.random() * 8 - 4) : 0,
  });
  return addLayer(layer);
}

export function addLibraryImage(item) {
  return addLayer(makeImageLayer(item));
}

export function updateLayer(id, patch, { history = true } = {}) {
  const layer = state.layers.find((l) => l.id === id);
  if (!layer) return;
  Object.assign(layer, patch);
  applyLayerToDom(layer);
  drawSelection();
  if (history) { pushHistory(); emit('changed'); }
  updateZoomLabel();
}

export function deleteLayer(id) {
  const idx = state.layers.findIndex((l) => l.id === id);
  if (idx < 0) return;
  state.layers.splice(idx, 1);
  if (state.selection === id) state.selection = null;
  pushHistory();
  render();
  emit('changed');
}

export function duplicateLayer(id) {
  const layer = state.layers.find((l) => l.id === id);
  if (!layer) return;
  const copy = JSON.parse(JSON.stringify(layer));
  copy.id = `${copy.kind[0].toUpperCase()}${Date.now().toString(36)}`;
  copy.x_mm = round(copy.x_mm + 4);
  copy.y_mm = round(copy.y_mm + 4);
  addLayer(copy);
}

export function moveLayerZ(id, delta) {
  const idx = state.layers.findIndex((l) => l.id === id);
  if (idx < 0) return;
  const to = clamp(idx + delta, 0, state.layers.length - 1);
  if (to === idx) return;
  const [layer] = state.layers.splice(idx, 1);
  state.layers.splice(to, 0, layer);
  pushHistory();
  render();
  emit('changed');
}

/* ---------------------------------------------------------------- 侧栏 UI */

function renderLayerList() {
  const list = $('#layer-list');
  if (!list) return;
  list.innerHTML = '';
  const n = state.layers.length;
  const cnt = $('#layer-count');
  if (cnt) cnt.textContent = n ? `${n} 层` : '';
  if (!n) {
    list.appendChild(el('div', { class: 'muted small', text: '还没有图层。去素材库挑点东西，或点下面的「＋ 文字」。' }));
    return;
  }
  for (let i = state.layers.length - 1; i >= 0; i -= 1) {
    const layer = state.layers[i];
    const row = el('div', { class: `layer-item${layer.id === state.selection ? ' active' : ''}` });
    // 图层列表里只要 24px 的小图，用缩略图，别拉原图
    const url = layer.kind === 'material' && materialById(layer.ref) ? materialThumbUrl(materialById(layer.ref)) : null;
    if (url) row.appendChild(el('img', { class: 'li-thumb', src: url, alt: '' }));
    else {
      const icon = layer.kind === 'text' ? 'T' : (layer.kind === 'image' ? '🖼' : '▢');
      row.appendChild(el('span', { class: 'li-thumb', style: 'display:flex;align-items:center;justify-content:center;font-size:12px;', text: icon }));
    }
    row.appendChild(el('span', { class: 'li-name', text: layerLabel(layer) }));
    row.appendChild(el('button', {
      class: 'btn tiny', text: layer.locked ? '🔒' : '👁', title: layer.locked ? '已锁定' : '锁定',
      onclick: (ev) => { ev.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }); renderLayerList(); },
    }));
    row.addEventListener('click', () => select(layer.id));
    list.appendChild(row);
  }
}

function numberInput(label, value, step, onChange, opts = {}) {
  const input = el('input', {
    class: 'input', type: 'number', value: String(round(value, 2)), step: String(step),
  });
  if (opts.id) input.id = opts.id;
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) onChange(v);
  });
  return el('div', { class: 'prop-row' }, [el('label', { text: label }), input]);
}

function renderProps() {
  const box = $('#props');
  if (!box) return;
  box.innerHTML = '';
  const layer = state.layers.find((l) => l.id === state.selection);
  if (!layer) {
    box.appendChild(el('div', { class: 'muted small', text: '未选中任何图层' }));
    return;
  }
  box.appendChild(numberInput('X', layer.x_mm, 0.5, (v) => updateLayer(layer.id, { x_mm: round(v) })));
  box.appendChild(numberInput('Y', layer.y_mm, 0.5, (v) => updateLayer(layer.id, { y_mm: round(v) })));

  if (layer.kind !== 'text') {
    box.appendChild(numberInput('宽', layer.w_mm, 0.5, (v) => updateLayer(layer.id, { w_mm: round(Math.max(1, v)) })));
    box.appendChild(numberInput('高', layer.h_mm, 0.5, (v) => updateLayer(layer.id, { h_mm: round(Math.max(1, v)) })));
  }

  const rot = numberInput('旋转', layer.rotate || 0, 1, (v) => updateLayer(layer.id, { rotate: round(v, 1) }));
  rot.querySelector('input').id = 'prop-rotate';
  box.appendChild(rot);

  const op = el('input', { class: 'input', type: 'range', min: '0', max: '1', step: '0.05', value: String(layer.opacity ?? 1) });
  op.addEventListener('input', () => updateLayer(layer.id, { opacity: parseFloat(op.value) }));
  op.addEventListener('change', () => pushHistory());
  box.appendChild(el('div', { class: 'prop-row' }, [el('label', { text: '透明' }), op]));

  if (layer.kind === 'text') {
    const ta = el('textarea', { class: 'input', rows: '2', style: 'resize:vertical;' });
    ta.value = layer.text || '';
    ta.addEventListener('input', () => updateLayer(layer.id, { text: ta.value }));
    box.appendChild(el('div', { class: 'prop-row' }, [el('label', { text: '文字' }), ta]));
    box.appendChild(numberInput('字号', layer.size_mm, 0.5, (v) => updateLayer(layer.id, { size_mm: round(Math.max(2, v), 2) })));
    const color = el('input', { class: 'input', type: 'color', value: layer.color || '#3b3b3b' });
    color.addEventListener('input', () => updateLayer(layer.id, { color: color.value }));
    box.appendChild(el('div', { class: 'prop-row' }, [el('label', { text: '颜色' }), color]));
    const fontSel = el('select', { class: 'input' });
    for (const [v, t] of [['sans', '黑体'], ['serif', '宋体'], ['mono', '等宽']]) {
      fontSel.appendChild(el('option', { value: v, text: t, selected: (layer.font || 'sans') === v }));
    }
    fontSel.addEventListener('change', () => updateLayer(layer.id, { font: fontSel.value }));
    box.appendChild(el('div', { class: 'prop-row' }, [el('label', { text: '字体' }), fontSel]));
    const alignSel = el('select', { class: 'input' });
    for (const [v, t] of [['left', '左对齐'], ['center', '居中'], ['right', '右对齐']]) {
      alignSel.appendChild(el('option', { value: v, text: t, selected: (layer.align || 'left') === v }));
    }
    alignSel.addEventListener('change', () => updateLayer(layer.id, { align: alignSel.value }));
    box.appendChild(el('div', { class: 'prop-row' }, [el('label', { text: '对齐' }), alignSel]));
  }

  const btnRow = el('div', { class: 'btn-row' }, [
    el('button', { class: 'btn tiny', text: '上移一层', onclick: () => moveLayerZ(layer.id, 1) }),
    el('button', { class: 'btn tiny', text: '下移一层', onclick: () => moveLayerZ(layer.id, -1) }),
    el('button', { class: 'btn tiny', text: '复制', onclick: () => duplicateLayer(layer.id) }),
    el('button', { class: 'btn tiny', text: `水平翻转`, onclick: () => updateLayer(layer.id, { flip_x: !layer.flip_x }) }),
    el('button', { class: 'btn tiny', text: `垂直翻转`, onclick: () => updateLayer(layer.id, { flip_y: !layer.flip_y }) }),
    el('button', { class: 'btn tiny', text: '居中', onclick: () => centerLayer(layer) }),
    el('button', { class: 'btn tiny', text: '锁定', onclick: () => { updateLayer(layer.id, { locked: !layer.locked }); renderProps(); renderLayerList(); } }),
    el('button', { class: 'btn tiny', text: '删除', onclick: () => deleteLayer(layer.id) }),
  ]);
  box.appendChild(btnRow);
}

function centerLayer(layer) {
  const [pw, ph] = pageDims();
  const [x, y, w, h] = layerBoxMm(layer);
  updateLayer(layer.id, { x_mm: round((pw - w) / 2), y_mm: round((ph - h) / 2) });
}

/* ---------------------------------------------------------------- 页面设置 */

export function setPageSize(size) {
  state.page.size = size;
  pushHistory();
  render();
  emit('changed');
}

export function setOrientation(o) {
  state.page.orientation = o;
  pushHistory();
  render();
  emit('changed');
}

function syncPageControls() {
  const sel = $('#page-size');
  if (sel) sel.value = state.page.size;
  const ob = $('#btn-orient');
  if (ob) ob.textContent = state.page.orientation === 'landscape' ? '横版' : '竖版';
  const bc = $('#bg-color');
  if (bc && state.background.type === 'color') bc.value = state.background.value || '#fffdf7';
  const bp = $('#bg-paper');
  if (bp) bp.value = state.background.type === 'material' ? state.background.value : '';
}

function fillPaperOptions() {
  const sel = $('#bg-paper');
  if (!sel) return;
  const papers = state.materials.items.filter((m) => m.cat === 'paper');
  sel.innerHTML = '';
  sel.appendChild(el('option', { value: '', text: '用纯色背景' }));
  for (const p of papers) sel.appendChild(el('option', { value: p.id, text: p.name }));
  sel.value = state.background.type === 'material' ? state.background.value : '';
}

/* ---------------------------------------------------------------- 缩放 */

export function zoomBy(factor) {
  state.zoom = clamp(state.zoom * factor, 0.15, 5);
  state.autoZoom = false;
  render();
}

export function zoomToFit() {
  const vp = $('#stage-viewport');
  if (!vp || !ctx.stageEl) return;
  const availW = vp.clientWidth - 56;
  const availH = vp.clientHeight - 56;
  // 页签不可见时 clientWidth/Height 为 0，此时强行缩放会把画布压成一点点
  if (availW < 40 || availH < 40) return;
  const layoutW = ctx.stageEl.offsetWidth || 1;
  const layoutH = ctx.stageEl.offsetHeight || 1;
  state.zoom = clamp(Math.min(availW / layoutW, availH / layoutH), 0.15, 4);
  state.autoZoom = true;
  render();
}

/* ---------------------------------------------------------------- 初始化 */

export function initEditor() {
  $('#page-size')?.addEventListener('change', (e) => setPageSize(e.target.value));
  $('#btn-orient')?.addEventListener('click', () => setOrientation(state.page.orientation === 'landscape' ? 'portrait' : 'landscape'));
  $('#chk-grid')?.addEventListener('change', () => render());
  $('#bg-color')?.addEventListener('input', (e) => {
    state.background = { type: 'color', value: e.target.value, tile: false };
    const bp = $('#bg-paper'); if (bp) bp.value = '';
    render(); emit('changed');
  });
  $('#bg-color')?.addEventListener('change', () => pushHistory());
  $('#bg-paper')?.addEventListener('change', (e) => {
    const item = materialById(e.target.value);
    if (item) {
      state.background = { type: 'material', value: item.id, tile: !!item.tile };
      render(); pushHistory(); emit('changed');
    } else {
      const c = $('#bg-color')?.value || '#fffdf7';
      state.background = { type: 'color', value: c, tile: false };
      render(); pushHistory(); emit('changed');
    }
  });
  $('#btn-zoom-in')?.addEventListener('click', () => zoomBy(1.2));
  $('#btn-zoom-out')?.addEventListener('click', () => zoomBy(1 / 1.2));
  $('#btn-zoom-fit')?.addEventListener('click', zoomToFit);
  $('#btn-add-text')?.addEventListener('click', () => addLayer(makeTextLayer({ text: '2026.09.30', size_mm: 8 })));
  $('#btn-add-rect')?.addEventListener('click', () => addLayer(makeShapeLayer({ shape: 'rect' })));
  $('#btn-undo')?.addEventListener('click', () => { if (undo()) { render(); emit('changed'); } });
  $('#btn-redo')?.addEventListener('click', () => { if (redo()) { render(); emit('changed'); } });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey ? redo() : undo()) { render(); emit('changed'); } return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); if (redo()) { render(); emit('changed'); } return; }
    if (mod && e.key.toLowerCase() === 'd' && state.selection) { e.preventDefault(); duplicateLayer(state.selection); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selection) { e.preventDefault(); deleteLayer(state.selection); }
      return;
    }
    if (e.key === 'Escape') { select(null); return; }
    if (e.key.startsWith('Arrow') && state.selection) {
      const layer = state.layers.find((l) => l.id === state.selection);
      if (!layer) return;
      e.preventDefault();
      const step = e.shiftKey ? 5 : 0.5;
      const dx = e.key === 'ArrowLeft' ? -step : (e.key === 'ArrowRight' ? step : 0);
      const dy = e.key === 'ArrowUp' ? -step : (e.key === 'ArrowDown' ? step : 0);
      updateLayer(layer.id, { x_mm: round(layer.x_mm + dx), y_mm: round(layer.y_mm + dy) }, { history: false });
    }
  });

  on('materials', () => { fillPaperOptions(); syncPageControls(); });

  const ro = new ResizeObserver(() => { /* 视口变化时保持缩放比例，不自动调整 */ });
  const vp = $('#stage-viewport');
  if (vp) ro.observe(vp);
}

export { syncPageControls, fillPaperOptions };
