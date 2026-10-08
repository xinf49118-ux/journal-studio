# 手账工坊 Journal Studio — 接口契约（SPEC）

> 本文件是模块间的唯一权威契约。任何一方实现前先读本文件；实现不得擅自改名、改路径、改字段。
> 根目录：`D:\Documents\deepseek-harness\default-workspace\journal-studio`

## 0. 产品目标

本地网页应用，解决三件事：

1. **收集素材** —— 内置程序生成的原创素材包 + 本地导入 + 联网检索三大开放图库并下载入库。
2. **复刻页面** —— 上传别人的手账页面图片，自动提取背景色、配色、区块版式，再用素材库重排出一张同款页面（可继续手工编辑）。
3. **打印出来** —— A5/A6/A4/B5，300dpi，含出血线与裁切标记，支持浏览器打印、导出 PNG、导出 PDF。

约束：**仅使用 Python 标准库 + Pillow + numpy**（运行时不得依赖网络安装）。前端为原生 ES Module，无构建步骤、无 CDN。

## 1. 目录结构

```
journal-studio/
  SPEC.md
  README.md
  start.bat                    # Windows 一键启动
  server/
    __init__.py
    server.py                  # HTTP 服务 + 全部 API + 渲染
    analysis.py                # 页面结构/配色分析
    sources.py                 # 联网素材源适配器        [委派 B]
    pdfwrite.py                # 极简 PDF 写出器          [委派 B]
    store.py                   # 用户素材库落盘           [主线]
  tools/
    make_materials.py          # 内置素材包生成器         [委派 A]
    probe_sources.py           # 素材源连通性自检（可选）
  assets/materials/
    manifest.json              # 素材清单
    <cat>/<id>.png|jpg         # 素材本体
    thumbs/<cat>/<id>.png      # 240px 缩略图
  docs/screenshots/            # 界面截图（README 引用）
  web/
    index.html
    css/app.css
    js/core.js       # 状态、常量、图层工厂、渲染请求、撤销栈（纯逻辑，可在 Node 中直接 import）
    js/stage.js      # 真实毫米单位的舞台构建（屏幕预览与打印共用）
    js/api.js        # 服务端调用封装
    js/ui.js         # 提示条 / 加载遮罩 / DOM 助手
    js/library.js    # 素材库页签
    js/editor.js     # 编辑器页签
    js/recreate.js   # 复刻页签
    js/print.js      # 打印页签
    js/app.js        # 入口：页签、初始化、自动保存
  data/                        # 运行时生成：用户库索引与文件
    library.json
    files/<id>.<ext>
    project.json
  tests/
    test_materials.py          # [委派 A]
    test_sources.py            # [委派 B]
    test_analysis.py           # 分析引擎单测
    test_render.py             # 渲染引擎单测（几何/图层/导出）
    e2e_check.py               # 对着运行中的服务走完整 HTTP 链路
    contract_check.mjs         # Node 直接 import 前端 core.js，验证前后端数据契约
    browser_check.mjs          # Chrome DevTools 协议：真浏览器里驱动前端并截图
    fixtures/                  # 测试用样例手账页
```

## 2. 素材清单 manifest.json

`tools/make_materials.py` 生成，前端与服务器只读。

```json
{
  "version": 1,
  "generated_at": "2026-09-30T18:00:00+08:00",
  "generator": "make_materials.py",
  "categories": [
    {"id": "tape", "name": "和纸胶带", "count": 24},
    {"id": "paper", "name": "底纹纸", "count": 20}
  ],
  "items": [
    {
      "id": "tape_stripe_pink_01",
      "name": "粉色条纹胶带",
      "cat": "tape",
      "tags": ["胶带", "条纹", "粉色", "少女"],
      "file": "tape/tape_stripe_pink_01.png",
      "thumb": "thumbs/tape/tape_stripe_pink_01.png",
      "w": 1200, "h": 300,
      "alpha": true,
      "tile": false,
      "dominant": "#f6b8c8",
      "license": "CC0-1.0",
      "author": "Journal Studio 程序生成",
      "desc": "横向条纹，两端撕裂边"
    }
  ]
}
```

字段规则：

- `id`：全局唯一，`[a-z0-9_]+`，且以 `<cat>_` 开头。
- `cat` 必须是 `categories[].id` 之一，**固定为下列 8 类**：
  `paper` 底纹纸 / `tape` 和纸胶带 / `sticker` 贴纸 / `frame` 边框花边 / `divider` 分割线 /
  `stamp` 印章邮戳 / `title` 标题日期条 / `icon` 小图标。
