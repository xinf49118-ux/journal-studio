"""联网素材源适配器（SPEC 第 3 节）。

四个开放图库适配器：

* ``wikimedia`` —— Wikimedia Commons（MediaWiki API）
* ``artic``     —— Art Institute of Chicago（CC0 公有领域）
* ``met``       —— The Metropolitan Museum of Art Open Access
* ``openverse`` —— Openverse（本机实测超时，失败会优雅降级）

设计约束：

* 只用 Python 标准库（网络层 ``urllib.request``）；Pillow 仅用于下载后的可选校验。
* 所有 HTTP 请求统一走私有函数 :func:`_http_get`，测试可直接替换它；
  统一超时 20s、统一 UA ``JournalStudio/1.0 (local; +https://localhost)``。
* 任何单个素材源失败都只影响自身，``search`` / ``download`` / ``probe`` 全部
  **不抛异常**，失败时返回带 ``error`` 字段的字典。
"""

from __future__ import annotations

import gzip
import html
import io
import json
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed

try:  # Pillow 仅用于下载后校验格式，缺失也不影响搜索/下载
    from PIL import Image
except Exception:  # pragma: no cover - 环境缺少 Pillow 时降级
    Image = None


# --------------------------------------------------------------------------
# 常量（SPEC 第 3 节）
# --------------------------------------------------------------------------

SOURCES = ["wikimedia", "artic", "met", "openverse"]

USER_AGENT = "JournalStudio/1.0 (local; +https://localhost)"
TIMEOUT = 20                      # 统一超时（秒）
RETRY_BACKOFF = 0.8               # 429/5xx 短退避（秒）
MAX_LIMIT = 50                    # 单次检索条数上限
MAX_FILENAME_LEN = 80             # 文件名总长度上限（含扩展名）
DEFAULT_MAX_BYTES = 20_000_000    # 单文件体积上限
DEFAULT_LIMIT = 24
UNKNOWN_TEXT = "未标注"

WIKIMEDIA_API = "https://commons.wikimedia.org/w/api.php"
ARTIC_SEARCH_API = "https://api.artic.edu/api/v1/artworks/search"
ARTIC_IIIF = "https://www.artic.edu/iiif/2/{image_id}/full/{size}/0/default.jpg"
ARTIC_PAGE = "https://www.artic.edu/artworks/{artwork_id}"
MET_API = "https://collectionapi.metmuseum.org/public/collection/v1"
# Met 于 2026-10-01 退役了 /v1/search（现在返回 HTTP 410 Gone），官方指向 /v1.1/search。
# 这里主走 v1.1，仍保留 v1 兜底，万一对方改回去也不会失效。
MET_API_V11 = "https://collectionapi.metmuseum.org/public/collection/v1.1"
OPENVERSE_API = "https://api.openverse.org/v1/images/"

PUBLIC_DOMAIN_LICENSE = "CC0-1.0（公有领域）"

IMAGE_EXTS = {
    ".jpg", ".jpeg", ".jpe", ".png", ".gif", ".webp",
    ".bmp", ".tif", ".tiff", ".avif", ".svg",
}

EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/pjpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/x-ms-bmp": ".bmp",
    "image/tiff": ".tif",
    "image/avif": ".avif",
    "image/svg+xml": ".svg",
}

EXT_BY_FORMAT = {
    "jpeg": ".jpg",
    "png": ".png",
    "gif": ".gif",
    "webp": ".webp",
    "bmp": ".bmp",
    "tiff": ".tif",
}

_TAG_RE = re.compile(r"<[^>]*>")
_WS_RE = re.compile(r"\s+")
_CTRL_RE = re.compile(r"[\x00-\x1f\x7f]")
_ILLEGAL_RE = re.compile(r'[<>:"/\\|?*]')


class _SourceError(Exception):
    """素材源自身可预期的错误（已转成面向用户的中文描述）。"""


class _TooLarge(Exception):
    """下载体积超过上限。"""


# --------------------------------------------------------------------------
# 网络层（可被测试 mock）
# --------------------------------------------------------------------------

