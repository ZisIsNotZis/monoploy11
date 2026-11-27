import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #3336：`receipt-3335-final/verify-http.txt` 印着 SEALED，但那一步有两个独立的洞：
//   ① 锁名写死在脚本里，还停在 3334；
//   ② 只核 5 个样本文件，而 3335 唯一改的文件（src/ui/slice.js）不在样本里。
// 洞② 是真的会发生：我把这一条写成跑**旧脚本**的负对照 —— 在一棵改过一个字节的
// 树上，旧脚本照样打印 `SEALED bytes+no-store`。所以判据不能只读脚本文本，
// 必须跑它：拿合法的锁树改一个**不在旧样本里**的文件，它必须报 NOT-SEALED。
//
// 这条测试因此同时咬住「核哪些文件」和「用哪把锁」：如果哪天又退回抽样，
// 被动的那个文件只要不在样本里，这里就会红。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EVIDENCE = path.join(ROOT, 'docs', 'evidence');
const SCRIPT = path.join(ROOT, 'support', 'full-game', 'verify-http.py');

function currentLockRel() {
  const lines = readFileSync(path.join(EVIDENCE, 'current-lock.txt'), 'utf8')
    .split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  assert.equal(lines.length, 1, 'current-lock.txt 必须恰好一行');
  return lines[0];
}

// 用一个「3335 之前的老样本里没有」的文件当破坏点：它正是上一次被漏掉的那个。
const VICTIM = 'src/ui/slice.js';

function buildTree(dest, tamper) {
  const lock = readFileSync(path.join(ROOT, currentLockRel()), 'utf8');
  const rels = lock.split(/\r?\n/).filter(Boolean).map(l => l.split('  ', 2)[1]);
  assert.ok(rels.includes(VICTIM), `${VICTIM} 不在锁里 —— 这条测试的破坏点选错了`);
  for (const rel of rels) {
    const dst = path.join(dest, rel);
    mkdirSync(path.dirname(dst), { recursive: true });
    copyFileSync(path.join(ROOT, rel), dst);
  }
  if (tamper) writeFileSync(path.join(dest, VICTIM), readFileSync(path.join(dest, VICTIM), 'utf8') + '\n');
  return rels.length;
}

function seal(tree, port) {
  try {
    const out = execFileSync('python3', [SCRIPT, tree, String(port)],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
  }
}

test('字节封印核的是整把锁，改掉任何一个文件都必须 NOT-SEALED', { timeout: 180000 }, () => {
  assert.ok(existsSync(SCRIPT), `缺少 ${path.relative(ROOT, SCRIPT)}`);
  const dir = mkdtempSync(path.join(tmpdir(), 'seal-3336-'));
  try {
    const clean = path.join(dir, 'clean');
    const dirty = path.join(dir, 'dirty');
    mkdirSync(clean); mkdirSync(dirty);
    const n = buildTree(clean, false);
    buildTree(dirty, true);

    // 端口挑一个高位随机数，撞了就顺延（serve.py 不给 SO_REUSEADDR）。
    const base = 18000 + Math.floor(Math.random() * 1000) * 2;
    const ok = seal(clean, base);
    assert.equal(ok.code, 0, `合法树应当 SEALED，实际：\n${ok.out.slice(-1200)}`);
    assert.match(ok.out, new RegExp(`SEALED .* all ${n} lock files`),
      `封印没有覆盖全部 ${n} 个文件（抽样回来了？）：\n${ok.out.slice(-800)}`);
    assert.match(ok.out, new RegExp(`${VICTIM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: "SAME"`),
      '被破坏点没有被逐一报告 —— 那读者看不出它比过这一个文件');

    const bad = seal(dirty, base + 1);
    assert.notEqual(bad.code, 0, '改了一棵副本却被判 SEALED —— 封印没在核字节');
    assert.match(bad.out, /NOT-SEALED/);
    assert.match(bad.out, new RegExp(`${VICTIM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: "DIFFERS"`),
      '坏的必须是那一个文件，而不是别的噪声');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
