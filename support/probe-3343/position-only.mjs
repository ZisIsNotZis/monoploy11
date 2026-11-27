// #3343：座位偏差的真正来源是**起点位置**，不是街的热度，也不是先手。
//
// 怎么怀疑到这一步的：fair-tables.mjs 里 `whole` 表（默认）读到座位胜率 [31.7, 46.1, 22.2]，
// 而 1 号位拿的是**最冷**的晚风街（每间每局 0.072 次）却赢得最多。
// 所以「拿到哪条街」解释不了它。factorial.mjs 已经把「先手」单独量过（18.0pp，小于内容 31.7pp）。
// 剩下的候选就是起点：三个起点是 (3,2)/(8,2)/(3,5)，而书屋在 (5-6,3-4)、发薪处 (2,2)、零工 (10,2)。
// 它们到书屋的距离完全不同 —— 玩家开局第一屏就在盘算「几天内够得着书屋」。
//
// 这个脚本只动一件事：**谁从哪个位置出发**。家当（街、手牌、现金、起手）留在原地。
// 于是 3 个位置 × 3 个玩家 = 9 格，读出每个位置的胜率，与「谁坐这个位置」无关的部分。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const STYLES = ['grow', 'take', 'cross'];
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

const POSE = [
  { position: '3,2', facing: '4,2' },
  { position: '8,2', facing: '7,2' },
  { position: '3,5', facing: '4,5' },
];

// m 号位「起点被换成 POSE[(自己下标 + m) % 3]」，家当不动。
const START = process.env.START ?? '8,2';

function reroute(state, m) {
  state.players.forEach((p, i) => {
    const src = POSE[(i + m) % 3];
    if (!src) return;
    p.position = src.position; p.facing = src.facing; p.lastNode = null;
  });
}

// 也量一个候选的对称起点集：三个位置距离书屋相同。
// 书屋占 (5,3)(6,3)(5,4)(6,4)；它的邻接道路是 (4,3)(7,3)(5,2)(6,2)(4,4)(7,4)(5,5)(6,5)。
// 对称三选：北 (5,2) · 西南 (4,4) · 东南 (7,4) —— 三者到书屋都 1 步。
const SYM = [
  { position: '5,2', facing: '5,3' },
  { position: '4,4', facing: '5,4' },
  { position: '7,4', facing: '6,4' },
];

function rerouteSet(state, m, set) {
  state.players.forEach((p, i) => {
    const src = set[(i + m) % 3];
    if (!src) return;
    p.position = src.position; p.facing = src.facing; p.lastNode = null;
  });
}

for (const [label, set] of [['原三点', POSE], ['对称三点', SYM]]) {
  const grid = {};
  for (const m of [0, 1, 2]) {
    let games = 0, seat0 = 0, assets = 0;
    const byPos = {};
    for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
      const st = startSession(createSliceConfig({ human: false, seed, style }));
      rerouteSet(st, m, set);
      const startPos = st.players.map(p => p.position);
      games++;
      await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
      const winner = st.players.find(p => p.team === st.winnerTeam);
      seat0 += winner === st.players[0] ? 1 : 0;
      for (const p of st.players) assets += assetsOf(st, p);
      // 按「这个人从哪个格子出发」记胜率 —— 与他是 0/1/2 号位无关。
      st.players.forEach((p, i) => {
        const k = startPos[i];
        byPos[k] ??= { n: 0, w: 0 };
        byPos[k].n++; byPos[k].w += p === winner ? 1 : 0;
      });
    }
    grid[`m${m}`] = pct(seat0, games);
    console.log(JSON.stringify({
      起点集: label, 轮转: m, 局数: games,
      '0号位胜率': pct(seat0, games),
      按起点格子: Object.fromEntries(Object.entries(byPos).map(([k, v]) => [k, pct(v.w, v.n)])),
    }));
  }
  const vals = Object.values(grid);
  console.log(JSON.stringify({ 起点集: label, 三臂: Object.values(grid), 极差: +(Math.max(...vals) - Math.min(...vals)).toFixed(1) }));
}
