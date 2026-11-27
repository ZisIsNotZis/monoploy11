// #3342 结构性事实（先确认，再改）：
//
//   initializeSlice 给 i 号玩家**整条街的两间店**（晨光街/晚风街/灯火街）。
//   而 rentFor 的同街加成是 1 + 0.4 ×（本队该街店数 − 1）。
//   ⇒ 开局第一秒，三家的同街加成全部已经吃满（2 间 = ×1.4），
//     地图上「补齐一条街」这个最经典的大富翁计划**在 t=0 就已经完成了**。
//   ⇒ 于是买地只剩「多一间店」而不是「凑一条街」，收购也失去了「把对手的街抢成我的」这个理由。
//
// 这不是文案问题，是地图数据。本脚本用同一条引擎量三种开局所有权：
//   A 现状：每人整条街 2 间（6 街全分完）
//   B 交错：每人 2 间、但分在两条街上，另有两间无主（可买、可抢）
//   C 单间：每人只有 1 间、另 3 间无主（更强地推「补齐」）
//
// 量：胜率、终局资产、收租、真付租次数、买地次数、以及**同街加成在开局是否已满**。
import { createSliceConfig, SLICE_MAP, SLICE_STYLES } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 30);
const STYLES = ['grow', 'take', 'cross'];
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

// 三张起手各自的「自家街」与「邻居街」—— 沿用现有起点，只改所有权分布。
// 六条街、每条两间店。按地图位置排成一圈，好做旋转对称的分配。
const STREET_PAIRS = [
  ['3,1', '4,1'],   // 晨光街（北-左）
  ['8,1', '9,1'],   // 晚风街（北-右）
  ['1,3', '1,4'],   // 西巷（西）
  ['11,6', '11,7'], // 东巷（东）
  ['3,9', '4,9'],   // 灯火街（南-左）
  ['8,9', '9,9'],   // 月色街（南-右）
];
const HOME = [['3,1', '4,1'], ['8,1', '9,1'], ['3,9', '4,9']];
const OTHER = [['1,3', '11,7'], ['1,4', '11,6'], ['8,9', '11,7']];

// D（旋转对称）：每条街恰好两家、分属两人。于是每条街都是 1 对 1 争夺，
// 「把这条街买成我一个人的」变成真计划，而收购卡第一次有正当理由。
// i 号玩家拿 第 i 条街的第 0 间 + 第 (i+3) 条街的第 1 间。
function ownershipD(i) {
  return { own: [STREET_PAIRS[i][0], STREET_PAIRS[(i + 3) % 6][1]], unowned: [] };
}

function ownership(kind, i) {
  if (kind === 'A') return { own: HOME[i], unowned: [] };
  if (kind === 'B') return { own: [HOME[i][0], OTHER[i][0]], unowned: [HOME[i][1], OTHER[i][1]] };
  if (kind === 'D') return ownershipD(i);
  // C：每人一间，剩下三间无主。
  return { own: [HOME[i][0]], unowned: [HOME[i][1], OTHER[i][0], OTHER[i][1]] };
}

const out = {};
for (const kind of ['A', 'B', 'C', 'D']) {
  const cell = Object.fromEntries(STYLES.map(s => [s, { games: 0, wins: 0, rent: 0, endAssets: 0 }]));
  const agg = { games: 0, rent: 0, paidEvents: 0, buys: 0, takeovers: 0, trade: 0, timeouts: 0 };
  for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
    const config = createSliceConfig({ human: false, seed, style });
    // 自己造所有权：先清空，再按 kind 分。
    const state = startSession(config);
    for (const pr of Object.values(state.properties)) { pr.ownerId = null; }
    for (const p of state.players) p.properties = [];
    state.players.forEach((p, i) => {
      const { own } = ownership(kind, i);
      for (const id of own) { state.properties[id].ownerId = p.id; p.properties.push(id); }
    });
    agg.games++;
    await runGame(state, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, state); } });
    const winner = state.players.find(p => p.team === state.winnerTeam);
    for (const line of state.log) {
      if (/实付租金 [1-9]/.test(line.text)) agg.paidEvents++;
      if (/ 买下 /.test(line.text)) agg.buys++;
    }
    for (const p of state.players) {
      const c = cell[p.style];
      c.games++; c.wins += p === winner ? 1 : 0;
      c.rent += p.sliceStats.rentEarned; c.endAssets += assetsOf(state, p);
      agg.rent += p.sliceStats.rentEarned;
      agg.takeovers += p.sliceStats.takeovers;
      agg.timeouts += p.alive ? 0 : 1;
    }
  }
  const per = (v, n) => Math.round(v / Math.max(1, n));
  out[kind] = {
    起手胜率: Object.fromEntries(STYLES.map(s => [s, pct(cell[s].wins, cell[s].games)])),
    每家终局资产: per(Object.values(cell).reduce((a, c) => a + c.endAssets, 0), agg.games * 3),
    每家收租: per(agg.rent, agg.games * 3),
    每局真付租次数: +(agg.paidEvents / agg.games).toFixed(2),
    每局买地次数: +(agg.buys / agg.games).toFixed(2),
    每局收购次数: +(agg.takeovers / agg.games).toFixed(2),
    破产人次: agg.timeouts,
  };
}
// 开局同街加成：A 应该全是 1.4，B/C 应该出现 1.0。
const chain = {};
for (const kind of ['A', 'B', 'C', 'D']) {
  const config = createSliceConfig({ human: false, seed: 1, style: 'grow' });
  const state = startSession(config);
  for (const pr of Object.values(state.properties)) pr.ownerId = null;
  for (const p of state.players) p.properties = [];
  state.players.forEach((p, i) => { for (const id of ownership(kind, i).own) { state.properties[id].ownerId = p.id; p.properties.push(id); } });
  chain[kind] = state.players.map((p, i) => {
    const id = ownership(kind, i).own[0];
    const pr = state.properties[id];
    const base = rentFor({ ...state, properties: { ...state.properties, [id]: { ...pr, level: 1 } } }, id);
    return { 玩家: p.name, 首店: state.map.plots.find(x => x.id === id).name, 租: base };
  });
}
console.log(JSON.stringify({ chain, ...out }, null, 1));
