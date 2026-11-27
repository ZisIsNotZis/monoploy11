import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { rentFor, buildCost } from '../src/engine/economy.js';
import { nextGameLine } from '../src/ui/slice.js';
import { MARKET_LEDGER, bigBuildCost } from '../src/engine/market-ledger.js';

// #3337b：supervisor 在 5ec96f8 上抓到结算建议把「付过的最大一笔租」说成了出局原因，
// 并要求「书屋提示里的实付、标价和升一级/升到顶分别说准确」。
//
// 上一片那条判据只钉住了那一支的措辞形状，它挡不住「数字本身是错的」——
// 因为数字是从日志里挑的，挑错了规则（最大 vs 真的没付成）措辞却完全合规。
// 所以这里换一个更强的判据：**句子里出现的每一个数，都必须能由本局 state/log 回算出来**。
// 允许的来源有三种，别的都算编造：
//   ① 某块地的标价（本局 map 里就有）
//   ② 本局日志里出现过的某个金额（单笔）
//   ③ 那些金额的若干笔之和（句子会写「你踩到它 2 次、付了 19,200」= 9,600×2）
//   ④ 引擎此刻的 rentFor / buildCost 结果（「每次租金 2,000 变 2,800」）
//
// 跑真整局而不是夹具：夹具只能复现我想得到的形状，而这条判据要抓的正是
// 「我想不到的取数方式」。180 局够覆盖五支（实测分布见 support/probe-3337/branch.mjs）。
//
// 但这条判据**抓不住「取错了哪一个数」**，这是用旧实现跑出来的：
// 把破产那一支改回 `biggestRentPaid`（取付过的最大一笔，正是 supervisor 报的那个缺陷），
// 180 局审计仍然全绿 —— 因为 9,600 本来就在日志里、可以回算，错的只是它不该被用在这里。
// 抓住它的是下面那条真局面判据（grow/19：第 12 天 vs 第 16 天）。
// 两条判据各管一半：这一条管「数是不是编的」，那一条管「那个数是不是这件事的原因」。

const RE_NUM = /[\d,]{4,}/g;

function verifiableNumbers(state) {
  const ok = new Set();
  for (const plot of state.map?.plots ?? []) if (plot.price) ok.add(plot.price);
  for (const entry of state.log ?? []) {
    for (const m of String(entry.text).matchAll(/(\d{3,})/g)) ok.add(Number(m[1]));
  }
  for (const plot of state.map?.plots ?? []) {
    const rent = rentFor(state, plot.id);
    if (rent) ok.add(rent);
  }
  for (let lv = 1; lv <= 3; lv++) ok.add(Math.round(buildCost(lv) * (state.priceIndex ?? 1)));
  // 书屋的加盖价不是 buildCost：flow.js 对 big 固定扣 30,000（#3338 修的口径）。
  ok.add(bigBuildCost(state));
  const pr = state.properties?.market;
  if (pr) {
    for (let lv = 1; lv <= 3; lv++) {
      const saved = pr.level;
      pr.level = lv;
      const rent = rentFor(state, 'market');
      pr.level = saved;
      if (rent) ok.add(rent);
    }
  }
  return ok;
}

// 常数表里的数（MARKET_LEDGER）：它们是**声明过的**常数，不是拍出来的。
// #3338：句子现在会引「72 局里先拿到它的 31 局平均实收 11,948」这类数。
// 这类数允许出现，但必须紧跟在标了来源的从句后面 —— 这是 #1143 定下的口径纪律，
// 下面那条判据检查的正是「常数没有冒充本局」。
function ledgerNumbers() {
  const ok = new Set();
  const walk = v => {
    if (typeof v === 'number') ok.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(MARKET_LEDGER);
  return ok;
}
const SOURCE_MARK = /72 局|同规则/;

// 合法合计：任意若干「可核金额」之和（cap 防爆炸）。句子里的「付了 N」「收了 N」都是这种。
function sums(set) {
  const pool = [...set].filter(v => v > 0 && v <= 200_000);
  const reach = new Set([0]);
  for (const v of pool) for (const r of [...reach]) { const t = r + v; if (t <= 200_000) reach.add(t); }
  return reach;
}

test('180 局真整局：结算建议里每个数字都能从本局 state/log 回算', async () => {
  const bad = [];
  let games = 0;
  for (const style of ['grow', 'take', 'cross']) {
    for (let seed = 1; seed <= 60; seed++) {
      const state = startSession(createSliceConfig({ human: true, seed, style }));
      await runGame(state, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, state); } });
      const line = nextGameLine(state);
      const allowed = verifiableNumbers(state);
      const reach = sums(allowed);
      const table = ledgerNumbers();
      // 常数只允许出现在标了来源的句子里：整句必须提到「72 局/同规则」，
      // 否则「3 级」「31 局」这类常数就成了没头没尾的数（#1143 的口径纪律）。
      const labeled = SOURCE_MARK.test(line);
      const nums = (line.match(RE_NUM) ?? []).map(x => Number(x.replace(/,/g, '')));
      const unknown = nums.filter(v => !allowed.has(v) && !reach.has(v) && !(table.has(v) && labeled));
      if (unknown.length) bad.push({ style, seed, line, unknown });
      const onlyTable = nums.filter(v => !allowed.has(v) && !reach.has(v) && table.has(v));
      if (onlyTable.length && !labeled) bad.push({ style, seed, line, unlabeled: onlyTable });
      games += 1;
    }
  }
  assert.equal(games, 180, '样本数变了：这条判据的前提是三种起手各 60 局');
  assert.deepEqual(bad, [], `这些句子里的数字无法从本局回算（编造或取错）：
${JSON.stringify(bad.slice(0, 5), null, 1)}`);
});

// 牙：把「破产原因」那一段改回旧口径（取最大一笔），上面那条必须真的能咬到。
// 这里不删产品代码，直接用同一条判据去核一个**已知会说错**的局面：
// grow/19 的真实日志里，旧口径会写第 12 天的 9,600（那是付清了的一笔）。
test('反面：grow/19 的第 12 天那笔不能出现在出局原因里（旧口径会，新口径不会）', async () => {
  const state = startSession(createSliceConfig({ human: true, seed: 19, style: 'grow' }));
  await runGame(state, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, state); } });
  const line = nextGameLine(state);
  assert.match(line, /第 16 天/, `出局是第 16 天：${line}`);
  assert.doesNotMatch(line, /第 12 天/, `第 12 天那笔 9,600 已付清，不是出局原因：${line}`);
});
