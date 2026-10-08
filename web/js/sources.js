/**
 * 浏览器端联网素材源适配器（server/sources.py 的纯静态移植版）。
 *
 * 四个开放图库：
 *   wikimedia   Wikimedia Commons（MediaWiki API，必须带 origin=* 才有 CORS 头）
 *   artic       Art Institute of Chicago（API 有 CORS，但图片域名被 Cloudflare 拦）
 *   met         The Metropolitan Museum of Art Open Access（API 与图床自带 ACAO: *）
 *   openverse   Openverse（本机连不上，适配器照实现，失败优雅降级）
 *
 * 设计约束（与 Python 版同构）：
 *  - 结果字段固定为 id/title/thumb/full/page_url/author/license/width/height/source。
 *  - 单个源失败绝不能影响其它源：search / probe 永远不抛异常，失败返回带 error 的结果。
 *  - 超时统一用 AbortController（20 秒），429/5xx 做一次短退避重试。
 *  - 只用 fetch，无第三方库。
 */

/* ------------------------------------------------------------------ 常量 */

export const SOURCES = ['wikimedia', 'artic', 'met', 'openverse'];

export const TIMEOUT = 20;                // 统一超时（秒）
export const RETRY_BACKOFF = 0.8;         // 429/5xx 短退避（秒）
export const MAX_LIMIT = 50;              // 单次检索条数上限
export const DEFAULT_LIMIT = 24;
export const DEFAULT_MAX_BYTES = 20000000; // 单文件体积上限 20MB
export const UNKNOWN_TEXT = '未标注';
export const PUBLIC_DOMAIN_LICENSE = 'CC0-1.0（公有领域）';

export const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';
export const ARTIC_SEARCH_API = 'https://api.artic.edu/api/v1/artworks/search';
export const ARTIC_IIIF = 'https://www.artic.edu/iiif/2/{image_id}/full/{size}/0/default.jpg';
export const ARTIC_PAGE = 'https://www.artic.edu/artworks/{artwork_id}';
export const MET_API = 'https://collectionapi.metmuseum.org/public/collection/v1';
// Met 于 2026-10-01 退役了 v1 的 Solr 版 /search（现在返回 HTTP 410），
// 官方替代是 Elastic 版 v1.1（多了 offset/limit 分页，响应结构仍是 {total, objectIDs}）。
export const MET_SEARCH_API = 'https://collectionapi.metmuseum.org/public/collection/v1.1/search';
export const MET_SEARCH_API_LEGACY = `${MET_API}/search`;
export const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
export const MET_MAX_CONCURRENCY = 6;

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.jpe', '.png', '.gif', '.webp',
  '.bmp', '.tif', '.tiff', '.avif', '.svg',
]);

/** 测试可调的运行时配置（真实运行时用默认值）。 */
const runtime = {
  timeoutMs: TIMEOUT * 1000,
  retryBackoffMs: RETRY_BACKOFF * 1000,
};

/* ------------------------------------------------------------ 错误类型 */

class SourceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SourceError';
  }
}

class TooLargeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TooLargeError';
  }
}

class HttpError extends Error {
  constructor(status, statusText, url) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
    this.name = 'HttpError';
    this.status = Number(status) || 0;
    this.url = url;
  }
}

/* ---------------------------------------------------------- 文本小工具 */

const TAG_RE = /<[^>]*>/g;
const WS_RE = /\s+/g;

/** 去 HTML 标签、反转义实体、压缩空白、限长。 */
export function cleanText(value, limit = 160) {
  if (value === null || value === undefined) return '';
  let text = String(value).replace(TAG_RE, ' ');
  text = unescapeHtml(text);
  text = text.replace(WS_RE, ' ').trim();
  if (text.length > limit) text = `${text.slice(0, limit).replace(/\s+$/, '')}…`;
  return text;
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  '#39': "'", '#34': '"', '#38': '&',
};

function unescapeHtml(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    const key = String(body).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(ENTITIES, key)) return ENTITIES[key];
    if (key.startsWith('#x')) {
      const code = parseInt(key.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? safeFromCodePoint(code) : whole;
    }
    if (key.startsWith('#')) {
      const code = parseInt(key.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? safeFromCodePoint(code) : whole;
    }
    return whole;
  });
}

function safeFromCodePoint(code) {
  try {
    return String.fromCodePoint(code);
  } catch (exc) {
    return '';
  }
}

