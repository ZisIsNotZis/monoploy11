// #3340 探针 16：修正上一版量具（按 label 认路面格 → 多个格子同名，全collapse 成一个）。
//
// 改法：不再解析日志文本，直接在引擎 `ui.step(state, p, next)` 里拿**真实落点 id**。
// flow.js:303 `if (ui.step) await ui.step(state, p, next)` 每走一格都会调，next 就是格 id；
// 落点是最后一个 next（回合结束时停在的那格）。所以这里记「每位玩家每回合的最后 next」。
//
// 要分开的两件事：
//   A 几何：落点挨着几块地 —— 若平均几乎为 0，投资小店永远收不到租。
//   B 归属：挨着的地此刻归谁（我 / 对手 / 无主）。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const SEEDS = Number(process.argv[2] ?? 40);
const s = { games: 0, turns: 0, adjacent: 0, adjacentBig: 0, owner: { mine: 0, rival: 0, nobody: 0 }, rentRows: 0 };
const nodeHits = new Map();

for (const style of ['grow', 'take', 'cross']) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const state = startSession(createSliceConfig({ human: true, seed, style }));
    s.games++;
    let lastStep = null;
    await runGame(state, {
      render() {},
      async step(st, p, next) { lastStep = { id: next, playerId: p.id }; },
      async ask(prompt) {
        // 每次问「动作」之前，上一回合已经结束 —— 把上一回合的落点结算掉
        if (prompt.type === 'action' && lastStep) {
          const node = state.map.nodes.find(n => n.id === lastStep.id);
          s.turns++;
          nodeHits.set(node.id, (nodeHits.get(node.id) ?? 0) + 1);
          const adj = node.adjacentPlots ?? [];
          if (adj.length) {
            s.adjacent++;
            for (const id of adj) {
              const plot = state.map.plots.find(x => x.id === id);
              const pr = state.properties[id];
              if (plot?.big) s.adjacentBig++;
              if (!pr?.ownerId) s.owner.nobody++;
              else s.owner[pr.ownerId === lastStep.playerId ? 'mine' : 'rival']++;
            }
          }
          lastStep = null;
        }
        return aiAnswer(prompt, state);
      },
    });
    for (const e of state.log ?? []) if (/实付租金/.test(String(e.text))) s.rentRows++;
  }
}
const hits = [...nodeHits.entries()].sort((a, b) => b[1] - a[1]);
console.log(JSON.stringify({
  games: s.games,
  perGame: { turns: +(s.turns / s.games).toFixed(1), landingsAdjacentToAPlot: +(s.adjacent / s.games).toFixed(2),
    rentRows: +(s.rentRows / s.games).toFixed(2) },
  shareOfTurnsAdjacentToAPlot: +(100 * s.adjacent / Math.max(1, s.turns)).toFixed(1),
  adjacencyByOwner: s.owner,
  distinctLandingNodes: hits.length,
  topNodes: hits.slice(0, 10).map(([id, n]) => ({ id, perGame: +(n / s.games).toFixed(2) })),
}, null, 1));
