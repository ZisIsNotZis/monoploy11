// #3342 座位偏差：配对臂里 0 号位胜率从 31.7% 跳到 44.4%，这可能是**先手优势**，
// 也可能是我的量法（0 号位永远拿同一批起点/起手）有偏。
//
// 判据：把三种起手轮着放到 0 号位（也就是真实人类会坐的那个位置），
// 分别读「0 号位胜率」和「各起手胜率」。若争街布局只是让**先手**更强，
// 那 0 号位在三种起手下都应该高；若只是布局不中立，则会随起手摆动。
import { createSliceConfig, SLICE_STYLES } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const SEEDS = Number(process.argv[2] ?? 40);
const STYLES = ['grow', 'take', 'cross'];
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

for (const contested of [false, true]) {
  // contested=true 走 data/slice.js 里当前的 STARTS_CONTESTED。
  let seat0 = 0, games = 0;
  const byStyleSeat0 = Object.fromEntries(STYLES.map(s => [s, { g: 0, w: 0 }]));
  const anySeat = Object.fromEntries(STYLES.map(s => [s, { g: 0, w: 0 }]));
  for (const first of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
    const config = createSliceConfig({ human: false, seed, style: first, sliceContestedStreets: contested });
    const state = startSession(config);
    await runGame(state, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, state); } });
    const winner = state.players.find(p => p.team === state.winnerTeam);
    games++;
    if (winner === state.players[0]) { seat0++; byStyleSeat0[first].w++; }
    byStyleSeat0[first].g++;
    for (const p of state.players) { anySeat[p.style].g++; if (p === winner) anySeat[p.style].w++; }
  }
  console.log(JSON.stringify({
    争街: contested, 局数: games,
    '0号位胜率': pct(seat0, games),
    '0号位按起手': Object.fromEntries(STYLES.map(s => [s, pct(byStyleSeat0[s].w, byStyleSeat0[s].g)])),
    各起手胜率_不分座位: Object.fromEntries(STYLES.map(s => [s, pct(anySeat[s].w, anySeat[s].g)])),
  }));
}
