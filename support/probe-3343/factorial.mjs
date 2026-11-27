// #3343：把「座位」真正拆成两个可分离的因子，因为上一版混了。
//
// decision-vs-seat.mjs 的 rotateSeat 只轮转**椅子的内容**（起手/手牌/现金/店/位置），
// 但 state.order 一直没动 —— 人类座位永远第一个行动。于是 seat1 读到 60.7%，
// 那是「1 号位的家当 + 先手」的混合，不是座位效应。这个脚本补上这一刀。
//
// 2 因子 × 3 水平 = 9 格，每格 3 起手 × SEEDS 局：
//   content k   0/1/2   谁拿哪份家当（店/位置/起手/现金/手牌）
//   order   m   0/1/2   谁第几个行动
// 读数：人类座位（0 号位）胜率。然后：
//   内容主效应 = 固定 m 时 k 的极差，在 3 个 m 上取平均
//   顺序主效应 = 固定 k 时 m 的极差，在 3 个 k 上取平均
//   交互 = 剩余的格间摆动
//
// 用平衡表：每人一条冷街 + 一条热街（COLD/HOT 各取第 0 间），两半都空着。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const SEEDS = Number(process.argv[2] ?? 40);
const STYLES = ['grow', 'take', 'cross'];
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

const COLD = ['8,1', '1,3', '11,6'];   // 晚风 0.072 / 西巷 0.111 / 东巷 0.133
const HOT = ['3,1', '8,9', '3,9'];     // 晨光 0.172 / 月色 0.136 / 灯火 0.406

const SEAT_FIELDS = ['style', 'cards', 'cash', 'position', 'facing', 'properties'];

function layout(state) {
  for (const pr of Object.values(state.properties)) pr.ownerId = null;
  state.players.forEach((p, i) => {
    p.properties = [];
    for (const id of [COLD[i], HOT[i]]) { state.properties[id].ownerId = p.id; p.properties.push(id); }
  });
}

function rotateContent(state, k) {
  const snap = state.players.map(p => {
    const o = {};
    for (const f of SEAT_FIELDS) o[f] = Array.isArray(p[f]) ? [...p[f]] : p[f];
    return o;
  });
  for (const pr of Object.values(state.properties)) pr.ownerId = null;
  state.players.forEach((p, i) => {
    const src = snap[(i + k) % 3];
    for (const f of SEAT_FIELDS) p[f] = Array.isArray(src[f]) ? [...src[f]] : src[f];
    p.lastNode = null;
    for (const id of p.properties) state.properties[id].ownerId = p.id;
  });
}

function rotateOrder(state, m) {
  const n = state.order.length;
  state.order = state.order.map((_, i) => state.order[(i + m) % n]);
}

const grid = {};
for (const k of [0, 1, 2]) for (const m of [0, 1, 2]) {
  let w = 0, n = 0;
  for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
    const st = startSession(createSliceConfig({ human: false, seed, style }));
    layout(st);
    if (k) rotateContent(st, k);
    if (m) rotateOrder(st, m);
    await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
    const winner = st.players.find(p => p.team === st.winnerTeam);
    n++; w += winner === st.players[0] ? 1 : 0;
  }
  grid[`c${k}o${m}`] = pct(w, n);
}

console.log('内容 k × 顺序 m 的 0 号位胜率：');
console.log('        m=0    m=1    m=2');
for (const k of [0, 1, 2]) {
  console.log(`k=${k}   ${[0, 1, 2].map(m => String(grid[`c${k}o${m}`]).padStart(5)).join('  ')}`);
}

const range = xs => Math.max(...xs) - Math.min(...xs);
const contentMain = [0, 1, 2].map(m => range([0, 1, 2].map(k => grid[`c${k}o${m}`])));
const orderMain = [0, 1, 2].map(k => range([0, 1, 2].map(m => grid[`c${k}o${m}`])));
const all = Object.values(grid);
console.log(JSON.stringify({
  内容主效应_按顺序臂: contentMain, 内容主效应_均值: +(contentMain.reduce((a, b) => a + b, 0) / 3).toFixed(1),
  顺序主效应_按内容臂: orderMain, 顺序主效应_均值: +(orderMain.reduce((a, b) => a + b, 0) / 3).toFixed(1),
  全格极差: +range(all).toFixed(1),
  全格均值: +(all.reduce((a, b) => a + b, 0) / all.length).toFixed(1),
}));
