/* 舞台构建：把工程状态渲染成真实毫米单位的 DOM（屏幕预览与打印共用） */

import { state, pageDims, layerSrc, materialById, materialUrl, naturalMm } from './core.js';

const PX_PER_MM = 96 / 25.4; // CSS 中 1mm 的像素数（布局像素，不受 transform 影响）

export function div(cls, css) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (css) d.style.cssText = css;
  return d;
}

/** 文字行高，必须与服务端 _draw_text_layer 的 pitch 口径一致 */
export const TEXT_LINE_HEIGHT = 1.35;

export function cssFontFamily(font) {
  if (font === 'serif') return '"SimSun", "Times New Roman", serif';
  if (font === 'mono') return 'Consolas, "Courier New", monospace';
  return '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif';
}

let _measureCtx = null;
const MEASURE_PX_PER_MM = 12; // 用足够大的分辨率测量，再换算回毫米

/**
 * 用 canvas 量出文字盒的毫米尺寸。
 * 服务端 tw/th 就是这么算的，两边必须同源，否则预览和打印会对不齐。
 */
export function measureTextMm(layer) {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  const sizePx = Math.max(1, layer.size_mm * MEASURE_PX_PER_MM);
  _measureCtx.font = `${sizePx}px ${cssFontFamily(layer.font)}`;
  const lines = String(layer.text ?? '').split('\n');
  let width = 0;
  for (const line of lines) {
    width = Math.max(width, _measureCtx.measureText(line || ' ').width);
  }
  return [
    Math.max(0.5, width / MEASURE_PX_PER_MM),
    Math.max(0.5, (lines.length * TEXT_LINE_HEIGHT * layer.size_mm)),
  ];
}

export function transformOf(layer) {
  const parts = [];
  if (layer.rotate) parts.push(`rotate(${-layer.rotate}deg)`);
  const sx = layer.flip_x ? -1 : 1;
  const sy = layer.flip_y ? -1 : 1;
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
  return parts.join(' ');
}

export function buildLayerEl(layer, bleed) {
  const node = div('layer-el');
  node.dataset.layerId = layer.id;
  const left = layer.x_mm + bleed;
  const top = layer.y_mm + bleed;
  node.style.left = `${left}mm`;
  node.style.top = `${top}mm`;
  if (layer.opacity !== undefined && layer.opacity !== 1) node.style.opacity = layer.opacity;
  if (layer.locked) node.dataset.locked = '1';
  const tf = transformOf(layer);
  if (tf) node.style.transform = tf;

  if (layer.kind === 'text') {
    node.classList.add('text-el');
    node.textContent = layer.text ?? '';
    node.style.fontSize = `${layer.size_mm}mm`;
    node.style.lineHeight = String(TEXT_LINE_HEIGHT);
    node.style.color = layer.color || '#3b3b3b';
    node.style.textAlign = layer.align || 'left';
    node.style.fontFamily = cssFontFamily(layer.font);
    const [tw, th] = measureTextMm(layer);
    node.style.width = `${tw}mm`;
    node.style.height = `${th}mm`;
    node.style.display = 'block';
  } else if (layer.kind === 'shape') {
    node.classList.add('shape-el');
    node.style.width = `${layer.w_mm}mm`;
    node.style.height = `${layer.h_mm}mm`;
    if (layer.shape === 'ellipse') {
      node.style.background = layer.fill || '#f6dfe3';
      node.style.borderRadius = '50%';
    } else if (layer.shape === 'line') {
      // 与服务端一致：线画在 h_mm 盒子的垂直中线上
      const t = Math.max(0.2, layer.stroke_mm || 0.4);
      const c = layer.fill || '#c9b8aa';
      node.style.height = `${layer.h_mm}mm`;
      node.style.backgroundImage = `linear-gradient(to bottom, transparent calc(50% - ${t / 2}mm), ${c} calc(50% - ${t / 2}mm), ${c} calc(50% + ${t / 2}mm), transparent calc(50% + ${t / 2}mm))`;
    } else {
      node.style.background = layer.fill || '#f6dfe3';
      if (layer.stroke) node.style.border = `${Math.max(0.1, layer.stroke_mm || 0.4)}mm solid ${layer.stroke}`;
    }
  } else {
    node.style.width = `${layer.w_mm}mm`;
    node.style.height = `${layer.h_mm}mm`;
    const url = layerSrc(layer);
    if (layer.tile && layer.kind === 'material') {
      const item = materialById(layer.ref);
      if (item) {
        const [nw, nh] = naturalMm(item);
        node.style.backgroundImage = `url("${materialUrl(item)}")`;
        node.style.backgroundRepeat = 'repeat';
        node.style.backgroundSize = `${nw}mm ${nh}mm`;
      }
    } else if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.draggable = false;
      if (layer.blend && layer.blend !== 'normal') node.style.mixBlendMode = layer.blend;
      node.appendChild(img);
    }
  }
  return node;
}

