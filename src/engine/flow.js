// 异步回合引擎：一个游戏循环，按阶段 await；回合只在流程自然结束后推进。
import { TUNING } from '../data/tuning.js';
import { buildAdj, edgeUsable, isPlatformActive, nearestStable, pathWithin } from './board-v2.js';
import { rentFor, buyPrice, buildCost, assetsOf, pay, log } from './economy.js';
import {
  createGame, current, addCard, randomCard, CARD_DEFS, BIG_NAMES,
  useCard, applyCard, attachGod, makeOffer, drawLottery, tickStocks, TARGET_RANGE_5, SELF_TARGET, PASSIVE,
  applyMonthly, tickGod, tickTimers, spawnOccupants, releaseFrom, runNewsEvent,
} from './game.js';

const GROUND_CARDS = new Set(['buyland', 'exchange', 'rebuild', 'worker', 'truck']);
const STREET_CARDS = new Set(['close', 'inflate']);
const range5 = new Set(['turtle', 'turn', 'stay', 'sleep', 'hibernate', 'equalpoor', 'pick', 'scheme', 'magic', 'sendgod', 'samefate', 'start']);

export function startSession(config) {
  const state = createGame(config);
  state.day = 1;
  state.phase = 'action';
  return state;
}

export async function runGame(state, ui) {
  while (!state.over) {
    const p = current(state);
    const skipped = beginTurn(state, p);
    ui.render(state);
    if (!skipped) await playTurn(state, p, ui);
    if (state.over) break;
    endPlayerTurn(state, p);
    if (!nextPlayer(state)) break;
  }
}

function beginTurn(state, p) {
  if (!p || !p.alive) return true;
  state.phase = 'action';
  if (p.statusDays > 0 && (p.status === '梦游' || p.status === '冬眠')) {
    log(state, `${p.name} 正在${p.status}，跳过本回合`);
    return true;
  }
  if (p.jail > 0) { log(state, `${p.name} 在监狱中，跳过本回合`); return true; }
  if (p.hospital > 0) { log(state, `${p.name} 在医院中，跳过本回合`); return true; }
  if (p.skipTurns > 0) { log(state, `${p.name} 停留，跳过本回合`); return true; }
  while (p.cards.length > p.handLimit) log(state, `${p.name} 回合开始弃掉 ${p.cards.pop()}`);
  log(state, `—— 第 ${state.day} 天 · ${p.name} 的回合 ——`);
  return false;
}

function endPlayerTurn(state, p) {
  if (!p) return;
  if (p.statusDays > 0) {
    p.statusDays -= 1;
    if (p.statusDays <= 0) { log(state, `${p.name} 的 ${p.status} 状态结束`); p.status = null; }
  }
  tickGod(state, p);
  if (p.jail > 0) { p.jail -= 1; if (p.jail === 0) releaseFrom(state, p, 'jail'); }
  if (p.hospital > 0) { p.hospital -= 1; if (p.hospital === 0) releaseFrom(state, p, 'hospital'); }
  if (p.skipTurns > 0) p.skipTurns -= 1;
}

function advanceDay(state) {
  state.day += 1;
  if ((state.day - 1) % TUNING.priceIndexEveryDays === 0) {
    state.priceIndex = +(state.priceIndex + TUNING.priceIndexStep).toFixed(2);
    log(state, `物价指数上涨到 ${state.priceIndex.toFixed(2)}`);
  }
  for (const p of state.players) if (p.alive) applyMonthly(state, p);
  tickStocks(state);
  drawLottery(state);
  spawnOccupants(state);
  tickTimers(state);
}

