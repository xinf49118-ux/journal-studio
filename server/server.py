"""手账工坊 本地服务端。

职责：
- 托管前端静态文件与内置素材（/web、/assets）
- 用户素材库的增删查（/api/library*、/media/*）
- 联网素材检索代理（/api/search、/api/sources）
- 页面结构分析（/api/analyze）
- 300dpi 页面合成渲染与 PNG / PDF 导出（/api/render、/api/export/*）

只依赖 Python 标准库 + Pillow + numpy，不联网也能跑（联网只是素材检索用）。
"""
from __future__ import annotations

import argparse
import io
import json
import mimetypes
import os
import socket
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import analysis, store  # noqa: E402

try:  # 素材源与 PDF 写出器由独立模块提供，缺失时优雅降级
    from server import sources as sources_mod  # noqa: E402
except Exception:  # pragma: no cover
    sources_mod = None
try:
    from server import pdfwrite  # noqa: E402
except Exception:  # pragma: no cover
    pdfwrite = None

VERSION = 1
WEB_DIR = ROOT / "web"
ASSETS_DIR = ROOT / "assets"
MATERIALS_DIR = ASSETS_DIR / "materials"
DATA_DIR = ROOT / "data"

MM_PER_INCH = 25.4
PAGE_SIZES: dict[str, tuple[float, float]] = {
    "A5": (148.0, 210.0),
    "A6": (105.0, 148.0),
    "A4": (210.0, 297.0),
    "B5": (176.0, 250.0),
}

LIBRARY = store.Library(DATA_DIR)
PROJECT_PATH = DATA_DIR / "project.json"

_material_lock = threading.Lock()
_materials_cache: dict[str, Any] | None = None
_materials_mtime: float = -1.0
_project_lock = threading.Lock()
_image_cache: dict[str, Image.Image] = {}
_image_cache_lock = threading.Lock()

# 各类素材换算成毫米时的参考 dpi，必须与前端 core.js 的 CAT_REF_DPI 保持一致
CAT_REF_DPI = {"paper": 150}
DEFAULT_REF_DPI = 300


def _f(value: Any, default: float = 0.0, lo: float | None = None, hi: float | None = None) -> float:
    """把任意输入安全地变成有限浮点数，脏数据一律回落默认值（绝不抛异常）。"""
    try:
        x = float(value)
    except (TypeError, ValueError):
        x = default
    if x != x or x in (float("inf"), float("-inf")):
        x = default
    if lo is not None:
        x = max(lo, x)
    if hi is not None:
        x = min(hi, x)
    return x


def material_natural_mm(item: dict[str, Any]) -> tuple[float, float]:
    """素材的自然毫米尺寸。与前端 naturalMm() 同一口径，保证预览与导出花纹密度一致。"""
    dpi = float(item.get("dpi") or CAT_REF_DPI.get(item.get("cat"), DEFAULT_REF_DPI))
    return (float(item.get("w") or 0) / dpi * MM_PER_INCH, float(item.get("h") or 0) / dpi * MM_PER_INCH)


# ------------------------------------------------------------------ 素材索引

def load_manifest() -> dict[str, Any]:
    path = MATERIALS_DIR / "manifest.json"
    if not path.exists():
        return {"version": 1, "categories": [], "items": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"version": 1, "categories": [], "items": []}


def material_index() -> dict[str, dict[str, Any]]:
    """素材索引。manifest 文件变动（例如刚跑完生成器）会自动重载，无需重启服务。"""
    global _materials_cache, _materials_mtime
    path = MATERIALS_DIR / "manifest.json"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = -1.0
    with _material_lock:
        if _materials_cache is None or mtime != _materials_mtime:
            data = load_manifest()
            _materials_cache = {it["id"]: it for it in data.get("items", []) if it.get("id")}
            _materials_mtime = mtime
        return _materials_cache


