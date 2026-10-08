/**
 * web/js/sources.js 自检（node:test）。
 *
 *   运行： node --test tests/test_sources_js.mjs
 *   或：   node tests/test_sources_js.mjs
 *
 * 两部分：
 *  A. 纯逻辑（离线必绿）：用假 fetch 覆盖各源 JSON → 统一字段的映射、非 JSON、
 *     HTTP 5xx、超时、单条 Met 藏品失败等边界。
 *  B. 真实联网（软断言）：wikimedia / artic / met 各用中英文关键词搜一次，
 *     校验结果非空、字段齐全、author/license 非空；离线只警告不判失败。
 */
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCES, TIMEOUT, DEFAULT_LIMIT, MAX_LIMIT, UNKNOWN_TEXT, PUBLIC_DOMAIN_LICENSE,
  search, probe, fetchAsBlob, __test__,
} from '../web/js/sources.js';

const RESULT_FIELDS = ['id', 'title', 'thumb', 'full', 'page_url', 'author', 'license', 'width', 'height', 'source'];

/* ------------------------------------------------------------ 假数据 */

const WIKIMEDIA_PAYLOAD = {
  query: {
    searchinfo: { totalhits: 137 },
    pages: {
      123: {
        pageid: 123,
        title: 'File:Washi tape.jpg',
        imageinfo: [{
          url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Washi_tape.jpg'
            + '?utm_source=commons.wikimedia.org&utm_content=original',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Washi_tape.jpg',
          thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/'
            + 'Washi_tape.jpg/800px-Washi_tape.jpg?utm_content=thumbnail',
          width: 4032,
          height: 3024,
          extmetadata: {
            Artist: { value: "<a href='#'>Somebody</a>" },
            LicenseShortName: { value: 'CC BY-SA 4.0' },
          },
        }],
      },
      124: { pageid: 124, title: 'File:Broken.jpg' }, // 没有 imageinfo，必须跳过
    },
  },
};

const ARTIC_PAYLOAD = {
  pagination: { total: 2 },
  data: [
    {
      id: 145,
      title: 'Water Lilies',
      image_id: '3c27b499-af56-f0d5-a9b5-4b0f2a2f1a11',
      artist_display: 'Claude Monet\nFrench, 1840-1926',
      is_public_domain: true,
      thumbnail: { width: 3000, height: 2000 },
    },
    { id: 146, title: 'Text only', image_id: null, artist_display: '', is_public_domain: false },
  ],
};

const MET_SEARCH_PAYLOAD = { total: 3, objectIDs: [1, 2, 3] };

const MET_OBJECTS = {
  1: {
    objectID: 1,
    title: 'Vase with Flowers',
    primaryImageSmall: 'https://images.metmuseum.org/small/1.jpg',
    primaryImage: 'https://images.metmuseum.org/full/1.jpg',
    artistDisplayName: 'Unknown Maker',
    objectURL: 'https://www.metmuseum.org/art/collection/search/1',
    isPublicDomain: true,
  },
  3: { objectID: 3, title: 'No Image', primaryImageSmall: '', primaryImage: '', isPublicDomain: false },
};

const OPENVERSE_PAYLOAD = {
  result_count: 12,
  results: [{
    id: 'abc-123',
    title: 'Washi tape rolls',
    url: 'https://live.staticflickr.com/1/2_washi.jpg',
    thumbnail: 'https://api.openverse.org/v1/images/abc-123/thumb/',
    creator: 'Alice',
    license: 'by-sa',
    license_version: '4.0',
    foreign_landing_url: 'https://www.flickr.com/photos/1',
    width: 1024,
    height: 768,
  }],
};

/* ------------------------------------------------------------ 工具 */

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 临时替换 globalThis.fetch，跑完自动还原。 */
async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return fake(String(url), init);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

let lastLiveSummary = [];
afterEach(() => {
  __test__.resetTimeout();
  __test__.resetRetryBackoff();
});

/* ============================================================ A. 纯逻辑 */

