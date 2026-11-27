import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig, SLICE_MAP } from '../src/data/slice.js';
import { startSession, runGame, buildPlot } from '../src/engine/flow.js';
import { sliceAnswer } from '../src/engine/slice-ai.js';
import { rentFor } from '../src/engine/economy.js';
import { render } from '../src/ui/render.js';
import { LANDING_STATS, buildForwardK, buildForwardLine, upgradeSteps, sliceResults } from '../src/ui/slice.js';
import { createHash } from 'node:crypto';

// #993：付费加盖**之前**要给一个可算的数。
//
// 为什么需要：981 已签，付费升级那一步屏上有话说，但全是过去式（本局被踩 N 次）。
// 玩家掏 10,000/15,000 那一刻手上没有任何可算的东西。
//
// 钉五件事：
//   1. K = ceil(cost / 升级后 rentFor)，且 unit 是真 rentFor，不写常数；
//   2. 提议框真的印出来了（真 render，不是拼字符串）；
//   3. 旧 hint 逐字节没动；
//   4. 停业时不说 K，照实说算不出；
//   5. 落地分布表的店名与棋盘一致，样例数之和等于局数（防有人改了棋盘忘了改表）。

function root() {
  const mk = () => ({ innerHTML: '', hidden: false, scrollTop: 0, scrollHeight: 0,
    querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
    style: {}, getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }) });
  return new Proxy({}, { get: (t, k) => (t[k] ??= mk()) });
}
const noop = new Proxy({}, { get: () => () => {} });
const slice = (seed = 7, style = 'grow') => startSession(createSliceConfig({ seed, style }));

// 与 main.js:174 同一形状：pending 里是 cellId。
function renderBuild(state, cellId, cost) {
  const r = root();
  const saved = state.pending;
  state.pending = { type: 'build', cellId, cost, label: '小地产' };
  render(r, state, noop);
  state.pending = saved;
  return r.choice.innerHTML;
}

test('#993 K 与「升级后 rentFor」独立算出的 ceil 一致（不写常数）', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 1;
  const cost = 10000;
  const info = buildForwardK(s, id, cost);
  // 独立复算：把等级 +1 读 rentFor
  const saved = s.properties[id].level;
  s.properties[id].level = saved + 1;
  const unit = rentFor(s, id);
  s.properties[id].level = saved;
  assert.equal(info.unit, unit, 'unit 不是升级后的 rentFor');
  assert.equal(info.K, Math.ceil(cost / unit), 'K 不是 ceil(cost/unit)');
  assert.equal(buildForwardK(s, id, cost).unit, unit, 'buildForwardK 没把等级恢复（读两次不同）');
});

test('#993 升级后等级越高 K 越小，同一间店同一笔钱', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 1;
  const k1 = buildForwardK(s, id, 10000);
  s.properties[id].level = 2;
  const k2 = buildForwardK(s, id, 10000);
  assert.ok(k2.unit > k1.unit, '升级后租金没变，测不出差异');
  assert.ok(k2.K < k1.K, `等级高了 K 反而没变小：${k1.K} -> ${k2.K}`);
});

test('#993 提议框真的印出 K（真 render，不是拼串）', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 1;
  const html = renderBuild(s, id, 10000);
  const line = /data-forward-k>(.+?)<\/p>/.exec(html)?.[1];
  assert.ok(line, `提议框里没有前向 K：${html}`);
  const unit = buildForwardK(s, id, 10000).unit;
  assert.ok(line.includes(unit.toLocaleString()), `K 行没写升级后单价 ${unit}：${line}`);
  assert.ok(/满 \d+ 次一定够本/.test(line), `K 行没说「满 N 次一定够本」：${line}`);
  // 上界而非下限：不许出现「才够本」「至少要」
  assert.equal(/才够本/.test(line), false, `把上界写成下限了：${line}`);
  assert.equal(/至少/.test(line), false, `把上界写成下限了：${line}`);
});

