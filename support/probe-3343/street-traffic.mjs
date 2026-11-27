// #3343：真正的分裂点是不是「街道本身」？
//
// conserved.mjs 的读数指向一个不在座位上的原因：
//   whole  三臂 34.2 / 48.3 / 40.8（极差 14.1）
//   mix    三臂 15.8 / 60.0 / 15.0（极差 45.0）  ← 三条街按 (i+1) 轮转
// mix 是旋转对称的构造，读数却差 45pp。唯一的解释是：**三条街本身不等价**，
// 所以「拿到哪条街」比「谁先动」重要得多。
//
// 这个脚本直接量每间店：
//   被踩次数（对手停在这块地上、真付租的次数）与真到账租金。
// 口径只认日志里的「实付租金」行，不认应付 —— 与 payback.js 的 RENT_POOL 同口径。
// 跑的是**默认整条街开局**（每人一条街两间），所以每间店都被同一个人拥有、无争议，
// 量到的就是这块地在这张地图上的天然价值。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const SEEDS = Number(process.argv[2] ?? 60);
const STYLES = ['grow', 'take', 'cross'];

const hits = new Map();      // plotName -> { paid, cash }
const byStreet = new Map();  // street -> { paid, cash, plots:Set }
let games = 0, paidTotal = 0;

for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
  const st = startSession(createSliceConfig({ human: false, seed, style }));
  games++;
  await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
  for (const line of st.log) {
    // 「X 向 Y 支付 N 租金（Z）」—— Z 是店名。只认实付 > 0。
    // 真实原文（dump-rent.mjs 逐形状枚举出来的）：
    //   「P 实付租金 11,200（晨光街茶铺），P 收到 11,200 · P 余额 3,400」
    // 上一版我按「支付 N 租金（Z）」猜，两个正则都没命中，读成「180 局 0 次付租」——
    // 那是量具坏了，不是发现。
    const m = /实付租金 ([\d,]+)（(.+?)）/.exec(line.text);
    if (!m) continue;
    const cash = Number(m[1].replace(/,/g, ''));
    const name = m[2].trim();
    if (!cash) continue;
    paidTotal++;
    const plot = st.map.plots.find(p => p.name === name);
    if (!plot) continue;
    for (const [map, key] of [[hits, name], [byStreet, plot.street]]) {
      if (!map.has(key)) map.set(key, { paid: 0, cash: 0, plots: new Set() });
      const rec = map.get(key);
      rec.paid++; rec.cash += cash; rec.plots.add(name);
    }
  }
}

console.log(`局数 ${games} · 真付租合计 ${paidTotal} 次 · 每局 ${(paidTotal / games).toFixed(2)} 次\n`);
console.log('按街：');
const rows = [...byStreet].map(([street, r]) => ({
  街: street, 间数: r.plots.size, 真付租: r.paid, 每局: +(r.paid / games).toFixed(2),
  到账: r.cash, 每局到账: Math.round(r.cash / games), 每间每局: +(r.paid / games / r.plots.size).toFixed(3),
}));
rows.sort((a, b) => b.每局 - a.每局);
for (const r of rows) console.log(JSON.stringify(r));
const ratios = rows.map(r => r.每间每局).filter(x => x > 0);
console.log(`\n最热/最冷 每间每局 = ${Math.max(...ratios).toFixed(3)} / ${Math.min(...ratios).toFixed(3)} = ${(Math.max(...ratios) / Math.min(...ratios)).toFixed(1)} 倍`);

console.log('\n按店：');
const byPlot = [...hits].map(([name, r]) => ({
  店: name, 真付租: r.paid, 每局: +(r.paid / games).toFixed(3), 每局到账: Math.round(r.cash / games),
}));
byPlot.sort((a, b) => b.每局 - a.每局);
for (const r of byPlot) console.log(JSON.stringify(r));
