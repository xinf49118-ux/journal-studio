# -*- coding: utf-8 -*-
"""内置素材包自检（标准库 unittest）。

运行：
    python tests/test_materials.py -v

要求：60 秒内跑完。读图只用 img.size（不整图加载像素），
检查 alpha 是否存在透明像素时对 alpha 通道抽稀采样。
"""

import json
import os
import re
import sys
import unittest

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MATERIALS = os.path.join(ROOT, "assets", "materials")
MANIFEST = os.path.join(MATERIALS, "manifest.json")

# SPEC 2.1 各类最低数量
MIN_COUNT = {
    "paper": 20,
    "tape": 24,
    "sticker": 36,
    "frame": 10,
    "divider": 12,
    "stamp": 10,
    "title": 12,
    "icon": 20,
}
CAT_NAMES = {
    "paper": "底纹纸", "tape": "和纸胶带", "sticker": "贴纸", "frame": "边框花边",
    "divider": "分割线", "stamp": "印章邮戳", "title": "标题日期条", "icon": "小图标",
}
HEX_RE = re.compile(r"^#[0-9a-f]{6}$")
ID_RE = re.compile(r"^[a-z0-9_]+$")
ALPHA_MODES = ("RGBA", "LA", "PA")


def load_manifest():
    with open(MANIFEST, "r", encoding="utf-8") as f:
        return json.load(f)


