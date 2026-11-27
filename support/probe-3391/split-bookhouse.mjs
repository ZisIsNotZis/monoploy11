// #3391e：把「一次抽签」拆成「两处相邻高地」—— 不动地图、不动现金、不动卡。
//
// 为什么是这个改法（证据链都在 support/probe-3346/）：
//   · 胜负由「第 4 天谁拿到街心书屋」决定 → 持有者 80–100%、没拿到的 3–5%（race-conditional）
//   · 因为收租机会 ∝ 落点次数：书屋 29.07 次/局 vs 小店 4.26 次/局 = 6.82×（frontage-audit）
//   · 而 frontage 是**几何**给的：书屋 8 个临街格，小店 1 个。
// ⇒ 所以「加乘数」「减价」「开放收购」都动不了它（都试过，全失败）。
//
// 这一支只改一件事：把街心书屋那块 2×2 拆成**两块 2×1**。
//   market     = (5,3)(6,3)  北半
//   market-s   = (5,4)(6,4)  南半
// 每块各 4 个临街格，而且**临街格互不重叠**（见下面 assert）：北半只被
// (5,2)(6,2)(4,3)(7,3) 临到，南半只被 (5,5)(6,5)(4,4)(7,4) 临到。
// 两块加起来仍是 8 个格、总租金量级不变，但现在它们可以被**两个人分别持有**。
//
// 要回答的：
//   ① 基线三格是否逐位复现（不复现就不印）
//   ② 条件胜率：占 0 / 1 / 2 块各自的胜率。若「占 1 块」不再是 80–100%，
//      而是接近 50%，那说明胜负不再由单个事件决定 —— 这才是取舍出现的样子。
//   ③ 是否真的会出现两个人各持一半的对局（若从不发生，又是「从未发生」的坑）
//   ④ 三起手差距与失败方式（破产率、最低现金）
//
// 用法：node support/probe-3391/split-bookhouse.mjs [60]
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

const NORTH = 'market';
const SOUTH = 'market-s';

const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

// 把北半缩到 (5,3)(6,3)，南半新建成 (5,4)(6,4)。只动本局 state.map。
function splitBookhouse(state) {
  const plot = state.map.plots.find(p => p.id === NORTH);
  if (!plot) throw new Error('找不到 street bookhouse');
  plot.cells = [{ x: 5, y: 3 }, { x: 6, y: 3 }];
  plot.name = '街心书屋 · 北';
  plot.price = 13000;
  state.properties[NORTH].price = 13000;
  state.map.initialProperties.find(x => x.plotId === NORTH).price = 13000;

  state.map.plots.push({ id: SOUTH, cells: [{ x: 5, y: 4 }, { x: 6, y: 4 }], big: true,
    street: '书屋', name: '街心书屋 · 南', price: 13000, availableFromDay: 4 });
  state.properties[SOUTH] = { ownerId: null, level: 2, street: '书屋', big: true,
    bigType: 'bookstore', closed: 0, inflate: 0, price: 13000 };
  state.map.initialProperties.push({ plotId: SOUTH, level: 2, bigType: 'bookstore', price: 13000 });

  // 重算这两个地块的全部临街格（网格坐标；node.x 是像素，别混）
  const southCells = [{ x: 5, y: 4 }, { x: 6, y: 4 }];
  const northCells = [{ x: 5, y: 3 }, { x: 6, y: 3 }];
  const touches = (cells, nx, ny) => cells.some(c => Math.abs(c.x - nx) + Math.abs(c.y - ny) === 1);
  for (const node of state.map.nodes) {
    const [nx, ny] = node.id.split(',').map(Number);
    node.adjacentPlots = (node.adjacentPlots ?? []).filter(id => id !== NORTH && id !== SOUTH);
    if (touches(northCells, nx, ny)) node.adjacentPlots.push(NORTH);
    if (touches(southCells, nx, ny)) node.adjacentPlots.push(SOUTH);
  }

  const northFront = state.map.nodes.filter(n => n.adjacentPlots.includes(NORTH)).length;
  const southFront = state.map.nodes.filter(n => n.adjacentPlots.includes(SOUTH)).length;
  const both = state.map.nodes.filter(n => n.adjacentPlots.includes(NORTH) && n.adjacentPlots.includes(SOUTH));
  if (both.length) throw new Error(`两半共享临街格 ${both.map(n => n.id).join(' ')} —— 切法不对称，别印数`);
  return { northFront, southFront };
}

async function play({ style, seed, order, split }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (split) splitBookhouse(state);
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
  const held = split ? [NORTH, SOUTH] : [NORTH];
  const mine = held.filter(id => state.properties[id]?.ownerId === seat0.id).length;
  const owners = new Set(held.map(id => state.properties[id]?.ownerId).filter(Boolean));
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    mine,
    splitBetweenPlayers: split && owners.size === 2,
    rents: seat0.sliceStats.rentEarned,
    minCash,
    assets: assetsOf(state, seat0),
  };
}

async function runArm(style, split) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, split }));
  return rows;
}

console.log(`基线校验（n=${SEEDS * 2}/格，争街，整块书屋）`);
const base = {};
for (const style of STYLES) {
  const rows = await runArm(style, false);
  base[style] = rows;
  const p = 100 * rows.filter(r => r.win).length / rows.length;
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
}

// 几何断言：切完必须两半各 4 个临街格、互不重叠、合计 8。
{
  const s = startSession(createSliceConfig({ human: false, seed: 1, style: 'take', sliceContestedStreets: true }));
  const g = splitBookhouse(s);
  console.log(`\n切分几何：北半 ${g.northFront} 格 / 南半 ${g.southFront} 格（原有 8 格，无共享）`);
  if (g.northFront + g.southFront !== 8) throw new Error('临街格总数变了 —— 这不是等价切分');
}

console.log('\n===== 书屋拆成南北两半（各 4 临街格，可被两人分别持有）=====');
for (const style of STYLES) {
  const rows = await runArm(style, true);
  const n = rows.length;
  const seats = [0, 1, 2].map(k => rows.filter(r => r.mine === k));
  const b = base[style];
  console.log(`  ${style.padEnd(6)} 基础 ${pct(b.filter(r => r.win).length, b.length).padEnd(7)}`
    + ` → 拆分 ${pct(rows.filter(r => r.win).length, n).padEnd(7)}`
    + ` 破产 ${pct(b.filter(r => r.bankrupt).length, b.length)} → ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` 两人各持一半 ${pct(rows.filter(r => r.splitBetweenPlayers).length, n)}`);
  console.log(`         占 0 块 n=${String(seats[0].length).padStart(3)} 胜 ${pct(seats[0].filter(r => r.win).length, seats[0].length).padEnd(6)}`
    + ` 占 1 块 n=${String(seats[1].length).padStart(3)} 胜 ${pct(seats[1].filter(r => r.win).length, seats[1].length).padEnd(6)}`
    + ` 占 2 块 n=${String(seats[2].length).padStart(3)} 胜 ${pct(seats[2].filter(r => r.win).length, seats[2].length)}`);
  console.log(`         收租 ${String(Math.round(mean(rows, 'rents'))).padStart(5)}`
    + ` 最低现金 ${String(Math.round(mean(rows, 'minCash'))).padStart(6)}`
    + ` 终局资产 ${Math.round(mean(rows, 'assets'))}`);
}
