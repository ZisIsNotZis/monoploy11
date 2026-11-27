// #3391：为什么「补齐一条街」无论怎么加乘数都救不了 —— 因为它缺的不是乘数，是**落点次数**。
//
// rentFor（economy.js）只在**有人停到这块地**时才收租。所以一块地的产出 =
//   每次租金 × 整局被停到的次数。
// 后一项由几何决定：地块相邻几个格，就有几条边可以被踩中。
//   小店   cells 1 格 ⇒ 相邻节点 2 个（地图上每块小店都贴着一条路）
//   书屋   cells 4 格 ⇒ 相邻节点 ? 个（#3346 yield-per-yuan 说 8 个）
// 这一支把两件事分别印出来：
//   1. 静态几何：每块地的相邻格数（frontage），以及整张地图上「踩到它」的概率（1/格数之和）。
//   2. 实测：120 局里每块地被踩到的次数（按地块分组）。
// 若书屋的踩中次数是小店的 2–4 倍，那么「补齐一条街」把 2 块小店都补齐也只拿到
// 2 份小店的机会，而同一条街的收入上限仍远低于书屋一份 —— 乘数怎么加都追不上。
//
// 用法：node support/probe-3346/frontage-audit.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);

// ---- 1. 静态几何 ----------------------------------------------------------
{
  const state = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: true }));
  console.log('静态几何（每块地的相邻格 = 能被踩中的边）');
  for (const plot of state.map.plots) {
    const fronts = state.map.nodes.filter(n => n.adjacentPlots?.includes(plot.id)).length;
    console.log(`  ${(plot.name).padEnd(8)} ${plot.big ? '大' : '小'} 相邻格 ${String(fronts).padStart(2)}  格数 ${plot.cells.length}`);
  }
}

// ---- 2. 实测：每块地被踩到的次数 ------------------------------------------
// 用 AI 对 AI、0 号位 take（手持收购，但不强用），只**数**不干预。
const hits = new Map();
const rooms = new Map();

for (let seed = 1; seed <= SEEDS; seed++) {
  const style = 'take';
  const others = SLICE_STYLES.filter(s => s.id !== style).map(s => s.id);
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...others].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  let decisions = 0;
  await runGame(state, {
    render() {}, async step(s, actor, nodeId) {
      // 落点结算时，该节点的每一块相邻地产都「被踩到」一次（无论谁付钱）
      const node = s.map.nodes.find(n => n.id === nodeId);
      for (const plotId of node?.adjacentPlots ?? []) hits.set(plotId, (hits.get(plotId) ?? 0) + 1);
    },
    async ask(prompt) {
      if (++decisions > 5000) throw new Error('Decision limit exceeded');
      return aiAnswer(prompt, state);
    },
  });
  for (const plot of state.map.plots) {
    const r = rentFor(state, plot.id);
    if (!rooms.has(plot.id)) rooms.set(plot.id, []);
    rooms.get(plot.id).push(r);
  }
}

console.log(`\n实测（${SEEDS} 局，任意玩家落点即算「踩到」该块地）`);
const byBig = { 小: [], 大: [] };
for (const plot of startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: true })).map.plots) {
  const n = (hits.get(plot.id) ?? 0) / SEEDS;
  byBig[plot.big ? '大' : '小'].push(n);
  console.log(`  ${plot.name.padEnd(8)} ${plot.big ? '大' : '小'} 每局被踩 ${n.toFixed(2)} 次`);
}
const avg = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
console.log(`\n  小店平均 每局被踩 ${avg(byBig.小).toFixed(2)} 次（${byBig.小.length} 块）`);
console.log(`  书屋      每局被踩 ${avg(byBig.大).toFixed(2)} 次（${byBig.大.length} 块）`);
console.log(`  ⇒ 倍数 ${(avg(byBig.大) / Math.max(0.01, avg(byBig.小))).toFixed(2)}×`);
console.log('\n（一条街 2 块小店全补齐 = 2 份小店机会；书屋一份 = 上面那个倍数份。乘数只在同街内生效，追不上。）');