test('SOURCES 常量与 Python 版一致', () => {
  assert.deepEqual(SOURCES, ['wikimedia', 'artic', 'met', 'openverse']);
  assert.equal(SOURCES.length, 4);
  assert.equal(TIMEOUT, 20);
  assert.equal(DEFAULT_LIMIT, 24);
  assert.equal(MAX_LIMIT, 50);
  assert.equal(UNKNOWN_TEXT, '未标注');
  assert.equal(PUBLIC_DOMAIN_LICENSE, 'CC0-1.0（公有领域）');
});

test('wikimedia URL 必须带 origin=*（否则浏览器拿不到 CORS 头）', () => {
  const url = __test__.wikimediaUrl('washi tape', 24, 1);
  assert.ok(url.includes('origin=*'), url);
  assert.ok(url.includes('gsrlimit=24'));
  assert.ok(url.includes('iiprop=url%7Cextmetadata%7Csize'));
  assert.ok(url.includes('gsroffset=0'));
  assert.ok(__test__.wikimediaUrl('x', 24, 3).includes('gsroffset=48'));
  assert.ok(__test__.articUrl('flower', 999, 1).includes(`limit=${MAX_LIMIT}`));
  assert.ok(__test__.openverseUrl('x', 999, -3).includes('page=1'));
  assert.ok(__test__.openverseUrl('x', 999, -3).includes(`page_size=${MAX_LIMIT}`));
});

test('met URL：主用 v1.1（offset/limit 分页），保留 v1 兜底', () => {
  const url = __test__.metSearchUrl('vase', 12, 3);
  assert.ok(url.includes('/v1.1/search?'), url);
  assert.ok(url.includes('offset=24'));
  assert.ok(url.includes('limit=12'));
  assert.ok(url.includes('hasImages=true'));
  assert.ok(__test__.metSearchUrlLegacy('vase').includes('/v1/search?'));
});

test('wikimedia 映射：字段齐全、HTML 剥离、utm 清理、坏条目跳过', () => {
  const { total, items } = __test__.parseWikimedia(WIKIMEDIA_PAYLOAD);
  assert.equal(total, 137);
  assert.equal(items.length, 1);
  const item = items[0];
  assert.deepEqual(Object.keys(item).sort(), [...RESULT_FIELDS].sort());
  assert.equal(item.id, 'wikimedia:File:Washi tape.jpg');
  assert.equal(item.title, 'Washi tape.jpg');
  assert.equal(item.author, 'Somebody');
  assert.equal(item.license, 'CC BY-SA 4.0');
  assert.deepEqual([item.width, item.height], [4032, 3024]);
  assert.ok(item.thumb.startsWith('https://upload.wikimedia.org/'));
  assert.ok(!item.thumb.includes('utm_') && !item.full.includes('utm_') && !item.full.includes('?'));
  assert.equal(item.source, 'wikimedia');
});

test('wikimedia 缺 extmetadata：author/license 回落到「未标注」，thumb 回落原图', () => {
  const payload = {
    query: {
      pages: {
        1: { pageid: 1, title: 'File:X.png', imageinfo: [{ url: 'https://x/1.png', extmetadata: {} }] },
      },
    },
  };
  const { total, items } = __test__.parseWikimedia(payload);
  assert.equal(total, 1);
  assert.equal(items[0].author, UNKNOWN_TEXT);
  assert.equal(items[0].license, UNKNOWN_TEXT);
  assert.equal(items[0].thumb, 'https://x/1.png');
  // 与 Python 的 urllib.parse.quote 一致：':' 转义成 %3A
  assert.equal(items[0].page_url, 'https://commons.wikimedia.org/wiki/File%3AX.png');
  // 完全空响应也不能崩
  assert.deepEqual(__test__.parseWikimedia({}).items, []);
  assert.deepEqual(__test__.parseWikimedia(null).items, []);
});

test('artic 映射：IIIF 地址、公有领域许可、无图条目跳过', () => {
  const { total, items } = __test__.parseArtic(ARTIC_PAYLOAD);
  assert.equal(total, 1, 'ArtIC 的 pagination.total 刻意不采用');
  const item = items[0];
  assert.deepEqual(Object.keys(item).sort(), [...RESULT_FIELDS].sort());
  const imageId = '3c27b499-af56-f0d5-a9b5-4b0f2a2f1a11';
  assert.equal(item.thumb, `https://www.artic.edu/iiif/2/${imageId}/full/843,/0/default.jpg`);
  assert.ok(item.full.includes('/full/full/0/default.jpg'));
  assert.equal(item.page_url, 'https://www.artic.edu/artworks/145');
  assert.equal(item.license, PUBLIC_DOMAIN_LICENSE);
  assert.ok(item.author.startsWith('Claude Monet'));
  assert.deepEqual([item.width, item.height], [3000, 2000]);
});

