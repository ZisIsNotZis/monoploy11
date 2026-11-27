// 继续找「真付租」那一行原文。上面 12 行里没有支付行。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const counts = new Map();
let sample = [];
for (const style of ['grow', 'take', 'cross']) for (let seed = 1; seed <= 4; seed++) {
  const st = startSession(createSliceConfig({ human: false, seed, style }));
  await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
  for (const l of st.log) {
    const t = l.text;
    if (!/支付|租/.test(t)) continue;
    const shape = t.replace(/[\d,]+/g, 'N').replace(/(晨光街|晚风街|灯火街|月色街|西巷|东巷|街心书屋)/g, 'S')
      .replace(/(街角店主|机会买家|穿街高手)/g, 'P');
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
    if (sample.length < 40) sample.push(t);
  }
}
console.log('=== 形状 × 次数（12 局）===');
for (const [s, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${n}\t${s}`);
