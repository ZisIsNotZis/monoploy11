// #3338：买地这一笔到底动了什么账 —— 全仓只有这一份取数，买地屏与结算屏都从这里读。
//
// 为什么必须只有一份：上一版两屏各说一套，方向相反。
//   买地屏（render.js 的 buy 框）拿这 26,000 去比**全场租金池**，印出
//     「72 局里有 56 局的整局租金还不够这一笔」——读起来是「这笔收不回来，别买」。
//   结算屏（slice.js 的 nextGameLine）却说「第 4 天就去拿街心书屋」。
// 玩家在同一局里先后读这两句，只能得出「有一句在骗人」。
//
// 根因不是文案，是口径错了：买地是**资产换手**，不是花掉。
//   economy.assetsOf 把地产按 buyPrice 计入总资产，而无主地的 buyPrice 就是它的标价
//   ⇒ 现金 −26,000、地产 +26,000，总资产一分不变。
// 实测（.scratch/3338/ledger.mjs：真 buyPlot 前后读 assetsOf，三种起手 × 四个 seed，
// 全是 60,000 → 60,000，dAssets 0）。所以「整局租金够不够这一笔」这个问法本身不成立：
// 租金要覆盖的不是那 26,000（它还在你的资产里），而是**这笔现金被占住的机会成本**。
//
// 玩家当场真正要权衡的是三件事，这里就量这三件：
//   ① 记分：总资产变多少（无主地恒为 0，有主地不走这条路）；
//   ② 现金压力：买完剩多少、对手店里此刻最贵的一次租是多少 ⇒ 还能被踩几次不破产；
//   ③ 对手走位：72 局里我拿到它之后，别人踩到它几次、真到账多少（这部分不由我决定）。
//
// 表的来源与口径同 RENT_POOL / LANDING_STATS：grow/take/cross × seed 1–24 = 72 局，
// 同一套 AI（人类座位也由 AI 出牌），三个起手都走真入口。
// 复跑：node support/probe-3338/ledger-table.mjs 24
// 表随 AI/棋盘/数值变化而失效；test/market-ledger.test.js 逐值重算，不读探针输出。
import { assetsOf, rentFor, buyPrice } from './economy.js';
import { RENT_POOL } from './payback.js';

export const MARKET_PLOT = 'market';
export const MARKET_SOURCE = '同规则 72 局（grow/take/cross × seed 1–24）';

// 街心书屋（26,000，第 4 天开售）在 72 局终局时的归属，以及**我持有时**的实况。
//   stoppedByRival = 我持有时「对手停在它旁边」的局数分布 [0 次, 1 次, 2 次及以上]
//   earnedMean     = 我持有时整局真到账租金的均值（只认实付行里收到 >0 的）
//   earnedZero     = 我持有时一分租金都没收到的局数
//   myOwnStops     = 我自己停在它旁边却一分钱没收到：31/31 局都发生过，合计 155 次。
//                   引擎里 rentFor 只在**付款那一路**被读（flow.js groundPhase 的对手分支）；
//                   自己的店只走「要不要加盖」的询问，所以自己站旁边永远收不到租。
export const MARKET_LEDGER = {
  games: 72,
  ownership: { mine: 31, rival: 37, nobody: 4 },
  whenMine: {
    games: 31,
    stoppedByRival: [1, 3, 27],
    earnedMean: 11_948,
    earnedZero: 5,
    myOwnStops: { games: 31, total: 155 },
  },
  whenRival: { games: 37, earnedMean: 7_811 },
};
const n0 = n => Math.round(n).toLocaleString();

