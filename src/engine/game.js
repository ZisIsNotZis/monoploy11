import { makeRng } from './rng.js';
import { TUNING } from '../data/tuning.js';
import { CHARACTER_BY_ID, CHARACTERS } from '../data/characters.js';
import { TEST_MANOR } from '../data/maps/test-manor.js';
import { walk, validateMap, buildAdj, isPlatformActive, nearestStable } from './board.js';
import { rentFor, buyPrice, buildCost, assetsOf, pay, log, ownsStreet } from './economy.js';

const MAPS = { 'test-manor': TEST_MANOR };

export function createGame(config = {}) {
  const mapId = config.mapId ?? 'test-manor';
  const map = MAPS[mapId];
  const errors = validateMap(map);
  if (errors.length) throw new Error(`地图校验失败: ${errors.join('; ')}`);

  const seed = config.seed ?? 1;
  const rng = makeRng(seed);
  const participants = config.participants ?? defaultParticipants();
  const order = participants.map((p, i) => ({ ...p, id: `p${i + 1}` }));
  // 领主先手；否则 1..N
  const bossIdx = order.findIndex(p => p.isBoss);
  if (bossIdx > 0) order.unshift(...order.splice(bossIdx, 1));

  const players = order.map((p, i) => {
    const char = CHARACTER_BY_ID[p.charId] ?? CHARACTERS[0];
    return {
      id: p.id, name: p.name ?? char.name, charId: char.id, color: char.color,
      team: p.team ?? (p.isBoss ? 'boss' : `t${i + 1}`),
      controller: p.controller ?? 'human', isBoss: !!p.isBoss, bossTier: p.bossTier ?? 0,
      cash: config.startingCash ?? TUNING.startingCash,
      deposit: config.startingDeposit ?? TUNING.startingDeposit,
      cards: [], position: map.startId, facing: nextRing(map, map.startId),
      jail: 0, hospital: 0, god: null, godDays: 0, status: null, statusDays: 0,
      vehicle: null, alive: true, properties: [], handLimit: p.isBoss && p.bossTier === 3 ? 16 : TUNING.handLimit,
      talents: char.talents.map(t => t.id),
      freeCard: false, forcedDice: null, skipTurns: 0,
    };
  });

  const state = {
    seed, rng, mapId, map, config, players, order: players.map(p => p.id),
    day: 0, priceIndex: TUNING.priceIndexStart, turn: 0,
    phase: 'action', properties: {}, placements: {}, log: [], pending: null,
    winnerTeam: null, stocks: makeStocks(rng), lottery: { tickets: [], jackpot: TUNING.lotteryJackpotBase },
    stats: { rolls: 0, rents: 0, bankruptcies: 0 },
  };

  for (let i = 0; i < TUNING.startingCards; i++) {
    for (const p of players) p.cards.push(randomCard(rng));
  }
  log(state, `开局：${players.map(p => p.name).join('、')}，地图 ${map.name}，种子 ${seed}`);
  startTurn(state);
  return state;
}

function defaultParticipants() {
  return [
    { name: '孙小美', charId: 'sunxiaomei', team: 't1', controller: 'human' },
    { name: '阿土伯', charId: 'atubo', team: 't2', controller: 'human' },
    { name: '糖糖', charId: 'tangtang', team: 't3', controller: 'human' },
    { name: '乌咪', charId: 'wumi', team: 't4', controller: 'human' },
  ];
}

function nextRing(map, id) {
  const n = map.nodes.find(x => x.id === id);
  if (!n?.ring && n?.ring !== 0) return null;
  return `r${(n.ring + 1) % map.ringSize}`;
}

function makeStocks(rng) {
  const names = ['橙天', '蓝海', '绿野'];
  return names.map((name, i) => ({
    id: `s${i}`, name, price: 50 + Math.round(rng.float() * 50),
    drift: TUNING.stockDrift, vol: TUNING.stockVolatility,
  }));
}

const CARD_POOL = [
  { id: 'buyland', name: '购地卡' },
  { id: 'remotedice', name: '遥控骰子卡' },
  { id: 'roadblock', name: '路障卡' },
  { id: 'mine', name: '地雷卡' },
  { id: 'free', name: '免费卡' },
  { id: 'equalrich', name: '均富卡' },
  { id: 'equalpoor', name: '均贫卡' },
  { id: 'teleport', name: '传送卡' },
  { id: 'stay', name: '停留卡' },
  { id: 'turtle', name: '乌龟卡' },
];
export const CARDS = CARD_POOL;
export function randomCard(rng) { return rng.pick(CARD_POOL).id; }

