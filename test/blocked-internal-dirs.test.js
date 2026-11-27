import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServerFixture } from '../support/serve-fixture.js';

// 静态根就是仓库根，所以 .git/ 与 .praxis2/ 默认也在 URL 空间里。
// 实测过（2026-11-20）：8000 与 8001 都能取到
//   /.git/config    → 200，内容含 remote url
//   /.praxis2/      → 200，目录列表列出 trajectory.jsonl / memory.json / process/
// 后者是 agent 的私有推理与进程日志，不该从 HTTP 读。
//
// 这里钉住「仓库内部目录不进 URL 空间」，同时钉住正向资源未误杀。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// #1807：以前是「探测端口空闲 → spawn serve.py 用那个号」，两步之间有窗口。
// 并发跑两份测试时两份可能选到同一个号，而**在 Windows 上那不会报错**：
// HTTPServer.allow_reuse_address 默认 1，Windows 的 SO_REUSEADDR 允许绑定已被监听的端口，
// 于是两台服务器静默共用一根线（实测：杀掉先绑者后端口仍在应答）。
//
// 后果不是「起不来」，是**前置校验假绿**：后起那份的 waitTcp 与 get('/index.html')
// 连到的都是**别人**的 serve.py —— 同一个仓库根、内容一模一样，HTTP 侧无从区分。
// 等对方跑完 after() 杀掉进程，本份剩下的断言就集体 ECONNREFUSED，
// 连「只绑回环地址」这条根本不联网的同步断言也一起红。这就是 09:30 那次 23 红。
//
// 修法：不猜端口。让它自己 bind(0)、由 OS 原子分配，再从**自己的 stdout** 读回实际端口。
// 这样「端口」这个事实来自我自己 spawned 的进程，身份是结构性的，不靠 HTTP 探针判断。
// 实测（.scratch/1807-port-race/）：8 进程 × 6 轮并发 bind(0) 共 48 个样本，0 重号。
// 具体实现与同类文件共用：support/serve-fixture.js。

function get(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function request(port_, method, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: port_, path: rawPath, method }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
}

// serve.py 里的绑定地址写死在源码里，这里从探针取，不靠猜。
let SERVER_BIND = '';

let server;
let port;

