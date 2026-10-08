# 独立验证报告

> **修复状态（作者补注，2026-09-30 18:2x）**：本报告发现的问题**已全部处理**，并按报告逐条补了回归测试，
> 现在跑 `tests/` 下的全部套件是 202 项通过 / 0 失败。修复清单如下，原始报告内容一字未改，保留在下方。
>
> | 报告编号 | 问题 | 处理 |
> |---|---|---|
> | 致命 1 | `index.html` 缺 `#print-root`，打印整体失效 | 已补容器；`tests/e2e_check.py` 新增断言，`tests/browser_check.mjs` 用 CDP 实测 `window.print` 调用次数与 print 媒体下的实际像素 |
> | 致命 2 | 平铺按素材像素而非自然毫米，预览/导出密度差一倍 | 服务端新增 `material_natural_mm()`，与前端 `naturalMm()` 同口径；新增 dpi 不变性回归测试 |
> | 致命 3 | 文字位置预览≠导出 | 服务端改用 `font.getmetrics()` 复刻浏览器的半行距/基线模型，前端用 canvas 实测文字盒并显式定宽；浏览器实测四边差分 ≤0.6mm |
> | 致命 4 | `flip_x/flip_y` 对文字/形状层不生效 | 两个绘制分支都补上翻转；新增像素差分回归测试 |
> | 致命 5 | 分析引擎把文字判成胶带，`text` 类型不可达 | 重写分类器（改用行/列覆盖率 + 边缘密度），新增多行文字合并；新增 6 条真实字体页面的类型回归测试 |
> | 致命 6 | 并发保存工程 500 | 加锁 + 唯一临时文件名；e2e 新增 20 并发断言 |
> | 次要 | 脏参数 500 / 字号无上限 / `line` 形状错位 / 保存按钮死 / 打印设置不同步 / 设为背景不刷新 / 预览无角线 / 小装饰被丢 / 素材缓存不刷新 / 断开刷 traceback | 逐条修复，多数已配回归测试 |
>
> 另外发现并修复了一处本报告未覆盖的**素材质量缺陷**：`alpha_mask()` 对灰度图返回全 255，
> 导致每张贴纸/图标都被糊上一整块 alpha≈76 的方形灰底（肉眼可见）。已修复并全量重新生成素材包。
>
> ---
>
> 验证者：独立验证工程师（对抗性复核）。只读源码，未修改任何被审文件。
> 环境：Python `C:\Users\AT1556\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`（Pillow 12.3.0 / numpy 2.3.5）、Node v24.21.0、Chrome（真实 CDP）。
> 所有破坏性实验跑在**独立端口 8799**的隔离服务上（用户库与工程文件指向 `_verify_tmp`，不碰项目 `data/`；第一轮用自造素材、第二轮直接用项目真实的 `assets/materials` 只读加载），未干扰 8765 上的服务。
> 每个结论都附可复现命令与真实输出。

### 验证快照（重要：验证期间作者在改代码）

我开始验证时（17:54）项目里**没有** `assets/` 目录。验证过程中作者改了三处：

| 时间 | 文件 | 影响 |
|---|---|---|
| 17:57:44 | `web/index.html` | 与本报告相关处无变化，`#print-root` 仍然缺失 |
| 17:57:53 | `server/server.py` | 仅行号位移，我报告的缺陷逻辑逐条仍在（下附复核） |
| 17:59:43 | `tools/make_materials.py` | **修好了重复 id**（id 改为带 ckey），18:01 生成了 181 件素材包 |

**本报告的结论均已在「修复后」的当前版本上重新复核过**（除 S2 本身，见该条）。复核所用版本（SHA256 前 12 位）：

```
E7AFA7545204 SPEC.md            C3D8D065B0ED server/server.py     E5998C944C11 server/analysis.py
21CEEFB78C14 server/store.py    DC1EC36BE0DD web/index.html       5A9F3F48FC55 web/css/app.css
E54279985F97 web/js/core.js     125B16DB8FC6 web/js/stage.js      B2CF12F42552 web/js/editor.js
37470626335D web/js/library.js  4168EFC25136 web/js/recreate.js   315351961C4D web/js/print.js
FE2E7729D6BC web/js/app.js      1CEDE1E3EF20 web/js/ui.js         4FE8B6DC6B9D web/js/api.js
EE801FB726F9 tools/make_materials.py
```
真实素材包：`assets/materials/manifest.json`，`generated_at=2026-09-30T18:01:42+08:00`，181 件。

## 结论一句话

**打印功能整体不可用（点「打印」什么都不发生、强制 Ctrl+P 输出全白），平铺/文字位置/翻转三类「预览＝打印」承诺在实测中不成立，分析引擎把正常文字行判成「胶带」导致复刻把日记页重排成 8 条胶带——渲染几何、路径安全、素材库落盘、导出 PDF 则扎实可靠。**（素材包生成器崩溃的问题在我验证期间已被作者修好，见 S2。）

---

## 严重问题

### S1【致命】浏览器打印完全失效：`#print-root` 元素根本不存在

**现象**
1. 点「🖨 打印（浏览器打印对话框）」没有任何反应（不弹打印框、不报错、无提示）。
2. 即使手动 Ctrl+P，打印出来是**全白一张纸**。

**复现与真实输出**
`web/index.html` 的 `body` 子元素只有 `HEADER, MAIN, DIV#toast-wrap, DIV#modal-wrap, SCRIPT`；`print.js` 第 116 行 `document.getElementById('print-root')` 拿到 `null`，第 117 行 `if (!root) return;` 直接退出。真浏览器（CDP，8765/8799 均如此）实测：

