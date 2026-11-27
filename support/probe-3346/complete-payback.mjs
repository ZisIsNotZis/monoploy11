// #3346b：为什么「为了补齐一条街而收购」在真实对局里是负期望 —— 用**次数**说清楚。
//
// 一笔补齐收购买的是什么（economy.js rentFor，切片每街恰好 2 块）：
//   拿下另一半前：己方那块 chain = 1 + 0.4×(1−1) = 1.0
//   拿下后：      两块的 chain 都是 1 + 0.4×(2−1) = 1.4
//   ⇒ 每被对手踩到一次，多收 = 买到那块 0.4×base + 己方那块 0.4×base
//      （base = 2000×2^(level−1)；Lv1 就是 800 + 800 = 1,600/次）
//   而代价 = 标价 × 125% = 10,000（Lv1 小店）。
//   ⇒ 回本门槛 ≈ 10,000 / 1,600 ≈ 6.3 次「对手踩到这两块之一」。
//
// 这一支不改任何规则，只在对局里数：16 天里对手到底踩了这两块几次。
// 若实测次数远小于门槛，那么「补齐」不成立的原因不是 AI 保守，是**分母太小**。
//
// 用法：node support/probe-3346/complete-payback.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;

// 数「对手踩到我这两块」：在 step 回调里看每一步落在哪个节点，
// 该节点的相邻地产里有我自己的、由别人付租即可。这里直接数**落点相邻**，
// 因为租金是在落点结算的（flow.js 的 landing 阶段）。
async function play(seed) {
  const style = 'take';
  const others = SLICE_STYLES.filter(s => s.id !== style).map(s => s.id);
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...others].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  const myStreets = new Set(seat0.properties.map(id => state.properties[id].street));
  let decisions = 0;
  // 每一步都看：走的人是别人，落点相邻的地产里有没有我这条街的（= 会付租给我）
  await runGame(state, {
    render() {}, async step(s, actor, nodeId) {
      if (actor.id === seat0.id) return;
      const node = s.map.nodes.find(n => n.id === nodeId);
      for (const plotId of node?.adjacentPlots ?? []) {
        const pr = s.properties[plotId];
        if (pr?.ownerId === seat0.id && myStreets.has(pr.street)) visits.set(plotId, (visits.get(plotId) ?? 0) + 1);
      }
    },
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      return aiAnswer(prompt, state);
    },
  });
  // 终局：我占了几条街的 2/2（= 补齐成功过）
  const completed = [...myStreets].filter(street => {
    const own = Object.keys(state.properties).filter(id => state.properties[id].street === street && state.properties[id].ownerId === seat0.id);
    return own.length === 2;
  });
  return { visits: [...visits.values()], completed: completed.length, myStreets: myStreets.size };
}

const visits = new Map();
const rows = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  visits.clear();
  rows.push(await play(seed));
}
// 把每局每块地的次数摊开
const perPlot = rows.flatMap(r => r.visits);
const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sorted = [...perPlot].sort((a, b) => a - b);
const q = f => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : 0;

console.log(`take 起手，争街，${SEEDS} 局（AI 对 AI），只数「对手踩到我自家那条街」的次数`);
console.log(`  局数 ${rows.length}，统计的地块-局样本 ${perPlot.length}`);
console.log(`  每块我自己的地，16 天里被对手踩到：均值 ${mean(perPlot).toFixed(2)} 次`
  + ` 中位 ${q(0.5)}  p90 ${q(0.9)}  最大 ${sorted[sorted.length - 1] ?? 0}`);
console.log(`  一局里我两条街合计被踩：${mean(rows.map(r => r.visits.reduce((a, b) => a + b, 0))).toFixed(2)} 次`);
console.log(`  终局时已补齐（2/2）的街：均值 ${mean(rows.map(r => r.completed)).toFixed(2)} 条 / 我占 ${mean(rows.map(r => r.myStreets)).toFixed(2)} 条街`);
console.log('');
console.log('回本门槛（Lv1，收购价 10,000，每踩一次多收 1,600）：约 6.3 次');
console.log(`实测每次补齐能等到的踩踏次数 ≈ ${mean(perPlot).toFixed(2)} 次 ⇒ 缺口约 ${(10_000 / 1_600 / Math.max(0.01, mean(perPlot))).toFixed(1)} 倍`);
