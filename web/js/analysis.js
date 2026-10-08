/**
 * 页面分析引擎（纯前端版）—— server/analysis.py 的忠实移植。
 *
 * 目标：GitHub Pages 纯静态部署时，版面分析全部在浏览器里跑，不再依赖 Python 服务。
 * 契约（与 Python 的 analyze_image() 输出完全同构）：
 *   { ok, image:{w,h,aspect,preview}, background:{hex,plain,texture},
 *     palette:[{hex,ratio}], whitespace, style:{mood,density,warmth},
 *     regions:[{x,y,w,h,type,density,fill,aspect}], suggest:{page_size,dpi} }
 *
 * 三个导出：
 *   analyzePixels(rgba, width, height[, options]) —— 纯函数，无任何 DOM 依赖，Node 里可直接跑。
 *   analyzeImageBlob(blob)                        —— 浏览器路径：解码 → 缩放 → analyzePixels → 预览图。
 *   blobToPreviewDataUri(blob, maxSide, quality)   —— 浏览器路径：只要预览 dataURI。
 *
 * 与 Python 的已知差异（都写在对应实现处的注释里）：
 *   1) 缩略图重采样：Python 用 Pillow LANCZOS，浏览器用 canvas drawImage（imageSmoothingQuality=high）。
 *      差异只体现在像素级噪声上，不改变背景/区块类型的判定；analyzePixels 由调用方传入已经缩好的像素。
 *   2) k-means++ 的随机流：已按 numpy 的 PCG64 + 32 位 Lemire + choice 逐位复刻（种子 20260930），
 *      聚类结果与 Python 一致；PCG64 的初始 state/inc 是写死的常量，见下方注释。
 *   3) Pillow 的 BOX 缩放（连通域网格）已按 C 实现的定点系数 + 权重窗口复刻，见 _boxResize。
 *   4) image.preview：analyzePixels 是纯函数、拿不到 canvas，返回空串，由 analyzeImageBlob 填。
 */

// ---------------------------------------------------------------- 常量（与 analysis.py 同名同值）
const ANALYSIS_MAX = 1024;        // 分析用图的最长边
const GRID_LONG = 96;             // 连通域分割的网格长边
const MIN_CELLS = 3;              // 小于这么多格子的连通域丢弃
const DIFF_THRESHOLD = 30.0;      // 与背景色的 RGB 欧氏距离阈值
const PREVIEW_MAX = 900;          // 预览图最长边
const KMEANS_K = 6;               // 配色聚类数
const KMEANS_ITERS = 14;          // k-means 迭代上限
const KMEANS_SEED = 20260930;     // 固定种子
const KMEANS_POOL = 24000;        // 参与聚类的抽样上限
const PALETTE_MIN_RATIO = 0.012;  // 占比太小的颜色不进配色表
const MERGE_GAP = 0.012;          // 区块合并的贴合间隙
const MAX_REGIONS = 60;           // 最多返回的区块数

// ================================================================ 数值小工具

/** Python 的 round()：四舍六入五取偶（银行家舍入）。坐标/颜色的末尾取整必须跟它一致。 */
function _pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Python 的 round(x, ndigits)，用于坐标、占比、留白等字段的末尾取整。 */
function _roundTo(x, nd) {
  const p = Math.pow(10, nd);
  return _pyRound(x * p) / p;
}

/** 与 analysis.py 的 _hex() 一致：clamp 到 0–255 后按 Python 规则取整。 */
function _hex(r, g, b) {
  const conv = (c) => {
    const v = _pyRound(Math.max(0, Math.min(255, Number(c))));
    return v.toString(16).padStart(2, '0');
  };
  return '#' + conv(r) + conv(g) + conv(b);
}

