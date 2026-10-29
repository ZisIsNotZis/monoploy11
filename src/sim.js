// 无头模拟：node src/sim.js --games 100 --seed 1 [--boss doctor --tier 3]
import { createGame, roll, buyProperty, buildProperty, chooseDirection, current, skipPending,
  doMagic, doNews, doLottery, doShop, doMerchant, doResearch, doBank, leaveStock, leavePending } from './engine/game.js';
import { CHARACTERS } from './data/characters.js';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const games = Number(arg('games', 100));
const seed0 = Number(arg('seed', 1));
const boss = arg('boss', null);
const tier = Number(arg('tier', 3));

let wins = {}, turns = 0, bankrupt = 0;
for (let g = 0; g < games; g++) {
  const participants = [];
  const n = 4;
  if (boss === null) {
    for (let i = 0; i < n; i++) participants.push({ name: CHARACTERS[i].name, charId: CHARACTERS[i].id, team: `t${i + 1}` });
  } else {
    for (let i = 0; i < n - 1; i++) participants.push({ name: CHARACTERS[i].name, charId: CHARACTERS[i].id, team: 'ch' });
    participants.push({ name: boss, charId: CHARACTERS[0].id, team: 'boss', isBoss: true, bossId: boss, bossTier: tier });
  }
  const s = createGame({ seed: seed0 + g, participants });
  let guard = 0;
  while (s.phase !== 'over' && guard++ < 1000) {
    const p = current(s);
    if (s.pending?.type === 'buy') { if (p.cash > s.pending.price * 3) buyProperty(s); else skipPending(s); }
    else if (s.pending?.type === 'build') { if (p.cash > s.pending.cost * 3) buildProperty(s); else skipPending(s); }
    else if (s.pending?.type === 'direction') chooseDirection(s, s.pending.options[0]);
    else if (s.pending?.type === 'magic') doMagic(s, s.rng.pick(['money', 'lose', 'card', 'jail']));
    else if (s.pending?.type === 'news') doNews(s);
    else if (s.pending?.type === 'lottery') doLottery(s);
    else if (s.pending?.type === 'shop') doShop(s, 0);
    else if (s.pending?.type === 'merchant') doMerchant(s, 0);
    else if (s.pending?.type === 'research') doResearch(s, 0);
    else if (s.pending?.type === 'bank') doBank(s, 'deposit', 1000);
    else if (s.pending?.type === 'stock') leaveStock(s);
    else if (s.pending) leavePending(s);
    else if (s.phase === 'action') roll(s, 1);
    else break;
    if (s.pending) leavePending(s);
  }
  if (s.phase !== 'over') { console.log('STUCK', g, s.phase, s.pending); process.exit(1); }
  wins[s.winnerTeam ?? 'none'] = (wins[s.winnerTeam ?? 'none'] ?? 0) + 1;
  turns += s.day;
  bankrupt += s.players.filter(p => !p.alive).length;
}
console.log(JSON.stringify({ games, seed: seed0, boss, tier, wins, avgDays: +(turns / games).toFixed(1), bankrupt }, null, 2));