// 买下这块地当场动了什么。三个数都从引擎读，不写常数。
// assetsDelta 用真 assetsOf 前后差算（临时改归属后立刻恢复，与 buildForwardK 同构）。
export function buyLedgerFacts(state, plotId, viewer) {
  const p = viewer ?? state.players?.find(q => q.controller === 'human');
  const plot = state.map?.plots?.find(x => x.id === plotId);
  const pr = state.properties?.[plotId];
  if (!state?.slice || !p || !plot || !pr) return null;
  if (pr.ownerId) return null;                       // 有主的地不走这条路（收购是另一套价）
  const price = buyPrice(state, plotId);
  if (!Number.isFinite(price) || price <= 0) return null;

  const before = assetsOf(state, p);
  const saved = { ...pr };
  let after = before, rent = 0;
  try {
    state.properties[plotId] = { ...pr, ownerId: p.id };
    after = assetsOf(state, p);
    rent = rentFor(state, plotId);
  } finally { state.properties[plotId] = saved; }

  // 现金压力的量具：对手店里此刻最贵的一次租（自己的店踩到不付钱，无主地还没人收）。
  let rivalMaxRent = 0, rivalName = null;
  for (const other of state.map.plots) {
    const opr = state.properties?.[other.id];
    if (!opr?.ownerId || other.id === plotId) continue;
    const owner = state.players.find(q => q.id === opr.ownerId);
    if (!owner || owner.team === p.team) continue;
    const r = rentFor(state, other.id);
    if (r > rivalMaxRent) { rivalMaxRent = r; rivalName = other.name; }
  }
  // #3343：这块地对**同街其他已开张的店**做了什么。
  // 同街乘数是 1 + 0.4 × (本队该街已建店数 − 1)，所以买下这条街的第二间，
  // 自己那条街的每一间都会涨 —— 这是「补齐一条街」真正的收益。
  // 旧屏只印这一块自己的 rent，等于把这条计划的一半藏起来（实测 2,000 → 2,800）。
  const sameStreet = state.map.plots.filter(x => x.id !== plotId && !x.big && x.street === plot.street);
  const mineOnStreet = sameStreet.filter(x => {
    const o = state.properties?.[x.id];
    const owner = state.players.find(q => q.id === o?.ownerId);
    return owner && owner.team === p.team && (o.level ?? 0) > 0;
  });
  let streetBefore = 0, streetAfter = 0, streetClosedNow = false;
  if (mineOnStreet.length) {
    // 量的是**结构上的**涨租：临时把这条街上各店的「停业」当 0，算完逐字段放回原对象。
    // #3343 真入口撞到的缺陷就在这里：这条街**停业**时 rentFor 两侧都是 0，
    // 于是「补齐」那一行被静默漏掉 —— 而停业恰恰是最需要说清「这条路是哪一种」的时候。
    // 前后两次量都在同一前提下（本条街按开业计），否则会把停业差算成涨租。
    const closedSaved = mineOnStreet.map(x => state.properties[x.id].closed);
    const target = state.properties[plotId];
    const targetClosed = target.closed;
    try {
      mineOnStreet.forEach(x => { state.properties[x.id].closed = 0; });
      state.properties[plotId] = { ...target, closed: 0 };
      for (const x of mineOnStreet) streetBefore += rentFor(state, x.id);
      state.properties[plotId] = { ...target, closed: 0, ownerId: p.id };
      for (const x of mineOnStreet) streetAfter += rentFor(state, x.id);
    } finally {
      state.properties[plotId] = target;
      mineOnStreet.forEach((x, i) => { state.properties[x.id].closed = closedSaved[i]; });
    }
  }
  // 这条街此刻是不是停业（只影响措辞：数字说的是开业时的账）。
  streetClosedNow = (pr.closed ?? 0) > 0 || mineOnStreet.some(x => (state.properties[x.id].closed ?? 0) > 0);
  const cashAfter = (p.cash ?? 0) - price;
  return {
    id: plotId, name: plot.name, price, rent,
    cashBefore: p.cash ?? 0, cashAfter,
    assetsBefore: before, assetsAfter: after, assetsDelta: after - before,
    rivalMaxRent, rivalName, big: !!plot.big,
    streetName: plot.street,
    streetMineCount: mineOnStreet.length,
    streetBefore, streetAfter, streetGain: streetAfter - streetBefore, streetClosedNow,
    // 买完的现金够被踩几次（只按此刻这一个租金档次算；租金会随等级和旺季涨，句中要写明「此刻」）。
    hitsCovered: rivalMaxRent > 0 ? Math.floor(cashAfter / rivalMaxRent) : null,
  };
}