```js
// Runtime.evaluate 结果
printRootExists      = false
printRootStyleDisplay= "MISSING"
bodyChildren         = "HEADER#,MAIN#,DIV#toast-wrap,DIV#modal-wrap,SCRIPT#"
window.__printCalls  = 0        // 覆盖 window.print 计数后点 btn-print，一次都没调用
```
切到 print 媒体后整页截图（1800×2600）：

```
media_print.png (1800, 2600)  非白像素 0 / 4680000  (0.000%)
```
因为 `web/css/app.css:299` 在 `@media print` 里写了 `body > header, body > main, #toast-wrap, #modal-wrap { display: none !important; }`，而 `#print-root { display: block !important; }`（第 300 行）指向一个不存在的元素——**正文被全部隐藏，没有任何内容可打印**。

静态复核也一致：全项目 `print-root` 只在 `app.css`（5 处）和 `print.js:116` 出现，`index.html` 里没有，JS 里也没有动态创建（`journal-page-style` 是动态创建的，`print-root` 不是）。

**在「181 件真实素材包」的当前版本上再次复核（CDP）**：`{"printRoot": false, "printCalls": 0, "note": "成品 148×210mm · 含出血共 154×216mm · 输出 300dpi。打印后沿角线裁掉出血边即可。"}`——按钮点了仍然什么都没发生，且提示文案还告诉用户「打印后沿角线裁掉出血边」。此条**未修复**。

**根因**：`web/index.html`（整个文件没有 `#print-root`）+ `web/js/print.js:115-132`。

**建议修法**（任选其一）
1. 在 `index.html` 的 `body` 末尾（`#toast-wrap` 旁）加 `<div id="print-root"></div>`；顺带把 `#toast-wrap/#modal-wrap` 一起纳入 `@media print` 的隐藏名单（现在已隐藏，✓）。
2. 或让 `doPrint()` 自己兜底：`let root = document.getElementById('print-root'); if (!root) { root = document.createElement('div'); root.id='print-root'; document.body.appendChild(root); }`。
修好后建议补一条浏览器断言：`click #btn-print` 后 `window.print` 调用次数 ≥1，且 print 媒体截图非白像素 > 0。

---

### S2【验证期间已被作者修复】`tools/make_materials.py` 曾因重复 id 崩溃，导致项目没有 `assets/materials/`

**当前状态：已修复。** 作者在 17:59:43 把 id 改成带 ckey（如 `sticker_heart_freshc4_01`），我在 18:03 用当前版本复跑：

```
python tools/make_materials.py --out %TEMP%\mm_verify
        sticker  贴纸     45
        frame    边框花边   12
        ...
        合计 181 个素材
  [ok] manifest / 文件 / 尺寸 / alpha / id 全部通过
elapsed_s=36.9
MANIFEST OK
```
对生成物逐项核对 SPEC §2.1（真实素材包）：181 件、id 唯一、全部以 `<cat>_` 开头、各类数量 `paper 25/20、tape 33/24、sticker 45/36、frame 12/10、divider 14/12、stamp 12/10、title 14/12、icon 26/20` **全部达标**。

**我验证的旧版本（`EE801FB726F9` 之前的版本）确实崩溃**，证据保留如下（这是当时项目里 `assets/` 完全不存在、`/api/health` 报 `"materials": 0` 的根因）：

```
python tools/make_materials.py --out <tmp> --only paper --only tape --only sticker --only icon
  File "tools/make_materials.py", line 1229, in gen_sticker
    builder.add(iid, name, "sticker", tags + [...], img, dom, desc, alpha=True)
  File "tools/make_materials.py", line 382, in add
    raise ValueError("重复 id: %s" % item_id)
ValueError: 重复 id: sticker_heart_fresh_01

STICKER_SPECS count: 45
duplicate ids: ['sticker_label_fresh_01','sticker_arrow_fresh_01','sticker_heart_macaron_01',
                'sticker_heart_fresh_01','sticker_star_fresh_01','sticker_flower_fresh_01',
                'sticker_bubble_fresh_01']
unique: 38
```

**遗留提醒（给作者）**
1. 素材包是 18:01 才生成的，但 8765 上的服务进程早于它启动，`material_index()` 有进程内缓存（`server.py:80-86`）且 `invalidate_materials()` 全项目**无任何调用点**。现在实测：`http://127.0.0.1:8765/api/health` 仍返回 `"materials": 0`，而 8799（我自己起的、后于素材包启动）返回 `"materials": 181`。**需要重启 8765，否则界面上素材库还是空的。** 建议 `material_index()` 按 manifest 的 mtime 失效。
2. 素材包齐了以后，之前被 `skipUnless` / `if materials:` 跳过的用例（`test_render.py` 2 条、`contract_check.mjs` 素材段、`e2e_check.py` 素材段、`browser_check.mjs` 第 2/3/4 组）**必须重跑一遍**——它们此前是在「0 素材」状态下"通过"的。

---

### S3【严重·契约不一致】平铺素材在预览里是打印的 **2 倍**大

**现象**：`tile:true` 的底纹纸（SPEC §2.1 定义 paper 为 A5@150dpi，即 1240×1748 = 148×210mm）在编辑器/打印预览里按 150dpi 自然尺寸平铺，而服务端按「1 素材像素 = 1 输出像素」平铺，300dpi 下正好缩小一倍。