test('met 映射：单条藏品没有图返回 null，字段回落正确', () => {
  const item = __test__.parseMetObject(MET_OBJECTS[1], 1);
  assert.deepEqual(Object.keys(item).sort(), [...RESULT_FIELDS].sort());
  assert.equal(item.id, 'met:1');
  assert.equal(item.thumb, 'https://images.metmuseum.org/small/1.jpg');
  assert.equal(item.full, 'https://images.metmuseum.org/full/1.jpg');
  assert.equal(item.author, 'Unknown Maker');
  assert.equal(item.license, PUBLIC_DOMAIN_LICENSE);
  assert.equal(__test__.parseMetObject(MET_OBJECTS[3], 3), null);
  assert.equal(__test__.parseMetObject(null, 9), null);
  // objectURL 缺失时拼官方页面
  const fallback = __test__.parseMetObject({ primaryImage: 'https://x/1.jpg' }, 7);
  assert.equal(fallback.page_url, 'https://www.metmuseum.org/art/collection/search/7');
  assert.equal(fallback.license, UNKNOWN_TEXT);
});

test('openverse 映射：许可证拼接、缺 creator 回落', () => {
  const { total, items } = __test__.parseOpenverse(OPENVERSE_PAYLOAD);
  assert.equal(total, 12);
  const item = items[0];
  assert.deepEqual(Object.keys(item).sort(), [...RESULT_FIELDS].sort());
  assert.equal(item.license, 'CC BY-SA 4.0');
  assert.equal(item.author, 'Alice');
  assert.equal(item.page_url, 'https://www.flickr.com/photos/1');
  assert.deepEqual([item.width, item.height], [1024, 768]);
});

test('search：未知源 / 空关键词返回 error 而不抛异常', async () => {
  const bad = await search('flickr', 'washi tape');
  assert.equal(bad.source, 'flickr');
  assert.deepEqual(bad.results, []);
  assert.equal(bad.total, 0);
  assert.match(bad.error, /未知素材源/);

  const empty = await search('met', '   ');
  assert.deepEqual(empty.results, []);
  assert.match(empty.error, /关键词/);

  for (const bad of [null, undefined, 123, {}]) {
    const result = await search(bad, 'x');
    assert.equal(typeof result.error, 'string');
    assert.deepEqual(result.results, []);
  }
});

test('search：met 两步检索，单条 object 失败被吞掉且顺序保持', async () => {
  const ids = [10, 11, 12];
  await withFetch((url) => {
    if (url.includes('/search?')) return jsonResponse({ total: ids.length, objectIDs: ids });
    const oid = Number(/\/objects\/(\d+)$/.exec(url)[1]);
    if (oid === 11) throw new TypeError('模拟单条藏品请求失败');
    return jsonResponse({
      objectID: oid,
      title: `T${oid}`,
      primaryImageSmall: `https://images.metmuseum.org/s/${oid}.jpg`,
      primaryImage: `https://images.metmuseum.org/f/${oid}.jpg`,
      artistDisplayName: 'A',
      objectURL: 'u',
      isPublicDomain: true,
    });
  }, async () => {
    const result = await search('met', 'vase', 3);
    assert.equal(result.error, undefined);
    assert.equal(result.total, 3);
    assert.deepEqual(result.results.map((r) => r.id), ['met:10', 'met:12']);
  });
});

