// #3391u：首屏那个「营业进项 250」档，量级到底定下来了没有。
//
// 为什么这一支要存在
// ----------------
// #3391s/#3391t 把「整条街营业进项」做成了第一屏上的一个单选（无进项 / 250），
// 默认关闭。可它一直是**没量过分档**的状态：RESULT 3d 量的是探针里的 200 / 350 两档，
// 而产品上留给玩家的那档是 **250**，没有任何一张入库的表能回答
// 「玩家勾了 250 之后，三条起手变成什么样、差距变宽多少、钱发给了谁」。
// supervisor 这一轮要的是「可公开的试玩版 + 仍未定的平衡边界」——
// 那么这个数就必须是量出来的，而不是「200 到 350 之间大概在中间」。
//
// 它量什么
// --------
// 真入口同样的路径：createSliceConfig → startSession → runGame + aiAnswer。
// 三种起手 × 两种对手座位排列 × 150 seed，两张发牌表（争街 = 默认 / 整条街 = ?cross=0），
// 两档规则（0 = 正式规则 / 250 = 首屏可选档）。每格 300 局。
//
// 一并记「进项发给了谁」：这一片已经证明（income-by-seat.mjs）在争街表下
// 只有 0 号位能真的凑齐一条街，所以进项主要发给人类那椅子。若 250 档的收益
// 大部分来自这个座位结构，那它不是一条新路子，只是给 0 号位加钱 —— 必须一起印出来。
//
// 判据（不满足就不印结论）
//   ① 每张表、每档的「无进项」基线必须复现已知数（否则量具或引擎漂了）；
//   ② 250 档必须真的发钱（总额 > 0），否则是空臂；
//   ③ 同一 (table, style, seed, order) 不许出现两次（stats.assertUnique）。
//
// 用法：node support/probe-3391/business-tier.mjs [150]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';
import { assertUnique, pairedDiff, fmtCI } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 150);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const PER_SHOP = 250;

// 入库的基线（docs/evidence/balance-3391-300.json = 争街，balance-3342-300.json = 整条街）。
// 这两张表都是 300 局/格；换 seed 数就没有可比基线，直接拒绝跑。
const KNOWN = {
  contested: { grow: 53.7, take: 36.3, cross: 44.3 },
  whole: { grow: 45.7, take: 32.0, cross: 34.7 },
};
if (SEEDS !== 150) throw new Error('这两张基线都是 150 seed（300 局/格）；其它样本量没有基线可核');

const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = rows => (rows.length ? rows.filter(r => r.win).length / rows.length : 0);
const spread = rows => {
  const w = STYLES.map(s => 100 * rate(rows.filter(r => r.styleId === s)));
  return { w, pp: Math.max(...w) - Math.min(...w) };
};
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

async function play({ style, seed, order, table, perShop }) {
  const config = createSliceConfig({
    human: false, seed, style,
    sliceContestedStreets: table === 'contested',
  });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  // 与第一屏勾 250 后入口做的事一致：只设 config 这一个数。
  state.config.streetBusinessPerShop = perShop;
  const seat0 = state.players[0];
  let decisions = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const winnerId = state.players.find(p => p.team === state.winnerTeam)?.id ?? null;
  const seats = state.players.map((p, i) => ({
    i, style: p.style,
    income: p.sliceStats?.business ?? 0,
    win: p.id === winnerId ? 1 : 0,
  }));
  return {
    // keyOf()（stats.mjs）按 `style` 取键。同一个 seed 会跑两种对手座位排列，
    // 所以键里必须带上排列，否则两种排列会被当成「同一局印了两遍」。这和
    // income-by-seat.mjs 的做法一致；styleId 单独留着给按起手拆分用。
    style: `${style}|${order.join('>')}`, styleId: style, seed, order: order.join('>'), table, perShop,
    win: seat0.id === winnerId ? 1 : 0,
    bankrupt: seat0.alive ? 0 : 1,
    assets: assetsOf(state, seat0),
    income0: seats[0].income,
    incomeAi: (seats[1].income + seats[2].income) / 2,
  };
}