/** 去掉 Wikimedia 图片地址上的 utm_* 跟踪参数。 */
export function stripTracking(url) {
  const text = String(url === null || url === undefined ? '' : url).trim();
  if (!text || !text.includes('?')) return text;
  let parsed;
  try {
    parsed = new URL(text);
  } catch (exc) {
    return text;
  }
  const kept = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!key.toLowerCase().startsWith('utm_')) kept.push([key, value]);
  }
  parsed.search = '';
  const query = new URLSearchParams(kept).toString();
  if (query) parsed.search = query;
  return parsed.toString();
}

export function asInt(value, fallback = 0) {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) ? num : fallback;
}

export function humanSize(num) {
  const value = Number(num) || 0;
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)} MB`;
  if (value >= 1000) return `${Math.round(value / 1000)} KB`;
  return `${Math.trunc(value)} B`;
}

/** 取第一个非空文本，全空则回落到「未标注」。 */
export function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return UNKNOWN_TEXT;
}

function wikimediaPageUrl(title) {
  // 与 Python 的 urllib.parse.quote 对齐：':' 转义、'/' 保留
  const encoded = encodeURIComponent(String(title).replace(/ /g, '_')).replace(/%2F/g, '/');
  return `https://commons.wikimedia.org/wiki/${encoded}`;
}

function sanitizeLimit(limit) {
  let value = asInt(limit, DEFAULT_LIMIT);
  if (!Number.isFinite(value)) value = DEFAULT_LIMIT;
  return Math.max(1, Math.min(value, MAX_LIMIT));
}

function sanitizePage(page) {
  let value = asInt(page, 1);
  if (!Number.isFinite(value)) value = 1;
  return Math.max(1, value);
}

/** 简单模板替换（不做百分号编码，保持与 Python 版 `str.format` 逐字符一致）。 */
function withTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (whole, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole
  ));
}

/* ------------------------------------------------------------ 网络层 */

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function isAbortError(exc) {
  return !!exc && (exc.name === 'AbortError' || exc.code === 20);
}

/**
 * 请求看门狗：一个 AbortController + 一个「空档超时」定时器。
 *
 * 与 Python 的 socket timeout 语义对齐——**只要还有数据在流动就不算超时**
 * （收到分片就 :func:`bump`），但连接/响应头/响应体任何一段卡住 20 秒都会被中止。
 * 这样大图（实测 Met 一张 350KB 图要 40 秒）能下完，而断掉的连接不会永久挂起。
 */
function makeGuard(timeoutMs) {
  const limitMs = Math.max(1, Math.round(timeoutMs || runtime.timeoutMs));
  const controller = new AbortController();
  const guard = {
    controller,
    limitMs,
    timedOut: false,
    timer: null,
    start() {
      guard.timer = setTimeout(() => {
        guard.timedOut = true;
        try { controller.abort(); } catch (exc) { /* 忽略 */ }
      }, guard.limitMs);
    },
    /** 收到数据：把空档计时器重新拨回 0。 */
    bump() {
      if (guard.timer === null) return;
      clearTimeout(guard.timer);
      guard.start();
    },
    stop() {
      if (guard.timer !== null) {
        clearTimeout(guard.timer);
        guard.timer = null;
      }
    },
  };
  return guard;
}

function timeoutMessage(limitMs) {
  return `请求超时（超过 ${Math.round(limitMs / 1000)} 秒）`;
}

/** 一次裸 fetch：统一超时、CORS、不携带凭据。看门狗由调用方在读完响应体后 stop()。 */
async function rawFetch(url, guard) {
  if (typeof globalThis.fetch !== 'function') {
    throw new SourceError('当前环境不支持网络请求');
  }
  guard.start();
  try {
    return await globalThis.fetch(url, {
      signal: guard.controller.signal,
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json, image/*, */*' },
    });
  } catch (exc) {
    guard.stop();
    if (guard.timedOut || isAbortError(exc)) throw new SourceError(timeoutMessage(guard.limitMs));
    throw exc;
  }
}

function retryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

/** 统一 GET：429/5xx 短退避重试一次，非 2xx 抛 HttpError。返回 {response, guard}。 */
async function httpGet(url, { timeoutMs = runtime.timeoutMs } = {}) {
  let attempt = 0;
  for (;;) {
    const guard = makeGuard(timeoutMs);
    const response = await rawFetch(url, guard);
    if (response && response.ok) return { response, guard };
    guard.stop();
    const status = asInt(response && response.status, 0);
    if (attempt === 0 && retryableStatus(status)) {
      attempt += 1;
      await sleep(runtime.retryBackoffMs);
      continue;
    }
    throw new HttpError(status, (response && response.statusText) || '', url);
  }
}