test('search：met 主接口 v1.1 不可用时退回 v1；两者都失败报主接口错误', async () => {
  __test__.setRetryBackoffMs(1);
  const legacyCalls = [];
  await withFetch((url) => {
    if (url.includes('/v1.1/search?')) return new Response('gone', { status: 410 });
    if (url.includes('/v1/search?')) {
      legacyCalls.push(url);
      return jsonResponse({ total: 2, objectIDs: [21, 22] });
    }
    const oid = Number(/\/objects\/(\d+)$/.exec(url)[1]);
    return jsonResponse({
      objectID: oid,
      title: `T${oid}`,
      primaryImage: `https://images.metmuseum.org/f/${oid}.jpg`,
      artistDisplayName: 'A',
      isPublicDomain: true,
    });
  }, async (calls) => {
    const result = await search('met', 'vase', 2);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.results.map((r) => r.id), ['met:21', 'met:22']);
    assert.equal(legacyCalls.length, 1);
    assert.ok(calls[0].url.includes('/v1.1/search?'), '应先试 v1.1');
    assert.ok(calls[1].url.includes('/v1/search?'), '应退回 v1');
  });

  await withFetch(() => new Response('gone', { status: 410 }), async () => {
    const result = await search('met', 'vase', 2);
    assert.deepEqual(result.results, []);
    assert.match(result.error, /HTTP 410/, '应报主接口的错误');
  });
});

test('search：met v1.1 已分页的结果不会被二次切片', async () => {
  await withFetch((url) => {
    if (url.includes('/search?')) {
      assert.ok(url.includes('offset=2'), url);
      return jsonResponse({ total: 500, objectIDs: [31, 32] });
    }
    const oid = Number(/\/objects\/(\d+)$/.exec(url)[1]);
    return jsonResponse({
      objectID: oid, title: `T${oid}`, primaryImage: `https://x/${oid}.jpg`, isPublicDomain: true,
    });
  }, async () => {
    const result = await search('met', 'vase', 2, 2);
    assert.equal(result.total, 500);
    assert.deepEqual(result.results.map((r) => r.id), ['met:31', 'met:32']);
  });
});

test('search：非 JSON 响应优雅降级', async () => {
  await withFetch(() => new Response('<html>oops</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  }), async () => {
    const result = await search('artic', 'flower');
    assert.deepEqual(result.results, []);
    assert.equal(result.total, 0);
    assert.match(result.error, /不是合法 JSON/);
  });

  await withFetch(() => new Response('', { status: 200 }), async () => {
    const result = await search('wikimedia', 'x');
    assert.match(result.error, /空内容/);
  });
});

test('search：HTTP 5xx / 429 重试一次，403/404 不重试且提示面向用户', async () => {
  for (const [status, attempts, keyword] of [[503, 2, 'HTTP 503'], [429, 2, 'HTTP 429'], [404, 1, 'HTTP 404'], [403, 1, 'HTTP 403']]) {
    __test__.setRetryBackoffMs(1);
    await withFetch(() => new Response('busy', { status }), async (calls) => {
      const result = await search('wikimedia', 'washi tape');
      assert.equal(calls.length, attempts, `HTTP ${status} 的请求次数不对`);
      assert.deepEqual(result.results, []);
      assert.equal(result.total, 0);
      assert.ok(result.error.includes(keyword), result.error);
      if (status === 403) assert.match(result.error, /拒绝访问|防盗链/);
      if (status === 404) assert.match(result.error, /不存在/);
      if (status === 429) assert.match(result.error, /频繁/);
      if (status === 503) assert.match(result.error, /暂时不可用/);
    });
  }
});

test('search：超时（AbortController）优雅降级', async () => {
  __test__.setTimeoutMs(120);
  __test__.setRetryBackoffMs(1);
  await withFetch((url, init) => new Promise((_resolve, reject) => {
    assert.ok(init.signal, '必须传 AbortSignal');
    init.signal.addEventListener('abort', () => {
      const exc = new Error('aborted');
      exc.name = 'AbortError';
      reject(exc);
    });
  }), async () => {
    const started = Date.now();
    const result = await search('openverse', 'flower');
    assert.deepEqual(result.results, []);
    assert.match(result.error, /超时/);
    assert.ok(Date.now() - started < 5000, '超时应该在 5 秒内结束');
  });
});

test('search：网络层错误（fetch 抛 TypeError）翻译成中文提示', async () => {
  await withFetch(() => { throw new TypeError('Failed to fetch'); }, async () => {
    const result = await search('met', 'vase');
    assert.match(result.error, /网络连接失败/);
  });
});