test('#993 旧 hint 逐字未动（新行是追加的一段）', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 1;
  p.cash = 50000;
  const html = renderBuild(s, id, 10000);
  const OLD = `<p class="hint">升到 2 级；小店基础租金翻倍，最高 3 级。书屋按等级计租。剩余现金 40,000，估值增加 4,000。</p>`;
  assert.ok(html.includes(OLD), `旧 hint 变了：${html}`);
});

test('#993 停业时不说 K，照实说算不出（不拿 0 当单价）', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 1;
  s.properties[id].closed = 2;
  const info = buildForwardK(s, id, 10000);
  assert.equal(info.unit, 0, '停业时 rentFor 应为 0');
  assert.equal(info.K, null, '停业时不该给出 K');
  assert.equal(info.closed, true, '没标出停业');
  const line = buildForwardLine(s, id, 10000);
  assert.ok(line.includes('停业'), `停业时没说出来：${line}`);
  assert.equal(/满 \d+ 次/.test(line), false, `停业时不该印 K：${line}`);
});

test('#993 停业句与 K 行不可互换：停业不写“一定够本”', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].closed = 1;
  const line = buildForwardLine(s, id, 10000);
  assert.equal(line.includes('一定够本'), false, `停业句里出现了保证：${line}`);
});

test('#993 落地分布表的店名与切片棋盘一致（改棋盘不忘改表）', () => {
  const names = SLICE_MAP.plots.map(x => x.name).sort();
  assert.deepEqual(Object.keys(LANDING_STATS.table).sort(), names, '表的店名与棋盘不一致');
  for (const [name, a] of Object.entries(LANDING_STATS.table)) {
    assert.equal(a.reduce((x, y) => x + y, 0), LANDING_STATS.games, `${name} 的样例数之和不是 ${LANDING_STATS.games}`);
  }
});

test('#993 那句“被踩到 N 局”必须是真数据：表与实跑一致（抽样 1 间店）', async () => {
  // 只用 1 风格 × 6 seed 抽样，不作主证据（主证据在 .scratch/993-forward-k/landing-stats.json）；
  // 这里只钉“表不是编的”：抽样的 0 次占比落在表值的合理区间内。
  const plot = '街心书屋';
  let zero = 0, total = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const state = startSession(createSliceConfig({ seed, style: 'grow' }));
    let n = 0;
    await runGame(state, { render() {}, async step() {}, async say() {},
      async ask(q) { if (++n > 5000) throw new Error('limit'); state.pending = null; state.mapPick = null; return sliceAnswer(q, state); } });
    const { rentRowsFor } = await import('../src/ui/slice.js');
    total++;
    if (rentRowsFor(state).filter(r => r.plot === plot).length === 0) zero++;
  }
  const tableZero = LANDING_STATS.table[plot][0] / LANDING_STATS.games;
  assert.ok(Math.abs(zero / total - tableZero) <= 0.25, `抽样 0 次占比 ${zero}/${total} 与表 ${tableZero.toFixed(2)} 差太远`);
});