**复现与真实输出**
用一张 100×100 像素、左上带黑条的平铺纸做尺子，服务端渲染 A5@300dpi 后量周期：

```
渲染尺寸: (1748, 2480)
实测平铺周期: 100.0 x 100.0 像素 = 8.47 x 8.47 mm
服务端逻辑: 1 素材像素 = 1 输出像素 @ 300dpi -> 周期 8.47 mm
前端逻辑(stage.js backgroundSize=naturalMm, paper 参考 150dpi) -> 周期 16.93 mm
```
浏览器实测前端就是这么算的（CDP，`getComputedStyle`）：

```json
tileBackground: {"backgroundSize":"64px 64px","backgroundRepeat":"repeat",
                 "naturalMm":[16.933,16.933],"itemPx":[100,100],"cat":"paper","pxPerMm":3.7795}
tileLayer:      {"backgroundSize":"64px 64px","backgroundRepeat":"repeat","naturalMm":[16.933,16.933]}
```
64px ÷ 3.7795 px/mm = **16.93mm**。同一张纸：预览 16.93mm，打印 8.47mm，**差 2.00 倍**（预览花纹密度只有印出来的一半）。背景（`background.tile`）和素材图层（`layer.tile`）两条路径都中。

用**真实素材包**复核同一结论（唯一一张 `tile=true` 的 `paper_daily_macaron_01`，1240×1748px）：

```
前端 naturalMm(150dpi 参考) = 209.97 x 295.99 mm
服务端 @300dpi 平铺单元    = 1240px = 104.99 mm      -> 比值 2.00
CDP 实测预览: backgroundSize "793.6px 1118.72px" -> previewTileMm 209.97mm
              （stage 宽仅 154mm，预览里连一块砖都放不下；打印会重复约 1.5 次/行）
```

**根因**：服务端 `_tile_into`（`server/server.py:166-178`）直接用 `src.width/height` 当平铺单元（调用处 `:326-327`、`:363-364`）；前端 `web/js/stage.js:64-71` / `:108-111` 用 `naturalMm()`（`web/js/core.js:93-96`，`CAT_REF_DPI = { paper: 150 }`，`:7`）。只有 paper 类（唯一 150dpi 参考）会差 2 倍——而 paper 恰好是平铺的主用途。

**建议修法**：服务端按同一张参考表平铺，即 `_tile_into` 里把素材先缩到 `w_px = item.w * dpi / ref_dpi`（`ref_dpi` 用 `{paper:150}`，缺省 300）；或反过来让前端 `naturalMm` 对 paper 也用 300（但那会与 SPEC §2.1「paper = A5@150dpi」冲突，不推荐）。二选一必须写进 SPEC，否则还会再漂。

---

### S4【严重·「预览＝打印」不成立】文字层落笔位置系统偏移 ≈ 0.15×字号 / 0.12×字号

**现象**：SPEC §5.1 明写「前端 `.layer-el.text-el` 使用 `line-height: 1.35`，两端由此对齐，保证「预览＝打印」」。实测字号 8mm 时预览比导出**偏左 1.28mm、偏下 0.97mm**。

**复现与真实输出**
同一层 `text:"Hxy", size_mm:8, x_mm:20, y_mm:30`，服务端 `/api/render`（A5@300dpi）与真浏览器截图分别量墨迹包围盒（各自换算成 mm）：

```
服务端 300dpi: 图像 (1748, 2480), 11.8108px/mm
    墨迹 -> 毫米  x 21.93–35.48  y 31.33–39.29  (宽 13.55mm 高 7.96mm)
浏览器预览: 图像 (559, 793), 3.7770px/mm
    墨迹 -> 毫米  x 20.65–34.15  y 32.30–40.24  (宽 13.50mm 高 7.94mm)
```
字号/字宽一致（13.5mm ✓ 说明字体与字号对得上），但位置差 `Δx=-1.28mm, Δy=+0.97mm`。偏移量与字号成正比（0.15×8=1.2mm 与 0.175×8−浏览器行盒内缩≈1.0mm），20mm 标题就会差 ~3mm/2.4mm——这是打印上肉眼可见的错位。服务端是在文本框内加了 `pad_x=0.15×size`、`pad_y=0.175×size` 再整体居中（`server/server.py:213-214, 234-235`），前端 div 没有这层内缩（`web/js/stage.js:35-43`、`app.css:238-240`）。

**根因**：`server/server.py:213-214`（padding 模型）与 `web/js/stage.js:23-43` + `web/css/app.css:238-240`（无 padding、只给 `line-height:1.35`）不一致；SPEC 的行距约定不完整（只约定了行距，没约定首字偏移与左右内缩）。

**建议修法**：前端 `.text-el` 加 `padding: 0 0.15em` 不可行（会改变层宽），正确做法是让前端把文本层定位改为 `left: calc(x_mm + 0.15em); top: calc(y_mm + ...)` 或干脆**服务端去掉 `pad_x/pad_y`**（用 `textbbox` 精确取墨迹左上角对齐 `(x_mm, y_mm)`），并同步改 SPEC §5.1 的措辞。改完用上面的「服务端 PNG vs 浏览器截图」方法回归（脚本已跑通，见附录 A）。

---

### S5【严重·预览≠打印】文字层/形状层的水平、垂直翻转只在预览生效，服务端直接忽略

**现象**：编辑器给**任何图层**都提供「水平翻转 / 垂直翻转」（`web/js/editor.js:498-499`），文字层和色块层点下去预览会镜像，但导出的 PNG/PDF 里**完全没有翻**。

