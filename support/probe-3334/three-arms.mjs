// #3334 三臂对照：第一天「加盖 10,000」提示上的三条真实路线（唯一差别是这一下和下一张卡去哪）。
//   pay_here  ：现在花 10,000 升这间；下回合翻修卡打**另一间**（两间 Lv2，花 10,000）
//   pay_other ：现在花 10,000 升这间；下回合翻修卡打同一间（到 Lv3，花 10,000）
//   skip      ：不花；下回合翻修卡打这间（一间 Lv2，花 0）
// 之后全部交给 aiAnswer。走真实入口。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const N = Number(process.argv[2] ?? 40);
const styles = ['grow', 'cross'];
const ARMS = ['pay_here', 'pay_other', 'skip'];
const out = {};

async function play(seed, style, arm) {
  const state = startSession(createSliceConfig({ human: true, seed, style }));
  const human = state.players.find(p => p.controller === 'human');
  let shop = null, asked = false, cardPlan = null, cardDone = false, cardDay = null;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      const p = prompt.player;
      if (p?.controller === 'human' && prompt.type === 'build' && !asked) {
        asked = true; shop = prompt.plot.id;
        if (arm === 'pay_here' || arm === 'pay_other') {
          cardPlan = arm === 'pay_here'
            ? human.properties.find(id => id !== shop && (state.properties[id]?.level ?? 0) < (state.config.maxLevel ?? 3))
            : shop;
          return true;
        }
        cardPlan = shop;                       // skip：下回合免费升这间
        return false;
      }
      if (asked && !cardDone && cardPlan && p?.controller === 'human' && prompt.type === 'action' && p.cards.includes('worker')) {
        const lv = state.properties[cardPlan]?.level ?? 0;
        if (lv > 0 && lv < (state.config.maxLevel ?? 3)) { cardDay = state.day; return { action: 'card', index: p.cards.indexOf('worker') }; }
        cardDone = true;
      }
      if (asked && cardDay != null && !cardDone && prompt.type === 'target' && prompt.cardId === 'worker' && prompt.plotIds?.includes(cardPlan)) {
        cardDone = true; return cardPlan;
      }
      return aiAnswer(prompt, state);
    },
  });
  const winner = state.players.find(q => q.team === state.winnerTeam);
  return { asked, assets: assetsOf(state, human), cash: human.cash, shopLevel: shop ? state.properties[shop]?.level : null,
    otherLevels: human.properties.map(id => `${id}:${state.properties[id]?.level ?? 0}`),
    won: winner?.id === human.id, cardDay };
}

for (const style of styles) {
  const rows = [];
  for (let seed = 1; seed <= N; seed++) {
    const r = {};
    for (const arm of ARMS) r[arm] = await play(seed, style, arm);
    if (!r.pay_here.asked) continue;
    rows.push({ seed, ...r });
  }
  const sum = xs => xs.reduce((a, b) => a + b, 0);
  const stat = arm => ({
    wins: rows.filter(r => r[arm].won).length,
    meanAssets: rows.length ? Math.round(sum(rows.map(r => r[arm].assets)) / rows.length) : null,
    shopLv2: rows.filter(r => r[arm].shopLevel >= 2).length,
  });
  out[style] = {
    n: rows.length,
    ...Object.fromEntries(ARMS.map(a => [a, stat(a)])),
    vs_skip: Object.fromEntries(ARMS.filter(a => a !== 'skip').map(a => [a, {
      better: rows.filter(r => r[a].assets > r.skip.assets).length,
      worse: rows.filter(r => r[a].assets < r.skip.assets).length,
      equal: rows.filter(r => r[a].assets === r.skip.assets).length,
      mean: Math.round(sum(rows.map(r => r[a].assets - r.skip.assets)) / rows.length),
    }])),
    // 两臂之间真正的差别：pay_here 与 pay_other 都是 10,000，差别只是那张卡打哪
    here_vs_other: {
      hereBetter: rows.filter(r => r.pay_here.assets > r.pay_other.assets).length,
      otherBetter: rows.filter(r => r.pay_here.assets < r.pay_other.assets).length,
      equal: rows.filter(r => r.pay_here.assets === r.pay_other.assets).length,
      mean: Math.round(sum(rows.map(r => r.pay_here.assets - r.pay_other.assets)) / rows.length),
    },
  };
}
console.log(JSON.stringify(out, null, 1));