def _human_size(num):
    """把字节数格式化成用户可读的大小。"""
    value = float(num)
    if value >= 1_000_000:
        return "%.1f MB" % (value / 1_000_000.0)
    if value >= 1000:
        return "%.0f KB" % (value / 1000.0)
    return "%d B" % int(value)


def _read_body(response, max_bytes=None):
    """读取响应体；给定 ``max_bytes`` 时边读边计数，超限立刻中止。"""
    if max_bytes is None:
        return response.read()
    limit = int(max_bytes)
    chunks = bytearray()
    while True:
        chunk = response.read(65536)
        if not chunk:
            break
        chunks.extend(chunk)
        if len(chunks) > limit:
            raise _TooLarge("文件超过体积上限（%s）" % _human_size(limit))
    return bytes(chunks)


def _http_get(url, timeout=TIMEOUT, max_bytes=None):
    """统一的 HTTP GET。

    返回 ``(data: bytes, content_type: str)``；``url`` 必须是字符串。
    对 429 与 5xx 做一次短退避重试；gzip 响应体自动解压（解压失败也不崩）。
    ``max_bytes`` 非空时超限抛 :class:`_TooLarge`。
    """
    last_error = None
    for attempt in (0, 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/json, image/*, */*",
                    "Accept-Encoding": "gzip",
                },
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                content_type = response.headers.get("Content-Type") or ""
                encoding = (response.headers.get("Content-Encoding") or "").lower()
                raw = _read_body(response, max_bytes)
            if "gzip" in encoding and raw[:2] == b"\x1f\x8b":
                try:
                    raw = gzip.decompress(raw)
                except (OSError, EOFError, zlib.error):  # pragma: no cover
                    pass
            return raw, content_type
        except _TooLarge:
            raise
        except urllib.error.HTTPError as exc:  # noqa: PERF203
            last_error = exc
            code = int(getattr(exc, "code", 0) or 0)
            if attempt == 0 and (code == 429 or 500 <= code < 600):
                time.sleep(RETRY_BACKOFF)
                continue
            raise
    raise last_error if last_error else _SourceError("请求失败")  # pragma: no cover


def _resp_parts(response):
    """把 ``_http_get`` 的返回值规范化为 ``(bytes, content_type, url)``。

    兼容 ``(data, ct)`` 元组、``dict`` 与裸 ``bytes``，方便测试用最简 mock。
    """
    if response is None:
        return b"", "", ""
    if isinstance(response, (bytes, bytearray)):
        return bytes(response), "", ""
    if isinstance(response, tuple):
        data = response[0] if len(response) > 0 else b""
        ctype = response[1] if len(response) > 1 else ""
        url = response[2] if len(response) > 2 else ""
    elif isinstance(response, dict):
        data = response.get("data")
        if data is None:
            data = response.get("body")
        if data is None:
            data = response.get("bytes")
        ctype = response.get("content_type") or response.get("content-type") or ""
        url = response.get("url") or ""
    else:  # pragma: no cover - 兜底
        data, ctype, url = response, "", ""
    if not isinstance(data, (bytes, bytearray)):
        data = b""
    return bytes(data), str(ctype or ""), str(url or "")


def _friendly_error(exc):
    """把底层异常翻译成面向普通用户的中文提示。"""
    if isinstance(exc, (_SourceError, _TooLarge)):
        return str(exc)
    if isinstance(exc, urllib.error.HTTPError):
        code = int(getattr(exc, "code", 0) or 0)
        if code == 403:
            return "服务拒绝访问（HTTP 403），该图床可能有防盗链限制"
        if code == 404:
            return "资源不存在（HTTP 404）"
        if code == 429:
            return "请求过于频繁（HTTP 429），请稍后再试"
        if 500 <= code < 600:
            return "服务暂时不可用（HTTP %d）" % code
        return "服务返回 HTTP %d" % code
    if isinstance(exc, urllib.error.URLError):
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, (socket.timeout, TimeoutError)):
            return "请求超时（超过 %d 秒）" % TIMEOUT
        return "网络连接失败：%s" % (reason,)
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return "请求超时（超过 %d 秒）" % TIMEOUT
    if isinstance(exc, OSError):
        return "网络异常：%s" % (exc,)
    return "请求失败：%s" % (exc,)


