// #3342 决定性问题：争街开局之后，玩家是不是真的多出一条**愿意试**的路？
//
// 「愿意试」不能靠胜率证明，但它有一个必要条件：那条路必须
//   ① 在真实对局里被走过（不是理论上可行）
//   ② 走了之后赢面不差于默认路（否则它不是「打法」，是陷阱）
// 所以做配对臂：同一批 seed、同一套 AI、同一份开局，只换**人类座位**（0 号位）的策略。
//
//   默认臂：完全交给 aiAnswer（引擎自己的判断）
//   补齐臂：只要走到「可以买下自家街另一半」的机会，就买 —— 这是争街开局独有的计划。
//
// 判据如果只读「补齐臂赢得多」是不够的：那条路可能只是「更会花钱」。
// 所以同时读：那条街最后归谁（独占 / 仍各一半）、每局触发几次、以及两臂的终局资产差。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buyPrice } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 40);
const STYLES = ['grow', 'take', 'cross'];

// 人类（0 号位）这条街的「另一半」：同街、无主或对手所有。
function halfStreet(state, human) {
  const mine = new Set(human.properties);
  const streets = new Set([...mine].map(id => state.properties[id]?.street).filter(Boolean));
  return state.map.plots.filter(pl => !pl.big && streets.has(pl.street) && !mine.has(pl.id));
}

async function play({ seed, style, contested, complete }) {
  const state = startSession(createSliceConfig({ human: false, seed, style, sliceContestedStreets: contested }));
  const human = state.players[0];
  const log = { buyPrompts: 0, bought: 0, streetWon: 0 };
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      const answer = aiAnswer(prompt, state);
      if (complete && prompt.player === human) {
        if (prompt.type === 'buy') {
          log.buyPrompts++;
          const targets = halfStreet(state, human).map(p => p.id);
          // 只在这块地确实是「补齐自家街」的那一块时改主意。
          if (targets.includes(prompt.plot.id) && human.cash >= prompt.price) { log.bought++; return true; }
        }
        // 收购卡也指向「自家街的另一半」。
        if (prompt.type === 'target' && prompt.cardId === 'buyland') {
          const targets = halfStreet(state, human).map(p => p.id);
          const hit = targets.find(id => (prompt.plotIds ?? [prompt.plot.id]).includes(id));
          if (hit) return hit;
        }
      }
      return answer;
    },
  });
  // 这条街最后归谁？
  const mine = new Set(human.properties);
  const streets = new Set([...mine].map(id => state.properties[id]?.street).filter(Boolean));
  for (const street of streets) {
    const all = state.map.plots.filter(pl => !pl.big && pl.street === street);
    if (all.every(pl => state.properties[pl.id]?.ownerId === human.id)) log.streetWon++;
  }
  return {
    state, human, log,
    winner: state.players.find(p => p.team === state.winnerTeam),
    assets: assetsOf(state, human),
  };
}

const STREETS = new Set();
for (const contested of [false, true]) {
  for (const complete of [false, true]) {
    const agg = { games: 0, humanWins: 0, assets: 0, bought: 0, prompts: 0, streetWon: 0 };
    for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
      const { human, log, winner, assets } = await play({ seed, style, contested, complete });
      agg.games++;
      agg.humanWins += winner?.id === human.id ? 1 : 0;
      agg.assets += assets; agg.bought += log.bought; agg.prompts += log.buyPrompts; agg.streetWon += log.streetWon;
    }
    const n = agg.games;
    console.log(JSON.stringify({
      争街: contested, 补齐策略: complete, 局数: n,
      人类胜率: +((100 * agg.humanWins) / n).toFixed(1),
      终局资产: Math.round(agg.assets / n),
      '每局可补齐提示': +(agg.prompts / n).toFixed(2),
      每局真买下另一半: +(agg.bought / n).toFixed(2),
      每局独占街数: +(agg.streetWon / n).toFixed(2),
    }));
  }
}