**复现与真实输出**
```
C2 文字层 flip_x / flip_y 是否被服务端处理
  flip 前后像素完全一致(flip_x): True
  flip 前后像素完全一致(flip_y): True
  flip_x 最大像素差: 0  不同像素数: 0
```
（直接对 `render_page` 输出做 `np.array_equal`，整张图 0 个像素不同。）

浏览器侧则确实镜像了（CDP 读计算样式 + 墨点左右分布）：

```
textFlipXTransform = "matrix(-1, 0, 0, 1, 0, 0)"
浏览器预览 正常:   墨迹 x 78–129，左半墨点 213，右半 211
浏览器预览 flip_x: 墨迹 x 76–127，左半墨点 188，右半 238（整体关于元素中心镜像）
服务端 flip_x=False: 墨迹 x 259–419，左半 2003，右半 1860
服务端 flip_x=True : 墨迹 x 259–419，左半 2003，右半 1860   ← 一模一样，没翻
```

**根因**：`server/server.py:348-351` 只在 `kind in ("material","image")` 分支处理 `flip_x/flip_y`；`_draw_text_layer`（`:197-239`）和 `_draw_shape_layer`（`:242-264`）从不读这两个字段，虽然前端 `web/js/stage.js:14-21` 的 `transformOf` 对**所有** kind 都拼了 `scale(±1,±1)`。

**建议修法**：在 `_draw_text_layer`/`_draw_shape_layer` 里旋转之前加 `ImageOps.mirror/flip`；或者前端对 text/shape 隐藏翻转按钮并把 SPEC 写清「翻转仅对素材/图片层有效」。前者更符合用户预期。

---

### S6【严重·分析准确性】真实文字行被判成「胶带」，`type=text` 几乎不可达 ⇒ 复刻重排整页错位

**现象**：用真实字体（msyh/arial）渲染的正常手账文字页，区块类型几乎全部输出 `tape`，`text` 只在极少数大标题上出现一次。

**复现与真实输出**（3 张真实字体合成页，`analysis.analyze_image`）

```
=== 真实中文日记 34px x7 行 ===
  区块数 17  类型分布 {'tape': 17}  留白 0.972  风格 {'mood': '素雅', 'density': '极简', 'warmth': '暖调'}
    tape x=0.073 y=0.084 w=0.576 h=0.019 density=0.38 fill=#85817c aspect=20.9
    ...
=== 大标题 90px + 正文 28px ===
  区块数 15  类型分布 {'decor': 1, 'text': 2, 'tape': 12}
=== 英文日期 72px + 短句 40px ===
  区块数 3  类型分布 {'tape': 3}
```
连「纯色底 + 一个方块」那种合成页也有另一侧的错：一条实心胶带（0.679×0.058、aspect 8.36）被判成 `photo`：

```
D 定向分类
    photo  x=0.161 y=0.172 w=0.679 h=0.058 density=1.00 fill=#f0c8d2 aspect=8.36   ← 这是胶带
```
即**两条规则优先级反了**：`density>0.62 and area>0.02 → photo`（`analysis.py:166`）吃掉实心胶带；`aspect>3.2 and h<0.12 → tape`（`:168`）吃掉所有文字行，而 `edge>6 and density<0.5 → text`（`:170`）排在它们后面，永远轮不到。

**功能性后果**（不是文案问题，最后一并在真实素材包 + 真浏览器里复现过）：
1. `web/js/recreate.js:91-97` 的 `CATEGORY_FOR` 把 `tape→'tape'`、`text→'title'/'divider'`——**满页手写字会被重排成满页胶带条**。
2. `web/js/recreate.js:220-233` 只从 `type==='text'` 的区块补日期文字层；实测文字页产出 0 个 `text` ⇒ **「生成同款」永远不会自动放日期文字**。
3. 复刻页预览叠加框全部标成「胶带」，用户看到的是错的。

**端到端复现（CDP + 真实 181 件素材包）**：画一张 7 行中文（34px 微软雅黑）的 A5 页 → `/api/analyze` → `composeLayout`：
```
regions: 14, regionTypes: {"tape": 14}, whitespace: 0.977, suggest: {"page_size":"A5"}
layers: 8, layerKinds: {"material": 8}, brokenRefs: 0
```
即：**14 个区块全是「胶带」，生成出来 8 个图层全是素材，一个文字层都没有**——一张手写日记页被重排成了 8 条胶带。

**根因**：`server/analysis.py:166-176` 规则顺序 + 用归一化 aspect 判 tape 的阈值过松。

**建议修法**：把 `text` 判据提到 `tape` 之前，并用「笔画宽/行高」区分：例如先算 `edge`，`edge > 6 and h < 0.06 and density < 0.55 → text`；`tape` 再加「横向连续性高（行内墨迹占比 >0.6）或饱和色块」条件；`photo` 判据加上「aspect 在 0.4–2.5 之间」。改完请把上面 3 张真实字体页固化进 `tests/test_analysis.py` 作为回归。

---

### S7【严重·并发】并发保存工程 20 次里有 11 次返回 500

**现象**：`POST /api/project` 并发写同一个工程文件时大面积 500。

**复现与真实输出**（10 线程并发发 20 个请求）

```
### E 并发写 project.json（20 并发）
  状态码: {200: 9, 500: 11}
  读回: {"ok": true, "project": {"version": 1, "n": 14, "layers": [{"i": 14}]}}
```
（`test_render`/`e2e` 都覆盖不到这条，因为是并发才触发。）