def _get_json(url, what="接口"):
    """GET 并按 JSON 解析；失败抛 :class:`_SourceError`。"""
    try:
        raw, _ctype, _url = _resp_parts(_http_get(url, TIMEOUT))
    except _TooLarge as exc:  # pragma: no cover - JSON 接口不会触发
        raise _SourceError(str(exc))
    except Exception as exc:
        raise _SourceError(_friendly_error(exc))
    if not raw:
        raise _SourceError("%s返回了空内容" % what)
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        raise _SourceError("%s返回的不是合法 JSON" % what)


# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------

def _clean_text(value, limit=160):
    """去掉 HTML 标签、反转义实体、压缩空白。"""
    if value is None:
        return ""
    text = html.unescape(_TAG_RE.sub(" ", str(value)))
    text = _WS_RE.sub(" ", text).strip()
    if len(text) > limit:
        text = text[:limit].rstrip() + "…"
    return text


def _strip_tracking(url):
    """去掉 Wikimedia 图片地址上的 ``utm_*`` 跟踪参数，保持链接干净。"""
    text = str(url or "").strip()
    if not text or "?" not in text:
        return text
    parts = urllib.parse.urlsplit(text)
    if not parts.query:
        return text
    kept = [(key, value) for key, value in
            urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
            if not key.lower().startswith("utm_")]
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(kept)))


def _as_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _first_text(*values):
    for value in values:
        text = _clean_text(value)
        if text:
            return text
    return UNKNOWN_TEXT


def _wikimedia_page_url(title):
    return "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(str(title).replace(" ", "_"))


def safe_filename(name, ext=""):
    """文件名清洗：去掉非法字符与控制字符，限长 80 并保留扩展名。"""
    raw = os.path.basename(str(name or "").strip())
    raw = raw.replace("/", "_").replace("\\", "_")
    base, current_ext = os.path.splitext(raw)
    if current_ext and not ext:
        ext = current_ext
    base = _CTRL_RE.sub("", base)
    base = _ILLEGAL_RE.sub("_", base)
    base = _WS_RE.sub(" ", base).strip(" .")
    if not base:
        base = "image"
    ext = re.sub(r"[^A-Za-z0-9.]", "", str(ext or ""))
    if ext and not ext.startswith("."):
        ext = "." + ext
    ext = ext.lower()
    room = MAX_FILENAME_LEN - len(ext)
    if room < 8:
        room = 8
    base = base[:room].strip(" .") or "image"
    return base + ext


def _unique_path(path):
    """若目标已存在，追加 _1/_2… 避免覆盖。"""
    if not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(path)
    index = 1
    while True:
        candidate = "%s_%d%s" % (stem, index, ext)
        if not os.path.exists(candidate):
            return candidate
        index += 1


# --------------------------------------------------------------------------
# 各素材源适配器（返回 (total, results)）
# --------------------------------------------------------------------------

