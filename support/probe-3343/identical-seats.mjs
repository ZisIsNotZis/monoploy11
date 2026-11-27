// #3343 最硬的一条判据：**三个座位完全一样时，0 号位还赢得多吗？**
//
// 前面每一步都还剩一个说不清的因子（pos60 里同一个格子 8,2 在三个轮转下分别是 46.1/25/53.3）。
// 一个能在「换掉所有开局表」之后仍然存在的座位偏差，只可能来自两处：
//   ① 引擎里某处按 id / 下标做了不自觉的偏袒（先手、平局判定、AI 顺序）
//   ② 我的量具在骗我
// 把三者做成**逐字段相同**（同起手、同现金、同手牌、对称位置、互不相同的对称地产），
// 剩下来的任何偏差就只能是 ① 或 ② —— 这一支就是用来把这两个可能分开的。
//
// 对称摆法：三条街各两间，第 i 号位拿「街 i 的第 0 间」，另外三间（第 1 间）无主，
// 且三人的起点是**关于中心旋转对称**的三个格子，到书屋距离全为 1 步。
// 于是三家的处境在规则上完全等價；唯一的不对称是「谁先动」——那正是要量出来的东西。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 120);
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

// 旋转对称的三点：到书屋 (5-6,3-4) 都是 1 步。
const SYM_POS = [
  { position: '5,2', facing: '5,3' }, // 北
  { position: '4,4', facing: '5,4' }, // 西南
  { position: '7,4', facing: '6,4' }, // 东南
];
// 三条街的第 0 间：晨光 / 灯火 / 月色。
const SYM_PLOT = ['3,1', '3,9', '8,9'];

function identical(state) {
  const base = state.players[0];
  const CASH = 42000;
  const HAND = ['worker', 'inflate', 'remotedice'];
  for (const pr of Object.values(state.properties)) pr.ownerId = null;
  state.players.forEach((p, i) => {
    p.style = 'grow'; p.cash = CASH; p.deposit = 0; p.cards = [...HAND]; p.talents = [];
    p.properties = [];
    const { position, facing } = SYM_POS[i];
    p.position = position; p.facing = facing; p.lastNode = null;
    state.properties[SYM_PLOT[i]].ownerId = p.id;
    p.properties.push(SYM_PLOT[i]);
    p.sliceStats = { rentPaid: 0, rentEarned: 0, cardsPlayed: 0, takeovers: 0, tradeEarned: 0 };
  });
  void base;
}

const bySeat = [{ w: 0, n: 0, rent: 0, assets: 0 }, { w: 0, n: 0, rent: 0, assets: 0 }, { w: 0, n: 0, rent: 0, assets: 0 }];
let games = 0, over = 0, timeouts = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const st = startSession(createSliceConfig({ human: false, seed, style: 'grow' }));
  identical(st);
  games++;
  await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
  const winner = st.players.find(p => p.team === st.winnerTeam);
  if (!winner) over++;
  st.players.forEach((p, i) => {
    bySeat[i].n++; bySeat[i].w += p === winner ? 1 : 0;
    bySeat[i].rent += p.sliceStats.rentEarned;
    bySeat[i].assets += assetsOf(st, p);
  });
}

const seats = bySeat.map(s => pct(s.w, s.n));
console.log(JSON.stringify({
  局数: games, 座位胜率: seats,
  极差: +(Math.max(...seats) - Math.min(...seats)).toFixed(1),
  '偏离33.3的最大值': +Math.max(...seats.map(s => Math.abs(s - 100 / 3))).toFixed(1),
  每位收租: bySeat.map(s => Math.round(s.rent / s.n)),
  每位终局资产: bySeat.map(s => Math.round(s.assets / s.n)),
  无胜者局: over,
  标准差估计_pct: +(100 * Math.sqrt((1 / 3) * (2 / 3) / games)).toFixed(1),
}));
console.log('判据：三臂都应在 33.3 ± 2σ 内；座位极差若 > 2σ*2 则有结构性偏袒。');
