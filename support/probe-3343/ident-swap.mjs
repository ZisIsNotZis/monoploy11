// #3343 最后一刀：座位胜率到底是「地块」还是「位次」？
//
// ident120（120 局，三家现金/手牌/起手/位置全同，只有地块按 i 轮给）读到：
//   座位胜率 18.3 / 45.0 / 36.7（极差 26.7，2σ 只有 4.3）
//   每位收租 6,200 / 12,602 / 10,140
// 收租比 2.03 倍，而每间店的实测热度是 晨光 0.172 / 灯火 0.406 / 月色 0.136。
// 若偏差来自地块，把地块在三人之间轮转一次，胜率就该跟着**地块**走；
// 若偏差来自位次（先手 / 平局 / AI 顺序），胜率就该留在**座位**上不动。
//
// 这一支就是那一次轮转。三家仍然完全同质，只把「谁拿哪块」旋转 0/1/2。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 120);
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

const SYM_POS = [
  { position: '5,2', facing: '5,3' },
  { position: '4,4', facing: '5,4' },
  { position: '7,4', facing: '6,4' },
];
const SYM_PLOT = ['3,1', '3,9', '8,9']; // 晨光 / 灯火 / 月色

function identical(state, k) {
  const CASH = 42000;
  const HAND = ['worker', 'inflate', 'remotedice'];
  for (const pr of Object.values(state.properties)) pr.ownerId = null;
  state.players.forEach((p, i) => {
    p.style = 'grow'; p.cash = CASH; p.deposit = 0; p.cards = [...HAND]; p.talents = [];
    p.properties = [];
    const { position, facing } = SYM_POS[i];
    p.position = position; p.facing = facing; p.lastNode = null;
    const plot = SYM_PLOT[(i + k) % 3];
    state.properties[plot].ownerId = p.id;
    p.properties.push(plot);
    p.sliceStats = { rentPaid: 0, rentEarned: 0, cardsPlayed: 0, takeovers: 0, tradeEarned: 0 };
  });
}

for (const k of [0, 1, 2]) {
  const bySeat = [{ w: 0, n: 0, rent: 0, assets: 0 }, { w: 0, n: 0, rent: 0, assets: 0 }, { w: 0, n: 0, rent: 0, assets: 0 }];
  const byPlot = {};
  let games = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const st = startSession(createSliceConfig({ human: false, seed, style: 'grow' }));
    identical(st, k);
    games++;
    const held = st.players.map(p => p.properties[0]);
    await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
    const winner = st.players.find(p => p.team === st.winnerTeam);
    st.players.forEach((p, i) => {
      bySeat[i].n++; bySeat[i].w += p === winner ? 1 : 0;
      bySeat[i].rent += p.sliceStats.rentEarned;
      bySeat[i].assets += assetsOf(st, p);
      const plot = held[i];
      byPlot[plot] ??= { n: 0, w: 0, rent: 0 };
      byPlot[plot].n++; byPlot[plot].w += p === winner ? 1 : 0; byPlot[plot].rent += p.sliceStats.rentEarned;
    });
  }
  const seats = bySeat.map(s => pct(s.w, s.n));
  console.log(JSON.stringify({
    地块轮转: k, 局数: games,
    座位胜率: seats, 座位极差: +(Math.max(...seats) - Math.min(...seats)).toFixed(1),
    每位收租: bySeat.map(s => Math.round(s.rent / s.n)),
    按地块胜率: Object.fromEntries(Object.entries(byPlot).map(([p, v]) => [p, pct(v.w, v.n)])),
    按地块收租: Object.fromEntries(Object.entries(byPlot).map(([p, v]) => [p, Math.round(v.rent / v.n)])),
  }));
}