def _search_wikimedia(query, limit, page):
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": query,
        "gsrnamespace": "6",
        "gsrlimit": str(min(limit, MAX_LIMIT)),
        "gsroffset": str((page - 1) * limit),
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|size",
        "iiurlwidth": "800",
    }
    data = _get_json(WIKIMEDIA_API + "?" + urllib.parse.urlencode(params), "Wikimedia 接口")
    query_block = data.get("query") or {}
    pages = query_block.get("pages") or {}
    total = _as_int((query_block.get("searchinfo") or {}).get("totalhits"), 0)

    items = []
    for page_info in pages.values():
        infos = page_info.get("imageinfo") or []
        if not infos:
            continue
        info = infos[0]
        full = (info.get("url") or "").strip()
        if not full:
            continue
        title = str(page_info.get("title") or info.get("descriptionurl") or "").strip()
        display_title = re.sub(r"^File:", "", title)
        meta = info.get("extmetadata") or {}

        def meta_value(key):
            entry = meta.get(key)
            if isinstance(entry, dict):
                return entry.get("value")
            return entry

        items.append({
            "id": "wikimedia:%s" % title,
            "title": display_title or "未命名",
            "thumb": _strip_tracking(info.get("thumburl") or full),
            "full": _strip_tracking(full),
            "page_url": _strip_tracking(info.get("descriptionurl")) or _wikimedia_page_url(title),
            "author": _first_text(meta_value("Artist"), meta_value("Credit")),
            "license": _first_text(meta_value("LicenseShortName"), meta_value("License")),
            "width": _as_int(info.get("width")),
            "height": _as_int(info.get("height")),
            "source": "wikimedia",
        })
    return total or len(items), items


def _search_artic(query, limit, page):
    params = {
        "q": query,
        "page": str(page),
        "limit": str(min(limit, MAX_LIMIT)),
        # SPEC 要求的字段；额外带 thumbnail 以便拿到像素尺寸
        "fields": "id,title,image_id,artist_display,is_public_domain,thumbnail",
    }
    data = _get_json(ARTIC_SEARCH_API + "?" + urllib.parse.urlencode(params), "Art Institute 接口")
    rows = data.get("data") or []
    # 注意：ArtIC 的 pagination.total 在宽松全文检索下返回的是全库数量
    # （实测任意关键词都是 133118），对外显示会误导用户，因此这里采用实际返回条数。
    total = len(rows)

    items = []
    for row in rows:
        image_id = row.get("image_id")
        if not image_id:
            continue
        thumb_meta = row.get("thumbnail") or {}
        items.append({
            "id": "artic:%s" % row.get("id"),
            "title": _clean_text(row.get("title")) or "未命名",
            "thumb": ARTIC_IIIF.format(image_id=image_id, size="843,"),
            "full": ARTIC_IIIF.format(image_id=image_id, size="full"),
            "page_url": ARTIC_PAGE.format(artwork_id=row.get("id")),
            "author": _first_text(row.get("artist_display")),
            "license": PUBLIC_DOMAIN_LICENSE if row.get("is_public_domain") else UNKNOWN_TEXT,
            "width": _as_int(thumb_meta.get("width")),
            "height": _as_int(thumb_meta.get("height")),
            "source": "artic",
        })
    return len(items), items


def _met_object(object_id):
    """取单个 Met 藏品；失败抛异常，由上层吞掉。"""
    data = _get_json("%s/objects/%d" % (MET_API, int(object_id)), "Met 藏品接口")
    if not isinstance(data, dict):
        return None
    thumb = (data.get("primaryImageSmall") or "").strip()
    full = (data.get("primaryImage") or "").strip()
    if not thumb and not full:
        return None
    if not thumb:
        thumb = full
    if not full:
        full = thumb
    title = _clean_text(data.get("title")) or "未命名"
    return {
        "id": "met:%s" % int(object_id),
        "title": title,
        "thumb": thumb,
        "full": full,
        "page_url": (data.get("objectURL") or "").strip() or
                    "https://www.metmuseum.org/art/collection/search/%d" % int(object_id),
        "author": _first_text(data.get("artistDisplayName")),
        "license": PUBLIC_DOMAIN_LICENSE if data.get("isPublicDomain") else UNKNOWN_TEXT,
        "width": 0,
        "height": 0,
        "source": "met",
    }


