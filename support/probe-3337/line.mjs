// #3337 探针 22：新 nextGameLine 在真整局上的输出（逐条人工校对）。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { sliceResults } from '../../src/ui/slice.js';

const out = [];
for (const style of ['grow', 'take', 'cross']) {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const state = startSession(createSliceConfig({ human: true, seed, style }));
    await runGame(state, {
      render() {}, async step() {},
      async ask(prompt) { return aiAnswer(prompt, state); },
    });
    state.phase = 'over';
    const html = sliceResults(state);
    const m = /data-next-game[^>]*>(.*?)<\/p>/s.exec(html);
    const human = state.players.find(p => p.controller === 'human');
    out.push({ style, seed, day: state.day, alive: human.alive, win: human.team === state.winnerTeam,
      line: m ? m[1].replace(/<[^>]*>/g, '') : 'MISSING' });
  }
}
console.log(JSON.stringify(out, null, 1));
