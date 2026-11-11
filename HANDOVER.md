# 手账工坊 Journal Studio —— 交接文档

> **2026-11-11 接续更新**：优先阅读 [本次更新](docs/UPDATE-2026-11-11.md)。当前素材为 277 件，已加入六套模板、作品库、备份恢复、保存状态与手机布局。下文为旧版交接记录，其中素材数量、手机布局待办和测试数量不再代表当前版本。

> 面向接手的 AI / 开发者。读完这份 + `SPEC.md`，你应该能独立继续开发和维护。
> 文档日期：2026-10-09。所有数字都是在**当前代码上实跑出来的**，不是估的。

---

## 0. 三十秒速览

| 项目 | 值 |
|---|---|
| 在线版（任何电脑浏览器直接打开） | <https://xinf49118-ux.github.io/journal-studio/> |
| 代码仓库 | <https://github.com/xinf49118-ux/journal-studio>（公开，默认分支 `main`） |
| 本机开发目录 | `D:\Documents\deepseek-harness\default-workspace\journal-studio` |
| 一句话 | 收集手账素材 → 上传别人的手账页自动重排同款 → A5/A6/A4/B5 一键打印 |
| 技术栈 | Python 3.12 + Pillow（本地后端）／原生 ES Module + Canvas（浏览器端）；**无任何第三方前端依赖、无构建步骤** |
| 测试 | **281 项自动化检查，当前全绿**（含真 Chrome 驱动的前端测试） |
| 素材 | 181 件程序生成的原创素材，CC0，整包 7.9 MB |

---

## 1. 这是什么东西

三个功能：

1. **收集素材** —— 内置 181 件程序生成的素材（8 类：底纹纸/和纸胶带/贴纸/边框/分割线/印章/标题条/小图标），
   支持拖拽导入本地图片，支持联网检索 4 个开放许可图库并一键入库。
2. **复刻页面** —— 上传一张别人的手账页，自动识别背景色、主配色、版面区块（图/字/胶带/装饰/框），
   再用素材库挑颜色最接近的素材重排出一张同款页面，之后可继续手工编辑。
3. **打印** —— A5/A6/A4/B5、150/300/600dpi、出血 0/3/5mm、裁切角线，支持浏览器打印和导出 PNG/PDF。

---

## 2. 最重要的概念：一套代码，两种运行模式

**这是理解整个项目的关键。同一个前端，自动适配两种后端。**

```
                  ┌─ 探测 GET api/health
前端启动 (app.js) ─┤
                  ├─ 返回 200  → server 模式：重活交给本机 Python
                  └─ 返回 404  → static 模式：全部在浏览器里算
```

探测逻辑在 `web/js/api.js` 的 `detectMode()`，结果缓存在 `MODE.value`，顶栏会显示
「本机版」或「在线版」徽标。

| 能力 | server 模式（`python server/server.py`） | static 模式（GitHub Pages） |
|---|---|---|
| 页面分析 | `server/analysis.py`（Pillow + numpy） | `web/js/analysis.js`（纯 JS，逐位复刻 numpy 随机流） |
| 300dpi 渲染 | `server/server.py::render_page`（Pillow） | `web/js/render.js`（Canvas 2D） |
| PDF 导出 | `server/pdfwrite.py`（手写 PDF 1.4） | `web/js/pdf.js`（手写 PDF 1.4） |
| 图库检索 | `server/sources.py`（urllib 代理，绕开 CORS） | `web/js/sources.js`（浏览器直连，靠各图库的 CORS） |
| 素材库存储 | 项目内 `data/library.json` + `data/files/` | 浏览器 IndexedDB（`web/js/store.js`） |
| 工程存档 | `data/project.json` | localStorage |

**`web/js/api.js` 是唯一的门面**：所有页面组件只调 `api.xxx()`，内部按模式分发。
新增后端能力时，两边都要实现，并在 `api.js` 里加分支。

**两种模式的渲染结果实测逐像素几乎一致**：平均差 0.24/255，明显不同的像素只占 0.20%，
差异只来自字体栅格化（浏览器用系统字体栈，Python 用 FreeType）。这条有自动化测试守着
（`tests/browser_static_check.mjs` 第 [5] 步）。

---

## 3. 目录结构与文件职责

