// #3391j：**两种互斥打法**，同一张牌桌，强制 0 号位按计划花钱。
//
// 为什么是这个设计：
//   · supervisor 两次要「一局能亲手体会第二种打法」。之前四种候选（收购补齐 / 挑便宜 /
//     封对手书屋 / 全升级）都更差，所以没有第二种打法。但那些都是「绕着同一块地」。
//   · rent-attribute.mjs（随机指派）已经量清：书屋的价值 28.3pp 里，租金占 20.6pp，
//     剩下 7.8pp 是「所有权本身」。⇒ 想让第二种打法成立，必须给它**一条自己的收租渠道**，
//     而且不能和北边那块同一天、同一个价钱。
//   · 所以场上放第二块高地（南街，4 临街格），**第 9 天开售、13,000**：
//       北 · 街心书屋  第 4 天 26,000  8 格   —— 早、贵、一次押注
//       南 · 南街书库  第 9 天 13,000  4 格   —— 晚、便宜、留得住现金
//   · 两个计划**互斥**（36,000 起手，钱不够两块，且北边第 4 天就要 26,000）：
//       plan N（抢北）：第 4 天凑到钱就买北；之后不再为南边出钱
//       plan S（等南）：从不买北；第 9 天起买南，把钱留给小店加盖
//     于是失败方式不同：N 失败 = 现金枯竭、付不起租；S 失败 = 前半场没有高地收租。
//
// 要回答的只有两件：
//   ① 两个计划各自对「什么都不计划」的相对胜率（是否都 ≥ 不计划）
//   ② 失败方式是否真的分开（破产率、最低现金、被踩时付不付得起）
//
// 用法：node support/probe-3391/two-plans-forced.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buyPrice } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
  120: { grow: 49.2, take: 38.3, cross: 45.0 },
};
const BASELINE = BASELINES[SEEDS * 2];
if (!BASELINE) throw new Error(`没有 n=${SEEDS * 2} 的基线`);
const NORTH = 'market';
const SOUTH = 'market-south';
const SOUTH_CELLS = [{ x: 5, y: 6 }, { x: 6, y: 6 }];

const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

function addSouthCenter(state) {
  state.map.plots.push({ id: SOUTH, cells: SOUTH_CELLS.map(c => ({ ...c })), big: true, street: '南街',
    name: '南街书库', price: 13000, availableFromDay: 9 });
  state.properties[SOUTH] = { ownerId: null, level: 2, street: '南街', big: true,
    bigType: 'bookstore', closed: 0, inflate: 0, price: 13000 };
  state.map.initialProperties.push({ plotId: SOUTH, level: 2, bigType: 'bookstore', price: 13000 });
  let linked = 0;
  for (const node of state.map.nodes) {
    const [nx, ny] = node.id.split(',').map(Number);
    if (!SOUTH_CELLS.some(c => Math.abs(c.x - nx) + Math.abs(c.y - ny) === 1)) continue;
    (node.adjacentPlots ??= []).push(SOUTH);
    linked++;
  }
  if (linked === 0) throw new Error('南街书库没有 frontage');
}

async function play({ style, seed, order, plan, withSouth = true }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (withSouth) addSouthCenter(state);
  const seat0 = state.players[0];
  let decisions = 0, minCash = seat0.cash, boughtN = null, boughtS = null, broke = false;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      minCash = Math.min(minCash, seat0.cash);
      const mine = prompt.player?.id === seat0.id;
      if (prompt.type === 'buy' && mine) {
        const id = prompt.plot?.id ?? prompt.plot;
        const price = prompt.price ?? buyPrice(state, id);
        // 计划 N：第 4 天买北；不为南边出钱
        if (plan === 'north') {
          if (id === NORTH && boughtN === null && seat0.cash >= price) { boughtN = state.day; return true; }
          if (id === NORTH) return false;
          if (id === SOUTH) return false;
          return aiAnswer(prompt, state);
        }
        // 计划 S：从不买北；第 9 天起买南
        if (plan === 'south') {
          if (id === NORTH) return false;
          if (id === SOUTH && boughtS === null && seat0.cash >= price) { boughtS = state.day; return true; }
          if (id === SOUTH) return false;
          return aiAnswer(prompt, state);
        }
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const owns = id => state.properties[id]?.ownerId === seat0.id;
  broke = !seat0.alive;
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: broke, minCash,
    ownsN: owns(NORTH), ownsS: owns(SOUTH),
    boughtN, boughtS,
    rents: seat0.sliceStats.rentEarned,
    paid: seat0.sliceStats.rentPaid ?? 0,
    assets: assetsOf(state, seat0),
  };
}

