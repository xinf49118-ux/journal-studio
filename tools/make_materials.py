# -*- coding: utf-8 -*-
"""Journal Studio 内置素材包生成器。

用法：
    python tools/make_materials.py                 # 生成全部 8 类素材 + manifest.json
    python tools/make_materials.py --only tape     # 只生成某一类（可重复）
    python tools/make_materials.py --out <dir>     # 指定输出目录（默认 assets/materials）
    python tools/make_materials.py --check         # 只校验不生成
    python tools/make_materials.py --clean         # 先清空输出目录再全量生成

约束（见 SPEC.md 第 2 节）：
    * 只使用 Python 标准库 + Pillow + numpy；
    * 固定随机种子 20260930，重复运行产出字节一致（generated_at 除外）；
    * manifest.json 用 ensure_ascii=False, indent=2 写出，UTF-8；
    * id 全局唯一、[a-z0-9_]+ 且以 <cat>_ 开头。
"""

import argparse
import colorsys
import datetime
import glob
import json
import math
import os
import random
import shutil
import sys
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# --------------------------------------------------------------------------- #
# 常量
# --------------------------------------------------------------------------- #

SEED = 20260930
PYTHON_RNG = random.Random(SEED)          # 全局随机源（顺序固定 ⇒ 结果固定）
NP_RNG = np.random.default_rng(SEED)      # numpy 随机源，仅用于不可平的肌理

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "assets", "materials")

CATEGORY_META = [
    ("paper", "底纹纸"),
    ("tape", "和纸胶带"),
    ("sticker", "贴纸"),
    ("frame", "边框花边"),
    ("divider", "分割线"),
    ("stamp", "印章邮戳"),
    ("title", "标题日期条"),
    ("icon", "小图标"),
]

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
    r"C:\Windows\Fonts\Deng.ttf",
    r"C:\Windows\Fonts\arial.ttf",
]

LICENSE = "CC0-1.0"
AUTHOR = "Journal Studio 程序生成"

PAPER_W, PAPER_H = 1240, 1748           # A5 @150dpi

# --------------------------------------------------------------------------- #
# 基础工具
# --------------------------------------------------------------------------- #


def item_seed(item_id):
    """由 id 派生稳定的随机种子（不用 hash()，避免 PYTHONHASHSEED 影响）。"""
    return (SEED * 31 + zlib.crc32(item_id.encode("utf-8"))) & 0x7FFFFFFF


def rgba(hexstr, alpha=255):
    """'#rrggbb' -> (r, g, b, alpha)。"""
    h = hexstr.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(alpha))


def shade(hexstr, k):
    """颜色明暗调整：k<1 变暗，k>1 变亮（夹在 0..255）。"""
    h = hexstr.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return "#%02x%02x%02x" % tuple(min(255, max(0, int(v * k))) for v in (r, g, b))


def mix(a, b, t):
    """两个 #rrggbb 之间线性插值。"""
    ha, hb = a.lstrip("#"), b.lstrip("#")
    out = []
    for i in (0, 2, 4):
        va, vb = int(ha[i:i + 2], 16), int(hb[i:i + 2], 16)
        out.append(int(round(va + (vb - va) * t)))
    return "#%02x%02x%02x" % tuple(out)


def hsv_shift(hexstr, dh=0.0, ds=0.0, dv=0.0):
    """在 HSV 空间微调颜色，用于生成同色系变体。"""
    h = hexstr.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    hh, ss, vv = colorsys.rgb_to_hsv(r, g, b)
    hh = (hh + dh) % 1.0
    ss = min(1.0, max(0.0, ss * (1.0 + ds)))
    vv = min(1.0, max(0.0, vv * (1.0 + dv)))
    return "#%02x%02x%02x" % tuple(int(round(c * 255)) for c in colorsys.hsv_to_rgb(hh, ss, vv))


def clampf(a, lo=0.0, hi=1.0):
    return np.float32(lo) + (np.float32(hi) - np.float32(lo)) * a


def smoothstep(t):
    t = clampf(t)
    return t * t * (np.float32(3.0) - np.float32(2.0) * t)


