// #3343：为什么「补齐一条街」不管在哪种开局表上都不是一条**更划算**的路？
//
// 前面几步把所有开局表都量了一遍（fair-tables.mjs）：座位极差 21–34pp，没有一张表把它压下去。
// 所以我怀疑问题不在表上，在这个经济体里「多买一间店」本身值多少钱。
//
// 这个脚本只算一件事：**一间店在整局里到底产出多少**，与它的买价/加盖价对照。
// 全部取实测：每间店每局真到账租金来自日志「实付租金」行；价格来自 buyPrice / 加盖公式。
// 判据：
//   若 每局到账 < 买价/16 ⇒ 买地只为「资产换手」不为「收租」，那不是计划，是记账。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const SEEDS = Number(process.argv[2] ?? 60);
const STYLES = ['grow', 'take', 'cross'];

const perPlot = new Map();
let games = 0;
for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
  const st = startSession(createSliceConfig({ human: false, seed, style }));
  games++;
  await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
  for (const line of st.log) {
    const m = /实付租金 ([\d,]+)（(.+?)）/.exec(line.text);
    if (!m) continue;
    const cash = Number(m[1].replace(/,/g, ''));
    const name = m[2].trim();
    if (!cash) continue;
    const rec = perPlot.get(name) ?? { cash: 0, hits: 0 };
    rec.cash += cash; rec.hits++;
    perPlot.set(name, rec);
  }
}

const PRICE = { small: 8000, book: 26000 };
const rows = [...perPlot].map(([name, r]) => {
  const isBook = name.includes('书屋');
  const price = isBook ? PRICE.book : PRICE.small;
  const perGame = r.cash / games;
  return {
    店: name, 每局到账: Math.round(perGame), 每局次数: +(r.hits / games).toFixed(3),
    买价: price,
    '到账/买价%': +(100 * perGame / price).toFixed(1),
    '回本需局数': perGame > 0 ? +(price / perGame).toFixed(1) : null,
  };
});
rows.sort((a, b) => b.每局到账 - a.每局到账);
for (const r of rows) console.log(JSON.stringify(r));

const smalls = rows.filter(r => !r.店.includes('书屋'));
const totSmall = smalls.reduce((s, r) => s + r.每局到账, 0);
const totAll = rows.reduce((s, r) => s + r.每局到账, 0);
const book = rows.find(r => r.店.includes('书屋'));
console.log('\n=== 汇总 ===');
console.log(JSON.stringify({
  局数: games,
  十二间小店每局合计: Math.round(totSmall),
  书屋每局: book?.每局到账 ?? 0,
  全场每局合计: Math.round(totAll),
  '书屋占全场比%': +(100 * (book?.每局到账 ?? 0) / totAll).toFixed(1),
  小店平均每局: Math.round(totSmall / smalls.length),
  '小店平均回本局数': +(PRICE.small / (totSmall / smalls.length)).toFixed(1),
  一局天数: 16,
}));
