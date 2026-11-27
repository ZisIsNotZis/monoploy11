import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 对照入口（serve-variant.py）的尾斜杠 + 别名组合。
//
// 这里比 8000 侧更容易出事，因为 8001 多一层别名表：
//   /af-variant.html  ->  /.scratch/af-variant.html
// 301 的目标是「归一+别名之后」的路径，所以 /af-variant.html/ 会直接落到
// /.scratch/af-variant.html —— 到这个位置，页面里的相对子资源
// ./af-variant-inject.js 才能解析到真实存在的那份。
//
// 反例（测试里也钉住）：不 301 时浏览器把最后一段当目录，
// /.scratch/af-variant.html/af-variant-inject.js 是 404，注入拿不到，
// 页面看上去正常、实际退化成原版。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// #1807b：夹具从 `.scratch/`（例行清理的 ignored 目录）搬到 support/。
const VARIANT_SERVER = path.join(ROOT, 'support', 'serve-variant.py');
const PAGE_FP = '3d51b9d013370a81';
const INJECT_FP = 'e8b1148546523c6b';

// 同 trailing-slash.test.js：listen(0) 在并发全量下会两份测试撞到同一个号，
// 一方绑不上而另一方 waitTcp 误连到别人，最后报 ECONNREFUSED。
// 改成按 pid 派生 + 真实绑定探测；两份测试的 base 不同（一个是 %600*4，一个是 %600*4+2）。
function freePort() {
  const base = 17000 + (process.pid % 600) * 4 + 2;
  const tryOne = n => new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(null));
    srv.listen(n, '127.0.0.1', () => {
      srv.close(() => resolve(n));
    });
  });
  return (async () => {
    for (let i = 0; i < 4; i++) {
      const p = await tryOne(base + i);
      if (p) return p;
    }
    throw new Error(`从 ${base} 起连续 4 个端口都不可用`);
  })();
}

// 同 trailing-slash.test.js：全量并发时 python 冷启动会超过 8s，给到 45s 并带回 stderr。
function waitTcp(port, timeoutMs = 45000, stderrBuf = null) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() > deadline) {
          const seen = stderrBuf && stderrBuf.text ? `
serve-variant.py stderr:
${stderrBuf.text}` : '';
          reject(new Error(`serve-variant.py 在 ${timeoutMs}ms 内没在 ${port} 监听${seen}`));
        }
        else setTimeout(tick, 80);
      });
    };
    tick();
  });
}