test('#993 负对照：免费档成立句逐字不变（981 已签 69a7845ec4bf83dc）', async () => {
  // #1026 重签说明（只改「条数固定」，不动任何已签文本）：
  // `groundPhase` 补了在押守卫后，这条负对照的**条数**从 6 掉到 5。
  //
  // 归因已坐实，不是免费档文案被改：
  //   在改前副本上把「在押状态下的 build 提议」一律拒掉，与改后「根本不问」的输出
  //   **逐行完全一致**（.scratch/1026-custody/probe-attr.mjs，5 局 5 对）。
  //   少掉的是 take/42「晨光街茶铺（免费翻修 升到 3 级，第 4 天）…第 14 天」：
  //   该局穿街高手在监狄格上被问过一次 10,000 付费加盖，守卫去掉后他多留了这笔钱，
  //   后续路线变了，这次免费翻修在新轨迹里不再发生。
  //   文案模板 src/ui/slice.js:608 一字未动。
  //
  // 判据改成子集 + 逐字，比「固定 6 条」更严：
  //   - 已签集合自身的 sha16 必须仍是 69a7845ec4bf83dc（改这里就是改判据，必须重签）；
  //   - 出现任何一条不在已签集合里的话 → 红（口径被改）；
  //   - 少掉的必须能逐条点名，且只允许是已知那一条（轨迹变化必须可见，不能默默少）。
  const SIGNED = [
    '<li>晨光街茶铺（免费翻修 升到 2 级，第 7 天）：实收 1 次 / 11,200 — 已回本，第 9 天收回本钱</li>',
    '<li>街心书屋（免费翻修 升到 3 级，第 7 天）：实收 3 次 / 33,200 — 已回本，第 9 天收回本钱（其中 1 次撞上停业，没收钱）</li>',
    '<li>晨光街茶铺（免费翻修 升到 3 级，第 4 天）：实收 2 次 / 11,200 — 已回本，第 13 天收回本钱（其中 1 次撞上停业，没收钱）</li>',
    '<li>晨光街小店（免费翻修 升到 2 级，第 7 天）：实收 1 次 / 5,600 — 已回本，第 12 天收回本钱</li>',
    '<li>晨光街茶铺（免费翻修 升到 3 级，第 4 天）：实收 1 次 / 11,200 — 已回本，第 12 天收回本钱</li>',
    '<li>晨光街茶铺（免费翻修 升到 3 级，第 4 天）：实收 1 次 / 11,200 — 已回本，第 14 天收回本钱</li>',
  ];
  assert.equal(createHash('sha256').update(SIGNED.join(String.fromCharCode(10))).digest('hex').slice(0, 16), '69a7845ec4bf83dc',
    '本地写的已签快照与 981 签字不一致——先修快照，别动下面断言');
  const free = [];
  for (const style of ['grow', 'take', 'cross']) for (const seed of [1, 5, 7, 11, 13, 23, 42]) {
    const state = startSession(createSliceConfig({ seed, style }));
    let n = 0;
    await runGame(state, { render() {}, async step() {}, async say() {},
      async ask(q) { if (++n > 5000) throw new Error('limit'); state.pending = null; state.mapPick = null; return sliceAnswer(q, state); } });
    const html = sliceResults(state);
    const steps = upgradeSteps(state);
    // 按 <li> 切、不靠正则跨段匹配：上一版用全局正则匹配整句，一旦某句不匹配
    // （例如文案真的被改），相邻的 <li> 会被跨段粘成一条，索引与 steps 错位，
    // 报出的「额外句」合着几句付费行——那次输出就是証据。先断言条数对齐，再按位取。
    const items = [...html.matchAll(/<li>(.*?)<\/li>/gs)].map(m => `<li>${m[1]}</li>`);
    assert.equal(items.length, steps.length,
      `回本段 <li> 数（${items.length}）与 upgradeSteps（${steps.length}）不一致，索引对齐不成立（截图不能只靠位置）`);
    items.forEach((li, i) => { if (!steps[i].paid && steps[i].state === 'ok') free.push(li); });
  }
  const extra = free.filter(l => !SIGNED.includes(l));
  assert.deepEqual(extra, [], `出现了已签之外的免费句（口径被改了）：${extra.join(' / ')}`);
  const missing = SIGNED.filter(l => !free.includes(l));
  assert.ok(missing.length <= 1, `少了不止 1 条已签免费句，超出本次守卫能解释的范围：${missing.join(' / ')}`);
  if (missing.length === 1) assert.match(missing[0], /实收 1 次 \/ 11,200 — 已回本，第 14 天/,
    `少掉的不是已知的 take/42 那条（轨迹变化来源不明）：${missing[0]}`);
  assert.ok(free.length >= 5, `免费句只剩 ${free.length} 条，样本太少判据失效`);
});
