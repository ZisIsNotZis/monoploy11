// #3343：公平表把**收入**压平了（每位到账 6,575/7,988/7,052，差 22%），
// 但座位胜率反而更散（29.7/48.6/21.7，极差 26.9 vs 默认 16.9）。
// 收入不是胜负手 —— 这条把问题逼到「名次/行动顺序」上。
//
// 只动 state.order，其它全部不变（家当、位置、地块都不动）。三臂 × 两种开局表。
// 判据：若只轮转顺序就能让 0 号位胜率走满 20pp 以上，那座位偏差里剩下的都是**先后手**，
//       与开局表无关；那么任何「公平开局表」都不可能修掉它。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const SEEDS = Number(process.argv[2] ?? 120);
const STYLES = ['grow', 'take', 'cross'];
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

for (const fair of [false, true]) {
  const rows = [];
  for (const m of [0, 1, 2]) {
    let games = 0, seat0 = 0;
    const bySeat = [{ w: 0, n: 0 }, { w: 0, n: 0 }, { w: 0, n: 0 }];
    for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
      const st = startSession(createSliceConfig({ human: false, seed, style, fairStarts: fair }));
      if (m) st.order = st.order.map((_, i) => st.order[(i + m) % st.order.length]);
      games++;
      await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
      const winner = st.players.find(p => p.team === st.winnerTeam);
      seat0 += winner === st.players[0] ? 1 : 0;
      st.players.forEach((p, i) => { bySeat[i].n++; bySeat[i].w += p === winner ? 1 : 0; });
    }
    rows.push({ m, seat0: pct(seat0, games), bySeat: bySeat.map(s => pct(s.w, s.n)) });
  }
  const vals = rows.map(r => r.seat0);
  console.log(JSON.stringify({
    公平开局: fair,
    '0号位胜率_按顺序臂': rows.map(r => `${r.seat0}@m${r.m}`),
    顺序极差: +(Math.max(...vals) - Math.min(...vals)).toFixed(1),
    每臂的座位分布: rows.map(r => r.bySeat),
  }));
}