```
journal-studio/
├── index.html                  ★ 唯一入口。本地服务与 GitHub Pages 共用这一份，内部全用相对路径
├── start.bat                   Windows 一键启动（首次自动生成素材包，然后起服务）
├── README.md                   面向普通用户的使用说明
├── SPEC.md                     ★ 权威接口契约（素材清单格式 / HTTP API / 渲染请求 JSON / 分析结果 JSON）
├── VERIFY.md                   ★ 上线前的独立对抗性验证报告，发现 6 个严重问题 + 15 个次要问题，已全部修复
├── LICENSE                     MIT（代码）+ CC0（内置素材）
├── .gitignore
│
├── server/                     本地版后端（Python）
│   ├── server.py               HTTP 服务 + 全部 API + 300dpi 渲染引擎（约 900 行，最核心）
│   ├── analysis.py             页面结构/配色分析（背景色、k-means 配色、连通域区块、文字行分组、类型判定）
│   ├── sources.py              4 个图库适配器（wikimedia / artic / met / openverse）
│   ├── pdfwrite.py             手写 PDF 1.4（DCTDecode 内嵌 JPEG，无第三方依赖）
│   └── store.py                用户素材库落盘（原子写 + 线程锁）
│
├── web/                        前端（本地版与在线版共用）
│   ├── css/app.css             全部样式
│   └── js/
│       ├── app.js              入口：页签、初始化、工程自动保存
│       ├── api.js          ★  后端门面 + 模式探测（改后端必看）
│       ├── core.js         ★  全局状态、图层工厂、渲染请求构造、撤销栈（纯逻辑，可在 Node 里直接 import）
│       ├── stage.js            把状态渲染成真实毫米单位的 DOM（屏幕预览与打印共用）
│       ├── editor.js           编辑器：拖拽/缩放/旋转/吸附/图层面板/属性面板
│       ├── library.js          素材库页签
│       ├── recreate.js         复刻页签（分析结果 → 素材重排算法在这里）
│       ├── print.js            打印页签
│       ├── ui.js               提示条 / 加载遮罩 / DOM 助手
│       ├── render.js       ★  static 模式的 Canvas 渲染引擎（对应 server.py::render_page）
│       ├── analysis.js     ★  static 模式的分析引擎（对应 analysis.py，940 行）
│       ├── sources.js          static 模式的图库适配器（对应 sources.py）
│       ├── store.js            static 模式的 IndexedDB 素材库
│       └── pdf.js              static 模式的 PDF 写出器
│
├── assets/materials/           181 件素材 + manifest.json（363 个文件，7.9 MB）
│   ├── manifest.json           ★ 素材清单，前端与服务端都读它
│   ├── <cat>/<id>.png|jpg      素材本体（8 个分类目录）
│   └── thumbs/<cat>/<id>.png   240px 缩略图（列表里必须用这个，别用原图）
│
├── tools/
│   ├── make_materials.py   ★  素材包生成器（2665 行，纯 Pillow + numpy，确定性）
│   ├── probe_sources.py        图库连通性自检 CLI
│   └── deploy-github.mjs   ★  发布到 GitHub 的脚本（纯 REST API，不需要 git）
│
├── tests/                      见第 5 节
├── docs/screenshots/           README 引用的 4 张界面截图
└── .github/workflows/deploy-pages.yml    GitHub Actions 自动部署 Pages
```

---

## 4. 本机环境（新人必读，全是坑）

### 4.1 解释器路径（必须用绝对路径，PATH 里没有）

```
Python:  C:\Users\AT1556\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe
Node:    C:\Users\AT1556\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
```

已装：Pillow 12.3.0、numpy 2.3.5、Python 3.12.14、Node v24.21.0。
**项目运行时只允许用 Python 标准库 + Pillow + numpy；前端零依赖。请保持这个约束。**

### 4.2 本机没装 git

`git` 不在 PATH 里。发布代码走 `tools/deploy-github.mjs`（纯 GitHub REST API，不依赖 git）。
如果确实需要 git，可以从 <https://git-scm.com/> 装，但注意 GitHub release 下载在本机被限速到
约 1 MB/5 分钟，装 git 这条路的耗时不可接受。

### 4.3 ⚠️ 绝对不要用 PowerShell 改写含中文的文本文件

**这是本次开发最大的坑，我踩了两次，两次都把文件里的中文写成了乱码。**

```powershell
# ❌ 绝对不要这样做
$c = Get-Content foo.js -Raw          # 这一步会按 ANSI/GBK 解码，中文已经坏了
$c = $c.Replace('a','b')
[System.IO.File]::WriteAllText(path, $c, ...)   # 再以 UTF-8 写回 → 双重编码，文件报废
```

正确做法：
- 改文本文件一律用编辑工具（read + edit / write），不要用 PowerShell 做字符串替换。
- 用 PowerShell 只做**只读**操作（Get-ChildItem / Select-String / 跑命令）。
- 确实要用脚本改文件时，用 Python + `encoding='utf-8'` 读写。

