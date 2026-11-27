import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 尾斜杠 301 的行为钉死在这里。
//
// 为什么非要有这条：浏览器把 /x.html/ 当成目录，页面本身能拿到 200，
// 但相对子资源（./af-variant-inject.js、../styles.css）会解析到目录下，
// 全部 404。结果是「页面打开了但没注入」，对照版静默退化成原版 ——
// 看不出报错，只看到 grow 面板变回原文。所以「文件 + 尾斜杠」必须 301 到规范路径。
//
// 这组测试真起一个 serve.py（端口参数，不占 8000），走 HTTP 断言，
// 不信函数级单测，因为 301 是由 handler 的 do_GET 前置钩子产生的。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SLICE_FP = '24b2e2d38c48d51b';

// 全量 `node --test` 会为每个测试文件开独立子进程，两份 HTTP 测试可能同时到位。
// 曾用 listen(0) 申请瞬时端口：并发下两边拿到同一个号，后起的 serve.py 绑不上
// （stderr 被吞），而 waitTcp 连上的其实是先起的那份别的服务器 —— 于是「连得上」
// 但等真正发请求时对方已退出，报 ECONNREFUSED。
// 改成按 pid 派生的端口段 + 真实绑定探测，把撞号概率压到零。
function freePort() {
  const base = 17000 + (process.pid % 600) * 4;
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

// 全量 `node --test` 会并发跑十几个文件，python 冷启动在这台机器上会被拖慢。
// 单独跑时 2s 内就绪，并发时曾超过 8s —— 所以给到 45s，且把子进程 stderr 带进错误里，
// 免得下次又只能看到「没在监听」。
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
serve.py stderr:
${stderrBuf.text}` : '';
          reject(new Error(`serve.py 在 ${timeoutMs}ms 内没在 ${port} 监听${seen}`));
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
  port = await freePort();
  const stderr = { text: '' };
  server = spawn(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['serve.py', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  // stderr 直接外泄：起不来时必须看见 OSError，而不是只看到「没在监听」。
  server.stderr.on('data', d => { stderr.text += d.toString(); process.stderr.write(d); });
  const spawnError = new Promise((_, reject) => server.once('error', e => reject(new Error(`起不来 serve.py：${e.message}`))));
  await Promise.race([waitTcp(port, 45000, stderr), spawnError]);
  // 身份校验：确认回答的是我这份 serve.py，而不是同端口上的别的东西。
  const hello = await get(port, '/index.html');
  assert.equal(hello.status, 200, `端口 ${port} 上没有正常的 serve.py（${hello.status}）`);
});

test.after(() => {
  if (server && !server.killed) server.kill();
});


// 注意：样本改用 /src/data/slice.js 与 /styles.css，不再用 .scratch ——
// 8000 侧 /.scratch 已被前缀拦截（见 blocked-prefix.test.js），拿它当 301 样本
// 会把「该 404 的被拦住」误读成「301 坏了」。
test('尾斜杠指向真实文件时 301 到规范路径', async () => {
  const res = await get(port, '/src/data/slice.js/');
  assert.equal(res.status, 301, `期望 301，实际 ${res.status}`);
  assert.equal(res.headers.location, '/src/data/slice.js');
});

test('跟随 301 后拿到的是文件本体（sha16 固定）', async () => {
  const first = await get(port, '/src/data/slice.js/');
  assert.equal(first.status, 301);
  const followed = await get(port, first.headers.location);
  assert.equal(followed.status, 200);
  assert.equal(sha16(followed.body), SLICE_FP, `slice.js 内容指纹变了：${sha16(followed.body)}`);
});

test('301 带 no-store，不会被浏览器永久缓存', async () => {
  // 301 是永久重定向。要是被缓存了，人在地址栏贴错一次尾斜杠就会被固定住。
  // end_headers 给所有响应（含 301）都加了 no-store，这里钉住它。
  const res = await get(port, '/index.html/');
  assert.equal(res.status, 301);
  assert.match(String(res.headers['cache-control'] || ''), /no-store/);
});

test('301 带 query 时 query 不丢', async () => {
  const res = await get(port, '/index.html/?slice=1');
  assert.equal(res.status, 301);
  assert.equal(res.headers.location, '/index.html?slice=1');
});

test('尾斜杠指向目录时不 301（保持目录语义）', async () => {
  // 用 /src/ 当目录样本：/.scratch/ 现在是被拦前缀（404），不再是目录样本。
  const res = await get(port, '/src/');
  assert.notEqual(res.status, 301, '目录尾斜杠不该被重定向');
  assert.equal(res.status, 200);
});

test('不存在的路径尾斜杠仍 404，不被 301 掩盖', async () => {
  const res = await get(port, '/no-such-file.html/');
  assert.equal(res.status, 404);
});

test('无尾斜杠的规范路径本来就直接 200', async () => {
  const res = await get(port, '/src/data/slice.js');
  assert.equal(res.status, 200);
  assert.equal(sha16(res.body), produceLocal());
});

// 直接读盘算一次，确保网页上的那份和磁盘上那份是同一份字节
function produceLocal() {
  return sha16(readFileSync(path.join(ROOT, 'src', 'data', 'slice.js')));
}