/**
 * 读取响应体；给定 maxBytes 时边读边计数，超限立刻中止。
 * 给了 guard 就每收到一个分片就 bump 一次（空档超时）。
 */
async function readBytes(response, maxBytes = 0, guard = null) {
  const limit = asInt(maxBytes, 0);
  if (limit <= 0) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (guard) guard.bump();
    return buffer;
  }

  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.length > limit) throw new TooLargeError(`文件超过体积上限（${humanSize(limit)}）`);
    return buffer;
  }

  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (guard) guard.bump();
    if (done) break;
    total += value.length;
    if (total > limit) {
      try { await reader.cancel(); } catch (exc) { /* 忽略 */ }
      throw new TooLargeError(`文件超过体积上限（${humanSize(limit)}）`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** 把底层异常翻译成面向普通用户的中文提示。 */
export function friendlyError(exc) {
  if (exc instanceof SourceError || exc instanceof TooLargeError) return exc.message;
  if (exc instanceof HttpError) {
    const code = exc.status;
    if (code === 403) return '服务拒绝访问（HTTP 403），该图床可能有防盗链限制';
    if (code === 404) return '资源不存在（HTTP 404）';
    if (code === 429) return '请求过于频繁（HTTP 429），请稍后再试';
    if (code >= 500 && code < 600) return `服务暂时不可用（HTTP ${code}）`;
    return `服务返回 HTTP ${code}`;
  }
  if (isAbortError(exc)) return `请求超时（超过 ${Math.round(runtime.timeoutMs / 1000)} 秒）`;
  if (exc instanceof TypeError) return `网络连接失败：${exc.message || exc}`;
  if (exc instanceof Error) return `请求失败：${exc.message || exc}`;
  return `请求失败：${exc}`;
}

/** GET + JSON 解析；失败抛 SourceError（消息已面向用户）。 */
async function getJson(url, what = '接口') {
  let response;
  let guard;
  try {
    ({ response, guard } = await httpGet(url, { timeoutMs: runtime.timeoutMs }));
  } catch (exc) {
    throw new SourceError(friendlyError(exc));
  }
  let text;
  try {
    text = await response.text();
  } catch (exc) {
    throw new SourceError(friendlyError(exc));
  } finally {
    guard.stop();
  }
  if (!text) throw new SourceError(`${what}返回了空内容`);
  try {
    return JSON.parse(text);
  } catch (exc) {
    throw new SourceError(`${what}返回的不是合法 JSON`);
  }
}

/* ------------------------------------------------------ 各源：解析逻辑 */

/** Wikimedia：JSON → {total, items}。 */
export function parseWikimedia(data) {
  const queryBlock = (data && data.query) || {};
  const pages = queryBlock.pages || {};
  const total = asInt(queryBlock.searchinfo && queryBlock.searchinfo.totalhits, 0);

  const metaValue = (meta, key) => {
    const entry = meta ? meta[key] : null;
    if (entry && typeof entry === 'object') return entry.value;
    return entry;
  };

  const items = [];
  for (const pageInfo of Object.values(pages)) {
    if (!pageInfo || typeof pageInfo !== 'object') continue;
    const infos = pageInfo.imageinfo || [];
    if (!infos.length) continue;
    const info = infos[0] || {};
    const full = String(info.url || '').trim();
    if (!full) continue;
    const title = String(pageInfo.title || info.descriptionurl || '').trim();
    const displayTitle = title.replace(/^File:/, '');
    const meta = info.extmetadata || {};
    items.push({
      id: `wikimedia:${title}`,
      title: displayTitle || '未命名',
      thumb: stripTracking(info.thumburl || full),
      full: stripTracking(full),
      page_url: stripTracking(info.descriptionurl) || wikimediaPageUrl(title),
      author: firstText(metaValue(meta, 'Artist'), metaValue(meta, 'Credit')),
      license: firstText(metaValue(meta, 'LicenseShortName'), metaValue(meta, 'License')),
      width: asInt(info.width),
      height: asInt(info.height),
      source: 'wikimedia',
    });
  }
  return { total: total || items.length, items };
}

/** ArtIC：JSON → {total, items}。 */
export function parseArtic(data) {
  const rows = (data && data.data) || [];
  // ArtIC 的 pagination.total 在宽松全文检索下恒为全库数量（实测 133118），
  // 对外显示会误导用户，因此采用实际返回条数。
  const items = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const imageId = row.image_id;
    if (!imageId) continue;
    const thumbMeta = row.thumbnail || {};
    items.push({
      id: `artic:${row.id}`,
      title: cleanText(row.title) || '未命名',
      thumb: withTemplate(ARTIC_IIIF, { image_id: imageId, size: '843,' }),
      full: withTemplate(ARTIC_IIIF, { image_id: imageId, size: 'full' }),
      page_url: withTemplate(ARTIC_PAGE, { artwork_id: row.id }),
      author: firstText(row.artist_display),
      license: row.is_public_domain ? PUBLIC_DOMAIN_LICENSE : UNKNOWN_TEXT,
      width: asInt(thumbMeta.width),
      height: asInt(thumbMeta.height),
      source: 'artic',
    });
  }
  return { total: items.length, items };
}

/** Met：单个藏品 JSON → 统一条目（没有图返回 null）。 */
export function parseMetObject(data, objectId) {
  if (!data || typeof data !== 'object') return null;
  const oid = asInt(objectId, asInt(data.objectID, 0));
  let thumb = String(data.primaryImageSmall || '').trim();
  let full = String(data.primaryImage || '').trim();
  if (!thumb && !full) return null;
  if (!thumb) thumb = full;
  if (!full) full = thumb;
  return {
    id: `met:${oid}`,
    title: cleanText(data.title) || '未命名',
    thumb,
    full,
    page_url: String(data.objectURL || '').trim() || `https://www.metmuseum.org/art/collection/search/${oid}`,
    author: firstText(data.artistDisplayName),
    license: data.isPublicDomain ? PUBLIC_DOMAIN_LICENSE : UNKNOWN_TEXT,
    width: 0,
    height: 0,
    source: 'met',
  };
}

/** Openverse：JSON → {total, items}。 */
export function parseOpenverse(data) {
  const rows = (data && data.results) || [];
  const total = asInt(data && data.result_count, 0);
  const items = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const full = String(row.url || '').trim();
    const thumb = String(row.thumbnail || '').trim() || full;
    if (!full && !thumb) continue;
    const licenseName = cleanText(row.license);
    const licenseVersion = cleanText(row.license_version);
    const licenseText = licenseName
      ? `CC ${licenseName.toUpperCase()}${licenseVersion ? ` ${licenseVersion}` : ''}`
      : UNKNOWN_TEXT;
    items.push({
      id: `openverse:${row.id || full}`,
      title: cleanText(row.title) || '未命名',
      thumb,
      full: full || thumb,
      page_url: String(row.foreign_landing_url || '').trim() || (full || thumb),
      author: firstText(row.creator),
      license: licenseText,
      width: asInt(row.width),
      height: asInt(row.height),
      source: 'openverse',
    });
  }
  return { total: total || items.length, items };
}