/** 中位数（模拟 numpy.median：偶数个元素取中间两个的平均）。不改动入参。 */
function _median(values) {
  const n = values.length;
  if (n === 0) return NaN;
  const a = values.slice();
  a.sort();
  const mid = n >> 1;
  return n % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// ---------------------------------------------------------------- numpy 随机流复刻
//
// k-means++ 的选种直接影响聚类结果（进而影响 style.mood），所以这里**逐位复刻** numpy
// 的默认随机流，而不是随便找一个种子相同的 PRNG：
//   * 位生成器 = numpy 的 PCG64（XSL-RR 128/64），步进：state = state*MULT + inc (mod 2^128)，
//     输出：rotr64(hi ^ lo, state >> 122)。
//   * 初始 state/inc 就是 `np.random.default_rng(20260930)` 的初始状态，
//     即 SeedSequence(20260930) 派生出来的两个 128 位常量（下面写死，见注释里的复现方法）。
//   * `rng.integers(n)` 在 n < 2^32 时走 32 位 Lemire 路径，且 64 位抽样结果的高低 32 位
//     会被缓存、分两次消费（实测 `np.random.default_rng(20260930).integers(24713)` 的
//     序列 = [lemire32(raw0&0xffffffff), lemire32(raw0>>32), lemire32(raw1&0xffffffff), ...]）。
//   * `rng.choice(n, p=...)` = cumsum → 归一化 → searchsorted(side='right')，
//     随机数取 (next_uint64 >> 11) * 2^-53。
//
// 复现初始常量的方法（换种子时重跑一次，把结果贴回来即可）：
//   python -c "import numpy as np; s=np.random.PCG64(20260930).state; print(s['state']['state'], s['state']['inc'])"
const PCG64_MULT = 0x2360ed051fc65da44385df649fccf645n;
const PCG64_MASK64 = (1n << 64n) - 1n;
const PCG64_MASK128 = (1n << 128n) - 1n;
const KMEANS_INIT_STATE = 193855659769767237123971163402640815513n;  // SeedSequence(20260930)
const KMEANS_INIT_INC = 300367605980535612906059345625249647123n;

/** numpy PCG64 的等价实现（k-means++ 选种专用，调用次数只有个位数）。 */
class _NumpyRng {
  constructor(seed = KMEANS_SEED) {
    if (seed !== KMEANS_SEED) {
      throw new Error('改 KMEANS_SEED 时必须同步重算 PCG64 初始 state/inc（见上方注释）');
    }
    this.state = KMEANS_INIT_STATE;
    this.inc = KMEANS_INIT_INC;
    this.hasUint32 = false;
    this.uinteger = 0;
  }

  /** pcg64_next64：先步进再输出 XSL-RR。 */
  nextUint64() {
    this.state = (this.state * PCG64_MULT + this.inc) & PCG64_MASK128;
    const x = ((this.state >> 64n) ^ this.state) & PCG64_MASK64;
    const rot = Number(this.state >> 122n) & 63;
    if (rot === 0) return x;
    return ((x >> BigInt(rot)) | (x << BigInt(64 - rot))) & PCG64_MASK64;
  }

  /** pcg64_next32：低 32 位先给，高 32 位缓存到下一次。 */
  nextUint32() {
    if (this.hasUint32) {
      this.hasUint32 = false;
      return this.uinteger;
    }
    const x = this.nextUint64();
    this.hasUint32 = true;
    this.uinteger = Number((x >> 32n) & 0xffffffffn);
    return Number(x & 0xffffffffn);
  }

  /** (next_uint64 >> 11) * 2^-53，对应 numpy 的 random_double。 */
  nextDouble() {
    return Number(this.nextUint64() >> 11n) * 2.0 ** -53;
  }

  /** 32 位 Lemire 取模（numpy random_bounded_uint32 的无偏拒绝采样）。 */
  integers(n) {
    const N = BigInt(n);
    let x = this.nextUint32();
    let m = BigInt(x) * N;
    let low = Number(m & 0xffffffffn);
    if (low < n) {
      const threshold = (4294967296 - n) % n;     // = (-n) % n（uint32）
      while (low < threshold) {
        x = this.nextUint32();
        m = BigInt(x) * N;
        low = Number(m & 0xffffffffn);
      }
    }
    return Number(m >> 32n);
  }

  /** 等价于 numpy 的 rng.choice(n, p=weights/total)：累积分布 + searchsorted(side='right')。 */
  choiceWeighted(d, total) {
    const n = d.length;
    const cdf = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += d[i] / total;
      cdf[i] = acc;
    }
    const last = cdf[n - 1];
    if (last > 0) for (let i = 0; i < n; i++) cdf[i] /= last;
    const u = this.nextDouble();
    let lo = 0, hi = n;
    while (lo < hi) {                              // 第一个 cdf[i] > u
      const mid = (lo + hi) >> 1;
      if (cdf[mid] <= u) lo = mid + 1;
      else hi = mid;
    }
    return lo < n ? lo : n - 1;
  }
}

/** RGBA 字节 → RGB（float32，行主序）。透明像素按 analysis.py 的做法铺白。 */
function _toRgbFloat(rgba, w, h) {
  const n = w * h;
  const out = new Float32Array(n * 3);
  for (let i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) {
    const a = rgba[j + 3];
    if (a === 255) {
      out[k] = rgba[j];
      out[k + 1] = rgba[j + 1];
      out[k + 2] = rgba[j + 2];
    } else {
      // Pillow 的 canvas.paste(rgba, mask=alpha) 是整数运算，这里保持同样的截断
      const ia = a;
      out[k] = Math.floor((rgba[j] * ia + 255 * (255 - ia)) / 255);
      out[k + 1] = Math.floor((rgba[j + 1] * ia + 255 * (255 - ia)) / 255);
      out[k + 2] = Math.floor((rgba[j + 2] * ia + 255 * (255 - ia)) / 255);
    }
  }
  return out;
}

// ================================================================ k-means（含 k-means++ 初始化）

/**
 * 极简 k-means，返回 { centers: Float64Array(k*3), ratios: Float64Array(k) }。
 * 与 analysis.py 的 _kmeans() 同构：k-means++ 初始化（numpy 同款随机流）+ 14 轮 Lloyd 迭代 +
 * 按簇大小降序。中心点按 float32 保存（Python 那边是 float32 数组），保证距离计算口径一致。
 */
