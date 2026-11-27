import { TUNING } from '../data/tuning.js';
import { mapRentMultiplier } from './map-runtime.js';

export const teamOf = (p) => p.team;

export function ownsStreet(state, team, street) {
  return Object.entries(state.properties)
    .filter(([, pr]) => {
      const owner = state.players.find(p => p.id === pr.ownerId);
      return owner?.team === team && pr.street === street && !pr.big && pr.level > 0;
    }).length;
}

export function plotIdOf(state, ref) {
  const node = state.map.nodes.find(n => n.id === ref);
  return node?.plotId ?? ref;
}

export function rentFor(state, ref) {
  const cellId = plotIdOf(state, ref);
  const pr = state.properties[cellId];
  const plot = state.map.plots.find(p => p.id === cellId);
  if (!pr || !plot) return 0;
  if (!pr.ownerId) return 0;
  if (pr.closed > 0) return 0;
  if (pr.big && (!pr.bigType || pr.bigType === 'park')) return 0;
  if (!pr.big && !(pr.level > 0)) return 0;
  const level = Math.max(1, pr.level);
  const base = pr.big ? (TUNING.rentBase[level] ?? TUNING.rentBase[1]) : 2_000 * Math.pow(2, level - 1);
  const owner = state.players.find(p => p.id === pr.ownerId);
  const chain = pr.big ? 1 : 1 + TUNING.streetMultiplier * Math.max(0, ownsStreet(state, owner?.team, pr.street) - 1);
  const big = pr.big ? TUNING.bigRentMultiplier : 1;
  const inflate = pr.inflate > 0 ? 2 : 1;
  return Math.round(base * chain * big * inflate * state.priceIndex * mapRentMultiplier(state, { ...pr, id: cellId }));
}

// #3342 结论：这里曾实现过一条「停在自己店旁 = 营业/巡视」的新收入规则，**已删除**。
// 它没通过自己的判据：任何能摊平 10,000 加盖的比例，都同时把营业抬到收租的数倍，
// 于是「对手走过来」这个唯一的紧张感消失；按层计还会把街角店主抬到 80% 胜率。
// 通过判据的是**开局所有权**（data/slice.js 的 STARTS_CONTESTED）。证据：support/probe-3342/。

export function buyPrice(state, ref) {
  const cellId = plotIdOf(state, ref);
  const plot = state.map.plots.find(p => p.id === cellId);
  const pr = state.properties[cellId];
  const base = pr?.price ?? plot?.price ?? (plot?.big ? (state.config?.bigPlotPrice ?? 20_000) : (state.config?.smallPlotPrice ?? 8_000));
  if(state.config.mode==='slice') {
    const initial=state.map.initialProperties?.find(p=>p.plotId===cellId)?.level??0;
    return Math.round(base+Math.max(0,(pr?.level??0)-initial)*(plot?.big?8000:4000));
  }
  return Math.round(base * state.priceIndex);
}

// #3332：收购卡要花多少钱 —— 全仓唯一一处算这个数的地方。
//
// 为什么必须只有一处：这个数被印在五处（引擎扣款、手牌卡面、选目标时的地图角标、
// 「最便宜一块多少」那句、AI 的估值）。五份各自乘 1.25，就是五份会漂的公式；
// insight.js 的 BUYLAND_PREMIUM 与 game.js 的 1.25 现在只能靠一条测试钉住相等，
// 那就是「同一件事有两份实现」的化石。
//
// 而 125% 是**付给原主人**的溢价，所以它只在**真有原主人**时成立。
// 空地（ownerId == null）没有原主人可说服：乘 1.25 等于把一笔钱凭空烧掉。
// 实测（take，seed 1–40，240 个无主目标全数）：我方资产 -2,000、对方 0 变动，
// 那 2,000 不存在于任何人账上（buyPrice 8,000 却被扣 10,000）。
// 后果是「每个合法目标都亏 2,000」：AI 在 40/40 局里一次都没用这张卡，
// 配对实测（n=400）与「完全不用卡」逐位相同 —— 一张牌等于不存在。
// 同一块地两条路还互相打脸：走过去买 8,000，拿卡远程买同一块空地 10,000。
//
// 所以 slice 里这张卡的合法目标改成**只收有主的店**（与卡面「收购别人的小店」同义），
// 价仍然是标价 × 1.25、原主人拿全款 —— 这个溢价是设计好的代价（test/slice.test.js
// 「the premium is a real asset cost」钉着它），只该付给真卖家。
// 完整模式不变（那边没有溢价）。
const TAKEOVER_PREMIUM = 1.25;