// 买地屏用：三行，每行口径各自标明。返回数组，调用方逐行挂到 <p data-ledger>。
// 这一屏**不印**「整局租金够不够这一笔」——那笔钱没有消失，它变成了同价的地。
export function buyLedgerLines(state, plotId, viewer) {
  const f = buyLedgerFacts(state, plotId, viewer);
  if (!f) return [];
  const lines = [];

  // ⓪ 买不起时先说买不起（#3358 supervisor 在 grow/19 上抓到的真缺陷）：
  // 那一屏现金 13,000、标价 26,000，而字还在算「现金 13,000 → -13,000」
  // 与「够付 -3 次」—— 两句都是算术真、可用假。玩家的问题不是「买完剩多少」，
  // 是「差多少」。所以这一支只报缺口 + 那份 72 局表（后者对他下局有用），
  // 不印任何「买完」的数。
  if (f.cashAfter < 0) {
    lines.push(`买不起：现金 ${n0(f.cashBefore)}，还差 ${n0(-f.cashAfter)} 才够 ${n0(f.price)}。`
      + `这笔账要等你真付得出来那天才算数。`);
    pushWalkingLine(lines, f);
    return lines;
  }

  // ① 记分：三个数并排写出来，玩家自己能加减。
  lines.push(`本局账本：现金 ${n0(f.cashBefore)} → ${n0(f.cashAfter)}，地产标价 +${n0(f.price)}，`
    + (f.assetsDelta === 0 ? '总资产不变。' : `总资产 ${f.assetsDelta > 0 ? '+' : ''}${n0(f.assetsDelta)}。`));

  // ⓪′ 这条路是哪一种：补齐自己那条街，还是开一条新的。
  // 这是 #3343 缺口：屏上原来只有「这一块自己的租金」，于是「补齐一条街」
  // 与「买一块陌生的地」看起来一模一样 —— 而前者在引擎里还带着整条街的乘数。
  // 数字全部现算（rentFor 前后差），不写常数。
  if (f.big) {
    // 书屋不属于任何一条小店街（street 就是「书屋」），说「这座城市你一间店都没有」是噪音。
  } else if (f.streetMineCount > 0 && f.streetGain > 0) {
    // #3343 supervisor 判据：一个没看过账本的人要能照这屏说对它。
    // 上一版写「每轮到手 +800」是错的：引擎里租金只在**对手停到那块地上**时才收
    // （flow.js 的「实付租金」行只在 landingPhase 写），没有每回合进账这回事。
    // 所以这句必须说「谁」「什么时候」「多收多少」，而不是一个叫「每轮到手」的数。
    // 停业时用的是「再次开业时」的价（否则两个数都是 0，等于什么都没说）。
    const when = f.streetClosedNow ? '、这条街再次开业时' : '，现在';
    const ownBit = f.rent > 0
      ? `；这间自己也是一样，对手停到它上面付 ${n0(f.rent)}`
      : '；这间自己此刻停业，收不到';
    lines.push(`这条路是补齐：${f.streetName}你已有 ${f.streetMineCount} 间。`
      + `补齐后${when}，对手停到你这条街的任一店，单次租金从 ${n0(f.streetBefore)} 涨到 ${n0(f.streetAfter)}`
      + `（同一次多收 ${n0(f.streetGain)}）${ownBit}。`
      + '租金只在对手停过来时收，不是每回合收。');
  } else if (f.streetMineCount === 0) {
    lines.push(`这条路是开新的：${f.streetName}上你一间店都没有，`
      + (f.rent > 0
        ? `对手停到这间付你 ${n0(f.rent)}，没有同街加成。`
        : '这间此刻停业，买下也收不到租，没有同街加成。')
      + '租金只在对手停过来时收；下次再买这条街的另一间，同街加成才会出现。');
  }

  // ② 现金压力：这才是这笔钱真正的代价。
  if (f.rivalMaxRent > 0) {
    // 「够付 0 次」在算术上对，但读起来像个 bug（supervisor 在 grow/4 上也提到了）。
    // 0 次就是「一次都付不起」，直接用这句话。
    const hits = f.hitsCovered === 0
      ? `连一次都付不起（一次租就是 ${n0(f.rivalMaxRent)}）`
      : `够付 ${f.hitsCovered} 次`;
    lines.push(`买完剩 ${n0(f.cashAfter)}；此刻对手店里最贵的一次租是 ${n0(f.rivalMaxRent)}`
      + `（${f.rivalName}），${hits} —— 等级和旺季都会把租金再抬高。`);
  } else {
    lines.push(`买完剩 ${n0(f.cashAfter)}；此刻对手的店里还没有能收租的，现金压力先来自他们后头涨价。`);
  }

  // ③ 对手走位：不由我决定的那一半，用局数说（与结算屏同一份表）。
  pushWalkingLine(lines, f);
  return lines;
}