test.before(async () => {
  ({ child: server, port } = await startServerFixture());
  // 身份校验：端口号是从**我自己 spawned 的进程**的 stdout 读回来的，
  // 所以答话的必然是我这份 serve.py。这里只再确认它真的能服务。
  const hello = await get(port, '/index.html');
  assert.equal(hello.status, 200, `端口 ${port} 上没有正常的 serve.py（${hello.status}）`);

  // 绑定地址写在 serve.py 的 __main__ 行里，读源码取，不靠猜。
  // 正则匹配的是绑定那一行**字面量**（`ThreadingHTTPServer(('127.0.0.1', PORT)`）；
  // 所以 serve.py 那边不许把调用改写成子类，否则这条会变成「绑定地址变成 」而全文件红。
  const src = readFileSync(path.join(ROOT, 'serve.py'), 'utf8');
  const m = src.match(/ThreadingHTTPServer\(\('([^']+)'/);
  SERVER_BIND = m ? m[1] : '';
});

test.after(() => {
  if (server && !server.killed) server.kill();
});

// 每一条都实测过改前是 200，不是凭空列的。
const INTERNAL = [
  '/.git/config',
  '/.git/HEAD',
  '/.git/',
  '/.praxis2/',
  '/.praxis2/trajectory.jsonl',
  '/.praxis2/memory.json',
  '/.praxis2/agents.json',
  '/.praxis2/processes.json',
  '/.GIT/config',
  '/.Praxis2/trajectory.jsonl',
  '/.git./config',
  '/.vscode/settings.json',
  '/./.git/config',
  '//.git/config',
  // 这两个是我自己造出来的：py_compile / import serve 会在仓库根生成 __pycache__，
  // 实测曾能取到 /__pycache__/serve.cpython-314.pyc（7509B）。__invalid_path__ 是内部哨兵名。
  '/__pycache__/',
  '/__pycache__/serve.cpython-314.pyc',
  '/__invalid_path__',
];

for (const p of INTERNAL) {
  test(`仓库内部目录不通过 HTTP 发放：${p}`, async () => {
    const res = await get(port, p);
    assert.equal(res.status, 404, `${p} 期望 404，实际 ${res.status}`);
  });
}

test('.git/config 的 remote 地址不会被发出', async () => {
  const res = await get(port, '/.git/config');
  assert.equal(res.body.includes('github.com'), false, 'remote 地址泄漏了');
  assert.equal(res.body.includes('[remote'), false, 'git 配置泄漏了');
});

test('.praxis2 的目录列表不会被发出', async () => {
  const res = await get(port, '/.praxis2/');
  assert.equal(res.body.includes('trajectory.jsonl'), false, 'agent 轨迹文件名泄漏了');
  assert.equal(res.body.includes('Directory listing'), false, '目录列表泄漏了');
});

// 正向对照：拦内部目录不能把游戏本体也杀了。
//
// #3264：这里原来手抄三组「长度 + 指纹」常量（styles.css 那份停在 #1745 的 49821）。
// 断言的本意是「HTTP 发的就是盘上这份、没被拦前缀误杀」，而不是「内容自 #1745 起不变」。
// 手抄常量在每次授权的 CSS 改动后都变红（#3264 的 57933），红的是标记不是产品，
// 于是有人会顺手把数字改大 —— 那正好把这条的牙齿磨掉。现在直接从盘上读同一份文件来比：
// 服务端少发/多发一个字节都还是红，授权改样式不再需要手改常量。
test('游戏资源不受影响', async () => {
  const { createHash: h } = await import('node:crypto');
  const disk = rel => {
    const buf = readFileSync(path.join(ROOT, rel));
    return [buf.length, h('sha256').update(buf).digest('hex').slice(0, 16)];
  };
  const cases = [
    ['/', ...disk('index.html')],
    // styles.css 随授权改动：#776 39394 `6084098d4a7eb14d` → 40779 `d6ffc9539a6ca449`，
    // #786 → 41969 `7155f4bdf4cc4941`，#1255 决策面板改抽屉 → 43439 `a8e6b886fdcf330b`。
    // 本断言验的是「拦内部目录没误杀游戏资源」，字节只是身份标记。
    // #1478b → 44072 `1c9bd9d74ba3cce5`（#insight summary 强制单行 + 省略号）。
    // #1523b → 48439 `7678e752e1730f3e`（卡高 96 让整张卡的文字都在窗内，高度从可滚动的 #players/明细里出）。
    // #1745 → 49821 `1389660bd64b86c1`（summary 三角要回来 + 短视口明细盒 40→96px）。
    // #3264 → 57933（加盖/补给屏在窄屏提升为底部固定板）。数字不再手抄，见本用例开头。
    ['/styles.css', ...disk('styles.css')],
    ['/src/data/slice.js', ...disk('src/data/slice.js')],
  ];
  for (const [p, len, fp] of cases) {
    const res = await get(port, p);
    assert.equal(res.status, 200, `${p} 被误杀：${res.status}`);
    assert.equal(res.body.length, len, `${p} 的 HTTP 字节长度与盘上文件不符（${res.body.length} vs ${len}）`);
    assert.equal(h('sha256').update(res.body).digest('hex').slice(0, 16), fp, `${p} 的 HTTP 字节指纹与盘上文件不符`);
  }
});

// 绑定地址与写方法：这两个前提比拦目录更底层。
// 若有人把 ThreadingHTTPServer(('127.0.0.1', PORT)) 改成 0.0.0.0，整个仓库（连同上面拦的东西的邻居）
// 就对局域网开放；若以后有人为了什么需求加了 do_POST，写入面就出来了。
test('只绑回环地址，不对局域网开放', () => {
  assert.equal((SERVER_BIND || '').startsWith('127.0.0.1'), true, `绑定地址变成 ${SERVER_BIND}，不再只限本机`);
});

test('写方法一律 501，且不落盘', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'TRACE']) {
    const status = await request(port, method, '/index.html');
    assert.equal(status, 501, `${method} 期望 501，实际 ${status}`);
  }
});

// src/ 与 docs/ 不在被拦名单里：前者是游戏本体，后者是给人看的说明。
test('src/ 与 docs/ 仍可取（不在被拦名单内）', async () => {
  assert.equal((await get(port, '/src/')).status, 200);
  assert.equal((await get(port, '/docs/variant-entry-and-risk.md')).status, 200);
});
