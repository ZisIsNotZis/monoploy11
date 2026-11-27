// #3319: does the picker show the streets that matter to ME?
//
// The first version of this probe COPIED the renderer's sort key. That made it a mirror of
// my own assumption: after the fix it still reported 45/142 "best street not in top 4",
// because it kept sorting by |opponent change| while the shipped renderer had moved on.
// A probe that re-implements the thing it measures cannot tell you the thing changed.
//
// It now renders the REAL panel with the REAL renderer and reads the row order off the
// painted HTML, so "which streets are visible" is answered by the product, not by me.
import { createSliceConfig } from '../../../../src/data/slice.js';
import { startSession, runGame } from '../../../../src/engine/flow.js';
import { aiAnswer } from '../../../../src/engine/ai.js';
import { streetCardModel } from '../../../../src/engine/insight.js';
import { render } from '../../../../src/ui/render.js';

class El {
  constructor() { this.html=''; this.hidden=false; this.style={setProperty(){}};
    this.classList={add(){},remove(){},toggle(){}}; this.clientWidth=1000; this.clientHeight=800; }
  set innerHTML(v){this.html=v;} get innerHTML(){return this.html;}
  querySelectorAll(){return [];} querySelector(){return new El();} addEventListener(){} appendChild(){} remove(){}
}
const root = () => ({system:new El(),players:new El(),board:new El(),log:new El(),insight:new El(),
  dice:new El(),cards:new El(),hand:new El(),choice:new El()});
const actions = new Proxy({}, {get: () => () => {}});

const out = [];
for (const style of ['grow', 'take', 'cross']) {
  for (const seed of [1, 5, 7, 11, 23, 2, 3, 4]) {
    const state = startSession(createSliceConfig({ seed, style }));
    const human = state.players.find(p => p.controller === 'human');
    await runGame(state, {
      render(){}, async step(){}, async say(){},
      async ask(prompt) {
        if (prompt.type === 'target' && prompt.kind === 'street' && prompt.player?.id === human.id) {
          state.pending = { type: 'target', kind: 'street', cardId: prompt.cardId };
          state.mapPick = { plot: true, value: 'street', cardId: prompt.cardId, playerId: human.id };
          const r = root();
          render(r, state, actions);
          state.pending = null; state.mapPick = null;
          const rows = streetCardModel(state, human, prompt.cardId);
          // Row order as PAINTED, not as computed.
          const painted = [...r.choice.innerHTML.matchAll(/<li>(\S+?) 你/g)].map(m => m[1]);
          const net = x => prompt.cardId === 'inflate'
            ? (x.after.mine - x.mine) - (x.after.opponent - x.opponent)
            : (x.opponent - x.after.opponent) - (x.mine - x.after.mine);
          const byNet = rows.slice().sort((a, b) => net(b) - net(a));
          out.push({ style, seed, day: state.day, card: prompt.cardId,
            painted, bestByNet: byNet[0]?.street ?? null, bestNet: byNet[0] ? net(byNet[0]) : 0,
            // the ★ question: is the street that pays me most among the four I can see?
            bestVisible: byNet[0] ? painted.includes(byNet[0].street) : true,
            // and: does the first visible row cost me money?
            topHarms: painted.length ? (rows.find(x => x.street === painted[0]) ? net(rows.find(x => x.street === painted[0])) < 0 : false) : false,
          });
        }
        return aiAnswer(prompt, state);
      },
    });
  }
}
const miss = out.filter(f => !f.bestVisible);
const topBad = out.filter(f => f.card === 'inflate' && f.topHarms);
console.log(JSON.stringify({
  frames: out.length,
  bestNetOutsideVisibleRows: miss.length,
  inflateTopRowHarmsMe: topBad.length,
  examples: miss.slice(0, 4),
}, null, 1));
