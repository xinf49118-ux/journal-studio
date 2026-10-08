"""端到端自检：对着一个已经在跑的本地服务，把整条链路走一遍。

用法：
    python server\\server.py --port 8765 --no-browser   （另开一个窗口）
    python tests\\e2e_check.py                          （默认 8765）

覆盖：健康检查 → 静态资源 → 页面分析 → 素材入库 → 300dpi 渲染 → PNG/PDF 导出 →
      联网检索 → 远程图片入库 → 遍历攻击防护。
"""
from __future__ import annotations

import io
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from PIL import Image, ImageDraw  # noqa: E402

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765"

PASS, FAIL = [], []


def check(name: str, cond: bool, detail: str = "") -> None:
    (PASS if cond else FAIL).append(name)
    print(f"  {'✅' if cond else '❌'} {name}{('  —— ' + detail) if detail else ''}")


def req(path: str, method: str = "GET", data: bytes | None = None, ctype: str | None = None, timeout: int = 60):
    if "?" in path:
        head, _, query = path.partition("?")
        path = head + "?" + urllib.parse.quote(query, safe="=&%")
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if ctype:
        r.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read(), resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("Content-Type", "")


def make_page() -> bytes:
    img = Image.new("RGB", (1109, 1568), (255, 253, 247))
    d = ImageDraw.Draw(img)
    d.rectangle([80, 120, 520, 460], fill=(58, 92, 130))
    d.rectangle([620, 200, 1040, 268], fill=(246, 184, 200))
    for i in range(5):
        d.line([80, 620 + i * 34, 780 - i * 40, 620 + i * 34], fill=(90, 82, 76), width=4)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def main() -> int:
    print(f"== 端到端自检：{BASE} ==\n")

    print("[1] 服务与静态资源")
    status, body, _ = req("/api/health")
    health = json.loads(body) if status == 200 else {}
    check("健康检查 200", status == 200, f"status={status}")
    check("识别到内置素材数量", "materials" in health, f"materials={health.get('materials')}")
    check("PDF 模块可用", bool(health.get("pdf")))
    status, body, ctype = req("/")
    check("首页可访问", status == 200 and b"<html" in body.lower(), ctype)
    status, _, _ = req("/web/js/app.js")
    check("前端脚本可访问", status == 200)
    status, _, _ = req("/assets/%2e%2e/server/server.py")
    check("目录穿越被拦截（编码形式）", status == 404, f"status={status}")
    status, _, _ = req("/assets/../server/server.py")
    check("目录穿越被拦截（原样形式）", status == 404, f"status={status}")

    print("\n[2] 页面结构分析")
    page = make_page()
    status, body, _ = req("/api/analyze", "POST", page, "image/png")
    analysis = json.loads(body) if status == 200 else {}
    check("分析接口 200", status == 200, f"status={status}")
    check("识别出背景色", bool(analysis.get("background", {}).get("hex")), analysis.get("background", {}).get("hex", ""))
    check("识别出配色", len(analysis.get("palette", [])) >= 2, f"{len(analysis.get('palette', []))} 色")
    check("识别出区块", len(analysis.get("regions", [])) >= 2, f"{len(analysis.get('regions', []))} 块")
    check("给出建议纸张", analysis.get("suggest", {}).get("page_size") in ("A5", "A6", "A4", "B5"))
    status, body, _ = req("/api/analyze", "POST", b"not an image", "image/png")
    check("坏图返回 422 而非崩溃", status == 422, f"status={status}")

    print("\n[3] 素材入库")
    status, body, _ = req("/api/library/import?name=e2e-test.png&cat=imported&tags=自检", "POST", page, "image/png")
    item = json.loads(body).get("item", {}) if status == 200 else {}
    check("上传入库 200", status == 200, f"status={status}")
    check("入库返回尺寸", item.get("w") == 1109 and item.get("h") == 1568, f"{item.get('w')}x{item.get('h')}")
    lib_id = item.get("id", "")
    if lib_id:
        status, body, ctype = req(f"/media/{lib_id}")
        check("已入库素材可访问", status == 200 and ctype.startswith("image/"), ctype)
    status, body, _ = req("/api/library")
    check("素材库列表包含新素材", any(x.get("id") == lib_id for x in json.loads(body).get("items", [])))

    print("\n[4] 300dpi 渲染与导出")
    manifest = json.loads(req("/api/materials")[1])
    materials = manifest.get("items", [])
    layers = [
        {"id": "s1", "kind": "shape", "shape": "rect", "fill": "#f6dfe3",
         "x_mm": 15, "y_mm": 20, "w_mm": 60, "h_mm": 40, "rotate": -6, "opacity": 0.9},
        {"id": "t1", "kind": "text", "text": "2026.09.30 手账工坊", "font": "sans", "size_mm": 9,
         "color": "#5b4a3f", "x_mm": 15, "y_mm": 70, "rotate": 0, "opacity": 1, "align": "left"},
    ]
    if lib_id:
        layers.insert(0, {"id": "i1", "kind": "image", "ref": lib_id,
                          "x_mm": 15, "y_mm": 110, "w_mm": 60, "h_mm": 85, "rotate": 3, "opacity": 1})
    if materials:
        tape = next((m for m in materials if m["cat"] == "tape"), materials[0])
        layers.append({"id": "m1", "kind": "material", "ref": tape["id"],
                       "x_mm": 10, "y_mm": 150, "w_mm": 90, "h_mm": 22, "rotate": -4, "opacity": 1})
    request_body = json.dumps({
        "page": {"size": "A5", "dpi": 300, "bleed_mm": 3, "crop_marks": True, "orientation": "portrait"},
        "background": {"type": "color", "value": "#fffdf7"},
        "layers": layers,
    }).encode("utf-8")

    t0 = time.time()
    status, png, ctype = req("/api/render", "POST", request_body, "application/json")
    dt = time.time() - t0
    check("渲染接口 200", status == 200 and png[:8] == b"\x89PNG\r\n\x1a\n", f"status={status} {ctype}")
    if png[:8] == b"\x89PNG\r\n\x1a\n":
        img = Image.open(io.BytesIO(png))
        expect = (round(154 * 300 / 25.4), round(216 * 300 / 25.4))
        check("渲染尺寸 = A5+3mm 出血 @300dpi", img.size == expect, f"{img.size} vs {expect}")
        check("渲染耗时 < 15s", dt < 15, f"{dt:.2f}s")

    status, pdf, ctype = req("/api/export/pdf", "POST", request_body, "application/json")
    check("PDF 导出 200", status == 200 and pdf[:5] == b"%PDF-", f"status={status} {ctype}")
    check("PDF 结构完整", pdf.count(b" obj") == pdf.count(b"endobj") and b"%%EOF" in pdf[-1024:])
    check("PDF 体积合理", len(pdf) > 10000, f"{len(pdf)} bytes")

    status, png2, _ = req("/api/export/png", "POST", request_body, "application/json")
    check("PNG 导出 200", status == 200 and png2[:8] == b"\x89PNG\r\n\x1a\n")

    print("\n[5] 联网检索（离线时只提示，不算失败）")
    status, body, _ = req("/api/search?source=wikimedia&q=washi%20tape&limit=5")
    data = json.loads(body) if status == 200 else {}
    results = data.get("results", [])
    if data.get("error"):
        print(f"  ⚠️  Wikimedia 暂时不可用：{data['error']}（离线环境属正常）")
    else:
        check("检索返回结果", len(results) > 0, f"{len(results)} 条")
        check("结果带作者与许可", all(r.get("author") and r.get("license") for r in results),
              f"示例：{(results[0].get('author'), results[0].get('license')) if results else '无'}")
        if results:
            first = results[0]
            status, body, _ = req("/api/library/import-url", "POST",
                                  json.dumps({"url": first["thumb"], "meta": first, "name": "e2e联网素材"}).encode("utf-8"),
                                  "application/json")
            check("远程图片下载入库", status == 200 and json.loads(body).get("ok"), f"status={status}")

    print("\n[6] 健壮性（脏参数 / 并发）")
    status, body, _ = req("/api/search?source=wikimedia&q=test&limit=abc")
    check("limit 传非数字不会 500", status != 500, f"status={status}")
    status, body, _ = req("/api/search?source=不存在的源&q=test")
    check("未知素材源优雅降级", status != 500, f"status={status}")
    status, body, _ = req("/api/render", "POST",
                          json.dumps({"page": {"size": "A5", "dpi": "abc"},
                                      "background": {"type": "color", "value": "乱写"},
                                      "layers": [{"kind": "shape", "opacity": "abc", "w_mm": 1e9}]}).encode("utf-8"),
                          "application/json")
    check("脏渲染参数不会 500", status == 200, f"status={status}")
    status, body, _ = req("/api/analyze", "POST", b"\x00\x01\x02not-an-image", "image/png")
    check("非图片 body 返回 4xx 而非 500", 400 <= status < 500, f"status={status}")

    # 并发保存工程：曾经因为固定临时文件名 + 无锁，20 并发里 11 个 500
    project = {"version": 1, "page": {"size": "A5"}, "background": {"type": "color", "value": "#fff"}, "layers": []}
    payload = json.dumps(project).encode("utf-8")
    import concurrent.futures as cf

    def save_once(_):
        return req("/api/project", "POST", payload, "application/json")[0]

    with cf.ThreadPoolExecutor(max_workers=20) as pool:
        codes = list(pool.map(save_once, range(20)))
    check("20 并发保存工程全部成功", all(c == 200 for c in codes),
          f"状态码分布 {sorted(set(codes))}")
    status, body, _ = req("/api/project")
    check("并发后工程文件仍可正常读取", status == 200 and json.loads(body).get("ok"))

    print("\n[7] 前端静态资源")
    status, html, _ = req("/")
    check("打印容器 #print-root 存在", b'id="print-root"' in html,
          "缺了它浏览器打印会输出白纸")
    check("前端引用了 app.js 模块", b"js/app.js" in html)

    print("\n[8] 清理")
    if lib_id:
        status, body, _ = req(f"/api/library/item?id={lib_id}", "DELETE")
        check("删除素材", status == 200 and json.loads(body).get("ok"))

    print("\n" + "=" * 52)
    print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
    if FAIL:
        print("失败项：" + "、".join(FAIL))
    print("=" * 52)
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