**根因**：`server/server.py:678-684`
```python
tmp = PROJECT_PATH.with_suffix(".tmp")      # 固定文件名，无锁
tmp.write_text(...); os.replace(tmp, PROJECT_PATH)
```
两个请求同时用同一个 `data/project.tmp`：A 写完还没 replace，B 又写并先 replace，A 的 `os.replace` 抛 `FileNotFoundError` → 被 `do_POST` 兜成 500「服务器内部错误，请看控制台日志」。对比 `server/store.py:29-32` 的 `_atomic_write_text` 是在 `self._lock` 里调用的，所以素材库没这个问题。

**建议修法**：给工程写加同一把锁（或 per-request 唯一临时名 `tempfile.mkstemp`），并复用 `store._atomic_write_text` 的写法。前端目前有 1200ms 防抖，正常单人不易触发，但 `/api/project` 是对外接口，且未来加「另存为/多标签」就会踩。

---

## 次要问题

### M1 小装饰块被面积阈值静默丢弃（48 个只识别到 20 个）
合成「6×8 共 48 个装饰图形」的页面，独立连通域计数确认是 48 个，分析只输出 20 个：
```
draw calls        : 48
independent blobs : 48
analysis regions  : 20
comp -> raw_boxes: 48
after _merge_boxes: 48
最小的 8 个归一化面积: [0.00094, 0.00094, 0.00098, ...]
after 面积过滤 (0.0015 < w*h): 20  -> 丢掉了 28
阈值 0.0015 相当于 A5 上 46.6 mm^2，约 6.8 mm 见方
```
**根因**：`server/analysis.py:260` `merged = [b for b in merged if 0.0015 < b[2]*b[3] < 0.97]`。
**建议**：下限降到 0.0004（约 3.5mm 见方）或改成按绝对像素面积判（如 < 12px 才丢）。

### M2 `shape=line` 的纵向位置：服务端画在 `y+h/2`，前端画在 `y`（差 19.7mm）
同一层 `x=20,y=20,w=100,h=40,stroke_mm=0.4`：
```
线的像素行范围: 467–471 -> y = 39.54–39.88 mm
线宽 0.4mm 正常，但位置对齐到 h 的一半
前端 stage.js 预期(div top=y=20mm, 高 stroke_mm=0.4mm): 20.0–20.4mm
```
**根因**：`server/server.py:258` `draw.line([box[0], box[3]//2, box[2], box[3]//2], ...)` 把线画在 h 盒子的垂直中心；`web/js/stage.js:51-55` 把 `.layer-el` 高度直接设成 `stroke_mm` 放在 `top=y_mm`。UI 目前只能加 rect（`editor.js:595`），但 `data/project.json` 载入/手改即可触发。
**建议**：服务端也按 `y_mm` 顶端画线（或前端把 line 的盒子按 `y_mm + h_mm/2` 居中）。

### M3 改打印设置后顶栏/编辑器不同步，且不触发自动保存
CDP 实测：把打印页「纸张」改成 A4 后（未切页签）——
```
syncAfterChange = {"summary":"A5 · 148×210mm · 300dpi",  ← 顶栏还是旧值
                   "editorSelect":"A4",
                   "stagePageW":"148",                    ← 编辑器舞台仍是 A5
                   "coreSize":"A4","printSelect":"A4"}
afterSwitchToEditor = {"summary":"A4 · 210×297mm · 300dpi","stagePageW":"210"}  ← 切页签才刷新
```
`web/js/print.js:159-168` 的 `syncFromControls` 只改 state，不 `emit('changed')`、不 `render()`、不刷新顶栏（`app.js:73-76` 的自动保存只在 `'changed'` 上触发）⇒ 改了纸张再刷新页面会被旧工程覆盖。
**建议**：`syncFromControls()` 末尾 `emit('changed'); renderEditor(); refreshPrintPreview();`。

### M4 素材库「设为背景」点了画布没反应；编辑器「背景」下拉也不同步
CDP 实测点击底纹纸卡片的「设为背景」后：
```
buttons: ["加入画布","设为背景"]（按钮存在且被点到）
stateBg: {"type":"material","value":"paper_tile_ruler_01","tile":true}   ← 状态变了
stageBg: "none"   stageBgColor: "rgb(255,255,255)"                        ← 画布没变
bgPaperSelect: ""                                                          ← 下拉还显示「用纯色背景」
手动 ed.render() 之后 stageBg: url(".../paper/tile_ruler...")              ← 渲染一次才对
```
**根因**：`web/js/library.js:130-134` 只 `emit('changed'); emit('background')`，没有 `render()`；`app.js:79` 的 background 监听只同步 `#bg-color`，不碰 `#bg-paper`；`editor.js:529-538` 的 `syncPageControls` 只挂在 `'materials'` 事件上（`editor.js:622`）。
**建议**：`library.js` 的「设为背景」里补 `render()`（或让 `app.js` 在 `'background'` 时调用 `syncPageControls + renderEditor`）。

### M5 顶栏「保存工程」是死按钮
`index.html:27` 有 `#btn-save-project`，但全项目 JS 里没有它的任何点击处理器（grep `btn-save-project` 仅命中 index.html 本身；`app.js` 只有防抖自动保存 `scheduleSave`）。点它没有任何反应。
**建议**：绑定到 `api.saveProject(serializeProject())` + `ok('工程已保存')`，或直接删掉按钮改文案「自动保存中」。