function _kmeans(sample, n, k) {
  if (n === 0) return { centers: new Float64Array(0), ratios: new Float64Array(0) };
  k = Math.max(1, Math.min(k, n));
  const rng = new _NumpyRng();
  const centers = new Float64Array(k * 3);
  const d = new Float64Array(n);

  const copyPixel = (idx, slot) => {
    centers[slot * 3] = Math.fround(sample[idx * 3]);
    centers[slot * 3 + 1] = Math.fround(sample[idx * 3 + 1]);
    centers[slot * 3 + 2] = Math.fround(sample[idx * 3 + 2]);
  };

  // k-means++：先随机取一点，再按「到已有中心的距离平方」做概率抽样挑远点
  copyPixel(rng.integers(n), 0);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      const p = i * 3;
      let best = Infinity;
      for (let j = 0; j < c; j++) {
        const dx = sample[p] - centers[j * 3];
        const dy = sample[p + 1] - centers[j * 3 + 1];
        const dz = sample[p + 2] - centers[j * 3 + 2];
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist < best) best = dist;
      }
      d[i] = best;
      total += best;
    }
    if (!(total > 0)) {
      copyPixel(rng.integers(n), c);
      continue;
    }
    copyPixel(rng.choiceWeighted(d, total), c);
  }

  // Lloyd 迭代
  const labels = new Int32Array(n);
  const next = new Int32Array(n);
  const sum = new Float64Array(k * 3);
  const cnt = new Float64Array(k);
  let changed = true;
  for (let it = 0; it < KMEANS_ITERS && changed; it++) {
    for (let i = 0; i < n; i++) {
      const p = i * 3;
      const px = sample[p], py = sample[p + 1], pz = sample[p + 2];
      let best = Infinity;
      let bi = 0;
      for (let j = 0; j < k; j++) {
        const dx = px - centers[j * 3];
        const dy = py - centers[j * 3 + 1];
        const dz = pz - centers[j * 3 + 2];
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist < best) { best = dist; bi = j; }
      }
      next[i] = bi;
    }
    changed = false;
    for (let i = 0; i < n; i++) {
      if (next[i] !== labels[i]) { changed = true; break; }
    }
    if (!changed) break;              // 与 Python 一样：标签不再变化就提前收工
    labels.set(next);
    sum.fill(0);
    cnt.fill(0);
    for (let i = 0; i < n; i++) {
      const j = labels[i];
      const p = i * 3;
      sum[j * 3] += sample[p];
      sum[j * 3 + 1] += sample[p + 1];
      sum[j * 3 + 2] += sample[p + 2];
      cnt[j] += 1;
    }
    for (let j = 0; j < k; j++) {
      if (cnt[j] > 0) {
        // Python 的 sel.mean(axis=0) 落在 float32 数组里，这里显式 fround 保持一致
        centers[j * 3] = Math.fround(sum[j * 3] / cnt[j]);
        centers[j * 3 + 1] = Math.fround(sum[j * 3 + 1] / cnt[j]);
        centers[j * 3 + 2] = Math.fround(sum[j * 3 + 2] / cnt[j]);
      }
    }
  }

  // 按簇大小降序（Python 用 argsort(-counts)，这里用稳定排序，平局顺序影响不到输出）
  const order = new Array(k);
  for (let i = 0; i < k; i++) order[i] = i;
  order.sort((a, b) => cnt[b] - cnt[a] || a - b);

  const outCenters = new Float64Array(k * 3);
  const ratios = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const j = order[i];
    outCenters[i * 3] = centers[j * 3];
    outCenters[i * 3 + 1] = centers[j * 3 + 1];
    outCenters[i * 3 + 2] = centers[j * 3 + 2];
    ratios[i] = cnt[j] / Math.max(1, n);
  }
  return { centers: outCenters, ratios };
}

// ================================================================ 形态学 / 网格化

/** 4 邻域腐蚀（对应 np.roll 版的开运算前半段；np.roll 会环绕，这里保持一致）。 */
function _erode4(src, dst, w, h) {
  for (let y = 0; y < h; y++) {
    const up = ((y - 1 + h) % h) * w;
    const mid = y * w;
    const dn = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const l = (x - 1 + w) % w;
      const r = (x + 1) % w;
      dst[mid + x] = (src[mid + x] && src[up + x] && src[dn + x] && src[mid + l] && src[mid + r]) ? 1 : 0;
    }
  }
}

/** 4 邻域膨胀（开运算后半段）。 */
function _dilate4(src, dst, w, h) {
  for (let y = 0; y < h; y++) {
    const up = ((y - 1 + h) % h) * w;
    const mid = y * w;
    const dn = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const l = (x - 1 + w) % w;
      const r = (x + 1) % w;
      dst[mid + x] = (src[mid + x] || src[up + x] || src[dn + x] || src[mid + l] || src[mid + r]) ? 1 : 0;
    }
  }
}

