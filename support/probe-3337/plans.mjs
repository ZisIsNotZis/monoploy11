// #3337 探针 2：一局里，每种起手**承诺的打法**真的被用到了几次？
// 真入口：createSliceConfig → startSession → runGame + aiAnswer（人类座位交给同一套 AI）。
import { createSliceConfig, SLICE_STYLES } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';
import { sliceTargetIds } from '../../src/engine/insight.js';

const SEEDS = Number(process.argv[2] ?? 60);

async function play(style, seed) {
  const state = startSession(createSliceConfig({ human: true, seed, style }));
  const human = () => state.players.find(p => p.controller === 'human');
  const used = {};
  const supplyPicks = [];
  let buylandOffers = 0;
  let actionScreens = 0;
  let builds = 0;

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (prompt.player?.controller !== 'human') return aiAnswer(prompt, state);
      const p = prompt.player;
      const ans = aiAnswer(prompt, state);
      if (prompt.type === 'action') {
        actionScreens++;
        if (sliceTargetIds(state, p, 'buyland').length) buylandOffers++;
        if (ans?.action === 'card') {
          const id = p.cards[ans.index];
          if (id) used[id] = (used[id] ?? 0) + 1;
        }
      }
      if (prompt.type === 'target') used[prompt.cardId] = (used[prompt.cardId] ?? 0) + 1;
      if (prompt.type === 'supply') supplyPicks.push(prompt.options?.find(o => o.id === ans)?.id);
      if (prompt.type === 'build' && ans) builds++;
      return ans;
    },
  });

  const me = human();
  const levels = me.properties.map(id => state.properties[id]?.level ?? 0);
  return {
    style, seed, used, supplyPicks, builds, buylandOffers, actionScreens,
    takeovers: me.sliceStats.takeovers, cardsPlayed: me.sliceStats.cardsPlayed,
    rentEarned: me.sliceStats.rentEarned, rentPaid: me.sliceStats.rentPaid,
    levels, maxLevel: Math.max(0, ...levels), owned: me.properties.length,
    assets: assetsOf(state, me), win: me.team === state.winnerTeam,
  };
}

const rows = [];
for (const style of ['grow', 'take', 'cross']) {
  for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play(style, seed));
}
const sum = (a, f) => a.reduce((s, r) => s + (f(r) ?? 0), 0);
const avg = (a, f) => +(sum(a, f) / a.length).toFixed(2);
const pct = (a, f) => +(100 * a.filter(f).length / a.length).toFixed(1);

const report = {};
for (const style of ['grow', 'take', 'cross']) {
  const a = rows.filter(r => r.style === style);
  report[style] = {
    games: a.length,
    winPct: pct(a, r => r.win),
    assets: avg(a, r => r.assets),
    cardsPlayed: avg(a, r => r.cardsPlayed),
    byCard: Object.fromEntries(['worker', 'inflate', 'close', 'buyland', 'remotedice']
      .map(k => [k, { perGame: avg(a, r => r.used[k] ?? 0), gamesUsed: pct(a, r => (r.used[k] ?? 0) > 0) }])),
    takeovers: { perGame: avg(a, r => r.takeovers), gamesWithOne: pct(a, r => r.takeovers > 0) },
    buylandOfferScreens: { perGame: avg(a, r => r.buylandOffers), gamesWithOne: pct(a, r => r.buylandOffers > 0) },
    buildsPerGame: avg(a, r => r.builds),
    supplyFirst: Object.fromEntries(['grow', 'take', 'cross'].map(k => [k, pct(a, r => r.supplyPicks[0] === k)])),
    maxLevelReached: avg(a, r => r.maxLevel),
    neverUsedTheStarterCard: Object.fromEntries(
      SLICE_STYLES.find(s => s.id === style).hand.map(c => [c, pct(a, r => (r.used[c] ?? 0) === 0)])),
  };
}
console.log(JSON.stringify(report, null, 1));
