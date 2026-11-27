// #3391t：先别调量级，先问「这条规则的收益到底来自哪」。
//
// 现状（RESULT 3d）量到：开营业进项后「照常打」整体 +17.8pp，三起手差距 10.8 → 32.5pp。
// 但这条读数有一个没有被排除的竞争解释：
//   #3391f 已经量过「白得 26,000 现金 = +30.0pp（财富效应）」。
//   营业进项 250/店/天 × 16 天 × 通常 2 间 ≈ 13,000/局 —— 与那一笔是同一个量级。
//   所以「+17.8pp」可能完全不是「凑齐一条街」的功劳，而是「场上钱变多」。
//
// 于是本探针对照三格（同一批 seed、同一批起手、同一套臂，只差「钱从哪来」）：
//   plain  产品现状，无进项
//   street 引擎规则 settleStreetBusiness（每店每天 250，条件=整条街归己）
//   flat   每人每天白拿 FLAT_PER_DAY，无任何所有权条件（探针注入，引擎不知道）
//          —— 定这个数的依据：street 臂里 seat0 平均每局拿到约 13,000（16 天）⇒ 800/天。
//
// 判据：如果 flat 也能把「整体 +17.8pp」和「符号随起手翻」印出来，
//       那么这条规则提供的不是「第二条路子」，而是「让本已领先的人更有钱」。
//
// 同时记录：seat0 每局到底凑齐几条街（若几乎不凑齐，玩家根本走不到这条路上）。
//
// 用法：node support/probe-3391/income-control.mjs [30] [800]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assertUnique, keyOf, pairedDiff, fmtCI } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 30);
const PER_SHOP = 250;
const FLAT_PER_DAY = Number(process.argv[3] ?? 800);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
  120: { grow: 49.2, take: 38.3, cross: 45.0 },
};
const BASELINE = BASELINES[SEEDS * 2];
if (!BASELINE) throw new Error(`没有 n=${SEEDS * 2} 的基线（用 30 或 60 个 seed）`);

const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const rate = xs => (xs.length ? xs.reduce((s, r) => s + (r.win ? 1 : 0), 0) / xs.length : 0);
const show = rows => pct(rate(rows) * rows.length, rows.length);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

// 每条街上有哪些店（大建筑不算）。用来判断「整条街归我」。
function streetsOf(state) {
  const m = new Map();
  for (const pl of state.map.plots) {
    if (pl.big) continue;
    const cur = m.get(pl.street) ?? [];
    cur.push(pl.id);
    m.set(pl.street, cur);
  }
  return m;
}

// 终局：seat0 完整拥有（全部小店归己且都开张）几条街。
function fullStreets(state, p) {
  let n = 0;
  for (const [, ids] of streetsOf(state)) {
    if (ids.every(id => {
      const pr = state.properties[id];
      return pr && pr.ownerId === p.id && pr.level > 0 && !(pr.closed > 0);
    })) n++;
  }
  return n;
}

async function play({ style, seed, order, arm, source }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  // 只有 street 格打开引擎规则；其余两格引擎完全不知道有这回事。
  state.config.streetBusinessPerShop = source === 'street' ? PER_SHOP : 0;
  const seat0 = state.players[0];
  let decisions = 0, minCash = seat0.cash, flatGot = 0, lastDay = state.day;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      // flat：每人每天等额现金，无任何条件（含 seat0，三家一视同仁）。
      if (source === 'flat' && state.day !== lastDay) {
        lastDay = state.day;
        for (const q of state.players) if (q.alive) { q.cash += FLAT_PER_DAY; if (q.id === seat0.id) flatGot += FLAT_PER_DAY; }
      }
      minCash = Math.min(minCash, seat0.cash);
      const mine = prompt.player?.id === seat0.id;
      if (prompt.type === 'buy' && mine) {
        const id = prompt.plot?.id ?? prompt.plot;
        if (arm === 'book' && id === 'market') return seat0.cash >= (prompt.price ?? 26000);
        if (arm === 'shops' && id === 'market') return false;
        if (arm === 'bookOnly') {
          const pl = prompt.plot?.big !== undefined ? prompt.plot : state.map.plots.find(p => p.id === id);
          if (!pl?.big) return false;
        }
      }
      if (prompt.type === 'build' && arm === 'bookOnly') return false;
      if (prompt.type === 'build' && arm === 'shops' && mine) return seat0.cash >= prompt.cost + 2_000;
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return {
    style: `${style}|${order.join('>')}`, styleId: style, seed, source, arm,
    win: state.players.find(p => p.team === state.winnerTeam) === seat0 ? 1 : 0,
    bankrupt: !seat0.alive,
    ownsBook: state.properties.market?.ownerId === seat0.id,
    fullStreets: fullStreets(state, seat0),
    income: seat0.sliceStats.business ?? 0,
    flatGot,
    rents: seat0.sliceStats.rentEarned,
    minCash,
  };
}

async function run(arm, source) {
  const rows = [];
  for (const style of STYLES) for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, arm, source }));
  return rows;
}

// 1) 基线：plain 格必须复现产品的三个数，否则后面一律不印。
console.log('基线校验（plain 格 / 照常打，产品现状）');
for (const style of STYLES) {
  const rs = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rs.push(await play({ style, seed, order, arm: 'ai', source: 'plain' }));
  const p = 100 * rate(rs);
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }
}