export function current(state) {
  return state.players.find(p => p.id === state.order[state.turn % state.order.length]);
}

export function startTurn(state) {
  if (state.phase === 'over') return state;
  const p = current(state);
  if (!p || !p.alive) return endTurn(state);

  state.day += 1;
  if ((state.day - 1) % TUNING.priceIndexEveryDays === 0) {
    state.priceIndex = +(state.priceIndex + TUNING.priceIndexStep).toFixed(2);
    log(state, `物价指数上涨到 ${state.priceIndex.toFixed(2)}`);
  }
  applyMonthly(state, p);
  tickStocks(state);
  tickGod(state, p);

  if (state.map.platform) {
    const active = isPlatformActive(state.map, state.day);
    for (const q of state.players.filter(q => q.alive && q.position === state.map.platform.nodeId)) {
      if (!active) {
        q.position = nearestStable(state.map, q.position);
        log(state, `机关板消失，${q.name} 被移到 ${state.map.nodes.find(n => n.id === q.position).label}`);
      }
    }
  }

  if (p.skipTurns > 0) {
    p.skipTurns -= 1;
    log(state, `${p.name} 跳过本回合（剩余 ${p.skipTurns}）`);
    return endTurn(state);
  }
  if (p.jail > 0) {
    p.jail -= 1;
    if (p.jail === 0) releaseFrom(state, p, 'jail');
    return endTurn(state);
  }
  if (p.hospital > 0) {
    p.hospital -= 1;
    if (p.hospital === 0) releaseFrom(state, p, 'hospital');
    return endTurn(state);
  }

  // 回合开始弃到上限
  while (p.cards.length > p.handLimit) {
    const removed = p.cards.pop();
    log(state, `${p.name} 回合开始弃掉 ${cardName(removed)}`);
  }
  state.phase = 'action';
  state.pending = null;
  log(state, `—— 第 ${state.day} 天 · ${p.name} 的回合 ——`);
  return state;
}

function applyMonthly(state, p) {
  if (state.day % 30 !== 0) return;
  const rate = TUNING.monthlyInterest * (p.isBoss && p.bossTier >= 3 ? 1.5 : 1);
  const interest = Math.round(p.deposit * rate);
  p.deposit += interest;
  log(state, `${p.name} 存款利息 +${interest}`);
}

function tickGod(state, p) {
  if (!p.god) return;
  p.godDays -= 1;
  if (p.godDays <= 0) {
    log(state, `${p.name} 身上的 ${p.god} 离开了`);
    p.god = null;
  }
}

function releaseFrom(state, p, kind) {
  const gate = kind === 'jail' ? state.map.facility?.jail : state.map.facility?.hospital;
  p.position = gate ?? state.map.startId;
  log(state, `${p.name} 从${kind === 'jail' ? '监狱' : '医院'}出来了`);
  if (kind === 'jail' && p.talents.includes('jail_teleport_card')) {
    p.cards.push('teleport');
    log(state, `${p.name} 的森林守护者：获得 1 张传送卡`);
  }
}

export function endTurn(state) {
  if (state.phase === 'over') return state;
  if (state.day >= state.config.dayLimit) {
    return finishByAssets(state);
  }
  const aliveTeams = new Set(state.players.filter(p => p.alive).map(p => p.team));
  if (aliveTeams.size <= 1) return finish(state, [...aliveTeams][0] ?? null);

  state.turn = (state.turn + 1) % state.order.length;
  state.pending = null;
  state.phase = 'action';
  return startTurn(state);
}

function finishByAssets(state) {
  const teams = new Map();
  for (const p of state.players.filter(p => p.alive)) {
    teams.set(p.team, (teams.get(p.team) ?? 0) + assetsOf(state, p));
  }
  const top = [...teams.entries()].sort((a, b) => b[1] - a[1])[0];
  return finish(state, top?.[0] ?? null);
}

function finish(state, team) {
  state.phase = 'over';
  state.winnerTeam = team;
  log(state, team ? `比赛结束：队伍 ${team} 获胜` : '比赛结束：无人生还');
  return state;
}

