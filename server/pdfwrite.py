"""极简 PDF 1.4 写出器（SPEC 第 4 节）。

把一组图片按「铺满整页」的方式内嵌为 JPEG（``/DCTDecode``），手写
xref 表 / trailer / ``startxref``，输出合法 PDF 1.4。

仅使用 Python 标准库 + Pillow，不依赖 reportlab / pypdf 等任何第三方 PDF 库。

用法::

    result = images_to_pdf(["p1.png", "p2.png"], "out.pdf", 148, 210, dpi=300)
    # {"ok": True, "path": "...", "pages": 2, "bytes": 123456}
"""

from __future__ import annotations

import io
import os
import tempfile

from PIL import Image

MM_PER_INCH = 25.4
PT_PER_INCH = 72.0

# Pillow 10 起常量迁移到 Image.Resampling，这里做兼容
_LANCZOS = getattr(getattr(Image, "Resampling", Image), "LANCZOS", 1)

# 图像像素超过目标分辨率的这个倍数时才降采样，避免 PDF 体积失控
_OVERSAMPLE_LIMIT = 2.0


def mm_to_pt(mm):
    """毫米 → PDF 点（1 pt = 1/72 英寸）。"""
    return float(mm) / MM_PER_INCH * PT_PER_INCH


def _utf16_hex(text):
    """PDF 十六进制字符串（UTF-16BE 带 BOM），用于中文 /Title 等。"""
    payload = b"\xfe\xff" + str(text).encode("utf-16-be", "replace")
    return b"<" + payload.hex().upper().encode("ascii") + b">"


def _encode_jpeg(path, quality, target_w, target_h):
    """打开图片 → 转 RGB → 编码成 JPEG 字节，返回 ``(data, w, h)``。"""
    with Image.open(path) as image:
        image.load()
        if image.mode != "RGB":
            image = image.convert("RGB")
        width, height = image.size
        if width <= 0 or height <= 0:
            raise ValueError("图片尺寸非法")
        scale = max(width / float(target_w), height / float(target_h))
        if scale > _OVERSAMPLE_LIMIT:
            new_w = max(1, int(round(width / scale)))
            new_h = max(1, int(round(height / scale)))
            image = image.resize((new_w, new_h), _LANCZOS)
            width, height = image.size
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=quality, optimize=True)
        return buffer.getvalue(), width, height


def images_to_pdf(pages, out_path, page_w_mm, page_h_mm, dpi=300, quality=92, title=None):
    """把 ``pages`` 中的图片逐页铺满页面，写出一个 PDF 文件。

    :param pages: 图片文件路径列表（list[str]），每页一张，按含出血尺寸渲染。
    :param out_path: 输出 PDF 路径。
    :param page_w_mm: 页面宽（毫米）。
    :param page_h_mm: 页面高（毫米）。
    :param dpi: 目标分辨率，用于判断是否需要对超大图降采样。
    :param quality: 内嵌 JPEG 质量（1–100）。
    :param title: PDF 元数据标题（中文会写为 UTF-16BE 十六进制串）。
    :return: ``{"ok": True, "path": ..., "pages": n, "bytes": n}``
             或 ``{"ok": False, "error": "..."}``；不抛异常。
    """
    try:
        return _build_pdf(pages, out_path, page_w_mm, page_h_mm, dpi, quality, title)
    except Exception as exc:  # 不把栈抛给调用方
        return {"ok": False, "error": "PDF 导出失败：%s" % (exc,)}