def invalidate_materials() -> None:
    global _materials_cache, _materials_mtime
    with _material_lock:
        _materials_cache = None
        _materials_mtime = -1.0


def _cached_image(path: Path) -> Image.Image:
    key = str(path)
    with _image_cache_lock:
        img = _image_cache.get(key)
        if img is None:
            img = Image.open(path)
            img.load()
            img = img.convert("RGBA")
            _image_cache[key] = img
        return img


# ------------------------------------------------------------------ 字体

_FONT_CACHE: dict[tuple[str, int], Any] = {}
_FONT_FILES = {
    "sans": ["msyh.ttc", "msyhl.ttc", "simhei.ttf", "Deng.ttf", "arial.ttf", "segoeui.ttf"],
    "serif": ["simsun.ttc", "STSONG.TTF", "times.ttf", "georgia.ttf", "msyh.ttc"],
    "mono": ["consola.ttf", "cour.ttf", "simsun.ttc"],
}


def _font(family: str, size_px: int) -> Any:
    size_px = max(6, int(size_px))
    key = (family, size_px)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    font = None
    fonts_dir = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    for name in _FONT_FILES.get(family, _FONT_FILES["sans"]):
        candidate = fonts_dir / name
        if candidate.exists():
            try:
                font = ImageFont.truetype(str(candidate), size_px)
                break
            except Exception:
                continue
    if font is None:
        try:
            font = ImageFont.load_default(size=size_px)
        except Exception:
            font = ImageFont.load_default()
    _FONT_CACHE[key] = font
    return font


# ------------------------------------------------------------------ 渲染引擎

def _resolve_layer_image(layer: dict[str, Any]) -> Image.Image | None:
    kind = layer.get("kind")
    ref = str(layer.get("ref") or "")
    if kind == "material":
        item = material_index().get(ref)
        if not item:
            return None
        path = MATERIALS_DIR / item["file"]
    elif kind == "image":
        p = LIBRARY.path(ref)
        if not p:
            return None
        path = Path(p)
    else:
        return None
    if not path.exists():
        return None
    try:
        return _cached_image(path)
    except Exception:
        return None


def _tile_into(
    canvas: Image.Image,
    src: Image.Image,
    box: tuple[int, int, int, int],
    opacity: float,
    tile_px: tuple[int, int] | None = None,
) -> None:
    """把 src 平铺进 box。tile_px 给定时按该尺寸缩放后再平铺（保证与前端预览同一花纹密度）。"""
    x0, y0, x1, y1 = box
    if tile_px:
        tw, th = max(1, int(round(tile_px[0]))), max(1, int(round(tile_px[1])))
        if (tw, th) != src.size:
            src = src.resize((tw, th), Image.LANCZOS)
    sw, sh = src.size
    if sw < 2 or sh < 2:
        return
    tile = Image.new("RGBA", (max(1, x1 - x0), max(1, y1 - y0)), (0, 0, 0, 0))
    for ty in range(0, tile.height, sh):
        for tx in range(0, tile.width, sw):
            tile.alpha_composite(src, (tx, ty))
    if opacity < 1.0:
        tile.putalpha(tile.getchannel("A").point(lambda v: int(v * opacity)))
    canvas.alpha_composite(tile, (x0, y0))


def _paste_centered(canvas: Image.Image, layer_img: Image.Image, cx: float, cy: float, opacity: float, blend: str) -> None:
    if opacity < 1.0:
        layer_img = layer_img.copy()
        layer_img.putalpha(layer_img.getchannel("A").point(lambda v: int(v * opacity)))
    if blend == "multiply":
        px, py = int(round(cx - layer_img.width / 2)), int(round(cy - layer_img.height / 2))
        region = canvas.crop((px, py, px + layer_img.width, py + layer_img.height))
        rgb_src = layer_img.convert("RGB")
        rgb_dst = region.convert("RGB")
        mult = ImageChops.multiply(rgb_dst, rgb_src).convert("RGBA")
        mult.putalpha(ImageChops.multiply(region.getchannel("A"), layer_img.getchannel("A")))
        canvas.paste(mult, (px, py), mult)
    else:
        canvas.alpha_composite(layer_img, (int(round(cx - layer_img.width / 2)), int(round(cy - layer_img.height / 2))))