### 4.4 网络状况（影响测试）

本机到境外 CDN 的带宽只有 **20~30 KB/s**（实测：546 KB 的文件要 19 秒）。后果：

- `tests/browser_static_check.mjs` 打线上地址时，181 张缩略图只加载得动几张，**偶发超时是正常的**，
  重跑一次通常就全绿。这不是站点问题。
- 本机自带的 `curl.exe` **不支持 HTTP/2**，所以 curl 测试全部走 HTTP/1.1，不能用来验证 HTTP/2 行为。
- 国内的 GitHub Pages（Fastly）访问可能不稳，这是已知风险，见第 8 节。

### 4.5 其它

- 控制台中文乱码：跑 Python 前设 `$env:PYTHONIOENCODING='utf-8'; $env:PYTHONUTF8='1'`。
- Chrome 在 `C:\Program Files\Google\Chrome\Application\chrome.exe`（浏览器测试要用它）。

---

## 5. 怎么跑 / 怎么测

### 5.1 启动本机版

```powershell
cd D:\Documents\deepseek-harness\default-workspace\journal-studio
& 'C:\Users\AT1556\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe' server\server.py --port 8765
# 浏览器开 http://127.0.0.1:8765/
```

（给普通用户是双击 `start.bat`，它会先检查素材包在不在，不在就先生成。）

### 5.2 全量测试（当前 281 项，全绿）

```powershell
$PY  = 'C:\Users\AT1556\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$NODE= 'C:\Users\AT1556\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$env:PYTHONIOENCODING='utf-8'; $env:PYTHONUTF8='1'
cd D:\Documents\deepseek-harness\default-workspace\journal-studio

# ---------- 不需要服务就能跑 ----------
& $PY tests\test_materials.py        # 19 项  素材包完整性（数量/尺寸/alpha/id/缩略图）
& $PY tests\test_analysis.py         # 16 项  分析引擎 + 区块类型判定（用真实字体渲染的页面）
& $PY tests\test_render.py           # 25 项  渲染几何/图层/导出 + 回归测试
& $PY tests\test_sources.py          # 37 项  图库适配器（含离线 mock，离线也能过）
& $NODE --test tests\test_pdf_js.mjs tests\test_sources_js.mjs   # 40 项  客户端 PDF + JS 图库适配
& $NODE tests\test_analysis_js.mjs   # 17 项  JS 分析引擎 vs Python 逐字段对拍（IoU 1.000）

# ---------- 需要 8765 上服务在跑 ----------
& $PY tests\e2e_check.py             # 36 项  完整 HTTP 链路 + 脏参数 + 并发
& $NODE tests\contract_check.mjs     # 32 项  前端 core.js 生成的数据 vs 服务端渲染契约
& $NODE tests\browser_check.mjs tests\fixtures\sample-page.png   # 37 项  真 Chrome 驱动本机版
& $NODE tests\browser_static_check.mjs                           # 22 项  真 Chrome 驱动静态版

# ---------- 可选：直接打线上地址 ----------
& $NODE tests\browser_static_check.mjs https://xinf49118-ux.github.io/journal-studio
```

> AI 注意：`tests/test_*.py` 在 PowerShell 里即使全过也可能返回退出码 1（stderr 重定向的怪毛病），
> 判断成功要看输出里的 `OK` 而不是退出码。

### 5.3 各测试在测什么（挑重点）

| 测试 | 关键价值 |
|---|---|
| `test_render.py::TestRegression` | 锁住历史上出过的真 bug：打印容器缺失、平铺密度、文字预览/导出一致性、flip 不生效、脏数据不崩 |
| `test_analysis.py::TestRegionTypes` | 锁住「文字被误判成胶带」这个曾经让复刻功能半残的问题 |
| `test_analysis_js.mjs` | JS 分析引擎必须和 Python 逐字段一致（平均 IoU 1.000，类型命中率 100%） |
| `browser_check.mjs` | 真 Chrome：打印真的会输出内容（不是白纸）、预览与导出文字位置四边差 ≤0.6mm、无控制台报错 |
| `browser_static_check.mjs` | 起一个**没有后端**的静态服务器，验证浏览器能独立跑完全流程，并**逐像素对比 JS 渲染 vs Python 渲染** |

---

## 6. 契约与配置

- **`SPEC.md` 是权威契约**，任何改动先读它。里面定义了素材清单格式、HTTP API、渲染请求 JSON、
  分析结果 JSON、以及质量红线。
- **`assets/materials/manifest.json`** 是素材的唯一索引，前端和服务端都读它。
  改动素材格式必须同步改 `tools/make_materials.py`、`tests/test_materials.py`、以及 SPEC。