def colorize(mask, hexstr, alpha_scale=1.0):
    """把 uint8 掩膜转成 RGBA 图（颜色取自 hexstr，alpha = mask * alpha_scale）。"""
    h = hexstr.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    arr = np.zeros(mask.shape + (4,), dtype=np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = r, g, b
    arr[..., 3] = np.clip(mask.astype(np.float32) * alpha_scale, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def alpha_mask(img):
    """取图像的 alpha 通道为 numpy 数组。

    注意：灰度图（"L"）没有 alpha 通道，转成 RGBA 后 alpha 会**全变成 255**。
    投影函数正是拿灰度掩膜调进来的，所以这里必须对 "L" 直接返回像素值本身，
    否则每一张带投影的贴纸都会糊上一整块方形灰底。
    """
    if img.mode == "L":
        return np.array(img)
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    return np.array(img.getchannel("A"))


def dilate_np(mask, radius):
    """二值/灰度掩膜的方形膨胀（移位取最大值，避免 ImageFilter.MaxFilter 的尺寸限制）。"""
    out = mask
    for _ in range(max(1, int(radius))):
        up = np.pad(out, ((1, 0), (0, 0)), mode="edge")[:-1, :]
        dn = np.pad(out, ((0, 1), (0, 0)), mode="edge")[1:, :]
        lf = np.pad(out, ((0, 0), (1, 0)), mode="edge")[:, :-1]
        rt = np.pad(out, ((0, 0), (0, 1)), mode="edge")[:, 1:]
        out = np.maximum.reduce([out, up, dn, lf, rt])
    return out


def blur_mask(mask, radius):
    """灰度掩膜高斯模糊，返回 float32。"""
    pad = max(1, int(radius) * 2)
    im = Image.fromarray(mask, "L")
    im = im.filter(ImageFilter.GaussianBlur(max(0.5, float(radius))))
    return np.asarray(im, dtype=np.float32)


def noise_array(w, h, rng, granularity=2):
    """柔和噪声场，返回 0..1 的 float32 数组；granularity 越大越粗。"""
    s = max(2, int(granularity))
    small = np.array(
        [[rng.randrange(256) for _ in range(max(2, w // s + 2))]
         for _ in range(max(2, h // s + 2))], dtype=np.uint8)
    im = Image.fromarray(small, "L")
    im = im.resize((w, h), Image.BILINEAR)
    arr = np.asarray(im, dtype=np.float32) / np.float32(255.0)
    if float(arr.max() - arr.min()) > 1e-6:
        arr = (arr - arr.min()) / (arr.max() - arr.min())
    return arr


# --------------------------------------------------------------------------- #
# 配色体系（莫兰迪 / 马卡龙 / 复古牛皮 / 清新蓝绿）
# --------------------------------------------------------------------------- #

PALETTES = {
    "macaron": {
        "zh": "马卡龙", "bg": "#fffdf8", "ink": "#6b5b52",
        "c1": "#f7b7c4", "c2": "#f9dfa0", "c3": "#a8dcc8", "c4": "#a9c7ea", "c5": "#d3bde6",
        "accent": "#f2a2b8",
    },
    "morandi": {
        "zh": "莫兰迪", "bg": "#f6f4ef", "ink": "#5f5f5a",
        "c1": "#c9a68f", "c2": "#9aab97", "c3": "#8f9db1", "c4": "#ceb8ac", "c5": "#b3a394",
        "accent": "#b08968",
    },
    "kraft": {
        "zh": "复古牛皮", "bg": "#f6ecd9", "ink": "#5b4636",
        "c1": "#c8a274", "c2": "#bba06f", "c3": "#a8814f", "c4": "#d7bd93", "c5": "#8d6b4a",
        "accent": "#b5763c",
    },
    "fresh": {
        "zh": "清新蓝绿", "bg": "#f7fbfa", "ink": "#3f5c63",
        "c1": "#7fc8c1", "c2": "#a9d9ea", "c3": "#8fb3d9", "c4": "#5fa8a0", "c5": "#cfdfe8",
        "accent": "#3f8f8a",
    },
}

PALETTE_ORDER = ["macaron", "morandi", "kraft", "fresh"]


def palette_color(pal, idx):
    """取调色板中的第 idx 个主色（循环使用）。"""
    keys = ["c1", "c2", "c3", "c4", "c5"]
    return PALETTES[pal][keys[idx % len(keys)]]


def variant_colors(pal, seed_rng, n=1, hue_span=0.04, val_span=0.10, key=None):
    """生成 n 个同色系颜色。

    第 1 个是主色：key 给定时用调色板对应色（保证名称与实际颜色一致），
    否则随机挑一个；其余颜色取同调色板相邻色做轻微变体，保证整体和谐。
    """
    keys = ["c1", "c2", "c3", "c4", "c5"]
    if key in keys:
        base_idx = keys.index(key)
    else:
        base_idx = seed_rng.randrange(len(keys))
    base = PALETTES[pal][keys[base_idx]]
    out = [base]
    for i in range(1, max(1, n)):
        c = PALETTES[pal][keys[(base_idx + i) % len(keys)]]
        out.append(hsv_shift(c,
                             dh=seed_rng.uniform(-hue_span, hue_span),
                             ds=seed_rng.uniform(-0.05, 0.05),
                             dv=seed_rng.uniform(-val_span, val_span)))
    return out


# --------------------------------------------------------------------------- #
# 字体
# --------------------------------------------------------------------------- #

_FONT_CACHE = {}


def get_font(size, bold=False):
    """取系统中文字体，找不到时回退 Pillow 默认字体（绝不抛异常）。"""
    size = max(8, int(size))
    key = (size, bold)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    cands = []
    if bold:
        cands.append(r"C:\Windows\Fonts\msyhbd.ttc")
    cands.extend(FONT_CANDIDATES)
    for path in cands:
        if path and os.path.exists(path):
            try:
                font = ImageFont.truetype(path, size)
                _FONT_CACHE[key] = font
                return font
            except Exception:
                continue
    try:
        font = ImageFont.load_default(size=size)
    except Exception:
        font = ImageFont.load_default()
    _FONT_CACHE[key] = font
    return font


def text_size(draw, text, font):
    try:
        box = draw.textbbox((0, 0), text, font=font)
    except Exception:
        return font.getsize(text)  # type: ignore[attr-defined]
    return box[2] - box[0], box[3] - box[1]


def draw_text_center(draw, cx, cy, text, font, fill):
    """以 (cx, cy) 为中心绘制文本，返回实际包围盒。"""
    try:
        box = draw.textbbox((0, 0), text, font=font)
    except Exception:
        w, h = font.getsize(text)  # type: ignore[attr-defined]
        box = (0, 0, w, h)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text((cx - w / 2.0 - box[0], cy - h / 2.0 - box[1]), text, font=font, fill=fill)
    return w, h


def fit_font(draw, text, max_w, max_h, start=120, min_size=12):
    """自动缩字号使文本放进给定框内。"""
    size = start
    while size > min_size:
        font = get_font(size)
        w, h = text_size(draw, text, font)
        if w <= max_w and h <= max_h:
            return font
        size -= 2
    return get_font(min_size)


# --------------------------------------------------------------------------- #
# 撕裂边（胶带两端）
# --------------------------------------------------------------------------- #


def tear_coverage(w, h, rng, end_depth=(0.05, 0.20), edge_depth=(0.0, 0.03),
                  periodic=0.0, period=(70.0, 160.0), amp=(3.0, 9.0),
                  max_frac=0.26, band=6.0):
    """生成撕裂边覆盖率图（1=完整，0=完全缺失）。

    端头（左右）被撕出形状不规则的缺口，缺口只在靠近端头的窄带里，
    胶带主体保持完整；长边（上下）做轻微起毛；periodic 时叠加锯齿状纤维。
    """
    x = np.arange(w, dtype=np.float32)[None, :]
    y = np.arange(h, dtype=np.float32)[:, None]
    depth_cap = max(6.0, float(h) * float(max_frac))
    cov = np.ones((h, w), dtype=np.float32)

    def _side():
        """返回一列方向上的覆盖率（1 - 撕裂缺口）。"""
        depth = min(depth_cap, max(4.0, float(h) * float(rng.uniform(end_depth[0], end_depth[1]))))
        prof = (np.asarray(_random_profile(rng, h, 8), dtype=np.float32) ** 0.75)[:, None]
        dd = depth * (0.30 + 1.35 * prof)
        prof2 = (np.asarray(_random_profile(rng, h, 22), dtype=np.float32) ** 1.4)[:, None]
        dd = dd * (0.72 + 0.55 * prof2)          # 高锯齿锯齿
        c = np.clip((x - dd) / float(band), 0.0, 1.0)
        return smoothstep(c)

    cov *= _side()                # 左
    cov *= _side()[:, ::-1]       # 右
    # 上下边：轻微起毛（只影响靠边几行）
    edge = float(rng.uniform(edge_depth[0], edge_depth[1]))
    if edge > 0:
        prof_tb = np.asarray(_random_profile(rng, w, 24), dtype=np.float32)[None, :]
        dd = max(1.0, float(h) * edge) * (0.4 + 1.2 * prof_tb)
        top = np.clip((y - dd) / 2.5, 0.0, 1.0)
        yy = (h - 1) - y
        dd2 = max(1.0, float(h) * edge) * (0.4 + 1.2 * prof_tb[:, ::-1])
        bot = np.clip((yy - dd2) / 2.5, 0.0, 1.0)
        cov *= smoothstep(top) * smoothstep(bot)

    if periodic > 0.0 and rng.random() < periodic:
        p = float(rng.uniform(period[0], period[1]))
        a = float(rng.uniform(amp[0], amp[1]))
        phase = rng.uniform(0, 6.28)
        wave = np.maximum(0.0, -np.sin((y / p) * 2.0 * math.pi + phase)) * a * 3.2
        wave2 = np.maximum(0.0, -np.sin((y / p) * 2.0 * math.pi + phase + 1.9)) * a * 3.2
        cov = np.minimum(cov, np.clip((x - wave) / max(1.0, a * 0.55), 0.0, 1.0))
        cov = np.minimum(cov, np.clip(((w - 1 - x) - wave2) / max(1.0, a * 0.55), 0.0, 1.0))

    cov = np.clip(cov, 0.0, 1.0)
    if float(cov.min()) > 0.20:      # 保证真的撕开：至少缺掉一小块
        cov[: max(1, int(h * 0.12)), 0] = 0.0
    return cov


def _random_profile(rng, n, step):
    """随机一维轮廓（分段线性插值），用于不规则边缘。"""
    pts = [rng.random() for _ in range(max(3, n // step))]
    out = []
    seg = max(1, (n - 1) / (len(pts) - 1.0))
    for i in range(n):
        t = i / seg
        i0 = min(len(pts) - 1, int(t))
        i1 = min(len(pts) - 1, i0 + 1)
        f = t - i0
        out.append(pts[i0] * (1.0 - f) + pts[i1] * f)
    return out


# --------------------------------------------------------------------------- #
# 素材记录
# --------------------------------------------------------------------------- #


class Builder(object):
    """收集素材条目，负责保存图片与缩略图。"""

    def __init__(self, out_dir):
        self.out_dir = out_dir
        self.items = []
        self.seen = set()

    def add(self, item_id, name, cat, tags, img, dominant, desc,
            alpha=True, tile=False, ext=None):
        if item_id in self.seen:
            raise ValueError("重复 id: %s" % item_id)
        if not item_id.startswith(cat + "_"):
            raise ValueError("id 必须以 %s_ 开头: %s" % (cat, item_id))
        self.seen.add(item_id)
        if ext is None:
            ext = ".png" if alpha else ".jpg"
        rel = "%s/%s%s" % (cat, item_id, ext)
        path = os.path.join(self.out_dir, cat, item_id + ext)
        _ensure_dir(os.path.dirname(path))
        save_image(img, path, alpha)
        thumb_rel = "thumbs/%s/%s.png" % (cat, item_id)
        thumb_path = os.path.join(self.out_dir, "thumbs", cat, item_id + ".png")
        _ensure_dir(os.path.dirname(thumb_path))
        save_thumb(img, thumb_path)
        w, h = img.size
        self.items.append({
            "id": item_id,
            "name": name,
            "cat": cat,
            "tags": list(tags),
            "file": rel,
            "thumb": thumb_rel,
            "w": int(w),
            "h": int(h),
            "alpha": bool(alpha),
            "tile": bool(tile),
            "dominant": dominant.lower(),
            "license": LICENSE,
            "author": AUTHOR,
            "desc": desc,
        })
        return self.items[-1]


def _ensure_dir(path):
    if path and not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)


def _quantize_rgba(img, colors=255):
    """把 RGBA 图压成调色板 PNG。

    手账素材都是大片平涂色，但细颗粒噪点会让真彩 PNG 几乎压不动
    （实测单张胶带 480KB）。量化到 255 色后体积只剩 7%~25%，
    而实测 RGB 平均偏差只有 0.04~5.85/255，肉眼看不出来。
    量化是确定性的，重复生成仍然字节一致。
    """
    try:
        return img.convert("RGBA").quantize(colors=colors, method=Image.FASTOCTREE)
    except Exception:
        return img.convert("RGBA")


def save_image(img, path, alpha):
    """按 alpha 决定存 PNG 还是 JPEG（JPEG 走 quality=90 且不开 optimize，保证字节稳定）。"""
    if alpha:
        _quantize_rgba(img).save(path, "PNG", optimize=True, compress_level=9)
    else:
        img.convert("RGB").save(path, "JPEG", quality=90, optimize=False,
                                progressive=False, subsampling=2)


def save_thumb(img, path):
    """缩略图：最长边 240px，保留 alpha，存量化 PNG。"""
    src = img.convert("RGBA")
    w, h = src.size
    scale = 240.0 / float(max(w, h))
    if scale < 1.0:
        nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
        src = src.resize((nw, nh), Image.LANCZOS)
    _quantize_rgba(src).save(path, "PNG", optimize=True, compress_level=9)


# --------------------------------------------------------------------------- #
# 通用绘制小工具
# --------------------------------------------------------------------------- #


def h_gradient(size, c1, c2, alpha=255):
    """水平渐变 RGBA 图。"""
    w, h = size
    t = (np.arange(w, dtype=np.float32) / max(1.0, w - 1.0))[None, :, None]
    a1 = np.array(rgba(c1)[:3], np.float32)[None, None, :]
    a2 = np.array(rgba(c2)[:3], np.float32)[None, None, :]
    rgb = a1 * (1.0 - t) + a2 * t
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    arr[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    arr[..., 3] = alpha
    return Image.fromarray(arr, "RGBA")


def v_gradient(size, c1, c2, alpha=255):
    """垂直渐变 RGBA 图。"""
    w, h = size
    t = (np.arange(h, dtype=np.float32) / max(1.0, h - 1.0))[:, None, None]
    a1 = np.array(rgba(c1)[:3], np.float32)[None, None, :]
    a2 = np.array(rgba(c2)[:3], np.float32)[None, None, :]
    rgb = a1 * (1.0 - t) + a2 * t
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    arr[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    arr[..., 3] = alpha
    return Image.fromarray(arr, "RGBA")


def grain_alpha(img, rng, amount=0.05, granularity=2, alpha_center=255):
    """给图像的 alpha 加细小纤维噪点（保留一定透明度，模拟和纸）。返回新图。"""
    w, h = img.size
    n = noise_array(w, h, rng, granularity)
    base = alpha_center * (1.0 + 1.3 * amount * (n - 0.5))
    base = np.clip(base, 0, 255)
    a = np.array(img.getchannel("A"), dtype=np.float32)
    out = img.copy()
    out.putalpha(Image.fromarray(np.clip(a * (base / 255.0), 0, 255).astype(np.uint8), "L"))
    return out


def drop_shadow(shape_alpha, offset=(3, 5), blur=7, opacity=0.30):
    """由形状 alpha 生成柔和投影的 RGBA 图（真实模糊，不是硬边黑框）。"""
    w, h = shape_alpha.size
    m = blur_mask(alpha_mask(shape_alpha), blur)
    m = np.clip(m * (255.0 / 190.0), 0, 255) * float(opacity)
    canvas = np.zeros((h, w), dtype=np.float32)
    dx, dy = int(offset[0]), int(offset[1])
    src = m
    x0s, x1s = max(0, -dx), min(w, w - dx)
    y0s, y1s = max(0, -dy), min(h, h - dy)
    canvas[y0s + dy:y1s + dy, x0s + dx:x1s + dx] = src[y0s:y1s, x0s:x1s]
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = 90, 72, 62
    arr[..., 3] = np.clip(canvas, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


# --------------------------------------------------------------------------- #
# 1) paper —— 底纹纸
# --------------------------------------------------------------------------- #

PAPER_SPECS = [
    ("dotgrid", "细点阵纸", "macaron", ["点阵", "网格", "手账", "米白"], False),
    ("grid", "方格纸", "fresh", ["方格", "网格", "清爽", "笔记"], False),
    ("cross", "十字格纸", "morandi", ["十字", "方格", "莫兰迪", "笔记"], False),
    ("line", "横线纸", "fresh", ["横线", "笔记", "留白", "蓝绿"], False),
    ("kraft", "牛皮纸", "kraft", ["牛皮", "复古", "纤维", "肌理"], False),
    ("kraft_light", "浅牛皮纸", "kraft", ["牛皮", "浅色", "复古", "底纹"], False),
    ("cotton", "米白棉纹", "macaron", ["米白", "棉纹", "温柔", "底纹"], False),
    ("pastel_pink", "粉色彩纸", "macaron", ["粉彩", "纯色", "少女", "底纹"], False),
    ("pastel_blue", "蓝色彩纸", "fresh", ["蓝彩", "纯色", "清新", "底纹"], False),
    ("pastel_mint", "薄荷彩纸", "fresh", ["薄荷", "纯色", "清新", "底纹"], False),
    ("pastel_lilac", "藕紫彩纸", "macaron", ["藕紫", "纯色", "梦幻", "底纹"], False),
    ("pastel_cream", "奶油彩纸", "morandi", ["奶油", "纯色", "温暖", "底纹"], False),
    ("pastel_green", "豆绿彩纸", "morandi", ["豆绿", "纯色", "自然", "底纹"], False),
    ("watercolor_blue", "水彩晕染蓝", "fresh", ["水彩", "晕染", "蓝", "艺术"], False),
    ("watercolor_pink", "水彩晕染粉", "macaron", ["水彩", "晕染", "粉", "艺术"], False),
    ("marble", "大理石纹", "morandi", ["大理石", "纹理", "高级", "灰"], False),
    ("marble_gold", "金色大理石纹", "kraft", ["大理石", "金纹", "复古", "纹理"], False),
    ("gingham", "维希格纹", "macaron", ["格纹", "维希", "粉", "田园"], False),
    ("plaid", "大格纹", "morandi", ["格纹", "大格", "复古", "经典"], False),
    ("tartan_kraft", "牛皮格纹", "kraft", ["格纹", "牛皮", "复古", "苏格兰"], False),
    ("cornell", "康奈尔笔记纸", "fresh", ["康奈尔", "笔记", "分区", "学习"], False),
    ("daily", "手账日程格", "macaron", ["日程", "打卡", "计划", "格"], True),
    ("week", "周计划纸", "morandi", ["周计划", "日程", "表格", "规划"], False),
    ("letter", "信纸", "kraft", ["信纸", "横线", "牛皮", "复古"], False),
    ("beige_note", "米黄便签纸", "morandi", ["便签", "米黄", "简约", "底纹"], False),
]


def gen_paper(builder):
    for code, name, pal, tags, tile in PAPER_SPECS:
        iid = "paper_%s_%s_01" % (code, pal)
        rng = random.Random(item_seed(iid))
        img = _paper_render(code, pal, rng)
        dominant = palette_color(pal, 0)
        desc = "%s：A5@150dpi 不透明底纹，可平铺" % name if tile else "%s：A5@150dpi 不透明底纹" % name
        builder.add(iid, name, "paper", tags + [PALETTES[pal]["zh"]], img, dominant, desc,
                    alpha=False, tile=tile, ext=".jpg")


def _paper_render(code, pal, rng):
    p = PALETTES[pal]
    bg = p["bg"]
    ink = p["ink"]
    img = Image.new("RGB", (PAPER_W, PAPER_H), bg)
    d = ImageDraw.Draw(img)
    if code == "dotgrid":
        _p_dotgrid(d, bg, mix(ink, bg, 0.24), step=80, off=40)
    elif code == "grid":
        _p_grid(d, bg, mix(p["c1"], bg, 0.28), step=48)
    elif code == "cross":
        _p_cross(d, bg, mix(ink, bg, 0.45), mix(p["c3"], bg, 0.22), 40, 160)
    elif code == "line":
        _p_line(d, bg, mix(p["c3"], bg, 0.30), step=88, margin=mix(p["c1"], bg, 0.35))
    elif code in ("kraft", "kraft_light"):
        base = "#c8a274" if code == "kraft" else "#e0c9a4"
        _p_kraft(img, d, base, rng, strong=(code == "kraft"))
    elif code == "cotton":
        _p_cotton(img, bg, rng, mix(p["c4"], "#ffffff", 0.55))
    elif code.startswith("pastel_"):
        base = {"pastel_pink": "#fbe3e8", "pastel_blue": "#dfeaf8", "pastel_mint": "#dff1ea",
                "pastel_lilac": "#ece3f4", "pastel_cream": "#f7f0e2", "pastel_green": "#e6eede"}[code]
        _p_solid(img, base, rng)
    elif code.startswith("watercolor"):
        base = {"watercolor_blue": ("#eaf4fa", ["#a9d9ea", "#8fb3d9", "#cfe6f2"]),
                "watercolor_pink": ("#fdf1f4", ["#f7b7c4", "#d3bde6", "#f9dfa0"])}[code]
        _p_watercolor(img, base[0], base[1], rng)
    elif code.startswith("marble"):
        if code == "marble":
            _p_marble(img, "#f2f2f0", ["#c9c9c4", "#a9abab", "#8f9db1"], rng)
        else:
            _p_marble(img, "#f6efe2", ["#d9c49a", "#b5763c", "#c8a274"], rng)
    elif code == "gingham":
        _p_gingham(img, bg, mix(p["c1"], bg, 0.55), step=62)
    elif code == "plaid":
        _p_plaid(img, bg, [mix(p["c1"], bg, 0.55), mix(p["c3"], bg, 0.5), mix(ink, bg, 0.75)], rng)
    elif code == "tartan_kraft":
        _p_plaid(img, "#eddcc0", [mix("#a8814f", "#eddcc0", 0.45), mix("#8d6b4a", "#eddcc0", 0.6),
                                  mix("#b5763c", "#eddcc0", 0.5)], rng)
    elif code == "cornell":
        _p_cornell(d, bg, p, rng)
    elif code == "daily":
        _p_daily(d, bg, p)
    elif code == "week":
        _p_week(d, bg, p)
    elif code == "letter":
        _p_letter(d, bg, p, rng)
    elif code == "beige_note":
        _p_solid(img, "#f4ecdd", rng, warm=True)
    _paper_grain(img, rng, 4.0 if code in ("cotton", "beige_note", "pastel_cream") else 2.2)
    return img


def _p_dotgrid(d, bg, dot, step=80, off=40):
    r = 2.4
    y = off
    while y < PAPER_H:
        x = off
        while x < PAPER_W:
            d.ellipse([x - r, y - r, x + r, y + r], fill=dot)
            x += step
        y += step


def _p_grid(d, bg, line, step=48):
    y = 0
    while y <= PAPER_H:
        d.line([(0, y), (PAPER_W, y)], fill=line, width=1)
        y += step
    x = 0
    while x <= PAPER_W:
        d.line([(x, 0), (x, PAPER_H)], fill=line, width=1)
        x += step


def _p_cross(d, bg, minor, major, minor_step=40, major_step=160):
    x = 0
    while x <= PAPER_W:
        w = 2 if x % major_step == 0 else 1
        d.line([(x, 0), (x, PAPER_H)], fill=(major if w == 2 else minor), width=w)
        x += minor_step
    y = 0
    while y <= PAPER_H:
        w = 2 if y % major_step == 0 else 1
        d.line([(0, y), (PAPER_W, y)], fill=(major if w == 2 else minor), width=w)
        y += minor_step


def _p_line(d, bg, line, step=88, margin=None):
    y = step
    while y < PAPER_H:
        d.line([(0, y), (PAPER_W, y)], fill=line, width=2)
        y += step
    y = 0
    while y < PAPER_H:
        d.line([(0, y), (PAPER_W, y)], fill=shade(line, 0.9), width=1)
        y += step // 2
    if margin:
        d.line([(140, 0), (140, PAPER_H)], fill=margin, width=2)
        d.line([(148, 0), (148, PAPER_H)], fill=margin, width=2)


def _p_kraft(img, d, base, rng, strong=True):
    w, h = img.size
    t = (np.arange(h, dtype=np.float32) / h)[:, None, None]
    a1 = np.array(rgba(shade(base, 1.05))[:3], np.float32)[None, None, :]
    a2 = np.array(rgba(shade(base, 0.90))[:3], np.float32)[None, None, :]
    rgb = np.broadcast_to(a1 * (1 - t) + a2 * t, (h, w, 3))
    img.paste(Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB"), (0, 0))
    # 细纤维：高频噪声沿横向拉长
    fiber = noise_array(w, h, rng, 1)
    fib2 = np.asarray(Image.fromarray((fiber * 255).astype(np.uint8), "L")
                      .filter(ImageFilter.GaussianBlur(0.6)), dtype=np.float32) / 255.0
    arr = np.array(img, dtype=np.float32)
    k = 20.0 if strong else 12.0
    arr = arr + (fib2[..., None] - 0.5) * k
    img.paste(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB"), (0, 0))
    # 少量深色纤维点
    for _ in range(260 if strong else 150):
        x, y = rng.randrange(w), rng.randrange(h)
        ln = rng.randint(6, 34)
        c = shade(base, rng.uniform(0.62, 0.82))
        d.line([(x, y), (min(w - 1, x + ln), y + rng.randint(-2, 2))], fill=c, width=1)


def _p_cotton(img, bg, rng, tone):
    w, h = img.size
    n = noise_array(w, h, rng, 3)
    arr = np.array(img, dtype=np.float32)
    weave = (np.sin(np.arange(w, dtype=np.float32) / 2.0)[None, :, None] * 0.6
             + np.sin(np.arange(h, dtype=np.float32) / 2.0)[:, None, None] * 0.6)
    arr = arr + (n[..., None] - 0.5) * 10.0 + weave * 2.0
    img.paste(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB"), (0, 0))
    # 淡淡的棉絮斑点
    d = ImageDraw.Draw(img, "RGBA")
    for _ in range(90):
        x, y = rng.randrange(w), rng.randrange(h)
        r = rng.randint(3, 12)
        d.ellipse([x - r, y - r, x + r, y + r], fill=rgba(tone, rng.randint(12, 30)))


def _p_solid(img, base, rng, warm=False):
    w, h = img.size
    t = (np.arange(h, dtype=np.float32) / h)[:, None, None]
    a1 = np.array(rgba(shade(base, 1.02))[:3], np.float32)[None, None, :]
    a2 = np.array(rgba(shade(base, 0.97))[:3], np.float32)[None, None, :]
    rgb = np.broadcast_to(a1 * (1 - t) + a2 * t, (h, w, 3))
    img.paste(Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB"), (0, 0))


def _p_watercolor(img, base, colors, rng):
    w, h = img.size
    img.paste(Image.new("RGB", (w, h), base), (0, 0))
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    for i in range(16):
        c = colors[i % len(colors)]
        cx, cy = rng.randrange(w), rng.randrange(h)
        r = rng.randint(180, 420)
        for k in range(5):
            rr = int(r * (1.0 - 0.13 * k))
            a = 16 + k * 3
            d.ellipse([cx - rr, cy - int(rr * rng.uniform(0.55, 0.95)),
                       cx + rr, cy + int(rr * rng.uniform(0.55, 0.95))], fill=rgba(c, a))
    layer = layer.filter(ImageFilter.GaussianBlur(28))
    img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0, 0))
    # 水彩边缘沉积
    edge = Image.new("L", (w, h), 0)
    de = ImageDraw.Draw(edge)
    for i in range(10):
        cx, cy = rng.randrange(w), rng.randrange(h)
        r = rng.randint(120, 300)
        de.ellipse([cx - r, cy - int(r * 0.7), cx + r, cy + int(r * 0.7)], outline=rng.randint(20, 45), width=3)
    edge = edge.filter(ImageFilter.GaussianBlur(3))
    img.paste(Image.composite(Image.new("RGB", (w, h), mix(colors[0], "#ffffff", 0.3)), img,
                              edge.point(lambda v: int(v * 0.5))), (0, 0))


def _marble_turbulence(w, h, rng, cells=9):
    """周期性湍流场（0..1），可无缝平铺。"""
    xs = np.arange(w, dtype=np.float32)[None, :] * (2.0 * math.pi / w)
    ys = np.arange(h, dtype=np.float32)[:, None] * (2.0 * math.pi / h)
    out = np.zeros((h, w), dtype=np.float32)
    amp = 1.0
    total = 0.0
    for k in range(1, cells + 1):
        ph1, ph2 = rng.uniform(0, 6.283), rng.uniform(0, 6.283)
        ph3, ph4 = rng.uniform(0, 6.283), rng.uniform(0, 6.283)
        out += amp * (np.sin(k * xs + ph1) * np.cos(k * ys + ph2)
                      + 0.7 * np.sin(k * (xs * 0.5 + ys) + ph3) * np.cos(k * (ys * 0.5 - xs) + ph4))
        total += amp
        amp *= 0.75
    out /= max(1e-6, total)
    return clampf(out * 0.5 + 0.5)


def _p_marble(img, base, vein_colors, rng):
    w, h = img.size
    turb = _marble_turbulence(w, h, rng, cells=8)
    y = np.arange(h, dtype=np.float32)[:, None] / h
    x = np.arange(w, dtype=np.float32)[None, :] / w
    field = np.sin((y * 3.0 + x * 2.0) * math.pi * 2.0 * 1.4 + turb * 7.5)
    field2 = np.sin((y * 1.05 - x * 0.6) * math.pi * 2.0 * 3.1 + turb * 4.0)
    vein = np.maximum(smoothstep(1.0 - np.abs(field) * 5.0), 0.55 * smoothstep(1.0 - np.abs(field2) * 9.0))
    vein = np.clip(vein, 0, 1)
    arr = np.zeros((h, w, 3), dtype=np.float32)
    arr[:] = np.array(rgba(base)[:3], np.float32)[None, None, :]
    v1 = np.array(rgba(vein_colors[0])[:3], np.float32)
    v2 = np.array(rgba(vein_colors[1 % len(vein_colors)])[:3], np.float32)
    v3 = np.array(rgba(vein_colors[2 % len(vein_colors)])[:3], np.float32)
    arr = arr * (1 - vein[..., None] * 0.85) + (v1 * (1 - turb[..., None]) + v2 * turb[..., None]) * vein[..., None] * 0.85
    thin = np.clip((smoothstep(1.0 - np.abs(field) * 12.0)) * 0.8, 0, 1)
    arr = arr * (1 - thin[..., None] * 0.7) + v3 * thin[..., None] * 0.7
    img.paste(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB"), (0, 0))


def _p_gingham(img, bg, c, step=62):
    """维希格纹：两个方向的半透明条带叠加，交叉处更深。"""
    layer = Image.new("RGBA", (PAPER_W, PAPER_H), (0, 0, 0, 0))
    dl = ImageDraw.Draw(layer, "RGBA")
    x = 0
    i = 0
    while x < PAPER_W:
        if i % 2 == 0:
            dl.rectangle([x, 0, x + step, PAPER_H], fill=rgba(c, 88))
        x += step
        i += 1
    y = 0
    i = 0
    while y < PAPER_H:
        if i % 2 == 0:
            dl.rectangle([0, y, PAPER_W, y + step], fill=rgba(c, 88))
        y += step
        i += 1
    base = Image.new("RGBA", (PAPER_W, PAPER_H), rgba(bg))
    img.paste(Image.alpha_composite(base, layer).convert("RGB"), (0, 0))


def _p_plaid(img, bg, colors, rng):
    """大格纹：宽窄不一的彩色条带 + 白色细线。"""
    layer = Image.new("RGBA", (PAPER_W, PAPER_H), (0, 0, 0, 0))
    dl = ImageDraw.Draw(layer, "RGBA")
    x = 0
    i = 0
    while x < PAPER_W:
        wdt = 8 if i % 3 else 20
        dl.rectangle([x, 0, x + wdt, PAPER_H], fill=rgba(colors[i % len(colors)], 62))
        if i % 4 == 0:
            dl.rectangle([x + wdt, 0, x + wdt + 3, PAPER_H], fill=rgba("#ffffff", 70))
        x += wdt + rng.choice([26, 34, 46])
        i += 1
    y = 0
    i = 0
    while y < PAPER_H:
        hgt = 10 if i % 3 else 24
        dl.rectangle([0, y, PAPER_W, y + hgt], fill=rgba(colors[(i + 1) % len(colors)], 62))
        if i % 4 == 0:
            dl.rectangle([0, y + hgt, PAPER_W, y + hgt + 3], fill=rgba("#ffffff", 70))
        y += hgt + rng.choice([28, 36, 48])
        i += 1
    base = Image.new("RGBA", (PAPER_W, PAPER_H), rgba(bg))
    img.paste(Image.alpha_composite(base, layer).convert("RGB"), (0, 0))


def _p_cornell(d, bg, p, rng):
    ink = mix(p["ink"], bg, 0.55)
    top = 300
    left = 300
    d.line([(0, top), (PAPER_W, top)], fill=ink, width=3)
    d.line([(left, top), (left, PAPER_H)], fill=ink, width=3)
    d.line([(0, PAPER_H - 250), (PAPER_W, PAPER_H - 250)], fill=ink, width=3)
    y = top + 60
    while y < PAPER_H - 260:
        d.line([(left + 20, y), (PAPER_W - 30, y)], fill=mix(ink, bg, 0.45), width=1)
        y += 62
    y = 60
    while y < top - 40:
        d.line([(40, y), (PAPER_W - 40, y)], fill=mix(ink, bg, 0.55), width=1)
        y += 60
    d.line([(300, top), (360, top - 0)], fill=ink, width=3)


def _p_daily(d, bg, p):
    cell_w, cell_h = 155, 155
    top, left = 60, 60
    ink = mix(p["ink"], bg, 0.45)
    c = mix(p["c1"], bg, 0.72)
    d.rectangle([left - 20, top - 20, left + cell_w * 7 + 20, top + cell_h * 11 + 20], outline=ink, width=3)
    for i in range(8):
        x = left + i * cell_w
        d.line([(x, top - 20), (x, top + cell_h * 11 + 20)], fill=ink, width=2 if i in (0, 7) else 1)
    for j in range(12):
        y = top + j * cell_h
        d.line([(left - 20, y), (left + cell_w * 7 + 20, y)], fill=ink, width=2 if j in (0, 11) else 1)
    for j in range(3):
        for i in range(2):
            d.rectangle([left + 20 + i * 140, top + cell_h * 11 + 40 + j * 120,
                         left + 20 + i * 140 + 120, top + cell_h * 11 + 40 + j * 120 + 90],
                        outline=c, width=3)


def _p_week(d, bg, p):
    ink = mix(p["ink"], bg, 0.28)
    head = 170
    d.rectangle([50, 50, PAPER_W - 50, PAPER_H - 50], outline=ink, width=3)
    d.line([(50, head), (PAPER_W - 50, head)], fill=ink, width=3)
    for i in range(1, 7):
        x = 50 + (PAPER_W - 100) * i / 7.0
        d.line([(x, head), (x, PAPER_H - 50)], fill=ink, width=2)
    y = head
    while y < PAPER_H - 50:
        d.line([(50, y), (PAPER_W - 50, y)], fill=mix(ink, bg, 0.6), width=1)
        y += 78
    y = head + 300
    while y < PAPER_H - 60:
        d.line([(50, y), (PAPER_W - 50, y + 0)], fill=mix(p["c1"], bg, 0.55), width=2)
        y += 600


def _p_letter(d, bg, p, rng):
    ink = mix(p["ink"], bg, 0.55)
    y = 260
    while y < PAPER_H - 220:
        d.line([(150, y), (PAPER_W - 150, y)], fill=ink, width=2)
        y += 92
    for i in range(2):
        y0 = y + 70 + i * 92
        d.line([(150, y0), (150 + 420 - i * 180, y0)], fill=ink, width=2)
    d.line([(150, 180), (PAPER_W - 150, 180)], fill=mix(p["accent"], bg, 0.35), width=4)


def _paper_grain(img, rng, strength=4.0):
    """极细颗粒，让底纹更像纸而不是纯色块。"""
    w, h = img.size
    n = noise_array(w, h, rng, 1)
    arr = np.array(img, dtype=np.float32) + (n[..., None] - 0.5) * 2.0 * strength
    img.paste(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB"), (0, 0))


# --------------------------------------------------------------------------- #
# 2) tape —— 和纸胶带
# --------------------------------------------------------------------------- #

TAPE_SPECS = [
    ("stripe", "macaron", "c1", "粉色条纹胶带", "条纹", ["条纹", "粉色", "少女", "甜美"], (1500, 300)),
    ("stripe", "fresh", "c1", "薄荷条纹胶带", "条纹", ["条纹", "薄荷", "清新", "夏日"], (1440, 260)),
    ("stripe", "morandi", "c3", "灰蓝条纹胶带", "条纹", ["条纹", "灰蓝", "莫兰迪", "简约"], (1440, 300)),
    ("stripe", "kraft", "c1", "牛皮条纹胶带", "条纹", ["条纹", "牛皮", "复古", "手作"], (1500, 340)),
    ("dots", "macaron", "c1", "樱花波点胶带", "波点", ["波点", "粉色", "可爱", "少女"], (1340, 220)),
    ("dots", "fresh", "c1", "薄荷波点胶带", "波点", ["波点", "薄荷", "清新", "圆点"], (1400, 260)),
    ("dots", "morandi", "c4", "灰调波点胶带", "波点", ["波点", "灰调", "莫兰迪", "简约"], (1340, 240)),
    ("grid", "fresh", "c1", "蓝绿格纹胶带", "格纹", ["格纹", "蓝绿", "清新", "格子"], (1440, 300)),
    ("grid", "morandi", "c3", "灰格纹胶带", "格纹", ["格纹", "灰", "莫兰迪", "格子"], (1400, 280)),
    ("plaid", "kraft", "c2", "苏格兰格纹胶带", "格纹", ["格纹", "苏格兰", "牛皮", "复古"], (1500, 340)),
    ("plaid", "macaron", "c3", "粉彩格纹胶带", "格纹", ["格纹", "粉彩", "田园", "格"], (1480, 320)),
    ("floral", "macaron", "c1", "小碎花胶带", "碎花", ["碎花", "花朵", "田园", "少女"], (1480, 300)),
    ("floral", "fresh", "c2", "蓝花胶带", "碎花", ["碎花", "蓝色", "清新", "花卉"], (1460, 300)),
    ("floral", "morandi", "c4", "莫兰迪碎花胶带", "碎花", ["碎花", "莫兰迪", "温柔", "花卉"], (1460, 280)),
    ("star", "fresh", "c3", "星月胶带", "星月", ["星月", "星星", "月亮", "夜空"], (1480, 300)),
    ("star", "macaron", "c5", "粉色星月胶带", "星月", ["星月", "粉色", "梦幻", "星星"], (1460, 280)),
    ("star", "morandi", "c3", "灰紫星月胶带", "星月", ["星月", "灰紫", "莫兰迪", "夜"], (1460, 300)),
    ("moon", "fresh", "c3", "月亮胶带", "星月", ["月亮", "夜空", "蓝色", "梦幻"], (1480, 280)),
    ("moon", "morandi", "c5", "灰月亮胶带", "星月", ["月亮", "灰", "简约", "夜空"], (1440, 260)),
    ("wave", "fresh", "c1", "海浪胶带", "波浪", ["波浪", "海洋", "清新", "蓝色"], (1480, 300)),
    ("wave", "macaron", "c2", "波浪胶带", "波浪", ["波浪", "粉彩", "手绘", "曲线"], (1460, 280)),
    ("lace", "macaron", "c1", "蕾丝胶带", "蕾丝", ["蕾丝", "花边", "少女", "粉色"], (1460, 300)),
    ("lace", "morandi", "c4", "灰蕾丝胶带", "蕾丝", ["蕾丝", "花边", "莫兰迪", "优雅"], (1440, 280)),
    ("solid", "macaron", "c1", "玫瑰纯色胶带", "纯色", ["纯色", "玫瑰", "温柔", "基础"], (1420, 260)),
    ("solid", "fresh", "c1", "豆绿纯色胶带", "纯色", ["纯色", "豆绿", "清新", "基础"], (1420, 260)),
    ("solid", "morandi", "c1", "奶茶纯色胶带", "纯色", ["纯色", "奶茶", "莫兰迪", "基础"], (1460, 300)),
    ("solid", "kraft", "c4", "牛皮纯色胶带", "纯色", ["纯色", "牛皮", "复古", "基础"], (1500, 320)),
    ("gradient", "macaron", "c1", "粉紫渐变胶带", "渐变", ["渐变", "粉紫", "梦幻", "温柔"], (1480, 320)),
    ("gradient", "fresh", "c1", "蓝绿渐变胶带", "渐变", ["渐变", "蓝绿", "清新", "海洋"], (1500, 300)),
    ("gradient", "kraft", "c1", "复古渐变胶带", "渐变", ["渐变", "复古", "牛皮", "温暖"], (1500, 320)),
    ("translucent", "macaron", "c1", "樱花半透明胶带", "半透明", ["半透明", "薄透", "粉色", "和纸"], (1460, 280)),
    ("translucent", "morandi", "c5", "灰调半透明胶带", "半透明", ["半透明", "薄透", "灰", "和纸"], (1440, 260)),
    ("translucent", "fresh", "c1", "薄荷半透明胶带", "半透明", ["半透明", "薄透", "薄荷", "和纸"], (1460, 300)),
]


def gen_tape(builder):
    for kind, pal, ckey, name, style_zh, tags, (tw, th) in TAPE_SPECS:
        iid = "tape_%s_%s_01" % (kind, pal)
        rng = random.Random(item_seed(iid))
        p = PALETTES[pal]
        alpha_body = rng.randint(205, 238)
        if kind == "translucent":
            alpha_body = rng.randint(165, 195)
        pattern = _tape_pattern(kind, pal, tw, th, rng, ckey)
        img = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
        img.alpha_composite(pattern)
        img = grain_alpha(img, rng, amount=0.055, granularity=2, alpha_center=alpha_body)
        cov = tear_coverage(tw, th, rng,
                            end_depth=(0.055, 0.115), edge_depth=(0.02, 0.055),
                            periodic=0.75, period=(60.0, 170.0), amp=(3.0, 11.0))
        cov = np.asarray(Image.fromarray((cov * 255).astype(np.uint8), "L")
                         .filter(ImageFilter.GaussianBlur(0.7)), dtype=np.float32) / 255.0
        a = np.array(img.getchannel("A"), dtype=np.float32) * cov
        img.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "L"))
        # 上缘高光 + 下缘阴影，像有点厚度的和纸
        shade_arr = np.array(img, dtype=np.float32)
        grad = np.zeros(th, dtype=np.float32)
        yy = np.arange(th, dtype=np.float32)
        grad = 1.0 + 0.10 * np.exp(-((yy - 2.0) / 3.0) ** 2) - 0.09 * np.exp(-((yy - (th - 3.0)) / 3.5) ** 2)
        for ch in range(3):
            shade_arr[..., ch] = np.clip(shade_arr[..., ch] * grad[:, None], 0, 255)
        img = Image.fromarray(shade_arr.astype(np.uint8), "RGBA")
        dom = _dominant_of(img, palette_color(pal, 0))
        desc = "%s：长 %dpx 短 %dpx，两端锯齿撕裂边，和纸半透明" % (name, tw, th)
        builder.add(iid, name, "tape", tags + [PALETTES[pal]["zh"], style_zh], img, dom, desc,
                    alpha=True, tile=False)


def _tape_pattern(kind, pal, w, h, rng, ckey=None):
    """在 w×h 上绘制胶带图案，返回 RGBA 图。"""
    p = PALETTES[pal]
    colors = variant_colors(pal, rng, 3, key=ckey)
    base_alpha = 255
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")
    d.rectangle([0, 0, w, h], fill=rgba(p["bg"], base_alpha))
    c1, c2, c3 = colors
    ink = p["ink"]

    if kind == "stripe":
        step = rng.randint(42, 64)
        soft = mix(c2, p["bg"], 0.32)
        stripes = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ds = ImageDraw.Draw(stripes, "RGBA")
        x = 0
        i = 0
        while x < w:
            if i % 2 == 1:
                ds.rectangle([x, 0, x + step * 0.8, h], fill=rgba(soft, 190))
            x += step
            i += 1
        img = Image.alpha_composite(img, stripes)
        d = ImageDraw.Draw(img, "RGBA")
        x = int(step * 0.5)
        while x < w:
            d.line([(x, 0), (x, h)], fill=rgba("#ffffff", 70), width=2)
            x += step * 2
    elif kind == "dots":
        base = mix(c1, p["bg"], 0.30)
        soft = mix(c2, p["bg"], 0.45)
        img = Image.new("RGBA", (w, h), rgba(base, 255))
        d = ImageDraw.Draw(img, "RGBA")
        step = rng.choice([74, 86, 96])
        r = step * rng.uniform(0.16, 0.24)
        j = 0
        y = step * 0.5
        while y < h + step:
            x = step * 0.5 + (step * 0.5 if j % 2 else 0)
            while x < w + step:
                d.ellipse([x - r, y - r, x + r, y + r], fill=rgba(soft, 240))
                d.ellipse([x - r * 0.42, y - r * 0.42, x + r * 0.42, y + r * 0.42], fill=rgba("#ffffff", 175))
                x += step
            y += step
            j += 1
    elif kind == "grid":
        d.rectangle([0, 0, w, h], fill=rgba(p["bg"], 245))
        step = rng.choice([36, 44, 56])
        x = 0
        while x < w:
            d.line([(x, 0), (x, h)], fill=rgba(mix(c1, p["bg"], 0.35), 205), width=3)
            x += step
        y = 0
        while y < h:
            d.line([(0, y), (w, y)], fill=rgba(mix(c1, p["bg"], 0.5), 195), width=3)
            y += step
    elif kind == "plaid":
        d.rectangle([0, 0, w, h], fill=rgba(mix(c1, "#ffffff", 0.45), 240))
        x = 0
        while x < w:
            wd = rng.choice([26, 42, 60])
            d.rectangle([x, 0, x + wd, h], fill=rgba(c2, 120))
            if rng.random() < 0.4:
                d.rectangle([x + wd, 0, min(w, x + wd + 4), h], fill=rgba("#ffffff", 150))
            x += wd + rng.choice([18, 30, 44])
        y = 0
        while y < h:
            ht = rng.choice([30, 48, 70])
            d.rectangle([0, y, w, y + ht], fill=rgba(c3, 110))
            y += ht + rng.choice([20, 34, 48])
    elif kind == "floral":
        d.rectangle([0, 0, w, h], fill=rgba(p["bg"], 245))
        count = max(6, int(w / 190))
        for i in range(count):
            cx = rng.uniform(-30, w + 30)
            cy = rng.uniform(h * 0.1, h * 0.9)
            r = rng.uniform(h * 0.10, h * 0.20)
            col = [c1, c2, c3, p["accent"]][i % 4]
            _draw_flower(d, cx, cy, r, col, mix(col, "#ffffff", 0.55))
            if i % 2 == 0:
                _draw_leaf(d, cx + r * 2.1, cy + r * 0.9, r * 0.9, mix(p["c2"], "#5f7f5a", 0.45))
    elif kind in ("star", "moon"):
        dark = mix(p["c3"], ink, 0.35)
        d.rectangle([0, 0, w, h], fill=rgba(dark, 235))
        for i in range(max(8, int(w / 90))):
            cx, cy = rng.uniform(0, w), rng.uniform(h * 0.1, h * 0.9)
            s = rng.uniform(h * 0.08, h * 0.24)
            if rng.random() < 0.34:
                _draw_moon(d, cx, cy, s, rgba("#fdf3d8", 240))
            else:
                _draw_star(d, cx, cy, s, rgba(rng.choice(["#fdf3d8", c1, "#ffffff"]), 235), 5)
            if rng.random() < 0.7:
                d.ellipse([cx + s * 1.8, cy - s * 0.3, cx + s * 1.8 + 4, cy - s * 0.3 + 4],
                          fill=rgba("#ffffff", 190))
    elif kind == "wave":
        d.rectangle([0, 0, w, h], fill=rgba(p["bg"], 240))
        for row in range(4):
            col = rgba([c1, c2, c3, p["accent"]][row % 4], 205)
            y0 = h * (0.22 + 0.19 * row)
            amp = h * rng.uniform(0.07, 0.14)
            period = w / rng.uniform(6.0, 11.0)
            pts = [(x, y0 + amp * math.sin(x / period * 2 * math.pi + row)) for x in range(0, w + 4, 6)]
            d.line(pts, fill=col, width=rng.choice([5, 7, 9]), joint="curve")
    elif kind == "lace":
        d.rectangle([0, 0, w, h], fill=rgba(p["bg"], 244))
        edge = rng.choice(["top", "bottom"])
        y0 = h * 0.5 if edge == "top" else 0.0
        d.rectangle([0, 0, w, h * 0.5] if edge == "top" else [0, h * 0.5, w, h], fill=rgba(c1, 150))
        r = h * 0.16
        x = r
        while x < w + r:
            if edge == "top":
                d.ellipse([x - r, h * 0.5 - r, x + r, h * 0.5 + r], fill=rgba(p["bg"], 244))
                d.ellipse([x - r * 0.5, r * 0.5 - r * 0.5, x + r * 0.5, r * 0.5 + r * 0.5], fill=rgba(c2, 200))
            else:
                d.ellipse([x - r, h * 0.5 - r, x + r, h * 0.5 + r], fill=rgba(p["bg"], 244))
                d.ellipse([x - r * 0.5, h - r, x + r * 0.5, h], fill=rgba(c2, 200))
            x += r * 2.0
        for i in range(int(w / 60)):
            cx = rng.uniform(0, w)
            cy = h * rng.uniform(0.15, 0.85)
            d.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=rgba(c3, 170))
    elif kind == "solid":
        d.rectangle([0, 0, w, h], fill=rgba(c1, 246))
        for i in range(3):
            d.rectangle([0, h * (0.15 + 0.3 * i), w, h * (0.15 + 0.3 * i) + 3], fill=rgba("#ffffff", 60))
    elif kind == "gradient":
        g = h_gradient((w, h), c1, c3, 250)
        img.alpha_composite(g)
        for i in range(4):
            y0 = h * (0.2 + 0.2 * i)
            d.line([(0, y0), (w, y0)], fill=rgba("#ffffff", 60), width=6)
    elif kind == "translucent":
        base = mix(c1, p["bg"], 0.75)
        d.rectangle([0, 0, w, h], fill=rgba(base, 255))
        step = rng.choice([66, 84, 104])
        r = step * 0.30
        j = 0
        y = step * 0.5
        while y < h + step:
            x = step * 0.5 + (step * 0.5 if j % 2 else 0)
            while x < w + step:
                d.ellipse([x - r, y - r, x + r, y + r], fill=rgba(mix(c1, "#ffffff", 0.35), 150))
                x += step
            y += step
            j += 1
    img = _tape_texture(img, rng, pal)
    return img


def _tape_texture(img, rng, pal):
    """叠一层极细纤维噪点，让胶带有和纸质感（不改变 alpha）。"""
    w, h = img.size
    n = noise_array(w, h, rng, 1)
    arr = np.array(img, dtype=np.float32)
    for ch in range(3):
        arr[..., ch] = np.clip(arr[..., ch] + (n - 0.5) * 12.0, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def _draw_flower(d, cx, cy, r, outer, inner):
    for k in range(5):
        a = math.pi * 2 * k / 5.0 - math.pi / 2
        px, py = cx + math.cos(a) * r * 0.85, cy + math.sin(a) * r * 0.85
        d.ellipse([px - r * 0.72, py - r * 0.72, px + r * 0.72, py + r * 0.72], fill=rgba(outer, 235))
    d.ellipse([cx - r * 0.42, cy - r * 0.42, cx + r * 0.42, cy + r * 0.42], fill=rgba(inner, 245))


def _draw_leaf(d, cx, cy, r, col):
    d.polygon([(cx - r, cy), (cx, cy - r * 0.6), (cx + r, cy), (cx, cy + r * 0.6)], fill=rgba(col, 220))
    d.line([(cx - r * 0.9, cy), (cx + r * 0.9, cy)], fill=rgba(mix(col, "#ffffff", 0.5), 200), width=2)


def _draw_star(d, cx, cy, r, col, points=5):
    pts = []
    for k in range(points * 2):
        a = -math.pi / 2 + math.pi * k / points
        rr = r if k % 2 == 0 else r * 0.42
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    d.polygon(pts, fill=col)


def _draw_moon(d, cx, cy, r, col):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    d.ellipse([cx - r + r * 0.52, cy - r * 1.06, cx + r + r * 0.52, cy + r * 0.94], fill=(0, 0, 0, 0))


def _dominant_of(img, fallback):
    """从图像中采样估算主色，返回 #rrggbb。"""
    try:
        small = img.convert("RGBA").resize((48, 48), Image.BILINEAR)
        arr = np.asarray(small, dtype=np.float32)
        a = arr[..., 3:4] / 255.0
        if float(a.sum()) <= 0.5:
            return fallback.lower()
        rgb = (arr[..., :3] * a).reshape(-1, 3)
        wsum = a.reshape(-1)
        mean = rgb.sum(axis=0) / max(1e-6, wsum.sum())
        # 提升饱和度，作为"主色"更有代表性
        h, s, v = colorsys.rgb_to_hsv(*(mean / 255.0))
        s = min(1.0, s * 1.25)
        v = min(1.0, v * 1.02)
        return "#%02x%02x%02x" % tuple(int(round(c * 255)) for c in colorsys.hsv_to_rgb(h, s, v))
    except Exception:
        return fallback.lower()


def _fmt_hex(rgb):
    return "#%02x%02x%02x" % tuple(int(max(0, min(255, c))) for c in rgb)


# --------------------------------------------------------------------------- #
# 3) sticker —— 贴纸（白描边 + 柔和投影）
# --------------------------------------------------------------------------- #

STICKER_SPECS = [
    ("label", "macaron", "c1", 560, "粉彩标签贴", "标签", ["标签", "便签", "粉色", "备忘"], "今日份"),
    ("label", "fresh", "c1", 540, "薄荷标签贴", "标签", ["标签", "薄荷", "清新", "备忘"], "备忘"),
    ("label", "kraft", "c1", 560, "牛皮标签贴", "标签", ["标签", "牛皮", "复古", "手作"], "HANDMADE"),
    ("arrow", "macaron", "c1", 520, "粉色箭头贴", "箭头", ["箭头", "指引", "粉色", "手绘"], ""),
    ("arrow", "fresh", "c1", 500, "薄荷箭头贴", "箭头", ["箭头", "指引", "薄荷", "清新"], ""),
    ("arrow", "kraft", "c3", 500, "牛皮箭头贴", "箭头", ["箭头", "指引", "牛皮", "复古"], ""),
    ("heart", "macaron", "c1", 440, "粉色爱心贴", "爱心", ["爱心", "粉色", "甜美", "装饰"], ""),
    ("heart", "fresh", "c4", 420, "薄荷爱心贴", "爱心", ["爱心", "薄荷", "清新", "装饰"], ""),
    ("heart", "morandi", "c1", 440, "灰粉爱心贴", "爱心", ["爱心", "灰粉", "莫兰迪", "装饰"], ""),
    ("star", "macaron", "c2", 460, "彩色星星贴", "星星", ["星星", "彩色", "闪耀", "装饰"], ""),
    ("star", "fresh", "c1", 440, "薄荷星星贴", "星星", ["星星", "薄荷", "清新", "闪耀"], ""),
    ("star", "kraft", "c1", 460, "牛皮星星贴", "星星", ["星星", "牛皮", "复古", "装饰"], ""),
    ("flower", "macaron", "c1", 480, "粉花贴纸", "花朵", ["花朵", "粉色", "田园", "少女"], ""),
    ("flower", "fresh", "c2", 460, "蓝花贴纸", "花朵", ["花朵", "蓝色", "清新", "田园"], ""),
    ("flower", "morandi", "c1", 470, "莫兰迪花贴纸", "花朵", ["花朵", "莫兰迪", "优雅", "装饰"], ""),
    ("leaf", "fresh", "c1", 440, "绿叶贴纸", "叶子", ["叶子", "绿色", "自然", "植物"], ""),
    ("leaf", "morandi", "c2", 430, "枯叶贴纸", "叶子", ["叶子", "枯叶", "莫兰迪", "秋日"], ""),
    ("cloud", "fresh", "c2", 480, "白云贴纸", "云朵", ["云朵", "天空", "清新", "可爱"], ""),
    ("cloud", "macaron", "c1", 460, "粉云贴纸", "云朵", ["云朵", "粉色", "可爱", "天空"], ""),
    ("bubble", "fresh", "c1", 520, "对话气泡贴", "气泡", ["气泡", "对话", "漫画", "文字框"], ""),
    ("bubble", "macaron", "c1", 500, "粉色气泡贴", "气泡", ["气泡", "粉色", "可爱", "漫画"], ""),
    ("bow", "macaron", "c1", 480, "粉色蝴蝶结", "蝴蝶结", ["蝴蝶结", "粉色", "甜美", "装饰"], ""),
    ("bow", "fresh", "c1", 460, "薄荷蝴蝶结", "蝴蝶结", ["蝴蝶结", "薄荷", "清新", "装饰"], ""),
    ("date", "morandi", "c4", 540, "日签贴纸", "日签", ["日签", "日期", "手账", "打卡"], "今日"),
    ("heart", "kraft", "c1", 430, "牛皮爱心贴", "爱心", ["爱心", "牛皮", "复古", "装饰"], ""),
    ("heart", "fresh", "c3", 425, "浅蓝爱心贴", "爱心", ["爱心", "浅蓝", "清新", "装饰"], ""),
    ("heart", "macaron", "c5", 435, "藕紫爱心贴", "爱心", ["爱心", "藕紫", "梦幻", "装饰"], ""),
    ("star", "morandi", "c3", 450, "灰色星星贴", "星星", ["星星", "灰色", "莫兰迪", "装饰"], ""),
    ("star", "fresh", "c4", 455, "蓝绿星星贴", "星星", ["星星", "蓝绿", "清新", "闪耀"], ""),
    ("flower", "kraft", "c2", 470, "牛皮花贴纸", "花朵", ["花朵", "牛皮", "复古", "田园"], ""),
    ("flower", "fresh", "c3", 465, "蓝绿花贴纸", "花朵", ["花朵", "蓝绿", "清新", "田园"], ""),
    ("leaf", "macaron", "c2", 435, "浅绿叶子贴", "叶子", ["叶子", "浅绿", "自然", "清新"], ""),
    ("leaf", "kraft", "c3", 445, "牛皮叶子贴", "叶子", ["叶子", "牛皮", "复古", "自然"], ""),
    ("cloud", "morandi", "c4", 470, "灰调云朵贴", "云朵", ["云朵", "灰调", "莫兰迪", "天空"], ""),
    ("cloud", "kraft", "c5", 465, "牛皮云朵贴", "云朵", ["云朵", "牛皮", "复古", "天空"], ""),
    ("bubble", "fresh", "c3", 510, "蓝绿气泡贴", "气泡", ["气泡", "蓝绿", "漫画", "文字框"], ""),
    ("bubble", "kraft", "c4", 505, "牛皮气泡贴", "气泡", ["气泡", "牛皮", "复古", "文字框"], ""),
    ("bow", "morandi", "c4", 470, "灰调蝴蝶结", "蝴蝶结", ["蝴蝶结", "灰调", "莫兰迪", "装饰"], ""),
    ("bow", "kraft", "c2", 475, "牛皮蝴蝶结", "蝴蝶结", ["蝴蝶结", "牛皮", "复古", "装饰"], ""),
    ("label", "morandi", "c4", 550, "灰色标签贴", "标签", ["标签", "灰色", "莫兰迪", "备忘"], "备注"),
    ("label", "fresh", "c2", 545, "蓝绿标签贴", "标签", ["标签", "蓝绿", "清新", "备忘"], "计划"),
    ("label", "kraft", "c2", 555, "牛皮标签记事贴", "标签", ["标签", "牛皮", "复古", "备忘"], "手作"),
    ("arrow", "macaron", "c2", 515, "粉彩箭头贴", "箭头", ["箭头", "粉彩", "指引", "手绘"], ""),
    ("arrow", "morandi", "c3", 515, "灰色箭头贴", "箭头", ["箭头", "灰色", "莫兰迪", "指引"], ""),
    ("arrow", "fresh", "c4", 510, "蓝绿箭头贴", "箭头", ["箭头", "蓝绿", "清新", "指引"], ""),
]


def gen_sticker(builder):
    """id 用 <shape>_<色系名>，色系名 = 调色板 + 主色槽（同形状可有多套配色）。"""
    for shape, pal, ckey, size, name, shape_zh, tags, text in STICKER_SPECS:
        iid = "sticker_%s_%s%s_01" % (shape, pal, ckey)
        rng = random.Random(item_seed(iid))
        img, dom = _sticker_render(shape, pal, size, rng, text, ckey)
        desc = "%s：%d×%d，白色描边 + 柔和投影" % (name, size, size)
        builder.add(iid, name, "sticker", tags + [PALETTES[pal]["zh"], shape_zh], img, dom, desc, alpha=True)


def _sticker_render(shape, pal, size, rng, text, ckey=None):
    p = PALETTES[pal]
    colors = variant_colors(pal, rng, 3, hue_span=0.05, val_span=0.12, key=ckey)
    ss = 3 if size <= 420 else (2 if size <= 600 else 2)
    ss = 3
    S = size * ss
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    text_color = p["ink"]
    c1, c2, c3 = colors
    if shape == "label":
        _st_label(d, S, rng, c1, c2, text)
    elif shape == "arrow":
        _st_arrow(d, S, rng, c1, c2)
    elif shape == "heart":
        _st_heart(d, S, rng, c1, c2)
    elif shape == "star":
        _st_star(d, S, rng, c1, c2, c3)
    elif shape == "flower":
        _st_flower(d, S, rng, c1, c2, c3)
    elif shape == "leaf":
        _st_leaf(d, S, rng, c1, c2)
    elif shape == "cloud":
        _st_cloud(d, S, rng, c1, c2)
    elif shape == "bubble":
        _st_bubble(d, S, rng, c1, c2, text_color, text)
    elif shape == "bow":
        _st_bow(d, S, rng, c1, c2)
    elif shape == "date":
        _st_date(d, S, rng, c1, c2, text)
    # 轻微高光
    hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dh = ImageDraw.Draw(hl)
    dh.ellipse([-S * 0.15, -S * 0.5, S * 0.85, S * 0.30], fill=(255, 255, 255, 58))
    hl = hl.filter(ImageFilter.GaussianBlur(S * 0.03))
    layer = Image.alpha_composite(layer, Image.composite(
        hl, Image.new("RGBA", (S, S), (0, 0, 0, 0)), layer.getchannel("A")))

    # 缩小到目标尺寸（抗锯齿）
    content = layer.resize((size, size), Image.LANCZOS)
    a = alpha_mask(content)
    key = np.clip((np.asarray(Image.fromarray(dilate_np(a, ss), "L")
                              .filter(ImageFilter.GaussianBlur(0.5)), dtype=np.float32) - 40.0) * 4.2, 0, 255)
    key_img = colorize(key, "#ffffff")
    shadow = drop_shadow(Image.fromarray(key.astype(np.uint8), "L"),
                         offset=(0, max(2, int(size * 0.018))), blur=max(3, size * 0.026), opacity=0.30)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(shadow)
    out.alpha_composite(key_img)
    out.alpha_composite(content)
    dom = _dominant_of(out, palette_color(pal, 0))
    return out, dom


def _rr(d, box, radius, fill, outline=None, width=0):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def _st_label(d, S, rng, c1, c2, text):
    m = S * 0.10
    box = [m, S * 0.20, S - m, S * 0.80]
    r = S * 0.07
    _rr(d, box, r, rgba(c1, 255))
    # 顶部色带
    d.rounded_rectangle([box[0], box[1], box[2], box[1] + (box[3] - box[1]) * 0.26], radius=r,
                        fill=rgba(c2, 255))
    d.rectangle([box[0], box[1] + (box[3] - box[1]) * 0.20, box[2], box[1] + (box[3] - box[1]) * 0.26],
                fill=rgba(c2, 255))
    # 斜纹
    stripe = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ds = ImageDraw.Draw(stripe)
    step = S * 0.055
    x = -S
    while x < S * 2:
        ds.line([(x, S), (x + S, 0)], fill=(255, 255, 255, 46), width=max(2, int(S * 0.014)))
        x += step
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([box[0], box[1] + (box[3] - box[1]) * 0.26, box[2], box[3]],
                                           radius=r, fill=255)
    d._image.alpha_composite(Image.composite(stripe, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))
    # 打孔
    hr = S * 0.022
    hx, hy = box[0] + S * 0.055, (box[1] + box[3]) / 2.0
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(255, 255, 255, 235))
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], outline=rgba(shade(c1, 0.75), 120), width=max(2, int(S * 0.004)))
    if text:
        font = fit_font(d, text, (box[2] - box[0]) * 0.62, (box[3] - box[1]) * 0.4, start=int(S * 0.15))
        draw_text_center(d, (box[0] + box[2]) / 2.0 + S * 0.02, (box[1] + box[3]) / 2.0 + (box[3] - box[1]) * 0.06,
                         text, font, rgba(shade(c1, 0.5), 255))


def _st_arrow(d, S, rng, c1, c2):
    m = S * 0.10
    y = S * 0.5
    shaft_h = S * 0.26
    head_w = S * 0.34
    pts = [(m, y - shaft_h / 2), (S - m - head_w, y - shaft_h / 2), (S - m - head_w, y - head_w * 0.85),
           (S - m, y), (S - m - head_w, y + head_w * 0.85), (S - m - head_w, y + shaft_h / 2),
           (m, y + shaft_h / 2)]
    d.polygon(pts, fill=rgba(c1, 255))
    d.line([(m + S * 0.02, y - shaft_h * 0.32), (S - m - head_w - S * 0.02, y - shaft_h * 0.32)],
           fill=rgba("#ffffff", 90), width=max(2, int(S * 0.02)))
    d.line([(m + S * 0.02, y + shaft_h * 0.34), (S - m - head_w - S * 0.02, y + shaft_h * 0.34)],
           fill=rgba(shade(c1, 0.82), 150), width=max(2, int(S * 0.016)))
    if rng.random() < 0.6:
        _st_heart(d, S, rng, c2, c2, small=True)


def _heart_pts(cx, cy, r, n=64):
    pts = []
    for i in range(n):
        t = math.pi * 2 * i / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * r / 16.0, cy - y * r / 16.0))
    return pts


def _st_heart(d, S, rng, c1, c2, small=False):
    if small:
        cx, cy, r = S * 0.72, S * 0.70, S * 0.10
    else:
        cx, cy, r = S * 0.5, S * 0.52, S * 0.42
    d.polygon(_heart_pts(cx, cy, r), fill=rgba(c1, 255))
    d.polygon(_heart_pts(cx - r * 0.14, cy - r * 0.10, r * 0.42), fill=rgba("#ffffff", 62))


def _star_pts(cx, cy, r, points=5, inner=0.42, rot=-math.pi / 2):
    pts = []
    for k in range(points * 2):
        a = rot + math.pi * k / points
        rr = r if k % 2 == 0 else r * inner
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    return pts


def _st_star(d, S, rng, c1, c2, c3):
    d.polygon(_star_pts(S * 0.5, S * 0.5, S * 0.46), fill=rgba(c1, 255))
    d.polygon(_star_pts(S * 0.5, S * 0.5, S * 0.46 * 0.62), fill=rgba("#ffffff", 55))
    for i in range(2):
        cx = S * (0.22 + 0.56 * i)
        cy = S * (0.24 if i == 0 else 0.76)
        d.polygon(_star_pts(cx, cy, S * 0.085, points=4, inner=0.36), fill=rgba(c2 if i == 0 else c3, 235))


def _st_flower(d, S, rng, c1, c2, c3):
    cx, cy = S * 0.5, S * 0.52
    R = S * 0.20
    for k in range(6):
        a = math.pi * 2 * k / 6.0
        px, py = cx + math.cos(a) * R * 0.95, cy + math.sin(a) * R * 0.95
        col = c1 if k % 2 == 0 else mix(c1, c2, 0.55)
        d.ellipse([px - R * 0.80, py - R * 0.80, px + R * 0.80, py + R * 0.80], fill=rgba(col, 250))
        d.ellipse([px - R * 0.52, py - R * 0.60, px + R * 0.30, py + R * 0.12], fill=rgba("#ffffff", 55))
    d.ellipse([cx - R * 0.62, cy - R * 0.62, cx + R * 0.62, cy + R * 0.62], fill=rgba(c3, 255))
    dot = S * 0.016
    for i in range(8):
        a = math.pi * 2 * i / 8.0
        px, py = cx + math.cos(a) * R * 0.3, cy + math.sin(a) * R * 0.3
        d.ellipse([px - dot, py - dot, px + dot, py + dot], fill=rgba(shade(c3, 0.7), 200))


def _st_leaf(d, S, rng, c1, c2):
    cx, cy = S * 0.5, S * 0.5
    L, Hh = S * 0.44, S * 0.32
    pts = [(cx - L, cy)]
    for k in range(1, 21):
        t = k / 20.0
        pts.append((cx - L + 2 * L * t, cy - Hh * math.sin(math.pi * t)))
    for k in range(19, -1, -1):
        t = k / 20.0
        pts.append((cx - L + 2 * L * t, cy + Hh * math.sin(math.pi * t) * 0.85))
    d.polygon(pts, fill=rgba(c1, 255))
    for k in range(1, 19):
        t = k / 20.0
        x = cx - L + 2 * L * t
        d.line([(x, cy - Hh * math.sin(math.pi * t) * 0.9), (x, cy + Hh * math.sin(math.pi * t) * 0.78)],
               fill=rgba(c2, 90), width=max(2, int(S * 0.006)))
    d.line([(cx - L * 0.95, cy), (cx + L * 0.95, cy)], fill=rgba(shade(c1, 0.72), 230), width=max(3, int(S * 0.014)))


def _st_cloud(d, S, rng, c1, c2):
    puffs = [(0.32, 0.55, 0.17), (0.50, 0.45, 0.21), (0.68, 0.55, 0.16), (0.42, 0.63, 0.15), (0.58, 0.63, 0.14)]
    for px, py, pr in puffs:
        cx, cy, r = S * px, S * py, S * pr
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgba(c1, 255))
    d.rounded_rectangle([S * 0.22, S * 0.58, S * 0.78, S * 0.74], radius=S * 0.08, fill=rgba(c1, 255))
    for px, py, pr in puffs[:3]:
        cx, cy, r = S * px, S * py, S * pr
        d.ellipse([cx - r * 0.6, cy - r * 0.85, cx + r * 0.1, cy - r * 0.1], fill=rgba("#ffffff", 90))
    d.ellipse([S * 0.62, S * 0.60, S * 0.72, S * 0.70], fill=rgba(c2, 120))


def _st_bubble(d, S, rng, c1, c2, ink, text):
    box = [S * 0.10, S * 0.18, S * 0.90, S * 0.70]
    _rr(d, box, S * 0.12, rgba(c1, 255))
    tail = [(S * 0.34, S * 0.68), (S * 0.30, S * 0.86), (S * 0.50, S * 0.68)]
    d.polygon(tail, fill=rgba(c1, 255))
    d.line([(S * 0.30, S * 0.86), (S * 0.34, S * 0.70)], fill=(0, 0, 0, 0), width=0)
    _rr(d, [box[0] + S * 0.03, box[1] + S * 0.03, box[2] - S * 0.03, box[3] - S * 0.03],
        S * 0.10, None, outline=rgba("#ffffff", 110), width=max(2, int(S * 0.008)))
    for i in range(3):
        d.ellipse([S * (0.30 + i * 0.14) - S * 0.035, S * 0.44 - S * 0.035,
                   S * (0.30 + i * 0.14) + S * 0.035, S * 0.44 + S * 0.035], fill=rgba(c2, 235))
    if text:
        font = fit_font(d, text, (box[2] - box[0]) * 0.5, (box[3] - box[1]) * 0.35, start=int(S * 0.12))
        draw_text_center(d, S * 0.5, S * 0.44, text, font, rgba(ink, 230))


def _st_bow(d, S, rng, c1, c2):
    """蝴蝶结：左右各一个带中缝的环 + 两条飘带 + 中间结。"""
    cx, cy = S * 0.5, S * 0.46
    lw, lh = S * 0.34, S * 0.26
    dark = shade(c1, 0.86)
    for sgn in (-1, 1):
        # 环：外侧宽、靠中间收窄，形成真实蝴蝶结轮廓
        outer = (cx + sgn * lw, cy - lh * 0.95)
        outer2 = (cx + sgn * lw, cy + lh * 0.95)
        inner = (cx + sgn * S * 0.07, cy + lh * 0.34)
        inner2 = (cx + sgn * S * 0.07, cy - lh * 0.34)
        d.polygon([inner2, outer, outer2, inner], fill=rgba(c1, 255))
        # 环内的褶皱
        d.polygon([(cx + sgn * S * 0.09, cy - lh * 0.30), (cx + sgn * lw * 0.82, cy - lh * 0.62),
                   (cx + sgn * lw * 0.86, cy + lh * 0.55), (cx + sgn * S * 0.09, cy + lh * 0.30)],
                  fill=rgba(dark, 150))
        d.polygon([(cx + sgn * S * 0.10, cy - lh * 0.26), (cx + sgn * lw * 0.70, cy - lh * 0.52),
                   (cx + sgn * lw * 0.74, cy - lh * 0.18), (cx + sgn * S * 0.10, cy - lh * 0.02)],
                  fill=rgba("#ffffff", 60))
    # 飘带
    d.polygon([(cx - S * 0.05, cy + S * 0.04), (cx - S * 0.19, cy + lh + S * 0.26),
               (cx - S * 0.03, cy + lh + S * 0.16), (cx + S * 0.03, cy + S * 0.06)], fill=rgba(c2, 252))
    d.polygon([(cx + S * 0.05, cy + S * 0.04), (cx + S * 0.19, cy + lh + S * 0.26),
               (cx + S * 0.03, cy + lh + S * 0.16), (cx - S * 0.03, cy + S * 0.06)], fill=rgba(c2, 252))
    # 中间结
    d.ellipse([cx - S * 0.10, cy - S * 0.10, cx + S * 0.10, cy + S * 0.10], fill=rgba(dark, 255))
    d.ellipse([cx - S * 0.062, cy - S * 0.070, cx + S * 0.005, cy - S * 0.005], fill=rgba("#ffffff", 85))


def _st_date(d, S, rng, c1, c2, text):
    r = S * 0.44
    d.ellipse([S * 0.5 - r, S * 0.5 - r, S * 0.5 + r, S * 0.5 + r], fill=rgba(c1, 255))
    d.ellipse([S * 0.5 - r, S * 0.5 - r, S * 0.5 + r, S * 0.5 + r],
              outline=rgba("#ffffff", 130), width=max(2, int(S * 0.014)))
    inner = r * 0.80
    d.ellipse([S * 0.5 - inner, S * 0.5 - inner, S * 0.5 + inner, S * 0.5 + inner],
              outline=rgba(shade(c1, 0.8), 200), width=max(2, int(S * 0.01)))
    if text:
        font = fit_font(d, text, inner * 1.5, inner * 0.9, start=int(S * 0.30))
        draw_text_center(d, S * 0.5, S * 0.5, text, font, rgba(shade(c1, 0.45), 255))
    for i in range(3):
        cx = S * (0.24 + 0.26 * i)
        cy = S * 0.5 - r + (0.06 if i % 2 else 0.10) * S
        d.polygon(_star_pts(cx, cy, S * 0.035, points=4, inner=0.35), fill=rgba(c2, 230))


# --------------------------------------------------------------------------- #
# 4) frame —— 边框
# --------------------------------------------------------------------------- #

FRAME_SPECS = [
    ("round", "fresh", "c1", "圆角边框", "圆角", ["边框", "圆角", "简约", "清新"], (900, 1240)),
    ("square", "morandi", "c3", "直角边框", "直角", ["边框", "直角", "简约", "莫兰迪"], (900, 1240)),
    ("double", "morandi", "c4", "双线边框", "双线", ["边框", "双线", "经典", "简约"], (900, 1240)),
    ("dashed", "fresh", "c1", "虚线边框", "虚线", ["边框", "虚线", "轻盈", "清新"], (900, 1240)),
    ("scallop", "macaron", "c1", "花边边框", "花边", ["边框", "花边", "甜美", "少女"], (900, 1240)),
    ("lace", "macaron", "c5", "蕾丝边框", "蕾丝", ["边框", "蕾丝", "花边", "梦幻"], (900, 1240)),
    ("corner", "fresh", "c2", "四角花边框", "四角", ["边框", "角花", "清新", "简约"], (900, 1240)),
    ("tape_corner", "kraft", "c2", "胶带角贴框", "角贴", ["边框", "胶带", "角贴", "手作"], (900, 1240)),
    ("dotted", "macaron", "c1", "圆点边框", "圆点", ["边框", "圆点", "可爱", "少女"], (900, 1240)),
    ("ribbon", "kraft", "c1", "复古缎带框", "缎带", ["边框", "缎带", "复古", "优雅"], (900, 1240)),
    ("double_round", "kraft", "c3", "牛皮双圆角框", "双圆角", ["边框", "牛皮", "复古", "双层"], (900, 1240)),
    ("washi", "morandi", "c1", "和纸边框", "和纸", ["边框", "和纸", "莫兰迪", "手作"], (900, 1240)),
]


def gen_frame(builder):
    for code, pal, ckey, name, shape_zh, tags, (w, h) in FRAME_SPECS:
        iid = "frame_%s_%s_01" % (code, pal)
        rng = random.Random(item_seed(iid))
        img = _frame_render(code, pal, w, h, rng, ckey)
        dom = _dominant_of(img, palette_color(pal, 0))
        desc = "%s：%d×%d，四边对称，内部透明" % (name, w, h)
        builder.add(iid, name, "frame", tags + [PALETTES[pal]["zh"], shape_zh], img, dom, desc, alpha=True)


def _frame_render(code, pal, w, h, rng, ckey=None):
    p = PALETTES[pal]
    colors = variant_colors(pal, rng, 3, hue_span=0.05, val_span=0.10, key=ckey)
    colors = [hsv_shift(c, ds=0.18, dv=-0.08) for c in colors]   # 边框略加饱和，缩略图更清楚
    c1, c2, c3 = colors
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")
    m = int(min(w, h) * 0.045)          # 边框到画布边缘的留白
    bw = int(min(w, h) * 0.035)         # 框线粗
    if code == "round":
        _rr(d, [m, m, w - m, h - m], int(min(w, h) * 0.06), None, outline=rgba(c1, 240), width=bw)
        _rr(d, [m + bw * 2, m + bw * 2, w - m - bw * 2, h - m - bw * 2], int(min(w, h) * 0.04),
            None, outline=rgba(mix(c1, "#ffffff", 0.5), 190), width=max(2, bw // 3))
    elif code == "square":
        d.rectangle([m, m, w - m, h - m], outline=rgba(c1, 240), width=bw)
    elif code == "double":
        d.rectangle([m, m, w - m, h - m], outline=rgba(c1, 235), width=max(3, bw // 2))
        d.rectangle([m + bw, m + bw, w - m - bw, h - m - bw], outline=rgba(c1, 200), width=max(2, bw // 5))
        d.rectangle([m + bw * 2, m + bw * 2, w - m - bw * 2, h - m - bw * 2],
                    outline=rgba(mix(c2, "#ffffff", 0.35), 190), width=max(2, bw // 4))
    elif code == "dashed":
        _dashed_rect(d, [m, m, w - m, h - m], rgba(c1, 240), max(4, bw // 2), int(min(w, h) * 0.045))
    elif code == "scallop":
        r = int(min(w, h) * 0.055)
        d.rectangle([m, m, w - m, h - m], outline=rgba(c1, 230), width=max(3, bw // 2))
        for x in range(m + r, w - m, r * 2):
            d.ellipse([x - r, m - r, x + r, m + r], outline=rgba(c1, 220), width=max(3, bw // 3))
            d.ellipse([x - r, h - m - r, x + r, h - m + r], outline=rgba(c1, 220), width=max(3, bw // 3))
        for y in range(m + r, h - m, r * 2):
            d.ellipse([m - r, y - r, m + r, y + r], outline=rgba(c1, 220), width=max(3, bw // 3))
            d.ellipse([w - m - r, y - r, w - m + r, y + r], outline=rgba(c1, 220), width=max(3, bw // 3))
    elif code == "lace":
        r = int(min(w, h) * 0.042)
        d.rectangle([m, m, w - m, h - m], outline=rgba(c1, 235), width=max(3, bw // 2))
        for x in range(m, w - m + r, r * 2):
            for yy in (m, h - m):
                d.ellipse([x - r, yy - r, x + r, yy + r], fill=rgba(p["bg"], 255), outline=rgba(c1, 220),
                          width=max(3, bw // 4))
                d.ellipse([x - r * 0.35, yy - r * 0.35, x + r * 0.35, yy + r * 0.35], fill=rgba(c2, 230))
        for y in range(m, h - m + r, r * 2):
            for xx in (m, w - m):
                d.ellipse([xx - r, y - r, xx + r, y + r], fill=rgba(p["bg"], 255), outline=rgba(c1, 220),
                          width=max(3, bw // 4))
                d.ellipse([xx - r * 0.35, y - r * 0.35, xx + r * 0.35, y + r * 0.35], fill=rgba(c2, 230))
    elif code == "corner":
        L = int(min(w, h) * 0.14)
        for i in range(4):
            for j in range(4):
                box = [m + j * L * 0.75, m + i * L * 0.75, m + j * L * 0.75 + L, m + i * L * 0.75 + L]
                if not ((i < 2) == (j < 2)):
                    continue
                d.arc(box, 0, 360, fill=rgba(c1, 200), width=max(2, bw // 4))
        _rr(d, [m, m, w - m, h - m], int(min(w, h) * 0.05), None, outline=rgba(c1, 235), width=max(3, bw // 2))
        for cx, cy, sx, sy in ((m, m, 1, 1), (w - m, m, -1, 1), (m, h - m, 1, -1), (w - m, h - m, -1, -1)):
            for k in range(3):
                rr = int(min(w, h) * (0.045 + k * 0.022))
                d.arc([cx - rr, cy - rr, cx + rr, cy + rr],
                      (0 if sx > 0 else 90) + (0 if sy > 0 else 270), 90, fill=rgba(c2 if k else c1, 210),
                      width=max(2, bw // 3))
    elif code == "tape_corner":
        _rr(d, [m, m, w - m, h - m], int(min(w, h) * 0.02), None, outline=rgba(c1, 190), width=max(2, bw // 3))
        tl = int(min(w, h) * 0.26)
        for sx, sy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            tile = Image.new("RGBA", (tl, int(tl * 0.42)), (0, 0, 0, 0))
            dt = ImageDraw.Draw(tile, "RGBA")
            dt.rectangle([0, 0, tl, int(tl * 0.42)], fill=rgba(c2, 200))
            step = int(tl * 0.08)
            x = -tl
            while x < tl * 2:
                dt.line([(x, tl * 0.42), (x + tl * 0.42, 0)], fill=rgba("#ffffff", 65), width=max(3, step // 3))
                x += step
            tile = tile.rotate(rng.choice([-45, 45]), expand=False, resample=Image.BICUBIC)
            if sx:
                tile = tile.transpose(Image.FLIP_LEFT_RIGHT)
            if sy:
                tile = tile.transpose(Image.FLIP_TOP_BOTTOM)
            px = m - int(tl * 0.08) if sx == 0 else w - m - tl + int(tl * 0.08)
            py = m - int(tl * 0.06) if sy == 0 else h - m - int(tl * 0.42) + int(tl * 0.06)
            img.alpha_composite(tile, (max(0, px), max(0, py)))
    elif code == "dotted":
        step = int(min(w, h) * 0.062)
        r = max(3, step // 6)
        for x in range(m, w - m + step, step):
            for yy in (m, h - m):
                d.ellipse([x - r, yy - r, x + r, yy + r], fill=rgba(c1, 240))
        for y in range(m + step, h - m, step):
            for xx in (m, w - m):
                d.ellipse([xx - r, y - r, xx + r, y + r], fill=rgba(c1, 240))
    elif code == "ribbon":
        th = int(min(w, h) * 0.05)
        d.rectangle([m, m, w - m, m + th], fill=rgba(c1, 240))
        d.rectangle([m, h - m - th, w - m, h - m], fill=rgba(c1, 240))
        d.rectangle([m, m, m + th, h - m], fill=rgba(c1, 240))
        d.rectangle([w - m - th, m, w - m, h - m], fill=rgba(c1, 240))
        for x in range(m, w - m, th * 2):
            d.rectangle([x, m, min(w - m, x + th), m + th], fill=rgba(c2, 90))
            d.rectangle([x, h - m - th, min(w - m, x + th), h - m], fill=rgba(c2, 90))
        for y in range(m, h - m, th * 2):
            d.rectangle([m, y, m + th, min(h - m, y + th)], fill=rgba(c2, 90))
            d.rectangle([w - m - th, y, w - m, min(h - m, y + th)], fill=rgba(c2, 90))
    elif code == "double_round":
        _rr(d, [m, m, w - m, h - m], int(min(w, h) * 0.07), None, outline=rgba(c1, 240), width=max(4, bw // 2))
        _rr(d, [m + bw, m + bw, w - m - bw, h - m - bw], int(min(w, h) * 0.055), None,
            outline=rgba(c3, 180), width=max(2, bw // 4))
    elif code == "washi":
        th = int(min(w, h) * 0.055)
        m = max(m, th)
        _tape_strip_h(d, m, m, w - m, m + th, c1, rng)
        _tape_strip_h(d, m, h - m - th, w - m, h - m, c1, rng)
        _tape_strip_v(d, m, m + th, m + th, h - m - th, c1, rng)
        _tape_strip_v(d, w - m - th, m + th, w - m, h - m - th, c1, rng)
        for cx, cy, sx, sy in ((m, m, 1, 1), (w - m, m, -1, 1), (m, h - m, 1, -1), (w - m, h - m, -1, -1)):
            d.line([(cx - sx * th * 0.6, cy - sy * th * 0.6), (cx, cy)], fill=rgba(shade(c1, 0.8), 200),
                   width=max(2, th // 3))
    return img


def _dashed_rect(d, box, color, width, dash):
    x0, y0, x1, y1 = box
    x = x0
    while x < x1:
        d.line([(x, y0), (min(x1, x + dash), y0)], fill=color, width=width)
        d.line([(x, y1), (min(x1, x + dash), y1)], fill=color, width=width)
        x += dash * 2
    y = y0
    while y < y1:
        d.line([(x0, y), (x0, min(y1, y + dash))], fill=color, width=width)
        d.line([(x1, y), (x1, min(y1, y + dash))], fill=color, width=width)
        y += dash * 2


def _tape_strip_h(d, x0, y0, x1, y1, color, rng):
    d.rectangle([x0, y0, x1, y1], fill=rgba(color, 215))
    step = max(6, int((y1 - y0) * 0.7))
    x = x0
    while x < x1:
        d.line([(x, y1), (x + step, y0)], fill=rgba("#ffffff", 60), width=max(2, step // 4))
        x += step * 2
    for x in range(int(x0), int(x1), max(4, int((y1 - y0) * 0.35))):
        d.line([(x, y0), (x, y0 + 3)], fill=rgba(shade(color, 0.8), 180), width=2)


def _tape_strip_v(d, x0, y0, x1, y1, color, rng):
    d.rectangle([x0, y0, x1, y1], fill=rgba(color, 215))
    step = max(6, int((x1 - x0) * 0.7))
    y = y0
    while y < y1:
        d.line([(x0, y), (x1, y + step)], fill=rgba("#ffffff", 60), width=max(2, step // 4))
        y += step * 2


# --------------------------------------------------------------------------- #
# 5) divider —— 分割线
# --------------------------------------------------------------------------- #

DIVIDER_SPECS = [
    ("dashed", "morandi", "c3", 1200, 60, "虚线分割线", "虚线", ["分割线", "虚线", "简约", "间隔"]),
    ("wave", "fresh", "c1", 1280, 90, "波浪分割线", "波浪", ["分割线", "波浪", "海洋", "清新"]),
    ("lace", "macaron", "c1", 1200, 120, "蕾丝分割线", "蕾丝", ["分割线", "蕾丝", "花边", "少女"]),
    ("dots", "macaron", "c1", 1200, 70, "点点分割线", "点点", ["分割线", "点", "可爱", "间隔"]),
    ("tape_tear", "kraft", "c2", 1300, 110, "胶带撕边分割线", "撕边", ["分割线", "胶带", "撕边", "手作"]),
    ("double", "fresh", "c2", 1200, 60, "双线分割线", "双线", ["分割线", "双线", "简约", "清新"]),
    ("scallop", "morandi", "c4", 1200, 100, "扇贝分割线", "扇贝", ["分割线", "扇贝", "花边", "莫兰迪"]),
    ("zigzag", "kraft", "c3", 1240, 80, "锯齿分割线", "锯齿", ["分割线", "锯齿", "复古", "手作"]),
    ("star", "fresh", "c3", 1260, 110, "星月分割线", "星月", ["分割线", "星星", "月亮", "梦幻"]),
    ("floral", "macaron", "c1", 1280, 130, "小花分割线", "花卉", ["分割线", "小花", "田园", "少女"]),
    ("stitch", "kraft", "c1", 1240, 90, "缝线分割线", "缝线", ["分割线", "缝线", "手作", "复古"]),
    ("leaf", "fresh", "c1", 1280, 120, "藤叶分割线", "藤叶", ["分割线", "藤叶", "自然", "植物"]),
    ("dotted_heart", "macaron", "c1", 1240, 100, "爱心分割线", "爱心", ["分割线", "爱心", "甜美", "少女"]),
    ("ribbon", "morandi", "c1", 1240, 90, "缎带分割线", "缎带", ["分割线", "缎带", "优雅", "莫兰迪"]),
]


def gen_divider(builder):
    for code, pal, ckey, w, h, name, shape_zh, tags in DIVIDER_SPECS:
        iid = "divider_%s_%s_01" % (code, pal)
        rng = random.Random(item_seed(iid))
        img = _divider_render(code, pal, w, h, rng, ckey)
        dom = _dominant_of(img, palette_color(pal, 0))
        desc = "%s：%d×%d 横向分割，alpha 透明底" % (name, w, h)
        builder.add(iid, name, "divider", tags + [PALETTES[pal]["zh"], shape_zh], img, dom, desc, alpha=True)


def _divider_render(code, pal, w, h, rng, ckey=None):
    p = PALETTES[pal]
    colors = variant_colors(pal, rng, 3, hue_span=0.05, val_span=0.10, key=ckey)
    colors = [hsv_shift(c, ds=0.34, dv=-0.16) for c in colors]   # 分隔线更实，缩略图也看得清
    c1, c2, c3 = colors
    ink = p["ink"]
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")
    cy = h / 2.0
    if code == "dashed":
        dash, gap, lw = 46, 26, max(7, h // 7)
        x = 0
        while x < w:
            d.line([(x, cy), (min(w, x + dash), cy)], fill=rgba(c1, 242), width=lw)
            x += dash + gap
        d.line([(0, cy), (w, cy)], fill=rgba(c1, 90), width=max(2, lw // 3))
    elif code == "wave":
        for row in range(3):
            col = rgba([c1, c2, c3][row], 215 - row * 40)
            amp = h * (0.20 - row * 0.04)
            period = w / (7.0 + row * 2)
            pts = [(x, cy + amp * math.sin(x / period * 2 * math.pi + row * 1.2)) for x in range(0, w + 4, 5)]
            d.line(pts, fill=col, width=max(4, int(h * 0.09)), joint="curve")
    elif code == "lace":
        r = h * 0.32
        d.line([(0, cy), (w, cy)], fill=rgba(c1, 210), width=max(4, int(h * 0.07)))
        x = r
        while x < w:
            d.arc([x - r, cy - r, x + r, cy + r], 180, 360, fill=rgba(c1, 215), width=max(4, int(h * 0.06)))
            d.ellipse([x - r * 0.18, cy - r * 0.18, x + r * 0.18, cy + r * 0.18], fill=rgba(c2, 220))
            d.arc([x - r, cy - r, x + r, cy + r], 0, 180, fill=rgba(c2, 140), width=max(3, int(h * 0.05)))
            x += r * 2
    elif code == "dots":
        r = h * 0.16
        step = r * 3.2
        x = r
        i = 0
        while x < w:
            col = c1 if i % 2 == 0 else c2
            rr = r if i % 2 == 0 else r * 0.62
            d.ellipse([x - rr, cy - rr, x + rr, cy + rr], fill=rgba(col, 235))
            x += step
            i += 1
    elif code == "tape_tear":
        tile = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        dt = ImageDraw.Draw(tile, "RGBA")
        dt.rectangle([0, h * 0.16, w, h * 0.84], fill=rgba(c1, 225))
        step = int(h * 0.5)
        x = -w
        while x < w * 2:
            dt.line([(x, h * 0.84), (x + h * 0.72, h * 0.16)], fill=rgba("#ffffff", 60), width=max(3, step // 3))
            x += step * 2
        cov = tear_coverage(w, h, rng, end_depth=(0.10, 0.30), edge_depth=(0.0, 0.0), periodic=0.0)
        a = np.array(tile.getchannel("A"), dtype=np.float32) * cov
        tile.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "L"))
        img.alpha_composite(tile)
        return img
    elif code == "double":
        d.line([(0, cy - h * 0.16), (w, cy - h * 0.16)], fill=rgba(c1, 220), width=max(3, int(h * 0.09)))
        d.line([(0, cy + h * 0.16), (w, cy + h * 0.16)], fill=rgba(c1, 220), width=max(3, int(h * 0.09)))
        d.line([(0, cy), (w, cy)], fill=rgba(c2, 150), width=max(2, int(h * 0.04)))
        for x in range(0, w, int(w * 0.12)):
            d.ellipse([x - h * 0.07, cy - h * 0.07, x + h * 0.07, cy + h * 0.07], fill=rgba(c3, 190))
    elif code == "scallop":
        r = h * 0.30
        x = 0
        while x < w + r:
            d.arc([x - r, cy - r, x + r, cy + r], 180, 360, fill=rgba(c1, 225), width=max(4, int(h * 0.10)))
            x += r * 1.8
        d.line([(0, cy), (w, cy)], fill=rgba(c2, 150), width=max(3, int(h * 0.05)))
    elif code == "zigzag":
        pts = []
        step = h * 0.5
        x = 0
        i = 0
        while x <= w:
            pts.append((x, cy - step * 0.6 if i % 2 else cy + step * 0.6))
            x += step
            i += 1
        d.line(pts, fill=rgba(c1, 230), width=max(4, int(h * 0.09)), joint="curve")
    elif code == "star":
        n = 9
        for i in range(n):
            cx = w * (i + 0.5) / n
            s = h * 0.24 * (0.75 + 0.35 * ((i % 3) / 2.0))
            if i % 3 == 1:
                _draw_moon(d, cx, cy, s, rgba(c2, 235))
            else:
                _draw_star(d, cx, cy, s, rgba(c1 if i % 2 == 0 else c3, 235), 5)
        d.line([(0, cy), (w, cy)], fill=rgba(c1, 90), width=max(2, int(h * 0.05)))
    elif code == "floral":
        n = 6
        for i in range(n):
            cx = w * (i + 0.5) / n
            r = h * 0.22
            _draw_flower(d, cx, cy, r, c1 if i % 2 == 0 else c2, c3)
            d.line([(cx + r * 1.4, cy), (w * (i + 1) / n, cy)], fill=rgba(c2, 130), width=max(2, int(h * 0.04)))
        d.line([(0, cy), (w, cy)], fill=rgba(c2, 110), width=max(2, int(h * 0.04)))
    elif code == "stitch":
        d.line([(0, cy), (w, cy)], fill=rgba(shade(c1, 0.85), 120), width=max(2, int(h * 0.03)))
        dash, gap = h * 0.62, h * 0.42
        x = 0
        i = 0
        while x < w:
            d.line([(x, cy - h * 0.18), (x + dash, cy + h * 0.18)], fill=rgba(c1, 235), width=max(3, int(h * 0.07)))
            x += dash + gap
            i += 1
    elif code == "leaf":
        x = h * 0.5
        while x < w:
            for sgn in (1, -1):
                _draw_leaf(d, x, cy + sgn * h * 0.20, h * 0.20, c1 if sgn > 0 else c2)
            x += h * 0.52
        d.line([(0, cy), (w, cy)], fill=rgba(shade(c1, 0.8), 200), width=max(3, int(h * 0.06)))
    elif code == "dotted_heart":
        n = 11
        for i in range(n):
            cx = w * (i + 0.5) / n
            r = h * 0.26 if i % 2 == 0 else h * 0.18
            pts = _heart_pts(cx, cy, r)
            d.polygon(pts, fill=rgba(c1 if i % 2 == 0 else c2, 235))
        d.line([(0, cy), (w, cy)], fill=rgba(c2, 90), width=max(2, int(h * 0.04)))
    elif code == "ribbon":
        d.rounded_rectangle([0, cy - h * 0.22, w, cy + h * 0.22], radius=h * 0.2, fill=rgba(c1, 215))
        for x in range(0, int(w), int(h * 0.42)):
            d.line([(x, cy + h * 0.22), (x + h * 0.30, cy - h * 0.22)], fill=rgba("#ffffff", 60),
                   width=max(2, int(h * 0.08)))
        d.line([(0, cy - h * 0.10), (w, cy - h * 0.10)], fill=rgba("#ffffff", 70), width=max(2, int(h * 0.04)))
        for x in range(0, int(w), int(w * 0.1)):
            d.ellipse([x - h * 0.05, cy + h * 0.10, x + h * 0.05, cy + h * 0.20], fill=rgba(c3, 170))
    return img


# --------------------------------------------------------------------------- #
# 6) stamp —— 印章邮戳（做旧斑驳）
# --------------------------------------------------------------------------- #

STAMP_SPECS = [
    ("post", "kraft", "c1", 420, "圆形邮戳", "邮戳", ["印章", "邮戳", "圆形", "复古"],
     ["2026.09.30", "JOURNAL POST", "SHANGHAI"]),
    ("post", "fresh", "c4", 400, "蓝绿邮戳", "邮戳", ["印章", "邮戳", "蓝绿", "清新"],
     ["POST", "2026", "AIR MAIL"]),
    ("post", "morandi", "c3", 400, "灰色邮戳", "邮戳", ["印章", "邮戳", "灰", "莫兰迪"],
     ["MORANDI", "2026.09", "NO.01"]),
    ("square", "kraft", "c3", 400, "方形邮戳", "方戳", ["印章", "方形", "复古", "牛皮"],
     ["已阅", "2026.09.30", "JOURNAL"]),
    ("square", "fresh", "c4", 380, "方形日期戳", "方戳", ["印章", "方形", "日期", "清新"],
     ["日期", "2026.09.30", "记录"]),
    ("date", "morandi", "c3", 360, "日期戳", "日期戳", ["印章", "日期", "打卡", "莫兰迪"],
     ["2026", "09", "30"]),
    ("date", "macaron", "c1", 360, "粉色日期戳", "日期戳", ["印章", "日期", "粉色", "少女"],
     ["SEP", "30", "2026"]),
    ("round_text", "fresh", "c4", 400, "圆形文字章", "文字章", ["印章", "圆形", "文字", "清新"],
     ["手账日常", "记录生活", "JOURNAL"]),
    ("text", "kraft", "c3", 420, "文字印章", "文字章", ["印章", "文字", "复古", "手作"],
     ["今日份", "手工制作", ""]),
    ("text", "macaron", "c1", 400, "可爱文字章", "文字章", ["印章", "文字", "可爱", "少女"],
     ["已完成", "打卡成功", ""]),
    ("approve", "fresh", "c1", 380, "确认印章", "确认章", ["印章", "确认", "完成", "清新"],
     ["已完成", "2026.09.30", "DONE"]),
    ("airmail", "morandi", "c5", 420, "航空邮戳", "邮戳", ["印章", "航空", "邮戳", "复古"],
     ["AIR MAIL", "PAR AVION", "2026"]),
]


def gen_stamp(builder):
    for code, pal, ckey, size, name, shape_zh, tags, texts in STAMP_SPECS:
        iid = "stamp_%s_%s_01" % (code, pal)
        rng = random.Random(item_seed(iid))
        img = _stamp_render(code, pal, size, rng, texts, ckey)
        dom = _dominant_of(img, palette_color(pal, 0))
        desc = "%s：%d×%d，做旧斑驳墨迹" % (name, size, size)
        builder.add(iid, name, "stamp", tags + [PALETTES[pal]["zh"], shape_zh], img, dom, desc, alpha=True)


def _stamp_ink(pal, rng, ckey=None):
    """印章墨色：比调色板深一点，像真的油墨。"""
    ink = PALETTES[pal]["ink"]
    keys = ("c1", "c2", "c3", "c4", "c5")
    base = PALETTES[pal][ckey] if ckey in keys else palette_color(pal, rng.randrange(5))
    return shade(mix(base, ink, 0.55), rng.uniform(0.78, 0.94))


def _stamp_render(code, pal, size, rng, texts, ckey=None):
    ss = 2
    S = size * ss
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    col = _stamp_ink(pal, rng, ckey)
    lw = max(3, int(S * 0.018))
    cx = cy = S / 2.0
    if code == "post" or code == "airmail":
        R = S * 0.45
        d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=rgba(col, 255), width=lw)
        d.ellipse([cx - R * 0.86, cy - R * 0.86, cx + R * 0.86, cy + R * 0.86], outline=rgba(col, 255),
                  width=max(2, lw // 2))
        _arc_text(d, cx, cy, R * 0.72, texts[0], col, S, top=True)
        _arc_text(d, cx, cy, R * 0.72, texts[1], col, S, top=False)
        font = fit_font(d, texts[2], R * 1.25, R * 0.45, start=int(S * 0.12))
        draw_text_center(d, cx, cy, texts[2], font, rgba(col, 255))
        if code == "airmail":
            for k in (-1, 1):
                d.line([(cx + k * R * 0.30, cy - R * 0.88), (cx + k * R * 0.30, cy + R * 0.88)],
                       fill=rgba(col, 200), width=max(2, lw // 2))
    elif code == "square":
        m = S * 0.08
        d.rectangle([m, m, S - m, S - m], outline=rgba(col, 255), width=lw)
        d.rectangle([m + lw * 1.6, m + lw * 1.6, S - m - lw * 1.6, S - m - lw * 1.6],
                    outline=rgba(col, 220), width=max(2, lw // 2))
        f1 = fit_font(d, texts[0], (S - 2 * m) * 0.62, (S - 2 * m) * 0.30, start=int(S * 0.22))
        draw_text_center(d, cx, cy - S * 0.12, texts[0], f1, rgba(col, 255))
        f2 = fit_font(d, texts[1], (S - 2 * m) * 0.72, (S - 2 * m) * 0.14, start=int(S * 0.09))
        draw_text_center(d, cx, cy + S * 0.09, texts[1], f2, rgba(col, 240))
        f3 = fit_font(d, texts[2], (S - 2 * m) * 0.55, (S - 2 * m) * 0.12, start=int(S * 0.08))
        draw_text_center(d, cx, cy + S * 0.26, texts[2], f3, rgba(col, 235))
        d.line([(m + lw * 2, cy + S * 0.17), (S - m - lw * 2, cy + S * 0.17)], fill=rgba(col, 200),
               width=max(2, lw // 3))
    elif code == "date":
        R = S * 0.45
        d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=rgba(col, 255), width=lw)
        d.line([(cx - R * 0.88, cy - R * 0.22), (cx + R * 0.88, cy - R * 0.22)], fill=rgba(col, 235),
               width=max(2, lw // 2))
        d.line([(cx - R * 0.88, cy + R * 0.30), (cx + R * 0.88, cy + R * 0.30)], fill=rgba(col, 235),
               width=max(2, lw // 2))
        fd = fit_font(d, texts[1], R * 0.92, R * 0.62, start=int(S * 0.34))
        draw_text_center(d, cx, cy + S * 0.04, texts[1], fd, rgba(col, 255))
        fs = fit_font(d, texts[0], R * 1.2, R * 0.26, start=int(S * 0.11))
        draw_text_center(d, cx, cy - S * 0.30, texts[0], fs, rgba(col, 240))
        ft = fit_font(d, texts[2], R * 1.2, R * 0.24, start=int(S * 0.10))
        draw_text_center(d, cx, cy + S * 0.32, texts[2], ft, rgba(col, 240))
    elif code == "round_text":
        R = S * 0.45
        d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=rgba(col, 255), width=lw)
        _arc_text(d, cx, cy, R * 0.74, texts[0], col, S, top=True)
        _arc_text(d, cx, cy, R * 0.74, texts[1], col, S, top=False)
        d.ellipse([cx - R * 0.42, cy - R * 0.42, cx + R * 0.42, cy + R * 0.42], outline=rgba(col, 220),
                  width=max(2, lw // 2))
        f = fit_font(d, texts[2], R * 0.78, R * 0.4, start=int(S * 0.10))
        draw_text_center(d, cx, cy, texts[2], f, rgba(col, 255))
    else:  # text / approve：圆角矩形文字章
        m = S * 0.07
        _rr(d, [m, S * 0.24, S - m, S * 0.76], S * 0.10, None, outline=rgba(col, 255), width=lw)
        if code == "approve":
            d.ellipse([S * 0.62, S * 0.30, S - m * 0.8, S * 0.70], outline=rgba(col, 235),
                      width=max(2, lw // 2))
            f2 = fit_font(d, "OK", S * 0.16, S * 0.24, start=int(S * 0.14))
            draw_text_center(d, S * 0.79, S * 0.50, "OK", f2, rgba(col, 245))
            f1 = fit_font(d, texts[0], S * 0.50, S * 0.26, start=int(S * 0.24))
            draw_text_center(d, S * 0.40, S * 0.44, texts[0], f1, rgba(col, 255))
            f3 = fit_font(d, texts[1], S * 0.50, S * 0.12, start=int(S * 0.09))
            draw_text_center(d, S * 0.40, S * 0.62, texts[1], f3, rgba(col, 230))
        else:
            f1 = fit_font(d, texts[0], S * 0.72, S * 0.28, start=int(S * 0.24))
            draw_text_center(d, cx, S * 0.42, texts[0], f1, rgba(col, 255))
            f2 = fit_font(d, texts[1], S * 0.66, S * 0.16, start=int(S * 0.11))
            draw_text_center(d, cx, S * 0.61, texts[1], f2, rgba(col, 235))
    # 做旧：随机擦除 + 斑驳
    arr = np.array(layer, dtype=np.uint8)
    a = arr[..., 3].astype(np.float32)
    n1 = noise_array(S, S, rng, 2)
    n2 = noise_array(S, S, rng, 5)
    spec = np.array([[rng.randrange(256) for _ in range(S // 8 + 2)] for _ in range(S // 8 + 2)], dtype=np.uint8)
    spec = np.asarray(Image.fromarray(spec, "L").resize((S, S), Image.BILINEAR), dtype=np.float32) / 255.0
    keep = (0.55 * n1 + 0.45 * n2)
    keep = np.clip((keep - 0.18) / 0.62, 0, 1)
    keep = np.where(keep < 0.30, 0.0, np.where(keep < 0.62, 0.55, 1.0))
    keep = keep * (0.55 + 0.45 * np.clip(spec * 1.4, 0, 1))
    a = a * keep
    # 少量白色缺口（墨迹未着）
    hole = np.zeros((S, S), dtype=bool)
    for _ in range(int(S * 0.7)):
        hx, hy = rng.randrange(S), rng.randrange(S)
        hr = rng.randint(2, max(3, int(S * 0.02)))
        hole[max(0, hy - hr):hy + hr, max(0, hx - hr):hx + hr] = True
    a = np.where(hole, a * 0.15, a)
    arr[..., 3] = np.clip(a, 0, 255).astype(np.uint8)
    out = Image.fromarray(arr, "RGBA").resize((size, size), Image.LANCZOS)
    return out


def _arc_text(d, cx, cy, R, text, col, S, top=True):
    """沿圆弧排布文字（邮戳外圈）。"""
    if not text or not text.strip():
        return
    font = fit_font(d, text, R * 1.35, R * 0.5, start=int(S * 0.11))
    try:
        total = d.textlength(text, font=font)
    except Exception:
        total = text_size(d, text, font)[0]
    span = min(math.pi * 0.85, (total / max(1.0, R)) * 1.05)
    n = max(1, len(text))
    for i, ch in enumerate(text):
        t = (i + 0.5) / n
        ang = -math.pi / 2 + (t - 0.5) * span if top else math.pi / 2 - (t - 0.5) * span
        px = cx + math.cos(ang) * R
        py = cy + math.sin(ang) * R
        try:
            box = d.textbbox((0, 0), ch, font=font)
            w, h = box[2] - box[0], box[3] - box[1]
        except Exception:
            w, h = font.getsize(ch)  # type: ignore[attr-defined]
        tile = Image.new("RGBA", (w + 8, h + 8), (0, 0, 0, 0))
        ImageDraw.Draw(tile).text((4 - box[0], 4 - box[1]), ch, font=font, fill=rgba(col, 255))
        # 上半圈文字向外翻转、下半圈向内翻转；rotate 为 PIL 的逆时针角度
        rot = math.degrees(ang) + 90.0 if top else math.degrees(ang) - 90.0
        tile = tile.rotate(-rot, expand=True, resample=Image.BICUBIC)
        d._image.alpha_composite(tile, (int(px - tile.width / 2), int(py - tile.height / 2)))


# --------------------------------------------------------------------------- #
# 7) title —— 标题底条 / 日期条 / 星期条
# --------------------------------------------------------------------------- #

TITLE_SPECS = [
    ("strip", "kraft", "c1", 1000, 180, "牛皮标题条", "底条", ["标题条", "牛皮", "复古", "标题"], "今日手账"),
    ("strip", "fresh", "c1", 1000, 180, "薄荷标题条", "底条", ["标题条", "薄荷", "清新", "标题"], "今日手账"),
    ("strip", "macaron", "c1", 1000, 180, "粉色标题条", "底条", ["标题条", "粉色", "少女", "标题"], "日记时间"),
    ("ribbon", "morandi", "c1", 1040, 200, "缎带标题条", "缎带", ["标题条", "缎带", "优雅", "标题"], "生活记录"),
    ("ribbon", "macaron", "c1", 1040, 200, "粉色缎带标题条", "缎带", ["标题条", "缎带", "粉色", "标题"], "小确幸"),
    ("round", "fresh", "c1", 960, 160, "圆角标题条", "圆角", ["标题条", "圆角", "简约", "标题"], "本周计划"),
    ("pennant", "kraft", "c2", 900, 200, "燕尾旗标题条", "燕尾旗", ["标题条", "旗帜", "复古", "标题"], "旅行记录"),
    ("date", "morandi", "c4", 900, 130, "日期条 2026.09.30", "日期条", ["日期条", "日期", "莫兰迪", "手账"], "2026.09.30"),
    ("date", "fresh", "c2", 900, 130, "蓝绿日期条", "日期条", ["日期条", "日期", "清新", "手账"], "SEP 30 2026"),
    ("week", "macaron", "c1", 880, 130, "星期条 星期五", "星期条", ["星期条", "星期", "粉色", "手账"], "星期五"),
    ("week", "fresh", "c1", 880, 130, "星期条 星期三", "星期条", ["星期条", "星期", "蓝绿", "手账"], "星期三"),
    ("plate", "kraft", "c1", 900, 240, "大写字牌", "字牌", ["字牌", "复古", "牛皮", "标题"], "JOURNAL"),
    ("plate", "morandi", "c3", 900, 240, "莫兰迪字牌", "字牌", ["字牌", "莫兰迪", "简约", "标题"], "NOTE"),
    ("stamp_title", "fresh", "c4", 920, 200, "印章风标题条", "印章风", ["标题条", "印章", "清新", "标题"], "目标清单"),
]


def gen_title(builder):
    for code, pal, ckey, w, h, name, shape_zh, tags, text in TITLE_SPECS:
        iid = "title_%s_%s_01" % (code, pal)
        rng = random.Random(item_seed(iid))
        img = _title_render(code, pal, w, h, rng, text, ckey)
        dom = _dominant_of(img, palette_color(pal, 0))
        desc = "%s：%d×%d，含中文文字「%s」" % (name, w, h, text)
        builder.add(iid, name, "title", tags + [PALETTES[pal]["zh"], shape_zh], img, dom, desc, alpha=True)


def _title_render(code, pal, w, h, rng, text, ckey=None):
    p = PALETTES[pal]
    colors = variant_colors(pal, rng, 3, hue_span=0.05, val_span=0.10, key=ckey)
    c1, c2, c3 = colors
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")
    m = h * 0.14
    ink_light = mix(p["ink"], "#ffffff", 0.35)
    if code == "strip":
        _rr(d, [m, m, w - m, h - m], h * 0.22, rgba(c1, 245))
        d.rectangle([m, h * 0.62, w - m, h - m - m * 0.4], fill=rgba(c2, 150))
        d.line([(m + w * 0.03, h * 0.46), (w - m - w * 0.03, h * 0.46)], fill=rgba("#ffffff", 90),
               width=max(2, int(h * 0.02)))
    elif code == "ribbon":
        _rr(d, [m + w * 0.02, m, w - m - w * 0.02, h - m], h * 0.14, rgba(c1, 245))
        tail = h * 0.34
        d.polygon([(m, h / 2 - (h - 2 * m) / 2), (m + w * 0.045, h / 2), (m, h / 2 + (h - 2 * m) / 2)],
                  fill=rgba(shade(c1, 0.85), 245))
        d.polygon([(w - m, h / 2 - (h - 2 * m) / 2), (w - m - w * 0.045, h / 2), (w - m, h / 2 + (h - 2 * m) / 2)],
                  fill=rgba(shade(c1, 0.85), 245))
        d.line([(m + w * 0.06, m + h * 0.18), (w - m - w * 0.06, m + h * 0.18)], fill=rgba("#ffffff", 80),
               width=max(2, int(h * 0.03)))
    elif code == "round":
        _rr(d, [m, m, w - m, h - m], (h - 2 * m) / 2.0, rgba(c1, 240))
        d.ellipse([m + h * 0.12, h * 0.30, m + h * 0.62, h * 0.70], fill=rgba(c2, 230))
        for i in range(3):
            d.ellipse([w - m - h * (0.30 + i * 0.16), h * 0.44, w - m - h * (0.22 + i * 0.16), h * 0.56],
                      fill=rgba(c3, 210))
    elif code == "pennant":
        body = w * 0.86
        d.polygon([(m, m), (m + body, m), (m + body - h * 0.3, h / 2), (m + body, h - m), (m, h - m)],
                  fill=rgba(c1, 245))
        d.polygon([(m, m), (m + body, m), (m + body, m + h * 0.16), (m, m + h * 0.16)],
                  fill=rgba(c2, 200))
        d.polygon([(m, m), (m + w * 0.05, h / 2), (m, h - m)], fill=rgba(shade(c1, 0.82), 245))
    elif code == "date":
        _rr(d, [m, h * 0.20, w - m, h * 0.80], h * 0.16, rgba(c1, 235))
        for x in range(int(m), int(w - m), max(6, int(h * 0.16))):
            d.line([(x, h * 0.20), (x - h * 0.2, h * 0.80)], fill=rgba("#ffffff", 45), width=max(2, int(h * 0.04)))
        d.line([(m, h * 0.5), (w - m, h * 0.5)], fill=rgba(c2, 120), width=max(2, int(h * 0.02)))
    elif code == "week":
        _rr(d, [m, h * 0.18, w - m, h * 0.82], h * 0.32, rgba(c1, 240))
        for i in range(2):
            d.ellipse([m + h * (0.18 + i * 0.34), h * 0.5 - h * 0.11, m + h * (0.40 + i * 0.34), h * 0.5 + h * 0.11],
                      fill=rgba(c2 if i == 0 else c3, 220))
        _draw_star(d, w - m - h * 0.32, h * 0.5, h * 0.13, rgba(c2, 230), 5)
    elif code == "plate":
        d.rectangle([m, m, w - m, h - m], fill=rgba(c1, 245), outline=rgba(shade(c1, 0.75), 255),
                    width=max(3, int(h * 0.035)))
        d.rectangle([m + h * 0.10, m + h * 0.10, w - m - h * 0.10, h - m - h * 0.10],
                    outline=rgba(c2, 200), width=max(2, int(h * 0.02)))
        for cx in (m + h * 0.34, w - m - h * 0.34):
            _draw_star(d, cx, h * 0.5, h * 0.11, rgba(c3, 235), 5)
    elif code == "stamp_title":
        _rr(d, [m, h * 0.16, w - m, h * 0.84], h * 0.10, None, outline=rgba(c1, 255), width=max(4, int(h * 0.05)))
        _rr(d, [m + h * 0.12, h * 0.24, w - m - h * 0.12, h * 0.76], h * 0.06, None,
            outline=rgba(c1, 200), width=max(2, int(h * 0.025)))
        for x in range(int(m), int(w - m), int(h * 0.22)):
            d.line([(x, h * 0.16), (x + h * 0.10, h * 0.84)], fill=rgba(c1, 40), width=max(2, int(h * 0.03)))
    # 文字
    if code == "date":
        box = [w * 0.10, h * 0.24, w * 0.90, h * 0.76]
    elif code == "plate":
        box = [w * 0.14, h * 0.26, w * 0.86, h * 0.74]
    elif code == "stamp_title":
        box = [w * 0.08, h * 0.28, w * 0.92, h * 0.72]
    else:
        box = [w * 0.07, h * 0.26, w * 0.93, h * 0.74]
    f = fit_font(d, text, box[2] - box[0], box[3] - box[1], start=int(h * 0.66), min_size=10)
    tcol = rgba(shade(c1, 0.42), 255)
    draw_text_center(d, (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0, text, f, tcol)
    return img


# --------------------------------------------------------------------------- #
# 8) icon —— 小图标
# --------------------------------------------------------------------------- #

ICON_SPECS = [
    ("tape_roll", "macaron", "c2", "胶带卷", "文具", ["图标", "胶带", "文具", "手账"]),
    ("scissors", "morandi", "c3", "剪刀", "文具", ["图标", "剪刀", "文具", "剪贴"]),
    ("pen", "fresh", "c1", "钢笔", "文具", ["图标", "钢笔", "书写", "文具"]),
    ("pencil", "kraft", "c2", "铅笔", "文具", ["图标", "铅笔", "书写", "文具"]),
    ("paperclip", "morandi", "c4", "回形针", "文具", ["图标", "回形针", "文具", "简约"]),
    ("coffee", "kraft", "c1", "咖啡杯", "生活", ["图标", "咖啡", "饮品", "生活"]),
    ("cloud", "fresh", "c2", "云朵", "天气", ["图标", "云", "天气", "天空"]),
    ("sun", "macaron", "c2", "太阳", "天气", ["图标", "太阳", "天气", "晴天"]),
    ("moon", "fresh", "c3", "月亮", "天气", ["图标", "月亮", "夜晚", "天气"]),
    ("star", "macaron", "c2", "星星", "装饰", ["图标", "星星", "装饰", "闪耀"]),
    ("heart", "macaron", "c1", "爱心", "装饰", ["图标", "爱心", "装饰", "甜美"]),
    ("camera", "morandi", "c3", "相机", "生活", ["图标", "相机", "拍照", "生活"]),
    ("book", "kraft", "c1", "书本", "学习", ["图标", "书", "阅读", "学习"]),
    ("clock", "fresh", "c1", "时钟", "生活", ["图标", "时钟", "时间", "生活"]),
    ("umbrella", "fresh", "c2", "雨伞", "天气", ["图标", "雨伞", "雨天", "天气"]),
    ("plane", "fresh", "c1", "纸飞机", "生活", ["图标", "纸飞机", "旅行", "梦想"]),
    ("pushpin", "macaron", "c1", "图钉", "文具", ["图标", "图钉", "固定", "文具"]),
    ("eraser", "morandi", "c1", "橡皮", "文具", ["图标", "橡皮", "文具", "修正"]),
    ("ruler", "kraft", "c2", "直尺", "文具", ["图标", "直尺", "测量", "文具"]),
    ("glue", "macaron", "c3", "胶水", "文具", ["图标", "胶水", "粘贴", "文具"]),
    ("note", "kraft", "c4", "便签", "文具", ["图标", "便签", "备忘", "文具"]),
    ("flower", "macaron", "c1", "花朵", "装饰", ["图标", "花朵", "装饰", "田园"]),
    ("mountain", "morandi", "c3", "山峦", "自然", ["图标", "山", "自然", "旅行"]),
    ("leaf", "fresh", "c1", "绿叶", "自然", ["图标", "叶子", "自然", "植物"]),
    ("letter", "kraft", "c4", "信封", "生活", ["图标", "信封", "信件", "复古"]),
    ("paint", "fresh", "c1", "调色盘", "装饰", ["图标", "调色盘", "画画", "创意"]),
]

INK_BASE = "#5b4d47"


def gen_icon(builder):
    for code, pal, ckey, name, kind_zh, tags in ICON_SPECS:
        iid = "icon_%s_%s_01" % (code, pal)
        rng = random.Random(item_seed(iid))
        size = rng.choice([160, 180, 200, 224, 256])
        img, dom = _icon_render(code, pal, size, rng, ckey)
        desc = "%s：%d×%d 双色图标，alpha 透明底" % (name, size, size)
        builder.add(iid, name, "icon", tags + [PALETTES[pal]["zh"], kind_zh], img, dom, desc, alpha=True)


def _icon_render(code, pal, size, rng, ckey=None):
    p = PALETTES[pal]
    colors = variant_colors(pal, rng, 2, hue_span=0.03, val_span=0.08, key=ckey)
    c1 = colors[0]
    c2 = hsv_shift(colors[1], dv=-0.14, ds=0.10)
    ink = mix(p["ink"], "#3a302b", 0.4)
    ss = 4
    S = size * ss
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")

    def P(*pts):
        return [(x * S, y * S) for x, y in pts]

    def E(box, fill=None, outline=None, width=0):
        d.ellipse([box[0] * S, box[1] * S, box[2] * S, box[3] * S], fill=fill, outline=outline, width=width)

    def R(box, r=0.08, fill=None, outline=None, width=0):
        d.rounded_rectangle([box[0] * S, box[1] * S, box[2] * S, box[3] * S], radius=r * S,
                            fill=fill, outline=outline, width=width)

    def L(pts, fill, width):
        d.line(P(*pts), fill=fill, width=int(width * S), joint="curve")

    lw = 0.028
    ol = int(lw * S * 1.9)
    if code == "tape_roll":
        E((0.16, 0.16, 0.84, 0.84), fill=rgba(ink, 255))
        E((0.18, 0.18, 0.82, 0.82), fill=rgba(c1, 255))
        E((0.36, 0.36, 0.64, 0.64), fill=(0, 0, 0, 0), outline=rgba(INK_BASE, 230), width=int(0.028 * S))
        L([(0.14, 0.16), (0.86, 0.36), (0.86, 0.50), (0.14, 0.30)], rgba(c2, 255), 0)
        d.polygon(P((0.86, 0.32), (0.99, 0.40), (0.86, 0.48)), fill=rgba(c2, 255))
        d.arc([0.24 * S, 0.24 * S, 0.76 * S, 0.76 * S], 200, 320, fill=rgba("#ffffff", 90), width=int(0.05 * S))
    elif code == "scissors":
        L([(0.20, 0.10), (0.72, 0.66)], rgba(ink, 255), lw * 2.2)
        L([(0.80, 0.10), (0.28, 0.66)], rgba(ink, 255), lw * 2.2)
        L([(0.20, 0.10), (0.72, 0.66)], rgba(c2, 255), lw * 1.2)
        L([(0.80, 0.10), (0.28, 0.66)], rgba(c1, 255), lw * 1.2)
        E((0.14, 0.62, 0.40, 0.88), fill=rgba(ink, 255))
        E((0.60, 0.62, 0.86, 0.88), fill=rgba(ink, 255))
        E((0.18, 0.66, 0.36, 0.84), fill=rgba(p["bg"], 255))
        E((0.64, 0.66, 0.82, 0.84), fill=rgba(p["bg"], 255))
        E((0.48, 0.44, 0.56, 0.52), fill=rgba("#ffffff", 200))
    elif code in ("pen", "pencil"):
        body = [(0.30, 0.72), (0.62, 0.16), (0.78, 0.26), (0.46, 0.82)]
        d.polygon(P(*body), fill=rgba(c1, 255))
        d.polygon(P((0.62, 0.16), (0.78, 0.26), (0.86, 0.20), (0.70, 0.10)), fill=rgba(c2, 255))
        d.polygon(P((0.30, 0.72), (0.46, 0.82), (0.40, 0.92), (0.24, 0.86)), fill=rgba(ink, 255))
        d.polygon(P((0.30, 0.84), (0.36, 0.88), (0.30, 0.94)), fill=rgba("#4a4038", 255))
        L([(0.34, 0.66), (0.70, 0.22)], rgba("#ffffff", 110), lw * 0.8)
        if code == "pen":
            L([(0.66, 0.30), (0.78, 0.38)], rgba(ink, 200), lw * 0.5)
    elif code == "paperclip":
        d.arc([0.28 * S, 0.30 * S, 0.64 * S, 0.92 * S], 0, 360, fill=rgba(ink, 255), width=int(lw * 2.2 * S))
        d.arc([0.30 * S, 0.32 * S, 0.62 * S, 0.90 * S], 0, 360, fill=rgba(c2, 255), width=int(lw * 1.1 * S))
        d.arc([0.46 * S, 0.10 * S, 0.80 * S, 0.70 * S], 0, 360, fill=rgba(ink, 255), width=int(lw * 2.2 * S))
        d.arc([0.48 * S, 0.12 * S, 0.78 * S, 0.68 * S], 0, 360, fill=rgba(c1, 255), width=int(lw * 1.1 * S))
    elif code == "coffee":
        R((0.20, 0.30, 0.70, 0.84), 0.06, fill=rgba(ink, 255))
        R((0.22, 0.32, 0.68, 0.82), 0.05, fill=rgba(c1, 255))
        d.arc([0.60 * S, 0.38 * S, 0.92 * S, 0.74 * S], -80, 90, fill=rgba(ink, 255), width=int(lw * 1.8 * S))
        d.arc([0.62 * S, 0.40 * S, 0.90 * S, 0.72 * S], -80, 90, fill=rgba(c1, 255), width=int(lw * 0.9 * S))
        for i, x in enumerate((0.34, 0.46, 0.58)):
            d.arc([(x - 0.06) * S, 0.16 * S, (x + 0.06) * S, 0.30 * S], 90, 270,
                  fill=rgba(c2, 220), width=int(lw * 0.9 * S))
        L([(0.24, 0.44), (0.66, 0.44)], rgba("#ffffff", 90), lw * 0.9)
    elif code == "cloud":
        E((0.16, 0.42, 0.52, 0.78), fill=rgba(ink, 255))
        E((0.34, 0.28, 0.72, 0.66), fill=rgba(ink, 255))
        E((0.52, 0.42, 0.88, 0.78), fill=rgba(ink, 255))
        R((0.18, 0.56, 0.86, 0.80), 0.10, fill=rgba(ink, 255))
        E((0.19, 0.45, 0.49, 0.75), fill=rgba(c1, 255))
        E((0.36, 0.31, 0.70, 0.63), fill=rgba(c1, 255))
        E((0.55, 0.45, 0.85, 0.75), fill=rgba(c1, 255))
        R((0.21, 0.58, 0.83, 0.77), 0.09, fill=rgba(c1, 255))
        E((0.30, 0.36, 0.52, 0.52), fill=rgba("#ffffff", 110))
    elif code == "sun":
        E((0.28, 0.28, 0.72, 0.72), fill=rgba(ink, 255))
        E((0.30, 0.30, 0.70, 0.70), fill=rgba(c1, 255))
        for k in range(8):
            a = math.pi * 2 * k / 8.0
            x1, y1 = 0.5 + math.cos(a) * 0.30, 0.5 + math.sin(a) * 0.30
            x2, y2 = 0.5 + math.cos(a) * 0.44, 0.5 + math.sin(a) * 0.44
            L([(x1, y1), (x2, y2)], rgba(ink, 255), lw * 1.8)
            L([(x1, y1), (x2, y2)], rgba(c2, 255), lw * 0.8)
        E((0.38, 0.36, 0.50, 0.48), fill=rgba("#ffffff", 120))
    elif code == "moon":
        E((0.22, 0.18, 0.80, 0.84), fill=rgba(ink, 255))
        E((0.24, 0.20, 0.78, 0.82), fill=rgba(c1, 255))
        cut = Image.new("L", (S, S), 0)
        ImageDraw.Draw(cut).ellipse([0.40 * S, 0.10 * S, 0.98 * S, 0.76 * S], fill=255)
        layer = Image.composite(Image.new("RGBA", (S, S), (0, 0, 0, 0)), layer, cut)
        d = ImageDraw.Draw(layer, "RGBA")
        for cx, cy, r in ((0.36, 0.40, 0.05), (0.46, 0.58, 0.035), (0.30, 0.62, 0.03)):
            E((cx - r, cy - r, cx + r, cy + r), fill=rgba(c2, 180))
        _draw_star(d, 0.80 * S, 0.24 * S, 0.07 * S, rgba(c2, 240), 4)
    elif code == "star":
        d.polygon(P(*_star_norm(0.5, 0.5, 0.44)), fill=rgba(ink, 255))
        d.polygon(P(*_star_norm(0.5, 0.5, 0.39)), fill=rgba(c1, 255))
        d.polygon(P(*_star_norm(0.42, 0.42, 0.16)), fill=rgba("#ffffff", 90))
    elif code == "heart":
        d.polygon(P(*_heart_norm(0.5, 0.52, 0.42)), fill=rgba(ink, 255))
        d.polygon(P(*_heart_norm(0.5, 0.52, 0.37)), fill=rgba(c1, 255))
        d.polygon(P(*_heart_norm(0.40, 0.42, 0.13)), fill=rgba("#ffffff", 90))
    elif code == "camera":
        R((0.12, 0.30, 0.88, 0.82), 0.07, fill=rgba(ink, 255))
        R((0.14, 0.32, 0.86, 0.80), 0.06, fill=rgba(c1, 255))
        R((0.34, 0.20, 0.66, 0.34), 0.03, fill=rgba(ink, 255))
        R((0.36, 0.22, 0.64, 0.33), 0.02, fill=rgba(c2, 255))
        E((0.34, 0.40, 0.66, 0.72), fill=rgba(ink, 255))
        E((0.37, 0.43, 0.63, 0.69), fill=rgba(p["bg"], 255))
        E((0.42, 0.48, 0.58, 0.64), fill=rgba(c2, 255))
        E((0.75, 0.38, 0.82, 0.45), fill=rgba("#ffffff", 190))
    elif code == "book":
        d.polygon(P((0.14, 0.20), (0.50, 0.28), (0.50, 0.86), (0.14, 0.78)), fill=rgba(ink, 255))
        d.polygon(P((0.86, 0.20), (0.50, 0.28), (0.50, 0.86), (0.86, 0.78)), fill=rgba(ink, 255))
        d.polygon(P((0.17, 0.23), (0.48, 0.30), (0.48, 0.82), (0.17, 0.75)), fill=rgba(c1, 255))
        d.polygon(P((0.83, 0.23), (0.52, 0.30), (0.52, 0.82), (0.83, 0.75)), fill=rgba(c2, 255))
        for k in range(3):
            L([(0.22, 0.35 + k * 0.12), (0.44, 0.39 + k * 0.12)], rgba("#ffffff", 110), lw * 0.5)
            L([(0.56, 0.39 + k * 0.12), (0.78, 0.35 + k * 0.12)], rgba("#ffffff", 90), lw * 0.5)
    elif code == "clock":
        E((0.12, 0.12, 0.88, 0.88), fill=rgba(ink, 255))
        E((0.15, 0.15, 0.85, 0.85), fill=rgba(p["bg"], 255))
        E((0.15, 0.15, 0.85, 0.85), outline=rgba(c1, 255), width=int(lw * 1.6 * S))
        for k in range(12):
            a = math.pi * 2 * k / 12.0
            x1, y1 = 0.5 + math.cos(a) * 0.30, 0.5 + math.sin(a) * 0.30
            x2, y2 = 0.5 + math.cos(a) * 0.34, 0.5 + math.sin(a) * 0.34
            L([(x1, y1), (x2, y2)], rgba(ink, 190), lw * 0.35)
        L([(0.5, 0.5), (0.5, 0.26)], rgba(ink, 255), lw * 1.1)
        L([(0.5, 0.5), (0.70, 0.60)], rgba(c2, 255), lw * 0.9)
        E((0.46, 0.46, 0.54, 0.54), fill=rgba(ink, 255))
    elif code == "umbrella":
        d.pieslice([0.08 * S, 0.24 * S, 0.92 * S, 1.00 * S], 180, 360, fill=rgba(ink, 255))
        d.pieslice([0.11 * S, 0.27 * S, 0.89 * S, 0.97 * S], 180, 360, fill=rgba(c1, 255))
        for k in range(1, 4):
            x = 0.5 - 0.2 * k
            d.pieslice([(0.5 + (x - 0.5) * 1.25) * S, 0.27 * S, (0.5 + (x - 0.5) * 0.75) * S, 0.97 * S],
                       180, 360, fill=rgba(c2, 220))
        L([(0.5, 0.30), (0.5, 0.84)], rgba(ink, 255), lw * 1.4)
        d.arc([0.50 * S, 0.72 * S, 0.74 * S, 0.94 * S], 0, 180, fill=rgba(ink, 255), width=int(lw * 1.4 * S))
        R((0.42, 0.16, 0.58, 0.26), 0.04, fill=rgba(ink, 255))
    elif code == "plane":
        d.polygon(P((0.10, 0.52), (0.90, 0.16), (0.56, 0.86), (0.44, 0.58)), fill=rgba(ink, 255))
        d.polygon(P((0.13, 0.51), (0.87, 0.19), (0.55, 0.83), (0.45, 0.57)), fill=rgba(c1, 255))
        d.polygon(P((0.13, 0.51), (0.45, 0.57), (0.55, 0.83)), fill=rgba(c2, 255))
        L([(0.20, 0.80), (0.36, 0.84)], rgba(c2, 200), lw * 0.5)
        L([(0.26, 0.88), (0.44, 0.92)], rgba(c2, 150), lw * 0.4)
    elif code == "pushpin":
        d.polygon(P((0.36, 0.20), (0.64, 0.20), (0.58, 0.44), (0.42, 0.44)), fill=rgba(ink, 255))
        d.polygon(P((0.38, 0.22), (0.62, 0.22), (0.57, 0.43), (0.43, 0.43)), fill=rgba(c1, 255))
        R((0.28, 0.42, 0.72, 0.56), 0.06, fill=rgba(ink, 255))
        R((0.30, 0.44, 0.70, 0.55), 0.05, fill=rgba(c2, 255))
        d.polygon(P((0.45, 0.55), (0.55, 0.55), (0.52, 0.88), (0.48, 0.88)), fill=rgba(ink, 255))
        d.polygon(P((0.47, 0.56), (0.53, 0.56), (0.51, 0.86), (0.49, 0.86)), fill=rgba("#b9b2ab", 255))
    elif code == "eraser":
        d.polygon(P((0.16, 0.62), (0.62, 0.16), (0.86, 0.38), (0.40, 0.84)), fill=rgba(ink, 255))
        d.polygon(P((0.19, 0.61), (0.62, 0.19), (0.83, 0.38), (0.40, 0.81)), fill=rgba(c1, 255))
        d.polygon(P((0.16, 0.62), (0.40, 0.84), (0.20, 0.86)), fill=rgba(c2, 255))
        d.polygon(P((0.55, 0.26), (0.70, 0.40), (0.56, 0.54), (0.41, 0.40)), fill=rgba("#ffffff", 70))
    elif code == "ruler":
        R((0.10, 0.36, 0.90, 0.62), 0.05, fill=rgba(ink, 255))
        R((0.12, 0.38, 0.88, 0.60), 0.04, fill=rgba(c1, 255))
        for k in range(9):
            x = 0.16 + k * 0.085
            hh = 0.16 if k % 2 == 0 else 0.09
            L([(x, 0.40), (x, 0.40 + hh)], rgba(ink, 210), lw * 0.35)
        L([(0.14, 0.55), (0.86, 0.55)], rgba(c2, 130), lw * 0.5)
    elif code == "glue":
        R((0.34, 0.30, 0.66, 0.86), 0.08, fill=rgba(ink, 255))
        R((0.36, 0.32, 0.64, 0.84), 0.07, fill=rgba(c2, 255))
        d.polygon(P((0.40, 0.30), (0.60, 0.30), (0.56, 0.14), (0.44, 0.14)), fill=rgba(ink, 255))
        d.polygon(P((0.42, 0.29), (0.58, 0.29), (0.55, 0.16), (0.45, 0.16)), fill=rgba(c1, 255))
        R((0.42, 0.44, 0.58, 0.72), 0.04, fill=rgba("#ffffff", 120))
        L([(0.40, 0.62), (0.60, 0.62)], rgba(c1, 200), lw * 0.4)
    elif code == "note":
        d.polygon(P((0.20, 0.14), (0.80, 0.14), (0.80, 0.70), (0.62, 0.88), (0.20, 0.88)), fill=rgba(ink, 255))
        d.polygon(P((0.22, 0.16), (0.78, 0.16), (0.78, 0.69), (0.61, 0.86), (0.22, 0.86)), fill=rgba(c1, 255))
        d.polygon(P((0.62, 0.69), (0.78, 0.69), (0.62, 0.86)), fill=rgba(c2, 255))
        for k in range(4):
            L([(0.30, 0.30 + k * 0.13), (0.70, 0.30 + k * 0.13)], rgba(ink, 120), lw * 0.35)
    elif code == "flower":
        for k in range(6):
            a = math.pi * 2 * k / 6.0
            cx, cy = 0.5 + math.cos(a) * 0.20, 0.5 + math.sin(a) * 0.20
            E((cx - 0.20, cy - 0.20, cx + 0.20, cy + 0.20), fill=rgba(ink, 255))
            E((cx - 0.17, cy - 0.17, cx + 0.17, cy + 0.17), fill=rgba(c1 if k % 2 == 0 else c2, 255))
        E((0.36, 0.36, 0.64, 0.64), fill=rgba(ink, 255))
        E((0.39, 0.39, 0.61, 0.61), fill=rgba("#f6d98a", 255))
    elif code == "mountain":
        d.polygon(P((0.08, 0.80), (0.40, 0.30), (0.66, 0.80)), fill=rgba(ink, 255))
        d.polygon(P((0.10, 0.79), (0.40, 0.33), (0.64, 0.79)), fill=rgba(c1, 255))
        d.polygon(P((0.40, 0.33), (0.50, 0.47), (0.30, 0.47)), fill=rgba("#ffffff", 160))
        d.polygon(P((0.46, 0.80), (0.72, 0.42), (0.94, 0.80)), fill=rgba(ink, 255))
        d.polygon(P((0.48, 0.79), (0.72, 0.45), (0.92, 0.79)), fill=rgba(c2, 255))
        d.polygon(P((0.72, 0.45), (0.80, 0.57), (0.64, 0.57)), fill=rgba("#ffffff", 140))
    elif code == "leaf":
        pts = [(0.5 + math.cos(math.pi * t) * 0.0, 0.0) for t in (0,)]
        outline = []
        for k in range(0, 21):
            t = k / 20.0
            outline.append((0.14 + 0.72 * t, 0.50 - 0.34 * math.sin(math.pi * t)))
        for k in range(20, -1, -1):
            t = k / 20.0
            outline.append((0.14 + 0.72 * t, 0.50 + 0.30 * math.sin(math.pi * t)))
        d.polygon(P(*outline), fill=rgba(ink, 255))
        outline2 = [(x * 0.94 + 0.03, 0.50 + (y - 0.50) * 0.86) for x, y in outline]
        d.polygon(P(*outline2), fill=rgba(c1, 255))
        L([(0.18, 0.50), (0.84, 0.50)], rgba(ink, 220), lw * 1.1)
        for k in range(1, 6):
            x = 0.2 + k * 0.12
            L([(x, 0.50), (x + 0.06, 0.36)], rgba(c2, 200), lw * 0.35)
            L([(x, 0.50), (x + 0.06, 0.64)], rgba(c2, 200), lw * 0.35)
    elif code == "letter":
        R((0.10, 0.24, 0.90, 0.76), 0.04, fill=rgba(ink, 255))
        R((0.12, 0.26, 0.88, 0.74), 0.03, fill=rgba(c1, 255))
        d.polygon(P((0.12, 0.27), (0.50, 0.54), (0.88, 0.27)), fill=rgba(c2, 255))
        d.polygon(P((0.12, 0.27), (0.50, 0.51), (0.50, 0.54)), fill=rgba(shade(c2, 0.9), 255))
        L([(0.14, 0.72), (0.42, 0.50)], rgba(ink, 120), lw * 0.35)
        L([(0.86, 0.72), (0.58, 0.50)], rgba(ink, 120), lw * 0.35)
    elif code == "paint":
        E((0.10, 0.10, 0.90, 0.90), fill=rgba(ink, 255))
        E((0.13, 0.13, 0.87, 0.87), fill=rgba(p["bg"], 255))
        for k, (dx, dy) in enumerate(((0.32, 0.30), (0.62, 0.28), (0.70, 0.58), (0.36, 0.66), (0.50, 0.46))):
            col = [c1, c2, p["accent"], mix(c1, c2, 0.5), "#f6d98a"][k]
            E((dx - 0.11, dy - 0.11, dx + 0.11, dy + 0.11), fill=rgba(col, 255))
        E((0.66, 0.62, 0.92, 0.92), fill=rgba(ink, 255))
        E((0.69, 0.65, 0.89, 0.89), fill=rgba(p["bg"], 255))
    content = layer.resize((size, size), Image.LANCZOS)
    a = alpha_mask(content)
    key = np.clip((np.asarray(Image.fromarray(dilate_np(a, ss), "L")
                              .filter(ImageFilter.GaussianBlur(0.5)), dtype=np.float32) - 40.0) * 4.2, 0, 255)
    key_img = colorize(key, "#ffffff")
    shadow = drop_shadow(Image.fromarray(key.astype(np.uint8), "L"),
                         offset=(0, max(1, int(size * 0.016))), blur=max(2, size * 0.022), opacity=0.22)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(shadow)
    out.alpha_composite(key_img)
    out.alpha_composite(content)
    return out, _dominant_of(out, c1)


def _star_norm(cx, cy, r, points=5, inner=0.42):
    pts = []
    for k in range(points * 2):
        a = -math.pi / 2 + math.pi * k / points
        rr = r if k % 2 == 0 else r * inner
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    return pts


def _heart_norm(cx, cy, r, n=72):
    pts = []
    for i in range(n):
        t = math.pi * 2 * i / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * r / 16.0, cy - y * r / 16.0))
    return pts


# --------------------------------------------------------------------------- #
# manifest 与 CLI
# --------------------------------------------------------------------------- #

GENERATORS = {
    "paper": gen_paper,
    "tape": gen_tape,
    "sticker": gen_sticker,
    "frame": gen_frame,
    "divider": gen_divider,
    "stamp": gen_stamp,
    "title": gen_title,
    "icon": gen_icon,
}


def now_iso():
    now = datetime.datetime.now().astimezone()
    return now.replace(microsecond=0).isoformat()


def build_manifest(builder, generated_at, cats_done=None):
    items = builder.items
    cats = []
    for cid, cname in CATEGORY_META:
        if cats_done is not None and cid not in cats_done:
            continue
        n = sum(1 for it in items if it["cat"] == cid)
        cats.append({"id": cid, "name": cname, "count": n})
    return {
        "version": 1,
        "generated_at": generated_at,
        "generator": "make_materials.py",
        "categories": cats,
        "items": items,
    }


def write_manifest(manifest, out_dir):
    path = os.path.join(out_dir, "manifest.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    return path


def load_manifest(out_dir):
    path = os.path.join(out_dir, "manifest.json")
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def clean_category_dirs(out_dir):
    """只清理本工具管辖的分类目录、缩略图与 manifest。"""
    for cid, _ in CATEGORY_META:
        p = os.path.join(out_dir, cid)
        if os.path.isdir(p):
            shutil.rmtree(p)
    tp = os.path.join(out_dir, "thumbs")
    if os.path.isdir(tp):
        shutil.rmtree(tp)
    mp = os.path.join(out_dir, "manifest.json")
    if os.path.isfile(mp):
        os.remove(mp)


def generate(out_dir, only=None, clean=False):
    """执行生成，返回 (manifest, 生成文件数)。"""
    only = list(only) if only else [cid for cid, _ in CATEGORY_META]
    only = [c for c in only if c in GENERATORS]
    only_set = set(only)
    _ensure_dir(out_dir)
    prev = None
    if clean and set(only) == set(GENERATORS):
        clean_category_dirs(out_dir)
    else:
        prev = load_manifest(out_dir)
        for cid in only:
            d = os.path.join(out_dir, cid)
            if os.path.isdir(d):
                shutil.rmtree(d)
            td = os.path.join(out_dir, "thumbs", cid)
            if os.path.isdir(td):
                shutil.rmtree(td)
    builder = Builder(out_dir)
    for cid in only:
        GENERATORS[cid](builder)
    items = builder.items
    if prev and set(only) != set(GENERATORS):
        keep = [it for it in prev.get("items", []) if it.get("cat") not in only_set]
        # 保持固定顺序：按 CATEGORY_META 排列
        order = {cid: i for i, (cid, _) in enumerate(CATEGORY_META)}
        items = sorted(keep + items, key=lambda it: (order.get(it.get("cat"), 99), it.get("id", "")))
    manifest = build_manifest_items(items)
    path = write_manifest(manifest, out_dir)
    return manifest, len(items), path


def build_manifest_items(items):
    cats = []
    for cid, cname in CATEGORY_META:
        n = sum(1 for it in items if it["cat"] == cid)
        if n:
            cats.append({"id": cid, "name": cname, "count": n})
    return {
        "version": 1,
        "generated_at": now_iso(),
        "generator": "make_materials.py",
        "categories": cats,
        "items": items,
    }


def check_materials(out_dir, verbose=True):
    """只校验：manifest 存在、文件存在、尺寸一致、alpha 有透明像素、id 唯一。"""
    errs = []
    warns = []
    manifest = load_manifest(out_dir)
    if manifest is None:
        return ["找不到 manifest.json：%s" % out_dir], 0
    if manifest.get("version") != 1:
        errs.append("version != 1")
    counts = {}
    seen = set()
    for it in manifest.get("items", []):
        cid = it.get("cat")
        counts[cid] = counts.get(cid, 0) + 1
        iid = it.get("id", "")
        if iid in seen:
            errs.append("重复 id: %s" % iid)
        seen.add(iid)
        path = os.path.join(out_dir, it.get("file", "").replace("/", os.sep))
        thumb = os.path.join(out_dir, it.get("thumb", "").replace("/", os.sep))
        if not os.path.isfile(path):
            errs.append("缺文件: %s" % it.get("file"))
            continue
        if not os.path.isfile(thumb):
            errs.append("缺缩略图: %s" % it.get("thumb"))
        try:
            with Image.open(path) as im:
                w, h = im.size
                if (w, h) != (it.get("w"), it.get("h")):
                    errs.append("尺寸不一致 %s：manifest %s×%s，实际 %s×%s"
                                % (iid, it.get("w"), it.get("h"), w, h))
                if it.get("alpha"):
                    # 为了体积，PNG 会量化成带 transparency 的调色板图（模式 P），
                    # 它和 RGBA 一样有真实 alpha，转回 RGBA 后照样能查透明像素。
                    has_alpha = im.mode in ("RGBA", "LA", "PA") or (
                        im.mode == "P" and "transparency" in im.info)
                    if not has_alpha:
                        errs.append("alpha=true 但模式为 %s：%s" % (im.mode, iid))
                    else:
                        a = np.asarray(im.convert("RGBA").getchannel("A"))[::7, ::7]
                        if a.size and int(a.min()) >= 255:
                            errs.append("alpha=true 但没有透明像素：%s" % iid)
                else:
                    if im.mode != "RGB":
                        warns.append("alpha=false 但模式为 %s：%s" % (im.mode, iid))
                    if not path.lower().endswith(".jpg"):
                        warns.append("alpha=false 但不是 jpg：%s" % iid)
        except Exception as exc:
            errs.append("打不开 %s：%s" % (it.get("file"), exc))
    minimum = {"paper": 20, "tape": 24, "sticker": 36, "frame": 10,
               "divider": 12, "stamp": 10, "title": 12, "icon": 20}
    for cid, mn in minimum.items():
        if counts.get(cid, 0) < mn:
            errs.append("分类 %s 数量不足：%d < %d" % (cid, counts.get(cid, 0), mn))
    total = sum(counts.values())
    if total < 144:
        errs.append("素材总数不足：%d < 144" % total)
    if verbose:
        print("[check] 目录: %s" % out_dir)
        for cid, cname in CATEGORY_META:
            print("        %-8s %-6s %d" % (cid, cname, counts.get(cid, 0)))
        print("        合计 %d 个素材" % total)
        for w in warns:
            print("  [warn] %s" % w)
        if errs:
            for e in errs[:40]:
                print("  [错误] %s" % e)
        else:
            print("  [ok] manifest / 文件 / 尺寸 / alpha / id 全部通过")
    return errs, total


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):          # Windows 控制台保证 UTF-8 输出
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="Journal Studio 内置素材包生成器")
    ap.add_argument("--only", action="append", default=None,
                    help="只生成指定分类，可重复：--only tape --only icon")
    ap.add_argument("--out", default=DEFAULT_OUT, help="输出目录（默认 assets/materials）")
    ap.add_argument("--check", action="store_true", help="只校验不生成")
    ap.add_argument("--clean", action="store_true", help="先清空输出目录再全量生成")
    args = ap.parse_args(argv)

    out_dir = os.path.abspath(args.out)
    if args.check:
        errs, total = check_materials(out_dir)
        return 1 if errs else 0

    if args.only:
        bad = [c for c in args.only if c not in GENERATORS]
        if bad:
            print("未知分类：%s；可选：%s" % (", ".join(bad), ", ".join(GENERATORS)))
            return 2

    manifest, count, path = generate(out_dir, only=args.only, clean=args.clean)
    print("[生成] %d 个素材 -> %s" % (count, out_dir))
    for c in manifest["categories"]:
        print("        %-8s %-6s %d" % (c["id"], c["name"], c["count"]))
    print("[清单] %s" % path)
    errs, total = check_materials(out_dir)
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
