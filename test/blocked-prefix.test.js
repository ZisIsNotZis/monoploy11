import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServerFixture } from '../support/serve-fixture.js';

// 8000 原版入口不许发对照页。
//
// serve.py 头部注释一直写着「原版入口只做归一，不做别名：对照页永远只能从 8001 的
// /.scratch/ 取」，但实现没拦 —— 8000 的 /.scratch/af-variant.html 照样 200，
// 人在 8000 手输 .scratch 就会玩到对照版而不自知，于是「两版 grow 哪个好玩」
// 这个靠人回答的问题直接作废（他自己都不知道在玩哪版）。
//
// 所以这里钉两类断言：
//   1. /.scratch 及其所有归一等价的畸形写法一律 404；
//   2. 正向资源（/、styles.css、slice.js）仍 200 且指纹对 —— 拦住前辍不能误杀首页。
// 8001 那边的 /.scratch 必须是 200，归 trailing-slash-variant.test.js 管，不动。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// styles.css 随授权改动：#776 39394 `6084098d4a7eb14d` → 40779 `d6ffc9539a6ca449`，
// #786 → 41969 `7155f4bdf4cc4941`，#1255 决策面板改抽屉 → 43439 `a8e6b886fdcf330b`，
// #1478b → 44072 `1c9bd9d74ba3cce5`（#insight summary 强制单行 + 省略号）。
// #1523b → 48439 `7678e752e1730f3e`（卡高 96 让整张卡的文字都在窗内，高度从可滚动的 #players/明细里出）。
// #1745 → 49821 `1389660bd64b86c1`（summary 三角要回来 + 短视口明细盒 40→96px）。
// #3264 → 57933（加盖/补给屏在窄屏提升为底部固定板）。
// 这条断言的本意是「静态资源没被拦截误杀」，字节数只是身份标记、不是内容契约 ——
// 所以下面 #3264 起不再手抄常量，改成从盘上读同一份文件（见 ALLOWED 的注释）。

// 端口按 pid 派生，落在 8111-8268 这条窄带内（8110 + (pid%40)*4 + 1）。
// 不从 8100 起：8100/8101 是 tools/verify-grow-panel.mjs 的默认 PLAIN_PORT/VARIANT_PORT，
// 测试带盖住它们会让那个真浏览器验证工具报「端口被占」。
// 也不能用 pid%600：那样起始号最大会漂到 10497，把在用的 8797 圈进去。
// 避开 listen(0) 在并发全量下两份测试拿到同一个号、后起的那份绑不上而 waitTcp
// 误连到别人的旧坑。（8100 带实测空闲，见 .scratch/probe-band2.py：对照组 8000/8001/8012
// 均报 BUSY(listening)，8100-8112 全 FREE。）
// #1807：上面那段注释里的「避开 listen(0)，并发下会拿到同一个号」这个归因
// 在本次实测中**复现不出来**：8 进程 × 6 轮并发 bind(0) 共 48 个样本，0 重号
// （.scratch/1807-port-race/arm_zero_multiproc.py）。
// 真正的缺陷是「探测空闲 → 再 spawn」两步之间有窗口，而 Windows 上
// HTTPServer.allow_reuse_address=1 让两个进程能**静默绑定同一端口**，
// 于是后起那份的 waitTcp 会连到别人的 serve.py，前置校验假绿。
// 用 listen(0) + stdout 宣告就消除了窗口本身。见 test/helpers/serve-fixture.js。
//
// 本文件在改前 serve.py 下的压测里 6 实例 × 3 轮中有 1 轮红 26 条（.scratch/1807-port-race/stress-others.json）。

