/**
 * 纯浏览器渲染引擎：把渲染请求合成成 300dpi（或指定 dpi）的 canvas。
 *
 * 这是 `server/server.py` 里 `render_page()` 的 JS 移植，两者必须逐像素对齐：
 * 同样的页面几何取整、同样的图层顺序、同样的居中旋转语义、同样的裁切角线。
 * 差异点只有字体栅格化（浏览器 vs FreeType），已在下面注释说明。
 */

import { state, PAGE_SIZES, materialById, materialUrl, naturalMm, libraryUrl } from './core.js';
import { cssFontFamily } from './stage.js';

const MM_PER_INCH = 25.4;
export const TEXT_LINE_HEIGHT = 1.35; // 必须与 server.py 的 pitch 口径一致

/* ---------------------------------------------------------------- 小工具 */

const _f = (v, d = 0, lo = -Infinity, hi = Infinity) => {
  const x = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(x)) return d;
  return Math.min(hi, Math.max(lo, x));
};

const _i = (v) => Math.round(v);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** 页面几何解析：与 server.py 的 _page_geometry 同口径 */
export function pageGeometry(page = {}) {
  let w;
  let h;
  const size = String(page.size || 'A5');
  if (PAGE_SIZES[size]) {
    [w, h] = PAGE_SIZES[size];
  } else {
    w = _f(page.w_mm, 148, 10, 2000);
    h = _f(page.h_mm, 210, 10, 2000);
  }
  if (String(page.orientation || 'portrait') === 'landscape') {
    [w, h] = [Math.max(w, h), Math.min(w, h)];
  }
  return {
    w_mm: w,
    h_mm: h,
    dpi: _f(page.dpi, 300, 72, 600),
    bleed_mm: _f(page.bleed_mm, 0, 0, 30),
  };
}

/* ---------------------------------------------------------------- 图片加载 */

const imageCache = new Map();

export function clearImageCache() {
  imageCache.clear();
}

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (imageCache.has(url)) return imageCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    // 远程图（联网素材）必须带 CORS 才能画进 canvas 并导出，否则 canvas 会被污染
    if (!url.startsWith('blob:') && !url.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imageCache.set(url, p);
  return p;
}

/** 收集本次渲染需要的全部图片 URL */
function collectSources(req) {
  const urls = [];
  const bg = req.background || {};
  if (String(bg.type) === 'material' && bg.value) {
    const item = materialById(bg.value);
    if (item) urls.push(materialUrl(item));
  }
  for (const layer of req.layers || []) {
    if (!layer || typeof layer !== 'object') continue;
    if (layer.kind === 'material') {
      const item = materialById(layer.ref);
      if (item) urls.push(materialUrl(item));
    } else if (layer.kind === 'image') {
      const src = layerUrl(layer.ref);
      if (src) urls.push(src);
    }
  }
  return urls;
}

/** 用户素材的 URL 解析：服务端版是 /media/<id>，静态版是条目自带的 blob: 地址 */
function layerUrl(ref) {
  return ref ? libraryUrl(ref) : null;
}

/** 预加载：返回 url -> HTMLImageElement 的 Map */
export async function preload(req) {
  const urls = [...new Set(collectSources(req))];
  const imgs = await Promise.all(urls.map((u) => loadImage(u)));
  const map = new Map();
  urls.forEach((u, i) => { if (imgs[i]) map.set(u, imgs[i]); });
  return map;
}

/* ---------------------------------------------------------------- 绘制 */

