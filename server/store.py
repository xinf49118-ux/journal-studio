"""用户素材库：本机落盘、线程安全、原子写入。

设计目标：
- 服务器重启后素材不丢；
- 任何时刻 JSON 索引与文件目录保持一致（先落文件、再改索引，写索引用临时文件 + os.replace）；
- 只依赖标准库与 Pillow。
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from PIL import Image

ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def _atomic_write_text(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _hex(rgb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % rgb


def inspect_image(path: Path) -> dict[str, Any]:
    """取图片的宽高、是否带透明通道、主色。失败时给出保守默认值，绝不抛异常。"""
    info: dict[str, Any] = {"w": 0, "h": 0, "alpha": False, "dominant": "#cccccc"}
    try:
        with Image.open(path) as img:
            info["w"], info["h"] = img.size
            has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
            info["alpha"] = bool(has_alpha)
            rgba = img.convert("RGBA")
            rgba.thumbnail((48, 48))
            px = list(rgba.getdata())
        visible = [(r, g, b) for (r, g, b, a) in px if a > 40]
        if visible:
            n = len(visible)
            info["dominant"] = _hex(
                (
                    sum(p[0] for p in visible) // n,
                    sum(p[1] for p in visible) // n,
                    sum(p[2] for p in visible) // n,
                )
            )
    except Exception:
        pass
    return info


class Library:
    """用户素材库。所有公开方法都是线程安全的。"""

    def __init__(self, data_dir: str | os.PathLike[str]) -> None:
        self.root = Path(data_dir)
        self.files_dir = self.root / "files"
        self.index_path = self.root / "library.json"
        self._lock = threading.RLock()
        self.files_dir.mkdir(parents=True, exist_ok=True)
        if not self.index_path.exists():
            _atomic_write_text(self.index_path, json.dumps({"version": 1, "items": []}, ensure_ascii=False, indent=2))
        self._items: list[dict[str, Any]] = []
        self._load()

    # ---------- 内部 ----------

    def _load(self) -> None:
        try:
            raw = json.loads(self.index_path.read_text(encoding="utf-8"))
            items = raw.get("items", []) if isinstance(raw, dict) else []
            self._items = [it for it in items if isinstance(it, dict) and it.get("id")]
        except Exception:
            # 索引损坏时不要让服务起不来：备份后重建
            try:
                self.index_path.replace(self.index_path.with_suffix(".corrupt.json"))
            except Exception:
                pass
            self._items = []
            self._save()

    def _save(self) -> None:
        _atomic_write_text(
            self.index_path,
            json.dumps({"version": 1, "items": self._items}, ensure_ascii=False, indent=2),
        )

    @staticmethod
    def _clean_name(name: str) -> str:
        name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", str(name or "")).strip()
        return name[:60] or "未命名素材"

    # ---------- 公开 ----------

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(it) for it in self._items]

    def get(self, item_id: str) -> dict[str, Any] | None:
        with self._lock:
            for it in self._items:
                if it["id"] == item_id:
                    return dict(it)
        return None

    def path(self, item_id: str) -> str | None:
        item = self.get(item_id)
        if not item:
            return None
        p = self.files_dir / Path(item["file"]).name
        return str(p) if p.exists() else None

    def add_bytes(
        self,
        data: bytes,
        ext: str,
        name: str = "",
        tags: list[str] | None = None,
        cat: str = "imported",
        origin: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """写入一份素材。失败抛 ValueError（由上层转成用户可读提示）。"""
        ext = (ext or ".png").lower()
        if not ext.startswith("."):
            ext = "." + ext
        if ext == ".jpeg":
            ext = ".jpg"
        if ext not in ALLOWED_EXT:
            raise ValueError(f"不支持的文件格式：{ext}（支持 png/jpg/webp/gif/bmp）")
        if not data:
            raise ValueError("文件内容为空")

        item_id = "lib_" + uuid.uuid4().hex[:10]
        target = self.files_dir / f"{item_id}{ext}"
        tmp = target.with_suffix(ext + ".part")
        tmp.write_bytes(data)
        try:
            with Image.open(tmp) as img:
                img.verify()
        except Exception:
            tmp.unlink(missing_ok=True)
            raise ValueError("这看起来不是一张有效的图片")
        os.replace(tmp, target)

        info = inspect_image(target)
        item = {
            "id": item_id,
            "name": self._clean_name(name) if name else f"导入素材_{item_id[-4:]}",
            "cat": cat or "imported",
            "tags": [str(t) for t in (tags or []) if str(t).strip()][:12] or ["导入"],
            "file": target.name,
            "w": info["w"],
            "h": info["h"],
            "alpha": info["alpha"],
            "dominant": info["dominant"],
            "bytes": target.stat().st_size,
            "added_at": _now(),
            "origin": origin or {"type": "upload"},
        }
        with self._lock:
            self._items.insert(0, item)
            self._save()
        return dict(item)

    def add_file(self, path: str | os.PathLike[str], **kwargs: Any) -> dict[str, Any]:
        p = Path(path)
        return self.add_bytes(p.read_bytes(), p.suffix, **kwargs)

    def delete(self, item_id: str) -> bool:
        with self._lock:
            for i, it in enumerate(self._items):
                if it["id"] == item_id:
                    fp = self.files_dir / Path(it["file"]).name
                    try:
                        fp.unlink(missing_ok=True)
                    except Exception:
                        pass
                    self._items.pop(i)
                    self._save()
                    return True
        return False

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {"count": len(self._items), "bytes": sum(int(it.get("bytes") or 0) for it in self._items)}
