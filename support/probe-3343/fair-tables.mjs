// #3343：候选「公平表」的对拍。判据是**三个座位各坐各的**时胜率是否相等，
// 不是均值 —— 一个偏向某个座位的表，均值再好看也没用。
//
// 已量到的事实（traffic60b，180 局，只认「实付租金」行）：
//   每间店每局真收租次数：灯火 0.406 · 晨光 0.172 · 月色 0.136 · 东巷 0.133 · 西巷 0.111 · 晚风 0.072
//   而 STARTS_WHOLE_STREET 按**下标**发街：p1→晨光 · p2→晚风 · p3→灯火
//   ⇒ 座位 2 拿到的是最冷的那条街。factorial.mjs 量到「谁拿哪份家当」值 31.7pp。
//
// 这里不猜，逐一量：每张候选表 + 默认表，读「0/1/2 号位各自胜率」。
// 注意：这里**不旋转内容**，量的是「坐在这个位置、拿这份家当」的胜率 —— 正是玩家体感。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const STYLES = ['grow', 'take', 'cross'];
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

// 热度（每间每局真收租次数），用来配对。
const HEAT = { '晨光街': 0.172, '晚风街': 0.072, '灯火街': 0.406, '月色街': 0.136, '西巷': 0.111, '东巷': 0.133 };
const P = {
  '晨光街': ['3,1', '4,1'], '晚风街': ['8,1', '9,1'], '灯火街': ['3,9', '4,9'],
  '月色街': ['8,9', '9,9'], '西巷': ['1,3', '1,4'], '东巷': ['11,6', '11,7'],
};
const POSE = [['3,2', '4,2'], ['8,2', '7,2'], ['3,5', '4,5']];

// 每张表：三个玩家各自的两间（street, 0|1）。
const TABLES = {
  // 默认：每人整条街，按下标发。
  whole: [[['晨光街', 0], ['晨光街', 1]], [['晚风街', 0], ['晚风街', 1]], [['灯火街', 0], ['灯火街', 1]]],
  // fairA：最小极差配对，三条街一对 {灯火,晚风} {晨光,月色} {东巷,西巷}
  //   谁拿哪一对按「起点就近」排：p3 起点 3,5 离灯火最近 → 给灯火+晚风
  fairA: [[['晨光街', 0], ['月色街', 0]], [['东巷', 0], ['西巷', 0]], [['灯火街', 0], ['晚风街', 0]]],
  // fairB：同 fairA 配对，但把最热的一对给起点最南的 p3（3,5），并让 p1 拿中间那对。
  fairB: [[['晨光街', 0], ['月色街', 0]], [['灯火街', 0], ['晚风街', 0]], [['东巷', 0], ['西巷', 0]]],
  // fairC：不按街配对，按**单间店**配对（用茶铺/小店拆开），进一步压平：
  //   0.478+0.117=0.595 / 0.333+0.156=0.489 / 0.189+0.172=0.361 —— 实测比值 1.65
  fairC: [
    [['灯火街', 1], ['东巷', 1]],       // 0.478 + 0.117
    [['灯火街', 0], ['西巷', 0]],       // 0.333 + 0.156
    [['晨光街', 1], ['晨光街', 0]],     // 0.189 + 0.172 —— 同街，回到 ×1.4 老问题，故意留着当对照
  ],
  // fairD：单间配对，但保证两间不同街（不许靠 ×1.4 白拿）
  fairD: [
    [['灯火街', 1], ['东巷', 1]],       // 0.478 + 0.117
    [['灯火街', 0], ['西巷', 0]],       // 0.333 + 0.156
    [['晨光街', 1], ['月色街', 1]],     // 0.189 + 0.156
  ],
};

function layout(state, name) {
  const rows = TABLES[name];
  for (const pr of Object.values(state.properties)) pr.ownerId = null;
  state.players.forEach((p, i) => {
    p.properties = [];
    const [pos, facing] = POSE[i];
    p.position = pos; p.facing = facing; p.lastNode = null;
    for (const [street, idx] of rows[i]) {
      const id = P[street][idx];
      state.properties[id].ownerId = p.id; p.properties.push(id);
    }
  });
}

for (const name of Object.keys(TABLES)) {
  const bySeat = [{ w: 0, n: 0, rent: 0 }, { w: 0, n: 0, rent: 0 }, { w: 0, n: 0, rent: 0 }];
  const byStyle = Object.fromEntries(STYLES.map(s => [s, { w: 0, n: 0 }]));
  let paid = 0, games = 0, rentAll = 0, assets = 0;
  for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
    const st = startSession(createSliceConfig({ human: false, seed, style }));
    layout(st, name);
    games++;
    await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
    const winner = st.players.find(p => p.team === st.winnerTeam);
    for (const line of st.log) if (/实付租金 [1-9]/.test(line.text)) paid++;
    st.players.forEach((p, i) => {
      bySeat[i].n++; bySeat[i].w += p === winner ? 1 : 0; bySeat[i].rent += p.sliceStats.rentEarned;
      byStyle[p.style].n++; byStyle[p.style].w += p === winner ? 1 : 0;
      rentAll += p.sliceStats.rentEarned; assets += assetsOf(st, p);
    });
  }
  const seats = bySeat.map(s => pct(s.w, s.n));
  const styles = STYLES.map(s => pct(byStyle[s].w, byStyle[s].n));
  console.log(JSON.stringify({
    表: name, 局数: games,
    座位胜率: seats, 座位极差: +(Math.max(...seats) - Math.min(...seats)).toFixed(1),
    起手胜率: styles, 起手极差: +(Math.max(...styles) - Math.min(...styles)).toFixed(1),
    每位到账: bySeat.map(s => Math.round(s.rent / s.n)),
    每家收租: Math.round(rentAll / (games * 3)),
    每局真付租: +(paid / games).toFixed(2),
    终局资产: Math.round(assets / (games * 3)),
  }));
  console.log('   ' + TABLES[name].map((row, i) => `p${i + 1}:` + row.map(([s, x]) => s + x).join('+')).join('  |  '));
}
