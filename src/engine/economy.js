import { TUNING } from '../data/tuning.js';

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
  if (pr.closed > 0) return 0;
  if (pr.big && (!pr.bigType || pr.bigType === 'park')) return 0;
  if (!pr.big && !(pr.level > 0)) return 0;
  const level = Math.max(1, pr.level);
  const base = pr.big ? (TUNING.rentBase[level] ?? TUNING.rentBase[1]) : 2_000 * Math.pow(2, level - 1);
  const owner = state.players.find(p => p.id === pr.ownerId);
  const chain = pr.big ? 1 : 1 + TUNING.streetMultiplier * Math.max(0, ownsStreet(state, owner?.team, pr.street) - 1);
  const big = pr.big ? TUNING.bigRentMultiplier : 1;
  const inflate = pr.inflate > 0 ? 2 : 1;
  return Math.round(base * chain * big * inflate * state.priceIndex);
}

export function buyPrice(state, ref) {
  const cellId = plotIdOf(state, ref);
  const plot = state.map.plots.find(p => p.id === cellId);
  const base = plot?.big ? (state.config?.bigPlotPrice ?? 20_000) : (state.config?.smallPlotPrice ?? 8_000);
  return Math.round(base * state.priceIndex);
}

export function buildCost(level) {
  return Math.max(1, level) * 5_000;
}

export function assetsOf(state, p) {
  let v = p.cash + p.deposit;
  for (const id of p.properties) {
    const pr = state.properties[id];
    if (!pr) continue;
    v += buyPrice(state, id) + (pr.level > 0 ? (pr.big ? 30_000 : TUNING.buildCost[pr.level] ?? 0) : 0);
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
    if (to) { if (reason === '租金') to.deposit += available; else to.cash += available; }
    from.cash = 0; from.deposit = 0; from.alive = false;
    for (const id of from.properties) { const pr = state.properties[id]; if (pr) pr.ownerId = null; }
    from.properties = []; from.cards = [];
    log(state, `${from.name} 付不出 ${amount}（${reason}），破产`);
    return false;
  }

  const fromCash = Math.min(from.cash, amount);
  from.cash -= fromCash;
  const rest = amount - fromCash;
  if (rest > 0) from.deposit -= rest;
  if (to) { if (reason === '租金') to.deposit += amount; else to.cash += amount; }
  if (!from.isBoss) {
    const yuan = state.players.find(p => p.isBoss && p.bossId === 'yuanyuan' && p.bossTier >= 3 && p.alive);
    if (yuan) { const siphon = Math.round(yuan.deposit * 0.01 * state.priceIndex); yuan.deposit += siphon; log(state, `圆圆流通手段：抽走 ${siphon}`); }
  }
  if (from.isBoss && from.bossId === 'doctor') {
    const ratio = from.bossTier >= 3 ? 0.5 : from.bossTier === 2 ? 0.35 : 0.2;
    const share = Math.round(amount * ratio);
    for (const q of state.players.filter(p => p.alive && !p.isBoss)) {
      const take = Math.min(q.cash + q.deposit, share);
      const c = Math.min(q.cash, take); q.cash -= c;
      const d = take - c; if (d > 0) q.deposit -= d;
      log(state, `反噬：${q.name} 承受 ${share}`);
    }
  }
  return true;
}
export function log(state, text) {
  state.log.push({ day: state.day, text });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}