function nextPlayer(state) {
  const last = state.turn === state.order.length - 1;
  if (last) advanceDay(state);
  if (state.day > state.config.dayLimit) { finishByAssets(state); return false; }
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
  const stay = !!p.skipMove;
  if (stay) p.skipMove = 0;
  let n;
  if (stay) n = 0;
  else if (p.status === '乌龟') n = 1;
  else if (p.status === '冰冻') n = 0;
  else if (p.forcedDice != null) { n = p.forcedDice; p.forcedDice = null; }
  else n = Array.from({ length: diceCount }, () => 1 + state.rng.int(6)).reduce((a, b) => a + b, 0);
  state.phase = 'move';
  state.lastRoll = { playerId: p.id, value: n, path: [] };
  log(state, stay ? `${p.name} 停留，本回合移动 0 步` : `${p.name} 掷出 ${n} 点`);
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
        const kind = GROUND_CARDS.has(id) || id === 'monster' ? 'plot' : (STREET_CARDS.has(id) ? 'street' : def.target);
        let opts = null;
        if (kind === 'player') {
          opts = state.players.filter(q => q.alive && (q.id !== p.id || SELF_TARGET.has(id)) && (!TARGET_RANGE_5.has(id) || (id === 'turn' && p.talents.includes('turn_card_infinite')) || q.position === p.position || pathWithin(state.map, p.position, q.position, 5)));
        }
        target = await ui.ask({ type: 'target', player: p, cardId: id, kind, players: opts, max: kind === 'cell' ? (id === 'robotdoll' ? 10 : 5) : null });
        if (!target) continue;
      }
      if (id === 'turn') {
        const q = state.players.find(x => x.id === target);
        if (!q) continue;
        const adj = buildAdj(state.map);
        const exits = adj[q.position].map(e => e.to);
        if (adj[q.position].length >= 3) {
          const options = exits.filter(x => x !== q.facing);
          if (options.length) {
            const to = await ui.ask({ type: 'direction', player: q, options });
            if (!to) continue;
            q.facing = to;
          } else q.facing = q.lastNode;
        } else {
          q.facing = exits.find(x => x !== q.facing) ?? q.lastNode;
        }
        p.cards.splice(a.index, 1);
        log(state, `${p.name} 使用 转向卡：${q.name} 被强制转向`);
        continue;
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
    p.facing = next;
    path.push(next);
    state.lastRoll.path = path;
    if (next === state.map.startId) { p.cash += TUNING.salary; log(state, `${p.name} 经过起点 +${TUNING.salary}`); }
    if (ui.step) await ui.step(state, p, next);
    if (await passPhase(state, p, next, ui, i === steps - 1)) return true;
    if (!p.alive || p.jail > 0 || p.hospital > 0) return true;
  }
  return false;
}

function nextStep(state, p, cameFrom, first) {
  const adj = buildAdj(state.map);
  const exits = adj[p.position].filter(e => edgeUsable(state.map, state.day, e));
  if (!exits.length) return null;
  let choices = exits.filter(e => e.to !== cameFrom);
  if (!choices.length) choices = exits;
  if (exits.length <= 1) return exits[0].to;
  if (exits.length === 2) {
    if (first && p.facing && exits.some(e => e.to === p.facing)) return p.facing;
    const forward = choices.find(e => e.to === p.facing) ?? choices[0] ?? exits[0];
    return forward.to;
  }
  if (first && p.facing && choices.some(e => e.to === p.facing)) return p.facing;
  return state.rng.pick(choices).to;
}

function portalDestination(state, from) {
  const portals = state.map.nodes.filter(n => n.kind === 'teleport' && n.id !== from);
  return portals.length ? state.rng.pick(portals).id : null;
}

function faceRandom(state, p) {
  const adj = buildAdj(state.map);
  const exits = adj[p.position] ?? [];
  if (exits.length) p.facing = state.rng.pick(exits).to;
}

async function passPhase(state, p, cellId, ui, isLast) {
  if (!isLast) {
    const occ = state.placements[cellId];
    if (occ && !['god', 'dog', 'beggar', 'merchant', 'banana'].includes(occ.kind)) {
      await triggerObstacle(state, p, cellId, occ, ui);
      if (!p.alive || p.jail > 0 || p.hospital > 0 || p.skipTurns > 0) return true;
    }
    const node = state.map.nodes.find(n => n.id === cellId);
    if (node.kind === 'card') { addCard(state, p, randomCard(state.rng)); log(state, `${p.name} 经过卡片格，获得 1 张卡`); }
    if (node.kind === 'bank') { await bankFlow(state, p, ui, true); }
    if (node.kind === 'lottery') { await lotteryFlow(state, p, ui); }
    if (node.kind === 'teleport') { const to = portalDestination(state, cellId); if (to) { p.position = to; faceRandom(state, p); log(state, `${p.name} 经过传送门，被传送到 ${to}`); } }
  }
  if (isLast) {
    const node = state.map.nodes.find(n => n.id === cellId);
    if (node?.kind === 'teleport') {
      const to = portalDestination(state, cellId);
      if (to) { p.position = to; faceRandom(state, p); log(state, `${p.name} 经过传送门，被传送到 ${to}`); }
    }
  }
  return false;
}