/* ---------------------------------------------------------- 各源：请求 */

export function wikimediaUrl(query, limit, page) {
  const safeLimit = sanitizeLimit(limit);
  const safePage = sanitizePage(page);
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*', // 浏览器直连必须带；否则 MediaWiki 不返回 CORS 头
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: String(safeLimit),
    gsroffset: String((safePage - 1) * safeLimit),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size',
    iiurlwidth: '800',
  });
  return `${WIKIMEDIA_API}?${params.toString()}`;
}

export function articUrl(query, limit, page) {
  const params = new URLSearchParams({
    q: query,
    page: String(sanitizePage(page)),
    limit: String(sanitizeLimit(limit)),
    fields: 'id,title,image_id,artist_display,is_public_domain,thumbnail',
  });
  return `${ARTIC_SEARCH_API}?${params.toString()}`;
}

/** Met v1.1 检索（Elastic 版，支持 offset/limit）。 */
export function metSearchUrl(query, limit = DEFAULT_LIMIT, page = 1) {
  const safeLimit = sanitizeLimit(limit);
  const safePage = sanitizePage(page);
  const params = new URLSearchParams({
    q: query,
    hasImages: 'true',
    offset: String((safePage - 1) * safeLimit),
    limit: String(safeLimit),
  });
  return `${MET_SEARCH_API}?${params.toString()}`;
}