const CELLS = ['plain', 'street', 'flat'];
const ARMS = ['ai', 'shops', 'bookOnly'];
const rows = {};
for (const src of CELLS) for (const arm of ARMS) {
  rows[`${src}|${arm}`] = await run(arm, src);
  assertUnique(rows[`${src}|${arm}`], `${src}|${arm}`);
}
const n = rows['plain|ai'].length;

console.log(`\n每格每臂 n=${n}（${SEEDS} seed × 3 起手 × 2 对手顺序）；street 每店 ${PER_SHOP}/天，flat 每人 ${FLAT_PER_DAY}/天`);
console.log('格/臂             胜率   破产   收租   凑齐街  进项   白拿   占书屋');
for (const src of CELLS) for (const arm of ARMS) {
  const rs = rows[`${src}|${arm}`];
  console.log(`${`${src}/${arm}`.padEnd(17)} ${show(rs).padEnd(6)}`
    + ` ${pct(rs.filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` ${String(Math.round(mean(rs, 'rents'))).padStart(5)}`
    + ` ${mean(rs, 'fullStreets').toFixed(2).padStart(7)}`
    + ` ${String(Math.round(mean(rs, 'income'))).padStart(6)}`
    + ` ${String(Math.round(mean(rs, 'flatGot'))).padStart(6)}`
    + ` ${pct(rs.filter(r => r.ownsBook).length, n).padStart(7)}`);
}

// 2) 硬断言：两格的钱真的发出去了（否则「对照」是空臂）。
for (const src of ['street', 'flat']) {
  const paid = rows[`${src}|ai`].reduce((s, r) => s + r.income + r.flatGot, 0);
  if (!paid) throw new Error(`${src} 格一分钱都没发 —— 空臂，不许印结论`);
  const other = src === 'street' ? rows[`${src}|ai`].reduce((s, r) => s + r.flatGot, 0)
    : rows[`${src}|ai`].reduce((s, r) => s + r.income, 0);
  if (other) throw new Error(`${src} 格混进了另一种来源的钱（${other}）—— 两格没分开`);
}
const streetPaid = mean(rows['street|ai'], 'income');
console.log(`\n钱确实发出：street 局均 ${Math.round(streetPaid)}（seat0），flat 局均 ${Math.round(mean(rows['flat|ai'], 'flatGot'))}（seat0）`);
console.log(`  ⇒ 两格对 seat0 的注入量相差 ${(100 * (mean(rows['flat|ai'], 'flatGot') / (streetPaid || 1) - 1)).toFixed(0)}%`);

// 3) 核心：整体提升是不是「只有凑齐街才有」
console.log('\n=== 整体提升：street vs flat（都以同一批 seed 的 plain 为基）===');
for (const src of ['street', 'flat']) {
  const a = rows[`${src}|ai`], b = rows['plain|ai'];
  console.log(`  ${src.padEnd(6)} − plain  ${fmtCI(pairedDiff(a, b))}`);
}
console.log(`  street − flat  ${fmtCI(pairedDiff(rows['street|ai'], rows['flat|ai']))}`);

// 4) 核心：两条臂的「符号随起手翻」在两格里是否同样出现
console.log('\n=== 两条臂：只买小店 − 只要书屋 ===');
for (const src of ['street', 'flat']) {
  // flat 格「只买小店」也能白拿钱，那正是要看的：若符号翻转照旧，则翻转与「街」无关。
  const s = rows[`${src}|shops`], b = rows[`${src}|bookOnly`];
  console.log(`  ${src} 小计 ${fmtCI(pairedDiff(s, b))}`);
  for (const sid of STYLES) {
    const g = s.filter(r => r.styleId === sid), h = b.filter(r => r.styleId === sid);
    console.log(`    ${sid.padEnd(6)} ${fmtCI(pairedDiff(g, h))}`);
  }
}

// 5) 三起手差距
console.log('\n=== 三起手差距（照常打）===');
for (const src of CELLS) {
  const rs = rows[`${src}|ai`];
  const w = STYLES.map(s => 100 * rate(rs.filter(r => r.styleId === s)));
  console.log(`  ${src.padEnd(6)} ${w.map(x => x.toFixed(1)).join(' / ')}  差距 ${(Math.max(...w) - Math.min(...w)).toFixed(1)}pp`);
}

// 6) 玩家够不够得着这条路
const st = rows['street|ai'];
console.log('\n=== 凑齐一条街在局里到底发生几次（street 格 / 照常打）===');
console.log(`  终局凑齐 0 条 ${pct(st.filter(r => r.fullStreets === 0).length, n)}`
  + ` · ≥1 条 ${pct(st.filter(r => r.fullStreets >= 1).length, n)}`
  + ` · ≥2 条 ${pct(st.filter(r => r.fullStreets >= 2).length, n)}`
  + ` · 均值 ${mean(st, 'fullStreets').toFixed(2)}`);
console.log(`  拿到进项的局 ${pct(st.filter(r => r.income > 0).length, n)}，局均 ${Math.round(mean(st, 'income'))}`);
