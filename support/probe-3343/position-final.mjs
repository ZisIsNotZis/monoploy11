// #3343 最后一块拼图：位置。
//
// order-only.mjs：只轮转行动顺序，极差只有 5.5–7.8pp ⇒ 先后手不是主因。
// 但公平表下三条臂的座位分布都是「1 号位最高」（48.6 / 55.0 / 43.3），
// 而公平表把 1 号位的起点钉在 '8,2'（FAIR_POSES[1]）—— 默认表 starts[1] 也是 '8,2'。
// 两套完全不同的地产分配都让 1 号位赢，共同点只剩**起点**。
//
// 这一支把所有其它因子全钉死：三家同现金、同手牌、同起手；地产用「对称三块」（同等热度）；
// 只让**起点**在三个格子之间轮转。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 120);
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

// 三个候选起点集，都让三家处境在规则上尽量对称。
const SETS = {
  '原三点(3,2/8,2/3,5)': [
    { position: '3,2', facing: '4,2' },
    { position: '8,2', facing: '7,2' },
    { position: '3,5', facing: '4,5' },
  ],
  '贴书屋(5,2/4,4/7,4)': [
    { position: '5,2', facing: '5,3' },
    { position: '4,4', facing: '5,4' },
    { position: '7,4', facing: '6,4' },
  ],
  '同一格(3,2×3)': [
    { position: '3,2', facing: '4,2' },
    { position: '3,2', facing: '4,2' },
    { position: '3,2', facing: '4,2' },
  ],
};
// 对称三块：三家同热度、不同街，避免地块热度干扰。
const PLOTS = ['3,1', '3,9', '8,9'];

function setup(state, set, k) {
  const CASH = 42000;
  const HAND = ['worker', 'inflate', 'remotedice'];
  for (const pr of Object.values(state.properties)) pr.ownerId = null;
  state.players.forEach((p, i) => {
    p.style = 'grow'; p.cash = CASH; p.deposit = 0; p.cards = [...HAND]; p.talents = [];
    p.properties = [];
    const { position, facing } = set[(i + k) % set.length];
    p.position = position; p.facing = facing; p.lastNode = null;
    const plot = PLOTS[(i + k) % PLOTS.length];
    state.properties[plot].ownerId = p.id; p.properties.push(plot);
    p.sliceStats = { rentPaid: 0, rentEarned: 0, cardsPlayed: 0, takeovers: 0, tradeEarned: 0 };
  });
}

for (const [label, set] of Object.entries(SETS)) {
  const rows = [];
  for (const k of [0, 1, 2]) {
    const bySeat = [{ w: 0, n: 0, rent: 0, assets: 0 }, { w: 0, n: 0, rent: 0, assets: 0 }, { w: 0, n: 0, rent: 0, assets: 0 }];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const st = startSession(createSliceConfig({ human: false, seed, style: 'grow' }));
      setup(st, set, k);
      await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
      const winner = st.players.find(p => p.team === st.winnerTeam);
      st.players.forEach((p, i) => {
        bySeat[i].n++; bySeat[i].w += p === winner ? 1 : 0;
        bySeat[i].rent += p.sliceStats.rentEarned; bySeat[i].assets += assetsOf(st, p);
      });
    }
    const seats = bySeat.map(s => pct(s.w, s.n));
    rows.push({ k, seats, 极差: +(Math.max(...seats) - Math.min(...seats)).toFixed(1), 到账: bySeat.map(s => Math.round(s.rent / s.n)) });
  }
  console.log(JSON.stringify({ 起点集: label, 三臂: rows.map(r => r.seats), 极差: rows.map(r => r.极差), 到账: rows.map(r => r.到账) }));
}
