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
import { SLICE_CARDS } from '../data/slice.js';

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

// #3450（supervisor 第六轮）：那句「平均每局被踩 X 次」与它**紧跟着的** 0/1/2+ 分布是
// 同一个统计说了两遍 —— 分布更具体（玩家能对着「52 局一次都没踩到」想事），均值只是它的压缩。
// 所以确认框上两者同时在场时，让均值那句别出（`withHits:false`）。
// **流水单上不能去掉**：那里没有分布句，均值是那行唯一的落地频率。默认仍为 true。
export function poolShareLine(cost, plotName, { withHits = true } = {}) {
  const f = paybackFacts(cost);
  if (!f) return '';
  const pct = f.sharePct >= 100 ? Math.round(f.sharePct) : Math.round(f.sharePct * 10) / 10;
  const own = plotName ? f.perPlotHits[plotName] : undefined;
  const hitsPart = !withHits ? '' : own == null
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
// seasonDays 不设默认 3：写死一个季节长度就是这份代码一直在修的那种漂移。
// 调用方用 seasonLength(state) 现读；读不到时传 null，句子退回不带期限的写法。
export function paybackAccount(cost, unit, K, full, terms, seasonDays = null) {
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
  return `${div}${notFull}。${seasonLine(cost, unit, K, terms, seasonDays)}${paybackConditions()}`;
}

// 这一格一天里最多能被几个**别人**踩到 —— 把「还剩 N 天」换成「还能收几次」必须乘上它。
// 只数活着的敌对座位（自己的店不收自己的租，队友同理）；店家不在就不出数。
function opponentsOf(state, plotId) {
  const pr = state?.properties?.[plotId];
  const owner = state?.players?.find?.(p => p.id === pr?.ownerId);
  if (!owner) return 0;
  return (state.players ?? []).filter(p => p.alive && p.team !== owner.team).length;
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
      // #3456：同一天同一格能被收到的最大笔数。屏幕要把天数换成次数就必须用它，
      // 而不是默认「一天一次」。读到 0 时上层不出例子（不编）。
      maxPerDay: opponentsOf(state, plotId),
      plainUnit: plainFull - plainBefore, plainFull, plainBefore,
      hotUnit: hotFull - hotBefore, hotFull, hotBefore,
    };
  } finally {
    pr.level = levelNow; pr.inflate = inflateNow;   // 抛错也要复原：这两个字段是产品状态
  }
}

// 旺季持续几天 —— 只在这里读一次实现，句子不写死数字。
//
// 为什么需要：给旺季的 K 加期限（#3446）之后，**平常**那一支也必须给期限，否则
// 「它进了旺季 3 次就够」和上一版被否掉的那句一模一样 —— 许诺的条件只在 3 天里成立。
// 复刻用法的正确来源是 applyCard，但它要整张卡表与目标街；这里只需要「一次季节持续几天」，
// 所以从游戏已装载的卡牌描述原文里读，读不到就返回 null（句子退回不带期限的写法，不编数字）。
export function seasonLength(state) {
  const desc = SLICE_CARDS?.inflate?.desc ?? '';
  const m = /持续\s*(\d+)\s*天/.exec(desc);
  if (m) return Number(m[1]);
  const card = state?.cards?.find?.(c => c.id === 'inflate') ?? null;
  const m2 = /持续\s*(\d+)\s*天/.exec(card?.desc ?? '');
  return m2 ? Number(m2[1]) : null;
}

// 这条账横跨两种季节时，**当场能核的一笔例子**。
//
// #3450（supervisor 第六轮真机，第二次）：他要的是「先在旺季收过两次，结束后还差几次」。
// 我第一版只写方向（「收过的算贵的、剩下少于 K 次」）—— 他回的仍是「答不上来」，因为方向
// 不能拿去做决定。所以这里直接用产品自己的两个数算一遍给他看：
//   旺季里踩到 m 次 → 每次按 hot 收 → 剩 cost − m×hot → 这个余额按平常价要几次。
// m 取 inHot−1：这是「差一次就全在旺季收回」的那个中间情形，也是他真走到的那一步。
// 三个数（m / 收回 / 剩余）都是现算的，读者可以拿屏上的 hot 与 plain 逐位复算。
// 读不到 season 或两个价相同时不出句（不出编的值）。
// 次数一律走 roundsToRecover（全仓唯一的 ceil）。
const inHotCount = (cost, hot) => roundsToRecover(cost, hot) ?? 0;