export function acquisitionPrice(state, ref) {
  const cellId = plotIdOf(state, ref);
  const mark = buyPrice(state, cellId);
  return Math.round(mark * (state.config?.mode === 'slice' ? TAKEOVER_PREMIUM : 1));
}

// slice 的收购卡只对「别人已经开着的店」出手：空地上没有生意可收，
// 把空地放进可选目标就是拿溢价买一块走过去就能买的地。
export function takeoverEligible(state, ref) {
  const cellId = plotIdOf(state, ref);
  const pr = state.properties?.[cellId];
  const plot = state.map.plots.find(p => p.id === cellId);
  if (!pr || !plot) return false;
  if (plot.big) return false;              // 书屋只能到场买
  if (!pr.ownerId) return false;           // 空地不是「别人的店」
  if (!(pr.level > 0)) return false;       // 还没盖起来的空地同理
  if (state.config?.mode !== 'slice') return true;
  return true;
}
export function buildCost(level) {
  return Math.max(1, level) * 5_000;
}

// #807：rent 那句 Q3 要写「剩 N，够不够买一块最低价 M 的地」。
// M 必须是当场可买地块的真实最低价，不能写死。
// 只读：不写 state、不读随机数；没有可买地块时返回 null（调用方就不写这一段）。
//
// 为什么只算**无主**地：对手的地也能拿（收购），但要付 `buyPrice × 1.25`（game.js:454），
// 而这里返回的是 buyPrice。真浏览器日志里出现过：
//   「实付租金 0（晚风街小店），… 你剩 32,000，够买一块 晚风街小店（8,000）」
// 那块地是对手的，实际要 10,000。用 8,000 说“够买”会误导。
// 所以把对手地排除在外：无主地才是「走到就能买」的那种。
export function cheapestBuyable(state, viewer) {
  if (!state?.slice) return null;
  const viewerId = viewer?.id ?? null;
  let best = null;
  for (const plot of state.map.plots) {
    if (plot.big) continue;                                   // 大地产走另一套规则，不混进来
    if (state.day < (plot.availableFromDay ?? 1)) continue;    // 还没开售
    const pr = state.properties[plot.id];
    if (pr?.ownerId) continue;                                 // 有主（自己的或对手的）都不算「可买」
    const price = buyPrice(state, plot.id);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (best === null || price < best.price) best = { price, name: plot.name, id: plot.id };
  }
  return best;
}

// #845：收购是**卡牌动作**（game.js:454 的 buyland 分支），不是常驻能力。
// 所以「收购最便宜的一块要多少钱」这句话只有在玩家手里确实有 buyland 时才许出现。
// 这个函数只算价、不看手牌（谁说话由调用方判）——与 applyCard 同口径：
//   排除 big（含书屋，game.js:454 `if(state.slice&&plot.big)return false`）、排除己方、
//   价 = Math.round(buyPrice × 1.25)（不写死常数）。
// 只读：不写 state、不读随机数。
export function cheapestAcquirable(state, viewer) {
  if (!state?.slice || !viewer) return null;
  let best = null;
  for (const plot of state.map.plots) {
    if (plot.big) continue;                                    // 大店/书屋只能到场买
    if (state.day < (plot.availableFromDay ?? 1)) continue;     // 还没开售
    const pr = state.properties[plot.id];
    if (pr?.ownerId === viewer.id) continue;                    // 自己的店不用收
    const mark = buyPrice(state, plot.id);
    if (!Number.isFinite(mark) || mark <= 0) continue;
    // #3332：与引擎同价。这里是「收购 X 要多少钱」，必须真的是那张卡会扣的钱。
    const price = acquisitionPrice(state, plot.id);
    if (best === null || price < best.price) best = { price, mark, name: plot.name, id: plot.id };
  }
  return best;
}

// 领主收入/租金加成集中在这里，方便按档位测试。
export function incomeBonus(p, amount) {
  if (p?.isBoss && p.bossId === 'yuanyuan' && p.bossTier >= 2) return Math.round(amount * 1.5);
  return amount;
}

// 小熊 1 档起租金与爆炸伤害 +50%；2 档起每 10 天再 +10%，可累积。
export function bossRentMultiplier(state, owner) {
  if (!owner?.isBoss || owner.bossId !== 'bear' || owner.bossTier < 1) return 1;
  let mult = 1.5;
  if (owner.bossTier >= 2) mult += 0.1 * Math.floor((state.day ?? 0) / 10);
  return mult;
}