async function run(table, perShop) {
  const rows = [];
  for (const style of STYLES) for (const order of opponentOrders(style))
    for (let seed = 1; seed <= SEEDS; seed++)
      rows.push(await play({ style, seed, order, table, perShop }));
  assertUnique(rows, `${table}|${perShop}`);
  return rows;
}

const rows = {};
for (const table of ['contested', 'whole']) for (const perShop of [0, PER_SHOP])
  rows[`${table}|${perShop}`] = await run(table, perShop);

// ① 基线：两表、两档的「无进项」都必须复现入库的表。250 档没有入库表可核，
//    所以它只能与同一量具量出的同表 0 档比 —— 这正是它该被读的方式。
console.log('基线校验（无进项 = 入库的那两张表）');
let bad = false;
for (const table of ['contested', 'whole']) {
  const rs = rows[`${table}|0`];
  const got = Object.fromEntries(STYLES.map(s => [s, 100 * rate(rs.filter(r => r.styleId === s))]));
  for (const s of STYLES) {
    const ok = Math.abs(got[s] - KNOWN[table][s]) < 0.05;
    console.log(`  ${`${table}/${s}`.padEnd(18)} ${got[s].toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${KNOWN[table][s]}%`}`);
    if (!ok) bad = true;
  }
}
if (bad) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }

// ② 250 档必须真的发钱。
for (const table of ['contested', 'whole']) {
  const rs = rows[`${table}|${PER_SHOP}`];
  const paid = rs.reduce((s, r) => s + r.income0 + 2 * r.incomeAi, 0);
  if (!paid) throw new Error(`${table} 的 250 档一分钱都没发 —— 空臂，不能当读数`);
  const plainPaid = rows[`${table}|0`].reduce((s, r) => s + r.income0 + 2 * r.incomeAi, 0);
  if (plainPaid) throw new Error(`${table} 的 0 档也发了钱（${plainPaid}）—— 两档没分开`);
}

const n = rows['contested|0'].length;
console.log(`\n每格 n=${n}；营业进项档 = 每店每天 ${PER_SHOP}（首屏可选的那一档）。`);

console.log('\n=== ① 两档 × 两表：三起手胜率、差距、破产 ===');
console.log('表/档             grow    take   cross   差距    破产(g/t/c)   均终局资产');
for (const table of ['contested', 'whole']) for (const perShop of [0, PER_SHOP]) {
  const rs = rows[`${table}|${perShop}`];
  const { w, pp } = spread(rs);
  const bk = STYLES.map(s => `${(100 * mean(rs.filter(r => r.styleId === s).map(r => r.bankrupt))).toFixed(1)}%`);
  const assets = Math.round(mean(rs.map(r => r.assets)));
  console.log(`${`${table}/${perShop}`.padEnd(16)} ${w.map(x => x.toFixed(1)).join('  ')}`
    + `  ${pp.toFixed(1).padStart(6)}pp  ${bk.join(' / ').padEnd(16)} ${assets}`);
}

console.log('\n=== ② 250 档相对正式规则（同 seed 配对，n=' + n + '/表）===');
for (const table of ['contested', 'whole']) {
  const a = rows[`${table}|${PER_SHOP}`], b = rows[`${table}|0`];
  console.log(`  ${table.padEnd(10)} ${fmtCI(pairedDiff(a, b))}`);
  for (const s of STYLES) {
    const g = a.filter(r => r.styleId === s), h = b.filter(r => r.styleId === s);
    console.log(`    ${s.padEnd(6)} ${fmtCI(pairedDiff(g, h))}`);
  }
}

console.log('\n=== ③ 钱发给了谁（每局均值）===');
console.log('表         0 号位进项   两位 AI 进项   比值');
for (const table of ['contested', 'whole']) {
  const rs = rows[`${table}|${PER_SHOP}`];
  const a = mean(rs.map(r => r.income0)), b = mean(rs.map(r => r.incomeAi));
  console.log(`  ${table.padEnd(10)} ${Math.round(a).toString().padStart(9)} ${Math.round(b).toString().padStart(13)}`
    + `   ${b ? (a / b).toFixed(2) + '×' : 'AI 为 0'}`);
}
console.log('  （争街表下 0 号位那条比值远大于 1，就说明 250 档的收益主要来自发牌座位，不是一条新路子。）');
