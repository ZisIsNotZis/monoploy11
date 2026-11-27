// #3343 交付判据：三件事，缺一不可。
//   A 公平开局真的落到了产品路径上（不是只在我的探针里）
//   B seed 轮转真的让「人类座位拿到哪份」随 seed 变，而不是又绑死在下标上
//   C 默认路径一字未动（fair 为 false 时与 3342 相同）
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);
const STYLES = ['grow', 'take', 'cross'];

function held(state, p) {
  return p.properties.map(id => state.map.plots.find(pl => pl.id === id)?.name ?? id).sort().join('+');
}

console.log('=== A/B 产品路径上的公平开局 ===');
for (const seed of [1, 2, 3]) {
  const st = startSession(createSliceConfig({ human: false, seed, style: 'grow', fairStarts: true }));
  console.log(JSON.stringify({
    seed,
    p1: held(st, st.players[0]),
    p2: held(st, st.players[1]),
    p3: held(st, st.players[2]),
    p1位置: st.players[0].position, p2位置: st.players[1].position,
    三家店数: st.players.map(p => p.properties.length),
  }));
}

console.log('\n=== C 默认路径未变 ===');
{
  const a = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow' }));
  const b = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', fairStarts: false }));
  const sig = st => JSON.stringify(st.players.map(p => ({ pos: p.position, face: p.facing, props: [...p.properties].sort(), cash: p.cash, cards: p.cards })));
  console.log(JSON.stringify({ 默认与显式false相同: sig(a) === sig(b) }));
  console.log('   p1 拿到:', held(a, a.players[0]), '（应为 晨光街小店+晨光街茶铺）');
}

console.log('\n=== 公平开局的座位胜率（120 局/格） ===');
const SEEDS = Number(process.argv[2] ?? 120);
for (const fair of [false, true]) {
  const bySeat = [{ w: 0, n: 0, rent: 0 }, { w: 0, n: 0, rent: 0 }, { w: 0, n: 0, rent: 0 }];
  for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
    const st = startSession(createSliceConfig({ human: false, seed, style, fairStarts: fair }));
    await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
    const winner = st.players.find(p => p.team === st.winnerTeam);
    st.players.forEach((p, i) => { bySeat[i].n++; bySeat[i].w += p === winner ? 1 : 0; bySeat[i].rent += p.sliceStats.rentEarned; });
  }
  const seats = bySeat.map(s => pct(s.w, s.n));
  console.log(JSON.stringify({
    公平开局: fair, 座位胜率: seats,
    座位极差: +(Math.max(...seats) - Math.min(...seats)).toFixed(1),
    每位到账: bySeat.map(s => Math.round(s.rent / s.n)),
  }));
}
