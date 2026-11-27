// #3391t（第二支）：进项到底发给了谁。
//
// income-control.mjs 已经排除「只是钱变多」：同样注入约 12,000，等额白给只 +0.6pp，
// 而「凑齐街才发」是 +17.8pp，且只有后者让「小店路 − 书屋路」的符号随起手翻。好消息是
// 这条规则确实在奖励某个**行为**。但还有一个更朴素的解释没排除：
//
//   争街发牌里，0 号位（= 真实入口里人类坐的那张椅子）拿的两间店，另一半都是**无主空地**
//   （#3346b 已证：4,1 与 8,9 都没人要，8,000 按标价买即可）；
//   而 1、2 号位的另一半**互为对方**，只能走收购卡，而收购实测是负期望、AI 从不选。
//   ⇒ 只有 0 号位能真的「凑齐一条街」。
//
// 若如此，这条规则对局中另外两家的进项应当接近 0，那 +17.8pp 就不是「第二条路子」，
// 而是「给人类座位的一份结构性红利」—— 与第一屏「三条打算」的说法不是一回事。
//
// 本探针同时量两张发牌表：
//   contested（产品默认）：每人各拿两条街的一半
//   whole（?cross=0 的旧表）：每人开局就占满自己那条街 —— 三家从第 1 天起都合格，对称。
//
// 判据：
//   ① 争街下 0 号位的进项 >> 1/2 号位 ⇒ 规则效果主要来自座位结构；
//   ② 整条街表下三家进项接近 ⇒ 规则本身是对称的，问题在发牌。
//   ③ 若整条街表上「符号随起手翻」仍在，说明翻转来自起手自己的牌，不是座位红利。
//
// 用法：node support/probe-3391/income-by-seat.mjs [30] [250]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assertUnique, keyOf, pairedDiff, fmtCI } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 30);
const PER_SHOP = Number(process.argv[3] ?? 250);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
  120: { grow: 49.2, take: 38.3, cross: 45.0 },
};
const BASELINE = BASELINES[SEEDS * 2];
if (!BASELINE) throw new Error(`没有 n=${SEEDS * 2} 的基线（用 30 或 60 个 seed）`);

const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = xs => (xs.length ? xs.reduce((s, r) => s + (r.win ? 1 : 0), 0) / xs.length : 0);
const show = rows => pct(rate(rows) * rows.length, rows.length);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

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

// 一位玩家完整拥有几条街（全部小店归己、都开张、没被停业）。
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

async function play({ style, seed, order, arm, table, withIncome }) {
  const config = createSliceConfig({
    human: false, seed, style,
    // contested 表是产品默认；whole 是 ?cross=0 的旧表。
    sliceContestedStreets: table === 'contested',
  });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  state.config.streetBusinessPerShop = withIncome ? PER_SHOP : 0;
  const seat0 = state.players[0];
  let decisions = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === seat0.id;
      if (prompt.type === 'buy' && mine) {
        const id = prompt.plot?.id ?? prompt.plot;
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
  const winnerId = state.players.find(p => p.team === state.winnerTeam)?.id ?? null;
  // 三家都记 —— 这一支的全部意义就是「谁拿到钱」。
  const seats = state.players.map((p, i) => ({
    i, style: p.style,
    income: p.sliceStats?.business ?? 0,
    full: fullStreets(state, p),
    win: p.id === winnerId ? 1 : 0,
    cash: p.cash,
  }));
  return {
    style: `${style}|${order.join('>')}`, styleId: style, seed, order: order.join('>'),
    win: state.players[0].id === winnerId ? 1 : 0,
    seats, income0: seats[0].income,
    incomeAi: (seats[1].income + seats[2].income) / 2,
    full0: seats[0].full, fullAi: (seats[1].full + seats[2].full) / 2,
  };
}

async function run({ arm, table, withIncome }) {
  const rows = [];
  for (const style of STYLES) for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, arm, table, withIncome }));
  return rows;
}

