/* 复刻页面：分析别人的手账页 → 提取版式与配色 → 用素材库重排同款 */

import {
  state, PAGE_SIZES, pageDims, makeMaterialLayer, makeImageLayer, makeTextLayer,
  materialById, colorDist, mulberry32, round, emit, pushHistory, resetHistory, clamp, naturalMm,
} from './core.js';
import { api } from './api.js';
import { $, el, ok, err, toast, busy, shrinkImage } from './ui.js';
import { render as renderEditor, zoomToFit } from './editor.js';
import { loadLibrary } from './library.js';

let currentBlob = null;

/* ---------------------------------------------------------------- 展示 */

function renderPreview(data) {
  const wrap = $('#recreate-preview');
  if (!wrap) return;
  wrap.innerHTML = '';
  const stack = el('div', { class: 'preview-stack' });
  const img = el('img', { src: data.image.preview, alt: '原图' });
  stack.appendChild(img);
  const overlay = el('div', { class: 'overlay' });
  for (const r of data.regions || []) {
    const box = el('div', { class: `box ${r.type}` });
    box.style.left = `${r.x * 100}%`;
    box.style.top = `${r.y * 100}%`;
    box.style.width = `${r.w * 100}%`;
    box.style.height = `${r.h * 100}%`;
    box.appendChild(el('span', { text: TYPE_LABEL[r.type] || r.type }));
    overlay.appendChild(box);
  }
  stack.appendChild(overlay);
  wrap.appendChild(stack);
}

const TYPE_LABEL = { photo: '图', text: '字', tape: '胶带', decor: '装饰', frame: '框' };

function renderAnalysisPanel(data) {
  $('#an-bg').style.background = data.background.hex;
  $('#an-bg-hex').textContent = data.background.hex;
  $('#an-bg-desc').textContent = data.background.plain
    ? '纯色底，重排时会直接铺同色'
    : `有底纹（${data.background.texture === 'pattern' ? '明显' : '轻微'}），会用相近的底纹纸`;
  $('#an-style').textContent = `${data.style.mood} · ${data.style.density} · ${data.style.warmth}`;
  $('#an-stats').textContent = `${data.image.w}×${data.image.h}px · 留白 ${Math.round(data.whitespace * 100)}% · 识别到 ${data.regions.length} 个区块`;
  $('#an-region-count').textContent = `(${data.regions.length})`;

  const pal = $('#an-palette');
  pal.innerHTML = '';
  for (const p of data.palette) {
    pal.appendChild(el('div', { class: 'palette-chip' }, [
      el('div', { class: 'c', style: `background:${p.hex}` }),
      el('div', { class: 't', text: p.hex }),
    ]));
  }

  const list = $('#an-regions');
  list.innerHTML = '';
  if (!data.regions.length) {
    list.appendChild(el('div', { class: 'muted small', text: '没识别出明显的区块，这张可能是纯手写满版页。' }));
  }
  data.regions.forEach((r, i) => {
    list.appendChild(el('div', { class: 'region-item' }, [
      el('span', { class: 'type-tag ' + r.type, text: TYPE_LABEL[r.type] || r.type }),
      el('span', { class: 'muted', text: `#${i + 1}` }),
      el('span', { text: `位置 ${Math.round(r.x * 100)}%, ${Math.round(r.y * 100)}%` }),
      el('span', { class: 'muted', text: `占 ${(r.w * r.h * 100).toFixed(1)}%` }),
      el('span', { class: 'swatch', style: `background:${r.fill};width:14px;height:14px;` }),
    ]));
  });
}

/* ---------------------------------------------------------------- 选素材 */

function pickMaterial(cat, targetHex, rng) {
  const pool = state.materials.items.filter((m) => m.cat === cat);
  if (!pool.length) return null;
  const scored = pool
    .map((m) => ({ m, d: colorDist(m.dominant || '#cccccc', targetHex || '#cccccc') }))
    .sort((a, b) => a.d - b.d);
  const topN = scored.slice(0, Math.max(3, Math.ceil(scored.length * 0.3)));
  return topN[Math.min(topN.length - 1, Math.floor(rng() * topN.length))].m;
}

function fitInto(nw, nh, bw, bh, cover = 1) {
  const scale = Math.min((bw * cover) / Math.max(1, nw), (bh * cover) / Math.max(1, nh));
  return [nw * scale, nh * scale];
}

const CATEGORY_FOR = {
  photo: (w, h, area) => (area > 0.06 ? 'paper' : 'sticker'),
  // 文字块：够高才配标题条，否则用细分割线，避免被压成一条扁线
  text: (w, h) => (h >= 6 && (w / Math.max(1, h)) < 10 ? 'title' : 'divider'),
  tape: () => 'tape',
  decor: (w, h, area) => (area < 0.01 ? 'icon' : 'sticker'),
  frame: () => 'frame',
};

/* ---------------------------------------------------------------- 重排 */

