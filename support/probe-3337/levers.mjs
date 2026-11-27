// #3337 探针 21：终局盘点 —— 结算屏能说的「下一次可以不同」到底有多少是可行动的。
// 逐局记录（真入口，AI 玩人类座位）：
//   busted            本局破产
//   halfUnowned       有一条街我占一半，另一半无主（走过去 8,000 就能补齐）
//   halfRival         有一条街我占一半，另一半在对手手里（只能靠收购卡，而收购实测是亏的）
//   marketUnowned     街心书屋终局无主
//   marketRival       街心书屋在对手手里
//   boughtLand        本局我只买过几块地（起始 2 块不算）
//   cardsUnused       终局手里还剩几张牌
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 300);
const rows = [];
for (const style of ['grow', 'take', 'cross']) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const state = startSession(createSliceConfig({ human: true, seed, style }));
    const me = () => state.players.find(p => p.controller === 'human');
    await runGame(state, {
      render() {}, async step() {},
      async ask(prompt) {
        if (prompt.player?.controller !== 'human') return aiAnswer(prompt, state);
        return aiAnswer(prompt, state);
      },
    });
    const p = me();
    const startIds = new Set(state.map.initialProperties.map(x => x.plotId));
    const streets = [...new Set(state.map.plots.filter(x => !x.big).map(x => x.street))];
    let halfUnowned = 0, halfRival = 0;
    for (const street of streets) {
      const plots = state.map.plots.filter(x => x.street === street && !x.big);
      const mine = plots.filter(x => state.properties[x.id]?.ownerId === p.id);
      if (mine.length !== 1) continue;
      const other = plots.find(x => state.properties[x.id]?.ownerId !== p.id);
      if (!other) continue;
      if (state.properties[other.id]?.ownerId) halfRival++; else halfUnowned++;
    }
    const market = state.properties.market;
    rows.push({ style, seed, busted: !p.alive, halfUnowned, halfRival,
      marketUnowned: !market?.ownerId,
      marketRival: !!market?.ownerId && state.players.find(q => q.id === market.ownerId)?.team !== p.team,
      boughtLand: p.properties.filter(id => !startIds.has(id) && id !== 'market').length,
      boughtMarket: market?.ownerId === p.id,
      cardsUnused: p.cards.length,
      cardsPlayed: p.sliceStats.cardsPlayed,
      win: p.team === state.winnerTeam,
      levelMax: Math.max(0, ...p.properties.map(id => state.properties[id]?.level ?? 0)) });
  }
}
const n = rows.length;
const rate = f => +(100 * rows.filter(f).length / n).toFixed(1);
const byStyle = {};
for (const style of ['grow', 'take', 'cross']) {
  const a = rows.filter(r => r.style === style);
  const rr = f => +(100 * a.filter(f).length / a.length).toFixed(1);
  byStyle[style] = { games: a.length, win: rr(r => r.win), busted: rr(r => r.busted),
    halfUnowned: rr(r => r.halfUnowned > 0), halfRival: rr(r => r.halfRival > 0),
    marketUnowned: rr(r => r.marketUnowned), marketRival: rr(r => r.marketRival),
    boughtNoLand: rr(r => r.boughtLand === 0), cardsUnusedAvg: +(a.reduce((s, r) => s + r.cardsUnused, 0) / a.length).toFixed(2),
    cardsPlayedAvg: +(a.reduce((s, r) => s + r.cardsPlayed, 0) / a.length).toFixed(2) };
}
console.log(JSON.stringify({ all: { games: n, win: rate(r => r.win), busted: rate(r => r.busted),
  halfUnowned: rate(r => r.halfUnowned > 0), halfRival: rate(r => r.halfRival > 0),
  bothHalf: rate(r => r.halfUnowned > 0 && r.halfRival > 0),
  marketUnowned: rate(r => r.marketUnowned), marketRival: rate(r => r.marketRival),
  boughtNoLand: rate(r => r.boughtLand === 0), boughtMarket: rate(r => r.boughtMarket),
  cardsUnusedAvg: +(rows.reduce((s, r) => s + r.cardsUnused, 0) / n).toFixed(2) }, byStyle }, null, 1));