def _draw_text_layer(canvas: Image.Image, layer: dict[str, Any], ppm: float, bleed_px: int, bleed_py: int | None = None) -> None:
    bleed_py = bleed_px if bleed_py is None else bleed_py
    text = str(layer.get("text") or "")
    if not text:
        return
    size_px = max(4, int(round(_f(layer.get("size_mm"), 6, 0.5, 400) * ppm)))
    font = _font(str(layer.get("font") or "sans"), size_px)
    color = str(layer.get("color") or "#3b3b3b")
    lines = text.split("\n")[:200]
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    metrics = getattr(font, "getmetrics", None)
    if callable(metrics):
        ascent, descent = metrics()
    else:  # 回退字体没有 getmetrics 时按经验值估
        ascent, descent = int(size_px * 1.0), int(size_px * 0.35)
    # 与浏览器端 .text-el 的 line-height:1.35 完全同构：
    # 行盒高 pitch，半行距 = (pitch - (ascent+descent)) / 2，基线 = 半行距 + ascent
    pitch = size_px * 1.35
    half_leading = (pitch - (ascent + descent)) / 2.0
    boxes = [probe.textbbox((0, 0), line or " ", font=font) for line in lines]
    tw = max(1, max((b[2] - b[0]) for b in boxes))
    th = max(1, int(round(pitch * len(lines))))
    tmp = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tmp)
    align = str(layer.get("align") or "left")
    for i, (line, bbox) in enumerate(zip(lines, boxes)):
        w_line = bbox[2] - bbox[0]
        if align == "center":
            pen_x = (tw - w_line) / 2 - bbox[0]
        elif align == "right":
            pen_x = tw - w_line - bbox[0]
        else:
            pen_x = 0
        # PIL 默认锚点 "la"：y 为 ascender 顶，基线在 y + ascent
        draw.text((pen_x, i * pitch + half_leading), line, font=font, fill=color)
    if bool(layer.get("flip_x")):
        tmp = ImageOps.mirror(tmp)
    if bool(layer.get("flip_y")):
        tmp = ImageOps.flip(tmp)
    rotate = _f(layer.get("rotate"), 0.0, -360.0, 360.0)
    if rotate:
        tmp = tmp.rotate(rotate, expand=True, resample=Image.BICUBIC)
    cx = bleed_px + _f(layer.get("x_mm")) * ppm + (tw / 2)
    cy = bleed_py + _f(layer.get("y_mm")) * ppm + (th / 2)
    _paste_centered(canvas, tmp, cx, cy, _f(layer.get("opacity"), 1.0, 0.0, 1.0), str(layer.get("blend") or "normal"))