function get(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const sha16 = buf => createHash('sha256').update(buf).digest('hex').slice(0, 16);

let server;
let port;

test.before(async () => {
  // 端口由 OS 分配、从**自己 spawn 的进程** stdout 读回（见 helpers/serve-fixture.js）。
  ({ child: server, port } = await startServerFixture());
  // 身份校验：确认真的是我这份 serve.py 在答（别拿别的服务器的 404 当「拦住了」）。
  const hello = await get(port, '/index.html');
  assert.equal(hello.status, 200, `端口 ${port} 上没有正常的 serve.py（${hello.status}）`);
});

test.after(() => {
  if (server && !server.killed) server.kill();
});


// Windows 文件系统大小写不敏感，且吃掉段尾的点和空格，8.3 短名也指向同一目录。
// 只写死小写 '/.scratch' 时，/.SCRATCH/af-variant.html 实测 200/5230 就是对照页本体 ——
// 人随手大写一个字母就绕过拦截，grow 对照结论照样作废。这些变体必须一起咬住。
const BLOCKED = [
  '/.scratch/af-variant.html',
  '/.SCRATCH/af-variant.html',
  '/.Scratch/af-variant.html',
  '/.scratch./af-variant.html',
  '/.scratch%20/af-variant.html',
  '/.scrat~1/af-variant.html',
  '/.SCRATCH/',
  '/src/./.scratch/af-variant.html',
  '/src/../.scratch/af-variant.html',
  '/.scratch/af-variant-inject.js',
  '/.scratch/',
  '/.scratch/af-variant.html/',
  '/.scratch',
  '/./.scratch/af-variant.html',
  '//.scratch/af-variant.html',
];

for (const p of BLOCKED) {
  test(`8000 侧 ${p} 一律 404`, async () => {
    const res = await get(port, p);
    assert.equal(res.status, 404, `${p} 期望 404，实际 ${res.status}（拦住前辍不能给对照页留口气）`);
  });
}

// 正向对照：拦住 .scratch 不能把首页资源一起杀了。
// #3264：这组「长度 + 指纹」原来手抄成常量（styles.css 停在 #1745 的 49821），于是每次
// 授权的样式改动都会让「首页资源仍 200 且指纹未变」变红 —— 红的是标记，不是产品，
// 而「变红就改数字」会顺手把这条的牙齿磨掉。改从盘上读同一份文件：
// 服务端少发/多发一个字节仍然红，改样式不再需要手改常量。
const diskId = rel => {
  const buf = readFileSync(path.join(ROOT, rel));
  return ['/' + rel, buf.length, sha16(buf)];
};
const ALLOWED = [
  ['/', ...diskId('index.html').slice(1)],
  diskId('index.html'),
  diskId('styles.css'),
  diskId('src/data/slice.js'),
];

for (const [p, len, fp] of ALLOWED) {
  test(`首页资源 ${p} 仍 200 且指纹未变`, async () => {
    const res = await get(port, p);
    assert.equal(res.status, 200, `${p} 被误杀：${res.status}`);
    assert.equal(res.body.length, len, `${p} 的 HTTP 字节长度与盘上文件不符：${res.body.length} vs ${len}`);
    assert.equal(sha16(res.body), fp, `${p} 的 HTTP 字节指纹与盘上文件不符：${sha16(res.body)} vs ${fp}`);
  });
}

// 既有归一路径不能被前缀拦截写坏：query 仍要跟着 301 走。
test('前缀拦截不动既有 301：/index.html/?slice=1 仍 301 且 query 不丢', async () => {
  const res = await get(port, '/index.html/?slice=1');
  assert.equal(res.status, 301, `期望 301，实际 ${res.status}`);
  assert.equal(res.headers.location, '/index.html?slice=1');
});

// 被拦前缀不做 301：否则 404 会变成一次可见跳转，Location 还可能把路径回显出去。
test('被拦前缀的尾斜杠形态不返回 301（不能变成可见跳转）', async () => {
  for (const p of ['/.scratch/', '/.scratch/af-variant.html/']) {
    const res = await get(port, p);
    assert.notEqual(res.status, 301, `${p} 不该发 301`);
    assert.equal(res.status, 404, `${p} 期望 404，实际 ${res.status}`);
  }
});

// 对照页本体还在仓库里（堵的是 8000 的路径，不是删文件）。
// 夹具的正式家是 `support/compare/`；`.scratch/` 只是开发机上的旧位置，干净检出里没有它。
test('对照页本体仍在仓库里，只是 8000 不发放', () => {
  const committed = path.join(ROOT, 'support', 'compare', 'af-variant.html');
  const legacy = path.join(ROOT, '.scratch', 'af-variant.html');
  const buf = readFileSync(existsSync(committed) ? committed : legacy);
  assert.equal(buf.length, 5230);
  assert.equal(sha16(buf), '3d51b9d013370a81');
});

// do_HEAD 走的是同一个 translate_path，所以 HEAD 也该 404。
// 单独验一下：只看 GET 的话，将来有人把翻译逻辑复制到 do_HEAD 里就会漏。
test('HEAD 与 GET 同样被拦（do_HEAD 没走旁路）', async () => {
  const head = (p) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'HEAD' }, res => {
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on('error', reject);
    req.end();
  });
  for (const p of ['/.scratch/af-variant.html', '/.SCRATCH/af-variant.html', '/.scratch/']) {
    assert.equal((await head(p)).status, 404, `HEAD ${p} 期望 404`);
  }
  assert.equal((await head('/')).status, 200, 'HEAD / 被误杀');
  assert.equal((await head('/styles.css')).status, 200, 'HEAD /styles.css 被误杀');
});