/** Met v1 检索（已退役，仅作兜底；一次性返回全部 objectIDs）。 */
export function metSearchUrlLegacy(query) {
  return `${MET_SEARCH_API_LEGACY}?${new URLSearchParams({ q: query, hasImages: 'true' }).toString()}`;
}

export function openverseUrl(query, limit, page) {
  const params = new URLSearchParams({
    q: query,
    page: String(sanitizePage(page)),
    page_size: String(sanitizeLimit(limit)),
  });
  return `${OPENVERSE_API}?${params.toString()}`;
}

async function searchWikimedia(query, limit, page) {
  const data = await getJson(wikimediaUrl(query, limit, page), 'Wikimedia 接口');
  return parseWikimedia(data);
}

async function searchArtic(query, limit, page) {
  const data = await getJson(articUrl(query, limit, page), 'Art Institute 接口');
  return parseArtic(data);
}

async function searchMet(query, limit, page) {
  // 主接口 v1.1（2026-10 起生效）；万一它不可用再退回旧的 v1（已在服务端退役）
  let data;
  let legacy = false;
  try {
    data = await getJson(metSearchUrl(query, limit, page), 'Met 检索接口');
  } catch (primaryError) {
    try {
      data = await getJson(metSearchUrlLegacy(query), 'Met 检索接口');
      legacy = true;
    } catch (exc) {
      throw primaryError; // 报主接口的错误（v1 已退役时 410 的说明更准确）
    }
  }

  const objectIds = (Array.isArray(data && data.objectIDs) ? data.objectIDs : [])
    .map((value) => asInt(value, -1))
    .filter((value) => value >= 0);
  const total = asInt(data && data.total, 0) || objectIds.length;

  // v1.1 已按 offset/limit 分页；v1 一次返回全部，需要本地切片
  const start = (sanitizePage(page) - 1) * sanitizeLimit(limit);
  const chunk = legacy
    ? objectIds.slice(start, start + sanitizeLimit(limit))
    : objectIds.slice(0, sanitizeLimit(limit));
  if (!chunk.length) return { total, items: [] };

  // 并发上限 6，保持 objectIDs 的顺序；单个 object 失败只跳过它自己
  const slots = new Array(chunk.length).fill(null);
  let cursor = 0;
  const workers = Math.max(1, Math.min(MET_MAX_CONCURRENCY, chunk.length));
  await Promise.all(Array.from({ length: workers }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= chunk.length) return;
      const oid = chunk[index];
      try {
        const payload = await getJson(`${MET_API}/objects/${oid}`, 'Met 藏品接口');
        slots[index] = parseMetObject(payload, oid);
      } catch (exc) {
        slots[index] = null;
      }
    }
  }));
  return { total, items: slots.filter(Boolean) };
}

async function searchOpenverse(query, limit, page) {
  const data = await getJson(openverseUrl(query, limit, page), 'Openverse 接口');
  return parseOpenverse(data);
}

const ADAPTERS = {
  wikimedia: searchWikimedia,
  artic: searchArtic,
  met: searchMet,
  openverse: searchOpenverse,
};

/* ------------------------------------------------------------ 对外接口 */

/**
 * 检索指定素材源。永远返回对象；失败时带 error 字段、results 为空，不抛异常。
 * @returns {Promise<{source: string, query: string, total: number, results: Array, error?: string}>}
 */
export async function search(source, query, limit = DEFAULT_LIMIT, page = 1) {
  const name = String(source === null || source === undefined ? '' : source).trim().toLowerCase();
  const keyword = String(query === null || query === undefined ? '' : query).trim();
  const result = { source: name, query: keyword, total: 0, results: [] };

  if (!SOURCES.includes(name)) {
    result.error = `未知素材源：${source}`;
    return result;
  }
  if (!keyword) {
    result.error = '请先输入搜索关键词';
    return result;
  }

  let safeLimit = asInt(limit, DEFAULT_LIMIT);
  if (!Number.isFinite(safeLimit)) safeLimit = DEFAULT_LIMIT;
  safeLimit = Math.max(1, Math.min(safeLimit, MAX_LIMIT));
  let safePage = asInt(page, 1);
  if (!Number.isFinite(safePage)) safePage = 1;
  safePage = Math.max(1, safePage);

  try {
    const { total, items } = await ADAPTERS[name](keyword, safeLimit, safePage);
    result.total = asInt(total, items.length);
    result.results = items;
  } catch (exc) {
    result.error = friendlyError(exc);
    result.total = 0;
    result.results = [];
  }
  return result;
}

