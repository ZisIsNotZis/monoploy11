// 异步回合引擎：一个游戏循环，按阶段 await；回合只在流程自然结束后推进。
import { TUNING } from '../data/tuning.js';
import { buildAdj, edgeUsable, isPlatformActive, nearestStable, pathWithin } from './board-v2.js';
import { rentFor, buyPrice, buildCost, assetsOf, pay, log } from './economy.js';
import {
  createGame, current, addCard, randomCard, CARD_DEFS, BIG_NAMES,
  useCard, applyCard, attachGod, makeOffer, drawLottery, tickStocks, TARGET_RANGE_5, SELF_TARGET, PASSIVE,
  applyMonthly, tickGod, tickTimers, spawnOccupants, releaseFrom, runNewsEvent,
} from './game.js';

const range5 = new Set(['turtle', 'turn', 'stay', 'sleep', 'hibernate', 'equalpoor', 'pick', 'scheme', 'magic', 'sendgod', 'samefate', 'start']);

export function startSession(config) {
  const state = createGame(config);
  state.day = 0;
  state.phase = 'action';
  return state;
}

export async function runGame(state, ui) {
  while (!state.over) {
    const p = current(state);
    const skipped = beginTurn(state, p);
    ui.render(state);
    if (skipped) {
      if (!nextPlayer(state)) break;
      continue;
    }
    await playTurn(state, p, ui);
    if (state.over) break;
    if (!nextPlayer(state)) break;
  }
}

function beginTurn(state, p) {
  if (!p || !p.alive) return true;
  state.day += 1;
  if (state.day > 1 && (state.day - 1) % TUNING.priceIndexEveryDays === 0) {
    state.priceIndex = +(state.priceIndex + TUNING.priceIndexStep).toFixed(2);
    log(state, `物价指数上涨到 ${state.priceIndex.toFixed(2)}`);
  }
  applyMonthly(state, p);
  tickStocks(state);
  drawLottery(state);
  spawnOccupants(state);
  tickTimers(state);
  tickGod(state, p);

  if (p.statusDays > 0) {
    const was = p.status;
    p.statusDays -= 1;
    if (p.statusDays <= 0) { p.status = null; p.statusDays = 0; log(state, `${p.name} 的 ${was} 状态结束`); }
    if (was === '梦游' || was === '冬眠') { log(state, `${p.name} 正在${was}，跳过本回合`); return true; }
  }
  if (p.skipTurns > 0) { p.skipTurns -= 1; log(state, `${p.name} 跳过本回合`); return true; }
  if (p.jail > 0) { p.jail -= 1; if (p.jail === 0) releaseFrom(state, p, 'jail'); return true; }
  if (p.hospital > 0) { p.hospital -= 1; if (p.hospital === 0) releaseFrom(state, p, 'hospital'); return true; }
  while (p.cards.length > p.handLimit) log(state, `${p.name} 回合开始弃掉 ${p.cards.pop()}`);
  state.phase = 'action';
  log(state, `—— 第 ${state.day} 天 · ${p.name} 的回合 ——`);
  return false;
}

function nextPlayer(state) {
  if (state.day >= state.config.dayLimit) { finishByAssets(state); return false; }
  const teams = new Set(state.players.filter(p => p.alive).map(p => p.team));
  if (teams.size <= 1) { finish(state, [...teams][0] ?? null); return false; }
  state.turn = (state.turn + 1) % state.order.length;
  return true;
}

function finishByAssets(state) {
  const teams = new Map();
  for (const p of state.players.filter(p => p.alive)) teams.set(p.team, (teams.get(p.team) ?? 0) + assetsOf(state, p));
  const top = [...teams.entries()].sort((a, b) => b[1] - a[1])[0];
  finish(state, top?.[0] ?? null);
}

function finish(state, team) {
  state.over = true;
  state.phase = 'over';
  state.winnerTeam = team ?? null;
  log(state, team ? `比赛结束：队伍 ${team} 获胜` : '比赛结束：无人生还');
}

