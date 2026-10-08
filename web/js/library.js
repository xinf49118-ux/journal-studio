/* 素材库：内置素材 / 我的素材 / 联网检索，导入与入库 */

import { state, emit, materialUrl, materialThumbUrl, libraryUrl, naturalMm, CAT_NAMES, makeMaterialLayer, pageDims } from './core.js';
import { api, downloadBlob } from './api.js';
import { $, el, ok, err, toast, busy, shrinkImage } from './ui.js';
import { addMaterial, addLibraryImage, addLayer } from './editor.js';

const view = { source: 'builtin', cat: 'all', q: '', webResults: [], webQuery: '', webSource: 'wikimedia' };

export async function loadMaterials() {
  try {
    const data = await api.materials();
    state.materials = { categories: data.categories || [], items: data.items || [] };
    emit('materials');
    renderCatList();
    renderGrid();
  } catch (e) {
    err(`读取内置素材失败：${e.message}`);
  }
}

export async function loadLibrary() {
  try {
    const data = await api.library();
    state.library = data.items || [];
    renderCatList();
    if (view.source === 'mine') renderGrid();
    emit('library');
  } catch (e) {
    err(`读取我的素材失败：${e.message}`);
  }
}

function renderCatList() {
  const box = $('#cat-list');
  if (!box) return;
  box.innerHTML = '';
  const counts = new Map();
  const items = view.source === 'mine' ? state.library : (view.source === 'web' ? view.webResults : state.materials.items);
  for (const it of items) counts.set(it.cat || 'imported', (counts.get(it.cat || 'imported') || 0) + 1);

  const add = (id, name, n) => {
    const row = el('div', { class: `cat-item${view.cat === id ? ' active' : ''}` }, [
      el('span', { text: name }),
      el('span', { class: 'n', text: n ? String(n) : '' }),
    ]);
    row.addEventListener('click', () => { view.cat = id; renderCatList(); renderGrid(); });
    box.appendChild(row);
  };
  add('all', '全部', items.length);
  const order = ['paper', 'tape', 'sticker', 'frame', 'divider', 'stamp', 'title', 'icon', 'imported'];
  for (const c of order) {
    const n = counts.get(c) || 0;
    if (!n) continue;
    add(c, CAT_NAMES[c] || c, n);
  }
  for (const [c, n] of counts) {
    if (!order.includes(c)) add(c, CAT_NAMES[c] || c, n);
  }
}

