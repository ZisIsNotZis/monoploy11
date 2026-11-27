// #1044：付费加盖/买地的「值不值」账 —— 全仓只有这一份取数。
//
// 为什么要有这个文件：
//   #993 给的那句主句是「满 K 次一定够本」。K 是算术上成立的上界，但 #998 用同一批 21 局量出来：
//   130 条提议里 K 被真达到 0 次，跨臂最多 4/354。根因是账不是几何 —— 真发生的付费升级花掉
//   990,000，而全场所有租金合计只有 468,600（2.11 倍）。玩家按「满 K 次」做决定，
//   等于按一个不会发生的条件做决定。
//
// 所以这里把「这一笔有多大」摊到本盘实测的租金池上，且三个真打印点（加盖提议框、加盖日志、
// 买地框）都从这一份数里取，不各算一份 —— 三处各算必然分叉，分叉后玩家不知道该信哪句。
//
// 表怎么来的：.scratch/1044-k-honest/probe-pool.mjs，grow/take/cross × seed 1–24 = 72 局，
// 与 LANDING_STATS 同一批。口径只认「实付租金」行里真到账的金额（rentRowsFor 的 earned），
// 不认应付：付租方现金不够时两者不等（#949 实测 90 条实付行里 6 条不等）。
// 三人合计，所以句子里必须写「全场」，不能写「你的」。
//
// 这张表随 AI 策略/棋盘/数值变化而失效；改了一律要重新生成，由 test/payback-pool.test.js 守着。

export const RENT_POOL = {
  games: 72,
  seeds: 'grow/take/cross × seed 1–24',
  note: '整局三人合计的真到账租金（只认实付行）；单位为元',
  // 每局的整局租金合计，升序。写成逐局而不是只写均值：
  // 「有几局整局租金还不够这一笔」是玩家当场能核的数，均值只能让人算出百分比。
  innings: [
    0, 0, 0, 0, 2000, 2800, 2800, 2800, 2800, 2800, 2800, 4000, 4000, 4800, 4800, 4800,
    5600, 5600, 5600, 5600, 6000, 6000, 6800, 7600, 7600, 8400, 9600, 9600, 9600, 11200, 11200, 11200,
    11200, 12000, 12400, 13200, 13200, 13200, 13600, 14000, 14000, 14800, 16400, 16800, 16800, 17000, 17000, 17600,
    17800, 18000, 18000, 19800, 20800, 21800, 22600, 22800, 26800, 27600, 27600, 27600, 28000, 28400, 30800, 36000,
    37200, 37200, 37600, 37600, 38000, 38400, 39000, 58600,
  ],
  // 每间店每局平均被收费次数（含撞上停业、一分钱没收的那次，与 LANDING_STATS 同一口径）。
  // 分子是 259 条收租行，分母是 13 间店 × 72 局。
  rentRows: 259,
  meansPerPlot: {
    '晨光街小店': 0.319, '晨光街茶铺': 0.236, '晚风街小店': 0.153, '晚风街茶铺': 0.194,
    '灯火街小店': 0.431, '灯火街茶铺': 0.639, '月色街小店': 0.125, '月色街茶铺': 0.083,
    '西巷小店': 0.125, '西巷茶铺': 0.111, '东巷小店': 0.097, '东巷茶铺': 0.139,
    '街心书屋': 0.944,
  },
};

const n0 = n => Math.round(n).toLocaleString();

export const poolMean = () => RENT_POOL.innings.reduce((a, b) => a + b, 0) / RENT_POOL.games;
export const poolMedian = () => RENT_POOL.innings[Math.floor(RENT_POOL.games / 2)];

// 一笔钱在本盘租金池里占多大：返回可核的四个数，不返回句子。
// gamesBelow = 整局全场租金还不到这一笔的局数 —— 这是「值不值」最直接的一个读数：
// 在那几局里，即使全场的租金全归你，这一笔也收不回来。
export function paybackFacts(cost) {
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const mean = poolMean();
  const perPlot = RENT_POOL.meansPerPlot;
  const totalPlots = Object.keys(perPlot).length;
  const tableWide = RENT_POOL.rentRows / RENT_POOL.games / totalPlots;
  return {
    cost,
    mean,
    median: poolMedian(),
    sharePct: 100 * cost / mean,
    gamesBelow: RENT_POOL.innings.filter(x => x < cost).length,
    games: RENT_POOL.games,
    tableWideHits: tableWide,
    perPlotHits: perPlot,   // 由调用方按店名取，取不到就没有这间店的分布
  };
}

