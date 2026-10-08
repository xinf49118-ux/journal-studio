"""页面结构分析的测试。

用 Pillow 合成一张「手账页面」：米色底 + 一块蓝色照片区 + 一条粉色胶带 + 几行文字，
检验分析器能否把背景、配色、区块都识别出来。不依赖任何外部素材文件。
"""
from __future__ import annotations

import io
import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from server import analysis  # noqa: E402


def make_fake_page() -> bytes:
    W, H = 1109, 1568  # A5 @190dpi 左右
    img = Image.new("RGB", (W, H), (255, 253, 247))
    d = ImageDraw.Draw(img)

    # 一块「照片」区域：深蓝实心矩形
    d.rectangle([80, 120, 520, 460], fill=(58, 92, 130))

    # 一条「胶带」：细长的粉色横条
    d.rectangle([620, 200, 1040, 268], fill=(246, 184, 200))

    # 「文字」：几行细横线
    for i in range(5):
        y = 620 + i * 34
        d.line([80, y, 80 + 700 - i * 40, y], fill=(90, 82, 76), width=4)

    # 右下角一个装饰小方块
    d.rectangle([860, 1300, 960, 1400], fill=(230, 180, 90))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class TestAnalyze(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = analysis.analyze_image(make_fake_page())

    def test_basic_shape(self):
        r = self.result
        self.assertTrue(r["ok"])
        self.assertEqual(r["image"]["w"], 1109)
        self.assertEqual(r["image"]["h"], 1568)
        self.assertTrue(r["image"]["preview"].startswith("data:image/jpeg;base64,"))

    def test_background_detected(self):
        r = self.result
        hexv = r["background"]["hex"]
        # 背景 (255,253,247) —— 允许一点误差
        rgb = tuple(int(hexv[i:i + 2], 16) for i in (1, 3, 5))
        self.assertGreater(rgb[0], 235)
        self.assertGreater(rgb[1], 235)
        self.assertGreater(rgb[2], 225)
        self.assertTrue(r["background"]["plain"], "边缘是纯色，应判断为素底")

    def test_palette_has_content_colors(self):
        palette = [p["hex"] for p in self.result["palette"]]
        self.assertGreaterEqual(len(palette), 2)
        for p in self.result["palette"]:
            self.assertRegex(p["hex"], r"^#[0-9a-f]{6}$")
            self.assertGreater(p["ratio"], 0)

    def test_regions_found(self):
        regions = self.result["regions"]
        self.assertGreaterEqual(len(regions), 2, f"至少应识别出照片区和文字区，实际 {regions}")

        def overlaps(a, r):
            return not (
                a["x"] > r["x"] + r["w"] or r["x"] > a["x"] + a["w"]
                or a["y"] > r["y"] + r["h"] or r["y"] > a["y"] + a["h"]
            )

        photo_box = {"x": 80 / 1109, "y": 120 / 1568, "w": 440 / 1109, "h": 340 / 1568}
        hit = [r for r in regions if overlaps(photo_box, r)]
        self.assertTrue(hit, "没识别出中间那块深蓝照片区")
        self.assertIn(hit[0]["type"], ("photo", "decor", "text"))

    def test_whitespace_reasonable(self):
        ws = self.result["whitespace"]
        self.assertGreater(ws, 0.5, "这张图大部分是空白")
        self.assertLess(ws, 0.99)

    def test_style_fields(self):
        s = self.result["style"]
        for k in ("mood", "density", "warmth"):
            self.assertIn(k, s)
            self.assertTrue(s[k])
        self.assertIn(self.result["suggest"]["page_size"], ("A5", "A6", "A4", "B5"))

    def test_regions_normalized(self):
        for r in self.result["regions"]:
            self.assertGreaterEqual(r["x"], 0)
            self.assertGreaterEqual(r["y"], 0)
            self.assertLessEqual(r["x"] + r["w"], 1.02)
            self.assertLessEqual(r["y"] + r["h"], 1.02)
            self.assertIn(r["type"], ("photo", "text", "tape", "decor", "frame"))

    def test_bad_input_raises_value_error(self):
        with self.assertRaises(ValueError):
            analysis.analyze_image(b"this is definitely not an image")

    def test_tiny_input_rejected(self):
        buf = io.BytesIO()
        Image.new("RGB", (10, 10), (255, 255, 255)).save(buf, format="PNG")
        with self.assertRaises(ValueError):
            analysis.analyze_image(buf.getvalue())

    def test_speed(self):
        import time
        t0 = time.time()
        analysis.analyze_image(make_fake_page())
        self.assertLess(time.time() - t0, 8.0, "分析超时（应 < 8s）")


class TestRegionTypes(unittest.TestCase):
    """区块类型判断的准确性。

    这里曾经出过大问题：文字行被统一判成「胶带」，导致 text 类型实际不可达，
    复刻功能永远排不出文字区块。用真实字体渲染的页面来锁住这个行为。
    """

    FONT = r"C:\Windows\Fonts\msyh.ttc"

    @classmethod
    def setUpClass(cls):
        from PIL import ImageFont
        if not Path(cls.FONT).exists():
            raise unittest.SkipTest("找不到中文字体，跳过类型判定测试")
        cls.font = ImageFont.truetype(cls.FONT, 52)

    def _page(self, draw_fn, w=1109, h=1568):
        img = Image.new("RGB", (w, h), (255, 253, 247))
        draw_fn(ImageDraw.Draw(img), w, h)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def _types(self, data):
        return [r["type"] for r in analysis.analyze_image(data)["regions"]]

    def test_multi_line_text_is_text(self):
        def draw(d, w, h):
            for i in range(7):
                d.text((70, 640 + i * 90), "今天也要好好记录生活呀", font=self.font, fill=(80, 72, 66))
        types = self._types(self._page(draw))
        self.assertTrue(types, "没识别出任何区块")
        self.assertTrue(all(t == "text" for t in types), f"多行文字应全判为 text，实际 {types}")

    def test_single_text_line_is_text(self):
        def draw(d, w, h):
            d.text((70, 300), "2026年9月30日 星期三", font=self.font, fill=(80, 72, 66))
        types = self._types(self._page(draw))
        self.assertIn("text", types, f"单行文字应判为 text，实际 {types}")
        self.assertNotIn("tape", types, f"单行文字不该被判成胶带，实际 {types}")

    def test_solid_block_is_photo(self):
        def draw(d, w, h):
            d.rectangle([70, 230, 540, 600], fill=(96, 128, 150))
        types = self._types(self._page(draw))
        self.assertIn("photo", types, f"实心块应判为 photo，实际 {types}")

    def test_long_strip_is_tape(self):
        def draw(d, w, h):
            d.rectangle([70, 300, 1000, 380], fill=(246, 196, 210))
        types = self._types(self._page(draw))
        self.assertEqual(types, ["tape"], f"扁长实心条应判为 tape，实际 {types}")

    def test_mixed_page(self):
        def draw(d, w, h):
            d.rectangle([70, 230, 540, 600], fill=(96, 128, 150))
            d.rectangle([620, 260, 1000, 330], fill=(246, 196, 210))
            for i in range(4):
                d.text((70, 700 + i * 80), "今天的记录内容", font=self.font, fill=(80, 72, 66))
        types = self._types(self._page(draw))
        self.assertIn("photo", types, f"应有实心块，实际 {types}")
        self.assertIn("tape", types, f"应有胶带条，实际 {types}")
        self.assertIn("text", types, f"应有文字段，实际 {types}")

    def test_recreate_can_actually_produce_text_blocks(self):
        """端到端后果验证：真实的文字页必须产出至少一个 text 区块供复刻使用。"""
        def draw(d, w, h):
            for i in range(6):
                d.text((80, 500 + i * 85), "生活记录 第 %d 行" % (i + 1), font=self.font, fill=(70, 64, 60))
        regions = analysis.analyze_image(self._page(draw))["regions"]
        text_regions = [r for r in regions if r["type"] == "text"]
        self.assertGreaterEqual(len(text_regions), 1,
                                f"复刻时拿不到文字区块，实际类型分布 {[r['type'] for r in regions]}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
