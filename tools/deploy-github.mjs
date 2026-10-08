/**
 * 把整个项目发布到 GitHub（不依赖 git，纯 GitHub REST API）。
 *
 * 做这些事：
 *   1. 校验 token、取登录名
 *   2. 创建公开仓库（已存在则复用）
 *   3. 空仓库先做一次初始化提交（Git Data API 在空仓库上会返回 409）
 *   4. 本地算 git blob 哈希，只上传内容变了的文件（二次发布很快且不触发限流）
 *   5. 一次提交推送全部文件（blobs → tree → commit → ref），树是完整快照
 *   6. 打开 GitHub Pages，构建源设为 GitHub Actions
 *
 * 用法：
 *   node tools/deploy-github.mjs --token-file <路径> [--repo journal-studio] [--dry-run]
 *   GH_TOKEN=xxx node tools/deploy-github.mjs
 */
import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.github.com';
const UA = 'JournalStudio-Deployer/1.0';

/* 不推送的路径（与 .gitignore 保持一致） */
const EXCLUDE_DIRS = new Set(['.git', '.tools', 'data', '__pycache__', '_artifacts', 'node_modules', '.venv', 'venv', '.idea', '.vscode']);
const EXCLUDE_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  for (let attempt = 0; attempt < 7; attempt += 1) {
    if (attempt) await sleep(Math.min(90000, 4000 * 2 ** (attempt - 1)));
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
      // 网络层的瞬时故障（连接被重置、DNS 抖动）重试；HTTP 状态错误走下面的分支
      lastErr = new Error(`${method} ${path} → 网络错误: ${e.cause?.code || e.message}`);
      continue;
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (res.ok) return data;

    const msg = (data && data.message) || '';
    // GitHub 的「二级限流」是突发请求太多触发，等一会儿就能继续；必须退避重试
    if (res.status === 403 && /secondary rate limit|abuse/i.test(msg)) {
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      const wait = Math.max(retryAfter * 1000, 15000 * (attempt + 1));
      console.log(`\n    ⏳ 触发 GitHub 二级限流，等待 ${Math.round(wait / 1000)}s 后继续…`);
      lastErr = new Error(`${method} ${path} → 403 二级限流（已重试 ${attempt + 1} 次）`);
      await sleep(wait);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      lastErr = new Error(`${method} ${path} → ${res.status}`);
      continue;
    }
    const err = new Error(`${method} ${path} → ${res.status}: ${msg || text.slice(0, 200)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  throw lastErr;
}

/** 本地计算 git blob 的 SHA-1，用来和仓库里已有的文件比对，跳过没变的内容 */
function gitBlobSha(buf) {
  const header = Buffer.from(`blob ${buf.length}\u0000`, 'utf8');
  return createHash('sha1').update(header).update(buf).digest('hex');
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

  // --- 比对已有内容，只上传变了的 ---
  const existing = new Map();
  if (baseTree) {
    try {
      const full = await gh(`/repos/${owner}/${REPO}/git/trees/${baseTree}?recursive=1`);
      for (const e of full.tree || []) if (e.type === 'blob') existing.set(e.path, e.sha);
    } catch (e) { /* 拿不到就当作全部要上传 */ }
  }
  const plan = files.map((f) => {
    const buf = readFileSync(f.full);
    const sha = gitBlobSha(buf);
    return { rel: f.rel, buf, sha, changed: existing.get(f.rel) !== sha };
  });
  const toUpload = plan.filter((p) => p.changed);
  console.log(`[5] 需要上传 ${toUpload.length} 个文件${plan.length - toUpload.length ? `（${plan.length - toUpload.length} 个内容未变，复用仓库里已有的）` : ''}`);

  // --- 上传 blobs：并发压到 3 并留间隔，避免触发 GitHub 二级限流 ---
  process.stdout.write('[6] 上传中 ');
  let done = 0;
  const uploaded = await pool(toUpload, 3, async (f) => {
    const blob = await gh(`/repos/${owner}/${REPO}/git/blobs`, {
      method: 'POST',
      body: { content: f.buf.toString('base64'), encoding: 'base64' },
    });
    done += 1;
    if (done % 10 === 0 || done === toUpload.length) process.stdout.write(`.${done}`);
    await sleep(120);
    return { path: f.rel, sha: blob.sha };
  });
  process.stdout.write('\n');

  const shaByPath = new Map(existing);
  for (const u of uploaded) shaByPath.set(u.path, u.sha);
  const blobs = plan.map((p) => ({ path: p.rel, mode: '100644', type: 'blob', sha: shaByPath.get(p.rel) }));

  // --- tree + commit ---
  // 故意不传 base_tree：新提交是一份**完整快照**，本地删掉的文件在仓库里也会被删掉，
  // 不会出现「增量合并」留下的孤儿文件。
  const tree = await gh(`/repos/${owner}/${REPO}/git/trees`, {
    method: 'POST',
    body: { tree: blobs },
  });
  console.log(`[7] 已创建目录树（${blobs.length} 项，完整快照）`);

  const commit = await gh(`/repos/${owner}/${REPO}/git/commits`, {
    method: 'POST',
    body: {
      message: '手账工坊 Journal Studio：本地版 + 在线版\n\n'
        + '- 181 件程序生成的原创素材（8 类，CC0，PNG 量化后整包仅 7.9MB）\n'
        + '- 上传别人的手账页 → 自动识别配色与版式 → 素材重排同款\n'
        + '- A5/A6/A4/B5 一键打印，300dpi，含出血与裁切角线\n'
        + '- 同一套前端代码：本机跑 Python 后端，线上纯浏览器运行\n'
        + '- 278 项自动化检查（含真 Chrome 驱动的前端测试）',
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
  console.log(`[8] 已提交并推送（${commit.sha.slice(0, 8)}）`);

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
    console.log('[9] 已开启 GitHub Pages（构建源：GitHub Actions）');
  } catch (e) {
    console.log(`[9] 开启 Pages 失败：${e.message}`);
    console.log('    手动开启：仓库 → Settings → Pages → Source 选 "GitHub Actions"');
  }

  console.log('\n' + '='.repeat(56));
  console.log(`仓库地址：https://github.com/${owner}/${REPO}`);
  if (pagesOk) {
    console.log(`在线版地址：https://${owner}.github.io/${REPO}/`);
    console.log('首次部署要等 Actions 跑完，约 1–2 分钟；之后每次推送自动更新。');
  }
  console.log('='.repeat(56));
  return 0;
}

main().catch((e) => {
  console.error('\n失败：' + e.message);
  if (e.cause) console.error(`底层原因：${e.cause.code || ''} ${e.cause.message || ''}`.trim());
  if (e.status === 401) console.error('token 无效或已过期。');
  if (e.status === 403) console.error('若是二级限流，等几分钟重跑即可；若是权限问题，token 需要 public_repo 与 workflow 范围。');
  process.exit(1);
});
