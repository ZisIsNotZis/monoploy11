// 一局、一个种子的探针：把每一笔巡视收入、每一次买地/加盖、以及 properties 的长度打出来。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const config = createSliceConfig({ human: false, seed: 1, style: 'cross' });
config.slicePatrol = true;
config.slicePatrolPerLevel = 500;
const state = startSession(config);
await runGame(state, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, state); } });

for (const p of state.players) {
  const ids = p.properties;
  const uniq = new Set(ids);
  console.log(p.name, p.style, 'cash', p.cash, 'props', ids.length, 'unique', uniq.size,
    'tradeEarned', p.sliceStats.tradeEarned, 'assets', assetsOf(state, p));
}
const patrolLines = state.log.filter(l => /巡视自家店铺/.test(l.text));
console.log('patrol payouts:', patrolLines.length);
console.log('first 5:', patrolLines.slice(0, 5).map(l => `D${l.day} ${l.text}`));
console.log('last 3:', patrolLines.slice(-3).map(l => `D${l.day} ${l.text}`));
const builds = state.log.filter(l => / 将 .* 升到 Lv\./.test(l.text));
console.log('builds:', builds.length);
const buys = state.log.filter(l => / 买下 /.test(l.text));
console.log('buys:', buys.length);
