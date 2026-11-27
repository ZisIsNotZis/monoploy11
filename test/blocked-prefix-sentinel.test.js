import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { startServerFixture } from '../support/serve-fixture.js';

// 为什么单独一个文件：这条要在仓库根建一个名叫 __invalid_path__ 的文件。
// 用临时目录跑副本就能不污染真仓库，也不会和 parallel 的其它测试抢同一个根。
//
// 背景：translate_path 把被拦路径换成 ROOT/__invalid_path__，靠「该文件不存在」
// 才落到 404。实测建出这个文件后，/.scratch/af-variant.html 变成 200 且内容是它。
// 即：拦截曾经依赖一个「恰好不存在」的路径名。现在 handler 层 _deny_blocked 直接拒，
// 这个测试就是把「哨兵存在也不破防」钉住。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// #1807：端口不再“探测空闲再 spawn”，改为由 OS 分配、从自己 spawn 的进程 stdout 读回。
// 原因见 test/helpers/serve-fixture.js 的头部说明：Windows 上 allow_reuse_address=1
// 让两个 serve.py 能静默绑定同一端口，被测那份的 waitTcp 会连到别人的服务而假绿。
// 本文件在改前 serve.py 下的压测里 6 实例 × 3 轮是 3/3 轮有红（.scratch/1807-port-race/stress-others.json）。

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

const SENTINEL = path.join(ROOT, '__invalid_path__');
let server;
let port;
let ownedSentinel = false;   // 哨兵文件是否由本实例创建（只有创建者才有权删）

const TARGETS = [
  '/.scratch/af-variant.html',
  '/.SCRATCH/af-variant.html',
  '/.scratch/',
  '/./.scratch/af-variant.html',
];

// #1807 第二处：哨兵文件是**仓库根下的共享状态**，且它在 URL 里的名字由 serve.py 写死
// （`INVALID = ROOT/__invalid_path__`），不能按进程改名。
// 并发跑两份本文件时，先说「不存在」的两份各自创建，先跑完的那份 after() 做了 `rmSync`
// —— 把另一份的哨兵删掉，于是另一份的「前置条件成立」变红。
// 实测（.scratch/1807-port-race/stress-sentinel.json）：4 实例 × 4 轮有 2 轮红，
// 红的正是『哨兵文件真被建出来了（前置条件成立）』，与端口无关。
//
// 修法：用 `wx` 独占创建当互斥。拿不到就等（另一份跑完会释放），不放宽任何断言。
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
async function acquireSentinel(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      writeFileSync(SENTINEL, 'SENTINEL-PWNED', { flag: 'wx' });
      return true;                       // 我建的，由我删
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() > deadline) {
        // 等不到就当成「运行前就已存在」的残留：不创建也不删，与改前行为一致。
        return false;
      }
      await sleepMs(50);
    }
  }
}

test.before(async () => {
  // 真建出哨兵文件，并写入可辨认内容。
  ownedSentinel = await acquireSentinel();
  // 端口由 OS 分配、从自己 spawn 的进程 stdout 读回。
  ({ child: server, port } = await startServerFixture());
  const hello = await get(port, '/index.html');
  assert.equal(hello.status, 200, `端口 ${port} 上没有正常的 serve.py（${hello.status}）`);
});

test.after(() => {
  if (server && !server.killed) server.kill();
  // 只删**自己用 wx 建出来**的那个。
  // 不能用 `!existedBefore` 当条件：existedBefore 是取锁**之前**算的，
  // 并发时后一份会在别人持锁期间看到文件存在 ⇒ existedBefore=true ⇒ 自己建了却不肯删
  // ⇒ 仓库根残留 __invalid_path__（实测：4 实例 × 4 轮后 sentinel_exists_at_end 恒 True）。
  // `wx` 创建成功本身就证明「创建那一刻它不存在」，所以 ownedSentinel 已足够。
  if (ownedSentinel) rmSync(SENTINEL, { force: true });
});

test('哨兵文件真被建出来了（前置条件成立）', () => {
  assert.equal(existsSync(SENTINEL), true, '前置没成立，后面的断言就不算数');
});

for (const p of TARGETS) {
  test(`哨兵存在时 ${p} 仍 404（不再依赖文件名恰好不存在）`, async () => {
    const res = await get(port, p);
    assert.equal(res.status, 404, `${p} 期望 404，实际 ${res.status} —— 拦截又回去依赖文件系统了`);
    assert.equal(res.body.includes('SENTINEL-PWNED'), false, `${p} 把哨兵文件内容发出去了`);
  });
}

test('哨兵存在时正向资源不受影响', async () => {
  const res = await get(port, '/index.html');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 5108);
});

test('直接请求 /__invalid_path__ 也不该发出内容', async () => {
  const res = await get(port, '/__invalid_path__');
  assert.equal(res.body.includes('SENTINEL-PWNED'), false, '哨兵文件内容可以从根直接取到');
});