### M6 参数错误返回 500 / 暴露 Python 异常
```
GET /api/search?source=wikimedia&q=a&limit=abc   -> 500 {"ok":false,"error":"服务器内部错误，请看控制台日志"}
GET /api/search?...&page=xyz                     -> 500 同上
POST /api/render  {"layers":[{"opacity":"abc"}]} -> 400 {"ok":false,"error":"could not convert string to float: 'abc'"}  ← 直接把 Python 异常抛给用户
```
**根因**：`server/server.py:595-596`（`int(...)` 未校验）、`:341`（`float(layer.get("opacity",1.0))` 未包友好错误）。SPEC §8 要求「错误提示面向普通用户」，前者连原因都没说。

### M7 字号/文字长度无上限 ⇒ 导出变成不透明 500
```
字号 -> 结果： size_mm=800 status=200(1.44s) | size_mm=1500 status=500 | size_mm=3000 status=500
文字长度 -> 结果（size_mm=8）：5000 字 200(1.01s) | 20000 字 500 | 60000 字 500
```
前端「字号」输入框只做了 `Math.max(2, v)` 下限（`editor.js:476`），没有上限；`render_page` 的 `size_px = round(size_mm*ppm)` 直接拿去开字体/建图（`server.py:202,215-217`）⇒ 内存/字体构造失败 → 500「服务器内部错误」。用户看到的是「导出失败：服务器内部错误，请看控制台日志」。
**建议**：前端 `clamp(size_mm, 2, 120)`、文本长度截断到 2000 字；服务端对 `size_mm`/文本长度做同样的硬上限并返回 400 友好提示。

### M8 打印预览从不画裁切角线
`refreshPrintPreview` 用 `showGuides`（裁切线/出血框虚线），`drawCropMarks` 只在已失效的 `doPrint` 里调用（`print.js:14` vs `:123`）。CDP 实测：勾选「打印角线」且出血 3mm 时
```
printPreviewCrop = {"cropChecked":true,"bleed":"3","cropMarkNodes":0,"guideNodes":2}
```
用户勾了「打印角线」在预览里看不到任何角线，而导出 PNG/PDF 里是有的（服务端画），进一步加深「预览≠打印」的错觉。
**建议**：`refreshPrintPreview` 在 `state.page.crop_marks && bleed>0` 时也调 `drawCropMarks`。

### M9 文案瑕疵
- `web/js/print.js:53`：「加打印可能发虚」应为「打印可能发虚」。
- `web/js/editor.js:533` + `index.html:144`：竖版时按钮写「竖版」、横版时写「横版」，语义是「当前状态」而非「点击后动作」，用户想切横版时会犹豫。
- `web/index.html:194`：A4 选项标注「可裁成两张A5」——A5 是 A4 的一半没错，但打印页含出血，实际裁切需要角线对齐，措辞可更准确。

### M10 非法页面尺寸静默产出 1×1 图
```
page.size 未知 + w/h 负数  -> status=200  PNG 69B     （1×1 像素）
page.bleed_mm=-5           -> status=200  （静默按 0 出血处理）
```
`server.py:309-314` 用 `max(1, ...)` 吞掉了非法值。不崩，但比报错更难排查。建议 w_mm/h_mm ≤ 0 时返回 400。

### M11 SPEC 与实现的坐标原点定义不一致（不影响用户，但会误伤第三方对接）
SPEC §5.1 写「坐标原点在**出血框左上角**」，而前后端一致地把原点放在**成品（裁切）框左上角**，即图层在画布上整体偏移 `+bleed_mm`。实测（红块 x=20,y=30,bleed=3）：
```
服务端渲染: 红块 x 22.94–32.94mm, y 32.94–42.93mm
前端 DOM : layerLeftMm 23.02 / layerTopMm 33.07（CSS mm 取整误差 <0.1mm）
```
两端自洽（这是合理设计：改出血不应挪内容），但按 SPEC 字面实现的第三方会整体差 3mm。**建议把 SPEC 改成「原点在成品（裁切）框左上角，绘制时整体偏移出血量」。**

### M12 素材被删除后图层静默消失
删除用户素材后：`kind=image` 的图层渲染仍 200 但内容变成白（服务端 `_resolve_layer_image` 返回 None 跳过），`/media/<id>` 返回 404（✓正确）。前端 `web/js/stage.js:72-79` 的 `<img>` 没有 `onerror` 兜底，编辑器里会显示破图图标且不提示。建议加 `onerror` 标记「素材已删除」。

### M13 素材包里只有 1 件 `tile=true`，「平铺背景」几乎没得选
真实素材包 181 件中 `tile=true` 的只有 `paper_daily_macaron_01` 一件（实测 `core.state.materials.items.filter(m=>m.tile).length === 1`）。SPEC §2 说 `tile` 表示可无缝平铺、§2.1 要求 paper「可平铺优先」，实际 25 张 paper 里只有 1 张带 tile 标记。用户点「平铺背景」时几乎没有选择；而这一件的平铺尺寸又是错的（S3）。
**建议**：给能无缝拼接的 paper/tape 补上 `tile: true`，并用测试断言「paper 中 tile=true 的比例 ≥ 1/3」。

### M14 manifest 缓存不失效：素材包重新生成后必须重启服务
`material_index()` 有进程内缓存（`server.py:80-86`），而 `invalidate_materials()`（`server.py:89-92`）**全项目无任何调用点**（grep 只命中定义本身）。实测：
```
http://127.0.0.1:8765/api/health -> "materials": 0      ← 进程早于素材包启动
http://127.0.0.1:8799/api/health -> "materials": 181    ← 后启动的进程读到 181 件
```
即：现在浏览器打开 8765 看到的仍是空素材库。**建议**：`material_index()` 记住 manifest 的 mtime/size，变了就重建；或在 `/api/materials` 里主动失效。

