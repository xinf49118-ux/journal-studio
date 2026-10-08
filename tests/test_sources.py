"""sources.py / pdfwrite.py 自检（SPEC 第 3、4 节）。

运行方式（无需 pytest）::

    python tests/test_sources.py

设计原则：**离线也必须全绿**。

* 解析逻辑、下载逻辑、PDF 结构全部用 mock / 本地文件测试，不联网。
* 真实网络连通性只用 ``probe()`` 与一次真实检索做**软断言**：失败只打印警告，
  不判 fail（离线环境同样通过）。
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import socket
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from PIL import Image  # noqa: E402

from server import pdfwrite, sources  # noqa: E402


# --------------------------------------------------------------------------
# 测试夹具
# --------------------------------------------------------------------------

RESULT_FIELDS = {"id", "title", "thumb", "full", "page_url",
                 "author", "license", "width", "height", "source"}

WIKIMEDIA_PAYLOAD = {
    "query": {
        "searchinfo": {"totalhits": 137},
        "pages": {
            "123": {
                "pageid": 123,
                "title": "File:Washi tape.jpg",
                "imageinfo": [{
                    "url": "https://upload.wikimedia.org/wikipedia/commons/a/ab/Washi_tape.jpg"
                           "?utm_source=commons.wikimedia.org&utm_content=original",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Washi_tape.jpg",
                    "thumburl": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/"
                                "Washi_tape.jpg/800px-Washi_tape.jpg?utm_content=thumbnail",
                    "width": 4032,
                    "height": 3024,
                    "extmetadata": {
                        "Artist": {"value": "<a href='#'>Somebody</a>"},
                        "LicenseShortName": {"value": "CC BY-SA 4.0"},
                    },
                }],
            },
            # 没有 imageinfo 的条目必须被跳过
            "124": {"pageid": 124, "title": "File:Broken.jpg"},
        },
    },
}

ARTIC_PAYLOAD = {
    "pagination": {"total": 2},
    "data": [
        {
            "id": 145,
            "title": "Water Lilies",
            "image_id": "3c27b499-af56-f0d5-a9b5-4b0f2a2f1a11",
            "artist_display": "Claude Monet\nFrench, 1840-1926",
            "is_public_domain": True,
            "thumbnail": {"width": 3000, "height": 2000},
        },
        {  # 无图，必须被跳过
            "id": 146,
            "title": "Text only",
            "image_id": None,
            "artist_display": "",
            "is_public_domain": False,
        },
    ],
}

MET_SEARCH_PAYLOAD = {"total": 3, "objectIDs": [1, 2, 3]}

MET_OBJECTS = {
    1: {
        "objectID": 1,
        "title": "Vase with Flowers",
        "primaryImageSmall": "https://images.metmuseum.org/small/1.jpg",
        "primaryImage": "https://images.metmuseum.org/full/1.jpg",
        "artistDisplayName": "Unknown Maker",
        "objectURL": "https://www.metmuseum.org/art/collection/search/1",
        "isPublicDomain": True,
    },
    3: {  # 没有图片，必须被跳过
        "objectID": 3,
        "title": "No Image",
        "primaryImageSmall": "",
        "primaryImage": "",
        "artistDisplayName": "",
        "objectURL": "",
        "isPublicDomain": False,
    },
}

OPENVERSE_PAYLOAD = {
    "result_count": 12,
    "results": [{
        "id": "abc-123",
        "title": "Washi tape rolls",
        "url": "https://live.staticflickr.com/1/2_washi.jpg",
        "thumbnail": "https://api.openverse.org/v1/images/abc-123/thumb/",
        "creator": "Alice",
        "license": "by-sa",
        "license_version": "4.0",
        "foreign_landing_url": "https://www.flickr.com/photos/1",
        "width": 1024,
        "height": 768,
    }],
}


def _json_response(payload, content_type="application/json"):
    return json.dumps(payload).encode("utf-8"), content_type


def _image_bytes(fmt="JPEG", size=(640, 480), color=(210, 120, 90)):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format=fmt)
    return buffer.getvalue()


class _SpyExecutor:  # 记录 met 适配器实际的并发上限
    seen = []

    def __new__(cls, max_workers=None, **kwargs):
        cls.seen.append(max_workers)
        from concurrent.futures import ThreadPoolExecutor
        return ThreadPoolExecutor(max_workers=max_workers, **kwargs)


# --------------------------------------------------------------------------
# 契约与解析
# --------------------------------------------------------------------------

class TestSearchContract(unittest.TestCase):

    def test_sources_constant_matches_spec(self):
        self.assertEqual(sources.SOURCES, ["wikimedia", "artic", "met", "openverse"])
        self.assertEqual(sources.TIMEOUT, 20)
        self.assertEqual(sources.USER_AGENT, "JournalStudio/1.0 (local; +https://localhost)")

    def test_unknown_source_returns_error_without_raising(self):
        result = sources.search("flickr", "washi tape")
        self.assertEqual(result["source"], "flickr")
        self.assertEqual(result["results"], [])
        self.assertIn("error", result)
        self.assertEqual(result["total"], 0)

    def test_empty_query_returns_error(self):
        result = sources.search("met", "   ")
        self.assertEqual(result["results"], [])
        self.assertIn("error", result)

    def test_wikimedia_parsing(self):
        with mock.patch.object(sources, "_http_get", lambda *a, **k: _json_response(WIKIMEDIA_PAYLOAD)):
            result = sources.search("wikimedia", "washi tape", limit=24)
        self.assertNotIn("error", result)
        self.assertEqual(result["source"], "wikimedia")
        self.assertEqual(result["query"], "washi tape")
        self.assertEqual(result["total"], 137)
        self.assertEqual(len(result["results"]), 1)
        item = result["results"][0]
        self.assertEqual(set(item), RESULT_FIELDS)
        self.assertEqual(item["id"], "wikimedia:File:Washi tape.jpg")
        self.assertEqual(item["title"], "Washi tape.jpg")
        self.assertEqual(item["author"], "Somebody")          # HTML 标签已剥离
        self.assertEqual(item["license"], "CC BY-SA 4.0")
        self.assertEqual((item["width"], item["height"]), (4032, 3024))
        self.assertTrue(item["thumb"].startswith("https://upload.wikimedia.org/"))
        # Wikimedia 新增的 utm_* 跟踪参数必须被清掉（SPEC 示例是干净链接）
        self.assertNotIn("utm_", item["thumb"])
        self.assertNotIn("utm_", item["full"])
        self.assertNotIn("?", item["full"])
        self.assertEqual(item["source"], "wikimedia")

    def test_wikimedia_missing_metadata_falls_back(self):
        payload = {"query": {"pages": {"1": {
            "pageid": 1, "title": "File:X.png",
            "imageinfo": [{"url": "https://x/1.png", "extmetadata": {}}],
        }}}}
        with mock.patch.object(sources, "_http_get", lambda *a, **k: _json_response(payload)):
            items = sources.search("wikimedia", "x")["results"]
        self.assertEqual(items[0]["author"], "未标注")
        self.assertEqual(items[0]["license"], "未标注")
        # 没有 thumburl 时回退到原图
        self.assertEqual(items[0]["thumb"], "https://x/1.png")

    def test_artic_parsing_and_iiif_url(self):
        with mock.patch.object(sources, "_http_get", lambda *a, **k: _json_response(ARTIC_PAYLOAD)):
            result = sources.search("artic", "monet")
        self.assertNotIn("error", result)
        # ArtIC 的 pagination.total 是全库数量（实测恒为 133118），刻意不采用，
        # 这里报告实际返回条数，避免前端显示「共 133118 条」误导用户。
        self.assertEqual(result["total"], 1)
        self.assertEqual(len(result["results"]), 1)
        item = result["results"][0]
        self.assertEqual(set(item), RESULT_FIELDS)
        image_id = "3c27b499-af56-f0d5-a9b5-4b0f2a2f1a11"
        self.assertEqual(item["thumb"],
                         "https://www.artic.edu/iiif/2/%s/full/843,/0/default.jpg" % image_id)
        self.assertIn("/full/full/0/default.jpg", item["full"])
        self.assertEqual(item["page_url"], "https://www.artic.edu/artworks/145")
        self.assertEqual(item["license"], sources.PUBLIC_DOMAIN_LICENSE)
        self.assertTrue(item["author"].startswith("Claude Monet"))
        self.assertEqual((item["width"], item["height"]), (3000, 2000))

    def test_met_two_step_and_partial_failure_tolerated(self):
        def fake(url, timeout=sources.TIMEOUT, max_bytes=None):
            if "/search?" in url:
                return _json_response(MET_SEARCH_PAYLOAD)
            match = re.search(r"/objects/(\d+)$", url)
            if match:
                oid = int(match.group(1))
                if oid == 2:  # 单个 object 失败必须被吞掉
                    raise urllib.error.URLError("模拟单条藏品请求失败")
                return _json_response(MET_OBJECTS[oid])
            raise AssertionError("意外的 URL: %s" % url)

        with mock.patch.object(sources, "_http_get", fake):
            result = sources.search("met", "vase")
        self.assertNotIn("error", result)
        self.assertEqual(result["total"], 3)
        self.assertEqual(len(result["results"]), 1)       # 失败 1 个、无图 1 个，仅剩 1 个
        item = result["results"][0]
        self.assertEqual(set(item), RESULT_FIELDS)
        self.assertEqual(item["id"], "met:1")
        self.assertEqual(item["thumb"], "https://images.metmuseum.org/small/1.jpg")
        self.assertEqual(item["full"], "https://images.metmuseum.org/full/1.jpg")
        self.assertEqual(item["author"], "Unknown Maker")
        self.assertEqual(item["license"], sources.PUBLIC_DOMAIN_LICENSE)

    def test_met_concurrency_capped_at_six(self):
        ids = list(range(100, 112))
        payload = {"total": len(ids), "objectIDs": ids}

        def fake(url, timeout=sources.TIMEOUT, max_bytes=None):
            if "/search?" in url:
                return _json_response(payload)
            oid = int(re.search(r"/objects/(\d+)$", url).group(1))
            return _json_response({
                "objectID": oid, "title": "T%d" % oid,
                "primaryImageSmall": "https://images.metmuseum.org/s/%d.jpg" % oid,
                "primaryImage": "https://images.metmuseum.org/f/%d.jpg" % oid,
                "artistDisplayName": "A", "objectURL": "u", "isPublicDomain": True,
            })

        _SpyExecutor.seen = []
        with mock.patch.object(sources, "ThreadPoolExecutor", _SpyExecutor):
            with mock.patch.object(sources, "_http_get", fake):
                result = sources.search("met", "vase", limit=12)
        self.assertEqual(len(result["results"]), 12)
        self.assertTrue(_SpyExecutor.seen)
        self.assertLessEqual(max(_SpyExecutor.seen), 6)
        self.assertEqual([item["id"] for item in result["results"]],
                         ["met:%d" % oid for oid in ids])       # 顺序与 objectIDs 一致

    def test_openverse_parsing(self):
        with mock.patch.object(sources, "_http_get", lambda *a, **k: _json_response(OPENVERSE_PAYLOAD)):
            result = sources.search("openverse", "washi tape")
        self.assertNotIn("error", result)
        self.assertEqual(result["total"], 12)
        item = result["results"][0]
        self.assertEqual(set(item), RESULT_FIELDS)
        self.assertEqual(item["license"], "CC BY-SA 4.0")
        self.assertEqual(item["author"], "Alice")
        self.assertEqual(item["page_url"], "https://www.flickr.com/photos/1")

    def test_http_error_degrades_gracefully(self):
        def boom(url, timeout=sources.TIMEOUT, max_bytes=None):
            raise urllib.error.HTTPError(url, 503, "Service Unavailable", {}, None)

        with mock.patch.object(sources, "_http_get", boom):
            result = sources.search("wikimedia", "washi tape")
        self.assertEqual(result["results"], [])
        self.assertEqual(result["total"], 0)
        self.assertIn("HTTP 503", result["error"])

    def test_http_error_messages_are_user_friendly(self):
        for code, keyword in ((403, "拒绝访问"), (404, "不存在"), (429, "频繁")):
            def boom(url, timeout=sources.TIMEOUT, max_bytes=None, _code=code):
                raise urllib.error.HTTPError(url, _code, "err", {}, None)

            with mock.patch.object(sources, "_http_get", boom):
                result = sources.search("artic", "flower")
            self.assertIn(keyword, result["error"])
            self.assertIn("HTTP %d" % code, result["error"])

    def test_timeout_degrades_gracefully(self):
        def slow(url, timeout=sources.TIMEOUT, max_bytes=None):
            raise socket.timeout("timed out")

        with mock.patch.object(sources, "_http_get", slow):
            result = sources.search("openverse", "flower")
        self.assertEqual(result["results"], [])
        self.assertIn("超时", result["error"])

    def test_non_json_body_degrades_gracefully(self):
        with mock.patch.object(sources, "_http_get",
                               lambda *a, **k: (b"<html>oops</html>", "text/html")):
            result = sources.search("artic", "flower")
        self.assertEqual(result["results"], [])
        self.assertIn("error", result)

    def test_limit_and_page_are_sanitised(self):
        seen = {}

        def fake(url, timeout=sources.TIMEOUT, max_bytes=None):
            seen["url"] = url
            return _json_response(OPENVERSE_PAYLOAD)

        with mock.patch.object(sources, "_http_get", fake):
            sources.search("openverse", "x", limit=999, page=-3)
        self.assertIn("page=1", seen["url"])
        self.assertIn("page_size=%d" % sources.MAX_LIMIT, seen["url"])


class _FakeHttpResponse:
    """最小可用的 urllib 响应替身（供 _http_get 的底层测试使用）。"""

    def __init__(self, body, content_type="application/json", encoding=""):
        self._body = body
        self.headers = {"Content-Type": content_type, "Content-Encoding": encoding}
        self.status = 200

    def read(self, size=-1):
        data, self._body = self._body, b""
        return data

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class TestHttpGetLayer(unittest.TestCase):
    """网络层：UA、重试、gzip 容错。"""

    def test_uses_spec_user_agent_and_timeout(self):
        seen = {}

        def fake_urlopen(request, timeout=None):
            seen["ua"] = request.headers.get("User-agent") or request.headers.get("User-Agent")
            seen["timeout"] = timeout
            return _FakeHttpResponse(b'{"ok": 1}')

        with mock.patch.object(sources.urllib.request, "urlopen", fake_urlopen):
            data, ctype = sources._http_get("https://example.com/x", sources.TIMEOUT)
        self.assertEqual(seen["ua"], sources.USER_AGENT)
        self.assertEqual(seen["timeout"], 20)
        self.assertEqual(data, b'{"ok": 1}')
        self.assertEqual(ctype, "application/json")

    def test_retries_once_on_503_then_succeeds(self):
        attempts = []
        sleeps = []

        def fake_urlopen(request, timeout=None):
            attempts.append(request.full_url)
            if len(attempts) == 1:
                raise urllib.error.HTTPError(request.full_url, 503, "busy", {}, None)
            return _FakeHttpResponse(json.dumps(WIKIMEDIA_PAYLOAD).encode())

        with mock.patch.object(sources.urllib.request, "urlopen", fake_urlopen):
            with mock.patch.object(sources.time, "sleep", lambda s: sleeps.append(s)):
                result = sources.search("wikimedia", "washi tape")
        self.assertEqual(len(attempts), 2)                 # 恰好重试一次
        self.assertEqual(sleeps, [sources.RETRY_BACKOFF])  # 短退避
        self.assertNotIn("error", result)
        self.assertEqual(len(result["results"]), 1)

    def test_retries_on_429_but_not_on_404(self):
        for code, expected_calls in ((429, 2), (404, 1)):
            calls = []

            def fake_urlopen(request, timeout=None, _c=code):
                calls.append(_c)
                raise urllib.error.HTTPError(request.full_url, _c, "err", {}, None)

            with mock.patch.object(sources.urllib.request, "urlopen", fake_urlopen):
                with mock.patch.object(sources.time, "sleep", lambda s: None):
                    result = sources.search("artic", "flower")
            self.assertEqual(len(calls), expected_calls, "HTTP %d 重试次数不对" % code)
            self.assertIn("error", result)

    def test_gzip_body_is_decoded_without_crashing(self):
        import gzip as gzip_module
        body = gzip_module.compress(json.dumps(WIKIMEDIA_PAYLOAD).encode())
        with mock.patch.object(sources.urllib.request, "urlopen",
                               lambda *a, **k: _FakeHttpResponse(body, encoding="gzip")):
            result = sources.search("wikimedia", "washi tape")
        self.assertNotIn("error", result)
        self.assertEqual(len(result["results"]), 1)

    def test_broken_gzip_does_not_crash(self):
        with mock.patch.object(sources.urllib.request, "urlopen",
                               lambda *a, **k: _FakeHttpResponse(b"not gzip", encoding="gzip")):
            data, _ctype = sources._http_get("https://example.com/x")
        self.assertEqual(data, b"not gzip")


# --------------------------------------------------------------------------
# 下载
# --------------------------------------------------------------------------

class TestDownload(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="journal-dl-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _names(self):
        return sorted(os.listdir(self.tmp))

    def test_download_ok_and_extension_matches_content_type(self):
        payload = _image_bytes("JPEG")
        with mock.patch.object(sources, "_http_get", lambda *a, **k: (payload, "image/jpeg")):
            result = sources.download("https://example.com/photos/washi.jpg", self.tmp)
        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["bytes"], len(payload))
        self.assertEqual(result["ext"], ".jpg")
        self.assertEqual(result["content_type"], "image/jpeg")
        self.assertTrue(os.path.isabs(result["path"]))
        with Image.open(result["path"]) as image:
            self.assertEqual(image.format, "JPEG")
        self.assertEqual(self._names(), [os.path.basename(result["path"])])

    def test_download_png_and_filename_sanitising(self):
        payload = _image_bytes("PNG")
        with mock.patch.object(sources, "_http_get", lambda *a, **k: (payload, "image/png; charset=binary")):
            result = sources.download("https://example.com/a.png", self.tmp,
                                      filename='我的手账<素材>:"|?*.jpg')
        self.assertTrue(result["ok"], result.get("error"))
        name = os.path.basename(result["path"])
        self.assertFalse(set(name) & set('<>:"/\\|?*'))
        self.assertTrue(name.startswith("我的手账"))
        self.assertEqual(result["ext"], ".png")          # 以真实格式为准
        self.assertTrue(name.endswith(".png"))
        self.assertLessEqual(len(name), sources.MAX_FILENAME_LEN)

    def test_download_uppercase_url_extension(self):
        payload = _image_bytes("JPEG")
        with mock.patch.object(sources, "_http_get", lambda *a, **k: (payload, "")):
            result = sources.download("https://example.com/BIG-PHOTO.JPEG", self.tmp)
        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["ext"], ".jpg")

    def test_download_avoids_overwriting(self):
        payload = _image_bytes("JPEG")
        with mock.patch.object(sources, "_http_get", lambda *a, **k: (payload, "image/jpeg")):
            first = sources.download("https://example.com/a.jpg", self.tmp, filename="same.jpg")
            second = sources.download("https://example.com/a.jpg", self.tmp, filename="same.jpg")
        self.assertTrue(first["ok"] and second["ok"])
        self.assertNotEqual(first["path"], second["path"])
        self.assertEqual(len(self._names()), 2)
        self.assertTrue(second["path"].endswith("_1.jpg"))

    def test_download_rejects_oversize_and_leaves_no_temp_file(self):
        with mock.patch.object(sources, "_http_get",
                               lambda *a, **k: (b"\x89PNG" + b"0" * 5000, "image/png")):
            result = sources.download("https://example.com/big.png", self.tmp, max_bytes=1024)
        self.assertFalse(result["ok"])
        self.assertIn("上限", result["error"])
        self.assertEqual(self._names(), [])

    def test_download_raises_toolarge_from_real_streaming_path(self):
        class _FakeResponse:
            headers = {"Content-Type": "image/png"}

            def __init__(self):
                self.calls = 0

            def read(self, size=-1):
                self.calls += 1
                return b"x" * 4096 if self.calls <= 5 else b""

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        with mock.patch.object(sources.urllib.request, "urlopen", lambda *a, **k: _FakeResponse()):
            result = sources.download("https://example.com/big.png", self.tmp, max_bytes=8192)
        self.assertFalse(result["ok"])
        self.assertIn("上限", result["error"])
        self.assertEqual(self._names(), [])

    def test_download_rejects_non_image(self):
        with mock.patch.object(sources, "_http_get",
                               lambda *a, **k: (b"<html>nope</html>", "text/html")):
            result = sources.download("https://example.com/page.html", self.tmp)
        self.assertFalse(result["ok"])
        self.assertIn("不是图片", result["error"])
        self.assertEqual(self._names(), [])

    def test_download_rejects_invalid_url(self):
        for bad in ["", "   ", "not-a-url", "file:///C:/secret.jpg", "ftp://example.com/a.jpg"]:
            result = sources.download(bad, self.tmp)
            self.assertFalse(result["ok"], "应拒绝：%r" % bad)
            self.assertIn("error", result)
        self.assertEqual(self._names(), [])

    def test_download_handles_empty_body_and_network_error(self):
        with mock.patch.object(sources, "_http_get", lambda *a, **k: (b"", "image/jpeg")):
            self.assertFalse(sources.download("https://example.com/a.jpg", self.tmp)["ok"])

        def boom(url, timeout=sources.TIMEOUT, max_bytes=None):
            raise urllib.error.URLError("断网了")

        with mock.patch.object(sources, "_http_get", boom):
            result = sources.download("https://example.com/a.jpg", self.tmp)
        self.assertFalse(result["ok"])
        self.assertIn("网络", result["error"])
        self.assertEqual(self._names(), [])

    def test_download_works_with_strict_two_arg_mock(self):
        payload = _image_bytes("PNG")

        def strict_mock(url, timeout):  # 老式 mock 只接受两个参数
            return payload, "image/png"

        with mock.patch.object(sources, "_http_get", strict_mock):
            result = sources.download("https://example.com/a.png", self.tmp)
        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["ext"], ".png")

    def test_safe_filename_rules(self):
        name = sources.safe_filename('a<b>c:d"e/f\\g|h?i*j\x01k.png')
        self.assertFalse(set(name) & set('<>:"/\\|?*'))
        self.assertNotIn("\x01", name)
        self.assertTrue(name.endswith(".png"))
        long_name = sources.safe_filename("x" * 300 + ".jpeg")
        self.assertLessEqual(len(long_name), sources.MAX_FILENAME_LEN)
        self.assertTrue(long_name.endswith(".jpeg"))
        self.assertEqual(sources.safe_filename("...", ".jpg"), "image.jpg")


# --------------------------------------------------------------------------
# 探针与真实网络（软断言）
# --------------------------------------------------------------------------

class TestProbeAndNetwork(unittest.TestCase):

    def test_probe_shape_and_never_raises(self):
        report = sources.probe()          # 离线也必须正常返回，不许抛异常
        self.assertEqual(set(report), {"wikimedia", "artic", "met"})
        for name, info in report.items():
            self.assertIn("ok", info)
            self.assertIn("ms", info)
            self.assertIn("error", info)
            self.assertIsInstance(info["ok"], bool)
            self.assertIsInstance(info["ms"], int)
            if info["ok"]:
                self.assertIsNone(info["error"])
            else:
                # 软断言：失败只警告，不算 fail
                print("  [警告] 探针 %s 不可用：%s" % (name, info["error"]))

    def test_probe_survives_total_network_failure(self):
        def boom(url, timeout=sources.TIMEOUT, max_bytes=None):
            raise urllib.error.URLError("完全断网")

        with mock.patch.object(sources, "_http_get", boom):
            report = sources.probe()
        self.assertEqual(set(report), {"wikimedia", "artic", "met"})
        for info in report.values():
            self.assertFalse(info["ok"])
            self.assertIsInstance(info["ms"], int)

    def test_real_search_soft(self):
        """真实联网检索：离线/超时都只打印警告，不判失败。"""
        for source, query in (("wikimedia", "washi tape"), ("artic", "flower")):
            try:
                result = sources.search(source, query, limit=3)
            except Exception as exc:  # 绝不该发生
                self.fail("search 抛异常了：%r" % (exc,))
            if result.get("error") or not result.get("results"):
                print("  [警告] %s 真实检索不可用：%s" % (source, result.get("error")))
                continue
            for item in result["results"]:
                missing = RESULT_FIELDS - set(item)
                self.assertFalse(missing, "字段缺失：%s" % missing)
                self.assertTrue(item["author"])
                self.assertTrue(item["license"])


# --------------------------------------------------------------------------
# PDF 写出器（本地校验，无需阅读器）
# --------------------------------------------------------------------------

class TestPdfWriter(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="journal-pdf-")
        self.images = []
        for index, color in enumerate([(240, 220, 230), (200, 220, 240)]):
            path = os.path.join(self.tmp, "page%d.png" % index)
            Image.new("RGB", (600, 850), color).save(path)
            self.images.append(path)
        self.out = os.path.join(self.tmp, "out.pdf")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_two_page_pdf_structure(self):
        result = pdfwrite.images_to_pdf(self.images, self.out, 148, 210,
                                        dpi=300, quality=90, title="手账工坊")
        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["pages"], 2)
        self.assertTrue(os.path.isfile(self.out))
        with open(self.out, "rb") as handle:
            data = handle.read()
        self.assertEqual(result["bytes"], len(data))

        self.assertTrue(data.startswith(b"%PDF-1.4"))
        self.assertIn(b"/Type /Catalog", data)
        self.assertIn(b"/Type /Pages", data)
        self.assertIn(b"/Count 2", data)
        self.assertIn(b"/DCTDecode", data)
        self.assertIn(b"/MediaBox [0 0 419.5276 595.2756]", data)  # 148/210mm → pt
        self.assertTrue(data.rstrip().endswith(b"%%EOF"))

        # 每个 obj 都有配对的 endobj
        self.assertEqual(len(re.findall(rb"\d+ 0 obj", data)), len(re.findall(rb"endobj", data)))

        # startxref 指向的位置确实是 xref
        tail = data[-200:]
        match = re.search(rb"startxref\s+(\d+)", tail)
        self.assertIsNotNone(match)
        offset = int(match.group(1))
        self.assertEqual(data[offset:offset + 4], b"xref")

        # xref 条目数 = 对象数 + 1（0 号自由对象）；且每条偏移确实指向 "<n> 0 obj"
        header = re.search(rb"xref\r?\n(\d+) (\d+)\r?\n", data[offset:])
        self.assertIsNotNone(header)
        self.assertEqual(int(header.group(1)), 0)
        size = int(header.group(2))
        object_count = len(re.findall(rb"\d+ 0 obj", data))
        self.assertEqual(size, object_count + 1)
        self.assertEqual(size, 10)  # 3 + 2 页 * 3
        self.assertRegex(data[offset:], rb"/Size 10")
        entries_start = offset + header.end()
        for number in range(1, size):
            entry = data[entries_start + 20 * number: entries_start + 20 * number + 20]
            self.assertEqual(len(entry), 20)
            self.assertTrue(entry.endswith(b" n \n"), entry)
            obj_offset = int(entry[:10])
            self.assertEqual(data[obj_offset:obj_offset + len(b"%d 0 obj" % number)],
                             b"%d 0 obj" % number)

        # 中文标题写成 UTF-16BE 十六进制串
        self.assertIn(b"/Title <FEFF", data)
        expected_hex = (b"\xfe\xff" + "手账工坊".encode("utf-16-be")).hex().upper().encode()
        self.assertIn(expected_hex, data)

        # 每页图片都能被 Pillow 解码（DCTDecode 数据本身合法）
        streams = re.findall(rb"stream\r?\n(.*?)\r?\nendstream", data, re.S)
        jpegs = [s for s in streams if s.startswith(b"\xff\xd8\xff")]
        self.assertEqual(len(jpegs), 2)
        for blob in jpegs:
            with Image.open(io.BytesIO(blob)) as image:
                self.assertEqual(image.format, "JPEG")

    def test_single_page_pdf(self):
        result = pdfwrite.images_to_pdf([self.images[0]], self.out, 105, 148)
        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["pages"], 1)
        with open(self.out, "rb") as handle:
            data = handle.read()
        self.assertIn(b"/Count 1", data)
        self.assertTrue(data.rstrip().endswith(b"%%EOF"))

    def test_failure_paths_return_dict(self):
        self.assertFalse(pdfwrite.images_to_pdf([], self.out, 148, 210)["ok"])
        self.assertFalse(pdfwrite.images_to_pdf(self.images, self.out, 0, 210)["ok"])
        self.assertFalse(pdfwrite.images_to_pdf(self.images, "", 148, 210)["ok"])
        missing = pdfwrite.images_to_pdf([os.path.join(self.tmp, "nope.png")], self.out, 148, 210)
        self.assertFalse(missing["ok"])
        self.assertIn("不存在", missing["error"])
        broken = os.path.join(self.tmp, "broken.png")
        with open(broken, "wb") as handle:
            handle.write(b"not an image")
        self.assertFalse(pdfwrite.images_to_pdf([broken], self.out, 148, 210)["ok"])
        self.assertFalse(os.path.exists(self.out))

    def test_mm_to_pt(self):
        self.assertAlmostEqual(pdfwrite.mm_to_pt(25.4), 72.0, places=6)


if __name__ == "__main__":
    unittest.main(verbosity=2)
