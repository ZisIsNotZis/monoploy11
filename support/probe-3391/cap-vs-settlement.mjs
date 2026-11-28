// #3456b（supervisor 追问）：「这几天最多能收到 N 次（X 天 × Y 位对手，同一天可以各来一次）」
// 里那个 N 到底是**所有情况的上限**，还是**这个例子的口径**？
//
// 屏幕上的 N = 剩余天数 × 当天能踩到这格的对手数。这个式子只在下面两条同时成立时才是真上界：
//   ① 一位对手一天最多踩同一格一次（他一天只有一个回合）；
//   ② 没有别的东西能在同一天再造出一次结算（重启移动、弹回、传送……）。
// 这两条都不是我推断的，必须从**产品自己结算出来的行**里数。
//
// 所以这一支不看常量，只数真实整局里「同一块地、同一天」的实付行：
//   · 笔数（= 屏幕说的「收到几次」）
//   · 不同的付款人数（= 式子里那个「几位对手」）
// 若存在「笔数 > 当日活着的对手数」，式子的容量就是**低估**（不是上界，是例子口径）；
// 若存在「同一人同一天两笔」，①也不成立。
//
// 用法：node support/probe-3391/cap-vs-settlement.mjs [seeds]
import { createSliceConfig, SLICE_STYLES } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assertUnique } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 20000;

const rows = [];       // 每个「店×天」一行

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

    // slice.history 是「每人每回合」一条（一天三条），同一天的两笔因此在不同 rep 里。
    const perDay = new Map();   // `${day}|${plotId}` -> { payers:Set, n }
    for (const rep of s.slice?.history ?? []) {
      for (const line of rep.lines ?? []) {
        const m = /^(\S+) 实付租金 (\d+)（(.+?)）/.exec(line);
        if (!m) continue;
        const plot = s.map.plots.find(p => p.name === m[3]);
        if (!plot) continue;
        const k = `${rep.day}|${plot.id}`;
        const cur = perDay.get(k) ?? { payers: new Set(), n: 0, day: rep.day, plotId: plot.id };
        cur.payers.add(m[1]);
        cur.n += 1;
        perDay.set(k, cur);
      }
    }
    for (const v of perDay.values()) {
      const pr = s.properties[v.plotId];
      if (!pr?.ownerId) continue;
      const owner = s.players.find(p => p.id === pr.ownerId);
      // 当天能踩到这格的对手数 —— 与 payback.opponentsOf 同一口径。
      const opp = s.players.filter(p => p.team !== owner?.team).length;
      rows.push({ style, seed, day: v.day, plotId: v.plotId, n: v.n, payers: v.payers.size, opp });
    }
  }
}

assertUnique(rows, 'cap-vs-settlement', r => `${r.style}:${r.seed}:${r.day}:${r.plotId}`);

const over = rows.filter(r => r.n > r.opp);
const samePayer = rows.filter(r => r.n > r.payers);
const hist = new Map();
for (const r of rows) {
  const k = `${r.n} 笔 / ${r.payers} 人`;
  hist.set(k, (hist.get(k) ?? 0) + 1);
}

console.log(`每格 ${SEEDS} 局真实整局（争街，产品 AI）—— 产品自己结算过的「同一块地、同一天」\n`);
console.log('当天笔数 / 付款人数   出现次数');
for (const k of [...hist.keys()].sort()) console.log(`${k.padEnd(20)} ${hist.get(k)}`);

const maxN = Math.max(...rows.map(r => r.n));
console.log(`\n店×天样本 ${rows.length}；当天最多 ${maxN} 笔。`);
console.log(`笔数 > 当天对手数的行：${over.length}`);
console.log(`同一人同一天在同一格付了两次的行：${samePayer.length}`);
if (samePayer.length) {
  console.log('\n那几行（说明「一天一人只能踩一次」不成立）：');
  for (const r of samePayer.slice(0, 10)) console.log(`  ${r.style} seed ${r.seed} 第 ${r.day} 天 ${r.plotId}：${r.n} 笔 / ${r.payers} 人`);
}

console.log(`\n⇒ 「同一天可以各来一次」${samePayer.length === 0 ? '成立' : '不成立（有人一天踩了两次）'}`);
console.log(`⇒ 「几位对手」当上限${over.length === 0 ? '成立' : '不成立（有行超过对手数）'}`);