export function roll(state, diceCount = 1) {
  if (state.phase !== 'action') return state;
  const p = current(state);
  const dice = Math.min(TUNING.maxDice, Math.max(1, diceCount));
  const n = p.forcedDice ?? Array.from({ length: dice }, () => 1 + state.rng.int(6)).reduce((a, b) => a + b, 0);
  p.forcedDice = null;
  state.stats.rolls += 1;
  log(state, `${p.name} 掷出 ${n} 点`);

  const res = walk(state.map, state.day, p.position, p.facing, n, state.rng, { cameFrom: p.lastNode });
  for (const id of res.path) {
    if (id === state.map.startId) p.cash += TUNING.salary;
    const node = state.map.nodes.find(x => x.id === id);
    if (node?.kind === 'start') log(state, `${p.name} 经过起点 +${TUNING.salary}`);
  }
  p.lastNode = res.path.length >= 2 ? res.path[res.path.length - 2] : p.position;
  p.position = res.landed;
  p.facing = null;
  state.phase = 'resolve';
  if (res.pendingDirection) {
    state.pending = { type: 'direction', options: exitsOf(state, p.position) };
    log(state, `${p.name} 正好停在交叉点，请选择方向`);
    return state;
  }
  return resolveLanding(state, p);
}

function exitsOf(state, id) {
  const adj = buildAdj(state.map);
  return adj[id].map(e => e.to).filter(to => {
    const n = state.map.nodes.find(x => x.id === to);
    return n.kind !== 'teleport';
  });
}

export function chooseDirection(state, toId) {
  if (state.pending?.type !== 'direction') return state;
  const p = current(state);
  p.facing = toId;
  state.pending = null;
  log(state, `${p.name} 选择朝 ${label(state, toId)} 方向`);
  return resolveLanding(state, p);
}

function label(state, id) {
  return state.map.nodes.find(n => n.id === id)?.label ?? id;
}

