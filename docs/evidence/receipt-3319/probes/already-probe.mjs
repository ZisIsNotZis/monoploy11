// #3319: a street already in 旺季 (inflate>0) or 停业 (closed>0):
// game.js:543/500 reset the timer to 3/2 — they do NOT stack — and rentFor already doubles/zeroes.
// So the picker's "用卡后 = 现在×2" is false for those rows. Count them in real play.
import { createSliceConfig } from '../../../../src/data/slice.js';
import { startSession, runGame } from '../../../../src/engine/flow.js';
import { aiAnswer } from '../../../../src/engine/ai.js';
import { streetCardModel } from '../../../../src/engine/insight.js';

let frames = 0, rowsOnScreen = 0, lyingRows = 0;
const examples = [];
for (const style of ['grow', 'take', 'cross']) {
  for (let seed = 1; seed <= 40; seed++) {
    const state = startSession(createSliceConfig({ seed, style }));
    const human = state.players.find(p => p.controller === 'human');
    await runGame(state, {
      render(){}, async step(){}, async say(){},
      async ask(prompt) {
        if (prompt.type === 'target' && prompt.kind === 'street' && prompt.player?.id === human.id) {
          frames++;
          const rows = streetCardModel(state, human, prompt.cardId);
          rows.sort((a, b) => Math.abs(b.after.opponent - b.opponent) - Math.abs(a.after.opponent - a.opponent));
          for (const r of rows.slice(0, 4)) {
            rowsOnScreen++;
            const active = prompt.cardId === 'inflate' ? r.inflate > 0 : r.closed > 0;
            if (!active) continue;
            const claims = r.after.opponent !== r.opponent || r.after.mine !== r.mine;
            if (claims) {
              lyingRows++;
              if (examples.length < 5) examples.push({ style, seed, day: state.day, card: prompt.cardId,
                street: r.street, inflate: r.inflate, closed: r.closed,
                opp: r.opponent, afterOpp: r.after.opponent, mine: r.mine, afterMine: r.after.mine });
            }
          }
        }
        return aiAnswer(prompt, state);
      },
    });
  }
}
console.log(JSON.stringify({ frames, rowsOnScreen, lyingRows, examples }, null, 1));
