import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #3336：这一条是为了让「哪把锁是当前产品」只有**一个**答案。
//
// 上一轮 supervisor 报的是「回执索引漏了 3335 这一行」。查下去，缺行只是症状：
// 三个工具各自写死了一份「当前锁」，其中 verify-http.py 停在 3334。于是
// receipt-3335-final/verify-http.txt 印着 SEALED，比的却是旧锁的字节；而它的五个
// 样本里又没有 3335 唯一改过的 src/ui/slice.js —— 两处独立的原因让那一步对本次改动
// 完全失明。E 项（从锁重算 tree_sha256）没受影响，所以回执不是处处撒谎，
// 只是被引用得最多的那一句不成立。
//
// 判据分三层，缺一层就会退化成「文档里说了」：
//   ① 指针文件存在、恰好一行、点名的锁在库里；
//   ② 没有任何工具再写死 `slice-entry-XXXX.sha256`（否则两份副本还会再漂）；
//   ③ 指针指向的锁 = 交付清单上自称「当前产品」的那一把。
// 反例守卫：把指针临时改成别的历史锁，②③之外的解析必须真的跟着变 —— 由 ④ 用
// lockfile.py 本身跑一遍来证明，而不是只看文本。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EVIDENCE = path.join(ROOT, 'docs', 'evidence');
const POINTER = path.join(EVIDENCE, 'current-lock.txt');
const LOCK_NAME = /slice-entry-\d+\.sha256/;

function pointerLines() {
  return readFileSync(POINTER, 'utf8').split(/\r?\n/)
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

// 会「封印或播放产品字节」的工具：它们必须问指针，不能自己记一份锁名。
// 老回执/老报告里出现锁名是历史，不算漂 —— 所以只扫这一份名单。
const TOOLS = [
  'support/full-game/run-full.py',
  'support/full-game/verify-http.py',
  'support/full-game/check-delivery.py',
  'support/full-game/lockfile.py',
];

test('当前锁只有一个指针，且它点名的锁真实存在', () => {
  assert.ok(existsSync(POINTER), `缺少 ${path.relative(ROOT, POINTER)}`);
  const lines = pointerLines();
  assert.equal(lines.length, 1,
    `指针必须恰好一行（现在 ${lines.length} 行）—— 多行等于又给了两个答案`);
  assert.match(lines[0], LOCK_NAME, `指针内容不像锁名：${lines[0]}`);
  assert.ok(existsSync(path.join(ROOT, lines[0])), `指针点名的 ${lines[0]} 不在库里`);
});

test('封印/播放产品的工具里不许再写死锁名', () => {
  for (const rel of TOOLS) {
    const abs = path.join(ROOT, rel);
    assert.ok(existsSync(abs), `工具不在了：${rel}`);
    const hits = readFileSync(abs, 'utf8').split(/\r?\n/)
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => LOCK_NAME.test(line));
    assert.deepEqual(hits.map(h => `${rel}:${h.n}: ${h.line.trim()}`), [],
      '这些位置自己写死了锁名 —— 升级产品时会漏改一份，而漏改的那份仍会印 PASS。\n' +
      '改成读 docs/evidence/current-lock.txt（见 support/full-game/lockfile.py）。');
  }
});

test('指针与交付清单里那句「当前产品」是同一条', () => {
  const rel = pointerLines()[0];
  const manifest = readFileSync(path.join(ROOT, 'support', 'full-game', 'DELIVERY.txt'), 'utf8')
    .split(/\r?\n/);
  const i = manifest.findIndex(l => l.includes('= **当前**产品'));
  assert.ok(i >= 0, '交付清单里找不到「当前产品」那条注释 —— 那就没有第二个可核的说法');
  const block = manifest.slice(i, i + 8).join('\n');
  assert.ok(block.includes(rel),
    `清单的「当前产品」段（第 ${i + 1} 行起）没点名 ${rel} —— 两处说法不一致`);
});