function resolveLanding(state, p) {
  const cell = state.map.nodes.find(n => n.id === p.position);
  if (!cell) return endTurn(state);
  log(state, `${p.name} 停在 ${cell.label}`);

  switch (cell.kind) {
    case 'property':
    case 'big': {
      const pr = state.properties[cell.id];
      if (!pr || !pr.ownerId) {
        const price = buyPrice(state, cell.id);
        state.pending = { type: 'buy', cellId: cell.id, price };
        log(state, `${cell.label} 无主，售价 ${price}，是否购买？`);
        return state;
      }
      if (pr.ownerId === p.id) {
        if (pr.level < TUNING.maxLevel) {
          state.pending = { type: 'build', cellId: cell.id, cost: buildCost(pr.level) };
          log(state, `${cell.label} 是己方地产（Lv.${pr.level}），可加盖`);
          return state;
        }
        return endTurn(state);
      }
      const owner = state.players.find(q => q.id === pr.ownerId);
      if (owner?.team === p.team) {
        log(state, `${cell.label} 是队友 ${owner.name} 的地产，免租`);
        return endTurn(state);
      }
      let rent = rentFor(state, cell.id);
      if (p.talents.includes('rent_taken_down')) rent = Math.round(rent * 0.8);
      if (owner?.talents.includes('rent_dealt_up')) rent = Math.round(rent * 1.2);
      if (p.god === '财神') { log(state, '财神附身，免租'); return endTurn(state); }
      log(state, `${p.name} 向 ${owner.name} 支付租金 ${rent}`);
      state.stats.rents += rent;
      if (!pay(state, p, owner, rent, '租金')) state.stats.bankruptcies += 1;
      return endTurn(state);
    }
    case 'tax': {
      const amount = Math.round(p.cash * TUNING.taxRate);
      log(state, `${p.name} 纳税 ${amount}`);
      pay(state, p, null, amount, '纳税');
      return endTurn(state);
    }
    case 'card':
      p.cards.push(randomCard(state.rng));
      log(state, `${p.name} 获得 1 张卡片`);
      return endTurn(state);
    case 'god': {
      const gods = ['财神', '福神', '土地公', '武神', '天使'];
      p.god = state.rng.pick(gods);
      p.godDays = TUNING.godBaseDays;
      log(state, `${p.name} 被 ${p.god} 附身`);
      return endTurn(state);
    }
    case 'dog':
      if (p.vehicle || p.talents.includes('immune_beggar_dog')) {
        log(state, `${p.name} 躲过了野狗`);
      } else {
        log(state, `${p.name} 被野狗咬，损失 ${TUNING.dogFine}`);
        pay(state, p, null, TUNING.dogFine, '野狗');
      }
      return endTurn(state);
    case 'beggar':
      if (p.talents.includes('immune_beggar_dog')) {
        log(state, `${p.name} 免疫乞丐`);
      } else {
        log(state, `${p.name} 给乞丐 ${TUNING.beggarAsk}`);
        pay(state, p, null, TUNING.beggarAsk, '乞丐');
      }
      return endTurn(state);
    case 'hospitalGate':
    case 'hospital':
      p.hospital = TUNING.hospitalTurns;
      p.position = state.map.facility?.hospital ?? p.position;
      log(state, `${p.name} 住院 ${p.hospital} 回合`);
      return endTurn(state);
    case 'jailGate':
    case 'jail':
      p.jail = TUNING.jailTurns;
      p.position = state.map.facility?.jail ?? p.position;
      log(state, `${p.name} 入狱 ${p.jail} 回合`);
      return endTurn(state);
    case 'event': {
      const delta = state.rng.pick([-10_000, -5_000, 5_000, 10_000, 20_000]);
      p.cash = Math.max(0, p.cash + delta);
      log(state, `${p.name} 遇到事件，现金 ${delta >= 0 ? '+' : ''}${delta}`);
      return endTurn(state);
    }
    case 'teleport': {
      const walkable = state.map.nodes.filter(n => n.kind !== 'teleport' && n.kind !== 'platform');
      p.position = state.rng.pick(walkable).id;
      log(state, `${p.name} 被随机传送到 ${label(state, p.position)}`);
      return endTurn(state);
    }
    case 'bank':
    case 'stock':
    case 'lottery':
    case 'shop':
      state.shopOffer = Array.from({ length: 3 }, () => randomCard(state.rng));
      state.pending = { type: 'shop', cellId: cell.id };
      log(state, `${p.name} 进入 ${cell.label}`);
      return state;
    case 'merchant':
      state.shopOffer = Array.from({ length: 3 }, () => randomCard(state.rng));
      state.pending = { type: 'merchant', cellId: cell.id };
      log(state, `${p.name} 遇到神秘人`);
      return state;
    case 'magic':
    case 'news':
    default:
      return endTurn(state);
  }
}

export function buyProperty(state) {
  if (state.pending?.type !== 'buy') return state;
  const p = current(state);
  const { cellId, price } = state.pending;
  if (p.cash < price) return state;
  const cell = state.map.nodes.find(n => n.id === cellId);
  p.cash -= price;
  p.properties.push(cellId);
  state.properties[cellId] = {
    ownerId: p.id, level: 1, street: cell.street ?? null, big: cell.kind === 'big',
  };
  log(state, `${p.name} 以 ${price} 买下 ${cell.label}`);
  state.pending = null;
  return endTurn(state);
}

export function buildProperty(state) {
  if (state.pending?.type !== 'build') return state;
  const p = current(state);
  const { cellId, cost } = state.pending;
  const pr = state.properties[cellId];
  if (!pr || p.cash < cost || pr.level >= TUNING.maxLevel) return endTurn(state);
  p.cash -= cost;
  pr.level += 1;
  log(state, `${p.name} 将 ${label(state, cellId)} 升到 Lv.${pr.level}（花费 ${cost}）`);
  state.pending = null;
  return endTurn(state);
}

export function skipPending(state) {
  if (!state.pending) return state;
  const p = current(state);
  log(state, `${p.name} 放弃 ${state.pending.type}`);
  state.pending = null;
  return endTurn(state);
}

export function setDirection(state, toId) { return chooseDirection(state, toId); }

export function useCard(state, index, target) {
  if (state.phase !== 'action') return state;
  const p = current(state);
  const id = p.cards[index];
  if (!id) return state;
  const card = CARD_DEFS[id];
  if (!card) return state;
  const ok = card.use(state, p, target);
  if (!ok) return state;
  p.cards.splice(index, 1);
  log(state, `${p.name} 使用 ${card.name}${target ? ` → ${target}` : ''}`);
  return state;
}

