/**
 * 纯静态版（GitHub Pages 场景）的浏览器端验证。
 *
 * 两种跑法：
 *   1) 本地：起一个「没有任何后端接口」的普通静态服务器托管仓库根目录，模拟 GitHub Pages
 *      node tests/browser_static_check.mjs
 *   2) 线上：直接打真实部署地址
 *      node tests/browser_static_check.mjs https://<用户>.github.io/<仓库>/
 *
 * 验证前端能自动落到 static 模式，并在浏览器里独立完成：
 *   素材库加载 → 页面分析 → 复刻重排 → 300dpi 渲染 → PNG/PDF 导出 → 打印
 *
 * 最关键的一项：把 render.js 画出来的图和 Python 渲染引擎（8765 上的 /api/render）
 * 的同一请求结果做逐像素对比，证明静态版和本地版印出来是一样的。
 * 线上跑时如果本机 8765 没开，这一项会自动跳过。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ART = join(HERE, '_artifacts');
const argUrl = process.argv[2] && process.argv[2].startsWith('http') ? process.argv[2].replace(/\/$/, '') : null;
const STATIC_PORT = Number(argUrl ? 0 : (process.argv[2] || 8770));
const PY_BASE = process.argv[3] || 'http://127.0.0.1:8765';
const CDP_PORT = 9355;
const PY = 'C:\\Users\\AT1556\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => { try { readFileSync(p); return true; } catch { return false; } });

let pass = 0; let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${name}${detail ? '  —— ' + detail : ''}`); }
  else { fail += 1; console.log(`  ❌ ${name}${detail ? '  —— ' + detail : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) (this.handlers.get(m.method) || []).forEach((fn) => fn(m.params));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} 超时`)); } }, 120000);
    });
  }
  on(m, fn) { if (!this.handlers.has(m)) this.handlers.set(m, []); this.handlers.get(m).push(fn); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
}

async function waitPort(port, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return true; } catch { /* 未就绪 */ }
    await sleep(250);
  }
  return false;
}

