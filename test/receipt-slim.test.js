import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #3317：交付里那份整局回执必须是**能复判**的，而且必须是**精简**的。
//
// 背景：以前 DELIVERY.txt 收的是整份原始帧（record-8-summary.json 单文件 256 KB、
// 11000+ 行，其中 firstFrames 92 KB 与 hintInserts 6 KB 没有任何判据在读）。那不是回执，
// 是运行日志；读者看不到 PASS，diff 也没法审。
//
// 现在交付的是同一局裁过的记录：只留 report-full.py 真读的字段，仍然是一个
// `report-full.py <dir>` 能直接判的目录。这条测试咬住三件事：
//   1. 交付里的回执**现在**就能判成 PASS（不需要浏览器、不需要原始帧）；
//   2. 裁剪工具对「丢掉被读字段」必须**拒写**，而不是悄悄让小文件仍然 PASS；
//   3. 交付里的 summary 不允许悄悄长回未读字段（否则「精简」只是这一轮的说法）。
//
// 牙：把 make-receipt.py 的 KEEP_SUMMARY 删掉一项（如 'pressLog'）⇒ 第 4 条红；
// 把它的「比判词」改成「只比 returncode」⇒ 第 3 条红。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REPORT = path.join(ROOT, 'support/full-game/report-full.py');
const SLIM = path.join(ROOT, 'support/full-game/make-receipt.py');
const RECEIPT = path.join(ROOT, 'docs/evidence/receipt-3317-390');

function judge(dir) {
  const r = spawnSync('python3', ['-B', REPORT, dir], { encoding: 'utf8' });
  assert.equal(r.error, undefined, `无法启动 python3: ${r.error}`);
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function mkRaw(dir) {
  // 一份“原始帧”的最小替身：判据读的字段齐全，外加两坨没人读的大字段。
  const summary = {
    label: 'raw-fixture', human: '街角店主', entry: 'http://127.0.0.1:1/index.html?slice=1',
    frames: 355, ms: 45976, kinds: { action: { frames: 300 }, buy: { frames: 2 }, results: { frames: 1 } },
    presses: 44,
    pressLog: [{ tag: 'action:roll', kind: 'action', frame: 0, seen: { rollDisabled: false },
      after: { stillEnabled: false, rollDisabled: true } }],
    stuck: [], runtimeErrors: [], runtimeErrorCount: 0, buys: 2, buyFirstUnusable: null,
    mismatchCount: 0, mismatches: [], hintTrace: [], png: { bytes: 1 },
    judge: {
      heading: '穿街高手 的生意做到了最后', gapLine: '你与获胜者相差 27,800 资产。',
      checks: { rowsFull: true, sumsOk: true, gapMatches: true, titleNamesWinner: true,
        replayUsable: true, threeRows: true, headerOrder: true },
      rows: [
        { owner: '街角店主', cash: '18,600', land: '46,000', total: '64,600' },
        { owner: '机会买家', cash: '0', land: '0', total: '0' },
        { owner: '穿街高手', cash: '12,400', land: '80,000', total: '92,400' },
      ],
    },
    // 没人读的两坨：裁剪器必须丢掉它们，且丢掉之后判词不变。
    firstFrames: Array.from({ length: 60 }, () => ({ kind: 'action', junk: 'x'.repeat(200), cards: [] })),
    hintInserts: Array.from({ length: 20 }, () => ({ text: 'y'.repeat(200) })),
  };
  const replay = { checks: { setupShown: true, seedIs2: true, urlSeedIs2: true, stylesOffered: true,
    ctaUsable: true, sliceEntry: true, styleKept: true }, observed: {}, landed: {} };
  const after = { own_chrome: 0, host_chrome_total: 0, ports_free: { a: true, b: true, c: true } };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'record-8-summary.json'), JSON.stringify(summary));
  writeFileSync(path.join(dir, 'record-10-replay.json'), JSON.stringify(replay));
  writeFileSync(path.join(dir, 'after.json'), JSON.stringify(after));
}

test('交付里的整局回执现在就能判成 PASS（无浏览器）', () => {
  for (const f of ['record-8-summary.json', 'record-10-replay.json', 'after.json', 'provenance.json']) {
    assert.ok(existsSync(path.join(RECEIPT, f)), `回执缺文件：${f}`);
  }
  const { code, out } = judge(RECEIPT);
  assert.equal(code, 0, out);
  assert.match(out, /VERDICT: PASS/);
  assert.ok(!/NOT JUDGED/.test(out), '交付回执不应留未判项');
});

test('交付回执的 summary 只含判据读的字段（不允许长回未读字段）', () => {
  const summary = JSON.parse(readFileSync(path.join(RECEIPT, 'record-8-summary.json'), 'utf8'));
  const unread = Object.keys(summary).filter(
    k => !['label', 'human', 'entry', 'frames', 'ms', 'kinds', 'presses', 'pressLog', 'stuck',
      'runtimeErrors', 'runtimeErrorCount', 'png', 'judge', 'buys', 'buyFirstUnusable',
      'mismatchCount', 'mismatches', 'hintTrace'].includes(k));
  assert.deepEqual(unread, [], `回执里出现判据不读的字段（回执正在变回运行日志）：${unread}`);
});

test('裁剪：丢掉未读字段但判词逐字不变', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'receipt-slim-'));
  try {
    const raw = path.join(work, 'OUT-raw');
    const dest = path.join(work, 'slim');
    mkRaw(raw);
    const before = judge(raw);
    assert.equal(before.code, 0, before.out);
    const r = spawnSync('python3', ['-B', SLIM, raw, '--dest', dest], { encoding: 'utf8' });
    assert.equal(r.status, 0, (r.stdout ?? '') + (r.stderr ?? ''));
    const slimmed = JSON.parse(readFileSync(path.join(dest, 'record-8-summary.json'), 'utf8'));
    assert.ok(!('firstFrames' in slimmed) && !('hintInserts' in slimmed), '未读字段没被裁掉');
    const after = judge(dest);
    assert.equal(after.out, before.out, '裁剪后判词变了：说明裁掉了判据读的东西');
    const prov = JSON.parse(readFileSync(path.join(dest, 'provenance.json'), 'utf8'));
    assert.equal(prov.judged_same_as_raw, true);
    assert.ok(prov.raw['record-8-summary.json'].sha256, 'provenance 没有记原始帧的 sha256');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('牙：原始记录缺一个被读字段时，裁剪器必须拒写', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'receipt-bite-'));
  try {
    const raw = path.join(work, 'OUT-broken');
    mkRaw(raw);
    const p = path.join(raw, 'record-8-summary.json');
    const s = JSON.parse(readFileSync(p, 'utf8'));
    delete s.kinds;                     // F1/F2 都读 kinds
    writeFileSync(p, JSON.stringify(s));
    const dest = path.join(work, 'slim');
    const r = spawnSync('python3', ['-B', SLIM, raw, '--dest', dest], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, '缺字段的原始记录被静默裁成了一份「能判」的回执');
    assert.match((r.stdout ?? '') + (r.stderr ?? ''), /lacks judged field/);
    assert.ok(!existsSync(dest), '拒写时不应留下半成品目录');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