def _build_pdf(pages, out_path, page_w_mm, page_h_mm, dpi, quality, title):
    if not isinstance(pages, (list, tuple)) or not pages:
        return {"ok": False, "error": "没有可导出的页面"}

    try:
        width_mm = float(page_w_mm)
        height_mm = float(page_h_mm)
    except (TypeError, ValueError):
        return {"ok": False, "error": "页面尺寸不合法"}
    if width_mm <= 0 or height_mm <= 0:
        return {"ok": False, "error": "页面尺寸必须大于 0"}

    if not out_path or not str(out_path).strip():
        return {"ok": False, "error": "缺少输出文件路径"}
    out_path = os.path.abspath(str(out_path))

    try:
        dpi = int(dpi)
    except (TypeError, ValueError):
        dpi = 300
    if dpi <= 0:
        dpi = 300
    try:
        quality = int(quality)
    except (TypeError, ValueError):
        quality = 92
    quality = max(1, min(quality, 100))

    width_pt = mm_to_pt(width_mm)
    height_pt = mm_to_pt(height_mm)
    target_w = max(1, int(round(width_mm / MM_PER_INCH * dpi)))
    target_h = max(1, int(round(height_mm / MM_PER_INCH * dpi)))

    encoded = []
    for index, page in enumerate(pages, 1):
        if not page:
            return {"ok": False, "error": "第 %d 页缺少图片路径" % index}
        if not os.path.isfile(str(page)):
            return {"ok": False, "error": "第 %d 页图片不存在：%s" % (index, page)}
        try:
            jpeg, pixel_w, pixel_h = _encode_jpeg(str(page), quality, target_w, target_h)
        except Exception as exc:
            return {"ok": False, "error": "第 %d 页图片无法转换：%s" % (index, exc)}
        encoded.append((jpeg, pixel_w, pixel_h))

    page_count = len(encoded)
    kids = [4 + 3 * i for i in range(page_count)]
    max_object = 3 + 3 * page_count  # 1 Catalog、2 Pages、3 Info，其后每页 3 个对象
    size = max_object + 1            # /Size 与 xref 条目数都包含 0 号自由对象

    out = bytearray()
    offsets = {}

    def begin(number):
        offsets[number] = len(out)
        out.extend(b"%d 0 obj\n" % number)

    # 文件头（第二行是 PDF 规范建议的二进制标记）
    out.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")

    # 1 —— 文档目录
    begin(1)
    out.extend(b"<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")

    # 2 —— 页面树
    begin(2)
    out.extend(b"<< /Type /Pages /Count %d /Kids [%s] >>\nendobj\n" % (
        page_count,
        b" ".join(b"%d 0 R" % kid for kid in kids),
    ))

    # 3 —— 文档信息（中文标题用 UTF-16BE 十六进制串）
    begin(3)
    out.extend(
        b"<< /Title " + _utf16_hex(title or "Journal Studio 手账") +
        b" /Producer (Journal Studio 1.0)" +
        b" /Creator (Journal Studio 1.0) >>\nendobj\n"
    )

    # 每页：Page / Contents / Image XObject
    for index, (jpeg, pixel_w, pixel_h) in enumerate(encoded):
        page_number = 4 + 3 * index
        content_number = page_number + 1
        image_number = page_number + 2
        content = ("q\n%.4f 0 0 %.4f 0 0 cm\n/Im0 Do\nQ\n" % (width_pt, height_pt)).encode("ascii")

        begin(page_number)
        out.extend((
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.4f %.4f] "
            "/Resources << /XObject << /Im0 %d 0 R >> /ProcSet [/PDF /ImageC] >> "
            "/Contents %d 0 R >>\nendobj\n"
            % (width_pt, height_pt, image_number, content_number)
        ).encode("ascii"))

        begin(content_number)
        out.extend(b"<< /Length %d >>\nstream\n" % len(content))
        out.extend(content)
        out.extend(b"\nendstream\nendobj\n")

        begin(image_number)
        out.extend((
            "<< /Type /XObject /Subtype /Image /Width %d /Height %d "
            "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n"
            % (pixel_w, pixel_h, len(jpeg))
        ).encode("ascii"))
        out.extend(jpeg)
        out.extend(b"\nendstream\nendobj\n")

    # xref 表
    xref_offset = len(out)
    out.extend(b"xref\n0 %d\n" % size)
    out.extend(b"0000000000 65535 f \n")  # 固定 20 字节一条
    for number in range(1, size):
        out.extend(b"%010d 00000 n \n" % offsets[number])

    # trailer + startxref + EOF
    out.extend(
        b"trailer\n<< /Size %d /Root 1 0 R /Info 3 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (size, xref_offset)
    )

    directory = os.path.dirname(out_path) or "."
    os.makedirs(directory, exist_ok=True)
    handle_fd, tmp_path = tempfile.mkstemp(prefix=".journal-pdf-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(handle_fd, "wb") as stream:
            stream.write(bytes(out))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp_path, out_path)
        tmp_path = None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    return {
        "ok": True,
        "path": out_path,
        "pages": page_count,
        "bytes": len(out),
    }


__all__ = ["images_to_pdf", "mm_to_pt"]
