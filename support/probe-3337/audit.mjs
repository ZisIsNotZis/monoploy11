// 逐局审计 nextGameLine 里每个数字能否从 state/log 回算。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { rentFor, buildCost } from '../../src/engine/economy.js';
import { nextGameLine, money } from '../../src/ui/slice.js';

const bad = [];
let n = 0;
for (const style of ['grow', 'take', 'cross']) {
  for (let seed = 1; seed <= 60; seed++) {
    const s = startSession(createSliceConfig({ human: true, seed, style }));
    const me = s.players.find(p => p.controller === 'human');
    await runGame(s, { render(){}, async step(){}, async ask(p){ return aiAnswer(p, s); } });
    const line = nextGameLine(s);
    n++;
    const nums = (line.match(/[\d,]{4,}/g) ?? []).map(x => Number(x.replace(/,/g, '')));
    const ok = new Set();
    // 允许来源：标价、日志里的金额、引擎此刻租金、buildCost
    for (const pl of s.map.plots) { if (pl.price) ok.add(pl.price); }
    for (const e of s.log) for (const m of e.text.matchAll(/(\d{3,})/g)) ok.add(Number(m[1]));
    for (const pl of s.map.plots) { const r = rentFor(s, pl.id); if (r) ok.add(r); }
    for (let lv = 1; lv <= 3; lv++) ok.add(Math.round(buildCost(lv) * (s.priceIndex ?? 1)));
    const pr = s.properties.market;
    if (pr) { for (let lv = 1; lv <= 3; lv++) { const saved = pr.level; pr.level = lv; const r = rentFor(s, 'market'); if (r) ok.add(r); pr.level = saved; } }
    // 句子里有些数是**合计**（同一间店多次实付之和），所以除了单个值，也允许这些值的子集和。
    const pool = [...ok].filter(x => x > 0 && x < 200000);
    const reach = new Set([0]);
    for (const v of pool) for (const r of [...reach]) { const t = r + v; if (t <= 200000) reach.add(t); }
    const unknown = nums.filter(x => !ok.has(x) && !reach.has(x));
    if (unknown.length) bad.push({ style, seed, line, unknown });
  }
}
console.log(JSON.stringify({ games: n, linesWithUnverifiableNumbers: bad.length, samples: bad.slice(0, 6) }, null, 1));
