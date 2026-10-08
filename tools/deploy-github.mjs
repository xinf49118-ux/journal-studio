/**
 * 把整个项目发布到 GitHub（不依赖 git，纯 GitHub REST API）。
 *
 * 做五件事：
 *   1. 校验 token、取登录名
 *   2. 创建公开仓库（已存在则复用）
 *   3. 空仓库先做一次初始化提交（Git Data API 在空仓库上会 409）
 *   4. 一次提交推送全部文件（blobs → tree → commit → ref）
 *   5. 打开 GitHub Pages，构建源设为 GitHub Actions（仓库里的 workflow 随后自动部署）
 *
 * 用法：
 *   node tools/deploy-github.mjs --token-file <路径> [--repo journal-studio] [--dry-run]
 *   GH_TOKEN=xxx node tools/deploy-github.mjs
 */
import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.github.com';
const UA = 'JournalStudio-Deployer/1.0';

/* 不推送的路径（与 .gitignore 保持一致） */
const EXCLUDE_DIRS = new Set(['.git', '.tools', 'data', '__pycache__', '_artifacts', 'node_modules', '.venv', 'venv', '.idea', '.vscode']);
const EXCLUDE_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const token = (() => {
  const tf = arg('token-file');
  if (tf && typeof tf === 'string') return readFileSync(tf, 'utf8').trim();
  return (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
})();
const REPO = String(arg('repo', 'journal-studio'));
const DRY = !!arg('dry-run', false);

if (!token) {
  console.error('缺少 token。用 --token-file <路径> 或环境变量 GH_TOKEN。');
  process.exit(2);
}

async function gh(path, { method = 'GET', body = null } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 1)));
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': UA,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // 网络层的瞬时故障（连接被重置、DNS 抖动）重试；HTTP 状态错误不重试
      lastErr = new Error(`${method} ${path} → 网络错误: ${e.cause?.code || e.message}`);
      continue;
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (res.ok) return data;
    // 429 / 5xx 也值得重试
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      lastErr = new Error(`${method} ${path} → ${res.status}`);
      continue;
    }
    const err = new Error(`${method} ${path} → ${res.status}: ${(data && data.message) || text.slice(0, 200)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  throw lastErr;
}

/** 递归收集要推送的文件 */
async function collectFiles(dir = ROOT, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = relative(ROOT, full).split(sep).join('/');
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      await collectFiles(full, out);
    } else if (e.isFile()) {
      if (EXCLUDE_FILES.has(e.name)) continue;
      if (e.name.endsWith('.pyc') || e.name.endsWith('.tmp') || e.name.endsWith('.log')) continue;
      out.push({ rel, full, size: statSync(full).size });
    }
  }
  return out;
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  console.log('== 发布到 GitHub ==\n');

  const files = await collectFiles();
  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  if (DRY) {
    console.log(`待推送文件：${files.length} 个，共 ${(totalBytes / 1024 / 1024).toFixed(1)} MB\n`);
    const byTop = new Map();
    for (const f of files) {
      const top = f.rel.includes('/') ? f.rel.split('/')[0] : '(根目录)';
      const cur = byTop.get(top) || { n: 0, b: 0 };
      byTop.set(top, { n: cur.n + 1, b: cur.b + f.size });
    }
    for (const [top, v] of [...byTop].sort((a, b) => b[1].b - a[1].b)) {
      console.log(`  ${top.padEnd(16)} ${String(v.n).padStart(4)} 个   ${(v.b / 1024 / 1024).toFixed(2)} MB`);
    }
    console.log('\n（--dry-run 到此为止，没有做任何修改）');
    return 0;
  }

  const user = await gh('/user');
  const owner = user.login;
  console.log(`[1] 已认证：${owner}（${user.name || '未填昵称'}）`);
  console.log(`[2] 待推送文件：${files.length} 个，共 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

  // --- 建仓库 ---
  let repoExists = false;
  try {
    await gh(`/repos/${owner}/${REPO}`);
    repoExists = true;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  if (!repoExists) {
    await gh('/user/repos', {
      method: 'POST',
      body: {
        name: REPO,
        description: '手账工坊 Journal Studio —— 收集全网手账素材、复刻别人的手账页、一键打印（本地版 + 在线版）',
        homepage: `https://${owner}.github.io/${REPO}/`,
        private: false,
        has_issues: true,
        has_wiki: false,
        auto_init: false,
      },
    });
    console.log(`[3] 已创建公开仓库：https://github.com/${owner}/${REPO}`);
  } else {
    console.log(`[3] 仓库已存在，将更新内容：https://github.com/${owner}/${REPO}`);
  }

  // --- 空仓库先初始化 ---
  // Git Data API 在完全没有提交的仓库上会返回 409 "Git Repository is empty"，
  // 所以先用 Contents API 放一个 README 把仓库激活。
  let baseTree;
  let parents = [];
  const readHead = async () => {
    const ref = await gh(`/repos/${owner}/${REPO}/git/ref/heads/main`);
    const parentCommit = await gh(`/repos/${owner}/${REPO}/git/commits/${ref.object.sha}`);
    baseTree = parentCommit.tree.sha;
    parents = [ref.object.sha];
  };
  try {
    await readHead();
  } catch (e) {
    if (e.status !== 404 && e.status !== 409) throw e;
    await gh(`/repos/${owner}/${REPO}/contents/README.md`, {
      method: 'PUT',
      body: { message: '初始化仓库', content: readFileSync(join(ROOT, 'README.md')).toString('base64') },
    });
    await readHead();
    console.log('[4] 空仓库已初始化');
  }

  // --- 上传 blobs（并发 8）---
  process.stdout.write(`[5] 上传 ${files.length} 个文件 `);
  let done = 0;
  const blobs = await pool(files, 8, async (f) => {
    const blob = await gh(`/repos/${owner}/${REPO}/git/blobs`, {
      method: 'POST',
      body: { content: readFileSync(f.full).toString('base64'), encoding: 'base64' },
    });
    done += 1;
    if (done % 25 === 0 || done === files.length) process.stdout.write(`.${done}`);
    return { path: f.rel, mode: '100644', type: 'blob', sha: blob.sha };
  });
  process.stdout.write('\n');

  // --- tree + commit ---
  const tree = await gh(`/repos/${owner}/${REPO}/git/trees`, {
    method: 'POST',
    body: baseTree ? { base_tree: baseTree, tree: blobs } : { tree: blobs },
  });
  console.log(`[6] 已创建目录树（${blobs.length} 项）`);

  const commit = await gh(`/repos/${owner}/${REPO}/git/commits`, {
    method: 'POST',
    body: {
      message: '手账工坊 Journal Studio：本地版 + 在线版\n\n'
        + '- 181 件程序生成的原创素材（8 类，CC0）\n'
        + '- 上传别人的手账页 → 自动识别配色与版式 → 素材重排同款\n'
        + '- A5/A6/A4/B5 一键打印，300dpi，含出血与裁切角线\n'
        + '- 同一套前端代码：本机跑 Python 后端，线上纯浏览器运行\n'
        + '- 279 项自动化检查（含真 Chrome 驱动的前端测试）',
      tree: tree.sha,
      parents,
    },
  });

  try {
    await gh(`/repos/${owner}/${REPO}/git/refs`, {
      method: 'POST',
      body: { ref: 'refs/heads/main', sha: commit.sha },
    });
  } catch (e) {
    if (e.status === 422) {
      await gh(`/repos/${owner}/${REPO}/git/refs/heads/main`, {
        method: 'PATCH',
        body: { sha: commit.sha, force: true },
      });
    } else throw e;
  }
  console.log(`[7] 已提交并推送（${commit.sha.slice(0, 8)}）`);

  // --- 打开 Pages ---
  let pagesOk = false;
  try {
    try {
      await gh(`/repos/${owner}/${REPO}/pages`, { method: 'POST', body: { build_type: 'workflow' } });
    } catch (e) {
      if (e.status === 409) {
        await gh(`/repos/${owner}/${REPO}/pages`, { method: 'PUT', body: { build_type: 'workflow' } });
      } else throw e;
    }
    pagesOk = true;
    console.log('[8] 已开启 GitHub Pages（构建源：GitHub Actions）');
  } catch (e) {
    console.log(`[8] 开启 Pages 失败：${e.message}`);
    console.log('    手动开启：仓库 → Settings → Pages → Source 选 "GitHub Actions"');
  }

  console.log('\n' + '='.repeat(56));
  console.log(`仓库地址：https://github.com/${owner}/${REPO}`);
  if (pagesOk) {
    console.log(`在线版地址：https://${owner}.github.io/${REPO}/`);
    console.log('首次部署要等 Actions 跑完，约 1–2 分钟；之后每次 push 自动更新。');
  }
  console.log('='.repeat(56));
  return 0;
}

main().catch((e) => {
  console.error('\n失败：' + e.message);
  if (e.cause) {
    // undici 的 fetch failed 会把真正原因藏在 cause 里
    console.error(`底层原因：${e.cause.code || ''} ${e.cause.message || ''}`.trim());
    if (e.cause.cause) console.error(`更深一层：${e.cause.cause.code || ''} ${e.cause.cause.message || ''}`.trim());
  }
  if (e.status === 401) console.error('token 无效或已过期。');
  if (e.status === 403) console.error('权限不足：token 需要 public_repo 与 workflow 范围。');
  process.exit(1);
});