- **渲染请求 JSON** 是前后端最核心的契约，长度单位一律毫米，坐标原点在出血框左上角。
  定义见 SPEC 第 5.1 节，前端构造在 `web/js/core.js::buildRenderRequest()`，
  消费方是 `server/server.py::render_page()` 和 `web/js/render.js::renderToCanvas()`。
  **改这三处必须同步。**

---

## 7. 当前状态

### 7.1 已完成并验证

- 三个功能全部可用，本机版与在线版都跑通。
- 281 项自动化检查全绿。
- 线上站点 `https://xinf49118-ux.github.io/journal-studio/` 实测可公开访问（无需登录），
  并用真 Chrome 在线上跑完了「素材加载 → 分析 → 复刻 → 300dpi 渲染 → 打印 → 导出 PDF」。
- 独立验证员做过对抗性复核（`VERIFY.md`），6 个严重问题 + 15 个次要问题**全部已修复并补了回归测试**。

### 7.2 已知限制（不是 bug，是外部条件）

1. **芝加哥艺术博物馆（artic）只能检索、不能下载图片** —— 它的图片域名被 Cloudflare 拦（HTTP 403，
   且不返回 CORS 头）。API 正常，图片拿不到。界面上已标注。
2. **Openverse 在本机完全连不上**（超时 20s）。适配器已实现并做了优雅降级。
3. **Met 博物馆的 `/v1/search` 已于 2026-10-01 退役**（返回 410）。已改用 `/v1.1/search` 并保留 v1 兜底。
   **如果将来 met 又出问题，先看这里。**
4. **手机/平板布局是坏的** —— 界面是固定两栏（268px 侧栏），没有响应式。手机上顶栏页签会竖排重叠。
   电脑上完全正常。见第 8 节待办 1。
5. **在线版的素材库不同步** —— 存在浏览器 IndexedDB 里，换电脑是空的（内置素材不受影响）。

---

## 8. 待办 / 建议下一步（按优先级）

| # | 事项 | 说明 | 预估 |
|---|---|---|---|
| 1 | **补响应式布局** | 现在手机上不能用。加媒体查询：窄屏时侧栏收成抽屉/横向滚动，顶栏页签横向滚动。改完要在 390px 视口下实测并重新部署 | 0.5~1 天 |
| 2 | **国内访问优化** | GitHub Pages 走 Fastly，国内可能慢或不通。可迁 Cloudflare Pages / Vercel（同样免费，代码不用改，只要换部署目标） | 0.5 天 |
| 3 | **素材列表虚拟滚动** | 181 张卡片全量渲染 DOM。现在不卡，但素材再翻倍就该窗口化了 | 0.5 天 |
| 4 | **复刻算法调参** | 现在按「区块类型 + 颜色最近邻」挑素材。可以让用户手动指定某类区块用什么素材，或者给几套风格预设 | 1~2 天 |
| 5 | **多页工程** | 现在一次只能编辑一页。手账常要印一整本 | 2~3 天 |
| 6 | **素材包扩充** | 8 类 181 件。扩充只需改 `make_materials.py` 的 spec 列表再跑一次 | 按需 |

---

## 9. 部署流程

线上站点由 GitHub Actions 自动部署（`.github/workflows/deploy-pages.yml`）：
push 到 `main` → 组装 `index.html` + `web/` + `assets/` + `docs/` 到 `_site` → 发布 Pages。
`server/` `tools/` `tests/` **不进站点**。

### 9.1 重新部署（本机没 git，用 API 脚本）

```powershell
$NODE = 'C:\Users\AT1556\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
cd D:\Documents\deepseek-harness\default-workspace\journal-studio

# 先看会推什么（不产生任何修改）
& $NODE tools\deploy-github.mjs --dry-run --token-file <token文件>

# 正式推
& $NODE tools\deploy-github.mjs --token-file <token文件>
```

脚本特性：本地算 git blob 哈希，**只上传内容变了的文件**（增量发布实测 428 个文件只推了 4 个）；
创建仓库（已存在则复用）；空仓库先初始化；推送后自动开启 Pages；遇到 GitHub 二级限流会自动退避重试。

### 9.2 需要 GitHub 授权

token 需要 `public_repo` + `workflow` 两个 scope。获取方式有两种：

- **浏览器授权流程**（推荐，不用手抄 token）：用 GitHub 的 device flow
  （`POST https://github.com/login/device/code` → 用户去 `github.com/login/device` 输码授权 →
  `POST https://github.com/login/oauth/access_token` 换 token）。
  **注意**：需要一个已注册的 OAuth app 的 client_id。上次用的是 GitHub CLI 的公开 client_id
  `178c6fc778ccc68e1d6a`（授权页会显示"GitHub CLI"）——**这属于借用他人应用身份，理想做法是自己注册一个 OAuth App**。