async function triggerObstacle(state, p, cellId, occ, ui) {
  delete state.placements[cellId];
  if (occ.kind === 'god') { attachGod(state, p, occ.name); return; }
  if (occ.kind === 'dog') { await dogEffect(state, p); return; }
  if (occ.kind === 'beggar') { if (!p.talents.includes('immune_beggar_dog')) pay(state, p, null, TUNING.beggarAsk, '乞丐'); return; }
  const hurt = { mine: TUNING.mineDamage, dynamite: TUNING.bombDamage }[occ.kind];
  if (hurt) {
    if (!pay(state, p, null, hurt, occ.kind)) state.stats.bankruptcies += 1;
    if (p.alive) { p.hospital = TUNING.hospitalTurns; p.position = state.map.facility?.hospital ?? p.position; log(state, `${p.name} 被炸伤住院 ${p.hospital} 天`); }
  }
  else if (occ.kind === 'timebomb') { p.god = '定时炸弹'; p.godDays = 30; }
  else if (occ.kind === 'jelly') { p.bounceSteps = 2; log(state, `${p.name} 碰到果冻墙，被弹回 2 格`); }
  else if (occ.kind === 'banana') {
    const adj = buildAdj(state.map);
    const exits = adj[p.position] ?? [];
    const forward = exits.find(e => e.to === p.facing) ?? exits[0];
    if (forward) { p.position = forward.to; p.lastNode = cellId; }
    log(state, `${p.name} 踩到香蕉皮，向前滑 1 格`);
  }
  else if (occ.kind === 'roadblock' || occ.kind === 'trap') { p.skipTurns += 1; log(state, `${p.name} 碰到${occ.kind}，停止移动`); }
  else { p.skipTurns += 1; log(state, `${p.name} 碰到${occ.kind}，停留 1 天`); }
}

async function dogEffect(state, p) {
  if (p.vehicle || p.talents.includes('immune_beggar_dog')) { log(state, `${p.name} 躲过了野狗`); return; }
  p.hospital = TUNING.hospitalTurns;
  p.position = state.map.facility?.hospital ?? p.position;
  log(state, `${p.name} 被野狗咬伤，住院 ${p.hospital} 天`);
}