async function playTurn(state, p, ui) {
  const diceCount = await actionPhase(state, p, ui);
  if (diceCount === null) return;
  let n;
  if (p.status === '乌龟') n = 1;
  else if (p.status === '冰冻') n = 0;
  else if (p.forcedDice != null) { n = p.forcedDice; p.forcedDice = null; }
  else n = Array.from({ length: diceCount }, () => 1 + state.rng.int(6)).reduce((a, b) => a + b, 0);
  state.phase = 'move';
  state.lastRoll = { playerId: p.id, value: n, path: [] };
  log(state, `${p.name} 掷出 ${n} 点`);
  const stopped = await movePhase(state, p, n, ui);
  if (state.over || !p.alive) return;
  if (!stopped) await landingPhase(state, p, ui);
  if (state.over || !p.alive) return;
  await groundPhase(state, p, ui);
  if (state.over || !p.alive) return;
  await postGodPhase(state, p, ui);
  if (state.over || !p.alive) return;
  await directionPhase(state, p, ui);
  ui.render(state);
}

async function actionPhase(state, p, ui) {
  state.phase = 'action';
  while (true) {
    ui.render(state);
    const a = await ui.ask({ type: 'action', player: p });
    if (!a) return null;
    if (a.action === 'roll') return Math.max(1, Math.min(TUNING.maxDice, 1 + Math.max(0, p.vehicle ?? 0), a.dice ?? 1));
    if (a.action === 'bank') { await bankFlow(state, p, ui, false); continue; }
    if (a.action === 'stock') { await stockFlow(state, p, ui); continue; }
    if (a.action === 'card') {
      const id = p.cards[a.index];
      if (!id || PASSIVE.has(id)) continue;
      if (id === 'remotedice') { if (await remoteDiceFlow(state, p, ui, a.index)) return null; continue; }
      let target = null;
      const def = CARD_DEFS[id];
      if (def.target !== 'self' && def.target !== 'all') {
        let opts = null;
        if (def.target === 'player') {
          opts = state.players.filter(q => q.alive && (q.id !== p.id || SELF_TARGET.has(id)) && (!TARGET_RANGE_5.has(id) || (id === 'turn' && p.talents.includes('turn_card_infinite')) || q.position === p.position || pathWithin(state.map, p.position, q.position, 5)));
        }
        target = await ui.ask({ type: 'target', player: p, cardId: id, kind: def.target, players: opts, max: def.target === 'cell' ? (id === 'robotdoll' ? 10 : 5) : null });
        if (!target) continue;
      }
      useCard(state, a.index, target);
      continue;
    }
  }
}

async function rollPhase() {}

async function movePhase(state, p, steps, ui) {
  const path = [];
  let cameFrom = p.lastNode;
  for (let i = 0; i < steps; i++) {
    const next = nextStep(state, p, cameFrom, i === 0);
    if (!next) break;
    cameFrom = p.position;
    p.position = next;
    p.lastNode = cameFrom;
    p.facing = nextForward(state, next, cameFrom);
    path.push(next);
    state.lastRoll.path = path;
    if (next === state.map.startId) { p.cash += TUNING.salary; log(state, `${p.name} 经过起点 +${TUNING.salary}`); }
    if (await passPhase(state, p, next, ui, i === steps - 1)) return true;
    if (!p.alive) return true;
  }
  return false;
}

function nextStep(state, p, cameFrom, first) {
  const adj = buildAdj(state.map);
  const exits = adj[p.position].filter(e => edgeUsable(state.map, state.day, e));
  let choices = exits.filter(e => e.to !== cameFrom);
  if (!choices.length) choices = exits;
  if (!choices.length) return null;
  if (first && p.facing && choices.some(e => e.to === p.facing)) return p.facing;
  return state.rng.pick(choices).to;
}

function nextForward(state, pos, cameFrom) {
  const adj = buildAdj(state.map);
  const exits = adj[pos].filter(e => edgeUsable(state.map, state.day, e));
  const forward = exits.filter(e => e.to !== cameFrom);
  return (forward[0] ?? exits[0])?.to ?? null;
}