test('search：limit / page 被清洗，请求参数正确', async () => {
  await withFetch(() => jsonResponse(OPENVERSE_PAYLOAD), async (calls) => {
    await search('openverse', 'x', 999, -3);
    assert.ok(calls[0].url.includes('page=1'));
    assert.ok(calls[0].url.includes(`page_size=${MAX_LIMIT}`));
    assert.equal(calls[0].init.mode, 'cors');
    assert.equal(calls[0].init.credentials, 'omit');
    await search('openverse', 'x', 'abc', 'xyz');
    assert.ok(calls[1].url.includes(`page_size=${DEFAULT_LIMIT}`));
    assert.ok(calls[1].url.includes('page=1'));
  });
});

test('probe：三源结构与毫秒数（单源失败不影响其它源）', async () => {
  await withFetch((url) => {
    if (url.includes('commons.wikimedia.org')) throw new TypeError('Failed to fetch');
    return jsonResponse({ ok: 1 });
  }, async () => {
    const report = await probe();
    assert.deepEqual(Object.keys(report), ['wikimedia', 'artic', 'met']);
    assert.equal(report.wikimedia.ok, false);
    assert.ok(report.wikimedia.ms >= 0);
    assert.match(report.wikimedia.error, /网络连接失败/);
    for (const name of ['artic', 'met']) {
      assert.equal(report[name].ok, true, `${name} 不该受 wikimedia 失败影响`);
      assert.equal(report[name].error, null);
      assert.ok(Number.isInteger(report[name].ms) && report[name].ms >= 0);
    }
  });
});

test('fetchAsBlob：正常图片返回 Blob；非图片 / 超限 / 非法地址抛可读错误', async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

  await withFetch(() => new Response(jpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }), async (calls) => {
    const blob = await fetchAsBlob('https://upload.wikimedia.org/a/b.jpg');
    assert.ok(blob instanceof Blob);
    assert.equal(blob.size, jpeg.length);
    assert.equal(blob.type, 'image/jpeg');
    assert.equal(calls[0].init.mode, 'cors');
  });

  // 后缀是图片、Content-Type 缺失也接受
  await withFetch(() => new Response(jpeg, { status: 200 }), async () => {
    const blob = await fetchAsBlob('https://x/a.png');
    assert.equal(blob.size, jpeg.length);
  });

  await withFetch(() => new Response('<html>nope</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  }), async () => {
    await assert.rejects(() => fetchAsBlob('https://x/page.html'), /不是图片/);
  });

  await withFetch(() => new Response(new Uint8Array(5000), {
    status: 200,
    headers: { 'Content-Type': 'image/png' },
  }), async () => {
    await assert.rejects(() => fetchAsBlob('https://x/big.png', { maxBytes: 1024 }), /体积上限/);
  });

  await withFetch(() => new Response('', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }), async () => {
    await assert.rejects(() => fetchAsBlob('https://x/empty.jpg'), /内容为空/);
  });

  for (const bad of ['', '   ']) {
    await assert.rejects(() => fetchAsBlob(bad), /下载地址为空/, `应拒绝：${JSON.stringify(bad)}`);
  }
  for (const bad of ['not-a-url', 'file:///C:/secret.jpg', 'ftp://example.com/a.jpg']) {
    await assert.rejects(() => fetchAsBlob(bad), /不支持的下载地址/, `应拒绝：${JSON.stringify(bad)}`);
  }
  await assert.rejects(() => fetchAsBlob(null), /下载地址为空/);
});

test('fetchAsBlob：403（Cloudflare / 防盗链）给出面向用户的提示', async () => {
  await withFetch(() => new Response('Forbidden', { status: 403 }), async () => {
    await assert.rejects(() => fetchAsBlob('https://www.artic.edu/iiif/2/x/full/843,/0/default.jpg'),
      (exc) => {
        assert.ok(exc instanceof Error);
        assert.match(exc.message, /HTTP 403/);
        assert.match(exc.message, /防盗链|拒绝访问/);
        assert.ok(!exc.message.includes('at '), '错误消息里不该有栈信息');
        return true;
      });
  });
});