export function composeLayout(data) {
  const size = (data.suggest && data.suggest.page_size) || 'A5';
  state.page.size = size;
  state.page.orientation = 'portrait';
  const [pw, ph] = PAGE_SIZES[size] || [148, 210];
  const rng = mulberry32(20260930 + Math.round((data.image.w * 7 + data.image.h * 13) % 9973));

  // 背景
  if (data.background.plain && data.background.texture === 'none') {
    state.background = { type: 'color', value: data.background.hex, tile: false };
  } else {
    const paper = pickMaterial('paper', data.background.hex, rng);
    state.background = paper
      ? { type: 'material', value: paper.id, tile: !!paper.tile }
      : { type: 'color', value: data.background.hex, tile: false };
  }

  const layers = [];
  const placed = [];

  for (const r of data.regions) {
    const area = r.w * r.h;
    if (area < 0.004) continue;
    const bw = r.w * pw;
    const bh = r.h * ph;
    if (bw < 1.5 || bh < 1.5) continue; // 太细碎的区块直接忽略，避免排出 0 尺寸图层
    const cx = (r.x + r.w / 2) * pw;
    const cy = (r.y + r.h / 2) * ph;
    const cat = (CATEGORY_FOR[r.type] || CATEGORY_FOR.decor)(bw, bh, area);
    const item = pickMaterial(cat, r.fill || data.background.hex, rng);
    if (!item) continue;
    const [nw, nh] = naturalMm(item);

    let targetW; let targetH;
    if (cat === 'paper') {
      targetW = Math.max(bw, 24);
      targetH = Math.max(bh, 24);
    } else if (cat === 'frame') {
      const s = Math.min(bw / Math.max(1, nw), bh / Math.max(1, nh));
      targetW = nw * s; targetH = nh * s;
    } else {
      const cover = r.type === 'tape' ? 1.15 : 1.02;
      [targetW, targetH] = fitInto(nw, nh, bw, bh, cover);
      if (cat === 'sticker' || cat === 'icon' || cat === 'stamp') {
        targetW = Math.max(targetW, 10);
        targetH = Math.max(targetH, 10);
      }
      if (cat === 'title' || cat === 'divider') {
        // 铺满区块宽度时高度必须同比例放大，否则素材会被压扁；
        // 但也不能高过识别区块太多，否则会和相邻区块叠在一起
        const want = Math.max(targetW, bw * 0.9);
        const ratio = want / Math.max(1e-6, targetW);
        targetW = want;
        targetH *= ratio;
        const maxH = Math.max(bh * 1.5, 6);
        if (targetH > maxH) {
          const k = maxH / targetH;
          targetW *= k;
          targetH = maxH;
        }
      }
    }

    const rot = r.type === 'tape'
      ? (rng() * 10 - 5)
      : (r.type === 'photo' ? (rng() * 3 - 1.5) : (rng() * 8 - 4));

    layers.push({
      id: `RC${layers.length}`,
      kind: 'material',
      ref: item.id,
      name: item.name,
      x_mm: round(cx - targetW / 2),
      y_mm: round(cy - targetH / 2),
      w_mm: round(targetW),
      h_mm: round(targetH),
      rotate: round(rot, 1),
      opacity: 1,
      flip_x: false, flip_y: false,
      tile: false, blend: 'normal', locked: false,
    });
    placed.push({ x: cx - targetW / 2, y: cy - targetH / 2, w: targetW, h: targetH });
  }

  // 空白处补装饰
  const marginTop = 6;
  const candidates = [];
  for (let gy = 0; gy < 7; gy += 1) {
    for (let gx = 0; gx < 5; gx += 1) {
      const x = 10 + (gx * (pw - 20)) / 4;
      const y = marginTop + (gy * (ph - marginTop - 12)) / 6;
      let minDist = Infinity;
      for (const b of placed) {
        const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
        const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
        minDist = Math.min(minDist, Math.hypot(dx, dy));
      }
      candidates.push({ x, y, d: minDist });
    }
  }
  candidates.sort((a, b) => b.d - a.d);

  // 先给日期文字占一个靠上的空白位，再让装饰避开它
  const textRegions = data.regions.filter((r) => r.type === 'text');
  let dateAnchor = null;
  if (textRegions.length) {
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      if (c.d >= 10 && c.y < ph * 0.5) { dateAnchor = c; candidates.splice(i, 1); break; }
    }
  }

  const picked = dateAnchor ? [{ x: dateAnchor.x, y: dateAnchor.y }] : [];
  for (const c of candidates) {
    if (c.d < 9) continue;
    if (picked.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 22)) continue;
    picked.push(c);
    if (picked.length >= 5) break;
  }
  const paletteHexes = (data.palette || []).map((p) => p.hex);
  picked.forEach((p, i) => {
    const cat = i % 3 === 2 ? 'icon' : 'sticker';
    const target = paletteHexes.length ? paletteHexes[Math.floor(rng() * paletteHexes.length)] : data.background.hex;
    const item = pickMaterial(cat, target, rng);
    if (!item) return;
    const [nw, nh] = naturalMm(item);
    const targetW = clamp(nw * (0.85 + rng() * 0.5), 9, 26);
    const targetH = targetW * (nh / Math.max(1, nw));
    layers.push({
      id: `RD${i}`,
      kind: 'material',
      ref: item.id,
      name: item.name,
      x_mm: round(clamp(p.x - targetW / 2, 2, pw - targetW - 2)),
      y_mm: round(clamp(p.y - targetH / 2, 2, ph - targetH - 2)),
      w_mm: round(targetW),
      h_mm: round(targetH),
      rotate: round(rng() * 16 - 8, 1),
      opacity: 1,
      flip_x: false, flip_y: false, tile: false, blend: 'normal', locked: false,
    });
  });

  // 日期文字层
  if (dateAnchor) {
    const now = new Date();
    const stamp = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
    const anchorText = (data.regions.find((r) => r.type === 'text') || {}).fill || '#5b4a3f';
    layers.push(makeTextLayer({
      text: stamp,
      size_mm: clamp(pw * 0.042, 4, 9),
      color: colorDist(anchorText, data.background.hex) > 70 ? anchorText : '#6b5b4d',
      x_mm: round(dateAnchor.x),
      y_mm: round(dateAnchor.y),
      align: 'left',
    }));
  }

  state.layers = layers.map((l) => ({ ...l, id: `${l.id}_${Math.random().toString(36).slice(2, 6)}` }));
  state.selection = null;
  resetHistory();
  pushHistory();
  emit('changed');
  renderEditor();
  zoomToFit();
}

