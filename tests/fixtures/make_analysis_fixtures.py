"""合成跨语言一致性测试用的分析夹具。

给 web/js/analysis.js（浏览器版）和 server/analysis.py（Python 原版）喂**完全相同的像素**：
每张页面先按 A5 比例画好，再缩到最长边 1024（和 Python 分析时用的缩略图同一套流程），
存成 PNG 后：
  1) 用 Python 的 analysis.analyze_image(png_bytes) 跑出期望结果 → <name>.json
  2) 导出这张 PNG 的原始 RGBA 字节并 gzip → <name>.rgba.gz（Node 侧 gunzip 后直接喂 analyzePixels）
  3) 宽高记录在 json 的 image.w / image.h 里（Node 侧会用 rgba 长度校验）

注意：json 里的 image.preview 被清成空串——预览图是浏览器路径（canvas）的产物，
Node 里既不参与比对也会让夹具膨胀几百 KB。

用法：
    python tests/fixtures/make_analysis_fixtures.py
"""
from __future__ import annotations

import gzip
import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server import analysis  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "analysis"
ANALYSIS_MAX = 1024
PAGE_W, PAGE_H = 1109, 1568          # A5 @190dpi 左右，长宽比 0.7075（判为 A5）
PAPER = (255, 253, 247)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _font(size: int):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _new_page(color=PAPER) -> Image.Image:
    return Image.new("RGB", (PAGE_W, PAGE_H), color)


# ---------------------------------------------------------------- 8 张代表性页面

def page_solid_blocks() -> Image.Image:
    """纯色底 + 实心色块（照片/贴纸大图的典型形态）。"""
    img = _new_page()
    d = ImageDraw.Draw(img)
    d.rectangle([80, 120, 520, 460], fill=(58, 92, 130))
    d.rectangle([620, 200, 1040, 268], fill=(246, 184, 200))
    d.rectangle([860, 1300, 960, 1400], fill=(230, 180, 90))
    d.rectangle([120, 1000, 300, 1180], fill=(150, 196, 170))
    return img


def page_diary_lines() -> Image.Image:
    """7 行中文日记：考验 _group_text_lines 与 text 判定。"""
    img = _new_page()
    d = ImageDraw.Draw(img)
    font = _font(52)
    for i in range(7):
        d.text((70, 640 + i * 90), "今天也要好好记录生活呀", font=font, fill=(80, 72, 66))
    return img


def page_single_line() -> Image.Image:
    """单行文字：扁长条但不该被判成胶带。"""
    img = _new_page()
    d = ImageDraw.Draw(img)
    d.text((70, 300), "2026年9月30日 星期三", font=_font(52), fill=(80, 72, 66))
    return img


def page_flat_tape() -> Image.Image:
    """扁平胶带：又细又长的实心条。"""
    img = _new_page()
    d = ImageDraw.Draw(img)
    d.rectangle([70, 300, 1000, 380], fill=(246, 196, 210))
    return img


def page_thick_tape() -> Image.Image:
    """厚胶带：仍然扁长（h 略小于 0.18），但比扁平胶带厚一截。"""
    img = _new_page()
    d = ImageDraw.Draw(img)
    d.rectangle([70, 300, 1000, 560], fill=(214, 226, 196))
    return img


def page_dark_bg() -> Image.Image:
    """深色底 + 浅色内容。"""
    img = _new_page((28, 32, 40))
    d = ImageDraw.Draw(img)
    d.rectangle([90, 180, 560, 520], fill=(232, 226, 214))
    d.rectangle([640, 620, 1020, 700], fill=(240, 200, 120))
    font = _font(48)
    for i in range(4):
        d.text((90, 900 + i * 80), "夜里的记录也要留着", font=font, fill=(226, 232, 240))
    return img


def page_many_decor() -> Image.Image:
    """大量小装饰：考验连通域数量、合并与 60 个区块的上限。"""
    img = _new_page()
    d = ImageDraw.Draw(img)
    colors = [(230, 140, 150), (140, 180, 220), (240, 200, 120), (150, 200, 160), (200, 160, 220)]
    for row in range(6):
        for col in range(9):
            x = 90 + col * 110
            y = 220 + row * 150
            c = colors[(row * 9 + col) % len(colors)]
            if (row + col) % 3 == 0:
                d.ellipse([x, y, x + 70, y + 70], fill=c)
            else:
                d.rectangle([x, y, x + 70, y + 70], fill=c)
    return img


def page_near_blank() -> Image.Image:
    """接近空白：只有一枚很小的墨点，多半达不到 MIN_CELLS 而被丢弃。"""
    img = _new_page()
    d = ImageDraw.Draw(img)
    d.rectangle([1040, 1480, 1052, 1492], fill=(120, 112, 104))
    return img


PAGES = {
    "solid_blocks": page_solid_blocks,
    "diary_lines": page_diary_lines,
    "single_line": page_single_line,
    "flat_tape": page_flat_tape,
    "thick_tape": page_thick_tape,
    "dark_bg": page_dark_bg,
    "many_decor": page_many_decor,
    "near_blank": page_near_blank,
}


def build(name: str, factory) -> dict:
    img = factory()
    work = img.copy()
    work.thumbnail((ANALYSIS_MAX, ANALYSIS_MAX), Image.LANCZOS)   # 与 analyze_image 内部同一套缩放
    buf = io.BytesIO()
    work.save(buf, format="PNG")
    png = buf.getvalue()

    result = analysis.analyze_image(png)
    result["image"]["preview"] = ""      # 预览图是浏览器产物，夹具里不带

    rgba = work.convert("RGBA").tobytes()
    # 原始 RGBA 体积很大（8 张约 23MB），gzip 后能压到十分之一以内，Node 侧用 zlib.gunzipSync 还原
    (OUT_DIR / f"{name}.rgba.gz").write_bytes(gzip.compress(rgba, 9))
    (OUT_DIR / f"{name}.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    assert result["image"]["w"] == work.width and result["image"]["h"] == work.height
    assert len(rgba) == work.width * work.height * 4
    return {
        "name": name,
        "w": work.width,
        "h": work.height,
        "regions": len(result["regions"]),
        "types": sorted({r["type"] for r in result["regions"]}),
    }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = [build(name, factory) for name, factory in PAGES.items()]
    print(f"夹具输出目录：{OUT_DIR}")
    print(f"{'name':<14}{'size':<12}{'regions':<9}types")
    for r in rows:
        print(f"{r['name']:<14}{str(r['w']) + 'x' + str(r['h']):<12}{r['regions']:<9}{','.join(r['types']) or '-'}")
    print(f"共 {len(rows)} 张夹具（rgba + json）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