/**
 * 复刻 Pillow 的 Image.resize(..., Image.BOX)（8bpc 两趟：先水平后垂直）。
 *
 * Pillow 的 C 实现（Resample.c / precompute_coeffs）：
 *   scale = inSize / outSize；filterscale = max(scale, 1)；support = 0.5 * filterscale；
 *   center = (i + 0.5) * scale；
 *   先用 (int)(center - support + 0.5) / (int)(center + support + 0.5) 框出候选范围，
 *   再逐像素套 BOX 滤波 w = (|(p - center + 0.5)/filterscale| <= 0.5 ? 1 : 0)——
 *   **边界上权重为 0 的像素会被丢掉**（这一步不能省，否则长边缩放比会出现整像素偏差）；
 *   系数按定点量化 (int)(w * 2^22 + 0.5)，累加后 clip8（右移 22 位 + clamp 到 0–255），
 *   中间结果同样量化成 uint8，所以两趟之间会有一次取整。
 * 实测（30 组不同尺寸/密度的随机掩码，含 40×1024、300×1000 等极端长宽比）与 Pillow 逐字节一致。
 */
function _boxResize(mask, w, h, gw, gh) {
  const PB = 22;
  const HALF = 1 << (PB - 1);
  const SCALE = 1 << PB;

  /** 输出下标 i 对应的有效源像素下标列表（Pillow 的窗口 + 权重过滤）。 */
  const window = (i, s, n) => {
    const filterscale = s >= 1 ? s : 1;
    const support = 0.5 * filterscale;
    const ss = 1 / filterscale;
    const center = (i + 0.5) * s;
    let a = Math.trunc(center - support + 0.5);
    if (a < 0) a = 0;
    let b = Math.trunc(center + support + 0.5);
    if (b > n) b = n;
    const idx = [];
    for (let p = a; p < b; p++) {
      const arg = (p - center + 0.5) * ss;
      if (arg > -0.5 && arg <= 0.5) idx.push(p);
    }
    return idx;
  };

  // 第一趟：水平（源是 0/1 掩码，等价于像素值 0/255）
  const tmp = new Uint8Array(h * gw);
  const sx = w / gw;
  for (let gx = 0; gx < gw; gx++) {
    const idx = window(gx, sx, w);
    if (!idx.length) continue;
    const coef = Math.floor(SCALE / idx.length + 0.5);
    for (let y = 0; y < h; y++) {
      const base = y * w;
      let sum = 0;
      for (let k = 0; k < idx.length; k++) sum += mask[base + idx[k]];
      let v = Math.floor((sum * 255 * coef + HALF) / SCALE);
      if (v > 255) v = 255; else if (v < 0) v = 0;
      tmp[y * gw + gx] = v;
    }
  }

  // 第二趟：垂直（输入是上一趟量化后的 uint8，累加的就是 0–255 的像素值，不再乘 255）
  const out = new Uint8Array(gh * gw);
  const sy = h / gh;
  for (let gy = 0; gy < gh; gy++) {
    const idx = window(gy, sy, h);
    if (!idx.length) continue;
    const coef = Math.floor(SCALE / idx.length + 0.5);
    for (let gx = 0; gx < gw; gx++) {
      let sum = 0;
      for (let k = 0; k < idx.length; k++) sum += tmp[idx[k] * gw + gx];
      let v = Math.floor((sum * coef + HALF) / SCALE);
      if (v > 255) v = 255; else if (v < 0) v = 0;
      out[gy * gw + gx] = v;
    }
  }
  return out;
}

// ================================================================ 区块几何

/**
 * 8 连通域标记（显式栈 + 类型化数组）。
 * 直接把「网格包围盒 → 原图掩码上的精确包围盒」一步做完，等价于 analysis.py 里
 * _label_components() + 后续的 rows/cols 细化，只是不保存每个格子的坐标。
 */