- **Fine-grained token**：让用户在 <https://github.com/settings/personal-access-tokens/new> 自己生成，
  只勾选目标仓库，权限给 `Contents: Read and write` + `Workflows: Read and write`。最透明。

**用完提醒用户去 <https://github.com/settings/applications> 撤销授权。**
（上一轮的 token 文件已从本机删除，但**授权本身可能仍然有效**，需用户自行确认。）

---

## 10. 雷区（血泪教训，务必看）

1. **`index.html` 里的 `<div id="print-root">` 不能删。** 曾经漏了它，导致 `print.js` 拿 null 直接 return，
   点打印毫无反应、Ctrl+P 出来是白纸。有回归测试（`test_render.py::test_index_html_has_print_root`）守着。

2. **素材列表一律用 `materialThumbUrl()`，绝不能用 `materialUrl()`。**
   曾经错把原图当缩略图，181 张原图把浏览器连接池堵死，页面卡到打不开。
   有回归测试（`browser_static_check.mjs` 的「网格加载的是缩略图而不是原图」）守着。

3. **前端预览与服务端导出必须同构。** 文字行距契约是 `1.35 × 字号`，首行字形上沿内缩 `0.175 × 字号`；
   平铺必须按素材的**自然毫米尺寸**（而不是素材像素数）——后者曾导致预览和导出的花纹密度差一倍。
   改渲染逻辑时，两边都要改，并跑 `browser_static_check.mjs` 的逐像素对比。

4. **`server/sources.py` 的 `alpha_mask()` 对灰度图必须返回像素值本身。**
   灰度图转 RGBA 后 alpha 会全变成 255，曾经导致每一张贴纸都被糊上一整块方形灰底。

5. **分析引擎的区块分类顺序不能随便调。** 「文字被误判成胶带」曾经让复刻功能永远排不出文字区块。
   现在 `text` 类型靠「行/列覆盖率 + 边缘密度」判定，`TestRegionTypes` 里有 6 条真实字体页面的回归测试。

6. **素材包的 PNG 是量化过的调色板图（模式 P + transparency），不是 RGBA。**
   判断有没有 alpha 要看 `im.mode in ('RGBA','LA','PA') or (im.mode=='P' and 'transparency' in im.info)`。
   这是为了压体积（整包 27MB → 7.9MB，肉眼无差别）。

7. **不要给前端引入任何依赖或构建步骤。** 整个前端是原生 ES Module，靠 `<script type="module">` 直接跑，
   这是它能同时部署到本地服务和 GitHub Pages 的前提。

8. **改素材格式要三处同步**：`tools/make_materials.py`（生成）、`tests/test_materials.py`（校验）、`SPEC.md`（契约）。

---

## 11. 常见任务怎么做

| 我想… | 怎么做 |
|---|---|
| 加一件素材 | 改 `tools/make_materials.py` 里对应的 spec 列表 → 跑 `python tools/make_materials.py --only <cat>` → 跑 `test_materials.py` |
| 换素材风格/配色 | 同上，色板定义在 `make_materials.py` 顶部 |
| 加一个图库源 | `server/sources.py` 和 `web/js/sources.js` **都要加**，然后在 `api.js` 的 `SOURCES` 列表里登记 |
| 改渲染效果 | `server/server.py::render_page` 和 `web/js/render.js::renderToCanvas` **都要改**，再用 `browser_static_check.mjs` 验证逐像素一致 |
| 改复刻算法 | 只改 `web/js/recreate.js::composeLayout()` |
| 改界面 | `index.html` + `web/css/app.css` + 对应的 `web/js/*.js` |
| 调试线上问题 | 打开线上地址 → F12；顶栏徽标确认是不是「在线版」→ 那就是纯浏览器实现，看 `web/js/` 那几个模块 |
| 重新部署 | 见第 9 节 |

---

## 12. 最后

- 有问题先看 `SPEC.md`（契约）和 `VERIFY.md`（已知缺陷与验证方法）。
- **改完一定要跑全量测试**（281 项），特别是 `browser_check.mjs` 和 `browser_static_check.mjs`
  这两个真浏览器测试——它们抓到过纯单测抓不到的 bug。
- 这个项目的历史上出过 6 个「测试全绿但功能是坏的」的严重问题（打印失效、复刻排不出文字等），
  全部是靠**真浏览器验证**和**独立对抗性复核**发现的。不要只信单元测试。