/* ---------------------------------------------------------------- 底图 */

async function useAsUnderlay() {
  if (!currentBlob) return;
  const list = state.materials.items;
  const btn = $('#btn-recreate-underlay');
  try {
    btn.disabled = true;
    const res = await api.importBlob(currentBlob, '复刻原图.png', ['复刻', '原图'], 'imported');
    await loadLibrary();
    const item = res.item;
    const [pw, ph] = pageDims();
    const ar = item.w / Math.max(1, item.h);
    let w = pw;
    let h = pw / ar;
    if (h > ph) { h = ph; w = ph * ar; }
    state.page.size = state.page.size || 'A5';
    const layer = makeImageLayer(item, {
      w_mm: round(w), h_mm: round(h),
      x_mm: round((pw - w) / 2), y_mm: round((ph - h) / 2),
    });
    state.layers = [layer];
    state.background = { type: 'color', value: '#ffffff', tile: false };
    resetHistory();
    pushHistory();
    emit('changed');
    renderEditor();
    zoomToFit();
    const effDpi = Math.round(item.w / (w / 25.4));
    if (effDpi < 150) {
      toast(`原图分辨率偏低（约 ${effDpi}dpi），打印出来可能发虚`, 'err', 5000);
    } else {
      ok(`已放到画布，约 ${effDpi}dpi，可以直接打印`);
    }
    document.querySelector('.tab-btn[data-tab="editor"]')?.click();
  } catch (e) {
    err(`失败：${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

/* ---------------------------------------------------------------- 主流程 */

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return err('请选择一张图片');
  currentBlob = file;
  const wrap = $('#recreate-preview');
  const done = busy(wrap, '正在分析版面…');
  try {
    const payload = file.size > 12 * 1024 * 1024 ? await shrinkImage(file, 3000, 0.95) : file;
    const data = await api.analyze(payload);
    state.analysis = data;
    renderPreview(data);
    renderAnalysisPanel(data);
    $('#analysis-box').hidden = false;
    $('#recreate-actions').hidden = false;
    const note = $('#recreate-note');
    if (note) {
      const n = state.materials.items.length;
      note.textContent = n
        ? `素材库共 ${n} 件，会自动按识别到的配色挑选。`
        : '还没有内置素材，请先在控制台运行：python tools/make_materials.py';
    }
    currentBlob = file;
  } catch (e) {
    err(`分析失败：${e.message}`);
  } finally {
    done();
  }
}

export function initRecreate() {
  const dz = $('#recreate-drop');
  const fi = $('#recreate-file');
  dz?.addEventListener('click', () => fi?.click());
  fi?.addEventListener('change', () => { if (fi.files[0]) handleFile(fi.files[0]); fi.value = ''; });
  for (const evt of ['dragover', 'dragenter']) dz?.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add('over'); });
  for (const evt of ['dragleave', 'drop']) dz?.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.remove('over'); });
  dz?.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  $('#btn-recreate-layout')?.addEventListener('click', () => {
    if (!state.analysis) return err('请先放一张图片');
    if (!state.materials.items.length) return err('还没有内置素材，请先运行 python tools/make_materials.py');
    composeLayout(state.analysis);
    ok('已按识别到的版式生成同款页面，可以去编辑器微调');
    document.querySelector('.tab-btn[data-tab="editor"]')?.click();
  });
  $('#btn-recreate-underlay')?.addEventListener('click', useAsUnderlay);
}
