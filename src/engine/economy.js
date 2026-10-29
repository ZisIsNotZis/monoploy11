import { TUNING } from '../data/tuning.js';

export const teamOf = (p) => p.team;

export function ownsStreet(state, ownerId, street) {
  return Object.entries(state.properties)
    .filter(([, pr]) => pr.ownerId === ownerId && pr.street === street)
    .length;
}

function propNode(state, key) { return state.map.nodes.find(n => n.id === key || n.propertyKey === key); }

export function rentFor(state, cellId) {
  const cell = propNode(state, cellId);
  const pr = state.properties[cellId] ?? state.properties[cell?.propertyKey];
  if (!pr || !cell) return 0;
  if (pr.closed > 0) return 0;
  if (pr.big && (!pr.bigType || pr.bigType === 'park')) return 0;
  const level = Math.max(1, pr.level);
  const base = TUNING.rentBase[level] ?? TUNING.rentBase[1];
  const chain = pr.big ? 1 : Math.pow(TUNING.streetMultiplier, Math.max(0, ownsStreet(state, pr.ownerId, pr.street) - 1));
  const big = pr.big ? TUNING.bigRentMultiplier : 1;
  const inflate = pr.inflate > 0 ? 2 : 1;
  return Math.round(base * chain * big * inflate * state.priceIndex);
}

export function buyPrice(state, cellId) {
  const cell = propNode(state, cellId);
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
  if (from.freeCard) {
    from.freeCard = false;
    log(state, `${from.name} 的免费卡抵消了 ${amount}（${reason}）`);
    return true;
  }

  if (from.cash < amount) {
    // 小熊困难档：免疫第一次破产，并获得致命伤害 2 倍现金
    if (from.isBoss && from.bossId === 'bear' && from.bossTier >= 3 && !from.revived) {
      from.revived = true;
      from.cash = amount * 2;
      log(state, `小熊过载：免疫破产，获得 ${amount * 2}`);
      return true;
    }
    // 神秘博士困难档：破产者的卡片与地产归博士
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
    from.cash = 0;
    from.alive = false;
    for (const id of from.properties) {
      const pr = state.properties[id];
      if (pr) pr.ownerId = null;
    }
    from.properties = [];
    from.cards = [];
    log(state, `${from.name} 付不出 ${amount}（${reason}），破产`);
    return false;
  }

  from.cash -= amount;
  if (to) {
    if (reason === '租金') to.deposit += amount;
    else to.cash += amount;
  }

  // 圆圆：对手损失时抽成（存款的 1% × 物价）
  if (!from.isBoss) {
    const yuan = state.players.find(p => p.isBoss && p.bossId === 'yuanyuan' && p.bossTier >= 3 && p.alive);
    if (yuan) {
      const siphon = Math.round(yuan.deposit * 0.01 * state.priceIndex);
      yuan.deposit += siphon;
      log(state, `圆圆流通手段：抽走 ${siphon}`);
    }
  }

  // 神秘博士反噬：自己受伤时，所有对手分摊
  if (from.isBoss && from.bossId === 'doctor') {
    const ratio = from.bossTier >= 3 ? 0.5 : from.bossTier === 2 ? 0.35 : 0.2;
    const share = Math.round(amount * ratio);
    for (const q of state.players.filter(p => p.alive && !p.isBoss)) {
      if (q.cash >= share) q.cash -= share;
      else q.cash = 0;
      log(state, `反噬：${q.name} 承受 ${share}`);
    }
  }
  return true;
}

export function log(state, text) {
  state.log.push({ day: state.day, text });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}
