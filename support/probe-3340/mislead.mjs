// #3340 探针 21：那一屏（定步 / 岔路）把「己方 · 租 N」印在**我自己的店**上，而停在自己的店旁
// 引擎一分钱都不收（flow.js：只有 owner.team !== p.team 才走付租分支；#3338 已实测 31/31 局）。
//
// 这一屏是全游戏**唯一**由玩家直接选落点的地方。若屏上最大那个数（租 N）在落点是自己店时
// 永远不兑现，玩家就是在按一个不会发生的数做选择 —— 与 #3339 修的是同一个病（单位/前提），
// 只是这次在「选落点」这一屏，而且方向相反：那条把「次数」叫成「回合」，这条把「别人的收入」
// 印成「你的落点收益」。
//
// 量三件事：
//   1. 人类每局看到多少次这种「己方 · 租」的落点行
//   2. 其中有多少次它是该点数下**唯一**的落点信息（即玩家只能靠它做决定）
//   3. 有多少次「己方 · 租」比同屏所有对手租都高（最容易把玩家拉过去）
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { reachableLandings, landingInfo } from '../../src/engine/insight.js';
import { rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 40);
const s = { games: 0, diceScreens: 0, steps: 0, ownRows: 0, ownOnly: 0, ownTop: 0, ownRentSum: 0, rivalRows: 0 };
let sample = null;

for (const style of ['grow', 'take', 'cross']) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const state = startSession(createSliceConfig({ human: true, seed, style }));
    s.games++;
    await runGame(state, {
      render() {}, async step() {},
      async ask(prompt) {
        if (prompt.player?.controller !== 'human') return aiAnswer(prompt, state);
        if (prompt.type === 'diceValue') {
          s.diceScreens++;
          for (let n = (prompt.min ?? 1); n <= (prompt.max ?? 6); n++) {
            const ids = reachableLandings(state, prompt.player, n);
            if (!ids.length) continue;
            s.steps++;
            // 该点数下所有落点里的「己方租」与「对手租」
            let ownMax = 0, rivalMax = 0, ownCount = 0, anythingElse = 0;
            for (const id of ids) {
              const info = landingInfo(state, prompt.player, id);
              for (const p of info.plots) {
                if (p.own) { ownCount++; ownMax = Math.max(ownMax, p.rent); }
                else if (p.owner) rivalMax = Math.max(rivalMax, p.rent);
                else anythingElse++;
              }
              if (!info.plots.length) anythingElse++;
            }
            if (ownCount) {
              s.ownRows++; s.ownRentSum += ownMax;
              // 「只有它」：这个点数下除自家店外没有别的落点信息
              if (!rivalMax && !anythingElse) s.ownOnly++;
              // 「最大声」：自家那个数比同屏所有对手租都高
              if (ownMax > rivalMax && ownMax > 0) s.ownTop++;
              if (!sample && ownMax > rivalMax) sample = { style, seed, day: state.day, step: n, ownMax, rivalMax,
                text: ids.map(id => ({ id, t: landingInfo(state, prompt.player, id).plots.map(p => `${p.name}:${p.own ? '己方' : p.owner}·租${p.rent}`).join('/') || '无地' })) };
            }
            if (rivalMax) s.rivalRows++;
          }
          return 6;                       // 与 AI 同口径，不改变玩法
        }
        return aiAnswer(prompt, state);
      },
    });
  }
}
console.log(JSON.stringify({
  games: s.games,
  diceScreensPerGame: +(s.diceScreens / s.games).toFixed(2),
  stepOptionsPerGame: +(s.steps / s.games).toFixed(1),
  // 「该点数下最高租金来自我自己的店」的比例
  shareOfStepOptionsWithOwnRent: +(100 * s.ownRows / Math.max(1, s.steps)).toFixed(1),
  shareWhereOwnRentIsTheLoudest: +(100 * s.ownTop / Math.max(1, s.ownRows)).toFixed(1),
  shareWhereOwnRentIsTheOnlyInfo: +(100 * s.ownOnly / Math.max(1, s.ownRows)).toFixed(1),
  meanOwnRentShownWhenItIsLoudest: Math.round(s.ownRentSum / Math.max(1, s.ownRows)),
  sample,
}, null, 1));
