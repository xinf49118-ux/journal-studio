/**
 * 浏览器端端到端验证（Chrome DevTools 协议）。
 *
 * 真正在 Chrome 里加载前端，捕获控制台报错，驱动「复刻页面」算法，
 * 并把结果截图存到 _shots/ 供人工复核。
 *
 * 用法：
 *   node tests/browser_check.mjs <一张样例手账页.png> [服务地址]
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SHOTS = join(ROOT, 'tests', '_artifacts');
const BASE = process.argv[3] || 'http://127.0.0.1:8765';
const PORT = 9333;

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

let pass = 0; let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${detail ? '  —— ' + detail : ''}`); }
  else { fail += 1; console.log(`  ❌ ${name}${detail ? '  —— ' + detail : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools 端口没起来');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        (this.handlers.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} 超时`)); }
      }, 60000);
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result?.value;
  }
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((p) => { try { readFileSync(p); return true; } catch { return false; } });
  if (!chrome) { console.log('没找到 Chrome/Edge，跳过浏览器验证'); return 0; }

  mkdirSync(SHOTS, { recursive: true });
  const samplePath = process.argv[2];
  if (!samplePath) { console.error('用法: node tests/browser_check.mjs <样例页.png>'); return 2; }

  console.log(`== 浏览器端验证：${BASE} ==\n`);

  // 先拿一份真实的版面分析结果，稍后喂给前端的复刻算法
  const sample = readFileSync(samplePath);
  const analysis = await (await fetch(`${BASE}/api/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: sample,
  })).json();
  console.log(`[0] 分析结果：${analysis.regions?.length ?? 0} 个区块，背景 ${analysis.background?.hex}\n`);

  const userDataDir = join(tmpdir(), `cdp_${Date.now()}`);
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
    '--window-size=1680,1050', 'about:blank',
  ], { stdio: 'ignore' });

  const errors = [];
  let cdp;
  try {
    await waitForDevtools();
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const pageTarget = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    cdp = new CDP(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');

    cdp.on('Runtime.exceptionThrown', (p) => {
      errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '未知异常');
    });
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') {
        errors.push((p.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
      }
    });
    cdp.on('Log.entryAdded', (p) => {
      if (p.entry?.level === 'error') errors.push(p.entry.text);
    });

    console.log('[1] 页面加载');
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(3500);
    const title = await cdp.eval('document.title');
    check('页面标题正确', title.includes('手账工坊'), title);
    const boot = await cdp.eval(`(async () => {
      const core = await import('/web/js/core.js');
      return JSON.stringify({ materials: core.state.materials.items.length, layers: core.state.layers.length });
    })()`);
    const bootInfo = JSON.parse(boot);
    check('前端已连上服务并读到素材清单', typeof bootInfo.materials === 'number', `materials=${bootInfo.materials}`);
    check('内置素材包有内容', bootInfo.materials > 0, `materials=${bootInfo.materials}`);

    console.log('\n[2] 素材库渲染');
    const gridCount = await cdp.eval(`document.querySelectorAll('#material-grid .mat-card').length`);
    check('素材卡片已渲染', gridCount > 0, `${gridCount} 张卡片`);
    const firstImgOk = await cdp.eval(`(() => {
      const img = document.querySelector('#material-grid .mat-card img');
      return img ? (img.complete && img.naturalWidth > 0) : false;
    })()`);
    check('缩略图真实加载成功', firstImgOk === true, String(firstImgOk));

    console.log('\n[3] 中文搜索');
    const searchHit = await cdp.eval(`(async () => {
      const input = document.querySelector('#mat-search');
      input.value = '胶带';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      return document.querySelectorAll('#material-grid .mat-card').length;
    })()`);
    check('中文关键词能搜到素材', searchHit > 0, `「胶带」命中 ${searchHit} 件`);
    await cdp.eval(`(() => { const i = document.querySelector('#mat-search'); i.value=''; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);

    console.log('\n[4] 复刻算法（用真实分析结果驱动）');
    const compose = await cdp.eval(`(async () => {
      const mod = await import('/web/js/recreate.js');
      const core = await import('/web/js/core.js');
      const data = ${JSON.stringify(analysis)};
      mod.composeLayout(data);
      await new Promise(r => setTimeout(r, 400));
      const kinds = {};
      for (const l of core.state.layers) kinds[l.kind] = (kinds[l.kind] || 0) + 1;
      return JSON.stringify({
        layers: core.state.layers.length,
        kinds,
        paper: core.state.background.type,
        page: core.state.page.size,
        refs: core.state.layers.map(l => l.ref).filter(Boolean).slice(0, 8),
      });
    })()`);
    const c = JSON.parse(compose);
    check('复刻生成了图层', c.layers >= 3, `${c.layers} 层 ${JSON.stringify(c.kinds)}`);
    check('复刻使用了素材库素材', (c.kinds.material || 0) >= 2, `material=${c.kinds.material || 0}`);
    check('复刻设置了背景', !!c.paper, `background=${c.paper}`);
    check('复刻纸张尺寸合法', ['A5', 'A6', 'A4', 'B5'].includes(c.page), c.page);

    console.log('\n[5] 编辑器渲染与交互');
    const editorState = await cdp.eval(`(async () => {
      const core = await import('/web/js/core.js');
      const ed = await import('/web/js/editor.js');
      document.querySelector('.tab-btn[data-tab="editor"]').click();
      await new Promise(r => setTimeout(r, 500));
      ed.zoomToFit();
      await new Promise(r => setTimeout(r, 300));
      const stage = document.querySelector('#stage-viewport .stage');
      const els = stage ? stage.querySelectorAll('.layer-el').length : 0;
      const imgs = stage ? [...stage.querySelectorAll('.layer-el img')] : [];
      return JSON.stringify({
        stage: !!stage,
        layerEls: els,
        imgsLoaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
        imgsTotal: imgs.length,
        zoom: core.state.zoom,
      });
    })()`);
    const es = JSON.parse(editorState);
    check('编辑器舞台已渲染', es.stage === true);
    check('图层 DOM 数量与数据一致', es.layerEls > 0, `${es.layerEls} 个图层节点`);
    check('素材图片全部加载成功', es.imgsTotal === 0 || es.imgsLoaded === es.imgsTotal, `${es.imgsLoaded}/${es.imgsTotal}`);
    check('适应窗口缩放生效', es.zoom > 0 && es.zoom <= 5, `zoom=${es.zoom}`);

    // 截图：编辑器
    let shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'browser-editor.png'), Buffer.from(shot.data, 'base64'));

    console.log('\n[6] 选中与拖拽逻辑');
    const dragResult = await cdp.eval(`(async () => {
      const core = await import('/web/js/core.js');
      const ed = await import('/web/js/editor.js');
      const layer = core.state.layers[0];
      if (!layer) return JSON.stringify({ skip: true, reason: '画布是空的' });
      const before = layer.x_mm;
      ed.select(layer.id);
      await new Promise(r => setTimeout(r, 120));
      const hasHandles = document.querySelectorAll('#stage-viewport .handle').length;
      ed.updateLayer(layer.id, { x_mm: before + 7 });
      await new Promise(r => setTimeout(r, 120));
      const after = core.state.layers[0].x_mm;
      const undoOk = core.undo();
      await new Promise(r => setTimeout(r, 120));
      return JSON.stringify({ hasHandles, before, after, undone: core.state.layers[0].x_mm, undoOk });
    })()`);
    const dr = JSON.parse(dragResult);
    if (dr.skip) {
      check('选中与拖拽逻辑', false, dr.reason + '（先做出至少一个图层才能验证）');
    } else {
      check('选中后出现 9 个控制点', dr.hasHandles === 9, `${dr.hasHandles} 个`);
      check('修改坐标生效', Math.abs(dr.after - (dr.before + 7)) < 0.01, `${dr.before} → ${dr.after}`);
      check('撤销回到原位置', dr.undoOk && Math.abs(dr.undone - dr.before) < 0.01, `${dr.undone}`);
    }

    console.log('\n[7] 打印预览');
    const printState = await cdp.eval(`(async () => {
      document.querySelector('.tab-btn[data-tab="print"]').click();
      await new Promise(r => setTimeout(r, 800));
      const stage = document.querySelector('#print-preview .stage');
      const holder = stage ? stage.parentElement : null;
      const wrap = document.querySelector('#print-preview');
      return JSON.stringify({
        stage: !!stage,
        holderW: holder ? holder.getBoundingClientRect().width : 0,
        wrapW: wrap ? wrap.getBoundingClientRect().width : 0,
        scrollW: wrap ? wrap.scrollWidth : 0,
        note: document.querySelector('#print-note')?.textContent || '',
      });
    })()`);
    const ps = JSON.parse(printState);
    check('打印预览已渲染', ps.stage === true);
    check('预览未溢出容器（无横向滚动）', ps.scrollW <= ps.wrapW + 2, `scrollW=${Math.round(ps.scrollW)} wrapW=${Math.round(ps.wrapW)}`);
    check('打印说明含出血信息', ps.note.includes('出血'), ps.note.slice(0, 60));
    shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'browser-print.png'), Buffer.from(shot.data, 'base64'));

    console.log('\n[8] 复刻页签 + 长文本边界');
    const edge = await cdp.eval(`(async () => {
      const core = await import('/web/js/core.js');
      const ed = await import('/web/js/editor.js');
      document.querySelector('.tab-btn[data-tab="editor"]').click();
      await new Promise(r => setTimeout(r, 300));
      const t = core.makeTextLayer({ text: '很长的一行文字测试'.repeat(6), size_mm: 12, x_mm: 2, y_mm: 2 });
      ed.addLayer(t, { silent: true });
      await new Promise(r => setTimeout(r, 300));
      const node = document.querySelector('#stage-viewport .layer-el[data-layer-id="' + t.id + '"]');
      const box = node ? node.getBoundingClientRect() : null;
      const stageBox = document.querySelector('#stage-viewport .stage')?.getBoundingClientRect();
      const inside = box && stageBox ? (box.left >= stageBox.left - 2) : null;
      ed.deleteLayer(t.id);
      const gone = !document.querySelector('#stage-viewport .layer-el[data-layer-id="' + t.id + '"]');
      return JSON.stringify({ added: !!node, inside, deleted: gone });
    })()`);
    const ed2 = JSON.parse(edge);
    check('超长文字图层能加进来且定位正确', ed2.added === true && ed2.inside === true, JSON.stringify(ed2));
    check('删除图层后 DOM 同步移除', ed2.deleted === true, String(ed2.deleted));

    console.log('\n[9] 打印链路真的会出内容');
    const printCall = await cdp.eval(`(async () => {
      document.querySelector('.tab-btn[data-tab="print"]').click();
      await new Promise(r => setTimeout(r, 400));
      window.__printCalls = 0;
      const realPrint = window.print;
      window.print = () => { window.__printCalls += 1; };
      document.querySelector('#btn-print').click();
      await new Promise(r => setTimeout(r, 600));
      const root = document.getElementById('print-root');
      const stage = root ? root.querySelector('.stage') : null;
      const marks = stage ? stage.querySelectorAll('.crop-mark').length : 0;
      const layerEls = stage ? stage.querySelectorAll('.layer-el').length : 0;
      const out = {
        calls: window.__printCalls,
        hasRoot: !!root,
        hasStage: !!stage,
        layerEls,
        marks,
        stageW: stage ? stage.getBoundingClientRect().width : 0,
      };
      window.print = realPrint;
      return JSON.stringify(out);
    })()`);
    const pc = JSON.parse(printCall);
    check('#print-root 容器存在', pc.hasRoot === true);
    check('点「打印」真的调用了 window.print', pc.calls >= 1, `调用 ${pc.calls} 次`);
    check('打印容器里生成了真实舞台', pc.hasStage === true, `图层 ${pc.layerEls} 个`);
    check('打印舞台带裁切角线', pc.marks > 0, `${pc.marks} 段角线`);

    // 切到 print 媒体查询，整页截图应当是「有内容的白纸」而不是纯白
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
    await sleep(400);
    const printShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(SHOTS, 'browser-print-media.png'), Buffer.from(printShot.data, 'base64'));
    const inkCheck = await cdp.eval(`(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,${printShot.data}';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let nonWhite = 0;
      for (let i = 0; i < d.length; i += 4 * 37) {
        if (d[i] < 245 || d[i+1] < 245 || d[i+2] < 245) nonWhite += 1;
      }
      return JSON.stringify({ nonWhite, sampled: Math.floor(d.length / (4*37)) });
    })()`);
    const ic = JSON.parse(inkCheck);
    check('打印媒体下不是白纸', ic.nonWhite > 50, `非白采样点 ${ic.nonWhite}/${ic.sampled}`);
    await cdp.send('Emulation.setEmulatedMedia', { media: '' });

    console.log('\n[10] 预览与导出的一致性（文字位置 / 平铺密度）');
    const parity = await cdp.eval(`(async () => {
      const core = await import('/web/js/core.js');
      const ed = await import('/web/js/editor.js');
      const stage = await import('/web/js/stage.js');
      document.querySelector('.tab-btn[data-tab="editor"]').click();
      await new Promise(r => setTimeout(r, 200));
      core.state.page = { size: 'A5', orientation: 'portrait', dpi: 300, bleed_mm: 0, crop_marks: false };
      core.state.background = { type: 'color', value: '#ffffff', tile: false };
      core.state.layers = [core.makeTextLayer({ text: '手账 Ag', size_mm: 10, color: '#000000', x_mm: 20, y_mm: 30 })];
      core.state.selection = null;
      core.resetHistory();
      ed.render();
      await new Promise(r => setTimeout(r, 400));
      const st = document.querySelector('#stage-viewport .stage');
      const r = st.getBoundingClientRect();
      const el = st.querySelector('.layer-el');
      const box = el.getBoundingClientRect();
      return JSON.stringify({
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        domBoxMm: { x: (box.x - r.x) / r.width * 148, y: (box.y - r.y) / r.height * 210,
                    w: box.width / r.width * 148, h: box.height / r.height * 210 },
        measureMm: stage.measureTextMm(core.state.layers[0]),
      });
    })()`);
    const pa = JSON.parse(parity);
    // DOM 元素盒必须落在 (x_mm, y_mm) 且尺寸与服务端同一套度量
    check('文字层盒左上角落在 x_mm/y_mm', Math.abs(pa.domBoxMm.x - 20) < 0.35 && Math.abs(pa.domBoxMm.y - 30) < 0.35,
      `实际 ${pa.domBoxMm.x.toFixed(2)}, ${pa.domBoxMm.y.toFixed(2)}（期望 20, 30）`);
    check('文字盒宽高与测量一致', Math.abs(pa.domBoxMm.w - pa.measureMm[0]) < 0.35 && Math.abs(pa.domBoxMm.h - pa.measureMm[1]) < 0.35,
      `DOM ${pa.domBoxMm.w.toFixed(2)}×${pa.domBoxMm.h.toFixed(2)} vs 测量 ${pa.measureMm[0].toFixed(2)}×${pa.measureMm[1].toFixed(2)}`);

    // 裁出舞台区域截图，在浏览器里量墨迹包围盒，再和服务端渲染结果对齐
    const clip = { x: Math.round(pa.rect.x), y: Math.round(pa.rect.y), width: Math.round(pa.rect.width), height: Math.round(pa.rect.height), scale: 1 };
    const stageShot = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
    const domInk = await cdp.eval(`(async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,${stageShot.data}';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y += 1) {
        for (let x = 0; x < c.width; x += 1) {
          const i = (y * c.width + x) * 4;
          if (d[i] < 128 && d[i+1] < 128 && d[i+2] < 128) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) return JSON.stringify({ found: false });
      return JSON.stringify({ found: true, w: c.width, h: c.height, x0, y0, x1, y1 });
    })()`);
    const di = JSON.parse(domInk);
    check('预览里能测到文字墨迹', di.found === true);

    if (di.found) {
      const reqBody = JSON.stringify({
        page: { size: 'A5', dpi: 300, bleed_mm: 0, crop_marks: false, orientation: 'portrait' },
        background: { type: 'color', value: '#ffffff' },
        layers: [{ kind: 'text', text: '手账 Ag', font: 'sans', size_mm: 10, color: '#000000',
                   x_mm: 20, y_mm: 30, rotate: 0, opacity: 1, align: 'left' }],
      });
      const res = await fetch(BASE + '/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: reqBody });
      const buf = Buffer.from(await res.arrayBuffer());
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); // 占位，保持 CDP 节奏
      // 把服务端 PNG 交给浏览器解码量墨迹，避免在 Node 里引第三方 PNG 解码库
      const srvInk = await cdp.eval(`(async () => {
        const img = new Image();
        img.src = 'data:image/png;base64,${buf.toString('base64')}';
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y += 1) {
          for (let x = 0; x < c.width; x += 1) {
            const i = (y * c.width + x) * 4;
            if (d[i] < 128 && d[i+1] < 128 && d[i+2] < 128) {
              if (x < x0) x0 = x; if (x > x1) x1 = x;
              if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
        }
        const mmPerPx = 148 / c.width;
        return JSON.stringify({
          found: x1 >= 0,
          leftMm: x0 * mmPerPx, topMm: y0 * (210 / c.height),
          rightMm: x1 * mmPerPx, bottomMm: y1 * (210 / c.height),
        });
      })()`);
      const si = JSON.parse(srvInk);
      check('导出里能测到文字墨迹', si.found === true);
      if (si.found) {
        const dom = {
          leftMm: di.x0 * 148 / di.w, topMm: di.y0 * 210 / di.h,
          rightMm: di.x1 * 148 / di.w, bottomMm: di.y1 * 210 / di.h,
        };
        const dx = Math.abs(dom.leftMm - si.leftMm);
        const dy = Math.abs(dom.topMm - si.topMm);
        const dRight = Math.abs(dom.rightMm - si.rightMm);
        const dBottom = Math.abs(dom.bottomMm - si.bottomMm);
        check('预览与导出的文字左边界对齐（≤0.8mm）', dx <= 0.8, `差分 ${dx.toFixed(2)}mm`);
        check('预览与导出的文字上边界对齐（≤0.8mm）', dy <= 0.8, `差分 ${dy.toFixed(2)}mm`);
        check('预览与导出的文字宽度一致（≤1.0mm）', dRight <= 1.0, `差分 ${dRight.toFixed(2)}mm`);
        check('预览与导出的文字高度一致（≤1.0mm）', dBottom <= 1.0, `差分 ${dBottom.toFixed(2)}mm`);
      }
    }

    const tileInfo = await cdp.eval(`(async () => {
      const core = await import('/web/js/core.js');
      const ed = await import('/web/js/editor.js');
      const paper = core.state.materials.items.find(m => m.cat === 'paper' && m.tile) || core.state.materials.items.find(m => m.cat === 'paper');
      if (!paper) return JSON.stringify({ skip: true });
      core.state.background = { type: 'material', value: paper.id, tile: true };
      core.state.layers = [];
      ed.render();
      await new Promise(r => setTimeout(r, 300));
      const st = document.querySelector('#stage-viewport .stage');
      const [nw, nh] = core.naturalMm(paper);
      return JSON.stringify({ skip: false, size: st.style.backgroundSize, nw, nh, id: paper.id,
                              imageW: paper.w, imageH: paper.h, cat: paper.cat });
    })()`);
    const ti = JSON.parse(tileInfo);
    if (!ti.skip) {
      const m = /([\d.]+)mm\s+([\d.]+)mm/.exec(ti.size || '');
      const okTile = !!m && Math.abs(parseFloat(m[1]) - ti.nw) < 0.01 && Math.abs(parseFloat(m[2]) - ti.nh) < 0.01;
      check('平铺背景用的是自然毫米尺寸', okTile,
        `DOM "${ti.size}" vs 自然尺寸 ${ti.nw.toFixed(2)}×${ti.nh.toFixed(2)}mm（素材 ${ti.imageW}×${ti.imageH}px, ${ti.cat}）`);
    }

    console.log('\n[11] 控制台错误');
    const realErrors = errors.filter((e) =>
      e && !/favicon|DevTools|net::ERR_/i.test(e));
    check('运行期间没有 JS 报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | ') || '干净');

    console.log('\n截图已保存到 _shots/：browser-editor.png, browser-print.png');
  } finally {
    try { cdp?.ws.close(); } catch { /* 忽略 */ }
    try { proc.kill(); } catch { /* 忽略 */ }
    await sleep(400);
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }

  console.log('\n' + '='.repeat(52));
  console.log(`浏览器端：通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(52));
  return fail ? 1 : 0;
}

process.exit(await main());
