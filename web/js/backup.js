/* Portable, self-contained project files: only raster data, never remote URLs. */
export function validateBundle(bundle, materialIds = null) {
  if (!bundle || bundle.format !== 'journal-studio-backup' || bundle.version !== 1) throw new Error('这不是支持的手账备份文件');
  const p = bundle.project;
  if (!p || !p.page || !['A3','A4','A5','A6','B5','B6','Weeks','Custom'].includes(p.page.size) || !['portrait','landscape'].includes(p.page.orientation)) throw new Error('备份纸张设置无效');
  if(p.page.size==='Custom'&&(!Number.isFinite(p.page.w_mm)||!Number.isFinite(p.page.h_mm)||p.page.w_mm<60||p.page.w_mm>210||p.page.h_mm<90||p.page.h_mm>297))throw new Error('自定义纸张尺寸无效');
  if (!Array.isArray(p.layers) || p.layers.length > 1000 || !Array.isArray(bundle.assets) || bundle.assets.length > 300) throw new Error('备份图层或素材数量无效');
  const refs = new Set();
  for (const a of bundle.assets) {
    if (!a || typeof a.id !== 'string' || refs.has(a.id) || typeof a.data !== 'string' || !/^data:image\/(png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/]+={0,2}$/.test(a.data)) throw new Error('备份中有无效图片');
    if (a.data.length > 40_000_000) throw new Error('单张素材过大');
    refs.add(a.id);
  }
  const ids = new Set();
  const number = (v, max = 10000) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
  for (const l of p.layers) {
    if (!l || !['material','image','text','shape'].includes(l.kind) || typeof l.id !== 'string' || ids.has(l.id)) throw new Error('备份图层无效');
    ids.add(l.id);
    if (!number(l.x_mm) || !number(l.y_mm) || !number(l.rotate ?? 0) || !number(l.opacity ?? 1, 1)) throw new Error('备份坐标无效');
    if (l.kind === 'text' && (typeof l.text !== 'string' || l.text.length > 20000 || !number(l.size_mm, 200) || l.size_mm <= 0)) throw new Error('备份文字无效');
    if (l.kind !== 'text' && (!number(l.w_mm) || !number(l.h_mm) || l.w_mm <= 0 || l.h_mm <= 0)) throw new Error('备份尺寸无效');
    if (l.kind === 'image' && !refs.has(l.ref)) throw new Error('备份缺少图片，无法完整恢复');
    if (l.kind === 'material' && materialIds && !materialIds.has(l.ref)) throw new Error('备份使用了当前版本没有的内置素材，请先更新网站');
  }
  const bg = p.background;
  if (!bg || !['color','material'].includes(bg.type) || typeof bg.value !== 'string') throw new Error('备份背景无效');
  if (bg.type === 'material' && materialIds && !materialIds.has(bg.value)) throw new Error('备份背景素材不存在');
  if (bg.type === 'color' && !/^#[0-9a-f]{3,8}$/i.test(bg.value)) throw new Error('备份背景颜色无效');
  return bundle;
}

export async function makeBundle(project, library, getBlob) {
  const assets = [];
  for (const id of new Set(project.layers.filter(l => l.kind === 'image').map(l => l.ref))) {
    const item = library.find(it => it.id === id);
    if (!item) throw new Error('当前作品有缺失图片，请重新导入后再备份');
    const blob = await getBlob(item);
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
    });
    assets.push({id, name: item.name, data});
  }
  return {format:'journal-studio-backup', version:1, createdAt:new Date().toISOString(), project:structuredClone(project), assets};
}

export async function restoreBundle(bundle, importImage, materialIds) {
  validateBundle(bundle, materialIds);
  const project = structuredClone(bundle.project);
  const mapping = new Map();
  for (const a of bundle.assets) mapping.set(a.id, await importImage(a));
  for (const l of project.layers) if (l.kind === 'image') l.ref = mapping.get(l.ref);
  return project;
}

let dbPromise;
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('journal-studio-works', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('works', {keyPath:'id'});
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(new Error('作品库无法打开，请导出备份文件')); };
  });
  return dbPromise;
}
export async function shelf(action, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('works', action === 'list' ? 'readonly' : 'readwrite');
    const os = transaction.objectStore('works');
    const req = action === 'list' ? os.getAll() : action === 'put' ? os.put(value) : os.delete(value);
    transaction.oncomplete = () => resolve(req.result);
    transaction.onerror = transaction.onabort = () => reject(new Error('作品库保存失败，请检查空间并导出备份'));
  });
}