// 旺季这个窗口里最多能收到几次 —— **不是「一天一次」**。
//
// #3456（supervisor 真机）：seed 42 机会买家开局第 15 天，晨光街茶铺一天收到两笔全额
// （7,800 与 11,200），因为两位对手当天都能踩到同一格。我在 #3453 里把例子次数夹成
// `min(inHot−1, 剩余天数)`，等于把**天数当成了次数上限**，于是旺季只剩 1 天时屏上只说得到 1 次。
// 实测（support/probe-3391/same-day-landings.mjs，3 起手 × 60 seed）：882 个「店×天」里
// 18 个当天收了两笔，最多 2 笔 —— 上限由**当天能踩到的对手数**定，不由天数定。
// 所以容量 = 对手数 × 剩余天数；不在这里写死 3 人局。
function hotCapacity(maxPerDay, days) {
  if (!(maxPerDay > 0) || !(Number.isFinite(days) && days > 0)) return null;
  return maxPerDay * days;
}

// #3456b（supervisor 追问）：屏上只留**一句能拿去做决定**的话，推导不进界面。
//
// 那个「最多」是上界还是例子的口径？——是上界，而且已在产品自己的结算上验过：
// support/probe-3391/cap-vs-settlement.mjs 数了 180 局（3 起手 × 60 seed）全部
// 「同一块地、同一天」的实付行 845 条：当天最多 2 笔，**没有一条超过当天对手数**，
// 也没有同一位对手一天在同一格付两次（他一天只有一个回合）。
// 结构性原因（不是抽样运气）：slice 里每位玩家一天只有一个回合，收租只在
// groundPhase 里按落点结算一次；面板外的东西（路面随机物、冰面/斜坡）只在完整模式，
// advanceDay 里 `if(!state.slice) spawnOccupants(state)` 就是那道闸。
// 所以「天数 × 活着且敌对的人数」是上界，不是这一个例子的口径。
//
// 但**乘法的推导不印在屏上**：玩家要做的是「这几天够不够收回这笔」，
// 他需要的是次数和一个为什么不是「一天一次」的短因，而不是两个因数相乘的算式。
function capacityClause(cap, days, maxPerDay) {
  if (!(cap > 0) || !(days > 0)) return '';
  // 只有一位对手时「每天各来一次」等于「一天一次」，说出来反而让人以为还有别人。
  return maxPerDay > 1
    ? `${days} 天内最多收 ${cap} 次：${maxPerDay} 位对手每天各来一次`
    : `${days} 天内最多收 ${cap} 次`;
}

function mixedExample(cost, plan, hot, inHot, capacity = null) {
  if (!(plan > 0) || !(hot > 0) || !(hot > plan) || !(inHot > 1)) return '';
  // #3453 复核第 1 条（真缺陷，我自己的）：m 取 inHot−1 却不看**还剩几天**。
  // 旺季只剩 1 天时说「旺季里踩到 2 次」当场自相矛盾（同屏上一句就是「今天是最后一天」）。
  // 实测 42 个可达格里 8 个这样打架（含街心书屋 L2→3 的「踩到 2 次」）。
  // 所以 m 必须夹在这个窗口**真能做到**的范围里。
  // #3456：这个范围是「对手数 × 剩余天数」，不是剩余天数 —— 上一条修法把天数当成了次数上限，
  // 于是旺季只剩 1 天就只说得到 1 次，而一天真能收到两笔（supervisor 实跑 seed 42 第 15 天）。
  let m = inHot - 1;
  if (Number.isFinite(capacity) && capacity > 0) m = Math.min(m, capacity);
  if (!(m >= 1)) return '';
  const got = m * hot;
  const left = cost - got;
  if (!(left > 0)) return '';
  const rest = roundsToRecover(left, plan);
  // 两个单价不在这里重复：它们就在同一行的除法句里，重复一遍会让「一个数只说一遍」破功
  // （判据 ⑥ 定的就是这个），而且读者会不知道哪个是本句的分母。
  return `例：旺季里踩到 ${m} 次收回 ${n0(got)}，剩 ${n0(left)}；`
    + `之后按平常价再 ${rest} 次就够本。`;
}