// 主句：一笔钱值不值。
// 硬约束：
//   - 分母只能来自实测表，不许是任何未来量；
//   - 不许出现「预计/大概会/应该」；
//   - 不许把 K 写成主句（K 只在 poolKLine 的尾部出现）；
//   - **#1143：挂在常数上的句子不许写「本盘」/「本局」。** 这两个词的使用权归这一局的账本；
//     表是 72 局，本局是这一局，说成「本盘」就是让玩家按错的对象想事（用户 #1143 判据第 1 条）。
//     实测依据：21 局 124 条付费提议里 63 条发生在「本局此刻租金 = 0」（第 1/3/4 天全为 0），
//     所以真本局那个分母在一半场合是空的，不能拿来当主句。见 .scratch/1143-provenance/。
export const POOL_SOURCE = '同规则 72 局（grow/take/cross × seed 1–24）';

export function poolShareLine(cost, plotName) {
  const f = paybackFacts(cost);
  if (!f) return '';
  const pct = f.sharePct >= 100 ? Math.round(f.sharePct) : Math.round(f.sharePct * 10) / 10;
  const own = plotName ? f.perPlotHits[plotName] : undefined;
  const hitsPart = own == null
    ? `那 ${f.games} 局里每间店平均每局被踩 ${f.tableWideHits.toFixed(2)} 次（这间店没有单独实测）。`
    : `这间店在那 ${f.games} 局里平均每局被踩 ${own.toFixed(2)} 次（13 间店平均 ${f.tableWideHits.toFixed(2)} 次）。`;
  return `${POOL_SOURCE}里，一整局全场租金（三人合计）平均 ${n0(f.mean)}，这一笔是它的 ${pct}%；`
    + `${f.games} 局里有 ${f.gamesBelow} 局的整局租金还不够这一笔。${hitsPart}`;
}

// 尾部上限说明：K 句沿用 #993 已签的上界说法，但不再是主句。
// 这里**不**重复 #993 的落地分布表：那件事已经有 LANDING_STATS 一份真相，
// 由调用方（ui/slice.js）把它接在后面。engine 不 import ui —— 层级反转会让 ui 的改动
// 反过来改引擎行为，这不是取数问题，是依赖方向问题。
// #3391z：`unit` 现在是**本笔的增量**（升级后 − 升级前），不是升级后的全额。
// 两种账必须分开写，因为读者拿全额去算会得出「3 次就够本」，而真账是 5 次。
export function poolKLine(unit, K, full) {
  if (!(unit > 0) || !(K > 0)) return '';
  // #3391z（supervisor 第二轮）：不能把增量叫成「升级后每次足额」—— 那读起来像总租。
  // 三个数必须用三个名字分开写：全额租金 / 不盖也有的那部分 / 这笔新增。
  // 两个数用两个名字说开：全额租金（不盖也有的那部分含在里面）与这笔新增。
  // 同一个数不在两句里各说一遍（上一版把 2,800 写成「不盖也有」又说成「这笔新增」，
  // 读起来像两笔钱）。
  const both = full > 0
    ? `升级后全额租金 ${n0(full)}/次，其中 ${n0(full - unit)} 是原本就有的、不算回本。`
    : '';
  // 次序沿用 #1044 已签的：调用方把池子主句拼在最前，这一段只说本笔的账。
  return `本笔每次多收 ${n0(unit)}，满 ${K} 次一定回本${both}`
    + `单位：数的是「对手停在你这块地上的次数」，不是回合 —— 对手不走过来就不兑现。`;
}

// 回合回本：整个仓库只有一个 ceil 实现。
// 买地用「每回合整笔租金」，加盖用「升级带来的租金增量」—— 那是两个不同的每回合收益，
// 但「花多少钱 ÷ 每回合收益 ⇒ 几个回合」这一步不许各写一遍。
export function roundsToRecover(cost, perRound) {
  if (!(perRound > 0) || !(cost > 0)) return null;
  return Math.max(1, Math.ceil(cost / perRound));
}

// #3391z（supervisor 抓到）：这里数的是「被踩到几次」，不是回合。
// 引擎只在有人**停到这块地上**时收租，从来没有「每回合收租」这回事；
// 写成「回合回本」会把 5 次读成 5 个回合，而 16 天里这间店平均只被踩 0.13 次。
export function roundsLine(cost, perRound, tail = '') {
  const r = roundsToRecover(cost, perRound);
  return r == null ? '' : `${r} 次回本${tail}`;
}
