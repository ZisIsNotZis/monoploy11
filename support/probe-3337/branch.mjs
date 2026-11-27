// 复核：真局里 nextGameLine 落到哪一支？如果永远同一支，读者会以为它也是写死的。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { nextGameLine } from '../../src/ui/slice.js';
const kind = l => /留够现金/.test(l) ? 'bust'
  : /接着往上盖/.test(l) ? 'market-mine-upgrade'
  : /这么用/.test(l) ? 'market-mine-maxed'
  : /拿走了它/.test(l) ? 'market-rival'
  : /全程没人买/.test(l) ? 'market-unowned'
  : /标价|付了/.test(l) ? 'fallback'
  : 'other';
const counts = {};
const samples = {};
for (const style of ['grow', 'take', 'cross']) {
  for (let seed = 1; seed <= 100; seed++) {
    const s = startSession(createSliceConfig({ human: true, seed, style }));
    await runGame(s, { render(){}, async step(){}, async ask(p){ return aiAnswer(p, s); } });
    const line = nextGameLine(s);
    const k = kind(line);
    counts[k] = (counts[k] ?? 0) + 1;
    (samples[k] ??= []).length < 2 && samples[k].push(`${style}/${seed}: ${line}`);
  }
}
console.log(JSON.stringify({ counts, samples }, null, 1));