// 基线：两表的「无进项·照常打」都必须复现已知数，否则不印该表后面的东西。
// 基线按真实局数取：SEEDS=30 ⇒ n=180；SEEDS=60 ⇒ n=360。
// 我第一次把 48.3/41.7/48.3 硬写给所有 n，n=360 时 grow 读到 49.2 ⇒ 门当场判红（这是它该做的）。
//
// #3424（复核抓到）：下面那个 `KNOWN.contested` 曾经**不存在** —— KNOWN 是「一条基线」,
// 而下面按 `KNOWN.contested[style]` 取值，于是这份交付出去的探针**一跑就抛**。
// 修复不是把它改成 `KNOWN[style]` 了事，而是把名字写清楚：基线本来就是「争街表 · 无进项」
// 这一格的，所以键名就叫 BASELINE_CONTESTED，取值处一眼能看出量的是哪张表。
const BASELINE_CONTESTED = {
  180: { grow: 48.3, take: 41.7, cross: 48.3 },
  360: { grow: 49.2, take: 38.3, cross: 45.0 },
}[SEEDS * 6];
if (!BASELINE_CONTESTED) throw new Error(`没有 n=${SEEDS * 6} 的基线`);
console.log('基线校验（争街 / 无进项 / 照常打）');
for (const style of STYLES) {
  const rs = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rs.push(await play({ style, seed, order, arm: 'ai', table: 'contested', withIncome: false }));
  const p = 100 * rate(rs);
  const ok = Math.abs(p - BASELINE_CONTESTED[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE_CONTESTED[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }
}

const rows = {};
for (const table of ['contested', 'whole'])
  for (const [arm, withIncome] of [['ai', false], ['ai', true], ['shops', true], ['bookOnly', true]]) {
    const k = `${table}|${arm}|${withIncome ? 'inc' : 'plain'}`;
    rows[k] = await run({ arm, table, withIncome });
    assertUnique(rows[k], k);
  }
const n = rows['contested|ai|plain'].length;

// 硬断言：进项确实发出，且两张表都发了（否则「对比两表」是空读数）。
for (const table of ['contested', 'whole']) {
  const paid = rows[`${table}|ai|inc`].reduce((s, r) => s + r.income0 + r.incomeAi, 0);
  if (!paid) throw new Error(`${table} 表的进项一次都没发 —— 空臂`);
  const plainPaid = rows[`${table}|ai|plain`].reduce((s, r) => s + r.income0 + r.incomeAi, 0);
  if (plainPaid) throw new Error(`${table} 表的 plain 格也有进项（${plainPaid}）—— 两格没分开`);
}

console.log(`\n每格 n=${n}；每店每天 ${PER_SHOP}。0 号位 = 真实入口里人类坐的椅子。`);
console.log('表/臂              0 号位进项  两位 AI 进项   0 号位凑齐街  AI 凑齐街  0 号位胜率');
for (const table of ['contested', 'whole']) for (const [arm, inc] of [['ai', 'plain'], ['ai', 'inc'], ['shops', 'inc'], ['bookOnly', 'inc']]) {
  const rs = rows[`${table}|${arm}|${inc}`];
  console.log(`${`${table}/${arm}/${inc}`.padEnd(24)}`
    + ` ${String(Math.round(mean(rs.map(r => r.income0)))).padStart(9)}`
    + ` ${String(Math.round(mean(rs.map(r => r.incomeAi)))).padStart(11)}`
    + ` ${mean(rs.map(r => r.full0)).toFixed(2).padStart(12)}`
    + ` ${mean(rs.map(r => r.fullAi)).toFixed(2).padStart(10)}`
    + ` ${show(rs).padStart(10)}`);
}

// ① 争街：0 号位 vs AI 的进项比
console.log('\n=== ① 进项是不是只发给了 0 号位 ===');
for (const table of ['contested', 'whole']) {
  const rs = rows[`${table}|ai|inc`];
  const a = mean(rs.map(r => r.income0)), b = mean(rs.map(r => r.incomeAi));
  console.log(`  ${table.padEnd(10)} 0 号位 ${Math.round(a)} vs AI ${Math.round(b)}`
    + `  ⇒ ${b ? (a / b).toFixed(2) + '×' : 'AI 为 0'}`);
}
console.log('  （对照：无进项格两列都应为 0，上面表已印）');

// ② 三起手差距：两表 × 有/无进项
console.log('\n=== ② 三起手差距（照常打）===');
for (const table of ['contested', 'whole']) for (const inc of ['plain', 'inc']) {
  const rs = rows[`${table}|ai|${inc}`];
  const w = STYLES.map(s => 100 * rate(rs.filter(r => r.styleId === s)));
  console.log(`  ${`${table}/${inc}`.padEnd(18)} ${w.map(x => x.toFixed(1)).join(' / ')}`
    + `  差距 ${(Math.max(...w) - Math.min(...w)).toFixed(1)}pp`);
}

// ③ 「小店路 − 书屋路」的符号：两表各自
console.log('\n=== ③ 只买小店 − 只要书屋（同局配对）===');
for (const table of ['contested', 'whole']) {
  const s = rows[`${table}|shops|inc`], b = rows[`${table}|bookOnly|inc`];
  console.log(`  ${table} 小计 ${fmtCI(pairedDiff(s, b))}`);
  for (const sid of STYLES) {
    const g = s.filter(r => r.styleId === sid), h = b.filter(r => r.styleId === sid);
    console.log(`    ${sid.padEnd(6)} ${fmtCI(pairedDiff(g, h))}`);
  }
}

// ④ 整条街表：进项对「照常打」的整体影响
console.log('\n=== ④ 进项整体影响（各表 vs 同表 plain）===');
for (const table of ['contested', 'whole']) {
  console.log(`  ${table.padEnd(10)} ${fmtCI(pairedDiff(rows[`${table}|ai|inc`], rows[`${table}|ai|plain`]))}`);
}