- `file`/`thumb`：相对 `assets/materials/` 的 POSIX 风格相对路径（正斜杠）。
- `alpha`：true → `.png`，false → `.jpg`（不透明底纹纸用 jpg 控制体积）。
- `tile`：true 表示可无缝平铺（底纹纸/部分胶带），供编辑器"平铺"用。
- `dominant`：`#rrggbb`，主色，用于配色匹配。
- 所有中文文本用 UTF-8；`manifest.json` 用 `ensure_ascii=False, indent=2` 写出。
- 生成必须**确定性**：固定随机种子（`random.Random(20260930)` / `np.random.default_rng(20260930)`），重复运行产出字节一致（时间戳字段除外）。

命名规范：`<cat>_<风格>_<色系>_<序号两位>`，例如 `sticker_flower_pink_03`。

### 2.1 各类素材的最低要求

| cat | 数量 | 尺寸与形态 |
|---|---|---|
| `paper` | ≥20 | A5@150dpi（1240×1748）不透明底，可平铺优先：方格/点阵/横线/牛皮/米白/彩纸/水彩晕染/大理石纹/格纹/康奈尔 |
| `tape` | ≥24 | 长边 ≥1200px，短边 120–420px，**两端带撕裂边**，`alpha=true`，覆盖条纹/波点/格纹/碎花/星月/波浪/纯色/半透明 |
| `sticker` | ≥36 | 300–800px 见方，`alpha=true`，**带白色描边 + 柔和投影**，形状：标签/箭头/爱心/星星/花朵/叶子/云朵/气泡/蝴蝶结/日签 |
| `frame` | ≥10 | 直角/圆角/花边/胶带角贴/双线框，四边对称，内部透明 |
| `divider` | ≥12 | 高 40–200px、宽 ≥800px，alpha，虚线/波浪/蕾丝/点点/胶带撕边 |
| `stamp` | ≥10 | 200–500px，alpha，圆形/方形邮戳、日期戳、文字印章 |
| `title` | ≥12 | 宽 ≥800px、高 80–260px，alpha，标题底条/日期条/星期条/大写字牌 |
| `icon` | ≥20 | 64–256px，alpha，单色或双色，胶带卷/剪刀/笔/回形针/咖啡/云/太阳/月亮等 |

`tools/make_materials.py` 支持 `--only <cat>`、`--out <dir>`、`--check`（只校验不生成）。
生成完毕后自检：文件存在、尺寸与 manifest 一致、`alpha=true` 的图确实含透明像素、无重复 id。

## 3. 联网素材源 sources.py（委派 B）

仅用 `urllib.request`，统一超时 20s，统一 UA `JournalStudio/1.0 (local; +https://localhost)`。

```python
SOURCES = ["wikimedia", "artic", "met", "openverse"]

def search(source: str, query: str, limit: int = 24, page: int = 1) -> dict
def download(url: str, out_dir: str, filename: str | None = None,
             max_bytes: int = 20_000_000) -> dict
def probe() -> dict      # 三个源各做一次最小请求，返回 {"wikimedia": {"ok": bool, "ms": int, "error": str|None}, ...}
```

`search` 返回：

```json
{
  "source": "wikimedia",
  "query": "washi tape",
  "total": 137,
  "results": [
    {
      "id": "wikimedia:File:Washi tape.jpg",
      "title": "Washi tape.jpg",
      "thumb": "https://upload.wikimedia.org/.../800px-Washi_tape.jpg",
      "full": "https://upload.wikimedia.org/.../Washi_tape.jpg",
      "page_url": "https://commons.wikimedia.org/wiki/File:Washi_tape.jpg",
      "author": "Somebody",
      "license": "CC BY-SA 4.0",
      "width": 4032, "height": 3024,
      "source": "wikimedia"
    }
  ]
}
```

要求：

- 四个源任一不可用只影响自身，**不得抛异常破坏其它源**；`search` 失败返回 `{"source":..., "results":[], "error":"..."}`。
- `openverse` 在 20s 内无响应即视为不可用（本机实测超时），但适配器仍要实现。
- 结果必须带 `author` 与 `license`（缺省填 `"未标注"`），这是合规底线。
- `artic` 图片 URL 拼接：`https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg`；搜索字段 `id,title,image_id,artist_display,is_public_domain`。
- `wikimedia` 用 `action=query&generator=search&gsrnamespace=6&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=800`，`license` 取 `extmetadata.LicenseShortName.value`。
- `met` 两步：`/search?q=&hasImages=true` 取 objectIDs，再 `/objects/{id}` 取 `primaryImageSmall/primaryImage/title/artistDisplayName/objectURL/isPublicDomain`。限并发上限 6，仅取前 `limit` 个。
- `download`：校验 `Content-Type` 以 `image/` 开头或 URL 后缀为图片；超过 `max_bytes` 中止；返回
  `{"ok": true, "path": "<绝对路径>", "bytes": 12345, "content_type": "image/jpeg", "ext": ".jpg"}`；
  失败返回 `{"ok": false, "error": "..."}`，**不抛异常**。