### M15 客户端断开时控制台刷完整 traceback
服务用 `protocol_version = "HTTP/1.1"`（长连接），浏览器关闭或刷新时大量 socket 被重置，`socketserver` 默认的 `handle_error` 把整段栈打到 stderr（我用真浏览器跑一轮后服务端 stderr 里出现 8 组 `ConnectionResetError: [WinError 10054]` + traceback）。用户是盯着这个控制台窗口用产品的。
**建议**：在 `Handler` 里覆盖 `handle_error`，对 `ConnectionResetError/BrokenPipeError` 静默（其余仍打印）。

---

## 已验证 OK 的部分（都是我真跑过的，不是抄测试清单）

1. **路径穿越/越权全部挡住**（8 种变体，含双重编码）：
   `/media/../server/server.py`、`/media/..%2f..%2fserver%2fserver.py`、`/assets/../server/server.py`、`/assets/materials/../../SPEC.md`、`/assets/..%2f..%2fSPEC.md`、`/web/../server/store.py`、`/web/js/../../server/analysis.py`、`/assets/materials/%2e%2e/%2e%2e/SPEC.md` → 全部 `404 not found`。`_safe_join`（`server.py:463-478`）先拒绝任何 `..` 段再做 `relative_to` 兜底，写法正确。
2. **`store.py` 落盘健壮**：索引损坏（写入 `{这不是 JSON`）→ 备份为 `library.corrupt.json` 并重建，服务照常启动；索引是数组 → items 空；条目缺 `id`/非字典 → 过滤；非图片数据 → `ValueError("这看起来不是一张有效的图片")`；空数据/非法扩展名 → 友好中文提示；名字清洗 `[<>:"/\|?*]`+控制字符+限长 60 全部生效（`<img src=x onerror=alert(1)>../../etc/passwd` → 无尖括号、文件名仍为 `lib_xxxx.png`）。**20 线程并发 `add_bytes`：0 异常、磁盘文件数 = 索引条目数 = 22、JSON 可解析**。`delete` 幂等、`path('../data/library.json')` 返回 None。
3. **渲染几何**：A5/A6/A4/B5、横竖版、出血尺寸与居中取整（`ox=35px` 对应 3mm✓）；纯色背景 `#123456` 精确；出血偏移与前端 DOM 一致（误差 <0.1mm，见 M11 数据）；**旋转方向两端一致**（服务端 `rotate(+30)`：胶带左端 y=71.16mm、右端 y=33.66mm，即视觉逆时针；前端 `transformOf` 发 `rotate(-30deg)` CSS 也是逆时针 ✓）；非平铺素材、`kind=image` 用户素材（600×400 蓝块渲染后中心像素 `(20,160,220)` 精确命中）。
4. **导出**：PNG 尺寸 = `round((w+2b)×dpi/25.4)`；PDF `MediaBox` = 含出血尺寸、图像 1:1 铺满（`pdfwrite.py:166,170-173`），`%PDF-1.4`/`%%EOF`/`obj` 配平；`_encode_jpeg` 只在超采样 >2 倍时降采样，本流程 scale=1 不重采样 ✓。
5. **静态资源与中文编码**：`/`、`/web/index.html` → `text/html; charset=utf-8`；`/web/js/app.js` → `text/javascript; charset=utf-8`；`/web/css/app.css` → `text/css; charset=utf-8`；`/favicon.ico` → 204；`/media/<id>` → `image/png`；`/assets/*` 长缓存、`/web/*` no-store（`server.py:718-730`）。中文全程无乱码（导入名「蓝色块」原样往返，manifest/HTML 均 UTF-8 解码成功）。
6. **XSS 面**：前端 14 处 `innerHTML` = 12 处 `= ''` 清空 + 1 处 `el()` 的 `html` 分支定义（无任何调用者）+ 唯一插值处 `ui.js:23` 的 `busy(container, text)`（三个调用点全传常量字符串）；用户可控字符串（素材名、tag、分析结果、联网标题）全部走 `textContent`/`setAttribute`。**未发现可利用的注入点。**
7. **分析引擎背景色**：5 张合成页（纯色+方块 / 满版文字 / 深色底 / 大量装饰 / 接近空白）背景色**全部与真值 0 偏差**（`#fffdf7`/`#ffffff`/`#2b2b33`/`#faf6f0`/`#fdfbf8`），`plain` 判定正确，`whitespace` 0.958/0.756/0.895/0.937/0.998 与实际内容量相符；**耗时 0.16–0.26s**（SPEC 要求 ≤8s，余量很大）；`palette` 抽样 k-means 结果合理（P1 得到 `['#fffdf7','#e05a5a']`）。
8. **请求健壮性**：空 layers / `layers:null` / 非字典项 / 未知 kind / ref 不存在 / 非法颜色（`garbage`、`#12345`、`#zzz`、`rgb(300,-5,abc)`）/ `opacity=-5` / `opacity=999` / `rotate=1e9` / 负尺寸 / `w=h=0` / `bleed_mm=-5` / `dpi=0` / 5000 字文本 / 含换行+emoji 文本 → **全部 200 不崩**；非 JSON body、JSON 数组、JSON 字符串 → 400 且中文提示友好；`/api/analyze` 非图片 → 422「无法识别这张图片，请换一张 PNG/JPG 试试」✓。
9. **前后端请求契约字段**：浏览器里实取 `buildRenderRequest()` 输出，字段与 SPEC §5.1 完全一致（`page.size/w_mm/h_mm/dpi/bleed_mm/crop_marks/orientation`、`background.type/value/tile`、每个图层的 `kind/ref/x_mm/y_mm/w_mm/h_mm/rotate/opacity/flip_*/tile/blend` 及文字层的 `text/font/size_mm/color/align`），并且确实剥掉了 `name`/`locked` ✓。
10. **DOM 审计**：65 个 id 全量交叉比对，只发现 `#print-root`（S1）和 `#btn-save-project`（M5）两处问题；`#prop-rotate` 是 `renderProps` 动态创建的，不是缺陷。
11. **真实素材包（181 件）下的端到端复核**（CDP 真浏览器 + 8799 隔离服务，素材用项目真实 `assets/materials`）：
    - 前端读到 `materials: 181`，素材网格渲染 181 张卡片，**181/181 缩略图 `naturalWidth > 0`**；整轮导航（四个页签 + 复刻）**4xx/5xx 请求数 = 0**（Network 域全程监听）。
    - 复刻链路在真实素材下可跑通：合成一张 7 行中文页 → `/api/analyze` → `composeLayout` → 生成 8 个图层，**`ref` 全部能在素材库里找到（brokenRefs = 0）**，背景按纯色底正确判定。
    - 素材包自身合规：181 件、id 唯一、`<cat>_` 前缀、八类数量全部 ≥ SPEC §2.1；生成器自检 `[ok] manifest / 文件 / 尺寸 / alpha / id 全部通过`。