// 走位那一行：买得起、买不起两种局面都说同一件事，所以单独拆出来。
function pushWalkingLine(lines, f) {
  if (f.id === MARKET_PLOT) {
    const m = MARKET_LEDGER.whenMine, [z, one, many] = m.stoppedByRival;
    lines.push(`${MARKET_SOURCE}：先拿到它的 ${m.games} 局里，对手踩到 0 次 ${z} 局 / 1 次 ${one} 局`
      + ` / 2 次及以上 ${many} 局，平均实收 ${n0(m.earnedMean)}（${m.earnedZero} 局一分没收到）。`);
  } else {
    // 小店的走位频率只存一份：payback.RENT_POOL.meansPerPlot（同一批 72 局）。
    const hits = RENT_POOL.meansPerPlot[f.name];
    if (hits != null) {
      lines.push(`${MARKET_SOURCE}：这间店整局被踩到 ${hits.toFixed(2)} 次/局`
        + `（13 间店平均 ${(RENT_POOL.rentRows / RENT_POOL.games / 13).toFixed(2)} 次）。`);
    }
  }
}

// 结算屏用：我持有时「租金从哪来」的实话。
// 引擎规则：rentFor 只在对手踩到的那一路被读；自己停在自己店旁边收不到租。
// 所以下一局能改的只有两件——等级（到顶就到顶了）与旺季卡（这条街租金 ×2，持续 3 天）。
export function holdLeversFacts(state, viewer) {
  const p = viewer ?? state.players?.find(q => q.controller === 'human');
  const pr = state.properties?.[MARKET_PLOT];
  if (!state?.slice || !p || !pr || pr.ownerId !== p.id) return null;
  const max = state.config?.maxLevel ?? 3;
  const lv = pr.level ?? 0;
  const rent = rentFor(state, MARKET_PLOT);
  const saved = pr.level;
  let topRent = rent;
  if (lv < max) {
    try { pr.level = max; topRent = rentFor(state, MARKET_PLOT); }
    finally { pr.level = saved; }
  }
  // #3358：停业中 rentFor 返回 0，于是「每次 0 变 0」是一句真数字、假结论的话
  // （supervisor 在 grow/4 终局停业时读到）。旺季卡本身也改不了停业：
  // game.js 里 close 设 closed=2、inflate 设 inflate=3，而 rentFor 先判 closed>0 就直接返回 0。
  // 所以这里把停业说清，并把「停业结束后」的租金算出来 —— 那才是旺季能不能用的前提。
  const closed = pr.closed ?? 0;
  let reopened = rent;
  if (closed > 0) {
    const savedClosed = pr.closed;
    try { pr.closed = 0; reopened = rentFor(state, MARKET_PLOT); }
    finally { pr.closed = savedClosed; }
  }
  return { level: lv, max, rent, topRent, inflatedRent: rent * 2,
    closed, reopened, reopenedInflated: reopened * 2,
    buildCostToTop: lv < max ? bigBuildCost(state) : null };
}

// 书屋加盖的真实价钱：flow.js 的 buildPlot 与加盖询问都写 `pr.big ? 30_000 : buildCost(...)`。
// #3338 修的真缺陷：结算屏原来用 buildCost(lv+1) 报「从 2 级到 3 级要花 15,000」，
// 而引擎对书屋（big）固定扣 30,000 —— 差一倍。实测 charged=30000。
export function bigBuildCost(state) {
  return Math.round(30_000 * (state.priceIndex ?? 1));
}
