// #3340 探针 22：改后同一屏还剩多少「不会兑现的数」？—— 这是本片的验收读数。
//
// 与 mislead.mjs 同一口径（定步屏的每个点选项、120 局），但读的是**产品真渲染出来的句子**
// （landingText），不是我自己拼的。判据：
//   ownRentShown  句子把「自己的店」印成一个租金      → 改前 25.1% 的点选项，改后必须 0
//   ownBuildShown 句子把「自己的店」印成可加盖/不收租 → 改后应该 >0（说明那一支真的会说人话）
//   rivalPayShown 对手的店仍写明「付租 N」            → 必须 >0（防误伤）
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { reachableLandings, landingText } from '../../src/engine/insight.js';

const SEEDS = Number(process.argv[2] ?? 40);
const s = { games: 0, steps: 0, ownRentShown: 0, ownBuildShown: 0, rivalPayShown: 0, samples: [] };

for (const style of ['grow', 'take', 'cross']) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const state = startSession(createSliceConfig({ human: true, seed, style }));
    s.games++;
    await runGame(state, {
      render() {}, async step() {},
      async ask(prompt) {
        if (prompt.player?.controller !== 'human') return aiAnswer(prompt, state);
        if (prompt.type === 'diceValue') {
          for (let n = (prompt.min ?? 1); n <= (prompt.max ?? 6); n++) {
            for (const id of reachableLandings(state, prompt.player, n)) {
              s.steps++;
              const text = landingText(state, prompt.player, id);
              // 「自己的店 + 一个租数」= 不会兑现的那种写法
              if (/你的店[^/；]*租\s*[\d,]+/.test(text)) {
                s.ownRentShown++;
                if (s.samples.length < 3) s.samples.push(text);
              }
              if (/你的店[^/；]*可加盖\s*[\d,]+/.test(text) || /自己停在这里不收租/.test(text)) s.ownBuildShown++;
              if (/付租\s*[\d,]+/.test(text)) s.rivalPayShown++;
            }
          }
          return 6;
        }
        return aiAnswer(prompt, state);
      },
    });
  }
}
console.log(JSON.stringify({
  games: s.games, stepOptions: s.steps,
  ownShopPrintedWithARent: s.ownRentShown,
  ownShopPrintedWithWhatItDoes: s.ownBuildShown,
  rivalShopPrintedWithWhatIPay: s.rivalPayShown,
  samples: s.samples,
}, null, 1));
