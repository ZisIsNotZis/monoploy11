// #3391y：带 rot 的配对统计。
//
// 为什么不复用 stats.mjs：它的配对键是 `style:seed`，不含 rot。而这一支每个 seed 跑
// 3 张椅子，那是 3 个观测；压成一条会把重复测量当独立样本。
// （复核 #3425 自己踩过这个坑：算出 −6.2pp，与两臂均值差自相矛盾。）
const obsKey = r => `${r.styleId}|${r.key}`;

export function assertObsUnique(rows, label) {
  const seen = new Set();
  for (const r of rows) {
    const k = obsKey(r);
    if (seen.has(k)) throw new Error(`${label}: ${k} 出现两次`);
    seen.add(k);
  }
  return seen.size;
}

export function paired(rowsA, rowsB, field = 'win') {
  const bByKey = new Map(rowsB.map(r => [obsKey(r), r]));
  const pairs = [];
  for (const a of rowsA) {
    const b = bByKey.get(obsKey(a));
    if (!b) throw new Error(`配对缺失：${obsKey(a)}`);
    pairs.push((Number(a[field]) || 0) - (Number(b[field]) || 0));
  }
  if (bByKey.size !== rowsA.length) throw new Error('两臂局数不等');
  const d = pairs.reduce((x, y) => x + y, 0) / pairs.length;
  const se = Math.sqrt(pairs.reduce((a, x) => a + (x - d) ** 2, 0)
    / Math.max(1, pairs.length - 1) / pairs.length);
  return { d, lo: d - 1.96 * se, hi: d + 1.96 * se, n: pairs.length };
}

export const fmtCI = d => `${(100 * d.d).toFixed(1)}pp [${(100 * d.lo).toFixed(1)}, ${(100 * d.hi).toFixed(1)}]（95%，${d.n} 对）`;