function _componentsToBoxes(mask, w, h, grid, gh, gw) {
  const visited = new Uint8Array(gh * gw);
  const stack = new Int32Array(gh * gw);
  const boxes = [];

  for (let sy0 = 0; sy0 < gh; sy0++) {
    for (let sx0 = 0; sx0 < gw; sx0++) {
      const start = sy0 * gw + sx0;
      if (!grid[start] || visited[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      visited[start] = 1;
      let count = 0, minY = sy0, maxY = sy0, minX = sx0, maxX = sx0;
      while (sp > 0) {
        const cur = stack[--sp];
        const cy = (cur / gw) | 0;
        const cx = cur - cy * gw;
        count++;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = cy + dy;
          if (ny < 0 || ny >= gh) continue;
          const nrow = ny * gw;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            if (nx < 0 || nx >= gw) continue;
            const ni = nrow + nx;
            if (grid[ni] && !visited[ni]) {
              visited[ni] = 1;
              stack[sp++] = ni;
            }
          }
        }
      }
      if (count < MIN_CELLS) continue;

      // 网格包围盒 → 原图范围（与 analysis.py 的 int()/ceil 规则一致）
      const py0 = Math.floor(minY * h / gh);
      const py1 = Math.min(h - 1, Math.ceil((maxY + 1) * h / gh));
      const px0 = Math.floor(minX * w / gw);
      const px1 = Math.min(w - 1, Math.ceil((maxX + 1) * w / gw));

      let firstRow = -1, lastRow = -1, firstCol = -1, lastCol = -1;
      for (let yy = py0; yy <= py1; yy++) {
        const base = yy * w;
        for (let xx = px0; xx <= px1; xx++) {
          if (mask[base + xx]) {
            if (firstRow < 0) firstRow = yy;
            lastRow = yy;
            if (firstCol < 0 || xx < firstCol) firstCol = xx;
            if (xx > lastCol) lastCol = xx;
          }
        }
      }
      if (firstRow < 0) continue;
      const y0 = firstRow, y1 = lastRow + 1, x0 = firstCol, x1 = lastCol + 1;
      boxes.push([x0 / w, y0 / h, Math.max(1e-4, (x1 - x0) / w), Math.max(1e-4, (y1 - y0) / h)]);
    }
  }
  return boxes;
}

/** 把挨得很近的区块合并（与 analysis.py 的 _merge_boxes 逐行对应）。 */
function _mergeBoxes(input, gap = MERGE_GAP) {
  let boxes = input.map((b) => b.slice());
  let changed = true;
  while (changed) {
    changed = false;
    const out = [];
    for (const b of boxes) {
      let hit = false;
      for (const o of out) {
        if (!(
          b[0] > o[0] + o[2] + gap ||
          o[0] > b[0] + b[2] + gap ||
          b[1] > o[1] + o[3] + gap ||
          o[1] > b[1] + b[3] + gap
        )) {
          const x0 = Math.min(b[0], o[0]);
          const y0 = Math.min(b[1], o[1]);
          const x1 = Math.max(b[0] + b[2], o[0] + o[2]);
          const y1 = Math.max(b[1] + b[3], o[1] + o[3]);
          o[0] = x0; o[1] = y0; o[2] = x1 - x0; o[3] = y1 - y0;
          changed = true;
          hit = true;
          break;
        }
      }
      if (!hit) out.push(b.slice());
    }
    boxes = out;
  }
  return boxes;
}

/** 把竖直堆叠、左右对齐的「细长条」合并成一段文字块（同 _group_text_lines）。 */
function _groupTextLines(boxes) {
  const lineIdx = [];
  const rest = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b[3] < 0.07 && b[2] / Math.max(1e-6, b[3]) > 4.0) lineIdx.push(i);
    else rest.push(b);
  }
  // Python 里 line_idx 是 set，sorted 在 y 相同时顺序取决于 set 迭代序；这里用升序索引，
  // 只有「多个细长条 y 完全相同」时两者才可能不同，而那种情况的合并结果是一样的。
  lineIdx.sort((a, b) => boxes[a][1] - boxes[b][1] || a - b);

  const groups = [];
  for (const i of lineIdx) {
    const b = boxes[i];
    let placed = false;
    for (const g of groups) {
      let gx0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
      for (const x of g) {
        if (x[0] < gx0) gx0 = x[0];
        if (x[0] + x[2] > gx1) gx1 = x[0] + x[2];
        if (x[1] + x[3] > gy1) gy1 = x[1] + x[3];
      }
      const overlap = Math.min(gx1, b[0] + b[2]) - Math.max(gx0, b[0]);
      const sameColumn = overlap > 0.45 * Math.min(gx1 - gx0, b[2]);
      const closeEnough = (b[1] - gy1) < Math.max(0.025, 2.2 * b[3]);
      if (sameColumn && closeEnough) {
        g.push(b);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([b]);
  }

  const out = rest.map((b) => b.slice());
  for (const g of groups) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of g) {
      if (x[0] < x0) x0 = x[0];
      if (x[1] < y0) y0 = x[1];
      if (x[0] + x[2] > x1) x1 = x[0] + x[2];
      if (x[1] + x[3] > y1) y1 = x[1] + x[3];
    }
    out.push([x0, y0, x1 - x0, y1 - y0]);
  }
  return out;
}

/**
 * 按填充率、行/列覆盖率、边缘密度、长宽比判断区块类型（判定顺序与阈值同 _classify）。
 */