test('fetchAsBlob：响应体中途卡死会超时，持续有数据则不会被打断', async () => {
  // 卡死：发出一个分片后永远不再有数据
  __test__.setTimeoutMs(150);
  await withFetch((url, init) => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
        init.signal.addEventListener('abort', () => {
          const exc = new Error('aborted');
          exc.name = 'AbortError';
          try { controller.error(exc); } catch (e) { /* 已关闭 */ }
        });
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  }, async () => {
    const started = Date.now();
    await assert.rejects(() => fetchAsBlob('https://x/stall.jpg', { maxBytes: 1000000 }), /超时/);
    assert.ok(Date.now() - started < 5000, '空档超时应在几秒内结束');
  });

  // 慢但在流动：每 60ms 一个分片，总共 300ms > 150ms 超时，但不该被打断
  __test__.setTimeoutMs(150);
  await withFetch(() => {
    let sent = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (sent >= 5) { controller.close(); return; }
        sent += 1;
        await new Promise((resolve) => { setTimeout(resolve, 60); });
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  }, async () => {
    const blob = await fetchAsBlob('https://x/slow.jpg', { maxBytes: 1000000 });
    assert.equal(blob.size, 20);
  });
});

test('工具函数：cleanText / stripTracking / asInt / firstText / friendlyError', () => {
  assert.equal(__test__.cleanText('<b>hi</b>\n  there'), 'hi there');
  assert.equal(__test__.cleanText('a'.repeat(200)).length, 161); // 160 + 省略号
  assert.equal(__test__.stripTracking('https://x/a.jpg?utm_source=y'), 'https://x/a.jpg');
  assert.equal(__test__.stripTracking('https://x/a.jpg?a=1&utm_source=y').includes('a=1'), true);
  assert.equal(__test__.stripTracking('https://x/a.jpg'), 'https://x/a.jpg');
  assert.equal(__test__.asInt('42'), 42);
  assert.equal(__test__.asInt(undefined, 7), 7);
  assert.equal(__test__.firstText('', null, undefined), UNKNOWN_TEXT);
  assert.equal(__test__.firstText('<i> </i>', 'ok'), 'ok');
  assert.equal(__test__.humanSize(1500), '2 KB');
  assert.match(__test__.friendlyError(new Error('boom')), /请求失败/);
});

/* ====================================================== B. 真实联网（软） */

const LIVE_CASES = [
  ['wikimedia', 'washi tape'],
  ['wikimedia', '手账 胶带'],
  ['artic', 'flower'],
  ['artic', '花 绘画'],
  ['met', 'vase'],
  ['met', '青花瓷'],
];

const liveResults = [];
const downloadReport = [];

let liveWarnings = 0;
test('真实联网：wikimedia / artic / met 各中英文检索（离线只警告）', async () => {
  for (const [source, query] of LIVE_CASES) {
    let result;
    try {
      result = await search(source, query, 3);
    } catch (exc) {
      assert.fail(`search 绝不该抛异常：${exc}`);
    }
    if (result.error || !result.results.length) {
      liveWarnings += 1;
      liveResults.push({ source, query, ok: false, error: result.error || '空结果' });
      console.log(`  [警告] ${source} 「${query}」不可用：${result.error || '无结果'}（离线环境软通过）`);
      continue;
    }
    for (const item of result.results) {
      const missing = RESULT_FIELDS.filter((key) => !(key in item));
      assert.deepEqual(missing, [], `${source} 结果缺字段：${missing}`);
      assert.ok(item.author, `${source} author 为空：${JSON.stringify(item.title)}`);
      assert.ok(item.license, `${source} license 为空：${JSON.stringify(item.title)}`);
      assert.ok(item.thumb && item.full && item.page_url, `${source} 链接字段为空`);
      assert.equal(item.source, source);
    }
    liveResults.push({
      source,
      query,
      ok: true,
      total: result.total,
      count: result.results.length,
      sample: result.results[0],
    });
    console.log(`  ✅ ${source} 「${query}」→ ${result.results.length} 条（total=${result.total}）`
      + ` 示例：《${result.results[0].title}》/ ${result.results[0].author} / ${result.results[0].license}`);
  }
  assert.ok(liveResults.length === LIVE_CASES.length);
});

