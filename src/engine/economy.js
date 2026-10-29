import { TUNING } from '../data/tuning.js';

export const teamOf = (p) => p.team;

export function ownsStreet(state, ownerId, street) {
  return Object.entries(state.properties)
    .filter(([, pr]) => pr.ownerId === ownerId && pr.street === street)
    .length;
}

export function rentFor(state, cellId) {
  const cell = state.map.nodes.find(n => n.id === cellId);
  const pr = state.properties[cellId];
  if (!pr || !cell) return 0;
  const level = Math.max(1, pr.level);
  const base = TUNING.rentBase[level] ?? TUNING.rentBase[1];
  const chain = pr.big ? 1 : Math.pow(TUNING.streetMultiplier, Math.max(0, ownsStreet(state, pr.ownerId, pr.street) - 1));
  const big = pr.big ? TUNING.bigRentMultiplier : 1;
  return Math.round(base * chain * big * state.priceIndex);
}

export function buyPrice(state, cellId) {
  const cell = state.map.nodes.find(n => n.id === cellId);
  if (cell.kind === 'big') return 20_000;
  return 8_000;
}

export function buildCost(level) {
  return TUNING.buildCost[level] ?? 0;
}

export function assetsOf(state, p) {
  let v = p.cash + p.deposit;
  for (const id of p.properties) {
    const pr = state.properties[id];
    if (!pr) continue;
    v += buyPrice(state, id) + TUNING.buildCost[pr.level] * 0.6;
  }
  return Math.round(v);
}

export function pay(state, from, to, amount, reason) {
  amount = Math.max(0, Math.round(amount));
  if (amount === 0) return true;
  if (from.cash < amount) {
    from.cash = 0;
    from.alive = false;
    for (const id of from.properties) {
      const pr = state.properties[id];
      if (pr) pr.ownerId = null;
    }
    from.properties = [];
    log(state, `${from.name} 付不出 ${amount}（${reason}），破产`);
    return false;
  }
  from.cash -= amount;
  if (to) to.cash += amount;
  return true;
}

export function log(state, text) {
  state.log.push({ day: state.day, text });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}