function _classify(mask, arr, w, h, box, pageAspect) {
  const x = box[0], y = box[1], bw = box[2], bh = box[3];
  const y0 = Math.max(0, Math.trunc(y * h));
  const y1 = Math.min(h, Math.ceil((y + bh) * h));
  const x0 = Math.max(0, Math.trunc(x * w));
  const x1 = Math.min(w, Math.ceil((x + bw) * w));
  if (y1 <= y0 || x1 <= x0) return 'decor';

  const W = x1 - x0, H = y1 - y0;
  let sum = 0, rowsWith = 0, colsWith = 0;
  const colHit = new Uint8Array(W);
  for (let yy = y0; yy < y1; yy++) {
    const base = yy * w;
    let rowAny = 0;
    for (let xx = x0; xx < x1; xx++) {
      if (mask[base + xx]) {
        sum++;
        rowAny = 1;
        colHit[xx - x0] = 1;
      }
    }
    if (rowAny) rowsWith++;
  }
  for (let i = 0; i < W; i++) if (colHit[i]) colsWith++;

  const ink = sum / (W * H);
  const rowCov = rowsWith / H;
  const colCov = colsWith / W;

  // 边缘密度：灰度在行/列方向的平均绝对差，取两者较大值
  let edge = 0;
  if (W * H > 0) {
    const gray = new Float64Array(W);
    const prev = new Float64Array(W);
    let sy = 0, sx = 0;
    for (let r = 0; r < H; r++) {
      const base = (y0 + r) * w;
      for (let c = 0; c < W; c++) {
        const p = (base + x0 + c) * 3;
        gray[c] = (arr[p] + arr[p + 1] + arr[p + 2]) / 3;
      }
      if (r > 0) for (let c = 0; c < W; c++) sy += Math.abs(gray[c] - prev[c]);
      if (W > 1) for (let c = 0; c < W - 1; c++) sx += Math.abs(gray[c + 1] - gray[c]);
      prev.set(gray);
    }
    const gy = H > 1 ? sy / ((H - 1) * W) : 0.0;
    const gx = W > 1 ? sx / (H * (W - 1)) : 0.0;
    edge = Math.max(gx, gy);
  }

  const aspect = (bw * pageAspect) / Math.max(1e-6, bh);   // 换算到真实视觉长宽比
  const area = bw * bh;
  const touches = x < 0.03 || y < 0.03 || x + bw > 0.97 || y + bh > 0.97;

  // 1) 扁长条：胶带 / 单行文字 / 分割装饰
  if (aspect > 3.2 && bh < 0.18) {
    if (ink > 0.55 && rowCov > 0.85) return 'tape';
    if (edge > 6.0) return 'text';
    return 'decor';
  }
  // 2) 实心块 = 照片 / 贴纸大图
  if (ink > 0.72 && rowCov > 0.9 && colCov > 0.9) return 'photo';
  // 3) 稀疏笔画 + 边缘密集 = 文字段
  if (edge > 6.5 && ink < 0.62 && rowCov < 0.96) return 'text';
  // 4) 贴边细框
  if (touches && ink < 0.4) return 'frame';
  // 5) 小装饰 / 其余
  if (area < 0.012) return 'decor';
  return ink > 0.55 ? 'photo' : 'decor';
}

// ================================================================ 主入口（纯函数）

/**
 * 分析一份已经缩好的 RGBA 像素。
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba 原始 RGBA 字节（行主序，左上原点）
 * @param {number} width  分析尺寸（= Python 里 thumbnail 之后的宽）
 * @param {number} height 分析尺寸
 * @param {{origWidth?:number, origHeight?:number, preview?:string}} [options]
 *        origWidth/origHeight 用于 image.w/h 与 suggest.page_size（对应 Python 的 orig_w/orig_h）；
 *        不传就按 width/height 当原图尺寸。preview 由浏览器路径填。
 * @returns {object} 与 server/analysis.py 的 analyze_image() 完全同构的结果
 */
