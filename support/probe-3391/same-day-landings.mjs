// #3456：一天里同一家店能被几位对手踩到？
//
// 为什么要量：我在 #3453 里把「旺季还剩 N 天」写成了例子中次数的上界
// （`m = min(inHot−1, daysLeft)`）。那条修法的前提是「一天最多一次落点」——
// supervisor 实跑 seed 42 的机会买家开局，第 15 天晨光街茶铺两笔都全额到账
// （7,800 与 11,200），一天两次。若这个前提是假的，那句「今天是最后一天 ⇒ 只能踩 1 次」
// 就把**天数当成了次数上限**，会让玩家低估旺季和下一笔经营决策。
//
// 这一支只数产品自己结算过的行（「实付租金 N（店名）」按天分组），不推测。
import { createSliceConfig, SLICE_STYLES } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assertUnique } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 20000;

const rows = [];       // 每个「店×天」一行：当天收了几笔
const payouts = [];    // 每一笔实付，用于挑一个能写进文档的例子

for (const style of SLICE_STYLES.map(s => s.id)) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = startSession(createSliceConfig({ human: false, seed, style, sliceContestedStreets: true }));
    let decisions = 0;
    await runGame(s, {
      render() {}, async step() {},
      async ask(prompt) {
        if (++decisions > DECISION_LIMIT) throw new Error('decision limit');
        return aiAnswer(prompt, s);
      },
    });
    if (!s.over) throw new Error(`seed ${seed} ${style} 没打完`);

    // 按天收集。关键：`slice.history` 是**每人每回合**一条（一天三条），所以同一家店
    // 同一天的两笔分散在不同 rep 里 —— 必须先把同一天的店并起来再计数。
    // 我第一版按单条 rep 建行，于是同一个「店×天」出现两次，判据当场抛了（它是对的）。
    const perDay = new Map();   // `${day}|${plotId}` -> 笔数
    for (const rep of s.slice?.history ?? []) {
      const day = rep.day;
      for (const line of rep.lines ?? []) {
        const m = /^(\S+) 实付租金 (\d+)（(.+?)）/.exec(line);
        if (!m) continue;
        const plot = s.map.plots.find(p => p.name === m[3]);
        if (!plot) continue;
        const k = `${day}|${plot.id}`;
        perDay.set(k, (perDay.get(k) ?? 0) + 1);
        payouts.push({ style, seed, day, plot: m[3], amount: Number(m[2]) });
      }
    }
    for (const [k, n] of perDay) {
      const [day, plotId] = k.split('|');
      rows.push({ style, seed, day: Number(day), plotId, n });
    }
  }
}

// 这一支的行是「店×天」，一局里本来就有很多行，所以唯一键必须带上店与天。
// 第一次我按默认的 style:seed 判，判据当场抛了 —— 它是对的，是我把键给错了。
assertUnique(rows, 'same-day-landings', r => `${r.style}:${r.seed}:${r.day}:${r.plotId}`);

const hist = new Map();
for (const r of rows) hist.set(r.n, (hist.get(r.n) ?? 0) + 1);
const multi = rows.filter(r => r.n > 1);

console.log(`每格 ${SEEDS} 局真实整局（争街，产品 AI）——「同一家店、同一天」被踩到的次数\n`);
console.log('当天笔数   出现次数');
for (const n of [...hist.keys()].sort((a, b) => a - b)) console.log(`${String(n).padEnd(10)} ${hist.get(n)}`);
console.log(`\n店×天样本 ${rows.length}，其中一天多笔 ${multi.length}（${(multi.length / rows.length * 100).toFixed(1)}%）`);

const worst = rows.reduce((a, b) => (b.n > (a?.n ?? 0) ? b : a), null);
console.log(`最多的一天：${worst?.n} 笔（${worst?.style} seed ${worst?.seed} 第 ${worst?.day} 天 ${worst?.plotId}）`);

// 同一天多笔的金额（给文档挑一个真实例子）
const byKey = new Map();
for (const p of payouts) {
  const k = `${p.style}|${p.seed}|${p.day}|${p.plot}`;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(p.amount);
}
const examples = [...byKey.entries()].filter(([, a]) => a.length > 1)
  .sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0));
console.log('\n金额最大的同一天多收：');
for (const [k, a] of examples.slice(0, 5)) console.log(`  ${k} -> ${a.join(' + ')}`);

// 这条事实必须真的在样本里出现，否则这一支什么也没证明。
if (!multi.length) throw new Error('样本里没有「一天多笔」—— 上界那条修法的前提未被推翻，别改措辞');
console.log(`\n成立：一天里同一家店可以收到 ${Math.max(...rows.map(r => r.n))} 笔 ⇒ 剩余天数不是次数上限。`);
