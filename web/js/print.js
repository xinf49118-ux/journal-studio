/* 打印：屏幕预览、浏览器打印（真实毫米 @page）、导出 PNG / PDF */

import { state, pageDims, buildRenderRequest, round, emit } from './core.js';
import { buildStage } from './stage.js';
import { api } from './api.js';
import { $, el, ok, err, busy, toast } from './ui.js';

/* ---------------------------------------------------------------- 预览 */

export function refreshPrintPreview() {
  const wrap = $('#print-preview');
  if (!wrap) return;
  wrap.innerHTML = '';
  const built = buildStage({ interactive: false, showGuides: true, showGrid: false });
  const stage = built.el;

  // 先入 DOM 再量尺寸：未挂载的元素 offsetWidth 为 0，缩放会算错
  const holder = el('div');
  holder.style.cssText = 'position:relative;flex:none;';
  holder.appendChild(stage);
  wrap.appendChild(holder);

  const layoutW = stage.offsetWidth || 600;
  const layoutH = stage.offsetHeight || 850;
  const paneW = Math.max(200, wrap.clientWidth - 48);
  const paneH = Math.max(320, wrap.clientHeight - 48);
  const z = Math.min(paneW / layoutW, paneH / layoutH, 1.6);

  holder.style.width = `${layoutW * z}px`;
  holder.style.height = `${layoutH * z}px`;
  stage.style.position = 'absolute';
  stage.style.left = '0';
  stage.style.top = '0';
  stage.style.transformOrigin = 'top left';
  stage.style.transform = `scale(${z})`;
  // 预览里也把裁切角线画出来，所见即所印
  if (state.page.crop_marks) drawCropMarks(stage, state.page.bleed_mm || 0);

  updateNote();
}

function updateNote() {
  const note = $('#print-note');
  if (!note) return;
  const [pw, ph] = pageDims();
  const bleed = state.page.bleed_mm || 0;
  const dpi = state.page.dpi || 300;
  const parts = [];
  parts.push(`成品 ${pw}×${ph}mm`);
  if (bleed > 0) parts.push(`含出血共 ${round(pw + bleed * 2, 1)}×${round(ph + bleed * 2, 1)}mm`);
  parts.push(`输出 ${dpi}dpi`);
  const hasLowRes = lowResLayers();
  note.textContent = `${parts.join(' · ')}。${bleed > 0 ? '打印后沿角线裁掉出血边即可。' : ''}`;
  if (hasLowRes.length) {
    note.textContent += ` 注意：有 ${hasLowRes.length} 张图片分辨率偏低，加打印可能发虚。`;
  }
}

/** 粗算：素材/图片按 300dpi 放置时是否够清晰 */
function lowResLayers() {
  const out = [];
  const [pw, ph] = pageDims();
  for (const l of state.layers) {
    if (l.kind !== 'material' && l.kind !== 'image') continue;
    let sw = 0; let sh = 0;
    if (l.kind === 'material') {
      const item = state.materials.items.find((m) => m.id === l.ref);
      if (!item) continue;
      sw = item.w; sh = item.h;
    } else {
      const item = state.library.find((m) => m.id === l.ref);
      if (!item) continue;
      sw = item.w; sh = item.h;
    }
    if (!sw || !l.w_mm) continue;
    const needW = (l.w_mm / 25.4) * 300;
    const needH = ((l.h_mm || l.w_mm) / 25.4) * 300;
    if (sw < needW * 0.8 || sh < needH * 0.8) out.push(l.id);
  }
  return out;
}

/* ---------------------------------------------------------------- 打印 */

