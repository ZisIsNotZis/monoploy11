import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #3278：回答闸门的判据必须是「按下的那个控件自己销账了吗」，不是「按下时气泡在播」。
//
// 实测走过两次弯路，这条测试把两次都钉住：
//   1. 修复前 OUT-S-360-ask：同一张动作屏被连按 20 次，day/logLen 全程不变 —— 点击被吞。
//   2. 修复后 OUT-U-360-gate：唯一一次「按在气泡在播时」的 roll 按下去之后**下一帧就前进了**
//      （frame 341 变 direction、第 12 天）—— 它正是修好的样子。若拿「按时有气泡」当判据，
//      这条好记录会被判红（实测吃到过这个假红）。
// 所以 F6 只看 data 里的 `after.stillEnabled`：产品规则是「可点 ⇔ 此刻能接受回答」，
// 按下 80ms 后同一控件仍 enabled ⇒ 这一次点击没有被接住。没有 after 的旧记录一律 SKIP。
//
// 牙：把 F6 改回「气泡在播就是缺陷」，用例 B 立刻红。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REPORT = path.join(ROOT, 'support/full-game/report-full.py');

const summary = pressLog => ({
  label: 'fixture', human: '街角店主', entry: 'http://127.0.0.1:1/index.html', frames: 10, ms: 1000,
  kinds: {action: {frames: 8}, results: {frames: 1}}, presses: pressLog.length, pressLog,
  runtimeErrorCount: 0, runtimeErrors: [], stuck: [], buys: 0, buyFirstUnusable: null,
  mismatchCount: 0, mismatches: [], hintTrace: [], hintInserts: [],
  judge: {
    heading: '穿街高手 的生意做到了最后',
    gapLine: '你与获胜者相差 27,800 资产。',
    checks: {rowsFull: true, sumsOk: true, gapMatches: true, titleNamesWinner: true,
      replayUsable: true, threeRows: true, headerOrder: true},
    rows: [
      {owner: '街角店主', cash: '12,400', land: '50,400', total: '62,800'},
      {owner: '机会买家', cash: '80,000', land: '10,600', total: '90,600'},
      {owner: '穿街高手', cash: '59,600', land: '0', total: '59,600'},
    ],
    raw: {claimed: 27800, expect: 27800},
  },
  replay: null,
});

const replay = {checks: {setupShown: true, seedIs2: true, urlSeedIs2: true, stylesOffered: true, ctaUsable: true}};
const after = {own_chrome: 0, ports_free: {'8041': true, '19529': true, '19629': true}};

function runReport(pressLog) {
  const dir = mkdtempSync(path.join(tmpdir(), 'report-gate-'));
  try {
    writeFileSync(path.join(dir, 'record-8-summary.json'), JSON.stringify(summary(pressLog)));
    writeFileSync(path.join(dir, 'record-10-replay.json'), JSON.stringify(replay));
    writeFileSync(path.join(dir, 'after.json'), JSON.stringify(after));
    const r = spawnSync('python3', ['-B', REPORT, dir], {encoding: 'utf8'});
    assert.equal(r.error, undefined, `无法启动 python3: ${r.error}`);
    return {code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '')};
  } finally { rmSync(dir, {recursive: true, force: true}); }
}

const line = (out, name) => out.split(/\r?\n/).find(l => l.includes(name)) ?? '';
const F6 = 'F6 no press on a control that had already stopped accepting';

test('A 修复后：气泡在播的 roll 按下去被接住（after.stillEnabled=false）⇒ F6 PASS', () => {
  const {code, out} = runReport([
    {tag: 'action:roll', frame: 340, kind: 'action', heading: '还剩 1 步，往哪走？',
     seen: {day: '第 12 天', logLen: 3535, rollDisabled: false, choiceHidden: true},
     hit: 'itself', bubble: '这地方，我不熟。',
     after: {stillEnabled: false, rollDisabled: true, logLen: 3535, day: '第 12 天', bubble: '这地方，我不熟。'}},
  ]);
  assert.equal(code, 0, out);
  assert.match(line(out, F6), /^PASS /, '控件自己销账了，不该判红');
  assert.match(out, /gate: OK/, '结论行必须是 OK，并且点明这是被接住的那一类');
  assert.ok(!/NOT EXERCISED/.test(out), '有 after 证据时不能说这一局没考到');
});

test('B 修复后：按下时气泡在播但点击被接住，不能因为「有气泡」就判红（假红回归）', () => {
  const {code, out} = runReport([
    {tag: 'action:roll', frame: 340, kind: 'action', bubble: '这地方，我不熟。',
     seen: {rollDisabled: false}, after: {stillEnabled: false}},
    {tag: 'action:roll', frame: 355, kind: 'action', bubble: null,
     seen: {rollDisabled: false}, after: {stillEnabled: false}},
  ]);
  assert.equal(code, 0, out);
  assert.match(line(out, F6), /^PASS /,
    '把「按时有气泡」当缺陷就会判红这一条 —— 而它正是修复后的正常情形');
});

test('C 缺陷仍在：动作控件按下 80ms 后还 enabled ⇒ F6 FAIL，整局非零退出', () => {
  const {code, out} = runReport([
    {tag: 'action:roll', frame: 340, kind: 'action', bubble: '很快出来。',
     seen: {day: '第 12 天', logLen: 3535, rollDisabled: false, choiceHidden: true},
     hit: 'itself', after: {stillEnabled: true, rollDisabled: false, logLen: 3535, day: '第 12 天'}},
  ]);
  assert.notEqual(code, 0, '点击被吞是真缺陷，报告必须非零退出');
  assert.match(line(out, F6), /^FAIL /);
  assert.match(out, /VERDICT: FAIL/);
});

test('D 旧记录没有 after：F6 必须是 SKIP，不能猜（缺证据 ≠ 没问题）', () => {
  const {code, out} = runReport([
    {tag: 'action:roll', frame: 340, kind: 'action', bubble: '很快出来。',
     seen: {day: '第 12 天', logLen: 3535, rollDisabled: false, choiceHidden: true}, hit: 'itself'},
  ]);
  assert.equal(code, 0, '旧量具没问这个问题，不该让整局判负');
  assert.match(line(out, F6), /^SKIP /);
  assert.match(out, /gate: NOT EXERCISED/);
});

test('E 连按同指纹：必须打 WARN（不是 FAIL），且指出最长的一串', () => {
  const seen = {day: '第 12 天', logLen: 3535, rollDisabled: false, choiceHidden: true};
  const log = Array.from({length: 5}, () => ({tag: 'action:roll', seen, bubble: '很快出来。'}));
  const {out} = runReport(log);
  assert.match(out, /WARN  1 burst\(s\) of >=3 presses/);
  assert.match(out, /longest 5 on action:roll/);
});