- 文件名清洗：去掉 `<>:"/\|?*` 与控制字符，限长 80，保留扩展名。
- 所有网络函数可被 `tests/test_sources.py` mock（网络测试用 `probe()` 做连通性软断言，离线不得判失败）。

## 4. PDF 写出器 pdfwrite.py（委派 B）

```python
def images_to_pdf(pages, out_path, page_w_mm, page_h_mm, dpi=300, quality=92) -> dict
```

- `pages`：图片文件路径列表（list[str]）。每页一张图，**铺满整页**（图像已按含出血尺寸渲染）。
- 实现：Pillow 打开后转 RGB 存为 JPEG（quality），以 `DCTDecode` 内嵌，输出合法 PDF 1.4。
- 返回 `{"ok": true, "path": ..., "pages": n, "bytes": n}`；失败 `{"ok": false, "error": ...}`。
- 必须能被 Pillow/常见阅读器打开（测试用 `pypdf` 不可用，则用正则校验 `/Type /Catalog`、`%%EOF`、页数 `Count`）。
- 不得引入第三方库。

## 5. HTTP API（server.py，主线）

`http://127.0.0.1:8765`，全部返回 JSON（`Content-Type: application/json; charset=utf-8`），出错返回 `{"ok": false, "error": "..."}` 且带合适状态码。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` `/web/*` `/assets/*` | 静态文件（`/` → `web/index.html`），素材带长缓存头 |
| GET | `/api/health` | `{"ok":true,"version":1,"materials":n,"library":n,"sources":{...}}` |
| GET | `/api/materials` | 返回 manifest 原样 |
| GET | `/api/library` | 用户库索引 `{"ok":true,"items":[...]}` |
| POST | `/api/library/import` | 原始 body 上传图片；query `?name=&tags=&cat=`，返回新 item |
| POST | `/api/library/import-url` | JSON `{"url":..,"name":..,"tags":[..],"meta":{..}}` → 下载并入库 |
| DELETE | `/api/library/item?id=` | 删除用户素材（含文件） |
| GET | `/api/search?source=&q=&limit=&page=` | 代理 `sources.search` |
| GET | `/api/sources` | `sources.probe()` 结果 |
| POST | `/api/analyze` | body 为图片字节 → `analysis.analyze_image()` 结果 |
| POST | `/api/render` | JSON 渲染请求 → 返回 PNG 字节（`image/png`） |
| POST | `/api/export/png` | 同上但 `Content-Disposition: attachment` |
| POST | `/api/export/pdf` | JSON 渲染请求 → PDF 字节 |
| GET | `/api/project` / POST `/api/project` | 读写工程 JSON（`data/project.json`） |
| GET | `/media/<library_id>` | 用户素材文件 |

### 5.1 渲染请求 JSON（前后端共同契约，务必一致）

长度单位一律 **毫米**，坐标原点在**出血框左上角**。

```json
{
  "page": {"size": "A5", "w_mm": 148, "h_mm": 210, "dpi": 300,
           "bleed_mm": 3, "crop_marks": true, "orientation": "portrait"},
  "background": {"type": "color", "value": "#fffdf7"},
  "layers": [
    {"id": "L1", "kind": "material", "ref": "sticker_flower_pink_03",
     "x_mm": 20, "y_mm": 30, "w_mm": 40, "h_mm": 40,
     "rotate": -12, "opacity": 1.0, "flip_x": false, "flip_y": false,
     "tile": false, "blend": "normal"},
    {"id": "L2", "kind": "text", "text": "2026.09.30", "font": "sans",
     "size_mm": 8, "color": "#5b4a3f", "x_mm": 20, "y_mm": 120,
     "rotate": 0, "opacity": 1.0, "align": "left"},
    {"id": "L3", "kind": "image", "ref": "lib_ab12cd", "x_mm": 0, "y_mm": 0,
     "w_mm": 100, "h_mm": 80, "rotate": 0, "opacity": 1.0}
  ]
}
```

- `kind`: `material`（内置素材，`ref`=素材 id）/ `image`（用户库，`ref`=library id）/ `text` / `shape`（`shape` 为 `rect|ellipse|line`）。
- `page.size` ∈ `A5|A6|A4|B5|custom`；`A5=148×210`、`A6=105×148`、`A4=210×297`、`B5=176×250`（mm，竖版）。
- `background.type` ∈ `color|material|white`；`material` 时 `value` 为素材 id（`tile:true` 时按原尺寸平铺）。
- 服务端按 `dpi` 渲染：输出总尺寸 = `round((w_mm + 2*bleed_mm) * dpi/25.4)`；
  成品区宽高单独取整后**居中**放置（`ox = (W - content_w) // 2`），因此裁切后成品尺寸误差 ≤1px。
- `crop_marks` 为 true 时在出血区绘制角线与十字规矩线（不侵入成品区）。
- 图层按数组顺序**从下到上**绘制；`rotate` 为角度（逆时针为正）。
- 前端在发出请求前会剥掉仅供界面使用的 `name` / `locked` 字段；服务端遇到未知字段一律忽略。
- 字体：`sans`/`serif`/`mono` → 服务端在 `C:\Windows\Fonts` 中择优（`msyh.ttc`/`simhei.ttf`/`simsun.ttc`/`arial.ttf`）；找不到时回退 Pillow 默认字体并不得报错。
- **文字层行距契约**：服务端行距 = `1.35 × 字号`，首行字形上沿内缩 `0.175 × 字号`；
  前端 `.layer-el.text-el` 使用 `line-height: 1.35`，两端由此对齐，保证「预览 = 打印」。

### 5.2 分析结果 JSON（`/api/analyze`）

```json
{
  "ok": true,
  "image": {"w": 1240, "h": 1748, "aspect": 0.709, "preview": "data:image/jpeg;base64,..."},
  "background": {"hex": "#fffdf7", "plain": true, "texture": "none"},
  "palette": [{"hex": "#f6b8c8", "ratio": 0.21}, {"hex": "#5b4a3f", "ratio": 0.08}],
  "whitespace": 0.57,
  "style": {"mood": "pastel", "density": "airy", "warmth": "warm"},
  "regions": [
    {"x": 0.06, "y": 0.08, "w": 0.34, "h": 0.20,
     "type": "photo", "density": 0.82, "fill": "#e9d8c3", "aspect": 1.7}
  ],
  "suggest": {"page_size": "A5", "dpi": 300}
}
```

- 所有坐标/尺寸为占原图的 **0–1 归一化比例**，原点左上。
- `regions[].type` ∈ `photo|text|tape|decor|frame`。
- `preview` 最长边 ≤ 900px 的 JPEG data URI，供前端叠加显示。
- 分析必须在 8s 内完成 1240×1748 图片。

## 6. 用户素材库 store.py（主线）

`data/library.json`：

```json
{"version":1,"items":[{"id":"lib_ab12cd","name":"我的贴纸","cat":"imported",
 "tags":["导入"],"file":"files/lib_ab12cd.png","w":800,"h":600,"alpha":true,
 "dominant":"#eec9d2","added_at":"...","origin":{"type":"url","url":"...","author":"..","license":".."}}]}
```

`store.Library` 提供 `list() / add_file(path, name, tags, cat, origin) / add_bytes(data, ext, ...) / get(id) / delete(id) / path(id)`，线程安全（`threading.Lock`），写入原子（临时文件 + `os.replace`）。

## 7. 前端要求（主线）

- 四个标签页：**素材库 / 复刻 / 编辑器 / 打印**。
- 素材库：分类侧栏 + 搜索 + 来源筛选（内置/我的/联网结果）、懒加载缩略图、点击"加入画布"或拖拽。
- 复刻：拖入或选择图片 → 调 `/api/analyze` → 左侧显示原图与区块叠加框、配色条、版式信息；按钮【生成同款（重排）】【用作底图】；重排后自动跳编辑器。
- 编辑器：mm 坐标画布、A5/A6/A4/B5 切换、拖拽移动、8 点缩放、旋转、透明度、图层上下移/删除/复制/翻转、对齐吸附（网格/中轴/边距）、撤销重做（Ctrl+Z / Ctrl+Y）、工程保存/读取。缩放不影响导出精度。
- 打印：尺寸与出血、裁切标记开关、页边距线、打印预览、`window.print()`（`@page` 按尺寸设置、隐藏 UI）、导出 300dpi PNG、导出 PDF。
- 纯原生 ES Module，`<script type="module">`，无 CDN、无构建。中文字体栈 `"Microsoft YaHei", "PingFang SC", sans-serif`。

## 8. 质量红线

- 任何模块不得引入第三方运行时依赖（Pillow/numpy 除外）。
- 全中文界面；代码注释中文；错误提示面向普通用户，不抛栈。
- 所有落盘写操作原子；服务器重启后用户库不丢。
- 打印相关必须真跑一次渲染，确认成品区尺寸误差 ≤1px（300dpi）。
