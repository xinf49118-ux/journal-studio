/* 应用入口：标签页、初始化、工程自动保存 */

import {
  state, on, emit, loadProject, serializeProject, resetHistory, canUndo, canRedo, pageDims,
} from './core.js';
import { api, detectMode } from './api.js';
import { DraftSaver } from './draft.js';
import { initWorkspace } from './workspace.js';
import { $, $$, ok, err, toast } from './ui.js';
import { initLibrary, loadMaterials, loadLibrary } from './library.js';
import { initEditor, render as renderEditor, zoomToFit } from './editor.js';
import {initCraft} from './craft-ui.js';
import { initRecreate } from './recreate.js';
import { initPrint, refreshPrintPreview } from './print.js';

let saveTimer = null;
let lastSaved = '';

function activateTab(name) {
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (btn) btn.click();
}

function initTabs() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
      if (btn.dataset.tab === 'editor') {
        renderEditor();
        // 只在对齐类缩放（用户没手动缩放过）时自动适应窗口，避免每次切页签都跳一下
        if (state.autoZoom !== false) zoomToFit();
      }
      if (btn.dataset.tab === 'print') refreshPrintPreview();
    });
  });
  // 支持 ?tab=editor 这样的深链，方便分享/书签
  const want = new URLSearchParams(location.search).get('tab') || location.hash.replace('#', '');
  if (want && document.querySelector(`.tab-btn[data-tab="${want}"]`)) {
    setTimeout(() => activateTab(want), 0);
  }
}

const saver = new DraftSaver(p => api.saveProject(p), (status, message) => {
  const label = $('#save-status');
  if (label) { label.textContent = message; label.dataset.status = status; }
});
async function flushDraft() {
  clearTimeout(saveTimer);
  await saver.save(serializeProject());
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const payload = JSON.stringify(serializeProject());
    try { await saver.save(JSON.parse(payload)); lastSaved = payload; } catch (e) { /* status remains visible; the next edit or manual save retries */ }
  }, 1200);
}

async function restoreProject() {
  try {
    const data = await api.getProject();
    if (data.project && Array.isArray(data.project.layers)) {
      loadProject(data.project);
      lastSaved = JSON.stringify(serializeProject());
      const ps = $('#page-size');
      if (ps) ps.value = state.page.size;
      toast('已恢复上次的工程');
      return true;
    }
  } catch (e) { /* 首次使用没有工程，忽略 */ }
  resetHistory();
  return false;
}

async function boot() {
  initTabs();
  initLibrary();
  initEditor();
  initCraft();
  initRecreate();
  initPrint();

  on('changed', () => {
    scheduleSave();
    updateButtons();
    const ps = $('#page-size');
    if (ps && ps.value !== state.page.size) ps.value = state.page.size;
    const bp = $('#bg-paper');
    if (bp && state.background.type === 'material') bp.value = state.background.value;
    const bc = $('#bg-color');
    if (bc && state.background.type === 'color') bc.value = state.background.value;
  });
  on('history', () => { updateButtons(); scheduleSave(); });
  on('project', () => { renderEditor(); refreshPrintPreview(); updateButtons(); });
  on('background', () => {
    const bc = $('#bg-color');
    if (bc && state.background.type === 'color') bc.value = state.background.value;
    const bp = $('#bg-paper');
    if (bp) bp.value = state.background.type === 'material' ? state.background.value : '';
    renderEditor();
    refreshPrintPreview();
  });

  $('#btn-save-project')?.addEventListener('click', async () => {
    const payload = serializeProject();
    try {
      await flushDraft();
      lastSaved = JSON.stringify(payload);
      ok(api.mode() === 'static' ? '草稿已保存在当前浏览器；换电脑请导出备份' : '草稿已保存到本机；可在作品库导出备份');
    } catch (e) {
      err(`保存失败：${e.message}`);
    }
  });

  try {
    const mode = await detectMode();
    const health = await api.health();
    window.__JOURNAL_MODE__ = mode;
    const badge = document.createElement('span');
    badge.className = 'mode-badge';
    badge.title = mode === 'server'
      ? '本地服务模式：分析与渲染由本机 Python 完成后端处理'
      : '在线模式：全部计算在你的浏览器里完成，图片不会上传到任何地方';
    badge.textContent = mode === 'server' ? '本机版' : '在线版';
    document.querySelector('.topbar-actions')?.prepend(badge);
    if (!health.materials) {
      setTimeout(() => toast(
        mode === 'static'
          ? '没读到内置素材清单，请确认 assets/materials/manifest.json 已一起部署'
          : '还没有内置素材：请在项目目录运行 python tools/make_materials.py',
        'err', 8000,
      ), 600);
    }
  } catch (e) {
    err('初始化失败：' + e.message);
  }

  await loadMaterials();
  await loadLibrary();
  await restoreProject();
  initWorkspace(flushDraft);
  renderEditor();
  updateButtons();
  setTimeout(() => { zoomToFit(); refreshPrintPreview(); }, 60);
  window.addEventListener('resize', () => {
    if (document.getElementById('tab-editor')?.classList.contains('active')) { /* 保持缩放 */ }
  });
}

function updateButtons() {
  const u = $('#btn-undo'); const r = $('#btn-redo');
  if (u) u.disabled = !canUndo();
  if (r) r.disabled = !canRedo();
  const [w, h] = pageDims();
  const s = $('#page-summary');
  if (s) s.textContent = `${state.page.size} · ${w}×${h}mm · ${state.page.dpi}dpi`;
}

let booted = false;
function bootOnce() {
  if (booted) return;
  booted = true;
  boot();
}
document.addEventListener('DOMContentLoaded', bootOnce);
if (document.readyState !== 'loading') bootOnce();