export function assetsOf(state, p) {
  let v = p.cash + p.deposit;
  for (const id of p.properties) {
    const pr = state.properties[id];
    if (!pr) continue;
    v += buyPrice(state, id) + (state.config.mode==='slice'?0:(pr.level > 0 ? (pr.big ? 30_000 : TUNING.buildCost[pr.level] ?? 0) : 0));
  }
  for (const [id, qty] of Object.entries(p.stocks ?? {})) {
    const stock = state.stocks.find(s => s.id === id);
    if (stock) v += stock.price * qty;
  }
  return Math.round(v);
}

export function pay(state, from, to, amount, reason) {
  amount = Math.max(0, Math.round(amount));
  if (amount === 0) return true;
  const freeIdx = from.cards ? from.cards.indexOf('free') : -1;
  if (freeIdx >= 0 && amount >= TUNING.freeThreshold) {
    const ask = typeof window !== 'undefined' && typeof window.confirm === 'function';
    const use = !ask || window.confirm(`${from.name}：要用免费卡抵消 ${amount}（${reason}）吗？`);
    if (use) {
      from.cards.splice(freeIdx, 1);
      if (from.talents?.includes('freecard_to_remotedice')) {
        from.cards.push('remotedice'); // 遥控骰子无合成配方，直接入手的语义与 addCard 相同
        log(state, `${from.name} 的机智：使用免费卡，获得 1 张遥控骰子卡`);
      }
      log(state, `${from.name} 的免费卡抵消了 ${amount}（${reason}）`);
      return true;
    }
  }

  const available = from.cash + from.deposit;
  if (available < amount) {
    if (from.isBoss && from.bossId === 'bear' && from.bossTier >= 3 && !from.revived) {
      from.revived = true;
      from.cash = amount * 2;
      log(state, `小熊过载：免疫破产，获得 ${amount * 2}`);
      return true;
    }
    const doctor = state.players.find(p => p.isBoss && p.bossId === 'doctor' && p.bossTier >= 3 && p.alive && p.id !== from.id);
    if (doctor) {
      for (const id of from.properties) {
        const pr = state.properties[id];
        if (!pr) continue;
        pr.ownerId = doctor.id;
        doctor.properties.push(id);
      }
      doctor.cards.push(...from.cards);
      log(state, `神秘博士据为己有：接收 ${from.name} 的 ${from.cards.length} 张卡与 ${from.properties.length} 块地`);
    }
    if (to) { if (reason === '租金' && !state.slice) to.deposit += incomeBonus(to, available); else to.cash += incomeBonus(to, available); }
    from.cash = 0; from.deposit = 0; from.alive = false;
    // A recipient may already have inherited a plot. Only release assets still
    // owned by the bankrupt player; never erase the transfer above.
    for (const id of from.properties) { const pr = state.properties[id]; if (pr?.ownerId === from.id) pr.ownerId = null; }
    from.properties = []; from.cards = [];
    log(state, `${from.name} 付不出 ${amount}（${reason}），破产`);
    return false;
  }

  const fromCash = Math.min(from.cash, amount);
  from.cash -= fromCash;
  const rest = amount - fromCash;
  if (rest > 0) from.deposit -= rest;
  if (to) { const gain = incomeBonus(to, amount); if (reason === '租金' && !state.slice) to.deposit += gain; else to.cash += gain; }
  if (!from.isBoss) {
    const yuan = state.players.find(p => p.isBoss && p.bossId === 'yuanyuan' && p.bossTier >= 3 && p.alive);
    if (yuan) { const siphon = Math.round(yuan.deposit * 0.01 * state.priceIndex); yuan.deposit += siphon; log(state, `圆圆流通手段：抽走 ${siphon}`); }
  }
  if (from.isBoss && from.bossId === 'doctor') {
    const ratio = from.bossTier === 3 ? 0.5 : from.bossTier === 2 ? 0.35 : from.bossTier === 1 ? 0.2 : 0;
    if (ratio) {
      const share = Math.round(amount * ratio);
      for (const q of state.players.filter(p => p.alive && !p.isBoss)) {
        const take = Math.min(q.cash + q.deposit, share);
        const c = Math.min(q.cash, take); q.cash -= c;
        const d = take - c; if (d > 0) q.deposit -= d;
        log(state, `反噬：${q.name} 承受 ${share}`);
      }
    }
  }
  return true;
}
export function log(state, text) {
  state.log.push({ day: state.day, text });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}
