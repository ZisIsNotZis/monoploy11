import { makeRng } from './rng.js';
import { TUNING } from '../data/tuning.js';
import { CHARACTER_BY_ID, CHARACTERS } from '../data/characters.js';
import { BOSS_BY_ID } from '../data/bosses.js';
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
      id: p.id, name: p.name ?? char.name, charId: char.id, color: p.color ?? (p.isBoss ? BOSS_BY_ID[p.bossId]?.color : char.color) ?? char.color,
      team: p.team ?? (p.isBoss ? 'boss' : `t${i + 1}`),
      controller: p.controller ?? 'human', isBoss: !!p.isBoss, bossId: p.bossId ?? null, bossTier: p.bossTier ?? 0, revived: false,
      cash: config.startingCash ?? TUNING.startingCash,
      deposit: config.startingDeposit ?? TUNING.startingDeposit,
      cards: [], position: map.startId, facing: nextRing(map, map.startId),
      jail: 0, hospital: 0, god: null, godDays: 0, status: null, statusDays: 0,
      vehicle: null, alive: true, properties: [], handLimit: p.isBoss && p.bossId === 'doctor' && p.bossTier === 3 ? 16 : TUNING.handLimit,
      talents: char.talents.map(t => t.id),
      freeCard: false, forcedDice: null, skipTurns: 0,
    };
  });

  const state = {
    seed, rng, mapId, map, config: { dayLimit: TUNING.dayLimit, ...config }, players, order: players.map(p => p.id),
    day: 0, priceIndex: TUNING.priceIndexStart, turn: 0,
    phase: 'action', properties: {}, placements: {}, log: [], pending: null,
    winnerTeam: null, stocks: makeStocks(rng), lottery: { tickets: [], sold: [], jackpot: TUNING.lotteryJackpotBase, lastDrawDay: 0 },
    stats: { rolls: 0, rents: 0, bankruptcies: 0 },
  };

  for (const p of players) {
    if (!p.isBoss) continue;
    p.cash = 200_000; p.deposit = 100_000;
    for (const id of ['r1', 'r2', 'r13', 'r14', 'r25', 'r32']) {
      const n = map.nodes.find(x => x.id === id);
      if (!n?.plotId) continue;
      p.properties.push(n.plotId);
      state.properties[n.plotId] = { ownerId: p.id, level: 2, street: n.street ?? null, big: !!map.plots.find(x => x.id === n.plotId)?.big, bigType: null };
    }
  }
  for (let i = 0; i < TUNING.startingCards; i++) {
    for (const p of players) p.cards.push(randomCard(rng));
  }
  log(state, `开局：${players.map(p => p.name).join('、')}，地图 ${map.name}`);
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

