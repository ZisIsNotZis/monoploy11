// #3337 探针 16：街心书屋（26,000，第 4 天开售）—— 能买就买 vs 照常。
// 只看引擎真值：买下后 rentFor('market') 多少、每次收租是否给卡（game.js 的书屋规则）。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 300);

async function play(style, seed, force) {
  const state = startSession(createSliceConfig({ human: true, seed, style }));
  const me = () => state.players.find(p => p.controller === 'human');
  const f = { offers: 0, bought: 0, firstDay: null, price: null, cashAt: null };
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (prompt.player?.controller !== 'human') return aiAnswer(prompt, state);
      const p = prompt.player;
      if (prompt.type === 'buy' && prompt.plot?.big) {
        f.offers++; f.firstDay ??= state.day; f.price = prompt.price; f.cashAt ??= p.cash;
        if (force && p.cash >= prompt.price) { f.bought++; return true; }
        const ans = aiAnswer(prompt, state);
        if (ans) f.bought++;
        return ans;
      }
      return aiAnswer(prompt, state);
    },
  });
  const p = me();
  return { assets: assetsOf(state, p), win: p.team === state.winnerTeam, ...f,
    ownsMarket: state.properties.market?.ownerId === p.id,
    marketRent: state.properties.market?.ownerId ? rentFor(state, 'market') : 0,
    hand: p.cards.length, cardsPlayed: p.sliceStats.cardsPlayed };
}

const rows = [];
for (const style of ['grow', 'take', 'cross']) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const base = await play(style, seed, false);
    const arm = await play(style, seed, true);
    rows.push({ style, seed, base, arm, d: arm.assets - base.assets });
  }
}
const mean = (a, f) => a.length ? +(a.reduce((s, r) => s + f(r), 0) / a.length).toFixed(1) : null;
const cmp = a => {
  const d = a.map(r => r.d);
  const onlyArm = a.filter(r => r.arm.win && !r.base.win).length;
  const onlyBase = a.filter(r => !r.arm.win && r.base.win).length;
  return { n: a.length, dAssetsMean: d.length ? Math.round(d.reduce((x, y) => x + y, 0) / d.length) : null,
    better: d.filter(x => x > 0).length, worse: d.filter(x => x < 0).length,
    win: { base: a.filter(r => r.base.win).length, arm: a.filter(r => r.arm.win).length },
    mcnemar: { onlyArm, onlyBase, chi2: +(((Math.abs(onlyArm - onlyBase) - 1) ** 2) / Math.max(1, onlyArm + onlyBase)).toFixed(2) } };
};
const out = { all: cmp(rows), byStyle: {} };
for (const style of ['grow', 'take', 'cross']) {
  const a = rows.filter(r => r.style === style);
  out.byStyle[style] = {
    baseOffers: a.filter(r => r.base.offers > 0).length,
    baseBought: a.filter(r => r.base.bought > 0).length,
    armBought: a.filter(r => r.arm.bought > 0).length,
    firstDays: [...new Set(a.filter(r => r.base.firstDay).map(r => r.base.firstDay))].sort((x, y) => x - y),
    marketRentWhenOwned: mean(a.filter(r => r.base.ownsMarket), r => r.base.marketRent),
    marketRentWhenRival: mean(a.filter(r => r.base.offers > 0 && !r.base.ownsMarket && r.base.marketRent > 0), r => r.base.marketRent),
    ...cmp(a),
  };
}
const late = rows.filter(r => r.base.offers > 0 && r.base.bought === 0 && r.arm.bought > 0);
out.boughtOnlyInArm = cmp(late);
console.log(JSON.stringify(out, null, 1));