export function analyzePixels(rgba, width, height, options = {}) {
  if (!rgba || typeof rgba.length !== 'number') {
    throw new TypeError('analyzePixels 需要一个 RGBA 字节数组');
  }
  const w = width | 0;
  const h = height | 0;
  if (w < 40 || h < 40) throw new Error('图片太小了，至少需要 40×40 像素');
  if (rgba.length < w * h * 4) throw new Error('RGBA 数据长度与宽高不匹配');

  const origW = options.origWidth || w;
  const origH = options.origHeight || h;

  const arr = _toRgbFloat(rgba, w, h);
  const pageAspect = w / Math.max(1, h);

  // --- 背景色：取四周边缘环带的中位数，避免被正中内容带偏 ---
  const ring = Math.max(2, Math.trunc(Math.min(h, w) * 0.04));
  const nBorder = 2 * ring * (w + h);           // 四角像素会被两条环带各算一次（同 Python 的 concatenate）
  const borderR = new Float64Array(nBorder);
  const borderG = new Float64Array(nBorder);
  const borderB = new Float64Array(nBorder);
  let bi = 0;
  const pushPx = (x, y) => {
    const p = (y * w + x) * 3;
    borderR[bi] = arr[p];
    borderG[bi] = arr[p + 1];
    borderB[bi] = arr[p + 2];
    bi++;
  };
  for (let y = 0; y < ring; y++) for (let x = 0; x < w; x++) pushPx(x, y);
  for (let y = h - ring; y < h; y++) for (let x = 0; x < w; x++) pushPx(x, y);
  for (let y = 0; y < h; y++) for (let x = 0; x < ring; x++) pushPx(x, y);
  for (let y = 0; y < h; y++) for (let x = w - ring; x < w; x++) pushPx(x, y);

  const bgR = _median(borderR);
  const bgG = _median(borderG);
  const bgB = _median(borderB);

  let stdSum = 0;
  for (const ch of [borderR, borderG, borderB]) {
    let mean = 0;
    for (let i = 0; i < ch.length; i++) mean += ch[i];
    mean /= ch.length;
    let v = 0;
    for (let i = 0; i < ch.length; i++) { const d = ch[i] - mean; v += d * d; }
    stdSum += Math.sqrt(v / ch.length);
  }
  const borderStd = stdSum / 3;
  const plain = borderStd < 11.0;
  const texture = plain ? 'none' : (borderStd < 30 ? 'subtle' : 'pattern');

  // --- 内容掩码 ---
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 3) {
    const dr = arr[p] - bgR;
    const dg = arr[p + 1] - bgG;
    const db = arr[p + 2] - bgB;
    mask[i] = Math.sqrt(dr * dr + dg * dg + db * db) > DIFF_THRESHOLD ? 1 : 0;
  }
  // 形态学开运算去掉椒盐噪点（腐蚀 → 膨胀，各 1 次）
  const tmpMask = new Uint8Array(w * h);
  _erode4(mask, tmpMask, w, h);
  _dilate4(tmpMask, mask, w, h);

  let contentSum = 0;
  for (let i = 0; i < mask.length; i++) contentSum += mask[i];
  const content = contentSum / mask.length;

  // --- 配色：抽样 + k-means ---
  const nPix = w * h;
  const step = Math.max(1, Math.trunc(nPix / KMEANS_POOL));
  const nSample = Math.ceil(nPix / step);
  const sample = new Float32Array(nSample * 3);
  for (let s = 0, k = 0; s < nSample; s++) {
    const p = s * step * 3;
    sample[k++] = arr[p];
    sample[k++] = arr[p + 1];
    sample[k++] = arr[p + 2];
  }
  const { centers, ratios } = _kmeans(sample, nSample, KMEANS_K);

  const palette = [];
  for (let i = 0; i < ratios.length; i++) {
    if (ratios[i] < PALETTE_MIN_RATIO) continue;
    palette.push({
      hex: _hex(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]),
      ratio: _roundTo(ratios[i], 4),
    });
  }

  // --- 区块：网格化连通域（Pillow 的 BOX 缩放已按定点实现复刻） ---
  const gh = Math.max(8, _pyRound(GRID_LONG * (h / Math.max(h, w))));
  const gw = Math.max(8, _pyRound(GRID_LONG * (w / Math.max(h, w))));
  const resized = _boxResize(mask, w, h, gw, gh);
  const grid = new Uint8Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = resized[i] >= 46 ? 1 : 0;  // (v/255) > 0.18

  let merged = _componentsToBoxes(mask, w, h, grid, gh, gw);
  merged = _mergeBoxes(merged);
  merged = _groupTextLines(merged);
  merged = _mergeBoxes(merged);
  merged = merged.filter((b) => b[2] * b[3] > 0.0006 && b[2] * b[3] < 0.97);

  // 按 (y, x) 升序（Python 的 sorted 是稳定排序）
  const ordered = merged.map((b, i) => [b, i]);
  ordered.sort((p, q) => (p[0][1] - q[0][1]) || (p[0][0] - q[0][0]) || (p[1] - q[1]));

  const regions = [];
  for (const [b] of ordered) {
    const rtype = _classify(mask, arr, w, h, b, pageAspect);
    const y0 = Math.trunc(b[1] * h);
    const y1 = Math.min(h, Math.ceil((b[1] + b[3]) * h));
    const x0 = Math.trunc(b[0] * w);
    const x1 = Math.min(w, Math.ceil((b[0] + b[2]) * w));
    let fill, density;
    let cnt = 0, sr = 0, sg = 0, sb = 0;
    if (y1 > y0 && x1 > x0) {
      for (let yy = y0; yy < y1; yy++) {
        const base = yy * w;
        for (let xx = x0; xx < x1; xx++) {
          if (mask[base + xx]) {
            const p = (base + xx) * 3;
            sr += arr[p]; sg += arr[p + 1]; sb += arr[p + 2];
            cnt++;
          }
        }
      }
    }
    if (cnt > 0) {
      fill = _hex(sr / cnt, sg / cnt, sb / cnt);
      density = cnt / ((y1 - y0) * (x1 - x0));
    } else {
      fill = _hex(bgR, bgG, bgB);
      density = 0.0;
    }
    regions.push({
      x: _roundTo(b[0], 4),
      y: _roundTo(b[1], 4),
      w: _roundTo(b[2], 4),
      h: _roundTo(b[3], 4),
      type: rtype,
      density: _roundTo(density, 3),
      fill,
      aspect: _roundTo((b[2] * pageAspect) / Math.max(1e-6, b[3]), 2),
    });
  }

  // --- 风格判断 ---
  const kk = centers.length / 3;
  let satSum = 0;
  for (let i = 0; i < kk; i++) {
    const r = centers[i * 3], g = centers[i * 3 + 1], b = centers[i * 3 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    satSum += mx <= 0 ? 0.0 : (mx - mn) / mx;
  }
  const meanSat = kk ? satSum / kk : 0.0;
  let cSum = 0;
  for (let i = 0; i < centers.length; i++) cSum += centers[i];
  const meanVal = kk ? (cSum / centers.length) / 255.0 : 0.5;

  let rMean = 0, bMean = 0;
  for (let p = 0; p < nPix * 3; p += 3) { rMean += arr[p]; bMean += arr[p + 2]; }
  rMean /= nPix;
  bMean /= nPix;

  let mood;
  if (meanSat < 0.12) mood = '素雅';
  else if (meanSat < 0.25) mood = '柔和';
  else if (meanVal > 0.7) mood = '甜系';
  else mood = '浓郁';

  let densityWord;
  if (content < 0.16) densityWord = '极简';
  else if (content < 0.34) densityWord = '透气';
  else if (content < 0.55) densityWord = '适中';
  else densityWord = '满版';

  const warmth = rMean - bMean > 6 ? '暖调' : (bMean - rMean > 6 ? '冷调' : '中性');

  const aspect = origW / Math.max(1, origH);
  let guess;
  if (Math.abs(aspect - 148 / 210) < 0.06) guess = 'A5';
  else if (Math.abs(aspect - 105 / 148) < 0.06) guess = 'A6';
  else if (Math.abs(aspect - 210 / 297) < 0.05) guess = 'A4';
  else if (Math.abs(aspect - 176 / 250) < 0.06) guess = 'B5';
  else guess = 'A5';

  return {
    ok: true,
    image: {
      w: origW,
      h: origH,
      aspect: _roundTo(aspect, 4),
      // 纯函数不碰 canvas：预览图由 analyzeImageBlob / blobToPreviewDataUri 生成
      preview: options.preview || '',
    },
    background: { hex: _hex(bgR, bgG, bgB), plain, texture },
    palette,
    whitespace: _roundTo(1.0 - content, 3),
    style: { mood, density: densityWord, warmth },
    regions: regions.slice(0, MAX_REGIONS),
    suggest: { page_size: guess, dpi: 300 },
  };
}

