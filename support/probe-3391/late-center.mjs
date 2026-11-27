// #3391g：「第二处高地」的取舍版本 —— 早、贵、独占 vs 晚、便宜、留钱。
//
// 上一支（split-bookhouse.mjs）把书屋拆成两半，结果：
//   · 条件胜率从「二元」变成**梯度**（占 0 块 0–42%、占 1 块 25–76%、占 2 块 74–100%）
//   · 两人各持一半真的会发生（59–72%）
//   · **但三起手差距从 10.8pp 涨到 37.5pp** ⇒ 照这样不能发布
//
// 这一支换一个更像「计划」的形状：南街再放一处**同样的 8 格难度的地块**是做不到的（地图几何不允许），
// 所以放一处 4 临街格的小高地，但让它**第 9 天才开售、且更便宜**。
// 于是场上有两个时间上错开的决定：
//   北 · 街心书屋  第 4 天 26,000  8 临街格  —— 早、贵、抢
//   南 · 南街书库  第 9 天 X       4 临街格  —— 晚、便宜、可以等
// 这构成真正的取舍：抢北边会把现金抽干（这就是它现在唯一的失败方式），
// 而「等到第 9 天买南边」要放弃北边的租金窗口，但能留下现金升级小店。
//
// 要回答：
//   ① 三起手差距是否**收窄**（若还更宽，就不是产品化的方向）
//   ② 南街书库的成交率、以及「只拿南边」这条路线的胜率 —— 它是不是一条能赢的路
//   ③ 失败方式是否分开：抢北边 = 现金枯竭；等南边 = 租金窗口太短
//
// 用法：node support/probe-3391/late-center.mjs [60] [day] [price]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DAY = Number(process.argv[3] ?? 9);
const PRICE = Number(process.argv[4] ?? 13000);
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
// 南街下方那块 2×2 空地（(5,6)(6,6)(5,7)(6,7)），只取北侧一排 ⇒ 4 个临街格
const SOUTH_CELLS = [{ x: 5, y: 6 }, { x: 6, y: 6 }];

const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

function addLateCenter(state) {
  state.map.plots.push({ id: SOUTH, cells: SOUTH_CELLS.map(c => ({ ...c })), big: true,
    street: '南街', name: '南街书库', price: PRICE, availableFromDay: DAY });
  state.properties[SOUTH] = { ownerId: null, level: 2, street: '南街', big: true,
    bigType: 'bookstore', closed: 0, inflate: 0, price: PRICE };
  state.map.initialProperties.push({ plotId: SOUTH, level: 2, bigType: 'bookstore', price: PRICE });
  let linked = 0;
  for (const node of state.map.nodes) {
    const [nx, ny] = node.id.split(',').map(Number);   // 网格坐标，不是像素
    if (!SOUTH_CELLS.some(c => Math.abs(c.x - nx) + Math.abs(c.y - ny) === 1)) continue;
    node.adjacentPlots ??= [];
    node.adjacentPlots.push(SOUTH);
    linked++;
  }
  if (linked === 0) throw new Error('南街书库没有 frontage —— 探针坏了');
  return linked;
}

async function play({ style, seed, order, late }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (late) addLateCenter(state);
  const seat0 = state.players[0];
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
  const owns = id => state.properties[id]?.ownerId === seat0.id;
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    north: owns(NORTH), south: owns(SOUTH),
    southSold: !!state.properties[SOUTH]?.ownerId,
    rents: seat0.sliceStats.rentEarned,
    minCash, assets: assetsOf(state, seat0),
  };
}

async function runArm(style, late) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, late }));
  return rows;
}

console.log(`基线校验（n=${SEEDS * 2}/格）`);
const base = {};
for (const style of STYLES) {
  base[style] = await runArm(style, false);
  const p = 100 * base[style].filter(r => r.win).length / base[style].length;
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }
}

console.log(`\n===== 南街书库：第 ${DAY} 天开售，${PRICE}，4 临街格 =====`);
const out = {};
for (const style of STYLES) {
  const rows = await runArm(style, true);
  out[style] = rows;
  const n = rows.length;
  const has = k => rows.filter(r => (k === 'n' ? r.north : r.south) && !(k === 'n' ? false : r.north));
  const onlySouth = has('s'), onlyNorth = has('n'), neither = rows.filter(r => !r.north && !r.south);
  console.log(`  ${style.padEnd(6)} 基础 ${pct(base[style].filter(r => r.win).length, base[style].length).padEnd(7)}`
    + ` → 加入晚场 ${pct(rows.filter(r => r.win).length, n).padEnd(7)}`
    + ` 破产 ${pct(base[style].filter(r => r.bankrupt).length, base[style].length)} → ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` 南街成交 ${pct(rows.filter(r => r.southSold).length, n)}`);
  console.log(`         只北 n=${String(onlyNorth.length).padStart(3)} 胜 ${pct(onlyNorth.filter(r => r.win).length, onlyNorth.length).padEnd(6)}`
    + ` 只南 n=${String(onlySouth.length).padStart(3)} 胜 ${pct(onlySouth.filter(r => r.win).length, onlySouth.length).padEnd(6)}`
    + ` 都不占 n=${String(neither.length).padStart(3)} 胜 ${pct(neither.filter(r => r.win).length, neither.length)}`);
  console.log(`         收租 ${String(Math.round(mean(rows, 'rents'))).padStart(5)}`
    + ` 最低现金 ${String(Math.round(mean(rows, 'minCash'))).padStart(6)}`);
}
const w = s => out[s].filter(r => r.win).length / out[s].length;
const spread = 100 * (Math.max(...STYLES.map(w)) - Math.min(...STYLES.map(w)));
const baseW = s => base[s].filter(r => r.win).length / base[s].length;
const baseSpread = 100 * (Math.max(...STYLES.map(baseW)) - Math.min(...STYLES.map(baseW)));
console.log(`\n三起手差距：${baseSpread.toFixed(1)}pp → ${spread.toFixed(1)}pp ${spread < baseSpread ? '（收窄）' : '（更宽）'}`);