// 反向确认：页面自己不能引用 .scratch。
// 拦前缀最大的风险是把页面自己的资源也杀掉，那会变成「首页能开但样式/脚本 404」。
// 扫一遍真实入口与样式、源码，确认没有任何一处写到 .scratch。
test('页面与源码不引用 .scratch（拦截不会误杀自身资源）', () => {
  const files = ['index.html', 'styles.css', 'src/data/slice.js'];
  for (const rel of files) {
    const text = readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(/scratch/i.test(text), false, `${rel} 里出现了 scratch 引用，拦截会把它打 404`);
  }
});

// 上面那条只扫了三个文件 —— 拦前缀真正会弄坏的形态是「首页 200，某个深层模块 404」。
// 所以这里从 /index.html 出发，沿 ES import 走完整张模块图，逐个用 HTTP 取。
// 只比对状态码，不钉每个模块的 sha：模块内容本来就天天改，钉 sha 会让这条变成
// 每次改代码都要手工更新的噪声断言。这里咬的是「可达性」，不是「内容冻结」。
// 实测这张图有 29 个资源（2026-11-20），阈值取 20 留出删模块的余量。
const IMPORT_SPEC_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const HTML_REF_RE = /(?:src|href)=["']([^"']+)["']/g;

function resolveRef(base, spec) {
  if (!(spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/'))) return null;
  const raw = spec.startsWith('/') ? spec : base.slice(0, base.lastIndexOf('/') + 1) + spec;
  const parts = [];
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return '/' + parts.join('/');
}

test('整张 ES 模块图在 8000 上都可达（不只看 index.html 头部两个引用）', async () => {
  const index = await get(port, '/index.html');
  assert.equal(index.status, 200, 'index.html 自己就取不到，后面的断言没意义');
  const seen = new Map();
  const queue = [];
  for (const m of index.body.toString('utf8').matchAll(HTML_REF_RE)) {
    const ref = m[1];
    if (ref.startsWith('http') || ref.startsWith('data:') || ref.startsWith('#')) continue;
    const p = resolveRef('/index.html', ref);
    if (p) queue.push(p);
  }
  assert.ok(queue.length >= 2, `index.html 里只解析出 ${queue.length} 个引用，正则或页面结构变了`);

  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    const res = await get(port, p);
    seen.set(p, res.status);
    assert.equal(res.status, 200, `模块图里的 ${p} 返回 ${res.status}（拦截把页面自己的依赖杀了）`);
    // 带 ?v=150 这类查询串时 endswith('.js') 为假，会整张图都不跟 —— 先切掉。
    // 这个坑我先踩在 .scratch/crawl-imports.py 里：不切只跟到 2 个引用，图是残的。
    if (!p.split('?')[0].endsWith('.js')) continue;
    for (const m of res.body.toString('utf8').matchAll(IMPORT_SPEC_RE)) {
      const nxt = resolveRef(p, m[1] || m[2]);
      if (nxt && !seen.has(nxt)) queue.push(nxt);
    }
  }
  // 图里必须真走过一层以上，否则这条退化成「只验了 index.html 那两个引用」。
  assert.ok(seen.size >= 20, `只跟到 ${seen.size} 个资源，模块图没走全（正则失效？）`);
});
