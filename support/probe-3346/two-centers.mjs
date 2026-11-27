// #3391d：把「一次抽签」变成「两次选择」——唯一还没试过的结构方向。
//
// 已量到的事实（都在本目录）：
//   · 整局胜负由「第 4 天谁拿到街心书屋」决定：持有者胜率 80–100%、破产 0.0%（race-conditional.mjs）
//   · 原因是落点次数：书屋 29.07 次/局 vs 小店 4.26 次/局 = 6.82×（frontage-audit.mjs）
//   · 四种「换打法」都更差（plans-vs-control / deepen / denial / street-completion）
//   · 开放收购书屋方向不一致（grow +10、take +10.9、cross −5），不能当规则发布（take-back.mjs）
//
// 那些都是「绕着同一块地做文章」。这一支换一个结构假设：
// **场上放第二个大建筑（同样的 4 格十字路口几何），位置在地图另一侧。**
// 于是「书屋」不再是唯一的地标，而变成**两处高地**：
//   · 三家人不可能同时占住两处 —— 必须选一处去争；
//   · 选哪处、什么时候去、要不要放弃另一处，都是真的取舍；
//   · 失败方式也不同：抢错地方 = 自己的高地没被踩、对手的高地被踩。
//
// 这一支只**在内存里**给本局地图追加第二块大建筑（不写产品、不改价目、不改发牌），
// 然后跑同一批 seed，看两件事：
//   ① 胜率分布是否还由单一事件决定（条件胜率还那么极端吗）
//   ② 三起手差距是否还在可接受范围
// 若「两处高地」把条件胜率从 80–100% 与 3–5% 拉近，那它就是值得产品化的方向。
//
// 用法：node support/probe-3346/two-centers.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor } from '../../src/engine/economy.js';

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
const BOOK2 = 'market2';
// 第二个中心：地图下方对称的 4 格路口（3,6 / 4,6 / 3,7 / 4,7 一带是空心，所以用 5,6-6,7）
const SECOND = { id: BOOK2, cells: [{ x: 5, y: 6 }, { x: 6, y: 6 }, { x: 5, y: 7 }, { x: 6, y: 7 }],
  big: true, street: '书屋二', name: '南街书库', price: 26000, availableFromDay: 4 };

const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

// 在本局地图里追加第二块大建筑（含相邻关系）。只动 state，不动 SLICE_MAP。
function addSecondCenter(state) {
  if (state.map.plots.some(p => p.id === BOOK2)) return;
  const plot = { ...SECOND, cells: SECOND.cells.map(c => ({ ...c })) };
  state.map.plots.push(plot);
  state.properties[BOOK2] = { ownerId: null, level: 2, street: plot.street, big: true,
    bigType: 'bookstore', closed: 0, inflate: 0, price: plot.price };
  state.map.initialProperties.push({ plotId: BOOK2, level: 2, bigType: 'bookstore', price: plot.price });
  for (const node of state.map.nodes) {
    const near = plot.cells.some(c => Math.abs(c.x - node.x) + Math.abs(c.y - node.y) === 1);
    if (near) (node.adjacentPlots ??= []).push(BOOK2);
  }
}

async function play({ style, seed, order, twoCenters }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (twoCenters) addSecondCenter(state);
  const seat0 = state.players[0];
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0;

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const ownerOf = id => state.players.find(p => p.id === state.properties[id]?.ownerId);
  const bigs = state.map.plots.filter(p => p.big);
  const mine = bigs.filter(p => state.properties[p.id]?.ownerId === seat0.id).length;
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    bigsMine: mine,
    bookMine: state.properties[BOOK]?.ownerId === seat0.id,
    anyBigMine: mine > 0,
    book2Owner: ownerOf(BOOK2)?.id ?? null,
    rentEarned: seat0.sliceStats.rentEarned,
    assets: assetsOf(state, seat0),
  };
}

console.log(`基线校验（n=${SEEDS * 2}/格，争街，现状）`);
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, twoCenters: false }));
  const p = 100 * rows.filter(r => r.win).length / rows.length;
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
}

console.log('\n===== 场上两处高地（街心书屋 + 南街书库）=====');
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, twoCenters: true }));
  const n = rows.length;
  const got0 = rows.filter(r => r.bigsMine === 0);
  const got1 = rows.filter(r => r.bigsMine === 1);
  const got2 = rows.filter(r => r.bigsMine >= 2);
  console.log(`  ${style.padEnd(6)} 总体 ${pct(rows.filter(r => r.win).length, n).padEnd(7)}`
    + ` 破产 ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`);
  console.log(`         占 0 处 n=${String(got0.length).padStart(3)} 胜 ${pct(got0.filter(r => r.win).length, got0.length).padEnd(6)}`
    + ` 占 1 处 n=${String(got1.length).padStart(3)} 胜 ${pct(got1.filter(r => r.win).length, got1.length).padEnd(6)}`
    + ` 占 2 处 n=${String(got2.length).padStart(3)} 胜 ${pct(got2.filter(r => r.win).length, got2.length)}`);
  console.log(`         收租 ${String(Math.round(mean(rows, 'rentEarned'))).padStart(5)} 终局资产 ${Math.round(mean(rows, 'assets'))}`);
}
