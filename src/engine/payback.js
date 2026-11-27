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

// #3391zp3：旺季的两个数只能从 rentFor 现读，不能在这里乘二 ——
// 乘二只该有 economy.js 一处（`inflate>0 ? 2 : 1`）。这里只负责把两种口径各读一遍。
import { rentFor } from './economy.js';

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

// #3391z：`unit` 是**本笔的增量**（升级后 − 升级前），不是升级后的全额。
// 两种账必须分开写，因为读者拿全额去算会得出「3 次就够本」，而真账是 5 次。
//
// #3391zp2：确认框与流水单**各说各的**，读者拿全额当分母，得出的次数比真账少。
// 所以两处必须共用同一份数：`paybackAccount(cost, unit, K, full, terms)` 是唯一实现。
//
// #3391zp3（supervisor 第五轮，本片的主改动）：他拿同一间店复算了**已经在旺季**的那一局——
//   「平常增量 2,800、要四次，旺季增量 5,600、要两次。屏上给出旺季的两次后，
//    仍说旺季每次可算两次，容易读成一次就回本。」
// 这一条是真缺陷，根因在 `rentFor`：`inflate>0 ? 2 : 1` 乘在 base 之后（economy.js:33），
// 所以升级前/升级后两个数**本来就已经含翻倍**，算出的 unit 与 K 已经是旺季的账。
// 上一版在这之外又写「旺季那次算两次」——同一笔钱被数了两遍，读者自然得出 1 次。
//
// 现在：旺季只作为**这条账属于哪个季节**写出来，并说清它**会变**：
//   · 账在旺季里 → 说「旺季结束后每次只多收 X，要 M 次」（数字变差，先说）；
//   · 账在平常   → 说「它进旺季时每次多收 Y，N 次就够；旺季过后回到这个数」。
// 两句都不再乘一次，也不再写「一次算两次」。
//
// 句子里必须出现：花费、每次多收（增量）、除法本身、以及「别拿全额去除」。
export function paybackAccount(cost, unit, K, full, terms) {
  // #3391zp4（复核 #3446 第③条）：这一屏 461 字、12 句，2,800 出现 4 次、5,600 3 次。
  // 那正是我自己写的「一个数只说一遍」被违反了 —— 不是措辞问题，是读者要在手机上
  // 从四个「2,800」里挑出哪一个是分母。所以每个数现在只在一个地方出现：
  //   2,800 只出现在除法里（分母只能有一个来源）；5,600 只出现在「别拿全额去除」那句；
  //   次数只出现在「满 K 次」与除法结果里。
  const div = `费用 ${n0(cost)} ÷ 每次多收 ${n0(unit)} = ${K} 次（除不尽向上取整）`;
  // 只有 full 真的大于 unit 时才有「原本就有的那部分」。相等时（0 级起盖）谈「不盖也有」是假话，
  // 「别拿 2,000 去除」更是劝人去用错分母（复核 #3446 第④条）。
  const notFull = full > unit
    ? `。别拿 ${n0(full)} 去除 —— 其中 ${n0(full - unit)} 是你不加盖也照收的`
    : '';
  return `${div}${notFull}。${seasonLine(cost, unit, K, terms)}${paybackConditions()}`;
}

// 旺季口径的两种读法。**这里不乘任何东西**：两个数都从 rentFor 现读，
// 差别只是把 inflate 打开/关掉各读一遍。乘二的实现只有 economy.js 一处。
export function seasonTerms(state, plotId, savedLevel) {
  const pr = state?.properties?.[plotId];
  if (!pr || typeof rentFor !== 'function') return null;
  const lvl = savedLevel ?? pr.level;
  const levelNow = pr.level, inflateNow = pr.inflate ?? 0;
  const at = (level, inflate) => { pr.level = level; pr.inflate = inflate; return rentFor(state, plotId); };
  try {
    const plainBefore = at(lvl, 0), plainFull = at(lvl + 1, 0);
    const hotBefore = at(lvl, 1), hotFull = at(lvl + 1, 1);
    return {
      inflating: inflateNow > 0,
      // 还剩几天旺季：`inflate` 就是剩余天数（applyCard 设值，advanceDay 里的 tickTimers 每天减一，
      // rentFor 在它 >0 时乘二）。不推测就不写这个数；这里读的正是产品字段本身。
      daysLeft: inflateNow,
      plainUnit: plainFull - plainBefore, plainFull, plainBefore,
      hotUnit: hotFull - hotBefore, hotFull, hotBefore,
    };
  } finally {
    pr.level = levelNow; pr.inflate = inflateNow;   // 抛错也要复原：这两个字段是产品状态
  }
}