/**
 * 构建舞台。
 * @param {{interactive?:boolean, showGuides?:boolean, showGrid?:boolean, gridMm?:number}} opts
 */
export function buildStage(opts = {}) {
  const { interactive = false, showGuides = false, showGrid = false, gridMm = 5 } = opts;
  const [pw, ph] = pageDims();
  const bleed = state.page.bleed_mm ?? 0;
  const totalW = pw + bleed * 2;
  const totalH = ph + bleed * 2;

  const stage = div('stage' + (interactive ? ' interactive' : ''));
  stage.style.width = `${totalW}mm`;
  stage.style.height = `${totalH}mm`;
  stage.dataset.pageW = String(pw);
  stage.dataset.pageH = String(ph);
  stage.dataset.bleed = String(bleed);
  stage.dataset.totalW = String(totalW);

  const bg = state.background || { type: 'color', value: '#ffffff' };
  if (bg.type === 'material' && bg.value) {
    const item = materialById(bg.value);
    if (item) {
      const [nw, nh] = naturalMm(item);
      if (bg.tile || item.tile) {
        stage.style.backgroundImage = `url("${materialUrl(item)}")`;
        stage.style.backgroundRepeat = 'repeat';
        stage.style.backgroundSize = `${nw}mm ${nh}mm`;
      } else {
        const img = document.createElement('img');
        img.src = materialUrl(item);
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
        stage.appendChild(img);
      }
    } else {
      stage.style.background = '#ffffff';
    }
  } else if (bg.type === 'color') {
    stage.style.background = bg.value || '#ffffff';
  } else {
    stage.style.background = '#ffffff';
  }

  if (showGrid) {
    const g = div('grid-overlay');
    g.style.backgroundSize = `${gridMm}mm ${gridMm}mm, ${gridMm}mm ${gridMm}mm`;
    stage.appendChild(g);
  }

  const layerEls = new Map();
  for (const layer of state.layers) {
    const node = buildLayerEl(layer, bleed);
    stage.appendChild(node);
    layerEls.set(layer.id, node);
  }

  if (showGuides && bleed > 0) {
    const trim = div('trim-guide');
    trim.style.cssText = `left:${bleed}mm;top:${bleed}mm;width:${pw}mm;height:${ph}mm;`;
    stage.appendChild(trim);
    const bleedBox = div('bleed-guide');
    bleedBox.style.cssText = `left:0;top:0;width:${totalW}mm;height:${totalH}mm;`;
    stage.appendChild(bleedBox);
  }

  return { el: stage, layerEls, pxPerMm: PX_PER_MM, totalW, totalH, bleed, pw, ph };
}

/** 元素在“未旋转”状态下的尺寸（毫米） */
export function elementSizeMm(node, stageEl) {
  const layoutPx = stageEl.offsetWidth || 1;
  const totalW = Number(stageEl.dataset.totalW) || 1;
  const pxPerMm = layoutPx / totalW;
  return [node.offsetWidth / pxPerMm, node.offsetHeight / pxPerMm];
}

export { PX_PER_MM };
