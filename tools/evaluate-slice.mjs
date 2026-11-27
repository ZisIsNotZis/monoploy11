#!/usr/bin/env node
// Reproducible diagnostics, not a proxy for human enjoyment.
// node tools/evaluate-slice.mjs --seeds 20 --seed 1 > report.json
import { createSliceConfig, SLICE_MAP } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { assetsOf } from '../src/engine/economy.js';

const args = process.argv.slice(2);
const arg = (key, fallback) => {
  const i = args.indexOf(`--${key}`);
  return i < 0 ? fallback : Number(args[i + 1]);
};
const seeds = arg('seeds', 20), seedStart = arg('seed', 1);
if (!Number.isInteger(seeds) || seeds < 1 || seeds > 1000 || !Number.isInteger(seedStart)) throw new Error('Use integer --seeds 1–1000 and --seed.');
const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const bucket = () => ({ games: 0, wins: 0, tiedAtTop: 0, bankrupt: 0, finalAssets: 0, rentEarned: 0, rentPaid: 0, cardsPlayed: 0, takeovers: 0, centerFirstBought: 0, centerFinalOwner: 0 });
const report = {
  config: { seedStart, seeds, permutations, dayLimit: 16, centerAvailableFromDay: SLICE_MAP.plots.find(p => p.id === 'market')?.availableFromDay ?? 1, decisionsPerGameLimit: 5000 },
  completed: 0, failures: [], stalls: 0, decisions: 0, turns: 0,
  totalEndDays: 0, rent: 0, cardsPlayed: 0, takeovers: 0,
  ties: { games: 0, winnerSeats: {}, styles: {} },
  center: { unownedAtEnd: 0, neverBought: 0, totalFirstPurchaseDay: 0 },
  byStyle: {}, bySeat: {},
};

for (const permutation of permutations) for (let seed = seedStart; seed < seedStart + seeds; seed++) {
  const config = createSliceConfig({ human: false, seed });
  config.participants = permutation.map(i => config.participants[i]);
  const state = startSession(config);
  let decisions = 0, lastPrompt = null, firstCenterBuyer = null;
  const observeCenter = () => {
    const owner = state.properties.market?.ownerId;
    if (!firstCenterBuyer && owner) firstCenterBuyer = { playerId: owner, day: state.day };
  };
  try {
    await runGame(state, {
      render() { observeCenter(); }, async step() {},
      async ask(prompt) {
        lastPrompt = { type: prompt.type, player: prompt.player?.id, day: state.day };
        if (++decisions > 5000) throw new Error('Decision limit exceeded');
        return aiAnswer(prompt, state);
      },
    });
    observeCenter();
    if (!state.over) throw new Error('Engine returned before game ended');
    report.completed++;
    report.decisions += decisions;
    report.turns += state.slice.history.length;
    report.totalEndDays += state.day;
    report.rent += state.stats.rents;
    const max = Math.max(...state.players.filter(p => p.alive).map(p => assetsOf(state, p)));
    const leaders = state.players.filter(p => p.alive && assetsOf(state, p) === max);
    const tied = leaders.length > 1;
    const winner = state.players.find(p => p.team === state.winnerTeam);
    if (tied) {
      report.ties.games++;
      const seat = state.players.indexOf(winner) + 1;
      report.ties.winnerSeats[seat] = (report.ties.winnerSeats[seat] ?? 0) + 1;
      for (const p of leaders) report.ties.styles[p.style] = (report.ties.styles[p.style] ?? 0) + 1;
    }
    const finalCenterOwner = state.properties.market?.ownerId;
    if (!finalCenterOwner) report.center.unownedAtEnd++;
    if (!firstCenterBuyer) report.center.neverBought++;
    else report.center.totalFirstPurchaseDay += firstCenterBuyer.day;
    state.players.forEach((p, i) => {
      const style = report.byStyle[p.style] ??= bucket();
      const seat = report.bySeat[i + 1] ??= bucket();
      for (const row of [style, seat]) {
        row.games++; row.wins += p === winner ? 1 : 0;
        row.tiedAtTop += tied && leaders.includes(p) ? 1 : 0;
        row.bankrupt += p.alive ? 0 : 1;
        row.finalAssets += assetsOf(state, p);
        for (const key of ['rentEarned', 'rentPaid', 'cardsPlayed', 'takeovers']) row[key] += p.sliceStats[key];
        row.centerFirstBought += firstCenterBuyer?.playerId === p.id ? 1 : 0;
        row.centerFinalOwner += finalCenterOwner === p.id ? 1 : 0;
      }
      report.cardsPlayed += p.sliceStats.cardsPlayed;
      report.takeovers += p.sliceStats.takeovers;
    });
  } catch (error) {
    if (decisions > 5000) report.stalls++;
    report.failures.push({ seed, permutation, message: error.message, lastPrompt });
  }
}
report.meanEndDay = report.completed ? report.totalEndDays / report.completed : null;
for (const group of [report.byStyle, report.bySeat]) for (const row of Object.values(group)) {
  row.meanFinalAssets = row.finalAssets / row.games;
}
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