function matchQuery(it) {
  const q = view.q.trim().toLowerCase();
  if (!q) return true;
  const hay = [it.name, (it.tags || []).join(' '), it.cat, it.author, it.license, it.title, it.desc]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

function matchItem(it) {
  return matchQuery(it);
}

export function renderGrid() {
  const grid = $('#material-grid');
  const empty = $('#material-empty');
  const count = $('#mat-count');
  if (!grid) return;
  grid.innerHTML = '';

  let items = [];
  if (view.source === 'builtin') {
    items = state.materials.items.map((m) => ({ ...m, _src: 'builtin' }));
  } else if (view.source === 'mine') {
    items = state.library.map((m) => ({ ...m, _src: 'mine' }));
  } else {
    items = view.webResults.map((m) => ({ ...m, _src: 'web' }));
  }
  // 联网结果没有本地分类，只按搜索词过滤；本地素材还要叠加分类筛选
  items = items.filter((it) => {
    if (!matchQuery(it)) return false;
    if (view.source === 'web' || view.cat === 'all') return true;
    return (it.cat || 'imported') === view.cat;
  });

  if (count) count.textContent = `${items.length} 件`;
  if (empty) empty.hidden = items.length > 0;

  for (const item of items) grid.appendChild(cardFor(item));
}

function thumbUrl(item) {
  if (item._src === 'builtin') return materialThumbUrl(item);
  if (item._src === 'mine') return libraryUrl(item);
  return item.thumb || item.full;
}

function cardFor(item) {
  const card = el('div', { class: 'mat-card' });
  const thumbWrap = el('div', { class: 'mat-thumb' });
  const img = el('img', { src: thumbUrl(item), alt: item.name || item.title || '', loading: 'lazy' });
  img.addEventListener('error', () => { img.style.display = 'none'; });
  thumbWrap.appendChild(img);
  card.appendChild(thumbWrap);

  const badge = item._src === 'builtin' ? (CAT_NAMES[item.cat] || item.cat)
    : (item._src === 'mine' ? '我的' : (item.source || '联网'));
  card.appendChild(el('div', { class: 'badge', text: badge }));

  const name = item.name || item.title || '素材';
  const sub = item._src === 'web'
    ? `${item.license || '未标注'} · ${(item.author || '佚名').slice(0, 12)}`
    : (item.tags || []).slice(0, 4).join('·');
  card.appendChild(el('div', { class: 'mat-meta' }, [
    el('div', { class: 'mat-name', text: name, title: name }),
    el('div', { class: 'mat-tags', text: sub }),
  ]));

  const actions = el('div', { class: 'mat-actions' });
  if (item._src === 'builtin' || item._src === 'mine') {
    actions.appendChild(el('button', {
      class: 'btn primary', text: '加入画布',
      onclick: (e) => { e.stopPropagation(); item._src === 'builtin' ? addMaterial(item) : addLibraryImage(item); },
    }));
    if (item._src === 'builtin' && item.cat === 'paper') {
      actions.appendChild(el('button', {
        class: 'btn', text: '设为背景',
        onclick: (e) => {
          e.stopPropagation();
          state.background = { type: 'material', value: item.id, tile: !!item.tile };
          emit('changed'); emit('background');
          ok(`背景已设为：${item.name}`);
        },
      }));
    }
    if (item._src === 'mine') {
      actions.appendChild(el('button', {
        class: 'btn', text: '删除',
        onclick: async (e) => {
          e.stopPropagation();
          try { await api.deleteLibraryItem(item.id); await loadLibrary(); renderGrid(); ok('已删除'); }
          catch (err2) { err(err2.message); }
        },
      }));
    }
  } else {
    actions.appendChild(el('button', {
      class: 'btn primary', text: '收进素材库',
      onclick: async (e) => {
        e.stopPropagation();
        try {
          await api.importUrl(item.full || item.thumb, item, item.title || '联网素材', ['联网', item.source || '']);
          ok('已收进「我的素材」');
          await loadLibrary();
        } catch (err2) { err(`下载失败：${err2.message}`); }
      },
    }));
    actions.appendChild(el('button', {
      class: 'btn', text: '原图',
      onclick: (e) => { e.stopPropagation(); window.open(item.page_url || item.full, '_blank'); },
    }));
  }
  card.appendChild(actions);

  // 拖到画布
  card.draggable = true;
  card.addEventListener('dragstart', (ev) => {
    ev.dataTransfer.setData('text/plain', JSON.stringify({
      src: item._src, id: item.id, thumb: item.thumb, file: item.file, w: item.w, h: item.h,
      name: item.name || item.title, cat: item.cat,
    }));
  });
  card.addEventListener('click', () => {
    if (item._src === 'builtin') addMaterial(item);
    else if (item._src === 'mine') addLibraryImage(item);
  });
  return card;
}

/* ---------------------------------------------------------------- 导入 */

async function importFiles(files) {
  const list = Array.from(files || []).filter((f) => f.type.startsWith('image/'));
  if (!list.length) return err('请选择图片文件');
  let n = 0;
  for (const file of list) {
    try {
      const blob = await shrinkImage(file, 2400, 0.94);
      await api.importBlob(blob, file.name, ['导入'], 'imported');
      n += 1;
    } catch (e) {
      err(`「${file.name}」导入失败：${e.message}`);
    }
  }
  if (n) {
    ok(`已导入 ${n} 件素材`);
    await loadLibrary();
    view.source = 'mine';
    syncSourceChips();
    renderCatList();
    renderGrid();
  }
}

function syncSourceChips() {
  document.querySelectorAll('#source-filter .chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.source === view.source);
  });
}