export const CARD_DEFS = {
  buyland: { name: '购地卡', use(state, p) {
    const cell = state.map.nodes.find(n => n.id === p.position);
    if (!['property', 'big'].includes(cell.kind)) return false;
    const pr = state.properties[cell.id];
    if (pr?.ownerId === p.id) return false;
    const price = buyPrice(state, cell.id);
    if (p.cash < price) return false;
    p.cash -= price;
    if (pr) { const old = state.players.find(q => q.id === pr.ownerId); if (old) old.properties = old.properties.filter(x => x !== cell.id); }
    p.properties.push(cell.id);
    state.properties[cell.id] = { ownerId: p.id, level: pr?.level ?? 1, street: cell.street ?? null, big: cell.kind === 'big' };
    log(state, `强制买下 ${cell.label}`);
    return true;
  }},
  remotedice: { name: '遥控骰子卡', use(state, p) { p.forcedDice = 7; log(state, '下次骰子固定为 7'); return true; }},
  roadblock: { name: '路障卡', use(state, p) {
    const adj = buildAdj(state.map);
    const to = adj[p.position].find(e => e.to !== p.facing)?.to;
    if (!to) return false;
    place(state, to, { kind: 'roadblock', ownerId: p.id });
    return true;
  }},
  mine: { name: '地雷卡', use(state, p) {
    if (state.placements[p.position]) return false;
    place(state, p.position, { kind: 'mine', ownerId: p.id });
    return true;
  }},
  free: { name: '免费卡', use(state, p) { p.freeCard = true; log(state, '下次付款免除'); return true; }},
  equalrich: { name: '均富卡', use(state) {
    const alive = state.players.filter(q => q.alive);
    const total = alive.reduce((s, q) => s + q.cash, 0);
    const each = Math.floor(total / alive.length);
    for (const q of alive) q.cash = each;
    log(state, `所有人现金平均为 ${each}`);
    return true;
  }},
  equalpoor: { name: '均贫卡', use(state, p, targetId) {
    const q = state.players.find(x => x.id === targetId);
    if (!q || !q.alive || q.id === p.id) return false;
    const avg = Math.floor((p.cash + q.cash) / 2);
    p.cash = avg; q.cash = avg;
    log(state, `${p.name} 与 ${q.name} 现金平分`);
    return true;
  }},
  teleport: { name: '传送卡', use(state, p, targetId) {
    const n = state.map.nodes.find(x => x.id === targetId);
    if (!n || n.kind === 'teleport') return false;
    p.position = n.id;
    return true;
  }},
  stay: { name: '停留卡', use(state, p, targetId) {
    const q = state.players.find(x => x.id === targetId);
    if (!q) return false;
    q.skipTurns += 1;
    return true;
  }},
  turtle: { name: '乌龟卡', use(state, p, targetId) {
    const q = state.players.find(x => x.id === targetId);
    if (!q) return false;
    q.forcedDice = 1;
    return true;
  }},
};

export function place(state, cellId, obj) {
  if (state.placements[cellId]) return false;
  state.placements[cellId] = obj;
  return true;
}

export function cardName(id) { return CARD_DEFS[id]?.name ?? CARD_POOL.find(c => c.id === id)?.name ?? id; }

export function doBank(state, action, amount) {
  if (state.pending?.type !== 'bank') return state;
  const p = current(state);
  amount = Math.max(0, Math.round(amount));
  if (action === 'deposit' && p.cash >= amount) { p.cash -= amount; p.deposit += amount; }
  if (action === 'withdraw' && p.deposit >= amount) { p.deposit -= amount; p.cash += amount; }
  log(state, `${p.name} ${action === 'deposit' ? '存入' : '取出'} ${amount}`);
  state.pending = null;
  return endTurn(state);
}

export function doStock(state, stockId, qty, side) {
  if (state.pending?.type !== 'stock') return state;
  const p = current(state);
  const s = state.stocks.find(x => x.id === stockId);
  qty = Math.max(1, Math.floor(qty));
  if (side === 'buy') {
    const cost = Math.round(s.price * qty);
    if (p.cash < cost) return state;
    p.cash -= cost; p.stocks = p.stocks ?? {}; p.stocks[stockId] = (p.stocks[stockId] ?? 0) + qty;
  } else {
    const held = p.stocks?.[stockId] ?? 0;
    qty = Math.min(qty, held);
    if (qty <= 0) return state;
    p.cash += Math.round(s.price * qty); p.stocks[stockId] -= qty;
  }
  log(state, `${p.name} ${side === 'buy' ? '买入' : '卖出'} ${s.name} ${qty} 股`);
  return state;
}