test('回执索引里标「当前」的行 = 指针点名的那把锁', () => {
  // 这就是 supervisor 报的那个缺口：索引漏登记 / 留在旧版本上。
  // 光靠「每份回执都登记了」不够 —— 旧行自称「当前」也是错的信息，比缺行更难发现。
  const lockRel = pointerLines()[0];
  const rows = readFileSync(path.join(EVIDENCE, 'RECEIPTS-VS-PRODUCT.md'), 'utf8')
    .split(/\r?\n/)
    .filter(l => l.startsWith('| `receipt-'))
    .map(l => l.split('|').map(c => c.trim()));
  const current = rows.filter(c => c[3] && c[3].includes('当前'));
  assert.equal(current.length, 1,
    `索引里标「当前」的行应当恰好一条，现在 ${current.length} 条：` +
    current.map(c => c[1]).join(', '));
  assert.equal(current[0][2], `\`${path.basename(lockRel)}\``,
    `标「当前」的 ${current[0][1]} 跑的不是指针点名的锁`);

  // 指向当前锁的行里，至少有一份回执真的带 seal（F 项能重算）。
  const sealBound = readdirSync(EVIDENCE)
    .filter(n => n.startsWith('receipt-') && existsSync(path.join(EVIDENCE, n, 'provenance.json')))
    .map(n => JSON.parse(readFileSync(path.join(EVIDENCE, n, 'provenance.json'), 'utf8')))
    .filter(p => p.product && p.product.lock === lockRel && p.seal);
  assert.ok(sealBound.length > 0,
    `没有任何回执同时绑定 ${lockRel} 并带 seal —— “浏览器收到的就是锁里的字节”就无处可核`);
});

test('牙：解析器真的按指针走，而不是碰巧写对', () => {
  // 用一份临时指针指向一把历史锁，断言解析结果跟着变。若解析器其实忽略了指针，
  // 这里会仍然返回当前锁，测试就红。
  // 取一把**别的**锁（不是当前那把），否则这条测不出「跟着指针走」。
  const current = pointerLines()[0];
  const historic = readdirSync(EVIDENCE)
    .map(n => `docs/evidence/${n}`)
    .filter(n => LOCK_NAME.test(n) && n !== current)
    .sort()[0];
  assert.ok(historic, '库里没有第二把锁 —— 这条负对照就成了空转');
  const tmp = path.join(EVIDENCE, '__pointer_probe__.txt');
  const before = readFileSync(POINTER, 'utf8');
  try {
    writeFileSync(tmp, `# probe\n${historic}\n`);
    const out = execFileSync('python3', ['-c', [
      'import sys; sys.path.insert(0, "support/full-game")',
      'import lockfile',
      'print(lockfile.current_lock(pointer="' + path.relative(ROOT, tmp) + '").name)',
    ].join('\n')], { cwd: ROOT, encoding: 'utf8' }).trim();
    assert.equal(out, path.basename(historic), '解析器没有跟着指针走 —— 那它就不是唯一真相');
  } finally {
    rmSync(tmp, { force: true });
    assert.equal(readFileSync(POINTER, 'utf8'), before, '负对照破坏了真指针');
  }
});

test('绑定的回执里，tree_sha256 与锁文件能重算出同一个数', () => {
  // 这一条把「回执跑在哪把锁上」从文字变成可重算：只对自称绑定的回执。
  const lockRel = pointerLines()[0];
  const lockText = readFileSync(path.join(ROOT, lockRel), 'utf8');
  const pairs = lockText.split(/\r?\n/).filter(Boolean)
    .map(l => l.split('  ', 2)).map(([d, p]) => [p, d]);
  const h = createHash('sha256');
  h.update(Buffer.from('monoploy11/tree-v1\0'));
  for (const [p, d] of [...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const row = Buffer.from(`${p}\0${d}\n`);
    const len = Buffer.alloc(8);
    len.writeBigUInt64BE(BigInt(row.length));
    h.update(len); h.update(row);
  }
  const tree = h.digest('hex');
  const lockSha = createHash('sha256').update(lockText).digest('hex');

  const bound = readdirSync(EVIDENCE)
    .filter(n => n.startsWith('receipt-') && existsSync(path.join(EVIDENCE, n, 'provenance.json')))
    .map(n => ({ n, p: JSON.parse(readFileSync(path.join(EVIDENCE, n, 'provenance.json'), 'utf8')).product }))
    .filter(x => x.p && x.p.lock === lockRel);
  assert.ok(bound.length > 0, `没有任何回执绑定 ${lockRel} —— 当前产品的 PASS 无从挂靠`);
  for (const { n, p } of bound) {
    assert.equal(p.lock_sha256, lockSha, `${n} 记的 lock_sha256 与库里的锁文件不符`);
    assert.equal(p.tree_sha256, tree, `${n} 记的 tree_sha256 与用锁重算的不符`);
  }
});
