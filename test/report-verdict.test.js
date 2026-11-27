import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #3278：验收报告不许把「这一次根本没见到这一屏」印成 PASS。
//
// 360×640 的探索跑实测到过：那一局的真入口起手不同，落地格也不同，整局**没出现买地屏**
// （record-8-summary.json 的 kinds 里没有 'buy'，buys=0），而 report-full.py 仍然打出
// `PASS  F2 buy screen usable at first frame` —— 因为 buyFirstUnusable 在「没见到」和
// 「见到了且首帧可用」两种情况下都是 null。把 null 读成「没问题」就是把缺证据当证据。
//
// 这条测试用两份手写记录喂给真正的 report-full.py（不是复制它的逻辑）：
//   A. 见过买地屏：F2 两项必须 PASS/FAIL 判下去；
//   B. 没见过买地屏：F2 两项必须是 SKIP，且报告里必须写出「这次没判」，不能静默通过。
// 期望值来自报告自己的输出，所以判据改了这里会先红。
//
// 牙：把 report-full.py 的 saw_buy 三态删掉（退回归纳成 True/False），B 用例立刻红。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REPORT = path.join(ROOT, 'support/full-game/report-full.py');

const baseSummary = over => ({
  label: 'fixture', human: '街角店主', entry: 'http://127.0.0.1:1/index.html', frames: 10, ms: 1000,
  // F6（回答闸门）也是判决项之一：这一项没有按压证据就会是 SKIP，于是这份「全判过了」的
  // 夹具里必须真的有一次「按下去、控件随即变灰」的按压证据，否则 NOT JUDGED 会合法出现。
  kinds: {action: {frames: 8}, results: {frames: 1}}, presses: 3,
  pressLog: [{tag: 'action:roll', kind: 'action', frame: 1, seen: {rollDisabled: false},
    after: {stillEnabled: false, rollDisabled: true}}],
  runtimeErrorCount: 0, runtimeErrors: [], stuck: [], buys: 0, buyFirstUnusable: null,
  mismatchCount: 0, mismatches: [], hintTrace: [], hintInserts: [],
  judge: {
    heading: '穿街高手 的生意做到了最后',
    gapLine: '你与获胜者相差 27,800 资产。',
    checks: {rowsFull: true, sumsOk: true, gapMatches: true, titleNamesWinner: true,
      replayUsable: true, threeRows: true, headerOrder: true},
    // report-full.py recomputes the gap from these rows (it does not trust gapMatches),
    // so a fixture without rows can only be NOT JUDGED. 90,600 - 62,800 = 27,800 matches the line.
    rows: [
      {owner: '街角店主', cash: '12,400', land: '50,400', total: '62,800'},
      {owner: '机会买家', cash: '80,000', land: '10,600', total: '90,600'},
      {owner: '穿街高手', cash: '59,600', land: '0', total: '59,600'},
    ],
    raw: {claimed: 27800, expect: 27800},
  },
  replay: null,
  ...over,
});

const baseReplay = {
  checks: {setupShown: true, seedIs2: true, urlSeedIs2: true, stylesOffered: true, ctaUsable: true},
};
const baseAfter = {own_chrome: 0, ports_free: {'8041': true, '19529': true, '19629': true}};

function runReport(summary) {
  const dir = mkdtempSync(path.join(tmpdir(), 'report-verdict-'));
  try {
    mkdirSync(dir, {recursive: true});
    writeFileSync(path.join(dir, 'record-8-summary.json'), JSON.stringify(summary));
    writeFileSync(path.join(dir, 'record-10-replay.json'), JSON.stringify(baseReplay));
    writeFileSync(path.join(dir, 'after.json'), JSON.stringify(baseAfter));
    const r = spawnSync('python3', ['-B', REPORT, dir], {encoding: 'utf8'});
    assert.equal(r.error, undefined, `无法启动 python3: ${r.error}`);
    return {code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '')};
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

const line = (out, name) => out.split(/\r?\n/).find(l => l.includes(name)) ?? '';

test('见过买地屏：F2 如实判定，不是 SKIP', () => {
  const out = runReport(baseSummary({
    kinds: {action: {frames: 8}, buy: {frames: 1}, results: {frames: 1}},
    buys: 1, buyFirstUnusable: null,
  }));
  assert.equal(out.code, 0, out.out);
  assert.match(line(out.out, 'F2 buy screen usable at first frame'), /^PASS /);
  assert.match(line(out.out, 'F2 a land purchase happened'), /^PASS /);
  assert.ok(!/NOT JUDGED/.test(out.out), '全部判过的时候不应出现「没判」一行');
});

test('见过买地屏但首帧不可用：必须 FAIL', () => {
  const out = runReport(baseSummary({
    kinds: {action: {frames: 8}, buy: {frames: 1}, results: {frames: 1}},
    buys: 1, buyFirstUnusable: {heading: '购买 书店 Lv.2', buyUsable: false},
  }));
  assert.notEqual(out.code, 0, '首帧点不到买地键是一处真缺陷，报告必须非零退出');
  assert.match(line(out.out, 'F2 buy screen usable at first frame'), /^FAIL /);
  assert.match(out.out, /VERDICT: FAIL/);
});

test('整局没见到买地屏：F2 必须是 SKIP 且被点名，不能是 PASS', () => {
  const out = runReport(baseSummary({}));   // kinds 里没有 'buy'，buys 0，buyFirstUnusable null
  assert.equal(out.code, 0, '没见到某屏是合法结局（人没落在无主地），不该让整局判负');
  assert.match(line(out.out, 'F2 buy screen usable at first frame'),
    /^SKIP /, '「没见到」不能印成 PASS：那是把缺证据当证据');
  assert.match(line(out.out, 'F2 a land purchase happened'), /^SKIP /);
  assert.match(out.out, /NOT JUDGED by this run/,
    '报告必须写出这次没判什么，否则读者会把它当成已覆盖');
});