function get(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          len: body.length,
          sha16: createHash('sha256').update(body).digest('hex').slice(0, 16),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let server;
let port;

test.before(async () => {
  port = await freePort();
  const stderr = { text: '' };
  server = spawn(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [VARIANT_SERVER, String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  server.stderr.on('data', d => { stderr.text += d.toString(); process.stderr.write(d); });
  const spawnError = new Promise((_, reject) => server.once('error', e => reject(new Error(`起不来 serve-variant.py：${e.message}`))));
  await Promise.race([waitTcp(port, 45000, stderr), spawnError]);
  // 身份校验：对照入口必须能直接给出页面本体。
  const hello = await get(port, '/af-variant.html');
  assert.equal(hello.status, 200, `端口 ${port} 上没有正常的 serve-variant.py（${hello.status}）`);
});

test.after(() => {
  if (server && !server.killed) server.kill();
});



// 8001 的根路径发的是**原版**，不是对照页。
//
// docs 里写了这句（「不要把 8001 当成对照版」），但此前没有任何测试咬住它。
// 若有人把根路径也接进 ALIASES，或让 normalize 把 '/' 映射到对照页，
// 现有测试全部照旧绿 —— 而人打开 8001 首页就会以为自己在玩对照版。
// 这与 8000 泄漏是对称的陷阱：方向相反，后果一样（玩错版本而不自知）。
// #3344：首页多了「开局」选择那块容器（#sliceOpening，一行 div），于是长度与指纹都变了。
// 这两个常数咬的不是「首页不能改」，而是「8001 根路径发的是原版首页、不是对照页」。
// 所以产品改了就更新它们 —— 不更新就没法分辨「我改了原版」与「路由退了」。
const PLAIN_INDEX_FP = 'b09ba9e3403ab60d';
const PLAIN_INDEX_LEN = 5165;

test('8001 根路径发原版，不是对照页（用首页当对照版会玩错版本）', async () => {
  for (const p of ['/', '/index.html']) {
    const res = await get(port, p);
    assert.equal(res.status, 200, `${p} 期望 200，实际 ${res.status}`);
    assert.equal(res.len, PLAIN_INDEX_LEN, `${p} 长度 ${res.len} 不是原版首页`);
    assert.equal(res.sha16, PLAIN_INDEX_FP, `${p} 指纹 ${res.sha16} 不是原版首页（被改成对照页了？）`);
    assert.notEqual(res.sha16, PAGE_FP, `${p} 发成了对照页 —— 人在 8001 首页会以为在玩对照版`);
  }
});

test('8001 的三个别名入口都指向同一份对照页，且与首页不同', async () => {
  const plain = await get(port, '/');
  for (const p of ['/af-variant.html', '/.scratch/af-variant.html', '/scratch/af-variant.html']) {
    const res = await get(port, p);
    assert.equal(res.status, 200, `${p} 期望 200，实际 ${res.status}`);
    assert.equal(res.sha16, PAGE_FP, `${p} 指纹 ${res.sha16} 不是对照页`);
    assert.notEqual(res.sha16, plain.sha16, `${p} 与根路径同内容，别名没起作用`);
  }
});

test('对照入口尾斜杠 301 且落到别名展开后的真实路径', async () => {
  const res = await get(port, '/af-variant.html/');
  assert.equal(res.status, 301, `期望 301，实际 ${res.status}`);
  // 301 目标已过别名表：不是 /af-variant.html，而是 /.scratch/af-variant.html
  assert.equal(res.headers.location, '/.scratch/af-variant.html');
});

test('301 落点再请求是 200 且是对照页本体', async () => {
  const first = await get(port, '/af-variant.html/');
  assert.equal(first.status, 301);
  const body = await get(port, first.headers.location);
  assert.equal(body.status, 200);
  // 落点必须是对照页本体，不是任何一个 200 的错误页：钉住长度与 sha16。
  // 原先这里只断言 200，PAGE_FP 声明了却从没被用过 —— 跟随之后不校验内容，
  // 就算落点被换成原版 /index.html 也照样绿。
  assert.equal(body.len, 5230, `落点长度变了：${body.len}`);
  assert.equal(body.sha16, PAGE_FP, `落点内容指纹变了：${body.sha16}`);
});

test('落点目录下能取到注入脚本（相对子资源不断）', async () => {
  const first = await get(port, '/af-variant.html/');
  assert.equal(first.status, 301, `期望 301，实际 ${first.status}`);
  const base = first.headers.location.replace(/\/[^/]*$/, '');
  const inject = await get(port, `${base}/af-variant-inject.js`);
  assert.equal(inject.status, 200, `落点 ${base} 下取不到注入脚本，相对路径已断`);
  assert.equal(inject.len, 811);
  assert.equal(inject.sha16, INJECT_FP, `注入脚本指纹变了：${inject.sha16}`);
});

test('不 301 就会退化的那个路径确实是 404（证明 301 不是多此一举）', async () => {
  const res = await get(port, '/.scratch/af-variant.html/af-variant-inject.js');
  assert.equal(res.status, 404);
});

test('其余别名形态也 301 到同一落点', async () => {
  for (const p of ['/scratch/af-variant.html/', '/.scratch/af-variant.html/']) {
    const res = await get(port, p);
    assert.equal(res.status, 301, `${p} 期望 301，实际 ${res.status}`);
    assert.equal(res.headers.location, '/.scratch/af-variant.html', `${p} 的落点不对`);
  }
});

test('注入脚本自身的尾斜杠也回规范路径', async () => {
  const first = await get(port, '/af-variant-inject.js/');
  assert.equal(first.status, 301);
  assert.equal(first.headers.location, '/.scratch/af-variant-inject.js');
});
