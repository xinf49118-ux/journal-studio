/**
 * 统一后端门面。
 *
 * 同一套前端代码支持两种运行方式：
 *   - server 模式：本机跑 `python server/server.py`，重活（分析、300dpi 渲染、PDF）交给 Python；
 *   - static 模式：部署在 GitHub Pages 上，全部在浏览器里完成（Canvas 渲染、IndexedDB 存素材）。
 *
 * 启动时探测一次 `api/health`：本机服务会返回 200，静态站点返回 404 → 自动落到 static。
 * 因此两个版本共用同一份代码，不需要维护两套。
 */

import { APP_ROOT, state } from './core.js';
import { store, projectStore } from './store.js';

export const MODE = { value: 'unknown' };

export async function detectMode() {
  if (MODE.value !== 'unknown') return MODE.value;
  try {
    const res = await fetch(new URL('api/health', APP_ROOT), { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok) {
        MODE.value = 'server';
        return MODE.value;
      }
    }
  } catch (e) {
    /* 静态站点上 api/health 不存在，属正常 */
  }
  MODE.value = 'static';
  return MODE.value;
}

export const isStatic = () => MODE.value === 'static';

/* ---------------------------------------------------------------- server 模式 */

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const ctype = res.headers.get('Content-Type') || '';
  if (!ctype.includes('application/json')) {
    if (!res.ok) throw new Error(`请求失败（${res.status}）`);
    return res;
  }
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

const apiUrl = (path) => new URL(path.replace(/^\//, ''), APP_ROOT).href;

/* ---------------------------------------------------------------- static 模式 */

const lazy = {
  render: () => import('./render.js'),
  analysis: () => import('./analysis.js'),
  sources: () => import('./sources.js'),
  pdf: () => import('./pdf.js'),
};

async function loadManifest() {
  const res = await fetch(new URL('assets/materials/manifest.json', APP_ROOT), { cache: 'force-cache' });
  if (!res.ok) throw new Error('内置素材清单读取失败，请确认 assets/materials/manifest.json 存在');
  return res.json();
}

/* ---------------------------------------------------------------- 门面 */

export const api = {
  mode: () => MODE.value,

  async health() {
    if (isStatic()) {
      const [manifest, stats, sources] = await Promise.all([
        loadManifest().catch(() => ({ items: [] })),
        store.stats().catch(() => ({ count: 0 })),
        lazy.sources().then((m) => m.SOURCES).catch(() => []),
      ]);
      return {
        ok: true,
        version: 1,
        mode: 'static',
        materials: (manifest.items || []).length,
        library: stats.count,
        sources,
        pdf: true,
      };
    }
    const data = await jsonFetch(apiUrl('api/health'));
    return { ...data, mode: 'server' };
  },

  async materials() {
    if (isStatic()) return loadManifest();
    return jsonFetch(apiUrl('api/materials'));
  },

  async library() {
    if (isStatic()) return { ok: true, items: await store.list() };
    return jsonFetch(apiUrl('api/library'));
  },

  async importBlob(blob, name, tags = [], cat = 'imported') {
    if (isStatic()) {
      const item = await store.add(blob, { name, tags, cat });
      return { ok: true, item };
    }
    const q = new URLSearchParams({ name: name || 'import.png', cat, tags: tags.join(',') });
    return jsonFetch(`${apiUrl('api/library/import')}?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
  },

  async importUrl(url, meta = {}, name = '', tags = ['联网']) {
    if (isStatic()) {
      const { fetchAsBlob } = await lazy.sources();
      const item = await store.addUrl(url, meta, name, tags, fetchAsBlob);
      return { ok: true, item };
    }
    return jsonFetch(apiUrl('api/library/import-url'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, meta, name, tags }),
    });
  },

  async deleteLibraryItem(id) {
    if (isStatic()) return { ok: await store.remove(id) };
    return jsonFetch(`${apiUrl('api/library/item')}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async search(source, q, limit = 24, page = 1) {
    if (isStatic()) return lazy.sources().then((m) => m.search(source, q, limit, page));
    const query = new URLSearchParams({ source, q, limit: String(limit), page: String(page) });
    return jsonFetch(`${apiUrl('api/search')}?${query}`);
  },

  async sources() {
    if (isStatic()) {
      const { probe } = await lazy.sources();
      return { ok: true, sources: await probe() };
    }
    return jsonFetch(apiUrl('api/sources'));
  },

  async analyze(blob) {
    if (isStatic()) {
      const { analyzeImageBlob } = await lazy.analysis();
      return analyzeImageBlob(blob);
    }
    const res = await fetch(apiUrl('api/analyze'), {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || '分析失败');
    return data;
  },

  async renderBlob(req) {
    if (isStatic()) {
      const { renderToPngBlob } = await lazy.render();
      return renderToPngBlob(req);
    }
    const res = await fetch(apiUrl('api/render'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(await errorMessage(res, '渲染失败'));
    return res.blob();
  },

  /** 导出：png → 高清 PNG；pdf → 单页 PDF（含出血） */
  async exportFile(kind, req, filename) {
    if (!isStatic()) {
      const res = await fetch(apiUrl(kind === 'pdf' ? 'api/export/pdf' : 'api/export/png'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error(await errorMessage(res, '导出失败'));
      downloadBlob(await res.blob(), filename);
      return;
    }
    const { renderToPngBlob, renderToJpeg, pageGeometry } = await lazy.render();
    if (kind === 'png') {
      downloadBlob(await renderToPngBlob(req), filename);
      return;
    }
    const geo = pageGeometry(req.page || {});
    const { jpeg, width, height } = await renderToJpeg(req);
    const { buildPdf } = await lazy.pdf();
    const bytes = buildPdf([{ jpeg, width, height }], {
      pageWmm: geo.w_mm + geo.bleed_mm * 2,
      pageHmm: geo.h_mm + geo.bleed_mm * 2,
      dpi: geo.dpi,
      title: `手账工坊 手账页面 ${(req.page || {}).size || 'A5'}`,
    });
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), filename);
  },

  async getProject() {
    if (isStatic()) return { ok: true, project: projectStore.read() };
    return jsonFetch(apiUrl('api/project'));
  },

  async saveProject(project) {
    if (isStatic()) return { ok: projectStore.write(project) };
    return jsonFetch(apiUrl('api/project'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
  },
};

async function errorMessage(res, fallback) {
  try {
    const j = await res.json();
    return j.error || `${fallback}（${res.status}）`;
  } catch (e) {
    return `${fallback}（${res.status}）`;
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export { state };
