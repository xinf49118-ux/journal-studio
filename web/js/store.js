/**
 * 静态版的用户素材库：全部存在浏览器本地 IndexedDB 里，不上传任何服务器。
 *
 * 记录结构与服务端版 `data/library.json` 的 item 保持一致，
 * 额外多一个运行时字段 `url`（blob: 对象地址），供 <img> 和 canvas 直接使用。
 */

const DB_NAME = 'journal-studio';
const DB_VERSION = 1;
const STORE = 'library';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']);

let _dbPromise = null;
/** id -> objectURL，避免每次渲染都重新 createObjectURL */
const urlCache = new Map();

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('这个浏览器不支持本地素材库（IndexedDB 不可用）'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('打不开本地素材库'));
  });
  return _dbPromise;
}

function tx(mode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地数据库操作失败'));
  });
}

function withUrl(item) {
  if (!item || !item.blob) return item;
  if (!urlCache.has(item.id)) urlCache.set(item.id, URL.createObjectURL(item.blob));
  return { ...item, url: urlCache.get(item.id), blob: undefined };
}

const uid = () => `lib_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function cleanName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 60) || '未命名素材';
}

/** 取图片的宽高、是否带 alpha、主色 */
async function inspect(blob) {
  const info = { w: 0, h: 0, alpha: false, dominant: '#cccccc' };
  try {
    const bmp = await createImageBitmap(blob);
    info.w = bmp.width;
    info.h = bmp.height;
    // 抽稀采样估计主色与透明度
    const S = 48;
    const c = document.createElement('canvas');
    c.width = Math.min(S, bmp.width);
    c.height = Math.min(S, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    let sawAlpha = false;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 250) sawAlpha = true;
      if (d[i + 3] > 40) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n += 1; }
    }
    if (n) info.dominant = `#${[r / n, g / n, b / n].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    info.alpha = sawAlpha;
    bmp.close?.();
  } catch (e) {
    throw new Error('这看起来不是一张有效的图片');
  }
  return info;
}

export const store = {
  async list() {
    const os = await tx('readonly');
    const all = await wrap(os.getAll());
    return all.map(withUrl).sort((a, b) => String(b.added_at).localeCompare(String(a.added_at)));
  },

  async get(id) {
    const os = await tx('readonly');
    return withUrl(await wrap(os.get(id)));
  },

  async add(blob, { name = '', tags = [], cat = 'imported', origin = null } = {}) {
    const type = (blob.type || 'image/png').split(';')[0].toLowerCase();
    if (!ALLOWED.has(type)) {
      throw new Error('不支持的文件格式，请用 PNG / JPG / WebP / GIF');
    }
    if (!blob.size) throw new Error('文件内容为空');
    const info = await inspect(blob);
    const item = {
      id: uid(),
      name: cleanName(name),
      cat: cat || 'imported',
      tags: (tags || []).filter(Boolean).slice(0, 12),
      type,
      w: info.w,
      h: info.h,
      alpha: info.alpha,
      dominant: info.dominant,
      bytes: blob.size,
      added_at: new Date().toISOString(),
      origin: origin || { type: 'upload' },
      blob,
    };
    if (!item.tags.length) item.tags = ['导入'];
    const os = await tx('readwrite');
    await wrap(os.put(item));
    return withUrl(item);
  },

  async addUrl(url, meta = {}, name = '', tags = ['联网'], fetchBlob = null) {
    if (!fetchBlob) throw new Error('缺少下载器');
    const blob = await fetchBlob(url);
    return this.add(blob, {
      name: name || meta.title || '联网素材',
      tags,
      cat: 'imported',
      origin: {
        type: 'url',
        url,
        author: meta.author || '',
        license: meta.license || '',
        page_url: meta.page_url || '',
        source: meta.source || '',
      },
    });
  },

  async remove(id) {
    const os = await tx('readwrite');
    await wrap(os.delete(id));
    if (urlCache.has(id)) {
      URL.revokeObjectURL(urlCache.get(id));
      urlCache.delete(id);
    }
    return true;
  },

  async clear() {
    const os = await tx('readwrite');
    await wrap(os.clear());
    urlCache.forEach((u) => URL.revokeObjectURL(u));
    urlCache.clear();
  },

  async stats() {
    const items = await this.list();
    return { count: items.length, bytes: items.reduce((s, it) => s + (it.bytes || 0), 0) };
  },
};

/* ---------------------------------------------------------------- 工程存档 */

const PROJECT_KEY = 'journal-studio:project';

export const projectStore = {
  read() {
    try {
      const raw = localStorage.getItem(PROJECT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },
  write(project) {
    try {
      localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
      return true;
    } catch (e) {
      return false;
    }
  },
  clear() {
    try { localStorage.removeItem(PROJECT_KEY); } catch (e) { /* 忽略 */ }
  },
};