async function passPhase(state, p, cellId, ui, isLast) {
  if (!isLast) {
    const occ = state.placements[cellId];
    if (occ && !['god', 'dog', 'beggar', 'merchant'].includes(occ.kind)) {
      await triggerObstacle(state, p, cellId, occ, ui);
      if (!p.alive) return true;
    }
    const node = state.map.nodes.find(n => n.id === cellId);
    if (node.kind === 'card') { addCard(state, p, randomCard(state.rng)); log(state, `${p.name} 经过卡片格，获得 1 张卡`); }
    if (node.kind === 'bank') { await bankFlow(state, p, ui, true); }
    if (node.kind === 'lottery') { await lotteryFlow(state, p, ui); }
  }
  return false;
}

async function triggerObstacle(state, p, cellId, occ, ui) {
  delete state.placements[cellId];
  if (occ.kind === 'god') { attachGod(state, p, occ.name); return; }
  if (occ.kind === 'dog') { await dogEffect(state, p); return; }
  if (occ.kind === 'beggar') { if (!p.talents.includes('immune_beggar_dog')) pay(state, p, null, TUNING.beggarAsk, '乞丐'); return; }
  const hurt = { mine: TUNING.mineDamage, dynamite: TUNING.bombDamage }[occ.kind];
  if (hurt) { if (!pay(state, p, null, hurt, occ.kind)) state.stats.bankruptcies += 1; }
  else if (occ.kind === 'timebomb') { p.god = '定时炸弹'; p.godDays = 30; }
  else if (occ.kind === 'jelly') { log(state, `${p.name} 碰到果冻墙，被弹开`); }
  else { p.skipTurns += 1; log(state, `${p.name} 碰到${occ.kind}，停留 1 回合`); }
}

async function dogEffect(state, p) {
  if (p.vehicle || p.talents.includes('immune_beggar_dog')) { log(state, `${p.name} 躲过了野狗`); return; }
  if (state.rng.float() < 0.5) { p.hospital = TUNING.hospitalTurns; p.position = state.map.facility?.hospital ?? p.position; log(state, `${p.name} 被野狗咬伤，住院 ${p.hospital} 回合`); }
  else { log(state, `${p.name} 被野狗咬，损失 ${TUNING.dogFine}`); pay(state, p, null, TUNING.dogFine, '野狗'); }
}

async function landingPhase(state, p, ui) {
  const cell = state.map.nodes.find(n => n.id === p.position);
  if (!cell) return;
  log(state, `${p.name} 停在 ${cell.label}`);
  const occ = state.placements[cell.id];
  if (occ) {
    if (occ.kind === 'god' || occ.kind === 'dog' || occ.kind === 'beggar') await triggerObstacle(state, p, cell.id, occ, ui);
    else if (occ.kind === 'merchant') { delete state.placements[cell.id]; await merchantFlow(state, p, ui); }
    else if (!['god','dog','beggar','merchant'].includes(occ.kind)) await triggerObstacle(state, p, cell.id, occ, ui);
  }
  if (!p.alive) return;
  switch (cell.kind) {
    case 'card': addCard(state, p, randomCard(state.rng)); log(state, `${p.name} 停在卡片格，获得 1 张卡`); break;
    case 'tax': { const amount = Math.round(p.cash * TUNING.taxRate); log(state, `${p.name} 纳税 ${amount}`); pay(state, p, null, amount, '纳税'); break; }
    case 'god': { const gods = ['财神','穷神','福神','衰神','天使','恶魔','土地公','糊涂神','武神','凶神']; attachGod(state, p, state.rng.pick(gods)); break; }
    case 'dog': await dogEffect(state, p); break;
    case 'beggar': if (!p.talents.includes('immune_beggar_dog')) pay(state, p, null, TUNING.beggarAsk, '乞丐'); break;
    case 'hospitalGate': case 'hospital': p.hospital = TUNING.hospitalTurns; p.position = state.map.facility?.hospital ?? p.position; log(state, `${p.name} 住院 ${p.hospital} 回合`); break;
    case 'jailGate': case 'jail': p.jail = TUNING.jailTurns; p.position = state.map.facility?.jail ?? p.position; log(state, `${p.name} 入狱 ${p.jail} 回合`); break;
    case 'event': { const delta = state.rng.pick([-10_000,-5_000,5_000,10_000,20_000]); p.cash = Math.max(0, p.cash + delta); log(state, `${p.name} 遇到事件，现金 ${delta >= 0 ? '+' : ''}${delta}`); break; }
    case 'teleport': { const walkable = state.map.nodes.filter(n => n.kind !== 'teleport' && n.kind !== 'platform'); p.position = state.rng.pick(walkable).id; log(state, `${p.name} 被随机传送到 ${p.position}`); break; }
    case 'bank': await bankFlow(state, p, ui, false); break;
    case 'lottery': await lotteryFlow(state, p, ui); break;
    case 'shop': await shopFlow(state, p, ui, 'shop'); break;
    case 'magic': await magicFlow(state, p, ui); break;
    case 'news': runNewsEvent(state, p); break;
    default: break;
  }
}

