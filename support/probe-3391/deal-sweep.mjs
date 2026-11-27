// #3391u：对称发牌 × 营业进项档位的扫描 —— 为了挑出一个「可试玩」的组合，
// 而不是把探针里最顺手的那一格直接推到首屏。
//
// 已经有三个读数把问题定住了（symmetric-deal.mjs / two-routes.mjs / business-tier.mjs）：
//   · 现状争街表：三家椅子本身的胜率差 51.3pp（同一臂、同一批起手，只换椅子），
//     营业进项 250 只发给了 0 号位（3.97×），另外两张椅子各 −9pp ⇒ 那是座位红利。
//   · 对称表（free）：椅子差 21.4pp，进项比值 1.48× ⇒ 座位红利基本消失。
//   · 但 free 表在**无进项**时三起手差距 34.7pp（现状 17.3pp）—— 直接发就是更差的一版。
//   · free + 250 时三起手 46.7 / 37.0 / 46.7（9.7pp），三个人对进项的读数都在 ±2.5pp 内。
//
// 也就是说：**座位对称与起手平衡在这一局里是同一根绳上的两端**，而进项档位是那根绳的松紧。
// 这一支把档位扫开，看有没有一个既能保持座位对称、又不把起手差距拉宽的档位。
//
// 判据
//   ① 基线：contested / 0 档 / 0 号位 复现 53.7 / 36.3 / 44.3；
//   ② 每格都要印「三起手差距」与「三把椅子差距」两条，缺一条就不能判断；
//   ③ 同一 (table, perShop, style, seed, rot, order) 只许一条。
//
// 用法：node support/probe-3391/deal-sweep.mjs [150]
import { SLICE_STYLES, SLICE_MAP, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';
import { assertUnique } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 150);
if (SEEDS !== 150) throw new Error('基线是 150 seed（300 局/格）；换样本量就没有可比基线');
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const KNOWN_CONTESTED = { grow: 53.7, take: 36.3, cross: 44.3 };
const LEVELS = [0, 150, 250, 350];

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = rows => (rows.length ? rows.filter(r => r.win).length / rows.length : 0);
const pct = x => `${(100 * x).toFixed(1)}%`;

const STREETS = ['晨光街', '晚风街', '灯火街', '月色街', '西巷', '东巷'];
const plotsOf = s => SLICE_MAP.plots.filter(p => !p.big && p.street === s).map(p => p.id);
if (STREETS.some(s => plotsOf(s).length !== 2)) throw new Error('街道不都是两间 —— 前提不成立');
// free：每家拿「第 i 条街的第 0 间」+「第 i+3 条街的第 1 间」，两间的另一半都是无主空地。
const DEAL_FREE = [0, 1, 2].map(i => [plotsOf(STREETS[i])[0], plotsOf(STREETS[(i + 3) % 6])[1]]);

function applyDeal(state, table) {
  if (table === 'contested') return;
  if (table !== 'free') throw new Error(`unknown table ${table}`);
  for (const pl of state.map.plots) state.properties[pl.id].ownerId = null;
  for (const p of state.players) p.properties = [];
  DEAL_FREE.forEach((ids, i) => {
    const p = state.players[i];
    for (const id of ids) { state.properties[id].ownerId = p.id; p.properties.push(id); }
  });
}

const ordersFor = id => {
  const others = STYLES.filter(s => s !== id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

async function play({ style, seed, order, table, rot, perShop }) {
  const others = order;
  const arranged = [];
  let k = 0;
  for (let i = 0; i < 3; i++) arranged.push(i === rot ? style : others[k++]);
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: table === 'contested' });
  config.participants = arranged.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (state.players.map(p => p.style).join(',') !== arranged.join(',')) {
    throw new Error(`SEATING MISMATCH ${state.players.map(p => p.style).join(',')} != ${arranged.join(',')}`);
  }
  applyDeal(state, table);
  state.config.streetBusinessPerShop = perShop;
  const me = state.players[rot];
  if (me.style !== style) throw new Error(`被量座位不是 ${style}`);
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
  return {
    // 键里必须带轮换位：同 (style,seed) 会坐在 3 张椅子上，这 3 条是三个不同观测。
    style: `${style}|${order.join('>')}|${rot}`, styleId: style, seed, order: order.join('>'),
    table, rot, perShop,
    win: me.id === winnerId ? 1 : 0,
    bankrupt: me.alive ? 0 : 1,
    assets: assetsOf(state, me),
    income: me.sliceStats?.business ?? 0,
  };
}

// ① 基线
console.log('基线校验（争街 / 0 档 / 0 号位，对照 balance-3391-300.json）');
let bad = false;
for (const s of STYLES) {
  const rs = [];
  for (const ord of ordersFor(s)) for (let seed = 1; seed <= SEEDS; seed++)
    rs.push(await play({ style: s, seed, order: ord, table: 'contested', rot: 0, perShop: 0 }));
  const got = 100 * rate(rs);
  const ok = Math.abs(got - KNOWN_CONTESTED[s]) < 0.05;
  console.log(`  ${s.padEnd(6)} ${got.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${KNOWN_CONTESTED[s]}%`}`);
  if (!ok) bad = true;
}
if (bad) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }

const rows = {};
for (const table of ['contested', 'free']) for (const perShop of LEVELS) {
  const rs = [];
  for (const style of STYLES) for (const ord of ordersFor(style)) for (const rot of [0, 1, 2])
    for (let seed = 1; seed <= SEEDS; seed++) rs.push(await play({ style, seed, order: ord, table, rot, perShop }));
  assertUnique(rs, `${table}|${perShop}`);
  rows[`${table}|${perShop}`] = rs;
}

const n = rows['contested|0'].length;
console.log(`\n每格 n=${n}（150 seed × 2 座位排列 × 3 个座位轮换 × 3 起手）。`);
console.log('\n表/档            grow   take  cross  起手差距  椅子最大差  进项(0号/其他)');
for (const table of ['contested', 'free']) for (const perShop of LEVELS) {
  const rs = rows[`${table}|${perShop}`];
  const w = STYLES.map(s => 100 * rate(rs.filter(r => r.styleId === s)));
  const styleGap = Math.max(...w) - Math.min(...w);
  // 椅子差：同一批局里，被量座位坐在 0/1/2 号椅子时的胜率极差。
  const seats = [0, 1, 2].map(rot => 100 * rate(rs.filter(r => r.rot === rot)));
  const seatGap = Math.max(...seats) - Math.min(...seats);
  const inc0 = Math.round(mean(rs.filter(r => r.rot === 0).map(r => r.income)));
  const incOther = Math.round(mean(rs.filter(r => r.rot !== 0).map(r => r.income)));
  console.log(`${`${table}/${perShop}`.padEnd(15)} ${w.map(x => x.toFixed(1)).join('  ')}`
    + `  ${styleGap.toFixed(1).padStart(7)}pp  ${seatGap.toFixed(1).padStart(9)}pp`
    + `  ${String(inc0).padStart(6)}/${String(incOther).padEnd(6)}`);
}

console.log('\n=== 破产率（同一批局，按档） ===');
for (const table of ['contested', 'free']) {
  console.log(`  ${table.padEnd(10)} ` + LEVELS.map(l => `${l}:${pct(mean(rows[`${table}|${l}`].map(r => r.bankrupt)))}`).join('  '));
}
console.log('\n（读法：起手差距与椅子差必须一起看。只收窄其中一条 = 把不公平挪了个地方。）');