/** 与 Pillow 的 rotate(expand=True) + 居中粘贴等价：绕自身中心旋转后按中心定位 */
function drawTransformed(ctx, img, cx, cy, w, h, rotateDeg, flipX, flipY) {
  ctx.save();
  ctx.translate(cx, cy);
  // PIL 的 rotate 正角是逆时针，canvas 的 rotate 正角是顺时针
  if (rotateDeg) ctx.rotate((-rotateDeg * Math.PI) / 180);
  if (flipX || flipY) ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function tileInto(ctx, img, x0, y0, x1, y1, tileW, tileH) {
  const tw = Math.max(1, Math.round(tileW));
  const th = Math.max(1, Math.round(tileH));
  const left = Math.round(x0);
  const top = Math.round(y0);
  const right = Math.round(x1);
  const bottom = Math.round(y1);
  for (let y = top; y < bottom; y += th) {
    for (let x = left; x < right; x += tw) {
      ctx.drawImage(img, x, y, tw, th);
    }
  }
}

/** 量一行字的墨迹宽度与左侧留白（对应 Pillow textbbox 的 bbox[0] 与宽度） */
function measureInk(ctx, text, line) {
  const m = ctx.measureText(line || ' ');
  const left = m.actualBoundingBoxLeft || 0;
  const right = m.actualBoundingBoxRight || 0;
  return { inkWidth: left + right, bearing: -left };
}

function fontMetrics(ctx, sizePx, sample) {
  const m = ctx.measureText(sample || 'Hg手账');
  // Chrome/Safari 支持 fontBoundingBox*，语义与 Pillow 的 getmetrics() 一致
  const asc = m.fontBoundingBoxAscent;
  const desc = m.fontBoundingBoxDescent;
  if (Number.isFinite(asc) && Number.isFinite(desc) && asc > 0) return { asc, desc };
  const a2 = m.actualBoundingBoxAscent || sizePx * 0.8;
  const d2 = m.actualBoundingBoxDescent || sizePx * 0.2;
  return { asc: a2, desc: d2 };
}

function drawTextLayer(ctx, layer, ppm, ox, oy) {
  const text = String(layer.text ?? '');
  if (!text) return;
  const sizePx = Math.max(4, _i(_f(layer.size_mm, 6, 0.5, 400) * ppm));
  const family = cssFontFamily(layer.font);
  const lines = text.split('\n').slice(0, 200);
  const color = String(layer.color || '#3b3b3b');

  // 用离屏 canvas 量度，再画到主画布
  const probe = makeCanvas(1, 1).getContext('2d');
  probe.font = `${sizePx}px ${family}`;
  probe.textBaseline = 'alphabetic';
  probe.textAlign = 'left';

  const { asc, desc } = fontMetrics(probe, sizePx);
  const pitch = sizePx * TEXT_LINE_HEIGHT;
  const halfLeading = (pitch - (asc + desc)) / 2;

  let tw = 1;
  const inks = [];
  for (const line of lines) {
    const ink = measureInk(probe, text, line);
    inks.push(ink);
    tw = Math.max(tw, Math.ceil(ink.inkWidth));
  }
  const th = Math.max(1, _i(pitch * lines.length));

  const tmp = makeCanvas(tw, th);
  const tctx = tmp.getContext('2d');
  tctx.font = `${sizePx}px ${family}`;
  tctx.textBaseline = 'alphabetic';
  tctx.textAlign = 'left';
  tctx.fillStyle = color;
  const align = String(layer.align || 'left');
  lines.forEach((line, i) => {
    let penX = 0;
    if (align === 'center') penX = (tw - inks[i].inkWidth) / 2 + inks[i].bearing;
    else if (align === 'right') penX = tw - inks[i].inkWidth + inks[i].bearing;
    tctx.fillText(line, penX, i * pitch + halfLeading + asc);
  });

  const cx = ox + _f(layer.x_mm) * ppm + tw / 2;
  const cy = oy + _f(layer.y_mm) * ppm + th / 2;
  drawTransformed(ctx, tmp, cx, cy, tw, th, _f(layer.rotate, 0, -360, 360), layer.flip_x, layer.flip_y);
}

function drawShapeLayer(ctx, layer, ppm, ox, oy) {
  const shape = String(layer.shape || 'rect');
  const x = ox + _f(layer.x_mm) * ppm;
  const y = oy + _f(layer.y_mm) * ppm;
  const w = _f(layer.w_mm, 10, -5000, 5000) * ppm;
  const h = _f(layer.h_mm, 10, -5000, 5000) * ppm;
  const fill = String(layer.fill || '#f3c7d4');
  const stroke = layer.stroke || null;
  const lw = Math.max(1, _i(_f(layer.stroke_mm, 0.4, 0, 50) * ppm));

  const aw = Math.abs(w);
  const ah = Math.abs(h);
  const tmp = makeCanvas(aw + lw * 2 + 2, ah + lw * 2 + 2);
  const t = tmp.getContext('2d');
  const bx = lw + 1;
  const by = lw + 1;
  t.fillStyle = fill;
  t.strokeStyle = stroke || 'transparent';
  t.lineWidth = stroke ? lw : 0;
  // Pillow 的 rectangle/ellipse 以像素边界为准，canvas 以中心线为准，这里做半像素补偿
  if (shape === 'ellipse') {
    t.beginPath();
    t.ellipse(bx + aw / 2, by + ah / 2, aw / 2, ah / 2, 0, 0, Math.PI * 2);
    if (stroke) t.stroke();
    t.fill();
  } else if (shape === 'line') {
    t.fillRect(bx, by + Math.round(ah / 2) - Math.floor(lw / 2), aw, lw);
  } else {
    t.fillRect(bx, by, aw, ah);
    if (stroke) t.strokeRect(bx + lw / 2, by + lw / 2, aw - lw, ah - lw);
  }

  const cx = x + w / 2;
  const cy = y + h / 2;
  drawTransformed(ctx, tmp, cx, cy, tmp.width, tmp.height, _f(layer.rotate, 0, -360, 360), layer.flip_x, layer.flip_y);
}

function drawCropMarks(ctx, ox, oy, cw, ch, bleedPx) {
  if (bleedPx < 6) return;
  const arm = Math.max(6, Math.round(bleedPx * 0.75));
  const t = Math.max(1, Math.floor(bleedPx / 14));
  ctx.fillStyle = '#2b2b2b';
  const left = ox;
  const top = oy;
  const right = ox + cw;
  const bottom = oy + ch;
  const corners = [
    [left, top, -1, -1],
    [right, top, 1, -1],
    [left, bottom, -1, 1],
    [right, bottom, 1, 1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    if (dx < 0) ctx.fillRect(cx - arm, cy - t / 2, arm - t, t);
    else ctx.fillRect(cx + t, cy - t / 2, arm - t, t);
    if (dy < 0) ctx.fillRect(cx - t / 2, cy - arm, t, arm - t);
    else ctx.fillRect(cx - t / 2, cy + t, t, arm - t);
  }
}

/* ---------------------------------------------------------------- 主入口 */

/**
 * 把一个渲染请求合成成 canvas。
 * @param {object} req 与 server.py 的渲染请求完全同构
 * @param {Map} [preloaded] preload() 的结果；不传则内部加载
 */
export async function renderToCanvas(req, preloaded = null) {
  const geo = pageGeometry(req.page || {});
  const ppm = geo.dpi / MM_PER_INCH;
  const bleedPx = _i(geo.bleed_mm * ppm);

  const contentW = Math.max(1, _i(geo.w_mm * ppm));
  const contentH = Math.max(1, _i(geo.h_mm * ppm));
  const W = Math.max(contentW, _i((geo.w_mm + geo.bleed_mm * 2) * ppm));
  const H = Math.max(contentH, _i((geo.h_mm + geo.bleed_mm * 2) * ppm));
  const ox = Math.floor((W - contentW) / 2);
  const oy = Math.floor((H - contentH) / 2);

  const imgs = preloaded || (await preload(req));
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // --- 背景 ---
  const bg = req.background || {};
  const bgType = String(bg.type || 'white');
  if (bgType === 'material' && bg.value) {
    const item = materialById(bg.value);
    const img = item ? imgs.get(materialUrl(item)) : null;
    if (img) {
      if (bg.tile || item.tile) {
        const [nw, nh] = naturalMm(item);
        tileInto(ctx, img, 0, 0, W, H, nw * ppm, nh * ppm);
      } else {
        // 等价 Pillow 的 ImageOps.fit（cover）
        const scale = Math.max(W / img.width, H / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
    }
  } else {
    ctx.fillStyle = bgType === 'color' ? String(bg.value || '#ffffff') : '#ffffff';
    ctx.fillRect(0, 0, W, H);
  }

  // --- 图层（数组顺序 = 从下到上）---
  for (const layer of req.layers || []) {
    if (!layer || typeof layer !== 'object') continue;
    const kind = String(layer.kind || 'material');
    const opacity = _f(layer.opacity, 1, 0, 1);
    if (opacity <= 0.001) continue;
    ctx.globalAlpha = opacity;
    try {
      if (kind === 'material' || kind === 'image') {
        let img = null;
        let natural = null;
        if (kind === 'material') {
          const item = materialById(layer.ref);
          if (item) {
            img = imgs.get(materialUrl(item)) || null;
            natural = naturalMm(item);
          }
        } else {
          const url = layerUrl(layer.ref);
          img = url ? (imgs.get(url) || null) : null;
        }
        if (!img) continue;
        const x = ox + _f(layer.x_mm) * ppm;
        const y = oy + _f(layer.y_mm) * ppm;
        let wPx = _f(layer.w_mm, 0, -5000, 5000) * ppm;
        let hPx = _f(layer.h_mm, 0, -5000, 5000) * ppm;
        if (wPx <= 0 && hPx <= 0) { wPx = img.width; hPx = img.height; }
        else if (wPx <= 0) wPx = Math.abs(hPx) * (img.width / img.height);
        else if (hPx <= 0) hPx = Math.abs(wPx) * (img.height / img.width);
        wPx = Math.max(1, _i(Math.abs(wPx)));
        hPx = Math.max(1, _i(Math.abs(hPx)));
        if (layer.tile) {
          const tw = natural ? natural[0] * ppm : img.width;
          const th = natural ? natural[1] * ppm : img.height;
          tileInto(ctx, img, x, y, x + wPx, y + hPx, tw, th);
          continue;
        }
        drawTransformed(ctx, img, x + wPx / 2, y + hPx / 2, wPx, hPx,
          _f(layer.rotate, 0, -360, 360), layer.flip_x, layer.flip_y);
      } else if (kind === 'text') {
        drawTextLayer(ctx, layer, ppm, ox, oy);
      } else if (kind === 'shape') {
        drawShapeLayer(ctx, layer, ppm, ox, oy);
      }
    } finally {
      ctx.globalAlpha = 1;
    }
  }

  // --- 裁切标记 ---
  if ((req.page || {}).crop_marks && bleedPx > 0) {
    drawCropMarks(ctx, ox, oy, contentW, contentH, bleedPx);
  }
  return canvas;
}

/** 渲染并转成 PNG Blob */
export async function renderToPngBlob(req) {
  const canvas = await renderToCanvas(req);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 生成失败'))), 'image/png');
  });
}

/** 渲染并转成 JPEG（给 PDF 用，体积小很多） */
export async function renderToJpeg(req, quality = 0.92) {
  const canvas = await renderToCanvas(req);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG 生成失败'))), 'image/jpeg', quality);
  });
  const buf = new Uint8Array(await blob.arrayBuffer());
  return { jpeg: buf, width: canvas.width, height: canvas.height };
}