def _search_met(query, limit, page):
    offset = (page - 1) * limit
    # 有些 objectID 取不到图或无图，会取回一个空壳，所以多要一些再裁到 limit
    fetch_n = max(limit, min(limit * 2, MAX_LIMIT))
    object_ids = []
    total = 0
    for base in (MET_API_V11, MET_API):
        params = {"q": query, "hasImages": "true"}
        if base == MET_API_V11:
            params["offset"] = str(max(0, offset))
            params["limit"] = str(fetch_n)
        try:
            data = _get_json("%s/search?%s" % (base, urllib.parse.urlencode(params)), "Met 检索接口")
        except Exception:
            continue  # 换下一个接口；全都不行时下面统一返回空结果
        object_ids = [int(i) for i in (data.get("objectIDs") or []) if _as_int(i, -1) >= 0]
        total = _as_int(data.get("total"), 0) or len(object_ids)
        if base == MET_API:
            # 老接口不吃 offset/limit，只能在本地切片
            object_ids = object_ids[offset:offset + fetch_n]
        break

    chunk = object_ids[:fetch_n]
    if not chunk:
        return total, []

    items = []
    workers = max(1, min(6, len(chunk)))  # 并发上限 6
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_met_object, oid): position for position, oid in enumerate(chunk)}
        for future in as_completed(futures):
            position = futures[future]
            try:
                item = future.result()
            except Exception:
                continue  # 单个 object 失败不影响整体
            if item:
                items.append((position, item))
    items.sort(key=lambda pair: pair[0])
    return total, [item for _position, item in items][:limit]


def _search_openverse(query, limit, page):
    params = {
        "q": query,
        "page": str(page),
        "page_size": str(min(limit, MAX_LIMIT)),
    }
    data = _get_json(OPENVERSE_API + "?" + urllib.parse.urlencode(params), "Openverse 接口")
    rows = data.get("results") or []
    total = _as_int(data.get("result_count"), 0)

    items = []
    for row in rows:
        full = (row.get("url") or "").strip()
        thumb = (row.get("thumbnail") or "").strip() or full
        if not full and not thumb:
            continue
        license_name = _clean_text(row.get("license"))
        license_version = _clean_text(row.get("license_version"))
        if license_name:
            license_text = "CC %s%s" % (
                license_name.upper(),
                (" " + license_version) if license_version else "",
            )
        else:
            license_text = UNKNOWN_TEXT
        items.append({
            "id": "openverse:%s" % (row.get("id") or full),
            "title": _clean_text(row.get("title")) or "未命名",
            "thumb": thumb,
            "full": full or thumb,
            "page_url": (row.get("foreign_landing_url") or "").strip() or (full or thumb),
            "author": _first_text(row.get("creator")),
            "license": license_text,
            "width": _as_int(row.get("width")),
            "height": _as_int(row.get("height")),
            "source": "openverse",
        })
    return total or len(items), items


_ADAPTERS = {
    "wikimedia": _search_wikimedia,
    "artic": _search_artic,
    "met": _search_met,
    "openverse": _search_openverse,
}


# --------------------------------------------------------------------------
# 对外接口
# --------------------------------------------------------------------------

def search(source, query, limit=DEFAULT_LIMIT, page=1):
    """检索指定素材源。

    永远返回字典；失败时 ``{"source":.., "results":[], "error":".."}``，不抛异常。
    """
    name = str(source or "").strip().lower()
    keyword = str(query or "").strip()
    result = {"source": name, "query": keyword, "total": 0, "results": []}

    if name not in SOURCES:
        result["error"] = "未知素材源：%s" % (source,)
        return result
    if not keyword:
        result["error"] = "请先输入搜索关键词"
        return result

    try:
        limit = max(1, min(int(limit), MAX_LIMIT))
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT
    try:
        page = max(1, int(page))
    except (TypeError, ValueError):
        page = 1

    try:
        total, items = _ADAPTERS[name](keyword, limit, page)
        result["total"] = _as_int(total, len(items))
        result["results"] = items
    except Exception as exc:  # 单源失败不影响其它源
        result["error"] = _friendly_error(exc)
        result["total"] = 0
        result["results"] = []
    return result


