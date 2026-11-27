import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #3345：把「重开沿用本局那张盘」从**记录**变成**判据**。
//
// 背景：supervisor 在真入口手选「整条街」打完后点「换个打法，再开一局」，
// 起手与新种子都对，发牌方式却悄悄回到了默认的争街 —— 他想的「重开对比玩法」
// 于是比的不是同两张盘，而屏上没有任何一处说这件事。
//
// 修的时候我发现两件事，都要被钉住：
//   ① 根因不是 replay() 漏了一个参数，而是第一屏的单选**从来没写进地址栏**；
//   ② 光在报告里「记录」这两项不够 —— report-full.py 里那句「缺了就 SKIP」
//      会让它永远不发言。所以这里对**当前交付的那两份回执**硬要求：
//      证据必须在，且必须是 PASS。
//
// 牙：把 drive-full.mjs 里写 openingKept 的那段删掉 ⇒ 第 2 条红（字段不见了）；
// 把 main.js 里 replay 的 cross 参数删掉 ⇒ 重跑后 openingKept=false，第 3 条红。
// 后者我在本片真做过一次（planted tooth），当时 VERDICT 就点名了那一条。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EVIDENCE = path.join(ROOT, 'docs', 'evidence');
const REPORT = path.join(ROOT, 'support', 'full-game', 'report-full.py');

// 两份回执是这一片的两个入口：默认盘（争街）与手选整条街。
// 后者正是 supervisor 撞到的那条路，不能只留一份。
const RECEIPTS = ['receipt-3345-ship', 'receipt-3345-whole'];

const judge = dir => {
  const r = spawnSync('python3', ['-B', REPORT, dir], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};

test('#3345 交付的两份回执都在库里，且各带一份 replay 记录', () => {
  for (const name of RECEIPTS) {
    const dir = path.join(EVIDENCE, name);
    assert.ok(existsSync(path.join(dir, 'record-10-replay.json')), `${name} 缺 record-10-replay.json`);
    assert.ok(existsSync(path.join(dir, 'provenance.json')), `${name} 缺 provenance.json`);
  }
});

test('#3345 回执里的 replay 记录必须真的写了「沿用哪张盘」这两项', () => {
  for (const name of RECEIPTS) {
    const replay = JSON.parse(readFileSync(path.join(EVIDENCE, name, 'record-10-replay.json'), 'utf8'));
    for (const key of ['openingKept', 'openingSwitchable']) {
      assert.ok(key in replay.checks,
        `${name} 的 checks 里没有 ${key} —— 那这项证据又变回「没人记」了`);
    }
    // 「本局用的盘」也要留下来，否则「沿用了」无从核对是哪一张。
    assert.ok(replay.observed && replay.observed.playedOpening,
      `${name} 没记本局实际用的是哪张盘`);
    assert.ok(['contested', 'whole'].includes(replay.observed.playedOpening.checked),
      `${name} 记的盘不是两张之一：${JSON.stringify(replay.observed.playedOpening)}`);
  }
});

test('#3345 两份回执现在就能判成 PASS，且那两项是 PASS 而不是 SKIP', () => {
  for (const name of RECEIPTS) {
    const { code, out } = judge(path.join(EVIDENCE, name));
    assert.equal(code, 0, `${name} 判不过：\n${out}`);
    assert.match(out, /VERDICT: PASS/, `${name} 的判词不是 PASS`);
    assert.match(out, /PASS {2}F5 replay kept the opening \(same board\)/,
      `${name} 没有把「沿用本局那张盘」判成 PASS（SKIP 等于没验）`);
    assert.match(out, /PASS {2}F5 the opening is still switchable after replay/,
      `${name} 没有把「重开后还能再手选」判成 PASS`);
  }
});

test('#3345 两张盘的取值确实不同：一份是争街、一份是整条街', () => {
  // 如果两份都是争街，那第二条回执就不是 supervisor 那条路的回归证据。
  const seen = RECEIPTS.map(name => JSON.parse(
    readFileSync(path.join(EVIDENCE, name, 'record-10-replay.json'), 'utf8')).observed.playedOpening.checked);
  assert.deepEqual([...new Set(seen)].sort(), ['contested', 'whole'],
    `两份回执应当一张一张盘，实际是 ${JSON.stringify(seen)}`);
});
