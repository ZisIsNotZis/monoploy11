// #3391n：这一支是我被 supervisor 抓到的错留下的工具。
//
// 错在哪：randomize-book.mjs / rent-attribute.mjs 里每个 (style, seed, 座位) 都跑了 **两遍**
//   for (let rep = 0; rep < 2; rep++) rows.push(await play(...));
// 而引擎是确定性的（rng.js 的 mulberry32，一 seed 一局）⇒ 第二遍与第一遍**逐字段相同**。
// 于是「360 局/臂」里只有 **180 局是真局**，另外 180 条是同一批局复印的。
// 后果有两层：
//   ① 样本量被虚报了一倍（n=360 而真实信息量是 180）；
//   ② 置信区间用「独立样本」的公式算 ⇒ 区间被压窄 ✓ 一个假精度。
// supervisor 逐字段比对 180 对，全部相同；他按 60 seed 成对重抽得到 [19.4, 37.2]，
// 而旧公式印的是 ±5.6 —— 窄了一半。这不是措辞问题，是读数问题。
//
// 现在两件事由下面的代码保证，而不是由我记得：
//   · 同一 (style, seed) 只许出现一次；出现两次且完全相同就抛（说明有人又把 rep 循环加回来了）。
//   · 两臂比较**按 (style, seed) 配对**：先算每条配对的差（同 seed 同座位、只差处理），
//     再对**配对**做 cluster bootstrap（重抽 seed）。配对能吃掉「这个种子本来就难/易」的方差，
//     这正是同一 seed 跑两臂换来的信息，旧公式把它丢掉了。

import { makeRng } from '../../src/engine/rng.js';

export const keyOf = r => `${r.style}:${r.seed}`;

/**
 * 同一 (style, seed) 只许一条；重复即抛（防止再把「跑两遍」当成加样本）。
 *
 * 可选 keyFn：同一 seed 若真的跑了**不同**座位排列（对手顺序不同 ⇒ 是不同对局，不是复印），
 * 调用方把 order 并进键里。不传时行为不变。
 */
export function assertUnique(rows, label = 'rows', keyFn = keyOf) {
  const seen = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (seen.has(k)) {
      throw new Error(`${label}: ${k} 出现了两次 —— 引擎是确定性的，这不是两个样本，是一份样本印了两遍`);
    }
    seen.set(k, true);
  }
  return seen.size;
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * 两臂的配对差 + cluster bootstrap 区间。
 * rowsA/rowsB 必须覆盖同一批 (style, seed) —— 不等长就抛，因为那说明比较根本不成对。
 */
export function pairedDiff(rowsA, rowsB, { field = 'win', reps = 4000, seed = 20261128, keyFn = keyOf } = {}) {
  const bByKey = new Map(rowsB.map(r => [keyFn(r), r]));
  const pairs = [];
  for (const a of rowsA) {
    const b = bByKey.get(keyFn(a));
    if (!b) throw new Error(`配对缺失：${keyFn(a)} 只在 A 臂里 —— 两臂不是同一批局`);
    pairs.push((Number(a[field]) || 0) - (Number(b[field]) || 0));
  }
  if (bByKey.size !== rowsA.length) throw new Error('两臂局数不等 —— 不能配对比较');

  const d = mean(pairs);
  const rng = makeRng(seed);
  const draws = [];
  for (let i = 0; i < reps; i++) {
    let s = 0;
    for (let j = 0; j < pairs.length; j++) s += pairs[Math.floor(rng.float() * pairs.length)];
    draws.push(s / pairs.length);
  }
  draws.sort((x, y) => x - y);
  const at = q => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(q * draws.length)))];
  return {
    d, lo: at(0.025), hi: at(0.975), n: pairs.length,
    // 同一批配对的朴素标准误，只为说明「旧的 ±」窄了多少
    naiveSe: Math.sqrt(pairs.reduce((a, x) => a + (x - d) ** 2, 0) / Math.max(1, pairs.length - 1) / pairs.length),
    pairs,
  };
}

/** 胜率 + 它的真实局数（不是复印次数）。 */
export function winRate(rows, field = 'win') {
  return { p: mean(rows.map(r => (Number(r[field]) || 0))), n: rows.length };
}

export function fmtPct(x, digits = 1) {
  return `${(100 * x).toFixed(digits)}%`;
}

export function fmtCI(d) {
  return `${(100 * d.d).toFixed(1)}pp [${(100 * d.lo).toFixed(1)}, ${(100 * d.hi).toFixed(1)}]（95%，配对 bootstrap，${d.n} 对）`;
}
