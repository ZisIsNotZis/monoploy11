// 无头模拟：node src/sim.js --games 100 --seed 1 [--boss doctor --tier 3]
import { startSession, runGame } from './engine/flow.js';
import { CHARACTERS } from './data/characters.js';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const games = Number(arg('games', 100));
const seed0 = Number(arg('seed', 1));
const boss = arg('boss', null);
const tier = Number(arg('tier', 3));

const ui = {
  render() {},
  async ask(p) {
    if (p.type === 'action') return { action: 'roll', dice: 1 };
    if (p.type === 'buy') return true;
    if (p.type === 'build') return true;
    if (p.type === 'chooseBig') return 'commercial';
    if (p.type === 'direction') return p.options[0];
    if (p.type === 'bank') return { action: 'leave' };
    if (p.type === 'stock') return { action: 'leave' };
    if (p.type === 'lottery') return { action: 'leave' };
    if (p.type === 'shop' || p.type === 'merchant') return { action: 'leave' };
    if (p.type === 'magic') return { effect: 'money' };
    if (p.type === 'target') return null;
    return null;
  },
};

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
  const s = startSession({ seed: seed0 + g, participants });
  await runGame(s, ui);
  if (!s.over) { console.log('STUCK', g, s.phase, s.day); process.exit(1); }
  wins[s.winnerTeam ?? 'none'] = (wins[s.winnerTeam ?? 'none'] ?? 0) + 1;
  turns += s.day;
  bankrupt += s.players.filter(p => !p.alive).length;
}
console.log(JSON.stringify({ games, seed: seed0, boss, tier, wins, avgDays: +(turns / games).toFixed(1), bankrupt }, null, 2));
