// #3391u：给首屏挑一个可试玩的配置 —— 用**人类真坐的那张椅子**的读数来挑。
//
// 为什么单独一支
// -------------
// deal-sweep.mjs 印的是「三把椅子轮换平均」，那是判断**公平性**的口径；
// 但玩家坐的是 0 号椅，他体感到的是 0 号椅那一格。两个口径必须分开印，
// 否则会拿「轮换平均收窄了差距」去替一个玩家其实打得更差的首屏选项背书。
//
// 候选（发牌表 × 营业进项档），全部只写 0 号椅的读数：
//   contested/0     今天的产品（对照）
//   free/0          对称发牌，无进项
//   free/250        对称发牌 + 首屏已有的 250 档
//   free/350        对称发牌 + 上一档
//   whole/0         旧发牌表（?cross=0）
//
// 判据：先复现 contested/0 的 53.7 / 36.3 / 44.3；其余格全部用同一批 seed、同一套 AI。
//
// 用法：node support/probe-3391/seat0-candidates.mjs [150]
import { SLICE_STYLES, SLICE_MAP, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';
import { assertUnique } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 150);
if (SEEDS !== 150) throw new Error('基线是 150 seed（300 局/格）；换样本量就没有可比基线');
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const KNOWN = { grow: 53.7, take: 36.3, cross: 44.3 };

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = rows => (rows.length ? rows.filter(r => r.win).length / rows.length : 0);
const pct = x => `${(100 * x).toFixed(1)}%`;

const STREETS = ['晨光街', '晚风街', '灯火街', '月色街', '西巷', '东巷'];
const plotsOf = s => SLICE_MAP.plots.filter(p => !p.big && p.street === s).map(p => p.id);
if (STREETS.some(s => plotsOf(s).length !== 2)) throw new Error('街道不都是两间 —— 前提不成立');
const DEAL_FREE = [0, 1, 2].map(i => [plotsOf(STREETS[i])[0], plotsOf(STREETS[(i + 3) % 6])[1]]);

function applyDeal(state, table) {
  if (table !== 'free') return;
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

async function play({ style, seed, order, table, opening, perShop }) {
  const sliced = opening === 'contested';
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: sliced });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (state.players.map(p => p.style).join(',') !== [style, ...order].join(',')) {
    throw new Error('SEATING MISMATCH');
  }
  // free 与 contested/whole 都从**各自的**发牌表出发，再按需改写。
  applyDeal(state, table);
  state.config.streetBusinessPerShop = perShop;
  const me = state.players[0];
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
    // 键必须带对手排列：同一 (style, seed) 会跑两种排列。这是本仓库反复踩的那一类错
    // （stats.assertUnique 抓过四次），所以把「键包含什么」写在这里，而不是靠记性。
    style: `${style}|${order.join('>')}`, styleId: style, seed, order: order.join('>'),
    table, opening, perShop,
    win: me.id === winnerId ? 1 : 0,
    bankrupt: me.alive ? 0 : 1,
    assets: assetsOf(state, me),
    income: me.sliceStats?.business ?? 0,
    held: me.properties.filter(id => !['5,3', '6,3', '5,4', '6,4'].includes(id)).length,
  };
}

const CELLS = [
  { table: 'contested', opening: 'contested', perShop: 0, label: 'contested/0（今天）' },
  { table: 'whole', opening: 'whole', perShop: 0, label: 'whole/0（?cross=0）' },
  { table: 'free', opening: 'contested', perShop: 0, label: 'free/0' },
  { table: 'free', opening: 'contested', perShop: 250, label: 'free/250' },
  { table: 'free', opening: 'contested', perShop: 350, label: 'free/350' },
];

// 基线
console.log('基线校验（contested / 0 / 0 号位，对照 balance-3391-300.json）');
let bad = false;
const base = [];
for (const style of STYLES) for (const ord of ordersFor(style)) for (let seed = 1; seed <= SEEDS; seed++)
  base.push(await play({ style, seed, order: ord, table: 'contested', opening: 'contested', perShop: 0 }));
assertUnique(base, 'base');
for (const s of STYLES) {
  const got = 100 * rate(base.filter(r => r.styleId === s));
  const ok = Math.abs(got - KNOWN[s]) < 0.05;
  console.log(`  ${s.padEnd(6)} ${got.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${KNOWN[s]}%`}`);
  if (!ok) bad = true;
}
if (bad) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }

console.log('\n=== 0 号椅（= 真实入口里人类坐的位置）的读数 ===');
console.log('配置                  grow   take  cross  起手差距  破产    均终局资产  进项');
for (const cell of CELLS) {
  const rs = cell.table === 'contested' && cell.perShop === 0 ? base : [];
  if (!rs.length) {
    for (const style of STYLES) for (const ord of ordersFor(style)) for (let seed = 1; seed <= SEEDS; seed++)
      rs.push(await play({ style, seed, order: ord, ...cell }));
    assertUnique(rs, cell.label);
  }
  const w = STYLES.map(s => 100 * rate(rs.filter(r => r.styleId === s)));
  console.log(`${cell.label.padEnd(20)} ${w.map(x => x.toFixed(1)).join('  ')}`
    + `  ${(Math.max(...w) - Math.min(...w)).toFixed(1).padStart(6)}pp`
    + ` ${pct(mean(rs.map(r => r.bankrupt))).padStart(6)}`
    + ` ${Math.round(mean(rs.map(r => r.assets))).toString().padStart(9)}`
    + ` ${Math.round(mean(rs.map(r => r.income))).toString().padStart(6)}`);
}