async function main() {
  if (!CHROME) { console.log('没找到 Chrome/Edge，跳过'); return 0; }
  mkdirSync(ART, { recursive: true });

  console.log('== 纯静态版浏览器验证 ==\n');
  const SITE = argUrl || `http://127.0.0.1:${STATIC_PORT}`;
  let staticSrv = null;
  if (argUrl) {
    console.log(`[0] 目标：线上站点 ${SITE}`);
  } else {
    console.log(`[0] 启动无后端静态服务器 :${STATIC_PORT}（模拟 GitHub Pages）`);
    staticSrv = spawn(PY, ['-m', 'http.server', String(STATIC_PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
    await sleep(1500);
  }

  const userDataDir = join(tmpdir(), `cdp_static_${Date.now()}`);
  const chromeProc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`,
    '--window-size=1680,1050', 'about:blank',
  ], { stdio: 'ignore' });

  const errors = [];
  let cdp;
  try {
    if (!(await waitPort(CDP_PORT))) throw new Error('Chrome DevTools 未就绪');
    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    cdp = new CDP(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '未知异常'));
    cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push((p.args || []).map((a) => a.value ?? a.description ?? '').join(' ')); });

    // 确认这个站点真的没有后端接口
    const healthProbe = await fetch(`${SITE}/api/health`).then((r) => r.status).catch(() => 0);
    check('站点上没有 /api/health（真的是无后端）', healthProbe === 404, `status=${healthProbe}`);

    console.log('\n[1] 页面在无后端环境下启动');
    await cdp.send('Page.navigate', { url: `${SITE}/` });
    await sleep(5000);
    const mode = await cdp.eval('window.__JOURNAL_MODE__ || null');
    check('自动识别为静态模式', mode === 'static', `mode=${mode}`);
    const badge = await cdp.eval(`document.querySelector('.mode-badge')?.textContent || ''`);
    check('界面显示了模式徽标', badge.length > 0, badge);

    console.log('\n[2] 内置素材在静态托管下可用');
    const mat = await cdp.eval(`(async () => {
      const core = await import('./web/js/core.js');
      return JSON.stringify({ items: core.state.materials.items.length, cats: core.state.materials.categories.length });
    })()`);
    const mi = JSON.parse(mat);
    check('素材清单加载成功', mi.items === 181, `${mi.items} 件 / ${mi.cats} 类`);
    const grid = await cdp.eval(`(async () => {
      await new Promise(r => setTimeout(r, 1200));
      const cards = document.querySelectorAll('#material-grid .mat-card').length;
      const img = document.querySelector('#material-grid .mat-card img');
      return JSON.stringify({ cards, imgOk: img ? (img.complete && img.naturalWidth > 0) : false });
    })()`);
    const gi = JSON.parse(grid);
    check('素材网格渲染且缩略图真实加载', gi.cards > 0 && gi.imgOk === true, `${gi.cards} 张卡片, 图片加载=${gi.imgOk}`);

    console.log('\n[3] 页面分析（浏览器内完成，不走服务器）');
    const sampleB64 = readFileSync(join(HERE, 'fixtures', 'sample-page.png')).toString('base64');
    const analysis = await cdp.eval(`(async () => {
      const mod = await import('./web/js/analysis.js');
      const bin = atob('${sampleB64}');
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const t0 = performance.now();
      const r = await mod.analyzeImageBlob(new Blob([u8], { type: 'image/png' }));
      const ms = performance.now() - t0;
      return JSON.stringify({ ms, regions: r.regions.length, types: r.regions.map(x => x.type), bg: r.background.hex, style: r.style, page: r.suggest.page_size });
    })()`);
    const an = JSON.parse(analysis);
    check('分析返回了区块', an.regions >= 2, `${an.regions} 块：${an.types.join('/')}  耗时 ${an.ms.toFixed(0)}ms`);
    check('分析识别出文字区块', an.types.includes('text'), `类型分布 ${JSON.stringify(an.types)}`);
    check('分析给出背景与风格', !!an.bg && !!an.style.mood, `${an.bg} / ${an.style.mood}·${an.style.density}`);
    check('分析耗时 < 3s', an.ms < 3000, `${an.ms.toFixed(0)}ms`);

    console.log('\n[4] 复刻重排（用浏览器内分析结果驱动）');
    const composed = await cdp.eval(`(async () => {
      const rec = await import('./web/js/recreate.js');
      const core = await import('./web/js/core.js');
      const mod = await import('./web/js/analysis.js');
      const bin = atob('${sampleB64}');
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const data = await mod.analyzeImageBlob(new Blob([u8], { type: 'image/png' }));
      rec.composeLayout(data);
      await new Promise(r => setTimeout(r, 500));
      const kinds = {};
      for (const l of core.state.layers) kinds[l.kind] = (kinds[l.kind] || 0) + 1;
      return JSON.stringify({ layers: core.state.layers.length, kinds });
    })()`);
    const co = JSON.parse(composed);
    check('复刻生成了图层', co.layers >= 3, `${co.layers} 层 ${JSON.stringify(co.kinds)}`);
    check('复刻用到了素材', (co.kinds.material || 0) >= 2, `material=${co.kinds.material || 0}`);

    console.log('\n[5] 浏览器内 300dpi 渲染 + 与 Python 渲染逐像素对比');
    const rect = `{x_mm:20,y_mm:30,w_mm:60,h_mm:40}`;
    const compare = await cdp.eval(`(async () => {
      const core = await import('./web/js/core.js');
      const rend = await import('./web/js/render.js');
      core.state.page = { size:'A5', orientation:'portrait', dpi:300, bleed_mm:3, crop_marks:true };
      core.state.background = { type:'color', value:'#fffdf7', tile:false };
      const tape = core.state.materials.items.find(m => m.cat === 'tape');
      core.state.layers = [
        { id:'s1', kind:'shape', shape:'rect', fill:'#f6dfe3', x_mm:15, y_mm:20, w_mm:60, h_mm:40, rotate:-6, opacity:0.9 },
        { id:'m1', kind:'material', ref:tape.id, x_mm:10, y_mm:80, w_mm:90, h_mm:24, rotate:-4, opacity:1 },
        { id:'t1', kind:'text', text:'2026.09.30 手账工坊', font:'sans', size_mm:9, color:'#5b4a3f',
          x_mm:15, y_mm:120, rotate:0, opacity:1, align:'left' },
      ];
      const req = core.buildRenderRequest();
      const t0 = performance.now();
      const blob = await rend.renderToPngBlob(req);
      const ms = performance.now() - t0;
      const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
      return JSON.stringify({ ms, bytes: blob.size, b64, req });
    })()`);
    const cmp = JSON.parse(compare);
    check('浏览器渲染出 PNG', cmp.bytes > 10000, `${(cmp.bytes / 1024).toFixed(0)}KB，耗时 ${cmp.ms.toFixed(0)}ms`);

    const pyRes = await fetch(`${PY_BASE}/api/render`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmp.req),
    }).catch(() => null);
    if (!pyRes || !pyRes.ok) {
      console.log(`  ⏭  本机 Python 服务（${PY_BASE}）没在跑，跳过与 Python 的逐像素对比`);
    } else {
      const pyB64 = Buffer.from(await pyRes.arrayBuffer()).toString('base64');
      const diff = await cdp.eval(`(async () => {
        const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b64; });
        const a = await load('${cmp.b64}');
        const b = await load('${pyB64}');
        if (a.width !== b.width || a.height !== b.height) return JSON.stringify({ sizeMismatch: [a.width,a.height,b.width,b.height] });
        const c1 = document.createElement('canvas'); c1.width = a.width; c1.height = a.height;
        const c2 = document.createElement('canvas'); c2.width = b.width; c2.height = b.height;
        const x1 = c1.getContext('2d', {willReadFrequently:true}); const x2 = c2.getContext('2d', {willReadFrequently:true});
        x1.drawImage(a,0,0); x2.drawImage(b,0,0);
        const d1 = x1.getImageData(0,0,c1.width,c1.height).data;
        const d2 = x2.getImageData(0,0,c2.width,c2.height).data;
        let n=0, sum=0, maxd=0, diffPx=0;
        for (let i = 0; i < d1.length; i += 4) {
          const dv = (Math.abs(d1[i]-d2[i]) + Math.abs(d1[i+1]-d2[i+1]) + Math.abs(d1[i+2]-d2[i+2])) / 3;
          n++; sum += dv; if (dv > maxd) maxd = dv; if (dv > 24) diffPx++;
        }
        return JSON.stringify({ width: c1.width, height: c1.height, mean: sum/n, max: maxd, diffRatio: diffPx/n });
      })()`);
      const dd = JSON.parse(diff);
      if (dd.sizeMismatch) {
        check('两边渲染尺寸一致', false, `JS ${dd.sizeMismatch[0]}×${dd.sizeMismatch[1]} vs Python ${dd.sizeMismatch[2]}×${dd.sizeMismatch[3]}`);
      } else {
        check('两边渲染尺寸一致', true, `${dd.width}×${dd.height}`);
        check('平均像素差 < 6（字体栅格化差异允许）', dd.mean < 6, `平均 ${dd.mean.toFixed(2)}/255，最大 ${dd.max.toFixed(0)}`);
        check('明显不同的像素占比 < 6%', dd.diffRatio < 0.06, `${(dd.diffRatio * 100).toFixed(2)}%`);
      }
    }

    console.log('\n[6] 打印链路（静态模式）');
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
    await sleep(300);
    const printInfo = await cdp.eval(`(async () => {
      const core = await import('./web/js/core.js');
      const printer = await import('./web/js/print.js');
      document.querySelector('.tab-btn[data-tab="print"]').click();
      await new Promise(r => setTimeout(r, 500));
      window.__calls = 0; const real = window.print; window.print = () => { window.__calls++; };
      document.querySelector('#btn-print').click();
      await new Promise(r => setTimeout(r, 500));
      window.print = real;
      const root = document.getElementById('print-root');
      const st = root ? root.querySelector('.stage') : null;
      return JSON.stringify({ calls: window.__calls, stage: !!st, layers: st ? st.querySelectorAll('.layer-el').length : 0,
                              marks: st ? st.querySelectorAll('.crop-mark').length : 0 });
    })()`);
    const pi = JSON.parse(printInfo);
    check('静态模式点打印会调用 window.print', pi.calls >= 1, `${pi.calls} 次`);
    check('打印容器生成了真实舞台', pi.stage === true, `${pi.layers} 图层 / ${pi.marks} 段角线`);
    await cdp.send('Emulation.setEmulatedMedia', { media: '' });

    console.log('\n[7] 导出 PNG / PDF（纯浏览器）');
    const exp = await cdp.eval(`(async () => {
      const core = await import('./web/js/core.js');
      const rend = await import('./web/js/render.js');
      const { buildPdf } = await import('./web/js/pdf.js');
      const req = core.buildRenderRequest();
      const jpeg = await rend.renderToJpeg(req);
      const geo = rend.pageGeometry(req.page);
      const bytes = buildPdf([{ jpeg: jpeg.jpeg, width: jpeg.width, height: jpeg.height }],
        { pageWmm: geo.w_mm + geo.bleed_mm*2, pageHmm: geo.h_mm + geo.bleed_mm*2, dpi: geo.dpi, title: '手账工坊 测试' });
      const head = String.fromCharCode.apply(null, bytes.slice(0, 8));
      const tail = String.fromCharCode.apply(null, bytes.slice(-8));
      return JSON.stringify({ jpegBytes: jpeg.jpeg.length, pdfBytes: bytes.length, head, tail,
                              hasCatalog: new TextDecoder('latin1').decode(bytes).includes('/Type /Catalog') });
    })()`);
    const ex = JSON.parse(exp);
    check('JPEG 编码成功', ex.jpegBytes > 10000, `${(ex.jpegBytes / 1024).toFixed(0)}KB`);
    check('PDF 结构正确', ex.head.startsWith('%PDF-1.') && ex.tail.includes('EOF') && ex.hasCatalog,
      `${(ex.pdfBytes / 1024).toFixed(0)}KB, head="${ex.head}"`);

    console.log('\n[8] 控制台错误');
    const real = errors.filter((e) => e && !/favicon|DevTools|net::ERR_(FILE|ABORTED)/i.test(e));
    check('运行期间没有 JS 报错', real.length === 0, real.slice(0, 3).join(' | ') || '干净');

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(ART, 'static-mode.png'), Buffer.from(shot.data, 'base64'));
  } catch (e) {
    console.log(`\n❌ 验证中断：${e.message}`);
    fail += 1;
  } finally {
    try { cdp?.ws.close(); } catch { /* 忽略 */ }
    try { chromeProc.kill(); } catch { /* 忽略 */ }
    try { staticSrv?.kill(); } catch { /* 忽略 */ }
    await sleep(400);
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }

  console.log('\n' + '='.repeat(52));
  console.log(`静态版：通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(52));
  return fail ? 1 : 0;
}

process.exit(await main());