async function groundPhase(state, p, ui) {
  const cell = state.map.nodes.find(n => n.id === p.position);
  if (!cell) return;
  const ids = cell.adjacentPlots ?? [];
  for (const id of ids) {
    const plot = state.map.plots.find(x => x.id === id);
    const pr = state.properties[id];
    if (!pr || !pr.ownerId) {
      if (await ui.ask({ type: 'buy', player: p, plot, price: buyPrice(state, id) })) buyPlot(state, p, id, plot);
      continue;
    }
    if (pr.ownerId === p.id) {
      if (pr.big && !pr.bigType) {
        const type = await ui.ask({ type: 'chooseBig', player: p, plot });
        if (type) chooseBig(state, p, id, type);
      } else if (pr.level < TUNING.maxLevel) {
        if (await ui.ask({ type: 'build', player: p, plot, cost: buildCost(pr.level) })) buildPlot(state, p, id);
      }
      continue;
    }
    const owner = state.players.find(q => q.id === pr.ownerId);
    if (owner?.team === p.team || pr.bigType === 'park' || p.god === '财神') continue;
    let rent = rentFor(state, id);
    if (pr.bigType === 'commercial') rent = Math.round(rent * (1 + state.rng.float() * 2));
    if (pr.bigType === 'hotel') { rent = Math.round(rent * 0.6); p.skipTurns += 1; }
    if (p.talents.includes('rent_taken_down')) rent = Math.round(rent * 0.8);
    if (owner?.talents.includes('rent_dealt_up')) rent = Math.round(rent * 1.2);
    if (p.properties.some(x => state.properties[x]?.bigType === 'realestate')) rent = Math.round(rent * 0.7);
    if (p.god === '穷神') rent *= 2;
    if (owner?.isBoss) rent = Math.round(rent * (owner.bossId === 'bear' || owner.bossId === 'yuanyuan' ? 1.5 : 1));
    log(state, `${p.name} 向 ${owner.name} 支付租金 ${rent}`);
    state.stats.rents += rent;
    if (!pay(state, p, owner, rent, '租金')) state.stats.bankruptcies += 1;
    if (!p.alive) return;
  }
}

export function buyPlot(state, p, id, plot) {
  if (p.cash < buyPrice(state, id)) return;
  p.cash -= buyPrice(state, id);
  const old = state.properties[id];
  p.properties.push(id);
  state.properties[id] = { ownerId: p.id, level: old?.level ?? 0, street: plot?.street ?? null, big: !!plot?.big, bigType: old?.bigType ?? null };
  log(state, `${p.name} 买下 ${plot?.big ? '大空地' : '小地产'}`);
}

