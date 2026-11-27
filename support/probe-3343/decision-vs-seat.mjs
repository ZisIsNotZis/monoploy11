// #3343 用户的原问题：「你测到座次变化明显，优先查它是否掩盖了我自己做决定的效果。」
//
// 这就是一个**方差分解**问题，不是「座位偏差有多大」。
// 两个因子，各自只动一个：
//   座位  seat k = 0/1/2（把整把椅子的内容轮转，其余不动）
//   决定  人类座位用哪种策略：default（aiAnswer 原样）/ complete（补齐自家街就买）
// 读数：每种组合下人类座位（0 号位）的胜率。若「决定」带来的差 < 「座位」带来的差，
// 那就是座位盖住了决定 —— 用户看到的手感就不可信，任何「这条路更好」的结论都不能给他。
//
// 为什么要用平衡表：上一轮量到六条街差 5.6 倍（traffic60b），而旧表按**下标**发街，
// 于是「座位」= 「拿到哪条街」。在那种表上量方差分解毫无意义：座位项会把街道价值全吸走。
// 所以这里在一张**按街区热度配对**的表上量（每人一条热街 + 一条冷街，两半都空着）。
// 这张表本身也要顺手验证：它在 seat 三臂上的极差应当小于旧表。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buyPrice } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 50);
const STYLES = ['grow', 'take', 'cross'];
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

const PAIRS = [['3,1', '4,1'], ['8,1', '9,1'], ['3,9', '4,9'], ['8,9', '9,9'], ['1,3', '1,4'], ['11,6', '11,7']];
// 热度（traffic60b 每间每局真收租次数，升序）：
//   晚风 0.072 · 西巷 0.111 · 东巷 0.133 · 月色 0.136 · 晨光 0.172 · 灯火 0.406
const COLD = ['8,1', '1,3', '11,6'];   // 晚风[0] 西巷[0] 东巷[0]
const HOT = ['3,1', '8,9', '3,9'];      // 晨光[0] 月色[0] 灯火[0]
// 平衡表：i 号位拿「一条冷街的第 0 间 + 一条热街的第 0 间」，两间的另一半都空着。
// 于是每人都是「一条冷街 + 一条热街」，谁也不会因为坐在 0 号位而拿到 5.6 倍的那条街。
const BALANCED = i => [COLD[i], HOT[i]];

const SEAT_FIELDS = ['style', 'cards', 'cash', 'position', 'facing', 'properties'];
function rotateSeat(state, k) {
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

function layout(state) {
  for (const pr of Object.values(state.properties)) pr.ownerId = null;
  state.players.forEach((p, i) => {
    p.properties = [];
    for (const id of BALANCED(i)) { state.properties[id].ownerId = p.id; p.properties.push(id); }
  });
}

// 人类座位的「补齐自家街」计划：自家每条街上还没到手的那一间。
function halfStreet(state, me) {
  const mine = new Set(me.properties);
  const streets = new Set([...mine].map(id => state.properties[id]?.street).filter(Boolean));
  return state.map.plots
    .filter(pl => !pl.big && streets.has(pl.street) && !mine.has(pl.id))
    .map(pl => pl.id);
}

async function play({ seed, style, seat, complete }) {
  const st = startSession(createSliceConfig({ human: false, seed, style }));
  layout(st);
  if (seat) rotateSeat(st, seat);
  const me = st.players[0];
  await runGame(st, {
    render() {}, async step() {},
    async ask(prompt) {
      const answer = aiAnswer(prompt, st);
      if (!complete || prompt.player !== me) return answer;
      const targets = halfStreet(st, me);
      if (prompt.type === 'buy' && prompt.plot && targets.includes(prompt.plot.id) && me.cash >= prompt.price) return true;
      if (prompt.type === 'target' && prompt.cardId === 'buyland') {
        const ids = prompt.plotIds ?? [prompt.plot?.id].filter(Boolean);
        const hit = targets.find(id => ids.includes(id));
        if (hit) return hit;
      }
      return answer;
    },
  });
  const winner = st.players.find(p => p.team === st.winnerTeam);
  return { win: winner === me, assets: assetsOf(st, me) };
}

const cell = {};
for (const seat of [0, 1, 2]) for (const complete of [false, true]) {
  let w = 0, n = 0, assets = 0;
  for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
    const r = await play({ seed, style, seat, complete });
    n++; w += r.win ? 1 : 0; assets += r.assets;
  }
  cell[`seat${seat}-${complete ? 'complete' : 'default'}`] = { 胜率: pct(w, n), 资产: Math.round(assets / n), n };
}
for (const [k, v] of Object.entries(cell)) console.log(JSON.stringify({ 组合: k, ...v }));

const d = k => cell[k].胜率;
console.log('\n=== 方差分解（人类座位胜率，百分点）===');
const seatSwing = [0, 1, 2].map(s => d(`seat${s}-default`));
const completeSwing = [0, 1, 2].map(s => d(`seat${s}-complete`));
console.log(JSON.stringify({
  座位效应_默认策略: { 三臂: seatSwing, 极差: +(Math.max(...seatSwing) - Math.min(...seatSwing)).toFixed(1) },
  座位效应_补齐策略: { 三臂: completeSwing, 极差: +(Math.max(...completeSwing) - Math.min(...completeSwing)).toFixed(1) },
  决定效应_平均: +(completeSwing.reduce((a, b) => a + b, 0) / 3 - seatSwing.reduce((a, b) => a + b, 0) / 3).toFixed(1),
  '决定/座位_比': +(((completeSwing.reduce((a, b) => a + b, 0) - seatSwing.reduce((a, b) => a + b, 0)) / 3) /
    Math.max(0.1, Math.max(...seatSwing) - Math.min(...seatSwing))).toFixed(2),
}));