const CARD_LIST = [
  ['buyland', '购地卡', 'cell'], ['exchange', '换屋卡', 'cell'], ['rebuild', '改建卡', 'cell'],
  ['close', '停业卡', 'street'], ['truck', '工程车卡', 'cell'], ['monster', '怪兽卡', 'cell'],
  ['worker', '机器工人卡', 'cell'], ['inflate', '涨价卡', 'street'], ['remotedice', '遥控骰子卡', 'self'],
  ['turtle', '乌龟卡', 'player'], ['turn', '转向卡', 'player'], ['stay', '停留卡', 'player'],
  ['sleep', '梦游卡', 'player'], ['hibernate', '冬眠卡', 'player'], ['roadblock', '路障卡', 'cell'],
  ['superdice', '超级骰子卡', 'self'], ['jelly', '果冻墙卡', 'cell'], ['randomdoor', '随意门卡', 'self'],
  ['portal', '传送门卡', 'player'], ['motorcycle', '机车卡', 'self'], ['car', '汽车卡', 'self'],
  ['robotdoll', '机器娃娃卡', 'self'], ['start', '启动卡', 'player'], ['mine', '地雷卡', 'cell'],
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

export function startTurn(state) {
  if (state.phase === 'over') return state;
  const p = current(state);
  if (!p || !p.alive) return endTurn(state);

  state.day += 1;
  if (state.day > 1 && (state.day - 1) % TUNING.priceIndexEveryDays === 0) {
    state.priceIndex = +(state.priceIndex + TUNING.priceIndexStep).toFixed(2);
    log(state, `物价指数上涨到 ${state.priceIndex.toFixed(2)}`);
  }
  applyMonthly(state, p);
  tickStocks(state);
  drawLottery(state);
  tickTimers(state);
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
  const rate = p.isBoss && p.bossId === 'yuanyuan' ? 0.15 : TUNING.monthlyInterest;
  const interest = Math.round(p.deposit * rate);
  p.deposit += interest;
  log(state, `${p.name} 存款利息 +${interest}`);
}

function tickGod(state, p) {
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

function releaseFrom(state, p, kind) {
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
  const allowed = Math.min(TUNING.maxDice, 1 + Math.max(0, p.vehicle ?? 0));
  if (diceCount > allowed) return state;
  const dice = Math.max(1, diceCount);
  const n = p.forcedDice ?? Array.from({ length: dice }, () => 1 + state.rng.int(6)).reduce((a, b) => a + b, 0);
  p.forcedDice = null;
  state.stats.rolls += 1;
  log(state, `${p.name} 掷出 ${n} 点`);

  const chaos = p.god === '糊涂神' && state.rng.float() < 0.3;
  state.lastRoll = { playerId: p.id, value: n, path: [] };
  const res = walk(state.map, state.day, p.position, p.facing, n, state.rng, { cameFrom: p.lastNode, chaos });
  state.lastRoll = { playerId: p.id, value: n, path: res.path };
  for (const id of res.path) {
    if (id === state.map.startId) {
      p.cash += TUNING.salary;
      log(state, `${p.name} 经过起点 +${TUNING.salary}`);
    }
    applyPass(state, p, id);
    if (!p.alive) break;
  }
  // 定时炸弹：只有主动追上别人才能送出去
  if (p.alive && p.god === '定时炸弹') {
    for (const id of res.path) {
      const other = state.players.find(q => q.alive && q.id !== p.id && q.position === id);
      if (other) {
        other.god = '定时炸弹'; other.godDays = p.godDays;
        p.god = null; p.godDays = 0;
        log(state, `${p.name} 追上 ${other.name}，把定时炸弹送了出去`);
        break;
      }
    }
  }
  p.lastNode = res.path.length >= 2 ? res.path[res.path.length - 2] : p.position;
  p.position = res.landed;
  p.facing = null;
  if (!p.alive) return endTurn(state);
  state.phase = 'resolve';
  if (res.pendingDirection) {
    state.pending = { type: 'direction', options: exitsOf(state, p.position, p.lastNode) };
    log(state, `${p.name} 正好停在交叉点，请选择方向`);
    return state;
  }
  const result = resolveLanding(state, p);
  if (state.phase === 'resolve' && !state.pending && state.passPrompt) {
    state.pending = state.passPrompt === 'bank' ? { type: 'bank', fromPass: true } : { type: 'lottery', fromPass: true };
  }
  state.passPrompt = null;
  return result;
}

function exitsOf(state, id, lastNode = null) {
  const adj = buildAdj(state.map);
  const all = adj[id].map(e => e.to).filter(to => {
    const n = state.map.nodes.find(x => x.id === to);
    return n.kind !== 'teleport';
  });
  const forward = all.filter(to => to !== lastNode);
  return forward.length ? forward : all;
}

export function chooseDirection(state, toId) {
  if (state.pending?.type !== 'direction') return state;
  const p = current(state);
  if (toId === p.lastNode) return state;
  p.facing = toId;
  state.pending = null;
  log(state, `${p.name} 选择朝 ${label(state, toId)} 方向`);
  return resolveLanding(state, p);
}

function label(state, id) {
  return state.map.nodes.find(n => n.id === id)?.label ?? id;
}

function applyPass(state, p, id) {
  const cell = state.map.nodes.find(n => n.id === id);
  if (!cell) return;
  const placed = state.placements[id];
  if (placed) {
    delete state.placements[id];
    const hurt = { mine: TUNING.mineDamage, dynamite: TUNING.bombDamage }[placed.kind];
    if (hurt) {
      log(state, `${p.name} 经过${placed.kind === 'mine' ? '地雷' : '炸药'}，损失 ${hurt}`);
      damage(state, p, hurt, placed.kind);
    } else if (placed.kind === 'timebomb') {
      p.god = '定时炸弹'; p.godDays = 30;
      log(state, `${p.name} 经过定时炸弹，被缠上了`);
    } else {
      p.skipTurns += 1;
      log(state, `${p.name} 经过${placed.kind}，停留 1 回合`);
    }
    return;
  }
  if (cell.kind === 'card') {
    addCard(state, p, randomCard(state.rng));
    log(state, `${p.name} 经过卡片格，获得 1 张卡`);
  } else if (cell.kind === 'bank') {
    state.passPrompt = 'bank';
  } else if (cell.kind === 'lottery') {
    state.passPrompt = 'lottery';
  }
}

function makeOffer(state, n, prices) {
  return Array.from({ length: n }, () => ({ id: randomCard(state.rng), price: state.rng.pick(prices) }));
}

function drawLottery(state) {
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
    log(state, `乐透开奖 ${winning}：无人中奖，奖池累计 ${state.lottery.jackpot}`);
  }
  state.lottery.tickets = [];
  state.lottery.sold = [];
}

function tickTimers(state) {
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

function godOnProperty(state, p, pr) {
  if (!pr) return;
  if (p.god === '天使') { pr.level = Math.min(TUNING.maxLevel, pr.level + 1); log(state, `天使让 ${label(state, Object.keys(state.properties).find(k => state.properties[k] === pr))} 加盖`); }
  if (p.god === '恶魔') { pr.level = Math.max(1, pr.level - 1); }
  if (p.god === '福神' && pr.ownerId === p.id) pr.level = Math.min(TUNING.maxLevel, pr.level + 1);
  if (p.god === '土地公' && pr.ownerId !== p.id) {
    const old = state.players.find(q => q.id === pr.ownerId);
    if (old) old.properties = old.properties.filter(x => state.properties[x] !== pr);
    pr.ownerId = p.id;
    p.properties.push(Object.keys(state.properties).find(k => state.properties[k] === pr));
    log(state, `${p.name} 用土地公抢走一块地`);
  }
}

function resolvePlot(state, p, cell) {
  const key = cell.plotId;
  const plot = state.map.plots.find(x => x.id === key);
  const label = plot?.big ? ((state.properties[key]?.bigType ? BIG_NAMES[state.properties[key].bigType] : '大空地')) : (plot?.label ?? key);
  const pr = state.properties[key];
  if (!pr || !pr.ownerId) {
    if (p.god === '土地公') {
      p.properties.push(key);
      state.properties[key] = { ownerId: p.id, level: plot?.big ? 0 : 1, street: plot?.street ?? null, big: !!plot?.big, bigType: null };
      log(state, `土地公附身，${p.name} 直接占领 ${label}`);
      return endTurn(state);
    }
    const price = buyPrice(state, key);
    state.pending = { type: 'buy', cellId: key, price, label };
    log(state, `${label} 无主，售价 ${price}`);
    return state;
  }
  godOnProperty(state, p, pr);
  if (pr.ownerId === p.id) {
    if (p.god === '衰神') { log(state, '衰神附身，不能加盖'); return endTurn(state); }
    if (pr.big && !pr.bigType) { state.pending = { type: 'chooseBig', cellId: key, label }; return state; }
    if (pr.level < TUNING.maxLevel) {
      state.pending = { type: 'build', cellId: key, cost: buildCost(pr.level), label };
      log(state, `${label} 是己方地产（Lv.${pr.level}），可加盖`);
      return state;
    }
    return endTurn(state);
  }
  const owner = state.players.find(q => q.id === pr.ownerId);
  if (owner?.team === p.team) { log(state, `${label} 是队友 ${owner.name} 的地产，免租`); return endTurn(state); }
  if (pr.bigType === 'park') { log(state, '公园不收费'); return endTurn(state); }
  if (pr.bigType === 'energy') {
    const fee = 5_000;
    log(state, `${p.name} 使用能源中心，支付 ${fee} 给 ${owner.name}`);
    pay(state, p, owner, fee, '能源');
    return endTurn(state);
  }
  if (plot?.big && pr.bigType === 'research' && pr.ownerId === p.id) {
    state.shopOffer = ['rushmissile', 'glory', 'predicament', 'green', 'disaster', 'godfavor'].map(id => ({ id, price: 5_000 }));
    state.shopBought = 0; state.shopLimit = 1;
    state.pending = { type: 'research', cellId: key };
    log(state, '研究所：选择要研发的进阶卡');
    return state;
  }
  let rent = rentFor(state, key);
  if (pr.bigType === 'commercial') rent = Math.round(rent * (1 + state.rng.float() * 2));
  if (pr.bigType === 'hotel') { rent = Math.round(rent * 0.6); p.skipTurns += 1; log(state, `${p.name} 被大饭店留下 1 回合`); }
  if (p.talents.includes('rent_taken_down')) rent = Math.round(rent * 0.8);
  if (owner?.talents.includes('rent_dealt_up')) rent = Math.round(rent * 1.2);
  if (p.properties.some(id => state.properties[id]?.bigType === 'realestate')) rent = Math.round(rent * 0.7);
  if (p.god === '财神') { log(state, '财神附身，免租'); return endTurn(state); }
  if (p.god === '穷神') rent = Math.round(rent * 2);
  if (owner?.isBoss) rent = Math.round(rent * (owner.bossId === 'bear' || owner.bossId === 'yuanyuan' ? 1.5 : 1));
  log(state, `${p.name} 向 ${owner.name} 支付租金 ${rent}`);
  state.stats.rents += rent;
  if (!pay(state, p, owner, rent, '租金')) state.stats.bankruptcies += 1;
  return endTurn(state);
}

const BIG_NAMES = { commercial: '商业中心', hotel: '大饭店', bookstore: '书店', energy: '能源中心', realestate: '地产公司', research: '研究所', park: '公园' };

function resolveLanding(state, p) {
  const cell = state.map.nodes.find(n => n.id === p.position);
  if (!cell) return endTurn(state);
  log(state, `${p.name} 停在 ${cell.label}`);
  if (p.god === '凶神' && state.rng.float() < 0.2) {
    log(state, '凶神附身，部分地格无效');
    return endTurn(state);
  }

  if (cell.plotId) return resolvePlot(state, p, cell);

  switch (cell.kind) {
    case 'tax': {
      const amount = Math.round(p.cash * TUNING.taxRate);
      log(state, `${p.name} 纳税 ${amount}`);
      pay(state, p, null, amount, '纳税');
      return endTurn(state);
    }
    case 'card':
      return endTurn(state);
    case 'god': {
      const gods = ['财神', '穷神', '福神', '衰神', '天使', '恶魔', '土地公', '糊涂神', '武神', '凶神'];
      attachGod(state, p, state.rng.pick(gods));
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
      state.shopOffer = makeOffer(state, 9, [1_000, 2_000, 3_000, 4_000]);
      state.shopBought = 0; state.shopLimit = 3;
      state.pending = { type: 'shop', cellId: cell.id };
      log(state, `${p.name} 进入 ${cell.label}`);
      return state;
    case 'merchant':
      state.shopOffer = makeOffer(state, 6, [1_000]);
      state.shopBought = 0; state.shopLimit = 2;
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
  const plot = state.map.plots.find(p => p.id === cellId);
  p.cash -= price;
  p.properties.push(cellId);
  state.properties[cellId] = {
    ownerId: p.id, level: plot?.big ? 0 : 1, street: plot?.street ?? null, big: !!plot?.big, bigType: null,
  };
  log(state, `${p.name} 以 ${price} 买下 ${plot?.label ?? cellId}`);
  state.pending = null;
  return endTurn(state);
}

export function buildProperty(state) {
  if (state.pending?.type !== 'build') return state;
  const p = current(state);
  const { cellId, cost } = state.pending;
  const pr = state.properties[cellId];
  if (!pr || p.cash < cost || pr.level >= TUNING.maxLevel) return endTurn(state);
  if (pr.big && !pr.bigType) { state.pending = { type: 'chooseBig', cellId }; return state; }
  p.cash -= cost;
  pr.level += 1;
  log(state, `${p.name} 将 ${state.map.plots.find(x => x.id === cellId)?.label ?? cellId} 升到 Lv.${pr.level}（花费 ${cost}）`);
  state.pending = null;
  return endTurn(state);
}

export function doChooseBig(state, bigType) {
  if (state.pending?.type !== 'chooseBig') return state;
  const p = current(state);
  const pr = state.properties[state.pending.cellId];
  if (!pr || pr.ownerId !== p.id) return endTurn(state);
  const allowed = ['commercial', 'hotel', 'bookstore', 'energy', 'realestate', 'research'];
  if (!allowed.includes(bigType)) return state;
  pr.bigType = bigType;
  pr.level = 1;
  log(state, `${p.name} 在 ${state.map.plots.find(x => x.id === state.pending.cellId)?.label ?? '大地产'} 建起 ${BIG_NAMES[bigType] ?? bigType}`);
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
  const def = CARD_DEFS[id];
  if (!def) return state;
  if (def.target !== 'self' && def.target !== 'all' && !target) return state;
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
  return state.players.find(q => q.id === id && q.alive && q.id !== p.id) ?? null;
}

function targetNode(state, id) {
  return state.map.nodes.find(n => n.id === id) ?? null;
}

function applyCard(state, p, id, target) {
  const node = targetNode(state, target);
  const q = targetPlayer(state, p, target);
  switch (id) {
    case 'buyland': {
      if (!node || !['property', 'big'].includes(node.kind)) return false;
      const key = node.plotId ?? node.propertyKey ?? node.id;
      const pr = state.properties[key];
      if (pr?.ownerId === p.id) return false;
      const price = buyPrice(state, key);
      if (p.cash < price) return false;
      p.cash -= price;
      if (pr) { const old = state.players.find(x => x.id === pr.ownerId); if (old) old.properties = old.properties.filter(x => x !== key); }
      const plot = state.map.plots.find(x => x.id === key);
      p.properties.push(key);
      state.properties[key] = { ownerId: p.id, level: plot?.big ? (pr?.level ?? 0) : (pr?.level ?? 1), street: node.street ?? null, big: !!plot?.big, bigType: pr?.bigType ?? null };
      return true;
    }
    case 'exchange': {
      if (!node) return false;
      const a = state.properties[p.position], b = state.properties[node.id];
      const pa = state.players.find(x => x.id === a?.ownerId);
      const pb = state.players.find(x => x.id === b?.ownerId);
      if (a && pa) pa.properties = pa.properties.filter(x => x !== p.position);
      if (b && pb) pb.properties = pb.properties.filter(x => x !== node.id);
      if (a) state.properties[node.id] = a; else delete state.properties[node.id];
      if (b) { state.properties[p.position] = b; } else { delete state.properties[p.position]; }
      if (a && pa) pa.properties.push(node.id);
      if (b && pb) pb.properties.push(p.position);
      return true;
    }
    case 'rebuild': {
      if (!node) return false;
      const key = node.plotId ?? node.propertyKey ?? node.id;
      const pr = state.properties[key];
      if (!pr || !pr.big || pr.ownerId === p.id) return false;
      pr.bigType = 'park';
      return true;
    }
    case 'close': {
      const street = String(target ?? '');
      for (const pr of Object.values(state.properties)) {
        if (pr.street === street) pr.closed = 3;
      }
      return true;
    }
    case 'truck': {
      const pr = state.properties[node?.id]; if (!pr) return false;
      pr.level = Math.max(1, pr.level - 1); return true;
    }
    case 'monster': {
      const pr = state.properties[node?.id]; if (!pr) return false;
      pr.level = Math.max(1, pr.level - 2); return true;
    }
    case 'worker': {
      const pr = state.properties[node?.id]; if (!pr || pr.ownerId !== p.id) return false;
      pr.level = Math.min(TUNING.maxLevel, pr.level + 1); return true;
    }
    case 'inflate': {
      const street = String(target ?? '');
      for (const pr of Object.values(state.properties)) if (pr.street === street) pr.inflate = 6;
      return true;
    }
    case 'remotedice': p.forcedDice = 7; return true;
    case 'superdice': p.forcedDice = 12; return true;
    case 'turtle': if (!q) return false; q.forcedDice = 1; return true;
    case 'turn': if (!q) return false; q.facing = q.lastNode; return true;
    case 'stay': if (!q) return false; q.skipTurns += 1; return true;
    case 'sleep': case 'hibernate': if (!q) return false; q.skipTurns += 2; return true;
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
    case 'robotdoll': state.placements = {}; return true;
    case 'start': {
      if (!q || q.god !== '定时炸弹') return false;
      q.god = null; q.godDays = 0;
      damage(state, q, TUNING.bombDamage, '定时炸弹'); return true;
    }
    case 'missile': if (!q) return false; damage(state, q, TUNING.bombDamage, '飞弹'); return true;
    case 'quantum': for (const x of state.players.filter(x => x.alive && x.id !== p.id)) damage(state, x, TUNING.bombDamage * 1.5, '量子飞弹'); return true;
    case 'rushmissile': for (const x of state.players.filter(x => x.alive && x.id !== p.id)) damage(state, x, TUNING.bombDamage, '急速弹'); return true;
    case 'free': p.freeCard = true; return true;
    case 'audit': if (!q) return false; log(state, `${q.name} 现金 ${q.cash}，存款 ${q.deposit}`); return true;
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
  const free = state.pending.free;
  state.pending = null;
  return free ? state : endTurn(state);
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

export function openStock(state) {
  if (state.phase !== 'action' || state.pending) return state;
  state.pending = { type: 'stock', free: true };
  return state;
}

export function openBank(state) {
  if (state.phase !== 'action' || state.pending) return state;
  state.pending = { type: 'bank', free: true };
  return state;
}

export function leaveStock(state) {
  if (state.pending?.type !== 'stock') return state;
  const free = state.pending.free;
  state.pending = null;
  return free ? state : endTurn(state);
}

export function doLottery(state, number) {
  if (state.pending?.type !== 'lottery') return state;
  const p = current(state);
  number = Number(number);
  if (!Number.isInteger(number) || number < 1 || number > 30) return state;
  if (state.lottery.sold.includes(number)) return state;
  if (p.cash < TUNING.lotteryTicket) return state;
  p.cash -= TUNING.lotteryTicket;
  state.lottery.tickets.push({ playerId: p.id, number });
  state.lottery.sold.push(number);
  log(state, `${p.name} 买下乐透 ${number}（${TUNING.lotteryTicket}）`);
  return state;
}

export function doMagic(state, effect) {
  if (state.pending?.type !== 'magic') return state;
  const p = current(state);
  const others = state.players.filter(q => q.alive && q.id !== p.id);
  switch (effect) {
    case 'money': p.cash += 10_000; log(state, `${p.name} 从魔法屋获得 10000`); break;
    case 'lose': if (others.length) { const q = state.rng.pick(others); pay(state, q, null, 10_000, '魔法屋'); log(state, `${q.name} 被魔法屋罚 10000`); } break;
    case 'card': addCard(state, p, randomCard(state.rng)); log(state, `${p.name} 从魔法屋获得 1 张卡`); break;
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

export function doMerchant(state, index) {
  if (state.pending?.type !== 'merchant') return state;
  const p = current(state);
  const item = state.shopOffer?.[index];
  if (!item) return state;
  if (state.shopBought >= state.shopLimit) return state;
  if (p.cash < item.price) return state;
  p.cash -= item.price;
  addCard(state, p, item.id);
  state.shopBought += 1;
  state.shopOffer.splice(index, 1);
  if (p.properties.some(id => state.properties[id]?.bigType === 'bookstore') && state.rng.float() < 0.5) addCard(state, p, randomCard(state.rng));
  log(state, `${p.name} 从神秘人处花 ${item.price} 买到 ${CARD_DEFS[item.id].name}（${state.shopBought}/${state.shopLimit}）`);
  if (state.shopBought >= state.shopLimit) return endTurn(state);
  return state;
}

export function doResearch(state, index) {
  if (state.pending?.type !== 'research') return state;
  const p = current(state);
  const item = state.shopOffer?.[index];
  if (!item) return state;
  if (state.shopBought >= state.shopLimit) return state;
  if (p.cash < item.price) return state;
  p.cash -= item.price;
  addCard(state, p, item.id);
  state.shopBought += 1;
  state.shopOffer.splice(index, 1);
  log(state, `${p.name} 研发 ${CARD_DEFS[item.id].name}（${item.price}）`);
  return state;
}

export function doShop(state, index) {
  if (state.pending?.type !== 'shop') return state;
  const p = current(state);
  const item = state.shopOffer?.[index];
  if (!item) return state;
  if (state.shopBought >= state.shopLimit) return state;
  const price = Math.round(item.price * (p.talents.includes('shop_discount') ? 0.5 : 1));
  if (p.cash < price) return state;
  p.cash -= price;
  addCard(state, p, item.id);
  state.shopBought += 1;
  state.shopOffer.splice(index, 1);
  if (p.talents.includes('shop_extra_card')) addCard(state, p, randomCard(state.rng));
  if (p.properties.some(id => state.properties[id]?.bigType === 'bookstore') && state.rng.float() < 0.5) addCard(state, p, randomCard(state.rng));
  log(state, `${p.name} 花 ${price} 买到 ${CARD_DEFS[item.id].name}（${state.shopBought}/${state.shopLimit}）`);
  if (state.shopBought >= state.shopLimit) return endTurn(state);
  return state;
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
  const free = state.pending.free;
  state.pending = null;
  return free ? state : endTurn(state);
}