export function buildPlot(state, p, id) {
  const pr = state.properties[id]; const plot = state.map.plots.find(x => x.id === id);
  const cost = buildCost(pr.level);
  if (!pr || p.cash < cost || pr.level >= TUNING.maxLevel) return;
  p.cash -= cost; pr.level += 1;
  log(state, `${p.name} 将 ${plot?.big ? '大空地' : '小地产'} 升到 Lv.${pr.level}（花费 ${cost}）`);
}

function chooseBig(state, p, id, type) {
  const pr = state.properties[id];
  if (!pr || pr.ownerId !== p.id || !['commercial','hotel','bookstore','energy','realestate','research'].includes(type)) return;
  pr.bigType = type; pr.level = 1;
  log(state, `${p.name} 建起 ${BIG_NAMES[type]}`);
}

async function postGodPhase(state, p, ui) {
  const cell = state.map.nodes.find(n => n.id === p.position);
  const ids = cell?.adjacentPlots ?? [];
  const upgraded = [];
  if (p.god === '福神' || p.god === '天使') {
    for (const id of ids) {
      const pr = state.properties[id]; const plot = state.map.plots.find(x => x.id === id);
      if (!pr || !plot) continue;
      if (p.god === '福神' && pr.ownerId !== p.id) continue;
      if (plot.big) {
        if (pr.ownerId === p.id && !pr.bigType) {
          const type = await ui.ask({ type: 'chooseBig', player: p, plot });
          if (type) chooseBig(state, p, id, type);
        }
        continue;
      }
      if (pr.level < TUNING.maxLevel && (pr.ownerId === p.id || p.god === '天使')) { pr.level += 1; upgraded.push(id); log(state, `${p.god}让 ${labelForPlot(state,id)} 免费加盖 1 层`); }
    }
  }
  if (p.god === '土地公') {
    for (const id of ids) {
      const plot = state.map.plots.find(x => x.id === id);
      const pr = state.properties[id] ?? { level: 0, street: plot?.street ?? null, big: !!plot?.big, bigType: null };
      if (pr.ownerId === p.id) continue;
      const old = state.players.find(q => q.id === pr.ownerId);
      if (old) old.properties = old.properties.filter(x => x !== id);
      pr.ownerId = p.id; state.properties[id] = pr; p.properties.push(id);
    }
    if (ids.length) log(state, `${p.name} 的土地公收走了相邻地产`);
  }
  if (p.god === '凶神') {
    for (const id of upgraded) { const pr = state.properties[id]; if (pr && pr.ownerId === p.id && !pr.big && pr.level > 0) pr.level -= 1; }
  }
}

async function directionPhase(state, p, ui) {
  const adj = buildAdj(state.map);
  if (adj[p.position].length < 3) return;
  const opts = adj[p.position].map(e => e.to).filter(id => id !== p.lastNode);
  if (!opts.length) return;
  const to = await ui.ask({ type: 'direction', player: p, options: opts });
  if (to) p.facing = to;
}

async function bankFlow(state, p, ui, fromPass) {
  while (true) {
    const a = await ui.ask({ type: 'bank', player: p, fromPass });
    if (!a || a.action === 'leave') return;
    const amount = Math.max(0, Math.round(a.amount ?? 0));
    if (a.action === 'deposit' && p.cash >= amount) { p.cash -= amount; p.deposit += amount; log(state, `${p.name} 存入 ${amount}`); }
    if (a.action === 'withdraw' && p.deposit >= amount) { p.deposit -= amount; p.cash += amount; log(state, `${p.name} 取出 ${amount}`); }
  }
}

async function stockFlow(state, p, ui) {
  while (true) {
    const a = await ui.ask({ type: 'stock', player: p });
    if (!a || a.action === 'leave') return;
    const s = state.stocks.find(x => x.id === a.stockId); if (!s) continue;
    const qty = Math.max(1, Math.floor(a.qty ?? 10));
    if (a.action === 'buy') { const cost = Math.round(s.price * qty); if (p.cash >= cost) { p.cash -= cost; p.stocks = p.stocks ?? {}; p.stocks[s.id] = (p.stocks[s.id] ?? 0) + qty; } }
    if (a.action === 'sell') { const held = p.stocks?.[s.id] ?? 0; const n = Math.min(qty, held); if (n > 0) { p.stocks[s.id] -= n; p.cash += Math.round(s.price * n); } }
  }
}