class TestMaterials(unittest.TestCase):
    """素材包结构、文件、尺寸、透明度与命名规范。"""

    @classmethod
    def setUpClass(cls):
        cls.manifest = load_manifest()
        cls.items = cls.manifest["items"]
        cls.by_cat = {}
        for it in cls.items:
            cls.by_cat.setdefault(it["cat"], []).append(it)

    # ---- ① manifest 可解析且 version == 1 ------------------------------- #
    def test_manifest_parses_and_version(self):
        self.assertEqual(self.manifest["version"], 1)
        self.assertIn("categories", self.manifest)
        self.assertIn("items", self.manifest)
        self.assertEqual(self.manifest.get("generator"), "make_materials.py")
        self.assertIn("generated_at", self.manifest)
        self.assertIsInstance(self.items, list)
        self.assertTrue(self.items, "items 不能为空")

    def test_categories_match_spec(self):
        ids = [c["id"] for c in self.manifest["categories"]]
        self.assertEqual(sorted(ids), sorted(CAT_NAMES.keys()))
        for c in self.manifest["categories"]:
            self.assertEqual(c["name"], CAT_NAMES[c["id"]])
            self.assertEqual(c["count"], len(self.by_cat.get(c["id"], [])))
            self.assertEqual(c["count"], sum(1 for i in self.items if i["cat"] == c["id"]))

    # ---- ② 8 个分类数量达标 --------------------------------------------- #
    def test_category_min_counts(self):
        for cat, mn in MIN_COUNT.items():
            n = len(self.by_cat.get(cat, []))
            self.assertGreaterEqual(n, mn, "分类 %s 数量不足：%d < %d" % (cat, n, mn))

    def test_total_count(self):
        self.assertGreaterEqual(len(self.items), 144)

    # ---- ③ 每条 item 的 file / thumb 实际存在 ---------------------------- #
    def test_files_and_thumbs_exist(self):
        missing = []
        for it in self.items:
            for key in ("file", "thumb"):
                rel = it.get(key) or ""
                self.assertNotIn("\\", rel, "路径必须用正斜杠：%s" % rel)
                p = os.path.join(MATERIALS, rel.replace("/", os.sep))
                if not os.path.isfile(p):
                    missing.append(rel)
                elif os.path.getsize(p) == 0:
                    missing.append("空文件: " + rel)
        self.assertEqual(missing, [], "缺失文件：%s" % missing[:10])

    def test_file_extension_matches_alpha(self):
        for it in self.items:
            if it["alpha"]:
                self.assertTrue(it["file"].endswith(".png"), it["id"])
            else:
                self.assertTrue(it["file"].endswith(".jpg"), it["id"])

    def test_thumb_size_within_limit(self):
        # 抽 12 张缩略图确认最长边 <= 240 且保留 alpha
        for it in self.items[:: max(1, len(self.items) // 12)]:
            p = os.path.join(MATERIALS, it["thumb"].replace("/", os.sep))
            with Image.open(p) as im:
                self.assertLessEqual(max(im.size), 240, it["id"])
                if it["alpha"]:
                    self.assertIn(im.mode, ALPHA_MODES, "%s 缩略图丢了 alpha" % it["id"])

    # ---- ④ 实际宽高与 manifest 一致 ------------------------------------- #
    def test_dimensions_match_manifest(self):
        bad = []
        for it in self.items:
            p = os.path.join(MATERIALS, it["file"].replace("/", os.sep))
            with Image.open(p) as im:
                if tuple(im.size) != (it["w"], it["h"]):
                    bad.append("%s: manifest %sx%s 实际 %sx%s"
                               % (it["id"], it["w"], it["h"], im.size[0], im.size[1]))
        self.assertEqual(bad, [], "尺寸不一致：%s" % bad[:10])

    def test_manifest_size_positive(self):
        for it in self.items:
            self.assertGreater(it["w"], 0, it["id"])
            self.assertGreater(it["h"], 0, it["id"])

    # ---- ⑤ alpha=true 的图确实含透明像素（抽稀采样） --------------------- #
    def test_alpha_true_has_transparent_pixels(self):
        bad = []
        for it in self.items:
            if not it["alpha"]:
                continue
            p = os.path.join(MATERIALS, it["file"].replace("/", os.sep))
            with Image.open(p) as im:
                if im.mode not in ALPHA_MODES:
                    bad.append("%s 模式为 %s" % (it["id"], im.mode))
                    continue
                alpha = im.convert("RGBA").getchannel("A")
                # 抽稀：每 7 像素取一个，避免整图加载
                w, h = alpha.size
                alpha = alpha.crop((0, 0, w, h)).resize((max(1, w // 7), max(1, h // 7)), Image.NEAREST)
                lo = alpha.getextrema()[0]
                if lo >= 255:
                    bad.append(it["id"])
        self.assertEqual(bad, [], "alpha=true 但没有透明像素：%s" % bad[:10])

    def test_jpg_is_opaque(self):
        for it in self.items:
            if it["alpha"]:
                continue
            p = os.path.join(MATERIALS, it["file"].replace("/", os.sep))
            with Image.open(p) as im:
                self.assertEqual(im.mode, "RGB", "%s 应为不透明 RGB" % it["id"])
                self.assertEqual(im.format, "JPEG", it["id"])

    # ---- ⑥ id 全局唯一且以 <cat>_ 开头 ---------------------------------- #
    def test_ids_unique_and_prefixed(self):
        seen = set()
        for it in self.items:
            iid = it["id"]
            self.assertNotIn(iid, seen, "重复 id: %s" % iid)
            seen.add(iid)
            self.assertRegex(iid, ID_RE)
            self.assertTrue(iid.startswith(it["cat"] + "_"), iid)
            self.assertIn(it["cat"], CAT_NAMES)

    def test_item_paths_use_id_and_cat(self):
        for it in self.items:
            self.assertEqual(it["file"], "%s/%s%s" % (it["cat"], it["id"],
                                                      os.path.splitext(it["file"])[1]))
            self.assertEqual(it["thumb"], "thumbs/%s/%s.png" % (it["cat"], it["id"]))

    # ---- ⑦ dominant 是合法 #rrggbb -------------------------------------- #
    def test_dominant_color_format(self):
        for it in self.items:
            self.assertRegex(it["dominant"], HEX_RE, it["id"])
            self.assertEqual(it["dominant"], it["dominant"].lower(), it["id"])

    def test_names_tags_desc(self):
        for it in self.items:
            self.assertTrue(it["name"].strip(), it["id"])
            self.assertGreaterEqual(len(it["tags"]), 3, "%s 标签不足 3 个" % it["id"])
            for t in it["tags"]:
                self.assertTrue(isinstance(t, str) and t.strip(), it["id"])
            self.assertTrue(it["desc"].strip(), it["id"])
            self.assertTrue(it["license"], it["id"])
            self.assertTrue(it["author"], it["id"])

    # ---- SPEC 2.1 尺寸形态约束（抽样，避免超时） ------------------------- #
    def test_shape_rules_sampled(self):
        for cat in ("tape", "sticker", "divider", "stamp", "title", "icon"):
            for it in self.by_cat.get(cat, [])[:4]:
                w, h = it["w"], it["h"]
                long_side, short_side = max(w, h), min(w, h)
                if cat == "tape":
                    self.assertGreaterEqual(long_side, 1200, it["id"])
                    self.assertTrue(120 <= short_side <= 420, "%s 短边 %d" % (it["id"], short_side))
                elif cat == "sticker":
                    self.assertTrue(300 <= w <= 800 and 300 <= h <= 800, it["id"])
                elif cat == "divider":
                    self.assertGreaterEqual(w, 800, it["id"])
                    self.assertTrue(40 <= h <= 200, "%s 高 %d" % (it["id"], h))
                elif cat == "stamp":
                    self.assertTrue(200 <= w <= 500 and 200 <= h <= 500, it["id"])
                elif cat == "title":
                    self.assertGreaterEqual(w, 800, it["id"])
                    self.assertTrue(80 <= h <= 260, "%s 高 %d" % (it["id"], h))
                elif cat == "icon":
                    self.assertTrue(64 <= w <= 256 and 64 <= h <= 256, it["id"])

    def test_paper_is_a5_150dpi(self):
        for it in self.by_cat.get("paper", []):
            self.assertEqual((it["w"], it["h"]), (1240, 1748), it["id"])
            self.assertFalse(it["alpha"], it["id"])

    def test_tile_flag_is_boolean(self):
        for it in self.items:
            self.assertIsInstance(it["tile"], bool, it["id"])
        self.assertTrue(any(it["tile"] for it in self.items), "至少要有一张可平铺素材")

    def test_generator_module_importable(self):
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                "make_materials", os.path.join(ROOT, "tools", "make_materials.py"))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            self.assertEqual(mod.SEED, 20260930)
            self.assertTrue(callable(mod.main))
            self.assertTrue(callable(mod.check_materials))
        finally:
            sys.path.pop(0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
