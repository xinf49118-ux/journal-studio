"""手账页面结构分析。

输入一张别人做的手账页面图片，输出：
- 背景色 / 是否素底
- 主配色（k-means 聚类 + 占比）
- 版面区块（连通域分割 + 形状启发式分类）
- 留白比例、整体风格判断
坐标一律用 0–1 归一化比例，原点左上，方便前端直接叠加与重排。
"""
from __future__ import annotations

import base64
import io
import math
from typing import Any

import numpy as np
from PIL import Image, ImageOps

ANALYSIS_MAX = 1024          # 分析用图的最长边
GRID_LONG = 96               # 连通域分割的网格长边
MIN_CELLS = 3                # 小于这么多格子的连通域丢弃
DIFF_THRESHOLD = 30.0        # 与背景色的 RGB 欧氏距离阈值
PREVIEW_MAX = 900            # 预览图最长边


# ---------------------------------------------------------------- 基础工具

def _load_rgb(data: bytes) -> Image.Image:
    """读入任意图片并统一成 RGB（透明区域铺白）。"""
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, (255, 255, 255))
        canvas.paste(rgba, mask=rgba.split()[-1])
        return canvas
    return img.convert("RGB")


def _data_uri(img: Image.Image, max_side: int = PREVIEW_MAX, quality: int = 80) -> str:
    small = img.copy()
    small.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    small.save(buf, format="JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _hex(rgb: np.ndarray | tuple[float, float, float]) -> str:
    r, g, b = (int(round(max(0, min(255, float(c))))) for c in rgb[:3])
    return "#%02x%02x%02x" % (r, g, b)


def _kmeans(pixels: np.ndarray, k: int, iters: int = 14, seed: int = 20260930) -> tuple[np.ndarray, np.ndarray]:
    """极简 k-means，返回 (中心点 (k,3), 每簇占比 (k,))。"""
    n = pixels.shape[0]
    if n == 0:
        return np.zeros((0, 3), dtype=np.float32), np.zeros((0,), dtype=np.float32)
    k = max(1, min(k, n))
    rng = np.random.default_rng(seed)
    # k-means++ 式初始化：先随机取一点，再按距离平方概率挑远点
    centers = [pixels[rng.integers(n)]]
    for _ in range(k - 1):
        d = np.min(((pixels[:, None, :] - np.array(centers)[None, :, :]) ** 2).sum(axis=2), axis=1)
        total = float(d.sum())
        centers.append(pixels[rng.integers(n)] if total <= 0 else pixels[int(rng.choice(n, p=d / total))])
    centers = np.array(centers, dtype=np.float32)
    labels = np.zeros(n, dtype=np.int32)
    for _ in range(iters):
        dist = ((pixels[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        new_labels = dist.argmin(axis=1)
        if np.array_equal(new_labels, labels):
            break
        labels = new_labels
        for i in range(k):
            sel = pixels[labels == i]
            if len(sel):
                centers[i] = sel.mean(axis=0)
    counts = np.bincount(labels, minlength=k).astype(np.float32)
    order = np.argsort(-counts)
    return centers[order], (counts[order] / max(1, n))


# ---------------------------------------------------------------- 版面分割

def _label_components(grid: np.ndarray) -> list[np.ndarray]:
    """8 连通域标记，返回每个连通域的 (行,列) 坐标数组。网格很小，纯 Python 也够快。"""
    h, w = grid.shape
    labels = np.zeros((h, w), dtype=np.int32)
    comps: list[np.ndarray] = []
    cur = 0
    for y0 in range(h):
        for x0 in range(w):
            if not grid[y0, x0] or labels[y0, x0]:
                continue
            cur += 1
            stack = [(y0, x0)]
            labels[y0, x0] = cur
            cells: list[tuple[int, int]] = []
            while stack:
                cy, cx = stack.pop()
                cells.append((cy, cx))
                for dy in (-1, 0, 1):
                    ny = cy + dy
                    if ny < 0 or ny >= h:
                        continue
                    for dx in (-1, 0, 1):
                        nx = cx + dx
                        if 0 <= nx < w and grid[ny, nx] and not labels[ny, nx]:
                            labels[ny, nx] = cur
                            stack.append((ny, nx))
            if len(cells) >= MIN_CELLS:
                comps.append(np.array(cells, dtype=np.int32))
    return comps


def _merge_boxes(boxes: list[list[float]], gap: float = 0.012) -> list[list[float]]:
    """把挨得很近的区块合并（同一段文字常被切成好几块）。"""
    changed = True
    while changed:
        changed = False
        out: list[list[float]] = []
        for b in boxes:
            for o in out:
                if not (
                    b[0] > o[0] + o[2] + gap
                    or o[0] > b[0] + b[2] + gap
                    or b[1] > o[1] + o[3] + gap
                    or o[1] > b[1] + b[3] + gap
                ):
                    x0 = min(b[0], o[0])
                    y0 = min(b[1], o[1])
                    x1 = max(b[0] + b[2], o[0] + o[2])
                    y1 = max(b[1] + b[3], o[1] + o[3])
                    o[0], o[1], o[2], o[3] = x0, y0, x1 - x0, y1 - y0
                    changed = True
                    break
            else:
                out.append(list(b))
        boxes = out
    return boxes


def _group_text_lines(boxes: list[list[float]]) -> list[list[float]]:
    """把竖直堆叠、左右对齐的「细长条」合并成一段文字块。

    否则一行字会被当成一个独立区块，重排时会贴出一排碎条。
    """
    line_idx = {i for i, b in enumerate(boxes) if b[3] < 0.07 and (b[2] / max(1e-6, b[3])) > 4.0}
    rest = [b for i, b in enumerate(boxes) if i not in line_idx]
    groups: list[list[list[float]]] = []
    for i in sorted(line_idx, key=lambda k: boxes[k][1]):
        b = boxes[i]
        for g in groups:
            gx0 = min(x[0] for x in g)
            gx1 = max(x[0] + x[2] for x in g)
            gy1 = max(x[1] + x[3] for x in g)
            overlap = min(gx1, b[0] + b[2]) - max(gx0, b[0])
            same_column = overlap > 0.45 * min(gx1 - gx0, b[2])
            close_enough = (b[1] - gy1) < max(0.025, 2.2 * b[3])
            if same_column and close_enough:
                g.append(b)
                break
        else:
            groups.append([b])
    out = list(rest)
    for g in groups:
        x0 = min(x[0] for x in g)
        y0 = min(x[1] for x in g)
        x1 = max(x[0] + x[2] for x in g)
        y1 = max(x[1] + x[3] for x in g)
        out.append([x0, y0, x1 - x0, y1 - y0])
    return out


def _classify(mask: np.ndarray, rgb: np.ndarray, box: list[float], page_aspect: float) -> str:
    """按填充率、行/列覆盖率、边缘密度、长宽比判断这块是什么。

    关键经验：**文字区块的每一行笔画是稀疏的**，行/列覆盖率明显低于实心色块；
    而胶带是连续长条（覆盖率接近 1）。先看「是不是扁长条」，再区分实心/笔画/贴边。
    """
    x, y, w, h = box
    h_px = max(1, mask.shape[0])
    w_px = max(1, mask.shape[1])
    y0, y1 = max(0, int(y * h_px)), min(h_px, int(math.ceil((y + h) * h_px)))
    x0, x1 = max(0, int(x * w_px)), min(w_px, int(math.ceil((x + w) * w_px)))
    if y1 <= y0 or x1 <= x0:
        return "decor"
    sub = mask[y0:y1, x0:x1]
    if sub.size == 0:
        return "decor"

    ink = float(sub.mean())                                   # 内容像素占包围盒比例
    row_cov = float(sub.any(axis=1).mean())                   # 有内容的行占比
    col_cov = float(sub.any(axis=0).mean())                   # 有内容的列占比

    patch = rgb[y0:y1, x0:x1]
    if patch.size:
        gray = patch.mean(axis=2)
        gy = float(np.abs(np.diff(gray, axis=0)).mean()) if gray.shape[0] > 1 else 0.0
        gx = float(np.abs(np.diff(gray, axis=1)).mean()) if gray.shape[1] > 1 else 0.0
        edge = max(gx, gy)
    else:
        edge = 0.0

    aspect = (w * page_aspect) / max(1e-6, h)   # 换算到真实视觉长宽比
    area = w * h
    touches = x < 0.03 or y < 0.03 or x + w > 0.97 or y + h > 0.97

    # 1) 扁长条：胶带 / 单行文字 / 分割装饰
    if aspect > 3.2 and h < 0.18:
        if ink > 0.55 and row_cov > 0.85:
            return "tape"
        if edge > 6.0:
            return "text"
        return "decor"
    # 2) 实心块 = 照片 / 贴纸大图
    if ink > 0.72 and row_cov > 0.9 and col_cov > 0.9:
        return "photo"
    # 3) 稀疏笔画 + 边缘密集 = 文字段
    if edge > 6.5 and ink < 0.62 and row_cov < 0.96:
        return "text"
    # 4) 贴边细框
    if touches and ink < 0.4:
        return "frame"
    # 5) 小装饰 / 其余
    if area < 0.012:
        return "decor"
    return "photo" if ink > 0.55 else "decor"


# ---------------------------------------------------------------- 主入口

def analyze_image(data: bytes) -> dict[str, Any]:
    """分析一张手账页面图片。失败时抛 ValueError，由上层转成用户可读提示。"""
    try:
        full = _load_rgb(data)
    except Exception as exc:  # 坏图 / 非图片
        raise ValueError("无法识别这张图片，请换一张 PNG/JPG 试试") from exc

    orig_w, orig_h = full.size
    if orig_w < 40 or orig_h < 40:
        raise ValueError("图片太小了，至少需要 40×40 像素")

    work = full.copy()
    work.thumbnail((ANALYSIS_MAX, ANALYSIS_MAX), Image.LANCZOS)
    arr = np.asarray(work, dtype=np.float32)
    h, w = arr.shape[:2]
    page_aspect = w / max(1, h)

    # --- 背景色：取四周边缘环带的中位数，避免被正中内容带偏 ---
    ring = max(2, int(min(h, w) * 0.04))
    border = np.concatenate(
        [
            arr[:ring, :, :].reshape(-1, 3),
            arr[-ring:, :, :].reshape(-1, 3),
            arr[:, :ring, :].reshape(-1, 3),
            arr[:, -ring:, :].reshape(-1, 3),
        ]
    )
    bg = np.median(border, axis=0)
    border_std = float(border.std(axis=0).mean())
    plain = border_std < 11.0
    texture = "none" if plain else ("subtle" if border_std < 30 else "pattern")

    # --- 内容掩码 ---
    diff = np.sqrt(((arr - bg[None, None, :]) ** 2).sum(axis=2))
    mask = diff > DIFF_THRESHOLD
    # 形态学开运算去掉椒盐噪点（腐蚀→膨胀）
    m = mask
    for _ in range(1):
        m = m & np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1)
    for _ in range(1):
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    content = float(m.mean())

    # --- 配色：抽样 + k-means ---
    flat = arr.reshape(-1, 3)
    step = max(1, flat.shape[0] // 24000)
    sample = flat[::step]
    centers, ratios = _kmeans(sample, 6)
    palette = []
    for c, r in zip(centers, ratios):
        if r < 0.012:
            continue
        palette.append({"hex": _hex(c), "ratio": round(float(r), 4)})

    # --- 区块：网格化连通域 ---
    gh = max(8, int(round(GRID_LONG * (h / max(h, w)))))
    gw = max(8, int(round(GRID_LONG * (w / max(h, w)))))
    small = np.asarray(
        Image.fromarray((m * 255).astype(np.uint8)).resize((gw, gh), Image.BOX),
        dtype=np.float32,
    ) / 255.0
    grid = small > 0.18

    raw_boxes: list[list[float]] = []
    for cells in _label_components(grid):
        gy0, gy1 = int(cells[:, 0].min()), int(cells[:, 0].max())
        gx0, gx1 = int(cells[:, 1].min()), int(cells[:, 1].max())
        py0, py1 = int(gy0 * h / gh), int(min(h - 1, math.ceil((gy1 + 1) * h / gh)))
        px0, px1 = int(gx0 * w / gw), int(min(w - 1, math.ceil((gx1 + 1) * w / gw)))
        sub = m[py0:py1 + 1, px0:px1 + 1]
        rows = np.where(sub.any(axis=1))[0]
        cols = np.where(sub.any(axis=0))[0]
        if len(rows) == 0 or len(cols) == 0:
            continue
        y0, y1 = py0 + int(rows[0]), py0 + int(rows[-1]) + 1
        x0, x1 = px0 + int(cols[0]), px0 + int(cols[-1]) + 1
        raw_boxes.append([x0 / w, y0 / h, max(1e-4, (x1 - x0) / w), max(1e-4, (y1 - y0) / h)])

    merged = _merge_boxes(raw_boxes)
    merged = _group_text_lines(merged)
    merged = _merge_boxes(merged)
    merged = [b for b in merged if 0.0006 < b[2] * b[3] < 0.97]

    regions = []
    for b in sorted(merged, key=lambda r: (r[1], r[0])):
        rtype = _classify(m, arr, b, page_aspect)
        y0, y1 = int(b[1] * h), min(h, int(math.ceil((b[1] + b[3]) * h)))
        x0, x1 = int(b[0] * w), min(w, int(math.ceil((b[0] + b[2]) * w)))
        patch = arr[y0:y1, x0:x1]
        sub_mask = m[y0:y1, x0:x1]
        if patch.size and sub_mask.any():
            fill = _hex(patch[sub_mask].mean(axis=0))
            density = float(sub_mask.mean())
        else:
            fill, density = _hex(bg), 0.0
        regions.append(
            {
                "x": round(b[0], 4),
                "y": round(b[1], 4),
                "w": round(b[2], 4),
                "h": round(b[3], 4),
                "type": rtype,
                "density": round(density, 3),
                "fill": fill,
                "aspect": round((b[2] * page_aspect) / max(1e-6, b[3]), 2),
            }
        )

    # --- 风格判断 ---
    px_sat = []
    for c in centers:
        mx, mn = float(c.max()), float(c.min())
        px_sat.append(0.0 if mx <= 0 else (mx - mn) / mx)
    mean_sat = float(np.mean(px_sat)) if px_sat else 0.0
    mean_val = float(centers.mean() / 255.0) if len(centers) else 0.5
    r_mean = float(arr[:, :, 0].mean())
    b_mean = float(arr[:, :, 2].mean())

    if mean_sat < 0.12:
        mood = "素雅"
    elif mean_sat < 0.25:
        mood = "柔和"
    elif mean_val > 0.7:
        mood = "甜系"
    else:
        mood = "浓郁"
    if content < 0.16:
        density_word = "极简"
    elif content < 0.34:
        density_word = "透气"
    elif content < 0.55:
        density_word = "适中"
    else:
        density_word = "满版"
    warmth = "暖调" if r_mean - b_mean > 6 else ("冷调" if b_mean - r_mean > 6 else "中性")

    aspect = orig_w / max(1, orig_h)
    if abs(aspect - 148 / 210) < 0.06:
        guess = "A5"
    elif abs(aspect - 105 / 148) < 0.06:
        guess = "A6"
    elif abs(aspect - 210 / 297) < 0.05:
        guess = "A4"
    elif abs(aspect - 176 / 250) < 0.06:
        guess = "B5"
    else:
        guess = "A5"

    return {
        "ok": True,
        "image": {
            "w": orig_w,
            "h": orig_h,
            "aspect": round(aspect, 4),
            "preview": _data_uri(full),
        },
        "background": {"hex": _hex(bg), "plain": plain, "texture": texture},
        "palette": palette,
        "whitespace": round(1.0 - content, 3),
        "style": {"mood": mood, "density": density_word, "warmth": warmth},
        "regions": regions[:60],
        "suggest": {"page_size": guess, "dpi": 300},
    }