def download(url, out_dir, filename=None, max_bytes=DEFAULT_MAX_BYTES):
    """下载一张图片到 ``out_dir``。

    校验 Content-Type / URL 后缀、限制体积、清洗文件名，写入用临时文件 +
    ``os.replace`` 原子替换。失败返回 ``{"ok": false, "error": "..."}``，不抛异常。
    """
    tmp_path = None
    try:
        if not isinstance(url, str) or not url.strip():
            return {"ok": False, "error": "下载地址为空"}
        clean_url = url.strip()
        parsed = urllib.parse.urlparse(clean_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return {"ok": False, "error": "不支持的下载地址（仅支持 http/https 链接）"}

        try:
            byte_limit = int(max_bytes)
        except (TypeError, ValueError):
            byte_limit = DEFAULT_MAX_BYTES
        if byte_limit <= 0:
            byte_limit = DEFAULT_MAX_BYTES

        try:
            response = _http_get(clean_url, TIMEOUT, max_bytes=byte_limit)
        except TypeError:
            # 测试中的 mock 可能只接受 (url, timeout)
            response = _http_get(clean_url, TIMEOUT)
        data, content_type, _final_url = _resp_parts(response)

        if not data:
            return {"ok": False, "error": "下载内容为空"}
        if len(data) > byte_limit:
            return {"ok": False, "error": "文件超过体积上限（%s）" % _human_size(byte_limit)}

        mime = (content_type or "").split(";")[0].strip().lower()
        url_ext = os.path.splitext(parsed.path)[1].lower()
        if not mime.startswith("image/") and url_ext not in IMAGE_EXTS:
            return {
                "ok": False,
                "error": "该链接不是图片（Content-Type: %s）" % (content_type or "未知"),
            }

        ext = EXT_BY_MIME.get(mime) or (url_ext if url_ext in IMAGE_EXTS else "")
        if ext in (".jpeg", ".jpe"):
            ext = ".jpg"

        if Image is not None:  # 尽力用 Pillow 校正真实格式，失败也不拦截
            try:
                with Image.open(io.BytesIO(data)) as image:
                    image.verify()
                    real_ext = EXT_BY_FORMAT.get((image.format or "").lower())
                if real_ext:
                    ext = real_ext
            except Exception:
                pass

        if not ext:
            ext = ".img"

        base_name = filename or os.path.basename(urllib.parse.unquote(parsed.path)) or "image"
        final_name = safe_filename(base_name, ext)
        directory = os.path.abspath(out_dir)
        os.makedirs(directory, exist_ok=True)
        final_path = _unique_path(os.path.join(directory, final_name))

        tmp_path = os.path.join(directory, ".%s.part" % final_name)
        with open(tmp_path, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, final_path)
        tmp_path = None

        return {
            "ok": True,
            "path": os.path.abspath(final_path),
            "bytes": len(data),
            "content_type": mime or (content_type or ""),
            "ext": ext,
        }
    except _TooLarge as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        return {"ok": False, "error": _friendly_error(exc)}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:  # pragma: no cover
                pass


_PROBE_REQUESTS = (
    ("wikimedia", WIKIMEDIA_API + "?" + urllib.parse.urlencode({
        "action": "query", "format": "json", "meta": "siteinfo",
    })),
    ("artic", "https://api.artic.edu/api/v1/artworks?" + urllib.parse.urlencode({
        "limit": "1", "fields": "id",
    })),
    ("met", MET_API + "/departments"),
)


def probe():
    """对三个主源各发一次最小请求，返回连通性与耗时（毫秒）。

    结构：``{"wikimedia": {"ok": bool, "ms": int, "error": str|None}, ...}``。
    任何单源失败都不会抛异常。
    """
    report = {}
    for name, url in _PROBE_REQUESTS:
        started = time.perf_counter()
        ok = False
        error = None
        try:
            data = _get_json(url, "%s 探针" % name)
            ok = isinstance(data, dict) and len(data) > 0
            if not ok:
                error = "接口返回内容异常"
        except Exception as exc:
            error = _friendly_error(exc)
        elapsed = int(round((time.perf_counter() - started) * 1000))
        report[name] = {"ok": bool(ok), "ms": elapsed, "error": None if ok else error}
    return report


__all__ = ["SOURCES", "TIMEOUT", "USER_AGENT", "search", "download", "probe", "safe_filename"]