test('真实联网：probe() 形状正确且不抛异常', async () => {
  const report = await probe();
  assert.deepEqual(Object.keys(report), ['wikimedia', 'artic', 'met']);
  for (const [name, info] of Object.entries(report)) {
    assert.equal(typeof info.ok, 'boolean');
    assert.ok(Number.isInteger(info.ms) && info.ms >= 0);
    if (info.ok) assert.equal(info.error, null);
    else console.log(`  [警告] probe(${name}) 不可用：${info.error}（离线环境软通过）`);
  }
});

test('真实联网：图片下载（wikimedia / met 应成功；artic 预期被 Cloudflare 拦）', async (t) => {
  async function tryDownload(label, url) {
    if (!url) return null;
    const started = Date.now();
    try {
      const blob = await fetchAsBlob(url, { maxBytes: 12000000 });
      const entry = { label, url, ok: true, bytes: blob.size, type: blob.type, ms: Date.now() - started };
      downloadReport.push(entry);
      console.log(`  ✅ ${label} 下载成功：${blob.size}B ${blob.type}（${entry.ms}ms）`);
      return entry;
    } catch (exc) {
      const entry = { label, url, ok: false, error: exc.message, ms: Date.now() - started };
      downloadReport.push(entry);
      console.log(`  ⚠️  ${label} 下载失败：${exc.message}（${entry.ms}ms）`);
      return entry;
    }
  }

  const wiki = await search('wikimedia', 'washi tape', 1);
  if (wiki.results.length) {
    const entry = await tryDownload('wikimedia thumb', wiki.results[0].thumb);
    assert.ok(entry.ok, `wikimedia 图片应能下载：${entry.error}`);
    assert.ok(entry.bytes > 1000);
  } else {
    console.log('  [警告] wikimedia 检索不可用，跳过下载检查');
  }

  const met = await search('met', 'vase', 2);
  const metImage = met.results.find((item) => item.full);
  if (metImage) {
    const entry = await tryDownload('met full', metImage.full);
    assert.ok(entry.ok, `met 图片应能下载：${entry.error}`);
  } else {
    console.log('  [警告] met 检索不可用，跳过下载检查');
  }

  const artic = await search('artic', 'flower', 1);
  const articTargets = artic.results.length
    ? [artic.results[0].full]
    // 检索偶发失败时也用一个真实格式的 IIIF 地址，保证「下载行为」这一项始终被测到
    : ['https://www.artic.edu/iiif/2/3c27b499-af56-f0d5-a9b5-4b0f2a2f1a11/full/843,/0/default.jpg'];
  for (const target of articTargets) {
    const entry = await tryDownload('artic full', target);
    if (!entry.ok) {
      // 这正是预期：Cloudflare 拦住了 iiif 图片域名。要求「优雅报错」而不是原始异常。
      assert.ok(entry.error && entry.error.length > 0, '必须是面向用户的错误消息');
      assert.ok(!entry.error.includes('at '), '错误消息里不该有栈信息');
      console.log(`  ℹ️  artic 图片下载如预期被拦：${entry.error}`);
    }
  }

  if (liveWarnings >= LIVE_CASES.length) t.skip('网络完全不可用');
});

/* 末尾汇总（真实联网数字，便于人工核对） */
after(() => {
  const ok = liveResults.filter((r) => r.ok);
  console.log('\n===== 真实联网汇总 =====');
  console.log(`成功 ${ok.length}/${liveResults.length} 次检索（警告 ${liveWarnings} 次）`);
  for (const entry of liveResults) {
    if (entry.ok) {
      console.log(`  ${entry.source}「${entry.query}」${entry.count} 条：`
        + `${entry.sample.author} | ${entry.sample.license} | ${entry.sample.title}`);
    } else {
      console.log(`  ${entry.source}「${entry.query}」失败：${entry.error}`);
    }
  }
  for (const entry of downloadReport) {
    console.log(`  图片 ${entry.label}：${entry.ok ? `${entry.bytes}B ${entry.type}` : `失败 ${entry.error}`}（${entry.ms}ms）`);
  }
});