const PROBE_REQUESTS = [
  ['wikimedia', `${WIKIMEDIA_API}?${new URLSearchParams({ action: 'query', format: 'json', origin: '*', meta: 'siteinfo' })}`],
  ['artic', `https://api.artic.edu/api/v1/artworks?${new URLSearchParams({ limit: '1', fields: 'id' })}`],
  ['met', `${MET_API}/departments`],
];

function nowMs() {
  if (globalThis.performance && typeof globalThis.performance.now === 'function') {
    return globalThis.performance.now();
  }
  return Date.now();
}

/** 对三个主源各发一次最小请求，返回连通性与耗时（毫秒）。任何单源失败都不抛异常。 */
export async function probe() {
  const report = {};
  await Promise.all(PROBE_REQUESTS.map(async ([name, url]) => {
    const started = nowMs();
    let ok = false;
    let error = null;
    try {
      const data = await getJson(url, `${name} 探针`);
      ok = !!data && typeof data === 'object' && Object.keys(data).length > 0;
      if (!ok) error = '接口返回内容异常';
    } catch (exc) {
      error = friendlyError(exc);
    }
    const ms = Math.round(nowMs() - started);
    report[name] = { ok: !!ok, ms, error: ok ? null : error };
  }));
  // 固定键顺序，便于调用方展示
  return {
    wikimedia: report.wikimedia,
    artic: report.artic,
    met: report.met,
  };
}

/**
 * 下载一张图片为 Blob（浏览器里用 URL.createObjectURL 显示/保存）。
 * 失败抛 Error，消息面向普通用户。
 */
export async function fetchAsBlob(url, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof url !== 'string' || !url.trim()) throw new Error('下载地址为空');
  const cleanUrl = url.trim();
  let parsed;
  try {
    parsed = new URL(cleanUrl);
  } catch (exc) {
    throw new Error('不支持的下载地址（仅支持 http/https 链接）');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('不支持的下载地址（仅支持 http/https 链接）');
  }

  let limit = asInt(maxBytes, DEFAULT_MAX_BYTES);
  if (limit <= 0) limit = DEFAULT_MAX_BYTES;

  let response;
  let guard;
  let bytes;
  try {
    ({ response, guard } = await httpGet(cleanUrl, { timeoutMs: runtime.timeoutMs }));
    bytes = await readBytes(response, limit, guard);
  } catch (exc) {
    if (guard) guard.stop();
    throw new Error(friendlyError(exc));
  }
  guard.stop();

  if (!bytes.length) throw new Error('下载内容为空');
  if (bytes.length > limit) throw new Error(`文件超过体积上限（${humanSize(limit)}）`);

  const contentType = String((response.headers && response.headers.get && response.headers.get('Content-Type')) || '');
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const urlExt = (parsed.pathname.match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase();
  if (!mime.startsWith('image/') && !IMAGE_EXTS.has(urlExt)) {
    throw new Error(`该链接不是图片（Content-Type: ${contentType || '未知'}）`);
  }

  if (typeof Blob === 'undefined') throw new Error('当前环境不支持 Blob');
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

/* ------------------------------------------------------------------ 测试 */

/** 测试专用出口：纯函数与可调配置（业务代码不要依赖）。 */
export const __test__ = {
  runtime,
  SourceError,
  TooLargeError,
  HttpError,
  cleanText,
  stripTracking,
  asInt,
  humanSize,
  firstText,
  friendlyError,
  parseWikimedia,
  parseArtic,
  parseMetObject,
  parseOpenverse,
  wikimediaUrl,
  articUrl,
  metSearchUrl,
  metSearchUrlLegacy,
  openverseUrl,
  sanitizeLimit,
  sanitizePage,
  readBytes,
  searchMet,
  getJson,
  setTimeoutMs(ms) { runtime.timeoutMs = Math.max(1, Math.round(Number(ms) || 1)); },
  resetTimeout() { runtime.timeoutMs = TIMEOUT * 1000; },
  setRetryBackoffMs(ms) { runtime.retryBackoffMs = Math.max(0, Math.round(Number(ms) || 0)); },
  resetRetryBackoff() { runtime.retryBackoffMs = RETRY_BACKOFF * 1000; },
};

export default { SOURCES, search, probe, fetchAsBlob };