// 「这条账属于哪个季节」+「它什么时候会变」。返回 '' 表示两种口径同价（没什么可说）。
function seasonLine(cost, unit, K, terms) {
  if (!terms) return '';
  if (terms.inflating && terms.plainUnit > 0 && terms.plainUnit < unit) {
    const after = roundsToRecover(cost, terms.plainUnit);   // 唯一的 ceil 在下面那个函数里
    // #3446 第②条（复核抓到，真缺陷）：K=2 只在**旺季还开着**时成立。
    // 上一版把「满 2 次」写成无条件的上界，而旺季一共就 3 天 —— 2 次踩到一间小店
    // 在 3 天内几乎不可能（整局平均 2.66 次/16 天）。所以这句话必须带上**兑现期限**，
    // 否则它许诺的是一个会过期的条件。剩余天数读 pr.inflate，不推测。
    const days = terms.daysLeft > 1 ? `（还剩 ${terms.daysLeft} 天）` : '（今天是最后一天）';
    return `这条街现在在旺季${days}：上面的数已经是翻倍后的，那几次得在旺季结束前踩到；`
      + `一结束每次只多收 ${n0(terms.plainUnit)}，就要 ${after} 次。`;
  }
  if (!terms.inflating && terms.hotUnit > unit) {
    const inHot = roundsToRecover(cost, terms.hotUnit);
    return `这条街现在不在旺季，上面是平常的数。它进了旺季每次会多收 ${n0(terms.hotUnit)}，${inHot} 次就够；旺季过去又回到 ${K} 次。`;
  }
  return '';
}

// 一次到手的钱为什么会变。两种情形**分开写**，因为它们的含义不同：
//   · 停业 → 收 0：那次什么也没收到；
//   · 对手付不出 → 只收到他剩下的那部分（engine：pay() 里 available < amount 时
//     收款方拿到的是 available，不是 rent）；按实收折算，不算满一次。
// 旺季不在这里：它已经算进 unit 了（见上面的注释），在这里再说一遍就是重复计数。
export function paybackConditions() {
  return `次数数的是对手停在你这块地上、真的收到全额的那几次，不是回合：`
    + `停业那次收 0，不算；对手付不出、只收到他剩下的那部分，按实收折算。`;
}

export function poolKLine(unit, K, full, cost, terms) {
  if (!(unit > 0) || !(K > 0)) return '';
  // #993 已签的不变量：「满 K 次一定回本」，不写成「才够本/至少要」。
  // 这里只说次数、不报增量 —— 增量归除法句（上面 paybackAccount 的唯一来源）。
  const head = `满 ${K} 次一定回本。`;
  // cost 缺省时（老调用点）没有除法可出，这时才把「全额 / 不盖也有」单独说一遍，
  // 否则那两个数会和除法句重复（复核 #3446 第③条）。
  if (!(cost > 0)) {
    return head
      + (full > unit ? `升级后全额租金 ${n0(full)}/次，其中 ${n0(full - unit)} 是原本就有的、不算回本。` : '')
      + seasonLine(cost, unit, K, terms) + paybackConditions();
  }
  return head + paybackAccount(cost, unit, K, full, terms);
}

// 回本次数：整个仓库只有一个 ceil 实现。
// 买地用「每回合整笔租金」，加盖用「升级带来的租金增量」—— 那是两个不同的每回合收益，
// 但「花多少钱 ÷ 每回合收益 ⇒ 几个回合」这一步不许各写一遍。
export function roundsToRecover(cost, perRound) {
  if (!(perRound > 0) || !(cost > 0)) return null;
  return Math.max(1, Math.ceil(cost / perRound));
}

// 升级行尾部那句。
//
// #3391zp2 上一版写的是「按上一条那句除法 —— 分母是每次多收的那部分」：它指路而不给数，
// 单独翻到这一行就读不出来（supervisor 第五轮）：「流水的『按上一条』单独翻看也找不到那笔除法」。
// #3391zp3：现在它自己带**分母那个数**。花费本来就在同一行（`（花费 10000）`），
// 两个数并列 ⇒ 这一行单看就能做那道除法，不必回头找上一行，也不把单位重复成两句。
//
// 两条已签约束仍守着：① 加盖日志里「租 N」那个字段必须是升级后的 rentFor；
// ② 不许出现「回合回本」（引擎没有每回合收租）。这里的「每次多收」是分母，不是租金字段。
export function roundsLine(cost, perRound, tail = '') {
  const r = roundsToRecover(cost, perRound);
  if (r == null) return '';
  return `${r} 次回本（花 ${n0(cost)} ÷ 每次多收 ${n0(perRound)} = ${r} 次）${tail}`;
}