// numpy 随机流是内部实现细节，但 PCG64 初始常量是写死的，所以额外导出给一致性测试做回归对拍
export { _NumpyRng };

// ================================================================ 浏览器路径（解码 / 预览）

/** 取一个可用的 canvas（优先 OffscreenCanvas，退回 HTMLCanvasElement）。 */
function _makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  throw new Error('当前环境不支持 canvas，无法解码图片');
}

async function _canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  return await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas 导出失败'))), type, quality);
  });
}

function _blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 只要预览 dataURI（JPEG，最长边 maxSide，质量 quality）。
 *
 * 与 Python 的 _data_uri() 差异：Python 是 LANCZOS + Pillow JPEG 编码，
 * 这里是 canvas drawImage（imageSmoothingQuality='high'，浏览器实现的高质量重采样）
 * + canvas JPEG 编码。两者都是「缩到 900px 的 JPEG 预览」，肉眼与前端用途上等价，
 * 也完全不参与版面分析，因此不影响任何判定。
 */
export async function blobToPreviewDataUri(blob, maxSide = PREVIEW_MAX, quality = 0.8) {
  // imageOrientation: 'from-image' —— 对应 Python 的 ImageOps.exif_transpose，手机竖拍的照片才不会躺倒
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = _makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    // 透明区域铺白，与 Python 的 _load_rgb 一致
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out = await _canvasToBlob(canvas, 'image/jpeg', quality);
    return await _blobToDataUri(out);
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

/**
 * 浏览器入口：Blob/File → 解码 → 缩到最长边 1024 → analyzePixels → 补预览图。
 * 注意 image.w/h 用的是**原图**尺寸（缩略前的），坐标依旧是 0–1 归一化。
 */
export async function analyzeImageBlob(blob) {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const origW = bitmap.width;
    const origH = bitmap.height;
    if (origW < 40 || origH < 40) throw new Error('图片太小了，至少需要 40×40 像素');
    const scale = Math.min(1, ANALYSIS_MAX / Math.max(origW, origH));
    const thumbW = Math.max(1, Math.round(origW * scale));
    const thumbH = Math.max(1, Math.round(origH * scale));
    const canvas = _makeCanvas(thumbW, thumbH);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, thumbW, thumbH);
    ctx.drawImage(bitmap, 0, 0, thumbW, thumbH);
    const data = ctx.getImageData(0, 0, thumbW, thumbH).data;
    const result = analyzePixels(data, thumbW, thumbH, { origWidth: origW, origHeight: origH });
    result.image.preview = await blobToPreviewDataUri(blob);
    return result;
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}