---

## 未验证的怀疑

1. **`duplicateLayer` 的 id 只用 `Date.now()`**（`web/js/editor.js:383`）：`copy.id = kind[0] + Date.now().toString(36)`，理论上同一毫秒内复制两次会撞 id，导致图层 DOM/选中错乱。我没能在 UI 上稳定复现（需要两次点击落在同一毫秒），所以**未验证**。建议改成 `uid()` 计数器。
2. **超大素材图层的显存/内存放大**：`render_page` 对 `w_mm/h_mm` 无上限（`server.py:354-366` 直接 `resize`）。我特意没做极端压测（避免打爆本机内存），只到 `size_mm=800` 这档。风险方向明确但**未量化**。同理 `Font(size_mm=1500)` 已实测 500（M7）。
3. **联网素材源（`sources.py`，委派 B）**：不在我的审查清单内，未做接口级验证。仅确认 `/api/search` 的分页/limit 参数校验缺失（M6）。
4. **复刻重排的观感**：素材包已在 18:01 生成（181 件），但因为是纯程序生成的图案，我只能确认「链路通、ref 不悬空、类型映射按 S6 所述全走 tape」；**审美层面的『像不像原页』无法量化**，由作者和用户判断。

---

## 附录 A：关键复现命令

```powershell
$py='C:\Users\AT1556\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$node='C:\Users\AT1556\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$root='D:\Documents\deepseek-harness\default-workspace\journal-studio'

# S2：生成器现状复核（当前版本应成功并输出 181 件；修复前会抛 ValueError: 重复 id）
& $py "$root\tools\make_materials.py" --out "$env:TEMP\m"

# S3/S4/S5/M2/M11：服务端几何（脚本会 monkeypatch MATERIALS_DIR/LIBRARY 到临时目录，不碰项目 data/）
#   tile 周期、flip 像素相等性、line 纵向位置、文字墨迹 bbox —— 见报告正文的实测数字，
#   核心三行等价于：
& $py -c "import sys; sys.path.insert(0,r'$root'); from server import server; \
im=server.render_page({'page':{'size':'A5','dpi':300,'bleed_mm':0},'background':{'type':'color','value':'#fff'}, \
'layers':[{'kind':'shape','shape':'line','fill':'#000','x_mm':20,'y_mm':20,'w_mm':100,'h_mm':40,'stroke_mm':0.4}]}); \
import numpy as np; a=np.asarray(im); ys=np.where((a.sum(axis=2)<300).any(axis=1))[0]; print(ys.min()/300*25.4, ys.max()/300*25.4)"

# S7：并发写工程 → 看状态码分布
& $py -c "import json,urllib.request;from concurrent.futures import ThreadPoolExecutor as P; \
f=lambda i: urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8799/api/project', \
data=json.dumps({'n':i}).encode(),method='POST',headers={'Content-Type':'application/json'})).status; \
print([r for r in P(10).map(lambda i: (lambda: (f(i)))(), range(20))])"

# S1/S5/M4/M8：真浏览器（CDP）。要点（照 tests/browser_check.mjs 的写法，端口换成 9444）：
#   --headless=new --remote-debugging-port=9444，Runtime.enable 后：
#   window.__n=0; window.print=()=>window.__n++; 点击 #btn-print; 读 window.__n        → S1（实测 0）
#   document.getElementById('print-root')                                              → S1（实测 null）
#   Emulation.setEmulatedMedia({media:'print'}) + Page.captureScreenshot              → S1（实测非白像素 0）
#   getComputedStyle(document.querySelector('.layer-el.text-el')).transform           → S5（matrix(-1,0,0,1,0,0)）
#   getComputedStyle(stage).backgroundSize  → S3（合成尺子: 64px = 16.93mm；真实纸: 793.6px = 209.97mm，服务端 104.99mm）
#   preview.querySelectorAll('.crop-mark').length                                     → M8（实测 0）
```