def _draw_shape_layer(canvas: Image.Image, layer: dict[str, Any], ppm: float, bleed_px: int, bleed_py: int | None = None) -> None:
    bleed_py = bleed_px if bleed_py is None else bleed_py
    shape = str(layer.get("shape") or "rect")
    x = bleed_px + _f(layer.get("x_mm")) * ppm
    y = bleed_py + _f(layer.get("y_mm")) * ppm
    w = _f(layer.get("w_mm"), 10.0, -5000.0, 5000.0) * ppm
    h = _f(layer.get("h_mm"), 10.0, -5000.0, 5000.0) * ppm
    fill = str(layer.get("fill") or "#f3c7d4")
    stroke = layer.get("stroke")
    width = max(1, int(round(_f(layer.get("stroke_mm"), 0.4, 0.0, 50.0) * ppm)))
    tmp = Image.new("RGBA", (max(1, int(abs(w)) + width * 2 + 2), max(1, int(abs(h)) + width * 2 + 2)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tmp)
    box = (width + 1, width + 1, width + 1 + int(abs(w)), width + 1 + int(abs(h)))
    if shape == "ellipse":
        draw.ellipse(box, fill=fill, outline=stroke, width=width if stroke else 0)
    elif shape == "line":
        # 与前端一致：线画在 h_mm 盒子的垂直中线上
        draw.line([box[0], (box[1] + box[3]) // 2, box[2], (box[1] + box[3]) // 2], fill=fill, width=max(1, width))
    else:
        draw.rectangle(box, fill=fill, outline=stroke, width=width if stroke else 0)
    if bool(layer.get("flip_x")):
        tmp = ImageOps.mirror(tmp)
    if bool(layer.get("flip_y")):
        tmp = ImageOps.flip(tmp)
    rotate = _f(layer.get("rotate"), 0.0, -360.0, 360.0)
    if rotate:
        tmp = tmp.rotate(rotate, expand=True, resample=Image.BICUBIC)
    _paste_centered(canvas, tmp, x + w / 2, y + h / 2, _f(layer.get("opacity"), 1.0, 0.0, 1.0), str(layer.get("blend") or "normal"))


def _draw_crop_marks(canvas: Image.Image, ox: int, oy: int, cw: int, ch: int, bleed_px: int, color: str = "#2b2b2b") -> None:
    if bleed_px < 6:
        return
    draw = ImageDraw.Draw(canvas)
    arm = max(6, int(bleed_px * 0.75))
    t = max(1, bleed_px // 14)
    left, top, right, bottom = ox, oy, ox + cw, oy + ch
    for (cx, cy, dx, dy) in (
        (left, top, -1, -1),
        (right, top, 1, -1),
        (left, bottom, -1, 1),
        (right, bottom, 1, 1),
    ):
        if dx < 0:
            draw.line([(cx - arm, cy), (cx - t, cy)], fill=color, width=t)
        else:
            draw.line([(cx + t, cy), (cx + arm, cy)], fill=color, width=t)
        if dy < 0:
            draw.line([(cx, cy - arm), (cx, cy - t)], fill=color, width=t)
        else:
            draw.line([(cx, cy + t), (cx, cy + arm)], fill=color, width=t)


def _page_geometry(page: dict[str, Any]) -> tuple[float, float, float, float]:
    """把 page 字典解析成 (宽mm, 高mm, dpi, 出血mm)，脏数据一律安全回落。"""
    if not isinstance(page, dict):
        page = {}
    size = str(page.get("size") or "A5")
    if size in PAGE_SIZES:
        w_mm, h_mm = PAGE_SIZES[size]
    else:
        w_mm = _f(page.get("w_mm"), 148.0, 10.0, 2000.0)
        h_mm = _f(page.get("h_mm"), 210.0, 10.0, 2000.0)
    if str(page.get("orientation") or "portrait") == "landscape":
        w_mm, h_mm = max(w_mm, h_mm), min(w_mm, h_mm)
    return w_mm, h_mm, _f(page.get("dpi"), 300.0, 72.0, 600.0), _f(page.get("bleed_mm"), 0.0, 0.0, 30.0)


def render_page(req: dict[str, Any]) -> Image.Image:
    """按渲染请求合成一张 300dpi（或指定 dpi）的页面图。"""
    if not isinstance(req, dict):
        req = {}
    page = req.get("page") or {}
    if not isinstance(page, dict):
        page = {}
    w_mm, h_mm, dpi, bleed_mm = _page_geometry(page)
    ppm = dpi / MM_PER_INCH
    bleed_px = int(round(bleed_mm * ppm))

    # 总尺寸按 (成品 + 2×出血) 取整；成品区居中放置，保证裁切后尺寸误差 ≤1px
    content_w = max(1, int(round(w_mm * ppm)))
    content_h = max(1, int(round(h_mm * ppm)))
    W = max(content_w, int(round((w_mm + bleed_mm * 2) * ppm)))
    H = max(content_h, int(round((h_mm + bleed_mm * 2) * ppm)))
    ox = (W - content_w) // 2
    oy = (H - content_h) // 2

    canvas = Image.new("RGBA", (W, H), (255, 255, 255, 255))

    # --- 背景 ---
    bg = req.get("background") or {}
    bg_type = str(bg.get("type") or "white")
    bg_value = str(bg.get("value") or "#ffffff")
    if bg_type == "material" and bg_value:
        item = material_index().get(bg_value)
        src = _cached_image(MATERIALS_DIR / item["file"]) if item else None
        if src is not None:
            if bool(bg.get("tile")) or item.get("tile"):
                nw, nh = material_natural_mm(item)
                _tile_into(canvas, src, (0, 0, W, H), 1.0, tile_px=(nw * ppm, nh * ppm))
            else:
                canvas.alpha_composite(ImageOps.fit(src.convert("RGBA"), (W, H), Image.LANCZOS))
    elif bg_type == "color":
        try:
            canvas = Image.new("RGBA", (W, H), ImageColorHelper(bg_value))
        except Exception:
            pass

    # --- 图层（数组顺序 = 从下到上）---
    for layer in req.get("layers") or []:
        if not isinstance(layer, dict):
            continue
        kind = str(layer.get("kind") or "material")
        opacity = _f(layer.get("opacity"), 1.0, 0.0, 1.0)
        if opacity <= 0.001:
            continue
        if kind in ("material", "image"):
            src = _resolve_layer_image(layer)
            if src is None:
                continue
            if bool(layer.get("flip_x")):
                src = ImageOps.mirror(src)
            if bool(layer.get("flip_y")):
                src = ImageOps.flip(src)
            x = ox + _f(layer.get("x_mm")) * ppm
            y = oy + _f(layer.get("y_mm")) * ppm
            w_px = _f(layer.get("w_mm"), 0.0, -5000.0, 5000.0) * ppm
            h_px = _f(layer.get("h_mm"), 0.0, -5000.0, 5000.0) * ppm
            if w_px <= 0 and h_px <= 0:
                w_px, h_px = src.width, src.height
            elif w_px <= 0:
                w_px = abs(h_px) * src.width / src.height
            elif h_px <= 0:
                h_px = abs(w_px) * src.height / src.width
            w_px, h_px = max(1, int(round(abs(w_px)))), max(1, int(round(abs(h_px))))
            if bool(layer.get("tile")):
                tile_px = None
                if kind == "material":
                    item = material_index().get(str(layer.get("ref") or ""))
                    if item:
                        nw, nh = material_natural_mm(item)
                        tile_px = (nw * ppm, nh * ppm)
                _tile_into(canvas, src, (int(round(x)), int(round(y)), int(round(x + w_px)), int(round(y + h_px))), opacity, tile_px)
                continue
            scaled = src.resize((w_px, h_px), Image.LANCZOS)
            rotate = _f(layer.get("rotate"), 0.0, -360.0, 360.0)
            if rotate:
                scaled = scaled.rotate(rotate, expand=True, resample=Image.BICUBIC)
            _paste_centered(canvas, scaled, x + w_px / 2, y + h_px / 2, opacity, str(layer.get("blend") or "normal"))
        elif kind == "text":
            _draw_text_layer(canvas, layer, ppm, ox, oy)
        elif kind == "shape":
            _draw_shape_layer(canvas, layer, ppm, ox, oy)

    # --- 裁切标记 ---
    if bool(page.get("crop_marks")) and bleed_px > 0:
        _draw_crop_marks(canvas, ox, oy, content_w, content_h, bleed_px)

    return canvas.convert("RGB")


def ImageColorHelper(value: str) -> tuple[int, int, int, int]:
    value = (value or "#ffffff").strip()
    if value.startswith("#"):
        h = value[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) >= 6:
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
    if value.startswith("rgb"):
        nums = [int(float(n)) for n in value[value.find("(") + 1 : value.find(")")].split(",")[:3]]
        while len(nums) < 3:
            nums.append(255)
        return (nums[0], nums[1], nums[2], 255)
    return (255, 255, 255, 255)


def render_png_bytes(req: dict[str, Any]) -> bytes:
    img = render_page(req)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def render_pdf_bytes(req: dict[str, Any]) -> bytes:
    if pdfwrite is None:
        raise RuntimeError("PDF 模块不可用")
    if not isinstance(req, dict):
        req = {}
    img = render_page(req)
    w_mm, h_mm, dpi, bleed_mm = _page_geometry(req.get("page") or {})
    size = str((req.get("page") or {}).get("size") or "A5")

    with tempfile_dir() as tmpdir:
        img_path = Path(tmpdir) / "page.png"
        img.save(img_path, format="PNG")
        out_path = Path(tmpdir) / "out.pdf"
        title = f"手账工坊 手账页面 {size} {time.strftime('%Y-%m-%d')}"
        res = pdfwrite.images_to_pdf(
            [str(img_path)], str(out_path), w_mm + bleed_mm * 2, h_mm + bleed_mm * 2, dpi=dpi, title=title
        )
        if not res.get("ok"):
            raise RuntimeError(res.get("error") or "PDF 生成失败")
        return out_path.read_bytes()


class tempfile_dir:
    """轻量临时目录上下文（避免 tempfile 在不同盘符下的清理噪音）。"""

    def __enter__(self) -> str:
        import tempfile

        self._tmp = tempfile.TemporaryDirectory(prefix="journalstudio_")
        return self._tmp.name

    def __exit__(self, *exc: Any) -> None:
        self._tmp.cleanup()


# ------------------------------------------------------------------ HTTP

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".pdf": "application/pdf",
}


def _safe_join(base: Path, rel: str) -> Path | None:
    rel = unquote(rel).replace("\\", "/").lstrip("/")
    if not rel:
        return None
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    # 任何一段是 .. 都直接拒绝，避免 /assets/../server/server.py 读到源码
    if any(p == ".." for p in parts):
        return None
    if not parts:
        return None
    target = (base / Path(*parts)).resolve()
    try:
        target.relative_to(base.resolve())
    except ValueError:
        return None
    return target


class Handler(BaseHTTPRequestHandler):
    server_version = "JournalStudio/1.0"
    protocol_version = "HTTP/1.1"

    # ---------- 输出小工具 ----------

    def _send(self, status: int, body: bytes, ctype: str, extra: dict[str, str] | None = None) -> None:
        try:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            # 浏览器提前断开（换页、取消下载）属正常，不要刷 traceback
            pass

    def _json(self, obj: Any, status: int = 200) -> None:
        self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"), MIME[".json"])

    def _fail(self, message: str, status: int = 400) -> None:
        self._json({"ok": False, "error": message}, status)

    def _body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return b""
        if length > 60 * 1024 * 1024:
            raise ValueError("上传内容过大（上限 60MB）")
        return self.rfile.read(length)

    def _json_body(self) -> dict[str, Any]:
        raw = self._body()
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise ValueError("请求内容不是合法 JSON") from exc
        if not isinstance(data, dict):
            raise ValueError("请求内容必须是 JSON 对象")
        return data

    def log_message(self, fmt: str, *args: Any) -> None:  # 控制台输出更干净
        if os.environ.get("JOURNAL_STUDIO_VERBOSE"):
            sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    # ---------- 路由 ----------

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        try:
            self._route_get()
        except Exception:
            traceback.print_exc()
            self._fail("服务器内部错误，请看控制台日志", 500)

    def do_DELETE(self) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/library/item":
                item_id = (parse_qs(parsed.query).get("id") or [""])[0]
                if not item_id:
                    return self._fail("缺少 id 参数")
                ok = LIBRARY.delete(item_id)
                return self._json({"ok": ok})
            self._fail("未知接口", 404)
        except Exception:
            traceback.print_exc()
            self._fail("服务器内部错误", 500)

    def do_POST(self) -> None:
        try:
            self._route_post()
        except ValueError as exc:
            self._fail(str(exc))
        except Exception:
            traceback.print_exc()
            self._fail("服务器内部错误，请看控制台日志", 500)

    def _route_get(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)

        if path == "/api/health":
            return self._json(
                {
                    "ok": True,
                    "version": VERSION,
                    "materials": len(material_index()),
                    "library": LIBRARY.stats()["count"],
                    "sources": list(getattr(sources_mod, "SOURCES", [])) if sources_mod else [],
                    "pdf": pdfwrite is not None,
                }
            )
        if path == "/api/materials":
            return self._json(load_manifest())
        if path == "/api/library":
            return self._json({"ok": True, "items": LIBRARY.list()})
        if path == "/api/sources":
            if sources_mod is None:
                return self._json({"ok": False, "error": "素材源模块不可用", "sources": {}})
            return self._json({"ok": True, "sources": sources_mod.probe()})
        if path == "/api/search":
            if sources_mod is None:
                return self._json({"ok": False, "error": "素材源模块不可用", "results": []})
            source = (query.get("source") or ["wikimedia"])[0]
            q = (query.get("q") or [""])[0].strip()
            limit = int(_f((query.get("limit") or ["24"])[0], 24.0, 1.0, 60.0))
            page = int(_f((query.get("page") or ["1"])[0], 1.0, 1.0, 500.0))
            if not q:
                return self._json({"ok": True, "results": [], "source": source, "total": 0})
            res = sources_mod.search(source, q, limit=limit, page=page)
            res.setdefault("ok", "error" not in res)
            return self._json(res)
        if path == "/api/project":
            if PROJECT_PATH.exists():
                return self._json({"ok": True, "project": json.loads(PROJECT_PATH.read_text(encoding="utf-8"))})
            return self._json({"ok": True, "project": None})
        if path.startswith("/media/"):
            item_id = path[len("/media/") :]
            fp = LIBRARY.path(item_id)
            if not fp:
                return self._send(404, b"not found", "text/plain; charset=utf-8")
            return self._serve_file(Path(fp), cache=True)
        if path.startswith("/assets/"):
            target = _safe_join(ROOT, path)
            if target and target.is_file():
                return self._serve_file(target, cache=True)
            return self._send(404, b"not found", "text/plain; charset=utf-8")
        if path.startswith("/web/"):
            target = _safe_join(ROOT, path)
            if target and target.is_file():
                return self._serve_file(target, cache=False)
            return self._send(404, b"not found", "text/plain; charset=utf-8")
        if path in ("/", "/index.html"):
            # 入口在仓库根目录：本地服务与 GitHub Pages 共用同一份 index.html
            index = ROOT / "index.html"
            if index.exists():
                return self._serve_file(index, cache=False)
            fallback = WEB_DIR / "index.html"
            if fallback.exists():
                return self._serve_file(fallback, cache=False)
            return self._send(500, "前端文件缺失：index.html".encode("utf-8"), MIME[".html"])
        if path == "/favicon.ico":
            return self._send(204, b"", "image/x-icon")
        return self._send(404, b"not found", "text/plain; charset=utf-8")

    def _route_post(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)

        if path == "/api/library/import":
            data = self._body()
            if not data:
                return self._fail("没有收到图片内容")
            name = (query.get("name") or [""])[0]
            cat = (query.get("cat") or ["imported"])[0]
            tags = [t for t in ((query.get("tags") or [""])[0]).split(",") if t.strip()]
            ext = Path(name).suffix or ".png"
            item = LIBRARY.add_bytes(data, ext, name=Path(name).stem, tags=tags, cat=cat)
            return self._json({"ok": True, "item": item})

        if path == "/api/library/import-url":
            if sources_mod is None:
                return self._fail("素材源模块不可用", 503)
            body = self._json_body()
            url = str(body.get("url") or "").strip()
            if not url:
                return self._fail("缺少 url")
            with tempfile_dir() as tmpdir:
                res = sources_mod.download(url, tmpdir)
                if not res.get("ok"):
                    return self._fail(res.get("error") or "下载失败", 502)
                raw = Path(res["path"]).read_bytes()
            meta = body.get("meta") or {}
            origin = {
                "type": "url",
                "url": url,
                "author": meta.get("author") or "",
                "license": meta.get("license") or "",
                "page_url": meta.get("page_url") or "",
                "source": meta.get("source") or "",
            }
            item = LIBRARY.add_bytes(
                raw,
                res.get("ext") or ".jpg",
                name=body.get("name") or meta.get("title") or "联网素材",
                tags=body.get("tags") or ["联网"],
                cat=body.get("cat") or "imported",
                origin=origin,
            )
            return self._json({"ok": True, "item": item})

        if path == "/api/project":
            body = self._json_body()
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            # 加锁 + 唯一临时名：并发保存不会互相踩，也不会残留半截文件
            with _project_lock:
                tmp = PROJECT_PATH.with_name(f"project.{os.getpid()}.{threading.get_ident()}.tmp")
                tmp.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
                os.replace(tmp, PROJECT_PATH)
            return self._json({"ok": True})

        if path == "/api/analyze":
            data = self._body()
            if not data:
                return self._fail("没有收到图片内容")
            try:
                return self._json(analysis.analyze_image(data))
            except ValueError as exc:
                return self._fail(str(exc), 422)

        if path in ("/api/render", "/api/export/png"):
            body = self._json_body()
            png = render_png_bytes(body)
            extra = {}
            if path == "/api/export/png":
                extra["Content-Disposition"] = 'attachment; filename="journal-page.png"'
            return self._send(200, png, "image/png", extra)

        if path == "/api/export/pdf":
            body = self._json_body()
            try:
                pdf = render_pdf_bytes(body)
            except RuntimeError as exc:
                return self._fail(str(exc), 503)
            return self._send(
                200,
                pdf,
                "application/pdf",
                {"Content-Disposition": 'attachment; filename="journal-page.pdf"'},
            )

        return self._fail("未知接口", 404)

    def _serve_file(self, path: Path, cache: bool) -> None:
        try:
            data = path.read_bytes()
        except Exception:
            return self._send(404, b"not found", "text/plain; charset=utf-8")
        ctype = MIME.get(path.suffix.lower()) or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        self._send(200, data, ctype, {"Cache-Control": "public, max-age=86400" if cache else "no-store"})


# ------------------------------------------------------------------ 启动

def _free_port(preferred: int) -> int:
    for port in range(preferred, preferred + 25):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit("8765–8789 端口都被占用了，请先关掉其它程序或用 --port 指定端口")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="手账工坊本地服务")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="启动后不自动打开浏览器")
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args(argv)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    port = _free_port(args.port)
    httpd = ThreadingHTTPServer((args.host, port), Handler)
    httpd.daemon_threads = True
    url = f"http://{args.host}:{port}/"

    n_materials = len(material_index())
    print("=" * 56)
    print("  手账工坊 Journal Studio 已启动")
    print(f"  地址：{url}")
    print(f"  内置素材：{n_materials} 件   用户素材：{LIBRARY.stats()['count']} 件")
    if n_materials == 0:
        print("  ⚠ 还没生成内置素材，请先运行：python tools/make_materials.py")
    print("  按 Ctrl+C 停止服务")
    print("=" * 56)

    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