async function lotteryFlow(state, p, ui) {
  const a = await ui.ask({ type: 'lottery', player: p });
  if (!a || a.action === 'leave') return;
  const n = Number(a.number);
  if (!Number.isInteger(n) || n < 1 || n > 30 || state.lottery.sold.includes(n) || p.cash < TUNING.lotteryTicket) return lotteryFlow(state, p, ui);
  p.cash -= TUNING.lotteryTicket;
  state.lottery.tickets.push({ playerId: p.id, number: n });
  state.lottery.sold.push(n);
  log(state, `${p.name} 买下乐透 ${n}（${TUNING.lotteryTicket}）`);
}

async function shopFlow(state, p, ui, kind) {
  state.shopOffer = kind === 'shop' ? makeOffer(state, 9, [1_000, 2_000, 3_000, 4_000]) : makeOffer(state, 6, [1_000]);
  const limit = kind === 'shop' ? 3 : 2;
  let bought = 0;
  while (bought < limit) {
    const a = await ui.ask({ type: kind, player: p, offers: state.shopOffer, bought, limit });
    if (!a || a.action === 'leave') return;
    const item = state.shopOffer[a.index]; if (!item) continue;
    const price = kind === 'shop' ? Math.round(item.price * (p.talents.includes('shop_discount') ? 0.5 : 1)) : item.price;
    if (p.cash < price) continue;
    p.cash -= price; addCard(state, p, item.id); state.shopOffer.splice(a.index, 1); bought += 1;
    if (p.talents.includes('shop_extra_card')) addCard(state, p, randomCard(state.rng));
    log(state, `${p.name} 花 ${price} 买到 ${CARD_DEFS[item.id].name}（${bought}/${limit}）`);
  }
}

async function merchantFlow(state, p, ui) { return shopFlow(state, p, ui, 'merchant'); }

async function magicFlow(state, p, ui) {
  const a = await ui.ask({ type: 'magic', player: p });
  if (!a) return;
  const others = state.players.filter(q => q.alive && q.id !== p.id);
  if (a.effect === 'money') p.cash += 10_000;
  if (a.effect === 'lose' && others.length) pay(state, state.rng.pick(others), null, 10_000, '魔法屋');
  if (a.effect === 'card') addCard(state, p, randomCard(state.rng));
  if (a.effect === 'jail' && others.length) { const q = state.rng.pick(others); q.jail = TUNING.jailTurns; q.position = state.map.facility?.jail ?? q.position; }
  log(state, `${p.name} 使用魔法屋：${a.effect}`);
}

async function remoteDiceFlow(state, p, ui, index) {
  const max = (1 + Math.max(0, p.vehicle ?? 0)) * 6;
  const target = await ui.ask({ type: 'target', player: p, cardId: 'remotedice', kind: 'cell', max });
  if (!target) return false;
  const path = pathWithin(state.map, p.position, target, max);
  if (!path || !path.length) return false;
  p.cards.splice(index, 1);
  for (const id of path) {
    p.lastNode = p.position; p.position = id;
    if (id === state.map.startId) p.cash += TUNING.salary;
    const node = state.map.nodes.find(n => n.id === id);
    if (node.kind === 'bank') await bankFlow(state, p, ui, true);
    if (node.kind === 'lottery') await lotteryFlow(state, p, ui);
    if (!p.alive) return true;
  }
  await landingPhase(state, p, ui);
  await groundPhase(state, p, ui);
  await postGodPhase(state, p, ui);
  await directionPhase(state, p, ui);
  return true;
}

function labelForPlot(state, id) {
  const pr = state.properties[id];
  const plot = state.map.plots.find(x => x.id === id);
  if (!plot) return id;
  if (plot.big) return pr?.bigType ? BIG_NAMES[pr.bigType] : '大空地';
  return '小地产';
}
