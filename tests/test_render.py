"""渲染引擎测试：像素尺寸、背景、图层、文字、裁切标记、PNG/PDF 导出。

不依赖内置素材包也能跑（素材相关用例会自动跳过）。
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import server  # noqa: E402

MM = 25.4


def px(mm: float, dpi: float) -> int:
    return int(round(mm * dpi / MM))


def base_request(**overrides):
    req = {
        "page": {"size": "A5", "dpi": 300, "bleed_mm": 0, "crop_marks": False, "orientation": "portrait"},
        "background": {"type": "color", "value": "#fffdf7"},
        "layers": [],
    }
    req.update(overrides)
    return req


def first_material(cat: str | None = None):
    items = server.load_manifest().get("items", [])
    for it in items:
        if cat is None or it.get("cat") == cat:
            return it
    return None


class TestRenderGeometry(unittest.TestCase):
    def test_a5_no_bleed_size(self):
        img = server.render_page(base_request())
        self.assertEqual(img.size, (px(148, 300), px(210, 300)))
        self.assertEqual(img.mode, "RGB")

    def test_a5_with_bleed_size(self):
        req = base_request(page={"size": "A5", "dpi": 300, "bleed_mm": 3, "crop_marks": False, "orientation": "portrait"})
        img = server.render_page(req)
        self.assertEqual(img.size, (px(154, 300), px(216, 300)))

    def test_a6_a4_b5(self):
        for size, (w, h) in (("A6", (105, 148)), ("A4", (210, 297)), ("B5", (176, 250))):
            img = server.render_page(base_request(page={"size": size, "dpi": 150, "bleed_mm": 0, "crop_marks": False}))
            self.assertEqual(img.size, (px(w, 150), px(h, 150)), size)

    def test_landscape_swaps(self):
        req = base_request(page={"size": "A5", "dpi": 150, "bleed_mm": 0, "crop_marks": False, "orientation": "landscape"})
        img = server.render_page(req)
        self.assertEqual(img.size, (px(210, 150), px(148, 150)))

    def test_background_color_applied(self):
        req = base_request(background={"type": "color", "value": "#123456"})
        img = server.render_page(req)
        self.assertEqual(img.getpixel((5, 5)), (0x12, 0x34, 0x56))
        self.assertEqual(img.getpixel((img.width - 5, img.height - 5)), (0x12, 0x34, 0x56))

    def test_crop_marks_drawn_in_bleed(self):
        req = base_request(page={"size": "A5", "dpi": 300, "bleed_mm": 5, "crop_marks": True},
                           background={"type": "color", "value": "#ffffff"})
        img = server.render_page(req)
        bleed_px = px(5, 300)
        # 角上应有深色标记
        corner = img.crop((0, 0, bleed_px, bleed_px))
        dark = int((np.asarray(corner).sum(axis=2) < 300).sum())
        self.assertGreater(dark, 20, "出血区没画出裁切角线")

    def test_crop_marks_absent_when_disabled(self):
        req = base_request(page={"size": "A5", "dpi": 300, "bleed_mm": 5, "crop_marks": False},
                           background={"type": "color", "value": "#ffffff"})
        img = server.render_page(req)
        bleed_px = px(5, 300)
        corner = img.crop((0, 0, bleed_px, bleed_px))
        dark = int((np.asarray(corner).sum(axis=2) < 300).sum())
        self.assertEqual(dark, 0)


class TestRenderLayers(unittest.TestCase):
    def test_shape_layer_pixel(self):
        req = base_request(background={"type": "color", "value": "#ffffff"}, layers=[
            {"id": "s1", "kind": "shape", "shape": "rect", "fill": "#ff0000",
             "x_mm": 20, "y_mm": 20, "w_mm": 40, "h_mm": 40, "opacity": 1},
        ])
        img = server.render_page(req)
        self.assertEqual(img.getpixel((px(40, 300), px(40, 300))), (255, 0, 0))
        self.assertEqual(img.getpixel((px(100, 300), px(40, 300))), (255, 255, 255))

    def test_text_layer_draws_something(self):
        req = base_request(background={"type": "color", "value": "#ffffff"}, layers=[
            {"id": "t1", "kind": "text", "text": "2026 手账", "font": "sans", "size_mm": 10,
             "color": "#000000", "x_mm": 20, "y_mm": 30, "rotate": 0, "opacity": 1, "align": "left"},
        ])
        img = server.render_page(req)
        region = img.crop((px(18, 300), px(28, 300), px(120, 300), px(48, 300)))
        dark = int((np.asarray(region).sum(axis=2) < 200).sum())
        self.assertGreater(dark, 40, "文字层没有画出可见笔画")

    def test_opacity_zero_layer_skipped(self):
        req = base_request(background={"type": "color", "value": "#ffffff"}, layers=[
            {"id": "s1", "kind": "shape", "shape": "rect", "fill": "#ff0000",
             "x_mm": 20, "y_mm": 20, "w_mm": 40, "h_mm": 40, "opacity": 0},
        ])
        img = server.render_page(req)
        self.assertEqual(img.getpixel((px(40, 300), px(40, 300))), (255, 255, 255))

    @unittest.skipUnless(first_material("tape") or first_material("sticker"), "需要先生成内置素材包")
    def test_material_layer_renders(self):
        item = first_material("tape") or first_material("sticker")
        req = base_request(background={"type": "color", "value": "#ffffff"}, layers=[
            {"id": "m1", "kind": "material", "ref": item["id"],
             "x_mm": 10, "y_mm": 30, "w_mm": 80, "h_mm": 30, "rotate": 0, "opacity": 1},
        ])
        img = server.render_page(req)
        region = img.crop((px(12, 300), px(32, 300), px(86, 300), px(56, 300)))
        white = int((np.asarray(region).sum(axis=2) > 740).sum())
        self.assertLess(white, region.width * region.height * 0.95, "素材图层似乎没画上去")

    @unittest.skipUnless(first_material("paper"), "需要先生成内置素材包")
    def test_material_background(self):
        item = first_material("paper")
        req = base_request(background={"type": "material", "value": item["id"], "tile": bool(item.get("tile"))})
        img = server.render_page(req)
        self.assertEqual(img.size, (px(148, 300), px(210, 300)))


class TestExport(unittest.TestCase):
    def test_png_bytes(self):
        data = server.render_png_bytes(base_request())
        self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))
        img = Image.open(__import__("io").BytesIO(data))
        self.assertEqual(img.size, (px(148, 300), px(210, 300)))

    @unittest.skipIf(server.pdfwrite is None, "pdfwrite 模块不可用")
    def test_pdf_bytes(self):
        req = base_request(page={"size": "A5", "dpi": 150, "bleed_mm": 3, "crop_marks": True})
        data = server.render_pdf_bytes(req)
        self.assertTrue(data.startswith(b"%PDF-1."), "PDF 头不正确")
        self.assertIn(b"%%EOF", data[-1024:])
        self.assertIn(b"/Type /Catalog", data)
        self.assertGreater(len(data), 3000)
        # 每个 obj 都要有配对的 endobj
        self.assertEqual(data.count(b" obj"), data.count(b"endobj"))


class TestRegression(unittest.TestCase):
    """回归测试：这些 bug 曾经真实出现过，锁住不让它们回来。"""

    def test_index_html_has_print_root(self):
        """打印容器必须存在，否则 window.print() 出来的是一张白纸。"""
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="print-root"', html, "index.html 缺 #print-root，打印会整体失效")

    def test_tile_uses_natural_mm_not_pixel_count(self):
        """平铺必须按素材的自然毫米尺寸，否则预览与导出的花纹密度会差一倍。"""
        from PIL import Image as PILImage
        checker = PILImage.new("RGBA", (10, 10), (255, 0, 0, 255))
        for i in range(10):
            checker.putpixel((i, i), (0, 0, 255, 255))
        canvas = PILImage.new("RGBA", (100, 100), (255, 255, 255, 255))
        # 平铺块放成 20px：真实周期应该是 20
        server._tile_into(canvas, checker, (0, 0, 100, 100), 1.0, tile_px=(20, 20))
        p00 = canvas.getpixel((0, 0))
        self.assertEqual(p00, canvas.getpixel((20, 0)), "平铺周期不是 20px（横向）")
        self.assertEqual(p00, canvas.getpixel((0, 20)), "平铺周期不是 20px（纵向）")
        self.assertEqual(p00, canvas.getpixel((80, 80)), "平铺周期不是 20px（远端）")
        self.assertNotEqual(p00, canvas.getpixel((12, 0)), "平铺块内部应当有花纹变化")
        # 交叉验证：按 40px 平铺时周期必须变成 40
        canvas2 = PILImage.new("RGBA", (100, 100), (255, 255, 255, 255))
        server._tile_into(canvas2, checker, (0, 0, 100, 100), 1.0, tile_px=(40, 40))
        self.assertEqual(canvas2.getpixel((0, 0)), canvas2.getpixel((40, 0)))
        self.assertNotEqual(canvas2.getpixel((0, 0)), canvas2.getpixel((20, 0)),
                            "tile_px 没起作用，仍在按原像素尺寸平铺")

    def test_natural_mm_matches_frontend_formula(self):
        item = first_material("paper")
        if not item:
            self.skipTest("需要素材包")
        w_mm, h_mm = server.material_natural_mm(item)
        self.assertAlmostEqual(w_mm, item["w"] / 150 * 25.4, places=3, msg="paper 应按 150dpi 折算")
        tape = first_material("tape")
        if tape:
            w2, _ = server.material_natural_mm(tape)
            self.assertAlmostEqual(w2, tape["w"] / 300 * 25.4, places=3, msg="非 paper 应按 300dpi 折算")

    def test_text_flip_actually_changes_pixels(self):
        """flip 曾经只在预览生效、服务端忽略。"""
        base = {"id": "t", "kind": "text", "text": "AB", "font": "sans", "size_mm": 14,
                "color": "#000000", "x_mm": 40, "y_mm": 40, "rotate": 0, "opacity": 1, "align": "left"}
        req_a = base_request(background={"type": "color", "value": "#ffffff"}, layers=[dict(base)])
        req_b = base_request(background={"type": "color", "value": "#ffffff"}, layers=[dict(base, flip_x=True)])
        a = np.asarray(server.render_page(req_a)).astype(int)
        b = np.asarray(server.render_page(req_b)).astype(int)
        self.assertGreater(np.abs(a - b).sum(), 1000, "文字层 flip_x 没有生效")

    def test_shape_flip_actually_changes_pixels(self):
        base = {"id": "s", "kind": "shape", "shape": "rect", "fill": "#ff0000",
                "x_mm": 20, "y_mm": 20, "w_mm": 30, "h_mm": 60, "opacity": 1}
        req_a = base_request(background={"type": "color", "value": "#ffffff"}, layers=[dict(base)])
        req_b = base_request(background={"type": "color", "value": "#ffffff"},
                             layers=[dict(base, flip_x=True, x_mm=90)])
        a = np.asarray(server.render_page(req_a)).astype(int)
        b = np.asarray(server.render_page(req_b)).astype(int)
        self.assertGreater(np.abs(a - b).sum(), 1000, "形状层 flip_x 没有生效")

    def test_line_shape_sits_at_vertical_center(self):
        req = base_request(background={"type": "color", "value": "#ffffff"}, layers=[
            {"id": "l", "kind": "shape", "shape": "line", "fill": "#000000",
             "x_mm": 20, "y_mm": 20, "w_mm": 100, "h_mm": 40, "stroke_mm": 1, "opacity": 1},
        ])
        img = server.render_page(req)
        mid = img.getpixel((px(70, 300), px(40, 300)))
        top = img.getpixel((px(70, 300), px(24, 300)))
        self.assertLess(sum(mid), 200, f"中线处应有线条，实际 {mid}")
        self.assertGreater(sum(top), 700, f"顶部应留白，实际 {top}")

    def test_tiled_background_period_is_dpi_invariant(self):
        """平铺背景的「毫米周期」不能随 dpi 变化。

        老 bug：服务端按 1 素材像素 = 1 输出像素平铺，于是 150dpi 下花纹周期是 300dpi 的两倍，
        预览和打印出来密度完全不同。这里用自相关实测周期来锁死。
        """
        item = None
        for it in server.load_manifest().get("items", []):
            if it.get("cat") == "paper" and it.get("tile"):
                item = it
                break
        if not item:
            self.skipTest("素材包里没有 tile=true 的底纹纸")
        nw_mm, nh_mm = server.material_natural_mm(item)

        def period_px(dpi, size="A5"):
            req = base_request(page={"size": size, "dpi": dpi, "bleed_mm": 0, "crop_marks": False},
                               background={"type": "material", "value": item["id"], "tile": True})
            img = server.render_page(req).convert("L")
            a = np.asarray(img, dtype=np.float32)
            profile = a.mean(axis=0)
            profile = profile - profile.mean()
            expected = item["w"] / 150 * dpi / 25.4  # 按自然尺寸折算出的像素周期
            lo = max(3, int(expected * 0.5))
            hi = max(lo + 2, int(expected * 1.7))
            best_lag, best = 0, -1e18
            for lag in range(lo, hi):
                v = float((profile[:-lag] * profile[lag:]).mean())
                if v > best:
                    best, best_lag = v, lag
            return best_lag, dpi / 25.4

        lag150, ppm150 = period_px(150)
        lag300, ppm300 = period_px(300)
        mm150 = lag150 / ppm150
        mm300 = lag300 / ppm300
        self.assertGreater(lag150, 0, "没测到花纹周期")
        self.assertAlmostEqual(mm150, mm300, delta=max(0.6, mm150 * 0.08),
                               msg=f"花纹毫米周期随 dpi 变了：150dpi {mm150:.2f}mm vs 300dpi {mm300:.2f}mm")
        # 反过来看像素域：毫米周期不变 ⇒ 像素周期应与 dpi 成正比
        self.assertAlmostEqual(lag300 / max(1, lag150), 2.0, delta=0.25,
                               msg=f"像素周期没随 dpi 翻倍（{lag150} → {lag300}），说明仍在按素材像素平铺")

    def test_malformed_inputs_do_not_crash(self):
        """脏数据（字符串数字、NaN、超大值）必须安全回落，不能把 Python 异常抛给用户。"""
        req = {
            "page": {"size": "A5", "dpi": "abc", "bleed_mm": None, "crop_marks": "yes"},
            "background": {"type": "color", "value": "不是颜色"},
            "layers": [
                {"kind": "shape", "shape": "rect", "opacity": "abc", "rotate": "x",
                 "x_mm": "NaN", "y_mm": None, "w_mm": 1e9, "h_mm": -5},
                {"kind": "text", "text": "测试", "size_mm": 99999, "opacity": float("nan")},
                {"kind": "material", "ref": None, "w_mm": "?", "h_mm": "?"},
                "这不是字典",
            ],
        }
        img = server.render_page(req)
        self.assertEqual(img.mode, "RGB")
        self.assertGreater(img.width, 0)

    def test_text_metrics_match_documented_contract(self):
        """服务端文字行距契约：pitch = 1.35 × 字号，首行按半行距对齐。"""
        size_mm = 10.0
        dpi = 300
        ppm = dpi / 25.4
        size_px = int(round(size_mm * ppm))
        font = server._font("sans", size_px)
        ascent, descent = font.getmetrics()
        pitch = size_px * 1.35
        # 两行文字的总高应该是 2 × pitch
        req = base_request(background={"type": "color", "value": "#ffffff"}, layers=[
            {"id": "t", "kind": "text", "text": "手账\n工坊", "font": "sans", "size_mm": size_mm,
             "color": "#000000", "x_mm": 20, "y_mm": 20, "rotate": 0, "opacity": 1, "align": "left"},
        ])
        img = np.asarray(server.render_page(req).convert("L"))
        rows = np.where((img < 128).any(axis=1))[0]
        self.assertGreater(len(rows), 0, "没渲染出文字")
        span = rows[-1] - rows[0] + 1
        self.assertLess(span, 2 * pitch, "两行文字的墨迹范围不该超过 2×pitch")
        self.assertGreater(span, pitch, "两行文字应该明显高于一行")
        self.assertTrue(ascent > 0 and descent >= 0)


class TestHelpers(unittest.TestCase):
    def test_color_parse(self):
        self.assertEqual(server.ImageColorHelper("#fff"), (255, 255, 255, 255))
        self.assertEqual(server.ImageColorHelper("#1a2b3c"), (26, 43, 60, 255))
        self.assertEqual(server.ImageColorHelper("rgb(1,2,3)"), (1, 2, 3, 255))
        self.assertEqual(server.ImageColorHelper("garbage"), (255, 255, 255, 255))

    def test_safe_join_blocks_traversal(self):
        self.assertIsNone(server._safe_join(ROOT, "../secret.txt"))
        self.assertIsNone(server._safe_join(ROOT, "..%2f..%2fwindows%2fwin.ini"))
        self.assertIsNotNone(server._safe_join(ROOT, "web/index.html"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