/* ---------------------------------------------------------------- 联网检索 */

async function doWebSearch() {
  const q = $('#web-query')?.value.trim();
  const source = $('#web-source')?.value || 'wikimedia';
  const status = $('#web-status');
  if (!q) return err('请输入关键词');
  view.webSource = source;
  if (status) status.textContent = '正在检索…';
  try {
    const data = await api.search(source, q, 30);
    if (data.error) {
      view.webResults = [];
      renderGrid();
      if (status) status.textContent = `这个源暂时不可用：${data.error}`;
      return err('该素材源暂时不可用，换一个试试');
    }
    view.webResults = (data.results || []).map((r) => ({ ...r, cat: 'web' }));
    view.source = 'web';
    view.cat = 'all';
    syncSourceChips();
    renderCatList();
    renderGrid();
    if (status) status.textContent = `找到 ${view.webResults.length} 条结果（${source}）。全部为开放许可素材。`;
    if (!view.webResults.length) toast('没有找到结果，换个关键词试试');
  } catch (e) {
    if (status) status.textContent = `检索失败：${e.message}`;
    err(`检索失败：${e.message}`);
  }
}

/* ---------------------------------------------------------------- 初始化 */

export function initLibrary() {
  document.querySelectorAll('#source-filter .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      view.source = chip.dataset.source;
      view.cat = 'all';
      syncSourceChips();
      renderCatList();
      renderGrid();
      if (view.source === 'mine') loadLibrary();
    });
  });

  const search = $('#mat-search');
  search?.addEventListener('input', () => { view.q = search.value; renderGrid(); });

  const dz = $('#dropzone');
  const fi = $('#file-import');
  dz?.addEventListener('click', () => fi?.click());
  fi?.addEventListener('change', () => { importFiles(fi.files); fi.value = ''; });
  for (const evt of ['dragover', 'dragenter']) {
    dz?.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add('over'); });
  }
  for (const evt of ['dragleave', 'drop']) {
    dz?.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.remove('over'); });
  }
  dz?.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files);
  });

  $('#btn-web-search')?.addEventListener('click', doWebSearch);
  $('#web-query')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doWebSearch(); });

  document.addEventListener('dragover', (e) => {
    if (e.target.closest('#stage-viewport')) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    const vp = e.target.closest('#stage-viewport');
    if (!vp) return;
    e.preventDefault();
    const raw = e.dataTransfer?.getData('text/plain');
    if (!raw) return;
    let info;
    try { info = JSON.parse(raw); } catch (er) { return; }
    const stage = vp.querySelector('.stage');
    if (!stage) return;
    let item = null;
    if (info.src === 'builtin') item = state.materials.items.find((m) => m.id === info.id);
    else if (info.src === 'mine') item = state.library.find((m) => m.id === info.id);
    if (!item) return;
    const rect = stage.getBoundingClientRect();
    const totalW = Number(stage.dataset.totalW) || 1;
    const ppm = rect.width / totalW;
    const bleed = Number(stage.dataset.bleed) || 0;
    const xMm = (e.clientX - rect.left) / ppm - bleed;
    const yMm = (e.clientY - rect.top) / ppm - bleed;
    if (info.src === 'builtin') {
      const [nw, nh] = naturalMm(item);
      const [pw] = pageDims();
      const scale = Math.min(1, (pw * 0.6) / Math.max(1, nw));
      const layer = makeMaterialLayer(item, {
        w_mm: nw * scale, h_mm: nh * scale,
        x_mm: xMm - (nw * scale) / 2, y_mm: yMm - (nh * scale) / 2,
      });
      addLayer(layer);
    } else {
      addLibraryImage(item);
    }
  });
}