async function arm(plan) {
  const rows = [];
  for (const style of STYLES) for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, plan }));
  return rows;
}

// 基线必须在**未改动的**原始地图上复现，否则我量的不是产品，是探针。
console.log('基线校验（原始地图，无南街书库）');
{
  let ok = true;
  for (const style of STYLES) {
    const rs = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
      rs.push(await play({ style, seed, order, plan: 'ai', withSouth: false }));
    const p = 100 * rs.filter(r => r.win).length / rs.length;
    const good = Math.abs(p - BASELINE[style]) < 0.05;
    ok &&= good;
    console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${good ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  }
  if (!ok) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }
}

const arms = { ai: await arm('ai'), north: await arm('north'), south: await arm('south') };
console.log(`\n每臂 n=${arms.ai.length}（${SEEDS} seed × 3 起手 × 2 座位排列）；0 号位强制按计划`);
console.log('计划   胜率    破产   垫底   最低现金  收租   付租   买北日  买南日');
for (const [name, rows] of Object.entries(arms)) {
  const n = rows.length;
  const dates = k => { const d = rows.filter(r => r[k] != null).map(r => r[k]); return d.length ? (d.reduce((a, b) => a + b, 0) / d.length).toFixed(1) : '—'; };
  console.log(`${name.padEnd(6)} ${pct(rows.filter(r => r.win).length, n).padEnd(7)}`
    + ` ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` ${String(Math.round(mean(rows, 'minCash'))).padStart(7)}`
    + ` ${String(Math.round(mean(rows, 'rents'))).padStart(5)}`
    + ` ${String(Math.round(mean(rows, 'paid'))).padStart(5)}`
    + `  ${dates('boughtN').padStart(5)}  ${dates('boughtS').padStart(5)}`);
}

const rate = a => arms[a].filter(r => r.win).length / arms[a].length;
const ci = (a, b) => {
  const p1 = rate(a), p2 = rate(b), n1 = arms[a].length, n2 = arms[b].length;
  const d = p1 - p2;
  const se = Math.hypot(Math.sqrt(p1 * (1 - p1) / n1), Math.sqrt(p2 * (1 - p2) / n2));
  return `${(100 * d).toFixed(1)}pp [${(100 * (d - 1.96 * se)).toFixed(1)}, ${(100 * (d + 1.96 * se)).toFixed(1)}]`;
};
console.log('\n=== 两个计划相对「照常打」 ===');
console.log(`  抢北 − 照常 ${ci('north', 'ai')}`);
console.log(`  等南 − 照常 ${ci('south', 'ai')}`);
console.log(`  抢北 − 等南 ${ci('north', 'south')}`);
console.log('\n=== 失败方式是否分开 ===');
for (const name of ['north', 'south']) {
  const rows = arms[name];
  const lost = rows.filter(r => !r.win);
  console.log(`  ${name.padEnd(6)} 输的局：破产 ${pct(lost.filter(r => r.bankrupt).length, lost.length)}`
    + ` 最低现金 ${Math.round(mean(lost, 'minCash'))} 付租 ${Math.round(mean(lost, 'paid'))}`);
}
