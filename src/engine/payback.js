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

// #3391z：`unit` 现在是**本笔的增量**（升级后 − 升级前），不是升级后的全额。
// 两种账必须分开写，因为读者拿全额去算会得出「3 次就够本」，而真账是 5 次。
//
// #3391zp（屏幕检查抓到的）：这里是三个**句子**的拼接，上一版只拼串、不写句号，
// 屏上读成「满 4 次一定回本升级后全额租金 5,600/次」—— 一句话里塞了两件事。
// 现在每一句自带句末标点，拼接处不再需要调用方补。
//
// #3391zp2（supervisor 第四轮，本片的主改动）：他重走 seed 3 后说——
//   「我是在加盖前做决定，而且拿流水单看仍会用 4,000 去除成本。」
// 也就是：确认框与流水单**各说各的**，读者拿全额当分母，得出的次数比真账少。
// 所以这一版不是再加形容词，而是让两处打印点**共用同一句账**：
//   `paybackAccount(cost, unit, K, full)` 是唯一实现，poolKLine 与 roundsLine 都调它。
//   「同一笔账」在代码里成立，才能在两块屏上都成立。
//
// 句子里必须出现：花费、每次多收（增量）、除法本身、以及「别拿全额去除」。
export function paybackAccount(cost, unit, K, full) {
  // 一个数只说一遍：全额那句（含「不盖也有」）由 poolKLine 出，这里只出除法。
  const div = `费用 ${n0(cost)} ÷ 每次多收 ${n0(unit)} = ${K} 次`
    + `（除不尽时向上取整，差一点也算一次）`;
  const notFull = full > 0
    ? `。别拿 ${n0(full)} 去除 —— 那 ${n0(full)} 里有 ${n0(full - unit)} 是你不加盖也照收的`
    : '';
  // 三种情形也并进这段账里，不留在调用方：这一轮的两条失败都是因为它们只挂在确认框
  // 那一句上，而流水单的另一行没有 —— 那样「同一笔账」只在代码里成立、不在屏上成立。
  return `${div}${notFull}。${paybackOutcomes()}`;
}

// 一次到手的钱为什么会变。三种情形**分开写**，因为它们的含义不同，混成一句会教错东西：
//   · 停业 → 收 0：那次什么也没收到；
//   · 对手付不出 → 只收到他剩下的那部分（engine：pay() 里 available < amount 时
//     收款方拿到的是 available，不是 rent）；按实收折算，不算满一次；
//   · 旺季（inflate）→ rentFor 翻倍：那一次**多**收，一次顶两次。
// 上一版把这三种写成「停业那次收 0、被抬价那次不足，都不算」—— 把「抬价」说成不足是**反的**。
// 这一条是自查抓到的：抬价那次的到手价是双倍，不是少付。
function paybackOutcomes() {
  // 不写具体金额：「按 5,600 全额」与下一句「旺季收双倍」并排会读成矛盾（那两次不是 5,600）。
  return `次数数的是对手停在你这块地上、真的收到全额的那几次，不是回合：`
    + `停业那次收 0，不算；对手付不出、只收到他剩下的那部分，按实收折算；`
    + `旺季那次租金翻倍，所以那一次算两次 —— 它比全额还多，不是少付。`;
}

export function poolKLine(unit, K, full, cost) {
  if (!(unit > 0) || !(K > 0)) return '';
  // #3391z（supervisor 第二轮）：不能把增量叫成「升级后每次足额」—— 那读起来像总租。
  // 三个数必须用三个名字分开写：全额租金 / 不盖也有的那部分 / 这笔新增。
  // 同一个数不在两句里各说一遍（上一版把 2,800 写成「不盖也有」又说成「这笔新增」，
  // 读起来像两笔钱）。
  const head = `本笔每次多收 ${n0(unit)}，满 ${K} 次一定回本。`
    + (full > 0 ? `升级后全额租金 ${n0(full)}/次，其中 ${n0(full - unit)} 是原本就有的、不算回本。` : '');
  // cost 缺省时（老调用点）仍给出全额那句，但不编一个不存在的除法。
  return cost > 0 ? head + paybackAccount(cost, unit, K, full) : head + paybackOutcomes();
}

// 回合回本：整个仓库只有一个 ceil 实现。
// 买地用「每回合整笔租金」，加盖用「升级带来的租金增量」—— 那是两个不同的每回合收益，
// 但「花多少钱 ÷ 每回合收益 ⇒ 几个回合」这一步不许各写一遍。
export function roundsToRecover(cost, perRound) {
  if (!(perRound > 0) || !(cost > 0)) return null;
  return Math.max(1, Math.ceil(cost / perRound));
}

// #3391z（supervisor 两轮抓到）：这句话必须能**单独读懂**。
//
// #3391zp2（第四轮）：它也不再自己编句子 —— 除法与三种情形都来自同一段账。
// 但它**不重复三种情形**：那一行紧挨着上面那条账，同一句在一屏上说两遍反而更难读
// （第一版就这样，屏上出现两遍「停业那次收 0」）。
//
// 两条已签约束把「增量」排除在这一行之外：
//   ① test/slice-build-rent.test.js:55 断言加盖日志里**不得出现升级前的租金**；
//   ② 而增量经常正好等于升级前的租金（小店 2→3 级：升级前 4,000、增量 4,000）。
// 所以这一行只点明「分母不是这一行印的那个数」，把带数字的除法留给紧邻的上一条。
export function roundsLine(cost, perRound, tail = '') {
  const r = roundsToRecover(cost, perRound);
  if (r == null) return '';
  // 这一行印的是**加盖后**的租金，而分母是「每次多收」—— 用户读错的地方就是这里
  // （拿 10,000 ÷ 5,600 得出 2 次）。所以句中直接说「分母不是这一行印的那个数」。
  return `${r} 次回本：按上一条那句除法 —— 分母是每次多收的那部分，不是这一行印的全额租金${tail}`;
}