function setPageStyle() {
  const [pw, ph] = pageDims();
  const bleed = state.page.bleed_mm || 0;
  let style = document.getElementById('journal-page-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'journal-page-style';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${round(pw + bleed * 2, 2)}mm ${round(ph + bleed * 2, 2)}mm; margin: 0; }`;
}

function drawCropMarks(stage, bleed) {
  if (!bleed) return;
  const thickness = 0.25;
  const arm = Math.max(2, bleed * 0.75);
  const corners = [
    { x: bleed, y: bleed, hx: -1, hy: -1 },
    { x: bleed + Number(stage.dataset.pageW), y: bleed, hx: 1, hy: -1 },
    { x: bleed, y: bleed + Number(stage.dataset.pageH), hx: -1, hy: 1 },
    { x: bleed + Number(stage.dataset.pageW), y: bleed + Number(stage.dataset.pageH), hx: 1, hy: 1 },
  ];
  for (const c of corners) {
    const h = el('div', { class: 'crop-mark' });
    h.style.cssText = `left:${c.hx < 0 ? c.x - arm : c.x}mm;top:${c.y - thickness / 2}mm;width:${arm}mm;height:${thickness}mm;`;
    const v = el('div', { class: 'crop-mark' });
    v.style.cssText = `left:${c.x - thickness / 2}mm;top:${c.hy < 0 ? c.y - arm : c.y}mm;width:${thickness}mm;height:${arm}mm;`;
    stage.appendChild(h);
    stage.appendChild(v);
  }
}

export function doPrint() {
  const root = document.getElementById('print-root');
  if (!root) return;
  root.innerHTML = '';
  const built = buildStage({ interactive: false, showGuides: false, showGrid: false });
  const stage = built.el;
  stage.style.transform = 'none';
  stage.style.position = 'relative';
  if (state.page.crop_marks) drawCropMarks(stage, state.page.bleed_mm || 0);
  root.appendChild(stage);
  setPageStyle();
  const cleanup = () => { root.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => {
    window.print();
    setTimeout(cleanup, 1500);
  }, 80);
}

/* ---------------------------------------------------------------- 导出 */

async function exportFile(kind) {
  const [pw, ph] = pageDims();
  if (!state.layers.length) return err('画布还是空的，先去素材库挑点东西');
  const req = buildRenderRequest();
  req.page.dpi = state.page.dpi;
  req.page.bleed_mm = state.page.bleed_mm;
  req.page.crop_marks = state.page.crop_marks;
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `手账_${state.page.size}_${pw}x${ph}mm_${stamp}.${kind}`;
  const pane = document.querySelector('#tab-print .pane');
  const done = busy(pane, kind === 'pdf' ? '正在生成 PDF…' : '正在渲染高分辨率 PNG…');
  try {
    await api.exportFile(kind, req, filename);
    ok(`已导出 ${filename}`);
  } catch (e) {
    err(`导出失败：${e.message}`);
  } finally {
    done();
  }
}

/* ---------------------------------------------------------------- 初始化 */

function syncFromControls() {
  const size = $('#print-size')?.value;
  if (size) state.page.size = size;
  const bleed = $('#print-bleed')?.value;
  if (bleed !== undefined && bleed !== '') state.page.bleed_mm = parseFloat(bleed);
  const crop = $('#print-crop');
  if (crop) state.page.crop_marks = crop.checked;
  const dpi = $('#print-dpi')?.value;
  if (dpi) state.page.dpi = parseInt(dpi, 10);
  // 打印设置就是页面设置：同步给编辑器和顶栏，并触发工程自动保存
  const ps = $('#page-size');
  if (ps) ps.value = state.page.size;
  emit('changed');
}

export function initPrint() {
  for (const id of ['#print-size', '#print-bleed', '#print-crop', '#print-dpi']) {
    $(id)?.addEventListener('change', () => {
      syncFromControls();
      const ps = $('#page-size');
      if (ps) ps.value = state.page.size;
      refreshPrintPreview();
    });
  }
  $('#btn-print')?.addEventListener('click', () => {
    syncFromControls();
    doPrint();
  });
  $('#btn-export-png')?.addEventListener('click', () => { syncFromControls(); exportFile('png'); });
  $('#btn-export-pdf')?.addEventListener('click', () => { syncFromControls(); exportFile('pdf'); });
  window.addEventListener('resize', () => {
    if (document.getElementById('tab-print')?.classList.contains('active')) refreshPrintPreview();
  });
}