async function landingPhase(state, p, ui) {
  let cell = state.map.nodes.find(n => n.id === p.position);
  if (!cell) return;
  log(state, `${p.name} 停在 ${cell.label}`);
  const occ = state.placements[cell.id];
  if (occ) {
    if (occ.kind === 'god' || occ.kind === 'dog' || occ.kind === 'beggar') await triggerObstacle(state, p, cell.id, occ, ui);
    else if (occ.kind === 'merchant') { delete state.placements[cell.id]; await merchantFlow(state, p, ui); }
    else if (!['god','dog','beggar','merchant'].includes(occ.kind)) await triggerObstacle(state, p, cell.id, occ, ui);
  }
  if (!p.alive || p.jail > 0 || p.hospital > 0) return;
  if (p.position !== cell.id) {
    cell = state.map.nodes.find(n => n.id === p.position);
    if (!cell) return;
  }
  switch (cell.kind) {
    case 'card': addCard(state, p, randomCard(state.rng)); log(state, `${p.name} 停在卡片格，获得 1 张卡`); break;
    case 'tax': { const amount = Math.min(50_000, Math.max(5_000, Math.round(p.cash * TUNING.taxRate))); log(state, `${p.name} 纳税 ${amount}`); pay(state, p, null, amount, '纳税'); break; }
    case 'god': { const gods = ['财神','穷神','福神','衰神','天使','恶魔','土地公','糊涂神','武神','凶神']; attachGod(state, p, state.rng.pick(gods)); break; }
    case 'dog': await dogEffect(state, p); break;
    case 'beggar': if (!p.talents.includes('immune_beggar_dog')) pay(state, p, null, TUNING.beggarAsk, '乞丐'); break;
    case 'hospitalGate': case 'hospital': p.hospital = TUNING.hospitalTurns; p.position = state.map.facility?.hospital ?? p.position; log(state, `${p.name} 住院 ${p.hospital} 回合`); break;
    case 'jailGate': case 'jail': p.jail = TUNING.jailTurns; p.position = state.map.facility?.jail ?? p.position; log(state, `${p.name} 入狱 ${p.jail} 回合`); break;
    case 'event': runNewsEvent(state, p); break;
    case 'teleport': break;
    case 'bank': await bankFlow(state, p, ui, false); break;
    case 'lottery': await lotteryFlow(state, p, ui); break;
    case 'shop': await shopFlow(state, p, ui, 'shop'); break;
    case 'research': await shopFlow(state, p, ui, 'research'); break;
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
    const owner = state.players.find(q => q.id === pr.ownerId);
    if (owner?.team === p.team) {
      if (pr.big && !pr.bigType) {
        const type = await ui.ask({ type: 'chooseBig', player: p, plot });
        if (type) chooseBig(state, p, id, type);
      } else if (pr.level < TUNING.maxLevel) {
        const cost = pr.big ? 30_000 * state.priceIndex : buildCost(pr.level) * state.priceIndex;
        if (await ui.ask({ type: 'build', player: p, plot, cost })) buildPlot(state, p, id);
      }
      continue;
    }
    if (pr.bigType === 'park' || p.god === '财神') continue;
    let rent = rentFor(state, id);
    if (pr.bigType === 'commercial') rent = Math.round(3_000 * pr.level * state.priceIndex * (1 + state.rng.int(6)));
    if (pr.bigType === 'hotel') { rent = Math.round(1_000 * pr.level * state.priceIndex); p.skipTurns += 2; }
    const realestate = p.properties.map(x => state.properties[x]).find(x => x?.bigType === 'realestate');
    if (realestate) rent = Math.round(rent * Math.max(0.5, 1 - 0.1 * realestate.level));
    if (p.talents.includes('rent_taken_down')) rent = Math.round(rent * 0.8);
    if (owner?.talents.includes('rent_dealt_up')) rent = Math.round(rent * 1.2);
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
  if (!pr || pr.level >= TUNING.maxLevel) return;
  const cost = Math.round((pr.big ? 30_000 : buildCost(pr.level)) * state.priceIndex);
  if (p.cash < cost) return;
  p.cash -= cost; pr.level += 1;
  log(state, `${p.name} 将 ${plot?.big ? '大空地' : '小地产'} 升到 Lv.${pr.level}（花费 ${cost}）`);
}

function chooseBig(state, p, id, type, free = false) {
  const pr = state.properties[id];
  const owner = pr ? state.players.find(q => q.id === pr.ownerId) : null;
  if (!pr || owner?.team !== p.team || !['commercial','hotel','bookstore','energy','realestate','research'].includes(type)) return;
  const cost = free ? 0 : Math.round(30_000 * state.priceIndex);
  if (p.cash < cost) return;
  p.cash -= cost;
  pr.bigType = type; pr.level = 1;
  log(state, `${p.name} 建起 ${BIG_NAMES[type]}${cost ? `（花费 ${cost}）` : '（免费）'}`);
}

async function postGodPhase(state, p, ui) {
  const cell = state.map.nodes.find(n => n.id === p.position);
  const ids = cell?.adjacentPlots ?? [];
  const upgraded = [];
  if (p.god === '福神' || p.god === '天使') {
    for (const id of ids) {
      const pr = state.properties[id]; const plot = state.map.plots.find(x => x.id === id);
      if (!pr || !plot) continue;
      const owner = state.players.find(q => q.id === pr.ownerId);
      if (p.god === '福神' && owner?.team !== p.team) continue;
      if (plot.big) {
        if (owner?.team === p.team && !pr.bigType) {
          const type = await ui.ask({ type: 'chooseBig', player: p, plot });
          if (type) chooseBig(state, p, id, type, true);
        }
        continue;
      }
      if (pr.level < TUNING.maxLevel && (owner?.team === p.team || p.god === '天使')) { pr.level += 1; upgraded.push(id); log(state, `${p.god}让 ${labelForPlot(state,id)} 免费加盖 1 层`); }
    }
  }
  if (p.god === '土地公') {
    for (const id of ids) {
      const plot = state.map.plots.find(x => x.id === id);
      const pr = state.properties[id] ?? { level: 0, street: plot?.street ?? null, big: !!plot?.big, bigType: null };
      const owner = state.players.find(q => q.id === pr.ownerId);
      if (owner?.team === p.team) continue;
      const old = state.players.find(q => q.id === pr.ownerId);
      if (old) old.properties = old.properties.filter(x => x !== id);
      pr.ownerId = p.id; state.properties[id] = pr; p.properties.push(id);
    }
    if (ids.length) log(state, `${p.name} 的土地公收走了相邻地产`);
  }
  if (p.god === '凶神') {
    for (const id of upgraded) { const pr = state.properties[id]; if (pr && !pr.big && pr.level > 0) { const owner = state.players.find(q => q.id === pr.ownerId); if (owner?.team === p.team) pr.level -= 1; } }
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

async function bankFlow(state, p, ui) {
  const a = await ui.ask({ type: 'bank', player: p });
  if (!a || a.action === 'leave') return;
  const keep = Math.max(0, Math.min(p.cash, Math.round(a.keep ?? p.cash)));
  const deposit = p.cash - keep;
  p.cash = keep;
  p.deposit += deposit;
  log(state, `${p.name} 留下 ${keep} 现金，存入 ${deposit}`);
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
  state.shopOffer = makeOffer(state, kind === 'shop' ? 9 : 6, kind);
  const limit = kind === 'shop' ? 3 : 2;
  let bought = 0;
  while (bought < limit) {
    const a = await ui.ask({ type: kind, player: p, offers: state.shopOffer, bought, limit });
    if (!a || a.action === 'leave') return;
    const item = state.shopOffer[a.index]; if (!item) continue;
    const price = kind === 'shop' ? Math.round(item.price * (p.talents.includes('shop_discount') ? 0.7 : 1)) : item.price;
    if (p.cash < price) continue;
    p.cash -= price; addCard(state, p, item.id); state.shopOffer.splice(a.index, 1); bought += 1;
    if (p.talents.includes('shop_extra_card')) addCard(state, p, randomCard(state.rng));
    log(state, `${p.name} 花 ${price} 买到 ${CARD_DEFS[item.id].name}（${bought}/${limit}）`);
  }
}

async function merchantFlow(state, p, ui) { return shopFlow(state, p, ui, 'merchant'); }

const MAGIC_CONDITIONS = [
  { id: 'cashHigh', label: '现金最多', value: p => p.cash, max: true, apply: q => q.alive },
  { id: 'cashLow', label: '现金最少', value: p => p.cash, max: false, apply: q => q.alive },
  { id: 'depositHigh', label: '存款最多', value: p => p.deposit, max: true, apply: q => q.alive },
  { id: 'depositLow', label: '存款最少', value: p => p.deposit, max: false, apply: q => q.alive },
  { id: 'plotsHigh', label: '地产最多', value: p => p.properties.length, max: true, apply: q => q.alive },
  { id: 'plotsLow', label: '地产最少', value: p => p.properties.length, max: false, apply: q => q.alive },
  { id: 'male', label: '男性', test: q => q.gender === '男', apply: q => q.alive },
  { id: 'female', label: '女性', test: q => q.gender === '女', apply: q => q.alive },
  { id: 'driving', label: '正在驾驶载具', test: q => !!q.vehicle, apply: q => q.alive },
  { id: 'walking', label: '没有驾驶载具', test: q => !q.vehicle, apply: q => q.alive },
  { id: 'jailed', label: '在监狱', test: q => q.jail > 0, apply: q => q.alive },
  { id: 'notJailed', label: '不在监狱', test: q => q.jail <= 0, apply: q => q.alive },
  { id: 'hospitalized', label: '在医院', test: q => q.hospital > 0, apply: q => q.alive },
  { id: 'notHospitalized', label: '不在医院', test: q => q.hospital <= 0, apply: q => q.alive },
  { id: 'god', label: '身上有神仙', test: q => !!q.god, apply: q => q.alive },
  { id: 'noGod', label: '身上没有神仙', test: q => !q.god, apply: q => q.alive },
  { id: 'onPlot', label: '站在有主地产旁', test: q => (state.map.nodes.find(n => n.id === q.position)?.adjacentPlots ?? []).some(id => state.properties[id]?.ownerId), apply: q => q.alive },
  { id: 'offPlot', label: '没有站在有主地产旁', test: q => !(state.map.nodes.find(n => n.id === q.position)?.adjacentPlots ?? []).some(id => state.properties[id]?.ownerId), apply: q => q.alive },
];

function pickConditionTarget(state, p, filter = () => true) {
  const pool = state.rng.shuffle(MAGIC_CONDITIONS.filter(c => c.apply(p)));
  for (const cond of pool) {
    let candidates = state.players.filter(q => q.alive && filter(q) && (cond.test ? cond.test(q) : true));
    if (cond.value && !cond.test) {
      const vals = candidates.map(q => cond.value(q));
      const best = cond.max ? Math.max(...vals) : Math.min(...vals);
      candidates = candidates.filter(q => cond.value(q) === best);
    }
    if (candidates.length) return { cond, target: state.rng.pick(candidates) };
  }
  return null;
}

async function magicFlow(state, p, ui) {
  const options = [
    { id: 'god', name: '随机请神', desc: '随机对象获得地图上随机一位神仙' },
    { id: 'cards', name: '获得三张卡片', desc: '自己随机获得 3 张基础卡' },
    { id: 'destroy', name: '随机摧毁建筑', desc: '随机对象的一处建筑降一级' },
    { id: 'deposit', name: '全部存入银行', desc: '自己的现金全部转入存款' },
    { id: 'teleport', name: '随机传送', desc: '自己随机传送到空路面' },
    { id: 'punish', name: '立即住院或入狱', desc: '随机对象立即住院或入狱' },
  ];
  const a = await ui.ask({ type: 'magic', player: p, options });
  if (!a) return;
  if (a.id === 'cards') {
    for (let i = 0; i < 3; i++) addCard(state, p, randomCard(state.rng));
    log(state, `${p.name} 魔法屋获得 3 张卡`); return;
  }
  if (a.id === 'deposit') {
    const amount = p.cash; p.deposit += amount; p.cash = 0;
    log(state, `${p.name} 魔法屋把 ${amount} 现金全部存入银行`); return;
  }
  if (a.id === 'teleport') {
    const cells = state.map.nodes.filter(n => n.kind !== 'platform' && !state.placements[n.id]);
    if (cells.length) {
      p.position = state.rng.pick(cells).id;
      faceRandom(state, p);
      log(state, `${p.name} 被魔法屋传送到 ${p.position}`);
    }
    return;
  }
  if (a.id === 'destroy') {
    const picked = pickConditionTarget(state, p, q => q.properties.some(id => state.properties[id]?.level > 0));
    if (!picked) return;
    const { cond, target } = picked;
    const ids = target.properties.filter(id => state.properties[id]?.level > 0);
    const id = state.rng.pick(ids);
    const pr = state.properties[id]; pr.level = Math.max(0, pr.level - 1);
    log(state, `魔法屋按“${cond.label}”选中 ${target.name}，摧毁 ${labelForPlot(state, id)} 到 Lv.${pr.level}`);
    return;
  }
  if (a.id === 'punish') {
    const picked = pickConditionTarget(state, p);
    if (!picked) return;
    const { cond, target } = picked;
    if (state.rng.float() < 0.5) { target.hospital = TUNING.hospitalTurns; target.position = state.map.facility?.hospital ?? target.position; log(state, `魔法屋按“${cond.label}”选中 ${target.name}，住院`); }
    else { target.jail = TUNING.jailTurns; target.position = state.map.facility?.jail ?? target.position; log(state, `魔法屋按“${cond.label}”选中 ${target.name}，入狱`); }
    return;
  }
  if (a.id === 'god') {
    const picked = pickConditionTarget(state, p);
    if (!picked) return;
    const { cond, target } = picked;
    const onMap = Object.entries(state.placements).filter(([, o]) => o.kind === 'god');
    let name;
    if (onMap.length) { const [cell, occ] = state.rng.pick(onMap); name = occ.name; delete state.placements[cell]; }
    else name = state.rng.pick(['财神','穷神','福神','衰神','天使','恶魔','土地公','糊涂神','武神','凶神']);
    attachGod(state, target, name);
    log(state, `魔法屋按“${cond.label}”选中 ${target.name}，请来 ${name}`);
  }
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
