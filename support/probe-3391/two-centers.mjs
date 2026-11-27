// #3391d（修正版）：把「一次抽签」变成「两处高地」—— 唯一还没被真正试过的结构方向。
//
// 上一版（support/probe-3346/two-centers.mjs）失败的两个真原因，不是一个：
//   ① 它改的是 `SLICE_MAP` 单例，而 createGame 用 structuredClone 复制地图（game.js:29）
//      ⇒ 对已开局的一局毫无影响。
//   ② 即使改 state.map，它把 plot.cells 的**网格坐标**与 node.x/node.y 的**像素坐标**相比
//      （makeMap 里 node.x = x*cell），所以永远不相邻 ⇒ 第二处高地 frontage = 0。
// 这一版：在 state 上动手（per-game map），用网格坐标比较，并把「新增地块确实有 frontage」
// 作为硬断言 —— 上一版正是没有这条断言，才把「从未被买到」印成「两处高地没用」。
//
// 坐标依据（src/data/slice.js makeMap）：路面格 x∈{2..10} 的 y=2/5/8、x=2/10 的 y=2..8、
// 内圈 x=4/7 的 y=2..5。街心书屋占 (5,3)(6,3)(5,4)(6,4)。
// 地图 13×11，y→10−y 是镜像 ⇒ 南侧对称的 2×2 空地正是 (5,6)(6,6)(5,7)(6,7)。
//
// 要回答的问题（不是「胜率更高吗」，而是「还是一次抽签吗」）：
//   · 条件胜率：占 0 / 1 / 2 处高地各自的胜率，是否还像单高地那样 80–100% vs 3–5%
//   · 三起手差距是否还在可接受范围（基线三格必须复现，否则不印）
//   · 失败方式是否分开（破产率、最低现金）
//
// 用法：node support/probe-3391/two-centers.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
  120: { grow: 49.2, take: 38.3, cross: 45.0 },
};
const BASELINE = BASELINES[SEEDS * 2];
if (!BASELINE) throw new Error(`没有 n=${SEEDS * 2} 的基线`);

const BOOK = 'market';
const BOOK2 = 'market-south';
const SOUTH_CELLS = [{ x: 5, y: 6 }, { x: 6, y: 6 }, { x: 5, y: 7 }, { x: 6, y: 7 }];

const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

// 只动这一局自己的 state.map（createGame 已 clone 过），邻接按**网格坐标**重算。
function addSouthCenter(state) {
  if (state.map.plots.some(p => p.id === BOOK2)) return;
  state.map.plots.push({
    id: BOOK2, cells: SOUTH_CELLS.map(c => ({ ...c })), street: '南街', big: true,
    name: '南街书库', price: 26000, availableFromDay: 4,
  });
  state.properties[BOOK2] = {
    ownerId: null, level: 2, street: '南街', big: true, bigType: 'bookstore',
    closed: 0, inflate: 0, price: 26000,
  };
  state.map.initialProperties.push({ plotId: BOOK2, level: 2, bigType: 'bookstore', price: 26000 });

  let linked = 0;
  for (const node of state.map.nodes) {
    const [nx, ny] = node.id.split(',').map(Number);   // 网格坐标，不是 node.x（像素）
    const near = SOUTH_CELLS.some(c => Math.abs(c.x - nx) + Math.abs(c.y - ny) === 1);
    if (!near) continue;
    node.adjacentPlots ??= [];
    if (!node.adjacentPlots.includes(BOOK2)) node.adjacentPlots.push(BOOK2);
    linked++;
  }
  if (linked === 0) throw new Error('第二处高地没有 frontage —— 探针本身坏了，别印数');
}

async function play({ style, seed, order, twoCenters }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (twoCenters) addSouthCenter(state);
  const seat0 = state.players[0];
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0, minCash = seat0.cash;

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      minCash = Math.min(minCash, seat0.cash);
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const bigs = state.map.plots.filter(p => p.big);
  const mine = bigs.filter(p => state.properties[p.id]?.ownerId === seat0.id).length;
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    bigsMine: mine,
    rentEarned: seat0.sliceStats.rentEarned,
    minCash,
    assets: assetsOf(state, seat0),
  };
}

async function runArm(style, twoCenters) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, twoCenters }));
  return rows;
}

console.log(`基线校验（n=${SEEDS * 2}/格，争街，单高地）`);
const base = {};
for (const style of STYLES) {
  const rows = await runArm(style, false);
  base[style] = rows;
  const p = 100 * rows.filter(r => r.win).length / rows.length;
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
}

console.log('\n===== 场上两处高地（街心书屋 + 南街书库，镜像 2×2）=====');
const two = {};
for (const style of STYLES) {
  const rows = await runArm(style, true);
  two[style] = rows;
  const n = rows.length;
  const seats = [0, 1, 2].map(k => rows.filter(r => r.bigsMine === k));
  const b = base[style];
  console.log(`  ${style.padEnd(6)} 基础 ${pct(b.filter(r => r.win).length, b.length).padEnd(7)}`
    + ` → 两高地 ${pct(rows.filter(r => r.win).length, n).padEnd(7)}`
    + ` 破产 ${pct(b.filter(r => r.bankrupt).length, b.length)} → ${pct(rows.filter(r => r.bankrupt).length, n)}`);
  console.log(`         占 0 处 n=${String(seats[0].length).padStart(3)} 胜 ${pct(seats[0].filter(r => r.win).length, seats[0].length).padEnd(6)}`
    + ` 占 1 处 n=${String(seats[1].length).padStart(3)} 胜 ${pct(seats[1].filter(r => r.win).length, seats[1].length).padEnd(6)}`
    + ` 占 2 处 n=${String(seats[2].length).padStart(3)} 胜 ${pct(seats[2].filter(r => r.win).length, seats[2].length)}`);
  console.log(`         收租 ${String(Math.round(mean(rows, 'rentEarned'))).padStart(5)}`
    + ` 最低现金 ${String(Math.round(mean(rows, 'minCash'))).padStart(6)}`
    + ` 终局资产 ${Math.round(mean(rows, 'assets'))}`);
}