export function leaveStock(state) {
  if (state.pending?.type !== 'stock') return state;
  state.pending = null;
  return endTurn(state);
}

export function doLottery(state) {
  if (state.pending?.type !== 'lottery') return state;
  const p = current(state);
  if (p.cash >= TUNING.lotteryTicket) {
    p.cash -= TUNING.lotteryTicket;
    state.lottery.tickets.push(p.id);
    log(state, `${p.name} 买了一张乐透`);
  }
  state.pending = null;
  return endTurn(state);
}

export function doMagic(state, effect) {
  if (state.pending?.type !== 'magic') return state;
  const p = current(state);
  const others = state.players.filter(q => q.alive && q.id !== p.id);
  switch (effect) {
    case 'money': p.cash += 10_000; log(state, `${p.name} 从魔法屋获得 10000`); break;
    case 'lose': if (others.length) { const q = state.rng.pick(others); pay(state, q, null, 10_000, '魔法屋'); log(state, `${q.name} 被魔法屋罚 10000`); } break;
    case 'card': p.cards.push(randomCard(state.rng)); log(state, `${p.name} 从魔法屋获得 1 张卡`); break;
    case 'jail': if (others.length) { const q = state.rng.pick(others); q.jail = TUNING.jailTurns; q.position = state.map.facility?.jail ?? q.position; log(state, `${q.name} 被送进监狱`); } break;
    default: break;
  }
  state.pending = null;
  return endTurn(state);
}

export function doNews(state) {
  if (state.pending?.type !== 'news') return state;
  const p = current(state);
  const kind = state.rng.pick(['boom', 'bust', 'grant', 'storm']);
  if (kind === 'boom') { state.priceIndex = +(state.priceIndex + 0.1).toFixed(2); log(state, '新闻：物价上涨 0.1'); }
  if (kind === 'bust') { state.priceIndex = Math.max(1, +(state.priceIndex - 0.1).toFixed(2)); log(state, '新闻：物价下跌 0.1'); }
  if (kind === 'grant') { p.cash += 15_000; log(state, `新闻：${p.name} 获得补助 15000`); }
  if (kind === 'storm') { for (const q of state.players.filter(q => q.alive)) q.cash = Math.max(0, q.cash - 3_000); log(state, '新闻：风暴，所有人 -3000'); }
  state.pending = null;
  return endTurn(state);
}

export function doMerchant(state, cardId) {
  if (state.pending?.type !== 'merchant') return state;
  const p = current(state);
  const card = CARD_DEFS[cardId];
  if (!card) return state;
  const price = 1_000;
  if (p.cash < price) return state;
  p.cash -= price;
  p.cards.push(cardId);
  log(state, `${p.name} 从神秘人处花 ${price} 买到 ${card.name}`);
  state.pending = null;
  return endTurn(state);
}

export function doShop(state, cardId) {
  if (state.pending?.type !== 'shop') return state;
  const p = current(state);
  const card = CARD_DEFS[cardId];
  if (!card) return state;
  const price = Math.round(2_000 * (p.talents.includes('shop_discount') ? 0.5 : 1));
  if (p.cash < price) return state;
  p.cash -= price;
  p.cards.push(cardId);
  if (p.talents.includes('shop_extra_card')) p.cards.push(randomCard(state.rng));
  log(state, `${p.name} 花 ${price} 买到 ${card.name}`);
  state.pending = null;
  return endTurn(state);
}

export function skipShop(state) {
  if (state.pending?.type !== 'shop') return state;
  state.pending = null;
  return endTurn(state);
}

export function tickStocks(state) {
  for (const s of state.stocks) {
    const shock = (state.rng.float() - 0.5) * 2 * s.vol;
    s.price = Math.max(1, +(s.price * (1 + s.drift + shock)).toFixed(2));
  }
}

export function finishByLimit(state) { return finishByAssets(state); }

export function leavePending(state) {
  if (!state.pending) return state;
  state.pending = null;
  return endTurn(state);
}
