import { makeRng } from './rng.js';
import { TUNING } from '../data/tuning.js';
import { CHARACTER_BY_ID, CHARACTERS } from '../data/characters.js';
import { BOSS_BY_ID } from '../data/bosses.js';
import { TEST_MANOR } from '../data/maps/test-manor.js';
import { GRID_MANOR } from '../data/maps/grid-manor.js';
import { walk, validateMap, buildAdj, isPlatformActive, nearestStable, pathWithin, reachableWithin } from './board-v2.js';
import { rentFor, buyPrice, buildCost, assetsOf, pay, log, ownsStreet } from './economy.js';

const MAPS = { 'grid-manor': GRID_MANOR, 'test-manor': TEST_MANOR };

function teamColor(teamIndex, memberIndex, memberCount) {
  const hue = Math.round((teamIndex * 137.508 + 12) % 360);
  const sat = 58 + (memberIndex % 3) * 7;
  const light = 44 + (memberIndex % 4) * 6 + (memberCount === 1 ? 4 : 0);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export function createGame(config = {}) {
  const mapId = config.mapId ?? 'grid-manor';
  const map = MAPS[mapId];
  const errors = validateMap(map);
  if (errors.length) throw new Error(`地图校验失败: ${errors.join('; ')}`);

  const seed = config.seed ?? 1;
  const rng = makeRng(seed);
  const participants = config.participants ?? defaultParticipants();
  const order = participants.map((p, i) => ({ ...p, id: `p${i + 1}` }));
  const players = order.map((p, i) => {
    const char = CHARACTER_BY_ID[p.charId] ?? CHARACTERS[0];
    return {
      id: p.id, name: p.name ?? char.name, charId: char.id, color: char.color,
      team: p.team ?? (p.isBoss ? 'boss' : `t${i + 1}`),
      controller: p.controller ?? 'human', isBoss: !!p.isBoss, bossId: p.bossId ?? null, bossTier: p.bossTier ?? 0, revived: false,
      cash: config.startingCash ?? TUNING.startingCash,
      deposit: config.startingDeposit ?? TUNING.startingDeposit,
      cards: [], position: map.startId, facing: null,
      jail: 0, hospital: 0, god: null, godDays: 0, status: null, statusDays: 0,
      vehicle: null, alive: true, properties: [], handLimit: p.isBoss && p.bossId === 'doctor' && p.bossTier === 3 ? 16 : TUNING.handLimit,
      talents: char.talents.map(t => t.id),
      freeCard: false, forcedDice: null, skipTurns: 0,
    };
  });

  const teams = [...new Set(players.map(p => p.team))];
  for (const p of players) {
    const mates = players.filter(q => q.team === p.team);
    p.color = teamColor(teams.indexOf(p.team), mates.indexOf(p), mates.length);
  }

  const state = {
    seed, rng, mapId, map, config: { dayLimit: TUNING.dayLimit, ...config }, players, order: players.map(p => p.id),
    day: 0, priceIndex: TUNING.priceIndexStart, turn: 0,
    phase: 'action', properties: {}, placements: {}, log: [], pending: null,
    winnerTeam: null, stocks: makeStocks(rng), lottery: { tickets: [], sold: [], jackpot: TUNING.lotteryJackpotBase, lastDrawDay: 0 },
    stats: { rolls: 0, rents: 0, bankruptcies: 0 },
  };

  const roadPool = rng.shuffle(map.nodes.filter(n => n.kind !== 'teleport' && n.kind !== 'platform').map(n => n.id));
  const adjMap = buildAdj(map);
  players.forEach((p, i) => {
    p.position = roadPool[i % roadPool.length];
    const exits = adjMap[p.position] ?? [];
    p.facing = exits.length ? rng.pick(exits).to : null;
    p.lastNode = null;
  });

  const fixedHand = Array.isArray(config.startingHand) ? config.startingHand : null;
  for (let i = 0; i < (fixedHand ? fixedHand.length : TUNING.startingCards); i++) {
    for (const p of players) p.cards.push(fixedHand ? fixedHand[i] : randomCard(rng));
  }
  log(state, `开局：${players.map(p => p.name).join('、')}，地图 ${map.name}`);
  state.phase = 'action';
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

function makeStocks(rng) {
  const names = ['银行股', '地产股', '科技股', '能源股', '媒体股', '医药股', '消费股', '交通股'];
  return names.map((name, i) => ({
    id: `s${i}`, name, price: 50,
    drift: TUNING.stockDrift, vol: TUNING.stockVolatility,
  }));
}

const CARD_LIST = [
  ['buyland', '购地卡', 'cell'], ['exchange', '换屋卡', 'cell'], ['rebuild', '改建卡', 'cell'],
  ['close', '停业卡', 'street'], ['truck', '工程车卡', 'cell'], ['monster', '怪兽卡', 'cell'],
  ['worker', '机器工人卡', 'cell'], ['inflate', '涨价卡', 'street'], ['remotedice', '遥控骰子卡', 'cell'],
  ['turtle', '乌龟卡', 'player'], ['turn', '转向卡', 'player'], ['stay', '停留卡', 'player'],
  ['sleep', '梦游卡', 'player'], ['hibernate', '冬眠卡', 'player'], ['roadblock', '路障卡', 'cell'],
  ['superdice', '超级骰子卡', 'self'], ['jelly', '果冻墙卡', 'cell'], ['randomdoor', '随意门卡', 'self'],
  ['portal', '传送门卡', 'player'], ['motorcycle', '机车卡', 'self'], ['car', '汽车卡', 'self'],
  ['robotdoll', '机器娃娃卡', 'cell'], ['start', '启动卡', 'player'], ['mine', '地雷卡', 'cell'],
  ['timebomb', '定时炸弹卡', 'cell'], ['missile', '飞弹卡', 'player'], ['quantum', '量子飞弹卡', 'all'],
  ['dynamite', '炸药卡', 'cell'], ['banana', '香蕉皮卡', 'cell'], ['trap', '陷阱卡', 'cell'],
  ['free', '免费卡', 'self'], ['audit', '查账卡', 'player'], ['equalpoor', '均贫卡', 'player'],
  ['equalrich', '均富卡', 'all'], ['pick', '拾取卡', 'player'], ['scheme', '谋划卡', 'player'],
  ['magic', '魔术卡', 'player'], ['invitegod', '请神卡', 'self'], ['sendgod', '送神卡', 'player'],
  ['samefate', '同命卡', 'player'], ['transfer', '转移卡', 'self'], ['wuxie', '无懈卡', 'self'],
  ['rushmissile', '急速弹卡', 'all'], ['glory', '辉煌卡', 'all'], ['predicament', '窘困卡', 'all'],
  ['green', '绿化卡', 'all'], ['disaster', '灾祸卡', 'all'], ['godfavor', '神眷卡', 'self'],
];
const ADVANCED = new Set(['rushmissile', 'glory', 'predicament', 'green', 'disaster', 'godfavor']);
export const CARD_PRICES = {
  buyland: 3000, exchange: 2500, rebuild: 3000, close: 4000, truck: 3500, monster: 5000,
  worker: 3000, inflate: 4000, remotedice: 2500, turtle: 2000, turn: 2000, stay: 2500,
  sleep: 3000, hibernate: 3500, roadblock: 1500, superdice: 3000, jelly: 2000, randomdoor: 3000,
  portal: 3000, motorcycle: 4000, car: 6000, robotdoll: 4000, start: 2500, mine: 3000,
  timebomb: 4000, missile: 5000, quantum: 8000, dynamite: 3000, banana: 1500, trap: 2000,
  free: 2500, audit: 2000, equalpoor: 3000, equalrich: 5000, pick: 3000, scheme: 4000,
  magic: 3000, invitegod: 2500, sendgod: 2000, samefate: 2000, transfer: 3000, wuxie: 3000,
  rushmissile: 10000, glory: 10000, predicament: 10000, green: 10000, disaster: 10000, godfavor: 10000,
};

const RECIPES = {
  missile: 'rushmissile', inflate: 'glory', close: 'predicament',
  sendgod: 'green', monster: 'disaster', invitegod: 'godfavor',
};
export const CARDS = CARD_LIST.map(([id, name, target]) => ({ id, name, target }));
export const CARD_DEFS = Object.fromEntries(CARD_LIST.map(([id, name, target]) => [id, { id, name, target }]));
export function randomCard(rng) { return rng.pick(CARD_LIST.filter(([id]) => !ADVANCED.has(id)))[0]; }

export function addCard(state, p, id) {
  p.cards.push(id);
  const adv = RECIPES[id];
  if (!adv) return;
  const n = p.cards.filter(x => x === id).length;
  if (n >= 5) {
    for (let i = 0; i < 5; i++) p.cards.splice(p.cards.indexOf(id), 1);
    p.cards.push(adv);
    log(state, `${p.name} 的 5 张 ${CARD_DEFS[id].name} 合成了 ${CARD_DEFS[adv].name}`);
  }
}

export function current(state) {
  return state.players.find(p => p.id === state.order[state.turn % state.order.length]);
}

export function applyMonthly(state, p) {
  if (state.day % 30 !== 0) return;
  const rate = p.isBoss && p.bossId === 'yuanyuan' ? 0.15 : TUNING.monthlyInterest;
  const interest = Math.round(p.deposit * rate);
  p.deposit += interest;
  log(state, `${p.name} 存款利息 +${interest}`);
}

export function tickGod(state, p) {
  if (!p.god) return;
  p.godDays -= 1;
  if (p.godDays <= 0) {
    if (p.god === '定时炸弹') {
      log(state, `${p.name} 身上的定时炸弹爆炸`);
      damage(state, p, TUNING.bombDamage, '定时炸弹');
    } else {
      log(state, `${p.name} 身上的 ${p.god} 离开了`);
    }
    p.god = null;
  }
}

export function releaseFrom(state, p, kind) {
  const gate = kind === 'jail' ? state.map.facility?.jail : state.map.facility?.hospital;
  p.position = gate ?? state.map.startId;
  log(state, `${p.name} 从${kind === 'jail' ? '监狱' : '医院'}出来了`);
  const octo = state.players.find(q => q.isBoss && q.bossId === 'octopus' && q.bossTier >= 2 && q.alive);
  if (octo) addCard(state, octo, 'sleep');
  if (kind === 'jail' && p.talents.includes('jail_teleport_card')) {
    p.cards.push('portal');
    log(state, `${p.name} 的森林守护者：获得 1 张传送卡`);
  }
}

export function makeOffer(state, n, kind = 'shop') {
  const advanced = kind === 'research';
  const pool = state.rng.shuffle(CARD_LIST.filter(([id]) => advanced ? ADVANCED.has(id) : !ADVANCED.has(id)).map(([id]) => id));
  const mult = kind === 'merchant' ? 0.5 : 1;
  return pool.slice(0, n).map(id => ({ id, price: Math.round((CARD_PRICES[id] ?? 2000) * mult) }));
}

export function drawLottery(state) {
  if (state.day % 10 !== 0) return;
  if (state.lottery.lastDrawDay === state.day) return;
  state.lottery.lastDrawDay = state.day;
  const winning = 1 + state.rng.int(30);
  const hit = state.lottery.tickets.find(t => t.number === winning);
  if (hit) {
    const w = state.players.find(p => p.id === hit.playerId);
    if (w) { w.cash += state.lottery.jackpot; log(state, `乐透开奖 ${winning}：${w.name} 中奖 ${state.lottery.jackpot}`); }
    state.lottery.jackpot = TUNING.lotteryJackpotBase;
  } else {
    state.lottery.jackpot += 200_000;
    log(state, `乐透开奖 ${winning}：无人中奖，奖池累计 ${state.lottery.jackpot}；已买号码继续保留`);
    return;
  }
  state.lottery.tickets = [];
  state.lottery.sold = [];
}

export function tickTimers(state) {
  for (const pr of Object.values(state.properties)) {
    if (pr.closed > 0) pr.closed -= 1;
    if (pr.inflate > 0) pr.inflate -= 1;
  }
}

export function attachGod(state, p, name) {
  if (p.god && p.god !== '定时炸弹') {
    log(state, `${p.name} 身上的 ${p.god} 被 ${name} 顶掉`);
  }
  p.god = name;
  let days = TUNING.godBaseDays;
  if (p.talents.includes('all_gods_plus')) days += 1;
  if (name === '财神' && p.talents.includes('caishen_fushen_plus')) days += 3;
  if (name === '福神' && p.talents.includes('caishen_fushen_plus')) days += 3;
  if (name === '土地公' && p.talents.includes('tudigong_days_plus')) days += 3;
  if (name === '武神' && p.talents.includes('wushen_days_x2')) days *= 2;
  if (name === '天使' && p.talents.includes('angel_demon_x2')) days *= 2;
  if (name === '恶魔' && p.talents.includes('angel_demon_x2')) days *= 2;
  p.godDays = days;
  log(state, `${p.name} 被 ${name} 附身 ${days} 天`);
  if (name === '财神') {
    for (const q of state.players.filter(x => x.alive && x.id !== p.id)) {
      const take = Math.min(q.cash, 10_000); q.cash -= take; p.cash += take;
    }
    log(state, '财神附身：向每位对手收取 10000');
  }
  if (name === '穷神') {
    for (const q of state.players.filter(x => x.alive && x.id !== p.id)) {
      const give = Math.min(p.cash, 10_000); p.cash -= give; q.cash += give;
    }
    log(state, '穷神附身：向每位对手赠送 10000');
  }
  if (name === '福神') { addCard(state, p, randomCard(state.rng)); addCard(state, p, randomCard(state.rng)); }
  if (name === '衰神') { p.cards.splice(0, Math.min(2, p.cards.length)); }
  if (p.talents.includes('god_gives_sendgod') || p.talents.includes('god_gives_robotdoll')) {
    addCard(state, p, p.talents.includes('god_gives_sendgod') ? 'sendgod' : 'robotdoll');
  }
}

export function spawnOccupants(state) {
  if (state.day < 3) return;
  if (state.rng.float() > 0.55) return;
  const occupied = new Set(state.players.filter(p => p.alive).map(p => p.position));
  const cells = state.map.nodes.filter(n => !state.placements[n.id] && !occupied.has(n.id) && n.kind !== 'teleport' && n.kind !== 'platform' && n.kind !== 'hospital' && n.kind !== 'jail');
  if (!cells.length) return;
  const cell = state.rng.pick(cells);
  const roll = state.rng.float();
  let occ;
  if (roll < 0.28) occ = { kind: 'god', name: state.rng.pick(['财神', '穷神', '福神', '衰神', '天使', '恶魔', '土地公', '糊涂神', '武神', '凶神']) };
  else if (roll < 0.46) occ = { kind: 'dog' };
  else if (roll < 0.60) occ = { kind: 'beggar' };
  else if (roll < 0.72) occ = { kind: 'merchant' };
  else occ = { kind: state.rng.pick(['mine', 'dynamite', 'timebomb', 'banana', 'jelly', 'trap', 'roadblock']) };
  state.placements[cell.id] = occ;
  log(state, `路面上随机出现了 ${occ.kind}${occ.name ? '：' + occ.name : ''}`);
}

export const BIG_NAMES = { commercial: '商业中心', hotel: '大饭店', bookstore: '书店', energy: '能源中心', realestate: '地产公司', research: '研究所', park: '公园' };

export const TARGET_RANGE_5 = new Set(['turtle', 'turn', 'stay', 'sleep', 'equalpoor', 'pick', 'scheme', 'magic', 'sendgod', 'samefate', 'start', 'audit', 'missile', 'quantum', 'rushmissile']);
export const SELF_TARGET = new Set(['turtle', 'turn', 'stay']);
export const PASSIVE = new Set(['free', 'samefate', 'transfer', 'wuxie']);

export function useCard(state, index, target) {
  if (state.phase !== 'action') return state;
  const p = current(state);
  const id = p.cards[index];
  if (!id) return state;
  const def = CARD_DEFS[id];
  if (!def) return state;
  if (def.target !== 'self' && def.target !== 'all' && !target) return state;
  if (target === p.id && !SELF_TARGET.has(id)) return state;
  if (TARGET_RANGE_5.has(id) && target && !(id === 'turn' && p.talents.includes('turn_card_infinite'))) {
    const q = targetPlayer(state, p, target);
    if (!q) return state;
    if (q.position !== p.position && !pathWithin(state.map, p.position, q.position, 5)) return state;
  }
  if (def.target === 'cell' && target) {
    const max = id === 'robotdoll' ? 10 : 5;
    if (!pathWithin(state.map, p.position, target, max)) return state;
  }
  if (p.god === '糊涂神' && state.rng.float() < 0.3) {
    p.cards.splice(index, 1);
    log(state, `${p.name} 在糊涂神影响下用卡失败，${def.name} 没了`);
    return state;
  }
  const ok = applyCard(state, p, id, target);
  if (!ok) return state;
  p.cards.splice(index, 1);
  const octo = state.players.find(x => x.isBoss && x.bossId === 'octopus' && x.bossTier >= 3 && x.alive);
  if (octo && id !== 'pick' && state.rng.float() < 0.2) addCard(state, octo, 'pick');
  log(state, `${p.name} 使用 ${def.name}${target ? ` → ${target}` : ''}`);
  return state;
}

function targetPlayer(state, p, id) {
  return state.players.find(q => q.id === id && q.alive) ?? null;
}

function targetPlotId(state, id) {
  if (state.map.plots.some(p => p.id === id)) return id;
  const node = state.map.nodes.find(n => n.id === id);
  return node?.plotId ?? node?.adjacentPlots?.[0] ?? id;
}

function targetNode(state, id) {
  return state.map.nodes.find(n => n.id === id) ?? null;
}

export function applyCard(state, p, id, target) {
  const node = targetNode(state, target);
  const q = targetPlayer(state, p, target);
  switch (id) {
    case 'buyland': {
      const key = targetPlotId(state, target);
      const plot = state.map.plots.find(x => x.id === key);
      if (!plot) return false;
      const pr = state.properties[key];
      if (pr?.ownerId === p.id) return false;
      const price = buyPrice(state, key);
      if (p.cash < price) return false;
      p.cash -= price;
      if (pr) { const old = state.players.find(x => x.id === pr.ownerId); if (old) old.properties = old.properties.filter(x => x !== key); }
      p.properties.push(key);
      state.properties[key] = { ownerId: p.id, level: pr?.level ?? 0, street: plot?.street ?? null, big: !!plot?.big, bigType: pr?.bigType ?? null };
      return true;
    }
    case 'exchange': {
      const here = targetPlotId(state, p.position);
      const there = targetPlotId(state, node?.id ?? target);
      const a = state.properties[here], b = state.properties[there];
      const pa = state.players.find(x => x.id === a?.ownerId);
      const pb = state.players.find(x => x.id === b?.ownerId);
      if (a && pa) pa.properties = pa.properties.filter(x => x !== here);
      if (b && pb) pb.properties = pb.properties.filter(x => x !== there);
      if (a) state.properties[there] = a; else delete state.properties[there];
      if (b) { state.properties[here] = b; } else { delete state.properties[here]; }
      if (a && pa) pa.properties.push(there);
      if (b && pb) pb.properties.push(here);
      return true;
    }
    case 'rebuild': {
      const key = targetPlotId(state, target);
      const pr = state.properties[key];
      if (!pr || !pr.big || pr.ownerId === p.id) return false;
      pr.bigType = 'park';
      return true;
    }
    case 'close': {
      const street = String(target ?? '');
      for (const pr of Object.values(state.properties)) {
        if (pr.street === street) pr.closed = 5;
      }
      return true;
    }
    case 'truck': {
      const key = targetPlotId(state, target);
      const pr = state.properties[key]; if (!pr) return false;
      pr.level = Math.max(1, pr.level - 1); return true;
    }
    case 'monster': {
      const key = targetPlotId(state, target);
      const plot = state.map.plots.find(x => x.id === key);
      const street = plot?.street;
      if (!street) return false;
      let hit = 0;
      for (const [id, pr] of Object.entries(state.properties)) {
        if (pr.street !== street || pr.big) continue;
        if (pr.level > 0) { pr.level -= 1; hit += 1; }
      }
      log(state, `怪兽卡：${street} 街所有小房屋各降 1 层（${hit} 栋）`);
      return true;
    }
    case 'worker': {
      const key = targetPlotId(state, target);
      const plot = state.map.plots.find(x => x.id === key);
      if (!plot) return false;
      const road = state.map.nodes.find(n => n.adjacentPlots?.includes(key));
      if (!road || !pathWithin(state.map, p.position, road.id, 5)) return false;
      const pr = state.properties[key]; if (!pr || pr.ownerId !== p.id) return false;
      pr.level = Math.min(TUNING.maxLevel, pr.level + 1); return true;
    }
    case 'inflate': {
      const street = String(target ?? '');
      for (const pr of Object.values(state.properties)) if (pr.street === street) pr.inflate = 6;
      return true;
    }
    case 'superdice': p.forcedDice = 12; return true;
    case 'turtle': if (!q) return false; q.status = '乌龟'; q.statusDays = 3; return true;
    case 'turn': if (!q) return false; { const adj = buildAdj(state.map); const exits = adj[q.position].map(e => e.to); q.facing = exits.find(x => x !== q.facing) ?? q.lastNode; return true; }
    case 'stay': if (!q) return false; q.skipMove = 1; return true;
    case 'sleep': if (!q) return false; q.status = '梦游'; q.statusDays = 2; return true;
    case 'hibernate': if (!q) return false; q.status = '冬眠'; q.statusDays = 2; return true;
    case 'roadblock': case 'jelly': case 'mine': case 'dynamite': case 'banana': case 'trap': case 'timebomb':
      if (!node || state.placements[node.id]) return false;
      return place(state, node.id, { kind: id, ownerId: p.id });
    case 'randomdoor': {
      const walkable = state.map.nodes.filter(n => n.kind !== 'teleport' && n.kind !== 'platform');
      p.position = state.rng.pick(walkable).id; return true;
    }
    case 'portal': {
      if (!q) return false;
      const walkable = state.map.nodes.filter(n => n.kind !== 'teleport' && n.kind !== 'platform');
      q.position = state.rng.pick(walkable).id; return true;
    }
    case 'motorcycle': p.vehicle = 1; return true;
    case 'car': p.vehicle = 2; return true;
    case 'robotdoll': {
      if (!node) return false;
      const path = pathWithin(state.map, p.position, node.id, 10);
      if (!path || path.length === 0) return false;
      let cleared = 0;
      for (const id of path) {
        if (state.placements[id]) { delete state.placements[id]; cleared += 1; }
      }
      log(state, `机器娃娃沿路径清除了 ${cleared} 个障碍物`);
      return true;
    }
    case 'start': {
      if (!q || q.god !== '定时炸弹') return false;
      q.god = null; q.godDays = 0;
      damage(state, q, TUNING.bombDamage, '定时炸弹'); return true;
    }
    case 'missile': if (!q) return false; q.hospital = TUNING.hospitalTurns; q.position = state.map.facility?.hospital ?? q.position; log(state, `${q.name} 被飞弹炸进医院 ${q.hospital} 回合`); return true;
    case 'quantum': for (const x of state.players.filter(x => x.alive && x.id !== p.id)) damage(state, x, TUNING.bombDamage * 1.5, '量子飞弹'); return true;
    case 'rushmissile': for (const x of state.players.filter(x => x.alive && x.id !== p.id)) damage(state, x, TUNING.bombDamage, '急速弹'); return true;
    case 'free': p.freeCard = true; return true;
    case 'audit': if (!q) return false; log(state, `${q.name} 手牌：${q.cards.map(cardName).join('、') || '无'}`); return true;
    case 'equalpoor': {
      if (!q) return false;
      const avg = Math.floor((p.cash + q.cash) / 2); p.cash = avg; q.cash = avg; return true;
    }
    case 'equalrich': {
      const alive = state.players.filter(x => x.alive);
      const avg = Math.floor(alive.reduce((s, x) => s + x.cash, 0) / alive.length);
      for (const x of alive) x.cash = avg; return true;
    }
    case 'pick': {
      if (q?.isBoss && q.bossId === 'octopus') { log(state, '章鱼王免疫拾取卡'); return false; }
      if (!q || !q.cards.length) return false;
      const i = state.rng.int(q.cards.length); addCard(state, p, q.cards.splice(i, 1)[0]); return true;
    }
    case 'scheme': {
      if (!q || !q.cards.length) return false;
      q.cards.splice(state.rng.int(q.cards.length), 1); return true;
    }
    case 'magic': {
      if (!q) return false;
      [p.cards, q.cards] = [q.cards, p.cards]; return true;
    }
    case 'invitegod': case 'godfavor': {
      const gods = ['财神', '福神', '土地公', '武神', '天使', '糊涂神'];
      attachGod(state, p, state.rng.pick(gods)); return true;
    }
    case 'sendgod': if (!q || !q.god) return false; q.god = null; q.godDays = 0; return true;
    case 'samefate': if (!q || !q.god) return false; p.god = q.god; p.godDays = q.godDays; return true;
    case 'transfer': p.transfer = true; return true;
    case 'wuxie': return true;
    case 'glory': for (const x of p.properties) if (state.properties[x]) state.properties[x].level = Math.min(TUNING.maxLevel, state.properties[x].level + 1); return true;
    case 'predicament': for (const x of Object.values(state.properties)) if (x.ownerId !== p.id) x.level = Math.max(1, x.level - 1); return true;
    case 'green': state.placements = {}; return true;
    case 'disaster': for (const x of Object.values(state.properties)) if (x.ownerId !== p.id) x.level = Math.max(1, x.level - 4); return true;
    default: return false;
  }
}

function damage(state, q, amount, reason) {
  if (!pay(state, q, null, amount, reason)) state.stats.bankruptcies += 1;
}

export function place(state, cellId, obj) {
  if (state.placements[cellId]) return false;
  if (state.players.some(p => p.alive && p.position === cellId)) return false;
  state.placements[cellId] = obj;
  return true;
}

export function cardName(id) { return CARD_DEFS[id]?.name ?? CARD_POOL.find(c => c.id === id)?.name ?? id; }

export function runNewsEvent(state, p) {
  const kind = state.rng.pick(['price','boom','bust','prize','fine','hospital','jail','cards','losecard','allgain','allpay','teleport']);
  const k = state.priceIndex;
  if (kind === 'price') { state.priceIndex = +(state.priceIndex + 0.1).toFixed(2); log(state, '新闻：物价上涨 0.1'); }
  if (kind === 'boom') { for (const s of state.stocks) s.price = Math.max(1, Math.round(s.price * 1.1)); log(state, '新闻：股市大涨'); }
  if (kind === 'bust') { for (const s of state.stocks) s.price = Math.max(1, Math.round(s.price * 0.9)); log(state, '新闻：股市大跌'); }
  if (kind === 'prize') { p.cash += Math.round(20_000 * k); log(state, `新闻：${p.name} 中奖 ${Math.round(20_000 * k)}`); }
  if (kind === 'fine') { const amount = Math.round(10_000 * k); pay(state, p, null, amount, '新闻罚款'); log(state, `新闻：${p.name} 被罚款 ${amount}`); }
  if (kind === 'hospital') { p.hospital = TUNING.hospitalTurns; p.position = state.map.facility?.hospital ?? p.position; log(state, `新闻：${p.name} 住院`); }
  if (kind === 'jail') { p.jail = TUNING.jailTurns; p.position = state.map.facility?.jail ?? p.position; log(state, `新闻：${p.name} 入狱`); }
  if (kind === 'cards') { addCard(state, p, randomCard(state.rng)); addCard(state, p, randomCard(state.rng)); log(state, `新闻：${p.name} 获得 2 张卡`); }
  if (kind === 'losecard') { if (p.cards.length) p.cards.splice(state.rng.int(p.cards.length), 1); log(state, `新闻：${p.name} 失去 1 张卡`); }
  if (kind === 'allgain') { const amount = Math.round(10_000 * k); for (const q of state.players.filter(q => q.alive)) q.cash += amount; log(state, `新闻：所有人获得 ${amount}`); }
  if (kind === 'allpay') { const amount = Math.round(10_000 * k); for (const q of state.players.filter(q => q.alive)) pay(state, q, null, amount, '新闻共同支出'); log(state, `新闻：所有人支付 ${amount}`); }
  if (kind === 'teleport') {
    const cells = state.map.nodes.filter(n => n.kind !== 'teleport' && n.kind !== 'platform' && !state.placements[n.id]);
    if (cells.length) { p.position = state.rng.pick(cells).id; log(state, `新闻：${p.name} 被传送到 ${p.position}`); }
  }
}

export function tickStocks(state) {
  for (const s of state.stocks) {
    s.price = Math.max(1, Math.round(s.price * (0.9 + state.rng.float() * 0.2)));
  }
}

