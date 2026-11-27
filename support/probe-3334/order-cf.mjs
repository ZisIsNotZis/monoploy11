// #3334 同局反事实：第一天那个「加盖 10,000」提示上的两条真路线。
//
//   A（付）：现在花 10,000 把这间店升到 2 级，翻修卡留着（本回合出牌阶段已过，卡还在手上）。
//   B（不付）：不付；到自己下个回合的出牌阶段，用翻修卡**免费**升同一间。
// 两臂之后都交给同一套 aiAnswer。于是差异只剩：早了多久、花了多少现金、卡还在不在。
//
// 走真实入口（createSliceConfig → startSession → runGame），与浏览器同一路径。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor } from '../../src/engine/economy.js';

const N = Number(process.argv[2] ?? 40);
const styles = ['grow', 'cross'];
const rows = [];

function play(seed, style, arm) {
  const state = startSession(createSliceConfig({ human: true, seed, style }));
  const human = state.players.find(p => p.controller === 'human');
  let forcedPay = false, cardPlanned = false, cardSpent = false, cardTarget = null, shop = null;
  const marks = { paidDay: null, cardDay: null, rentBefore: 0, rentAfter: 0 };

  return runGame(state, {
    render() {},
    async step() {},
    async ask(prompt) {
      const p = prompt.player;
      if (p?.controller === 'human' && prompt.type === 'build' && !forcedPay) {
        forcedPay = true;
        shop = prompt.plot.id;
        marks.paidDay = state.day;
        if (arm === 'pay') { marks.rentAfter = (() => { const pr = state.properties[shop], lv = pr.level; pr.level = lv + 1; const r = rentFor(state, shop); pr.level = lv; return r; })(); return true; }
        // B：拒绝，并计划下回合免费翻修同一间
        cardPlanned = true;
        cardTarget = prompt.plot.id;
        return false;
      }
      // B 臂：到自己下个回合的动作屏，第一件事就是把翻修卡打到同一间
      if (arm === 'skip' && cardPlanned && !cardSpent && p?.controller === 'human' && prompt.type === 'action') {
        const idx = p.cards.indexOf('worker');
        const lv = state.properties[cardTarget]?.level ?? 0;
        if (idx >= 0 && lv > 0 && lv < (state.config.maxLevel ?? 3)) {
          cardSpent = true; marks.cardDay = state.day;
          return { action: 'card', index: idx };
        }
        cardPlanned = false;
      }
      if (arm === 'skip' && cardSpent && marks.cardDay != null && prompt.type === 'target' && prompt.cardId === 'worker' && !marks.cardTargetDone) {
        marks.cardTargetDone = true;
        return cardTarget;
      }
      return aiAnswer(prompt, state);
    },
  }).then(() => {
    const winner = state.players.find(q => q.team === state.winnerTeam);
    return {
      assets: assetsOf(state, human), cash: human.cash,
      levels: human.properties.map(id => state.properties[id]?.level ?? 0),
      shopLevel: shop ? state.properties[shop]?.level : null,
      keptWorker: human.cards.includes('worker'),
      won: winner?.id === human.id, day: state.day,
      paidDay: marks.paidDay, cardDay: marks.cardDay,
    };
  });
}

for (const style of styles) for (let seed = 1; seed <= N; seed++) {
  const a = await play(seed, style, 'pay');
  const b = await play(seed, style, 'skip');
  if (a.paidDay == null) { rows.push({ seed, style, asked: false }); continue; }
  rows.push({
    asked: true, seed, style, day: a.paidDay,
    pay: { assets: a.assets, cash: a.cash, shopLevel: a.shopLevel, levels: a.levels, keptWorker: a.keptWorker, won: a.won },
    skip: { assets: b.assets, cash: b.cash, shopLevel: b.shopLevel, levels: b.levels, keptWorker: b.keptWorker, won: b.won, cardDay: b.cardDay },
    dAssets: a.assets - b.assets, dCash: a.cash - b.cash,
  });
}

const asked = rows.filter(r => r.asked);
const sum = xs => xs.reduce((x, y) => x + y, 0);
const byStyle = Object.fromEntries(styles.map(s => {
  const g = asked.filter(r => r.style === s);
  return [s, {
    n: g.length,
    payWins: g.filter(r => r.pay.won).length, skipWins: g.filter(r => r.skip.won).length,
    meanDAssets: g.length ? sum(g.map(r => r.dAssets)) / g.length : null,
    payBetter: g.filter(r => r.dAssets > 0).length,
    skipBetter: g.filter(r => r.dAssets < 0).length,
    equal: g.filter(r => r.dAssets === 0).length,
    meanDPayShopLevel: g.length ? sum(g.map(r => (r.pay.shopLevel ?? 0) - (r.skip.shopLevel ?? 0))) / g.length : null,
    cardBackLog: g.filter(r => r.skip.cardDay == null).length, // B 臂没机会出卡（说明计划落空）
  }];
}));
console.log(JSON.stringify({
  summary: {
    asked: asked.length,
    payWins: asked.filter(r => r.pay.won).length, skipWins: asked.filter(r => r.skip.won).length,
    meanDAssets: sum(asked.map(r => r.dAssets)) / Math.max(1, asked.length),
    meanDCash: sum(asked.map(r => r.dCash)) / Math.max(1, asked.length),
    payBetter: asked.filter(r => r.dAssets > 0).length,
    skipBetter: asked.filter(r => r.dAssets < 0).length,
    equal: asked.filter(r => r.dAssets === 0).length,
    byStyle,
  },
  rows,
}, null, 1));
