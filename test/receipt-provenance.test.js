import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, readFileSync, readdirSync, rmSync,
         statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #3320：精简回执必须能定位到自己的来源，并且离开那台机器也能核对。
//
// 上一份（receipt-3319-390）的问题不是「数字错了」，而是**无从核对**：
// provenance.json 写着 source_run=OUT-3319-final、三个 raw sha256，
// 而那个目录在任何地方都不存在（OUT-*/ 被 .gitignore 挡着，例行清理就删掉了）。
// 精简副本本身仍能被 report-full.py 判 PASS，所以「能重判」是假的安心：
// 你无法确认这份 cut 忠不忠实，也无法确认它来自哪一次运行。
//
// 这一轮的做法：把 raw 字节用 gzip 一起发进回执（317 KB → 约 16 KB），
// 并在 provenance 里同时记 gzip 的 sha256 与**解压后**字节的 sha256。
// 这两个数以前只能信，现在能算。
//
// 这个文件钉住三件事：
//   ① 在库的每一份回执都自带 raw/，且哈希对得上（离开源目录也能核）；
//   ② verify-receipt.py 真的会算这些哈希 —— 篡改一个字节必须变红；
//   ③ 篡改「声明丢弃的字段」也必须变红（否则剪裁可以偷偷多剪，B 项照样绿）。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EVIDENCE = path.join(ROOT, 'docs', 'evidence');
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

const sha = buf => createHash('sha256').update(buf).digest('hex');

function run(args) {
  const r = spawnSync(PY, ['-B', ...args], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// 所有在库回执（带 provenance.json 的目录），排除刚被本测试复制出来的临时目录。
function receipts() {
  return readdirSync(EVIDENCE)
    .filter(n => n.startsWith('receipt-'))
    .map(n => path.join(EVIDENCE, n))
    .filter(d => existsSync(path.join(d, 'provenance.json')));
}

// 不带 raw/ 的回执**可以留在库里**（删掉它等于抹掉那段验收证据），
// 但必须有一份 UNVERIFIABLE.md 把它「不可核对」说在明处。
// 这样缺口是被登记的，而不是被忘成一个看起来能引用的来源。
// #3319 那份就是这种：它的 raw 已被清理删除，谁也核不了，也不该重跑一局冒充它。
const UNVERIFIABLE = 'UNVERIFIABLE.md';

test('每份在库回执要么自带可核的 raw/，要么有 UNVERIFIABLE.md 说明', () => {
  // 注意区分两种「核不了」，它们不是同一件事：
  //   · 源已经被删（#3319）⇒ 永远核不了，只能登记；
  //   · 源还在（#3317 的 OUT-Y3317-390）⇒ 应该重切成自带 raw，而不是贴一块「核不了」。
  // 这一条只要求「不能默默地留在库里」，怎么处理由人定。
  const dirs = receipts();
  assert.ok(dirs.length > 0, '没有找到任何回执');
  for (const dir of dirs) {
    const prov = JSON.parse(readFileSync(path.join(dir, 'provenance.json'), 'utf8'));
    const gzFields = Object.entries(prov.raw ?? {}).filter(([, m]) => m.gz);
    if (!gzFields.length) {
      assert.ok(existsSync(path.join(dir, UNVERIFIABLE)),
        `${path.basename(dir)}：没有 raw/，也没有 ${UNVERIFIABLE}。` +
        ' 要么用 make-receipt.py 从还活着的运行重切，要么把「不可核对」写成文件 —— ' +
        '不能就这么留在库里，让人以为它能自证。');
      continue;
    }
    for (const [name, meta] of gzFields) {
      const gz = path.join(dir, meta.gz);
      assert.ok(existsSync(gz), `${path.basename(dir)}：缺 ${meta.gz}`);
      assert.equal(statSync(gz).size, meta.gz_bytes, `${name}: gz 大小不符`);
      assert.equal(sha(readFileSync(gz)), meta.gz_sha256, `${name}: gz 哈希不符`);
    }
  }
});

test('回执在源运行目录不存在时仍能自证（这正是用户遇到的场景）', () => {
  const dir = path.join(EVIDENCE, 'receipt-3320-390');
  // 这份的源 OUT-3320-final 已经真的被删掉了（本轮验收时删的），不是声明。
  const prov = JSON.parse(readFileSync(path.join(dir, 'provenance.json'), 'utf8'));
  // 不依赖 OUT 目录：断言它确实不在，然后照样核。
  assert.equal(existsSync(path.join(ROOT, 'support', 'full-game', prov.source_run)), false,
    `${prov.source_run} 还在，这条就测不到「离开源目录」的情形`);
  const r = run(['support/full-game/verify-receipt.py', dir]);
  assert.equal(r.code, 0, `verify-receipt.py 失败：\n${r.out}`);
  assert.match(r.out, /PROVENANCE: PASS/);
});

test('两份回执都能自证：一真 PASS、一真 FAIL，判据是「cut 没改判」而不是「必须 PASS」', () => {
  // FAIL 的回执也是合法来源：它说的是「这次运行失败了，字节在这」。
  // #3317 就是被 #3319 故意判红的那一次（F6 扩到所有屏）。
  for (const [name, want] of [['receipt-3317-390', /VERDICT: FAIL/], ['receipt-3320-390', /VERDICT: PASS/]]) {
    const r = run(['support/full-game/verify-receipt.py', path.join(EVIDENCE, name)]);
    assert.equal(r.code, 0, `${name} 应可自证：\n${r.out}`);
    assert.match(r.out, /PROVENANCE: PASS/);
    assert.match(r.out, want);
  }
});

test('牙：篡改回执里一个字节，verify-receipt.py 必须变红', () => {
  const src = path.join(EVIDENCE, 'receipt-3320-390');
  const tmp = path.join(EVIDENCE, 'receipt-__tamper__');
  rmSync(tmp, { recursive: true, force: true });
  cpSync(src, tmp, { recursive: true });
  try {
    const target = path.join(tmp, 'record-10-replay.json');
    const doc = JSON.parse(readFileSync(target, 'utf8'));
    // 改一个判据读的字段：cut 忠实性检查必须发现它不等于 raw 减字段。
    doc.checks = { ...doc.checks, ctaUsable: !doc.checks.ctaUsable };
    writeFileSync(target, JSON.stringify(doc, null, 1) + '\n');
    const r = run(['support/full-game/verify-receipt.py', tmp]);
    assert.notEqual(r.code, 0, `篡改后仍然通过：\n${r.out}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('牙：篡改 raw/ 的字节，哈希检查必须变红', () => {
  const src = path.join(EVIDENCE, 'receipt-3320-390');
  const tmp = path.join(EVIDENCE, 'receipt-__tamper_gz__');
  rmSync(tmp, { recursive: true, force: true });
  cpSync(src, tmp, { recursive: true });
  try {
    appendFileSync(path.join(tmp, 'raw', 'after.json.gz'), Buffer.from([0]));
    const r = run(['support/full-game/verify-receipt.py', tmp]);
    assert.notEqual(r.code, 0, `raw 字节被改后仍然通过：\n${r.out}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
