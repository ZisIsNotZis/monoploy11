// #3456：复核 supervisor 点名的那个具体例子（seed 42、机会买家、第 15 天、晨光街茶铺）。
// 他报了两笔全额到账：7,800 与 11,200。这里只印那一天那一店的全部结算行，不解释。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const SEED = Number(process.argv[2] ?? 42);
const STYLE = process.argv[3] ?? 'take';
const DAY = Number(process.argv[4] ?? 15);
const PLOT = process.argv[5] ?? '晨光街茶铺';

const s = startSession(createSliceConfig({ human: false, seed: SEED, style: STYLE, sliceContestedStreets: true }));
await runGame(s, {
  render() {}, async step() {},
  async ask(prompt) { return aiAnswer(prompt, s); },
});
if (!s.over) throw new Error('没打完');

const hits = [];
for (const rep of s.slice?.history ?? []) {
  if (rep.day !== DAY) continue;
  for (const line of rep.lines ?? []) if (line.includes(PLOT)) hits.push(line);
}
console.log(`${STYLE} seed ${SEED} 第 ${DAY} 天，提到「${PLOT}」的结算行：`);
for (const h of hits) console.log('  ' + h);

const rents = hits.map(h => /实付租金 (\d+)/.exec(h)).filter(Boolean).map(m => Number(m[1]));
if (rents.length < 2) throw new Error(`没复现出两笔（实得 ${rents.length} 笔）`);
console.log(`\n复现：同一天同一店 ${rents.length} 笔，金额 ${rents.join(' + ')} ⇒ 天数不是次数上限。`);
