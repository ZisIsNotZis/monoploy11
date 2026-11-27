// #3343：终局名次到底由什么决定？
//
// 已量到的三件事把这支逼出来了：
//   ① 一间小店 8,000，每局平均只到账 953 元 ⇒ 回本要 8.4 **局**（一局 16 天）
//   ② 每位收租在 ident-swap 里跟**地块**走，不跟座位走（座位均值只差 10pp）
//   ③ 开局表换了五张，座位极差始终 19–34pp
// 如果租金小到回不了本，那「买地/补齐一条街」就不可能是胜负手 ——
// 那么胜负手是什么？这支把每个人的终局资产拆开：现金 / 地产标价，并给出各自来源。
// 「两条都讲得通的计划」必须建在**真能改变名次**的项上，否则只是两条装饰。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buyPrice } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const STYLES = ['grow', 'take', 'cross'];

const acc = [];
let games = 0;
const winnerProfile = { cash: 0, land: 0, rent: 0, salary: 0, n: 0 };
const loserProfile = { cash: 0, land: 0, rent: 0, salary: 0, n: 0 };

for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
  const st = startSession(createSliceConfig({ human: false, seed, style }));
  games++;
  // 按人记「经过发薪处 / 零工 / 收租」的金额，来自日志原文。
  const salary = Object.fromEntries(st.players.map(p => [p.id, 0]));
  const money = Object.fromEntries(st.players.map(p => [p.id, 0]));
  await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
  for (const line of st.log) {
    const t = line.text;
    let m = /^(\S+?) .*?(?:经过|停在).*?发薪处.*?\+([\d,]+)/.exec(t);
    if (m) { const pid = st.players.find(p => p.name === m[1])?.id; if (pid) salary[pid] += Number(m[2].replace(/,/g, '')); }
    m = /^(\S+?) .*?零工.*?\+([\d,]+)/.exec(t);
    if (m) { const pid = st.players.find(p => p.name === m[1])?.id; if (pid) money[pid] += Number(m[2].replace(/,/g, '')); }
  }
  const winner = st.players.find(p => p.team === st.winnerTeam);
  let total = 0;
  for (const p of st.players) total += assetsOf(st, p);
  for (const p of st.players) {
    const cash = p.cash + (p.deposit ?? 0);
    // economy.js 没有单块估值导出；assetsOf 在 slice 模式下就是 现金 + Σ buyPrice。
    const land = p.properties.reduce((s, id) => s + buyPrice(st, id), 0);
    const row = { cash, land, rent: p.sliceStats.rentEarned, salary: salary[p.id] ?? 0, money: money[p.id] ?? 0, win: p === winner, share: 100 * assetsOf(st, p) / Math.max(1, total) };
    acc.push(row);
    if (p === winner) { winnerProfile.cash += cash; winnerProfile.land += land; winnerProfile.rent += row.rent; winnerProfile.salary += row.salary; winnerProfile.n++; }
    else { loserProfile.cash += cash; loserProfile.land += land; loserProfile.rent += row.rent; loserProfile.salary += row.salary; loserProfile.n++; }
  }
}

const avg = (rows, key) => Math.round(rows.reduce((s, r) => s + r[key], 0) / rows.length);
const mean = acc.reduce((s, r) => s + r.share, 0) / acc.length;
console.log(JSON.stringify({
  局数: games, 每人局数: acc.length,
  平均: { 现金: avg(acc, 'cash'), 地产标价: avg(acc, 'land'), 收租: avg(acc, 'rent'), 发薪: avg(acc, 'salary'), 零工: avg(acc, 'money') },
  胜者: { 现金: Math.round(winnerProfile.cash / winnerProfile.n), 地产标价: Math.round(winnerProfile.land / winnerProfile.n), 收租: Math.round(winnerProfile.rent / winnerProfile.n), 发薪: Math.round(winnerProfile.salary / winnerProfile.n) },
  败者: { 现金: Math.round(loserProfile.cash / loserProfile.n), 地产标价: Math.round(loserProfile.land / loserProfile.n), 收租: Math.round(loserProfile.rent / loserProfile.n), 发薪: Math.round(loserProfile.salary / loserProfile.n) },
  '胜者-败者差': {
    现金: Math.round((winnerProfile.cash - loserProfile.cash) / winnerProfile.n),
    地产: Math.round((winnerProfile.land - loserProfile.land) / winnerProfile.n),
    收租: Math.round((winnerProfile.rent - loserProfile.rent) / winnerProfile.n),
    发薪: Math.round((winnerProfile.salary - loserProfile.salary) / winnerProfile.n),
  },
}));

// 名次与各项的相关（粗）：资产最高者的「地产占比」分布
const shares = acc.filter(r => r.win).map(r => ({ landPct: +(100 * r.land / Math.max(1, r.cash + r.land)).toFixed(1) }));
shares.sort((a, b) => a.landPct - b.landPct);
console.log('胜者的地产占总资产%：中位', shares[Math.floor(shares.length / 2)]?.landPct,
  '最小', shares[0]?.landPct, '最大', shares.at(-1)?.landPct);
