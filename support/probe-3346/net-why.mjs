// #3346：AI 为什么在 317 次「三道硬闸都过了」的提示里一次都不选收购？
//
// 硬闸已经数清（buyland-gates.mjs，take 20 局 / 548 次动作屏）：
//   有收购卡 548、有合法目标 497、现金够 358、不在最后 3 天 444、三道全过 317
//   而 AI 实际选中 **0** 次。
// 所以挡住它的不是那三道，是 slice-ai.js plotTargets 里最后那道**净收益估值**：
//   net = 未来租金 × 1.5 + 免掉的租金 − 相对成本 − 500，要求 net > 0
// 这一支把这条式子的每一项在真实决策点上印出来，看是哪一项把它压到 0 以下。
//
// 口径与 slice-ai.js 完全一致（同一批公式、同样只读），只是加打印。
// 若有人改了那边而没改这里，两个数会不一样 —— 那本身就是信号。
//
// 用法：node support/probe-3346/net-why.mjs [10]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { acquisitionPrice, buyPrice, rentFor } from '../../src/engine/economy.js';
import { reachableLandings, sliceTargetIds } from '../../src/engine/insight.js';

const SEEDS = Number(process.argv[2] ?? 10);
const DECISION_LIMIT = 5000;
const reserve = state => (state.day > 12 ? 3000 : 9000);

function landingExposure(state, players) {
  const exposure = new Map();
  for (const player of players) for (let steps = 1; steps <= 6; steps++) {
    const nodes = reachableLandings(state, player, steps);
    for (const id of nodes) exposure.set(id, (exposure.get(id) ?? 0) + 1 / (6 * nodes.length));
  }
  return exposure;
}

const samples = [];

for (let seed = 1; seed <= SEEDS; seed++) {
  const style = 'take';
  const others = SLICE_STYLES.filter(s => s.id !== style).map(s => s.id);
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true, participants: null });
  const wanted = [style, others[0], others[1]];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const me = state.players[0];
  let decisions = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      if (prompt.type === 'action' && prompt.player?.id === me.id && me.cards.includes('buyland')
          && (me.sliceCardsUsed ?? 0) < 2) {
        const ids = sliceTargetIds(state, me, 'buyland');
        if (ids.length) {
          // 复算 slice-ai.js 的估值（只读）。
          const enemies = state.players.filter(p => p.alive && p.team !== me.team);
          const enemyExposure = landingExposure(state, enemies);
          const selfExposure = landingExposure(state, [me]);
          for (const plotId of ids) {
            const pr = state.properties[plotId];
            const price = acquisitionPrice(state, plotId);
            const fronts = state.map.nodes.filter(n => n.adjacentPlots?.includes(plotId));
            const nextEnemyVisits = fronts.reduce((s, n) => s + (enemyExposure.get(n.id) ?? 0), 0);
            const selfVisit = fronts.reduce((s, n) => s + (selfExposure.get(n.id) ?? 0), 0);
            const remaining = Math.max(0, state.config.dayLimit - state.day - (pr?.closed ?? 0));
            const futureVisits = Math.max(0, remaining - 1) * fronts.length / state.map.nodes.length * enemies.length * 0.6;
            const hypothetical = { ...state, properties: { ...state.properties, [plotId]: { ...pr, ownerId: me.id, closed: 0, inflate: 0 } } };
            const baseRent = rentFor(hypothetical, plotId);
            const futureIncome = baseRent * (nextEnemyVisits + futureVisits);
            const avoidedRent = pr?.ownerId ? rentFor(state, plotId) * selfVisit : 0;
            const premium = price - buyPrice(state, plotId);
            const relativeCost = premium * (pr?.ownerId ? 2 : 1);
            const net = futureIncome * (pr?.ownerId ? 1.5 : 1) + avoidedRent - relativeCost - 500;
            samples.push({ day: state.day, plotId, price, mark: buyPrice(state, plotId), baseRent,
              nextEnemyVisits: +nextEnemyVisits.toFixed(3), futureVisits: +futureVisits.toFixed(2),
              futureIncome: Math.round(futureIncome), avoidedRent: Math.round(avoidedRent),
              premium, relativeCost, net: Math.round(net) });
          }
        }
      }
      return aiAnswer(prompt, state);
    },
  });
}

const pos = samples.filter(s => s.net > 0);
console.log(`收集到 ${samples.length} 个「有合法收购目标」的候选，net > 0 的 ${pos.length} 个`);
const mean = k => Math.round(samples.reduce((a, s) => a + s[k], 0) / (samples.length || 1));
console.log(`均值：价 ${mean('price')} · 标价 ${mean('mark')} · 溢价 ${mean('premium')}`
  + ` · 这块地一次租金 ${mean('baseRent')} · 未来收入 ${mean('futureIncome')}`
  + ` · 相对成本 ${mean('relativeCost')} · **net ${mean('net')}**`);
console.log('\n前 12 个样本：');
for (const s of samples.slice(0, 12)) console.log('  ' + JSON.stringify(s));
const best = samples.slice().sort((a, b) => b.net - a.net)[0];
if (best) console.log('\n最好的一个：' + JSON.stringify(best));