// 「这条账属于哪个季节」+「它什么时候会变」。返回 '' 表示两种口径同价（没什么可说）。
function seasonLine(cost, unit, K, terms, seasonDays) {
  if (!terms) return '';
  if (terms.inflating && terms.plainUnit > 0 && terms.plainUnit < unit) {
    const after = roundsToRecover(cost, terms.plainUnit);   // 唯一的 ceil 在下面那个函数里
    // 混合计数（supervisor 第六轮：他玩到「先在旺季收过两次，结束后还差几次」答不上来）。
    // K 与 after 都是**全部踩在同一种季节里**的两个端点，而真实的一局横跨两种季节。
    // 所以这里必须直接回答中间那种情形，而不是让读者自己插值：
    //   旺季里每踩一次收得更多 → 那些次数从这笔钱里扣掉 → 旺季结束后要的次数**少于** after。
    // 只写方向，不写一个编出来的总数（混了几次是这一局才知道的，屏上不许猜）。
    // #3446 第②条（复核抓到，真缺陷）：K=2 只在**旺季还开着**时成立。
    // 上一版把「满 2 次」写成无条件的上界，而旺季一共就 3 天 —— 2 次踩到一间小店
    // 在 3 天内几乎不可能（整局平均 2.66 次/16 天）。所以这句话必须带上**兑现期限**，
    // 否则它许诺的是一个会过期的条件。剩余天数读 pr.inflate，不推测。
    const days = terms.daysLeft > 1 ? `（还剩 ${terms.daysLeft} 天）` : '（今天是最后一天）';
    const cap = hotCapacity(terms.maxPerDay, terms.daysLeft);
    // #3456：这个窗口能收几次 = 天数 × 当天能踩到的对手数。先说清这个容量，
    // 再举例子 —— 否则「今天是最后一天」后面紧接「踩到 2 次」读者会以为自相矛盾，
    // 而一天里两位对手各来一次是真发生过的（supervisor 实跑 seed 42 第 15 天）。
    const clause = capacityClause(cap, terms.daysLeft, terms.maxPerDay);
    const room = clause ? `（${clause}）` : '';
    return `这条街现在在旺季${days}：上面的数已经是翻倍后的，那几次得在旺季结束前踩到${room}；`
      + `一结束每次只多收 ${n0(terms.plainUnit)}，就要 ${after} 次。`
      + mixedExample(cost, terms.plainUnit, terms.hotUnit, inHotCount(cost, terms.hotUnit), cap);
  }
  if (!terms.inflating && terms.hotUnit > unit) {
    const inHot = roundsToRecover(cost, terms.hotUnit);
    // #3448 复核 A 条（阻断）：这句话原来是无条件的「它进了旺季 3 次就够」，
    // 与旺季那一支被否掉的说法同构 —— 旺季只有几天，一次落点在旺季里本来就少见，
    // 所以「几次就够」必须**带上期限**，而且要说出过了这窗口就回到哪个数。
    // 季节长度从 seasonLength 读（不写死）；读不到时退回不带期限的写法，不编数字。
    // 用 >=：inHot 恰好等于天数时要求「每天都踩到一次」，那和做不到没有区别，
    // 而它正是复核点名的那一档（3 次 / 3 天）。用 > 会把这一档漏回旧写法。
    // #3456：但「3 次 / 3 天」不等于做不到 —— 一天里两位对手都能踩到同一格（实测 18/882 个店×天），
    // 所以窗口容量是「对手数 × 天数」。旧句「都得在这 3 天里踩到」把天数当成了次数上限，
    // 现在直接给出窗口里真能收到的次数，而不是让读者以为一天只能一次。
    const cap = hotCapacity(terms.maxPerDay, seasonDays);
    const clause = capacityClause(cap, seasonDays, terms.maxPerDay);
    if (seasonDays > 0 && inHot >= seasonDays) {
      return `不在旺季，上面是平常的数。进旺季（${seasonDays} 天）每次会多收 ${n0(terms.hotUnit)}，`
        + `${inHot} 次就够本${clause ? `；${clause}` : ''}。`
        + `错过了就按平常每次 ${n0(unit)} 算，要 ${K} 次。`
        + mixedExample(cost, unit, terms.hotUnit, inHot, cap);
    }
    // #3450（supervisor 第六轮）：这一支原来只说「进了旺季 N 次就够；旺季过去又回到 K 次」——
    // 两个端点都给了，但**跨季节**的那一半（旺季里踩过几次之后还剩几次）没说，
    // 而他正是卡在那里。所以补一句方向：旺季里收过的按贵的算，扣掉后剩下的少于 K 次。
    // 季节长度只要读得到就写出来，让读者知道那个窗口只有几天（读不到就不编）。
    const win = seasonDays > 0 ? `（${seasonDays} 天）` : '';
    return `不在旺季，上面是平常的数。进旺季${win}每次会多收 ${n0(terms.hotUnit)}，${inHot} 次就够；`
      + `旺季过去又回到 ${K} 次。`
        + mixedExample(cost, unit, terms.hotUnit, inHot, hotCapacity(terms.maxPerDay, seasonDays));
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

export function poolKLine(unit, K, full, cost, terms, seasonDays = null) {
  if (!(unit > 0) || !(K > 0)) return '';
  // #993 已签的不变量：「满 K 次一定回本」，不写成「才够本/至少要」。
  // 这里只说次数、不报增量 —— 增量归除法句（上面 paybackAccount 的唯一来源）。
  const head = `满 ${K} 次一定回本。`;
  // cost 缺省时（老调用点）没有除法可出，这时才把「全额 / 不盖也有」单独说一遍，
  // 否则那两个数会和除法句重复（复核 #3446 第③条）。
  if (!(cost > 0)) {
    return head
      + (full > unit ? `升级后全额租金 ${n0(full)}/次，其中 ${n0(full - unit)} 是原本就有的、不算回本。` : '')
      + seasonLine(cost, unit, K, terms, seasonDays) + paybackConditions();
  }
  return head + paybackAccount(cost, unit, K, full, terms, seasonDays);
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
