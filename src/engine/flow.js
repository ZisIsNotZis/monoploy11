// 异步回合引擎：一个游戏循环，按阶段 await；回合只在流程自然结束后推进。
import { TUNING } from '../data/tuning.js';
import { buildAdj, edgeUsable, isPlatformActive, nearestStable, pathWithin } from './board-v2.js';
import { rentFor, buyPrice, buildCost, assetsOf, pay, log, bossRentMultiplier, incomeBonus, cheapestBuyable, cheapestAcquirable } from './economy.js';
import { tickMap, mapExtraSteps, mapShopMultiplier } from './map-runtime.js';
import { SUPPLIES, SLICE_CARDS } from '../data/slice.js';
import { poolShareLine, roundsLine } from './payback.js';
import { sliceTargetIds } from './insight.js';
import {
  createGame, current, addCard, randomCard, CARD_DEFS, BIG_NAMES,
  useCard, applyCard, attachGod, makeOffer, drawLottery, tickStocks, TARGET_RANGE_5, SELF_TARGET, PASSIVE, cardRange,
  applyMonthly, tickGod, tickTimers, spawnOccupants, releaseFrom, runNewsEvent, bossInfiniteRange, ALL_GODS, drawBaseCard,
} from './game.js';

const GROUND_CARDS = new Set(['buyland', 'exchange', 'rebuild', 'worker', 'truck']);
const STREET_CARDS = new Set(['close', 'inflate']);
const RESPONSE_CARDS = new Set(['turtle','turn','stay','sleep','hibernate','scheme','missile','pick','audit','magic','sendgod','equalpoor']);
const SAME_CARDS = new Set(['sleep','hibernate','scheme']);
const TRANSFER_CARDS = new Set(['scheme','missile','equalpoor']);

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
  if(state.slice)state.slice.turnStart=null;
  if (!p || !p.alive) return true;
  state.phase = 'action';
  p.aiUsedCard = false;
  if(state.slice) { p.sliceCardsUsed=0; state.slice.turnStart={playerId:p.id,day:state.day,cash:p.cash,deposit:p.deposit,assets:assetsOf(state,p),log:state.log.at(-1)}; }
  p.builtThisTurn = [];
  if (p.statusDays > 0 && (p.status === '梦游' || p.status === '冬眠')) {
    log(state, `${p.name} 正在${p.status}，跳过本回合`);
    return true;
  }
  if (p.jail > 0) {
    p.jail -= 1;
    if (p.jail === 0) releaseFrom(state, p, 'jail');
    log(state, `${p.name} 在监狱中，跳过本回合`);
    return true;
  }
  if (p.hospital > 0) {
    p.hospital -= 1;
    if (p.hospital === 0) releaseFrom(state, p, 'hospital');
    log(state, `${p.name} 在医院中，跳过本回合`);
    return true;
  }
  if (p.skipTurns > 0) { p.skipTurns -= 1; log(state, `${p.name} 停留，跳过本回合`); return true; }
  if(!state.slice) while (p.cards.length > p.handLimit) log(state, `${p.name} 回合开始弃掉 ${p.cards.pop()}`);
  log(state, `—— 第 ${state.day} 天 · ${p.name} 的回合 ——`);
  return false;
}

function endPlayerTurn(state, p) {
  if (!p) return;
  if (p.dirModeOwner === p.id) { p.dirMode = null; p.dirModeOwner = null; }
  if (p.statusDays > 0) {
    p.statusDays -= 1;
    if (p.statusDays <= 0) { log(state, `${p.name} 的 ${p.status} 状态结束`); p.status = null; }
  }
  tickGod(state, p);
  if(state.slice?.turnStart) {
    const before=state.slice.turnStart;
    const report={playerId:p.id,name:p.name,day:before.day,money:p.cash+p.deposit-before.cash-before.deposit,assets:assetsOf(state,p)-before.assets,
      cardsPlayed:p.sliceCardsUsed??0,lines:state.log.slice(state.log.indexOf(before.log)+1).map(l=>l.text)};
    state.slice.history.push(report); p.lastTurn=report;
  }
  // #646：记一次全场绝对资产快照，供离场屏指出「哪一天开始落后」。
  // 只读 assetsOf，不写 money/cash，不改结算顺序。同一天只留最末一条（当天结束时的事实）。
  if (state.slice) {
    const snap = {};
    for (const q of state.players) snap[q.id] = assetsOf(state, q);
    const list = state.slice.assetByDay ?? (state.slice.assetByDay = []);
    const entry = { day: state.day, assets: snap };
    if (list.length && list[list.length - 1].day === state.day) list[list.length - 1] = entry;
    else list.push(entry);
  }
}

function advanceDay(state) {
  state.day += 1;
  tickMap(state);
  const every = state.config?.priceIndexEveryDays ?? TUNING.priceIndexEveryDays;
  const step = state.config?.priceIndexStep ?? TUNING.priceIndexStep;
  if ((state.day - 1) % every === 0) {
    state.priceIndex = +(state.priceIndex + step).toFixed(2);
    log(state, `物价指数上涨到 ${state.priceIndex.toFixed(2)}`);
  }
  if(!state.slice) {
    for (const p of state.players) if (p.alive) applyMonthly(state, p);
    tickStocks(state);
    drawLottery(state);
  }
  if(!state.slice) spawnOccupants(state);
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
  if(state.slice) {
    if(state.day>1 && (state.day-1)%3===0) {
      const id=await ui.ask({type:'supply',player:p,options:SUPPLIES});
      const pack=SUPPLIES.find(s=>s.id===id);
      if(pack) {for(const card of pack.cards) addCard(state,p,card); log(state,`${p.name} 选择「${pack.name}」：${pack.cards.map(c=>SLICE_CARDS[c].name).join(' + ')}`);}
    }
    while(p.cards.length>p.handLimit) {
      const index=await ui.ask({type:'discard',player:p,cards:[...p.cards],excess:p.cards.length-p.handLimit});
      const at=Number.isInteger(index)&&index>=0&&index<p.cards.length?index:p.cards.length-1;
      const [id]=p.cards.splice(at,1);log(state,`${p.name} 整理手牌，弃掉 ${SLICE_CARDS[id]?.name??CARD_DEFS[id].name}`);
    }
  }
  const diceCount = await actionPhase(state, p, ui);
  if (diceCount === null) return;
  const stay = !!p.skipMove;
  if (stay) p.skipMove = 0;
  let n;
  if (stay) n = 0;
  else if (p.status === '乌龟') n = 1;
  else if (p.status === '冰冻') n = 0;
  else if (p.forcedDice != null) { n = p.forcedDice; p.forcedDice = null; }
  else if (p.diceValue != null) { n = p.diceValue * diceCount; p.diceValue = null; log(state, state.slice?`定步生效：本回合走 ${n} 步`:`遥控骰子：${diceCount} 颗骰子都按 ${n / diceCount} 点计算`); }
  else n = Array.from({ length: diceCount }, () => 1 + state.rng.int(6)).reduce((a, b) => a + b, 0);
  state.phase = 'move';
  state.lastRoll = { playerId: p.id, value: n, path: [] };
  log(state, stay ? `${p.name} 停留，本回合移动 0 步` : `${p.name} 掷出 ${n} 点`);
  if (!stay) { const extra = mapExtraSteps(state); if (extra) { n += extra; log(state, `地图节拍：本回合额外 +${extra} 步`); } }
  let steps = n;
  while (true) {
    const stopped = await movePhase(state, p, steps, ui);
    if (state.over || !p.alive) return;
    if (p.forceRestart != null) { steps = p.forceRestart; p.forceRestart = null; p.trail = [p.position]; p.lastNode = null; continue; }
    if (!stopped) await landingPhase(state, p, ui);
    if (state.over || !p.alive) return;
    if (p.forceRestart != null) { steps = p.forceRestart; p.forceRestart = null; p.trail = [p.position]; p.lastNode = null; continue; }
    await groundPhase(state, p, ui);
    if (state.over || !p.alive) return;
    await postGodPhase(state, p, ui);
    if (state.over || !p.alive) return;
    await directionPhase(state, p, ui);
    break;
  }
}

async function actionPhase(state, p, ui) {
  state.phase = 'action';
  let previousCards=p.cards.length;
  while (true) {
    if(state.slice && p.cards.length<previousCards) {p.sliceCardsUsed++;p.sliceStats.cardsPlayed++;}
    previousCards=p.cards.length;
    ui.render(state);
    const a = await ui.ask({ type: 'action', player: p });
    if (!a) return null;
    if (a.action === 'roll') return Math.max(1, Math.min(TUNING.maxDice, 1 + Math.max(0, p.vehicle ?? 0), a.dice ?? 1));
    if (a.action === 'bank') { await bankFlow(state, p, ui, false); continue; }
    if (a.action === 'stock') { await stockFlow(state, p, ui); continue; }
    if (a.action === 'card') {
      if(state.slice && p.sliceCardsUsed>=2) continue;
      const id = p.cards[a.index];
      if (!id || PASSIVE.has(id)) continue;
      if (id === 'remotedice') { await diceChoiceFlow(state, p, ui, a.index, 1, 6); continue; }
      if (id === 'superdice') { await diceChoiceFlow(state, p, ui, a.index, 0, 12); continue; }
      let target = null;
      const def = CARD_DEFS[id];
      if (def.target !== 'self' && def.target !== 'all') {
        const kind = GROUND_CARDS.has(id) || id === 'monster' ? 'plot' : (STREET_CARDS.has(id) ? 'street' : def.target);
        let opts = null;
        if (kind === 'player') {
          opts = state.players.filter(q => q.alive && (q.id !== p.id || SELF_TARGET.has(id)) && !(id === 'sendgod' && q.talents.includes('no_sendgod_outside_turn') && q.id !== p.id && q.team !== p.team) && (bossInfiniteRange(p, id) || !TARGET_RANGE_5.has(id) || (id === 'turn' && p.talents.includes('turn_card_infinite')) || q.position === p.position || pathWithin(state.map, p.position, q.position, cardRange(p, id))));
        }
        const plotIds=state.slice&&['plot','street'].includes(kind)?sliceTargetIds(state,p,id):undefined;
        if(plotIds&&!plotIds.length) continue;
        target = await ui.ask({ type: 'target', player: p, cardId: id, kind, players: opts, plotIds, max: kind === 'cell' ? cardRange(p, id, id === 'robotdoll' ? 10 : 5) : null });
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
      const q = state.players.find(x => x.id === target);
      if (q && RESPONSE_CARDS.has(id)) {
        if (SAME_CARDS.has(id) && q.cards.includes('samefate')) {
          const use = await ui.ask({ type: 'response', player: q, cardId: id, response: 'samefate', label: CARD_DEFS[id]?.name ?? id });
          if (use) {
            q.cards.splice(q.cards.indexOf('samefate'), 1);
            p.cards.splice(a.index, 1);
            applyCard(state, p, id, p.id);
            log(state, `${q.name} 用同命卡把 ${CARD_DEFS[id]?.name ?? id} 反弹给 ${p.name}`);
            continue;
          }
        }
        if (TRANSFER_CARDS.has(id) && q.cards.includes('transfer')) {
          const use = await ui.ask({ type: 'response', player: q, cardId: id, response: 'transfer', label: CARD_DEFS[id]?.name ?? id });
          if (use) {
            const others = state.players.filter(x => x.alive && x.id !== q.id);
            const other = await ui.ask({ type: 'target', player: q, cardId: 'transfer', label: '转移目标', kind: 'player', players: others });
            if (other) {
              q.cards.splice(q.cards.indexOf('transfer'), 1);
              useCard(state, a.index, other);
              log(state, `${q.name} 用转移卡把 ${CARD_DEFS[id]?.name ?? id} 转给 ${state.players.find(x => x.id === other)?.name}`);
              continue;
            }
          }
        }
        if (q.cards.includes('wuxie')) {
          const use = await ui.ask({ type: 'response', player: q, cardId: id, response: 'wuxie', label: CARD_DEFS[id]?.name ?? id });
          if (use) {
            q.cards.splice(q.cards.indexOf('wuxie'), 1);
            p.cards.splice(a.index, 1);
            log(state, `${q.name} 用无懈卡取消了 ${CARD_DEFS[id]?.name ?? id}`);
            continue;
          }
        }
      }
      useCard(state, a.index, target);
      continue;
    }
  }
}

async function rollPhase() {}

async function movePhase(state, p, steps, ui) {
  const path = [];
  const trail = [p.position];
  p.trail = trail;
  let cameFrom = p.lastNode;
  for (let i = 0; i < steps; i++) {
    const next = await chooseStep(state, p, cameFrom, i === 0, ui, state.slice || i < steps - 1, steps-i);
    if (!next) break;
    cameFrom = p.position;
    p.position = next;
    p.lastNode = cameFrom;
    trail.push(next);
    p.facing = nextForward(state, next, cameFrom);
    path.push(next);
    state.lastRoll.path = path;
    if (p.bombSteps > 0) {
      p.bombSteps -= 1;
      if (p.bombSteps <= 0) {
        p.god = null; p.godDays = 0;
        if (!pay(state, p, null, TUNING.bombDamage, '定时炸弹')) state.stats.bankruptcies += 1;
        log(state, `${p.name} 身上的定时炸弹爆炸`);
        if (!p.alive) return true;
      }
    }
    if (next === state.map.startId) { const salary = incomeBonus(p, state.slice?4000:TUNING.salary); p.cash += salary; log(state, `${p.name} 经过起点 +${salary}`); }
    const node = state.map.nodes.find(n => n.id === next);
    if (node?.surface === 'ice' && p.forceRestart == null) { p.forceRestart = 1; p.forceRandom = true; log(state, `${p.name} 踩到冰面，沿朝向滑行 1 格`); }
    if (node?.surface === 'slope' && i < steps - 1) { steps -= 1; log(state, `${p.name} 上坡，多消耗 1 步`); }
    if (ui.step) await ui.step(state, p, next);
    if (await passPhase(state, p, next, ui, i === steps - 1)) return true;
    if (p.forceRestart != null) return false;
    if (!p.alive || p.jail > 0 || p.hospital > 0) return true;
    if (p.stopNow) { p.stopNow = 0; return false; }
  }
  return false;
}

async function bounceBack(state, p, ui) {
  const trail = p.trail ?? [];
  if (trail.length < 3) {
    p.bounceSteps = 0;
    p.forceRestart = 2;
    p.forceRandom = true;
    p.trail = [p.position];
    p.lastNode = null;
    log(state, `${p.name} 被果冻墙弹飞，随机方向移动 2 格`);
    return;
  }
  const idx = Math.max(0, trail.length - 3);
  const target = trail[idx] ?? p.lastNode ?? p.position;
  const backCells = [];
  for (let i = trail.length - 2; i >= idx; i--) backCells.push(trail[i]);
  for (let i = 0; i < backCells.length; i++) {
    const cell = backCells[i];
    p.lastNode = p.position;
    p.position = cell;
    const exits = buildAdj(state.map)[cell] ?? [];
    const reverse = exits.find(e => e.to !== p.lastNode) ?? exits[0];
    p.facing = reverse?.to ?? p.lastNode;
    if (ui?.step) await ui.step(state, p, cell);
  }
  p.bounceSteps = 0;
  p.forceRestart = 0;
  p.trail = [p.position];
  p.lastNode = null;
  log(state, `${p.name} 被果冻墙沿原路弹回，重新从移动阶段处理`);
}

function forceOneStep(state, p) {
  const adj = buildAdj(state.map);
  const exits = adj[p.position].filter(e => edgeUsable(state.map, state.day, e));
  if (!exits.length) return null;
  let next;
  if (exits.length >= 3) {
    const choices = exits.filter(e => e.to !== p.lastNode);
    next = state.rng.pick(choices.length ? choices : exits).to;
  } else if (p.facing && exits.some(e => e.to === p.facing)) {
    next = p.facing;
  } else {
    const choices = exits.filter(e => e.to !== p.lastNode);
    next = (choices[0] ?? exits[0]).to;
  }
  p.lastNode = p.position;
  p.position = next;
  p.trail = p.trail ?? [];
  p.trail.push(next);
  const forward = nextForward(state, next, p.lastNode);
  p.facing = forward;
  return next;
}

async function bananaChain(state, p) {
  const cellId = p.position;
  const occ = state.placements[cellId];
  if (occ?.kind !== 'banana') return;
  delete state.placements[cellId];
  log(state, `${p.name} 踩到香蕉皮，强制向前移动 1 格`);
  p.forceRestart = 1;
  p.forceRandom = true;
}

function nextForward(state, pos, cameFrom) {
  const adj = buildAdj(state.map);
  const exits = adj[pos].filter(e => edgeUsable(state.map, state.day, e));
  const forward = exits.find(e => e.to !== cameFrom) ?? exits[0];
  return forward?.to ?? pos;
}

async function chooseStep(state, p, cameFrom, first, ui, allowAsk, remainingSteps) {
  const adj = buildAdj(state.map);
  const exits = adj[p.position].filter(e => edgeUsable(state.map, state.day, e));
  if (exits.length >= 3 && !p.forceRandom && !['cw','ccw','random'].includes(p.dirMode) && allowAsk && typeof ui.ask === 'function') {
    const options = exits.filter(e => e.to !== cameFrom).map(e => e.to);
    if (options.length > 1) {
      const to = await ui.ask({ type: 'direction', player: p, options, remainingSteps });
      if (to && options.includes(to)) {
        p.facing = to;
        return to;
      }
    }
  }
  return nextStep(state, p, cameFrom, first);
}

function nextStep(state, p, cameFrom, first) {
  const adj = buildAdj(state.map);
  const exits = adj[p.position].filter(e => edgeUsable(state.map, state.day, e));
  if (!exits.length) return null;
  if (p.god === '糊涂神') {
    const pool = exits.filter(e => e.to !== cameFrom);
    return state.rng.pick(pool.length ? pool : exits).to;
  }
  let choices = exits.filter(e => e.to !== cameFrom);
  if (!choices.length) choices = exits;
  if (exits.length <= 1) return exits[0].to;
  if (exits.length === 2) {
    if (first && p.facing && exits.some(e => e.to === p.facing)) return p.facing;
    const forward = choices.find(e => e.to === p.facing) ?? choices[0] ?? exits[0];
    return forward.to;
  }
  if (p.dirMode === 'cw' || p.dirMode === 'ccw') { const to = turnChoice(state, p, cameFrom, p.dirMode); if (to) return to; }
  if (p.dirMode === 'random') return state.rng.pick(choices).to;
  if (p.forceRandom && exits.length >= 3) { p.forceRandom = false; return state.rng.pick(choices).to; }
  if (first && p.facing && exits.some(e => e.to === p.facing)) return p.facing;
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

function gainMoney(state, p, reason = '金钱格') {
  const cap = Math.max(1, state.config?.moneyCap ?? TUNING.moneyCap ?? 30000);
  const amount = incomeBonus(p, Math.max(1000, Math.round((1 + state.rng.int(cap)) / 1000) * 1000));
  p.cash += amount;
  log(state, `${p.name} 在${reason}获得 ${amount}`);
}

async function passPhase(state, p, cellId, ui, isLast) {
  if (!isLast) {
    const occ = state.placements[cellId];
    if (occ && !['god', 'dog', 'beggar', 'merchant', 'banana'].includes(occ.kind)) {
      await triggerObstacle(state, p, cellId, occ, ui);
      if (p.bounceSteps) { await bounceBack(state, p, ui); p.stopNow = 1; return false; }
      if (!p.alive || p.jail > 0 || p.hospital > 0 || p.skipTurns > 0) return true;
    }
    const node = state.map.nodes.find(n => n.id === cellId);
    if (node.kind === 'card') { addCard(state, p, drawBaseCard(state, p)); log(state, `${p.name} 经过卡片格，获得 1 张卡`); }
    if (node.kind === 'money') gainMoney(state, p, '金钱格');
    if (node.kind === 'bank') { await bankFlow(state, p, ui, true); }
    if (node.kind === 'lottery') { await lotteryFlow(state, p, ui); }
    if (node.kind === 'teleport') { const to = portalDestination(state, cellId); if (to) { p.position = to; p.trail = [to]; p.lastNode = null; p.forceRandom = true; faceRandom(state, p); log(state, `${p.name} 经过传送门，被传送到 ${to}`); } }
  }
  if (isLast) {
    const node = state.map.nodes.find(n => n.id === cellId);
    if (node?.kind === 'teleport') {
      const to = portalDestination(state, cellId);
      if (to) { p.position = to; p.trail = [to]; p.lastNode = null; p.forceRandom = true; faceRandom(state, p); log(state, `${p.name} 经过传送门，被传送到 ${to}`); }
    }
  }
  return false;
}

async function triggerObstacle(state, p, cellId, occ, ui) {
  delete state.placements[cellId];
  if (occ.kind === 'god') { attachGod(state, p, occ.name); return; }
  if (occ.kind === 'dog') { await dogEffect(state, p); return; }
  if (occ.kind === 'beggar') {
    if (p.god === '凶神' || p.god === '财神') { log(state, `${p.name} 的${p.god}让乞丐不敢靠近`); return; }
    if (!p.talents.includes('immune_beggar_dog')) pay(state, p, null, TUNING.beggarAsk, '乞丐');
    return;
  }
  const hurt = { mine: TUNING.mineDamage, dynamite: TUNING.bombDamage }[occ.kind];
  if (hurt) {
    if (!pay(state, p, null, hurt, occ.kind)) state.stats.bankruptcies += 1;
    if (p.alive) { p.hospital = (state.config?.hospitalTurns ?? TUNING.hospitalTurns); p.position = state.map.facility?.hospital ?? p.position; log(state, `${p.name} 被炸伤住院 ${p.hospital} 天`); }
  }
  else if (occ.kind === 'timebomb') { p.god = '定时炸弹'; p.godDays = 0; p.bombSteps = 30; }
  else if (occ.kind === 'jelly') { p.bounceSteps = 2; log(state, `${p.name} 碰到果冻墙，被弹回 2 格`); }
  else if (occ.kind === 'roadblock' || occ.kind === 'trap') { p.stopNow = 1; log(state, `${p.name} 碰到${occ.kind}，停止移动`); }
  else { p.skipTurns += 1; log(state, `${p.name} 碰到${occ.kind}，停留 1 天`); }
}

async function dogEffect(state, p) {
  if (p.god === '凶神') { log(state, `${p.name} 的凶神吓退了野狗`); return; }
  if (p.vehicle || p.talents.includes('immune_beggar_dog')) { log(state, `${p.name} 躲过了野狗`); return; }
  p.hospital = (state.config?.hospitalTurns ?? TUNING.hospitalTurns);
  p.position = state.map.facility?.hospital ?? p.position;
  log(state, `${p.name} 被野狗咬伤，住院 ${p.hospital} 天`);
}

export async function landingPhase(state, p, ui) {
  let cell = state.map.nodes.find(n => n.id === p.position);
  if (!cell) return;
  log(state, `${p.name} 停在 ${cell.label}${state.slice&&cell.adjacentPlots?.length?'，旁边是 '+cell.adjacentPlots.map(id=>state.map.plots.find(p=>p.id===id)?.name).join('、'):''}`);
  const occ = state.placements[cell.id];
  if (occ?.kind === 'banana') { await bananaChain(state, p); return; }
  if (occ) {
    if (occ.kind === 'god' || occ.kind === 'dog' || occ.kind === 'beggar') await triggerObstacle(state, p, cell.id, occ, ui);
    else if (occ.kind === 'merchant') { delete state.placements[cell.id]; await merchantFlow(state, p, ui); }
    else if (!['god','dog','beggar','merchant'].includes(occ.kind)) await triggerObstacle(state, p, cell.id, occ, ui);
  }
  if (p.bounceSteps) { await bounceBack(state, p, ui); return; }
  if (!p.alive || p.jail > 0 || p.hospital > 0) return;
  if (p.position !== cell.id) {
    cell = state.map.nodes.find(n => n.id === p.position);
    if (!cell) return;
  }
  switch (cell.kind) {
    case 'card': addCard(state, p, drawBaseCard(state, p)); log(state, `${p.name} 停在卡片格，获得 1 张卡`); break;
    case 'money': gainMoney(state, p, '金钱格'); break;
    case 'tax': {
      if (p.god === '凶神') { log(state, `${p.name} 的凶神免除纳税`); break; }
      if (p.god === '财神') { log(state, `${p.name} 的财神免除纳税`); break; }
      let amount = Math.min(50_000, Math.max(5_000, Math.round(p.cash * TUNING.taxRate)));
      if (p.god === '穷神') amount *= 2;
      log(state, `${p.name} 纳税 ${amount}`); pay(state, p, null, amount, '纳税'); break;
    }
    case 'god': { attachGod(state, p, state.rng.pick(ALL_GODS)); break; }
    case 'dog': await dogEffect(state, p); break;
    case 'beggar':
      if (p.god === '凶神' || p.god === '财神') { log(state, `${p.name} 的${p.god}让乞丐不敢靠近`); break; }
      if (!p.talents.includes('immune_beggar_dog')) pay(state, p, null, TUNING.beggarAsk, '乞丐'); break;
    case 'hospitalGate': case 'hospital': p.hospital = (state.config?.hospitalTurns ?? TUNING.hospitalTurns); p.position = state.map.facility?.hospital ?? p.position; log(state, `${p.name} 住院 ${p.hospital} 回合`); break;
    case 'jailGate': case 'jail': p.jail = (state.config?.jailTurns ?? TUNING.jailTurns); p.position = state.map.facility?.jail ?? p.position; log(state, `${p.name} 入狱 ${p.jail} 回合`); break;
    case 'event': if (p.god === '凶神') log(state, `${p.name} 的凶神让事件无效`); else runNewsEvent(state, p); break;
    case 'teleport': break;
    case 'bank': await bankFlow(state, p, ui, false); break;
    case 'lottery': await lotteryFlow(state, p, ui); break;
    case 'shop': await shopFlow(state, p, ui, 'shop'); break;
    case 'research': await shopFlow(state, p, ui, 'research'); break;
    case 'magic': await magicFlow(state, p, ui); break;
    case 'news': if (p.god === '凶神') log(state, `${p.name} 的凶神让新闻无效`); else runNewsEvent(state, p); break;
    default: break;
  }
}

export async function groundPhase(state, p, ui) {
  // #1026：上游 landingPhase 会把人从医院/监狱格送到 facility 格并设 jail/hospital
  // （flow.js:524/:525），而 playTurn 紧接着无条件调用本函数。入狱/住院那一回合不该再结算
  // 邻店——人不是在走过去，是被送进去的。landingPhase:504 已有同一前提，这里补齐。
  if (!p.alive || p.jail > 0 || p.hospital > 0) return;
  const cell = state.map.nodes.find(n => n.id === p.position);
  if (!cell) return;
  const ids = cell.adjacentPlots ?? [];
  for (const id of ids) {
    const plot = state.map.plots.find(x => x.id === id);
    const pr = state.properties[id];
    if (!pr || !pr.ownerId) {
      if(state.slice && state.day<(plot.availableFromDay??1)) {log(state,`${plot.name} 第 ${plot.availableFromDay} 天开售，现在先看好位置`);continue;}
      if (await ui.ask({ type: 'buy', player: p, plot, price: buyPrice(state, id), level: pr?.level ?? 0, bigType: pr?.bigType ?? null })) {
        buyPlot(state, p, id, plot);
        ui.render?.(state);
        if (ui.say) await ui.say(p, 'buy');
      }
      continue;
    }
    const owner = state.players.find(q => q.id === pr.ownerId);
    if (p.god === '恶魔') {
      if (pr.level > 0) { pr.level -= 1; log(state, `${p.name} 的恶魔让 ${labelForPlot(state, id)} 降到 Lv.${pr.level}`); }
      continue;
    }
    if (p.god === '土地公' && owner?.team !== p.team) {
      if (owner) owner.properties = owner.properties.filter(x => x !== id);
      pr.ownerId = p.id; p.properties.push(id);
      log(state, `${p.name} 的土地公把 ${labelForPlot(state, id)} 占为己有`);
      continue;
    }
    if (owner?.team === p.team) {
      if (pr.big && !pr.bigType) {
        const type = await ui.ask({ type: 'chooseBig', player: p, plot });
        if (type) chooseBig(state, p, id, type);
      } else if (pr.level < (state.config.maxLevel??TUNING.maxLevel)) {
        if (p.god === '衰神') {
          log(state, `${p.name} 的衰神让 ${labelForPlot(state, id)} 无法加盖`);
        } else {
          const cost = pr.big ? 30_000 * state.priceIndex : buildCost(pr.level+(state.slice?1:0)) * state.priceIndex;
          if (await ui.ask({ type: 'build', player: p, plot, cost })) {
            buildPlot(state, p, id);
            ui.render?.(state);
            if (ui.say) await ui.say(p, 'build');
          }
        }
      }
      continue;
    }
    if (pr.bigType === 'park' || p.god === '财神') continue;
    let rent = rentFor(state, id);
    if (pr.bigType === 'commercial') rent = Math.round(3_000 * pr.level * state.priceIndex * (1 + state.rng.int(6)));
    if (pr.bigType === 'hotel') { rent = Math.round(rent * 2); p.skipTurns += 2; }
    const realestate = p.properties.map(x => state.properties[x]).find(x => x?.bigType === 'realestate');
    if (realestate) rent = Math.round(rent * Math.max(0.5, 1 - 0.1 * realestate.level));
    if (p.talents.includes('rent_taken_down')) rent = Math.round(rent * 0.8);
    if (owner?.talents.includes('rent_dealt_up')) rent = Math.round(rent * 1.2);
    if (p.god === '穷神') rent *= 2;
    rent = Math.round(rent * bossRentMultiplier(state, owner));
    // #554 候选 A：把「为什么是这个数」写在金额旁，而不是另起一行。
    // 归因缺口（我 #542 自己找到的）：停业封租时 rent=0，旧文本只写「应付租金 0」，
    // 玩家看不出为什么白跑一趟。这里直接标停业，并标出付不起的情形。
    const rentWhy = state.slice
      ? `${pr.closed > 0 ? ' · 停业中，不计租' : pr.inflate > 0 ? ' · 旺季翻倍' : ''}${p.cash + p.deposit < rent ? ' · 现金不够，会破产' : ''}`
      : '';
    log(state, `${p.name} 向 ${owner.name} ${state.slice ? '应付' : '支付'}租金 ${rent}${state.slice ? `（${plot.name}）` : ''}${rentWhy}`);
    if (!state.slice) state.stats.rents += rent;
    const payerFundsBefore = p.cash + p.deposit;
    const ownerFundsBefore = owner.cash + owner.deposit;
    if (!pay(state, p, owner, rent, '租金')) state.stats.bankruptcies += 1;
    if(state.slice) {
      const paid = Math.max(0, payerFundsBefore - p.cash - p.deposit);
      const earned = Math.max(0, owner.cash + owner.deposit - ownerFundsBefore);
      p.sliceStats.rentPaid += paid;
      owner.sliceStats.rentEarned += earned;
      state.stats.rents += paid;
      // 第三问（对我下回合）：付完还剩多少。这是判据里「我剩多少现金」那一项，
      // 必须跟在同一行，不能靠侧栏的累计值去拼。
      // #807 Q3：付完剩多少只是数字，得翻成「它能买下什么」。
      // 双向：玩家付租时写「够/不够买一块」；玩家收租时写「这笔钱让你能/不能做什么」。
      // 最低价取自 cheapestBuyable（只读，不写死）；没有可买地块时就不写这段。
      const viewer = state.players.find(q => q.controller === 'human');
      const cheap = viewer ? cheapestBuyable(state, viewer) : null;
      // #807 人读判据拓到的 bug：原来「余额」总是付款方的 `p.cash`，
      // 而收款方分支的 Q3 半句用 `viewer.cash` —— 两个不同人的钱并在同一行，
      // 读者会以为「余额 6600」和「这笔钱让你能买下 8,000 的地」说的是同一叠钱。
      // 现在：余额只写**玩家的**，并在括号里标明是谁；玩家不在场就不写余额也不写 Q3。
      let q3Text = '';
      if (viewer && cheap) {
        const left = viewer.cash + viewer.deposit;
        const affordable = left >= cheap.price;
        if (p.id === viewer.id) {
          q3Text = ` · 你剩 ${left.toLocaleString()}` +
            (affordable ? `，够买一块 ${cheap.name}（${cheap.price.toLocaleString()}）`
                        : `，不够买 ${cheap.name}（${cheap.price.toLocaleString()}），还差 ${(cheap.price - left).toLocaleString()}`);
        } else if (owner.id === viewer.id) {
          q3Text = ` · 你剩 ${left.toLocaleString()}` +
            (affordable ? `，够买一块 ${cheap.name}（${cheap.price.toLocaleString()}）`
                        : `，暂不够买 ${cheap.name}（差 ${(cheap.price - left).toLocaleString()}）`);
        }
      }
      // 余额只在玩家是其中一方时才写，且写成「你剩」——不再出现“别人余额 + 你的能力”拼在一起。
      // #845：无主小店全卖完时 cheap 为 null，上面整段不写 ⇒ 12.9% 的行动帧没有 Q3。
      // 但收购是**卡牌动作**（game.js:454），没拿收购卡就没有「收购最便宜一块要多少」这件事，
      // 所以报价只在玩家手里确实有 buyland 时出现；没卡时给一句不含任何金额的真话。
      // 价一律 Math.round(buyPrice × 1.25) 现算（cheapestAcquirable），不写死常数。
      if (viewer && !cheap && (p.id === viewer.id || owner.id === viewer.id)) {
        const left = viewer.cash + viewer.deposit;
        const hasCard = (viewer.cards ?? []).includes('buyland');
        const target = hasCard ? cheapestAcquirable(state, viewer) : null;
        if (target) {
          q3Text = ` · 你剩 ${left.toLocaleString()}，收购 ${target.name} 要 ${target.price.toLocaleString()}` +
            (left >= target.price ? '（够）' : `（还差 ${(target.price - left).toLocaleString()}）`);
        } else if (hasCard) {
          q3Text = ` · 你剩 ${left.toLocaleString()}，无主小店已售完；手上的收购卡暂时没有可收的小店`;
        } else {
          q3Text = ` · 你剩 ${left.toLocaleString()}，无主小店已售完；拿收购卡才能收对手的店`;
        }
      }
      const balancePart = q3Text ? '' : ` · ${p.name} 余额 ${(p.cash + p.deposit).toLocaleString()}`;
      log(state, `${p.name} 实付租金 ${paid}（${plot.name}），${owner.name} 收到 ${earned}${balancePart}${q3Text}`);
    }
    if (!p.alive) return;
    if (pr.bigType === 'bookstore') { addCard(state, owner, drawBaseCard(state, owner)); log(state, `${owner.name} 的书店卖出 1 本书，获得 1 张卡`); }
    if (pr.bigType === 'research') { const adv = makeOffer(state, 1, 'research')[0]?.id; if (adv) { addCard(state, owner, adv); log(state, `${owner.name} 的研究所产出 1 张进阶卡`); } }
    if (pr.bigType === 'energy') { const fee = Math.round(2_000 * pr.level * state.priceIndex); p.cash = Math.max(0, p.cash - fee); owner.deposit += fee; log(state, `${owner.name} 的能源中心向 ${p.name} 收取 ${fee} 能源费`); }
  }
}

export function buyPlot(state, p, id, plot) {
  if(state.slice&&state.day<(plot?.availableFromDay??1))return;
  if (p.cash < buyPrice(state, id)) return;
  p.cash -= buyPrice(state, id);
  const old = state.properties[id];
  p.properties.push(id);
  state.properties[id] = { ownerId: p.id, level: old?.level ?? 0, street: plot?.street ?? null, big: !!plot?.big, bigType: old?.bigType ?? null, closed: old?.closed ?? 0, inflate: old?.inflate ?? 0, price: old?.price ?? plot?.price ?? null };
  // #807 Q3：买下大店不只是「花了一笔钱」——它改变了「谁踩到就要付」。
  // 视角必须对：买的人自己拿到收租权，其他人才是该付的。
  // 金额一律 rentFor，不写死。
  let q3Text = '';
  if (state.slice) {
    const viewer = state.players.find(q => q.controller === 'human');
    const nowRent = rentFor(state, id).toLocaleString();
    if (plot?.big) {
      q3Text = viewer && viewer.id === p.id
        ? `；现在别人踩到这格要付你 ${nowRent}`
        : `；现在这是 ${p.name} 的大店，你踩到要付 ${nowRent}`;
    } else {
      const left = viewer ? viewer.cash + viewer.deposit : 0;
      q3Text = viewer && viewer.id === p.id
        ? `；你还剩 ${left.toLocaleString()}，对手踩到付你 ${nowRent}`
        : `；${p.name} 还剩 ${(p.cash + p.deposit).toLocaleString()}，你踩到付 ${nowRent}`;
    }
  }
  log(state, `${p.name} 买下 ${state.slice?plot.name+'（支付 '+buyPrice(state,id)+'）':plot?.big ? '大空地' : '小地产'}${q3Text}`);
}

export function buildPlot(state, p, id) {
  const pr = state.properties[id]; const plot = state.map.plots.find(x => x.id === id);
  if (!pr || pr.level >= (state.config.maxLevel??TUNING.maxLevel)) return;
  const cost = Math.round((pr.big ? 30_000 : buildCost(pr.level+(state.slice?1:0))) * state.priceIndex);
  if (p.cash < cost) return;
  p.cash -= cost; pr.level += 1;
  (p.builtThisTurn ??= []).push(id);
  // #565 候选 B（付费加盖）：同样接上租金。
  // 行号不是 620：候选 A 在 :583 加了注释，整个函数已下移到 628。
  // #570：回本回合数 = ceil(花费 / 增量租金)。
  // 增量租金 = 升级后 rentFor − 升级后同一时刻、同等级的「上一级」租金。
  // 这里不能简单用 pr.level-1 去算：`rentFor` 读的是 state.properties，已经改过了。
  // 所以用「升级后租金 × 0.5」？不行 —— 小店每层翻倍但同街加成与旺季也会乘。
  // 可靠做法：先算出升级后的单价，再算把 level 降一级后的值的差，再恢复。
  let paybackText='';
  if(state.slice&&pr){
    const lv=pr.level;
    let prevRent;
    try { pr.level=lv-1; prevRent=rentFor(state,id); }
    finally { pr.level=lv; }  // 先恢复再做事：rentFor 抛错也不能把等级停在低级
    const gain=rentFor(state,id)-prevRent;
    // #1044：回合数不再就地 ceil —— 全仓只有 payback.roundsLine 一个实现。
    // 「回合回本」这句本身保留（#570 签过），降为尾部；主句由 poolShareLine 出。
    if(gain>0) paybackText=`, ${roundsLine(cost,gain)}`;
  }
  // #807 Q3：回本回合是「这笔投资」的属性，不是「我下回合」的处境。
  // 且源文本无视角 —— 对手盖楼时会印得像玩家自己的街（flow.js 原日志只写 p.name）。
  // 所以这里按「这条街归谁」分两种写法，绝不在对手盖楼时写「归你」。
  // 金额一律走 rentFor，不写死（测试会断言它与 rentFor 相等）。
  let q3Text = '';
  if (state.slice) {
    const viewer = state.players.find(q => q.controller === 'human');
    const owner = state.players.find(q => q.id === pr.ownerId);
    const nowRent = rentFor(state, id).toLocaleString();
    const mine = !!viewer && owner?.id === viewer.id;
    q3Text = mine
      ? `；这条街现在归你，对手踩到付 ${nowRent}`
      : `；对手这条街涨到 ${nowRent}，你踩到付 ${nowRent}`;
  }
  // #1044：日志是第三个真打印点（人类与 AI 看同一句）。主句与提议框同源：这一笔占全场租金多少。
  // 两条已签约束决定了它必须是**前一行**，而不是接在后面或单独后一行：
  //   ① test/q3-events.test.js:59-62 断言升级日志里第一个「；」之后**只能出现 rentFor 那一个金额**；
  //   ② 一批已签断言用 lastLog(s) 取「最后一条日志」当那道升级行本身。
  // 接在后面会破 ①，另起后一行会破 ②。放在前一行两条都保住，且顺序读起来是「先算账，再升级」。
  if (state.slice) log(state, `${plot?.name ?? '这间店'} 这笔账：${poolShareLine(cost, plot?.name)}`);
  log(state, `${p.name} 将 ${state.slice?plot.name:plot?.big ? '大空地' : '小地产'} 升到 Lv.${pr.level}（花费 ${cost}）${state.slice?`，${pr.inflate>0?'旺季 ':''}租 ${rentFor(state,id).toLocaleString()}${paybackText}`:''}${q3Text}`);
}

function chooseBig(state, p, id, type, free = false) {
  const pr = state.properties[id];
  const owner = pr ? state.players.find(q => q.id === pr.ownerId) : null;
  if (!pr || owner?.team !== p.team || !['commercial','hotel','bookstore','energy','realestate','research'].includes(type)) return;
  const cost = free ? 0 : Math.round(30_000 * state.priceIndex);
  if (p.cash < cost) return;
  p.cash -= cost;
  pr.bigType = type; pr.level = 1;
  (p.builtThisTurn ??= []).push(id);
  log(state, `${p.name} 建起 ${BIG_NAMES[type]}${cost ? `（花费 ${cost}）` : '（免费）'}`);
}

export async function postGodPhase(state, p, ui) {
  const cell = state.map.nodes.find(n => n.id === p.position);
  const ids = cell?.adjacentPlots ?? [];
  const upgraded = [];
  if (p.god === '福神' || p.god === '天使') {
    for (const id of ids) {
      const pr = state.properties[id]; const plot = state.map.plots.find(x => x.id === id);
      if (!pr || !plot || !pr.ownerId) continue;
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
      if (!pr.ownerId) continue;
      const owner = state.players.find(q => q.id === pr.ownerId);
      if (owner?.team === p.team) continue;
      const old = state.players.find(q => q.id === pr.ownerId);
      if (old) old.properties = old.properties.filter(x => x !== id);
      pr.ownerId = p.id; state.properties[id] = pr; p.properties.push(id);
    }
    if (ids.length) log(state, `${p.name} 的土地公收走了相邻地产`);
  }
  if (p.god === '凶神') {
    const built = p.builtThisTurn ?? [];
    let reverted = 0;
    for (const id of built) {
      const pr = state.properties[id];
      if (pr && !pr.big && pr.level > 0) { const owner = state.players.find(q => q.id === pr.ownerId); if (owner?.team === p.team) { pr.level -= 1; reverted += 1; } }
    }
    if (reverted) log(state, `${p.name} 的凶神撤销了本次落点建起的 ${reverted} 层房屋`);
  }
}

function turnChoice(state, p, cameFrom, mode) {
  const adj = buildAdj(state.map);
  const node = state.map.nodes.find(n => n.id === p.position);
  const from = state.map.nodes.find(n => n.id === (cameFrom ?? p.lastNode));
  if (!node || !from) return null;
  const base = Math.atan2(node.y - from.y, node.x - from.x);
  const opts = adj[p.position].filter(e => e.to !== cameFrom).map(e => e.to);
  if (!opts.length) return null;
  const scored = opts.map(id => {
    const n = state.map.nodes.find(x => x.id === id);
    let delta = Math.atan2(n.y - node.y, n.x - node.x) - base;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return { id, delta };
  });
  const target = mode === 'cw' ? Math.PI / 2 : -Math.PI / 2;
  scored.sort((a, b) => Math.abs(a.delta - target) - Math.abs(b.delta - target));
  return scored[0]?.id ?? null;
}

async function directionPhase(state, p, ui) {
  if(state.slice)return; // 下次真正移动到岔路时再选择，避免问一次随后又问一次。
  const adj = buildAdj(state.map);
  if (adj[p.position].length < 3) return;
  const opts = adj[p.position].map(e => e.to).filter(id => id !== p.lastNode);
  if (!opts.length) return;
  if (p.dirMode === 'cw' || p.dirMode === 'ccw') { p.facing = turnChoice(state, p, p.lastNode, p.dirMode); return; }
  if (p.dirMode === 'random') { p.facing = state.rng.pick(opts); return; }
  const to = await ui.ask({ type: 'direction', player: p, options: opts, remainingSteps: 0 });
  if (to) p.facing = to;
}

async function bankFlow(state, p, ui) {
  const a = await ui.ask({ type: 'bank', player: p });
  if (!a || a.action === 'leave') return;
  const total = p.cash + p.deposit;
  const keep = Math.max(0, Math.min(total, Math.round(a.keep ?? p.cash)));
  p.cash = keep;
  p.deposit = total - keep;
  log(state, `${p.name} 留下 ${keep} 现金，银行存款 ${total - keep}`);
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
  if (!Number.isInteger(n) || n < 1 || n > 30 || state.lottery.sold.includes(n) || p.cash < (state.config?.lotteryTicket ?? TUNING.lotteryTicket)) return lotteryFlow(state, p, ui);
  p.cash -= (state.config?.lotteryTicket ?? TUNING.lotteryTicket);
  state.lottery.tickets.push({ playerId: p.id, number: n });
  state.lottery.sold.push(n);
  log(state, `${p.name} 买下乐透 ${n}（${state.config?.lotteryTicket ?? TUNING.lotteryTicket}）`);
}

export async function shopFlow(state, p, ui, kind) {
  state.shopOffer = makeOffer(state, kind === 'shop' ? 9 : 6, kind);
  const limit = kind === 'shop' ? 3 : 2;
  let bought = 0;
  while (bought < limit) {
    const a = await ui.ask({ type: kind, player: p, offers: state.shopOffer, bought, limit });
    if (!a || a.action === 'leave') break;
    const item = state.shopOffer[a.index]; if (!item) continue;
    const energy = state.players.find(q => q.alive && q.team !== p.team && q.properties.some(id => state.properties[id]?.bigType === 'energy'));
    const energyLv = energy ? Math.max(...energy.properties.map(id => state.properties[id]?.bigType === 'energy' ? state.properties[id].level : 0)) : 0;
    let price = (kind === 'shop' ? Math.round(item.price * (p.talents.includes('shop_discount') ? 0.7 : 1)) : item.price) * mapShopMultiplier(state);
    price = Math.round(price);
    if (energyLv > 0 && kind !== 'research') price = Math.round(price * (1 + 0.12 * energyLv));
    if (p.cash < price) continue;
    p.cash -= price; addCard(state, p, item.id); state.shopOffer.splice(a.index, 1); bought += 1;
    if (p.talents.includes('shop_extra_card')) addCard(state, p, randomCard(state.rng));
    log(state, `${p.name} 花 ${price} 买到 ${CARD_DEFS[item.id].name}（${bought}/${limit}）`);
  }
  if (p.talents.includes('leave_shop_turtle')) {
    addCard(state, p, 'turtle');
    log(state, `${p.name} 的心机：离开商店类设施，获得 1 张乌龟卡`);
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

async function diceChoiceFlow(state, p, ui, index, min, max) {
  const id = p.cards[index];
  if (!id) return false;
  const type = id === 'superdice' ? 'steps' : 'diceValue';
  const value = await ui.ask({ type, player: p, cardId: id, min, max });
  if (!Number.isInteger(value) || value < min || value > max) return false;
  p.cards.splice(index, 1);
  if (id === 'superdice') {
    p.forcedDice = value;
    log(state, `${p.name} 使用超级骰子卡：本回合走 ${value} 步`);
  } else {
    p.diceValue = value;
    log(state, state.slice?`${p.name} 使用定步：本回合走 ${value} 步`:`${p.name} 使用遥控骰子：本回合每颗骰子固定为 ${value} 点`);
  }
  return true;
}

async function remoteDiceFlow(state, p, ui, index, max = (1 + Math.max(0, p.vehicle ?? 0)) * 6) {
  const target = await ui.ask({ type: 'target', player: p, cardId: 'remotedice', kind: 'cell', max });
  if (!target) return false;
  const path = pathWithin(state.map, p.position, target, max);
  if (!path || !path.length) return false;
  p.cards.splice(index, 1);
  const trail = [p.position];
  p.trail = trail;
  for (let i = 0; i < path.length; i++) {
    const id = path[i];
    p.lastNode = p.position; p.position = id; trail.push(id);
    p.facing = path[i + 1] ?? nextForward(state, id, p.lastNode);
    if (id === state.map.startId) { const salary = incomeBonus(p, TUNING.salary); p.cash += salary; log(state, `${p.name} 经过起点 +${salary}`); }
    if (ui.step) await ui.step(state, p, id);
    if (await passPhase(state, p, id, ui, i === path.length - 1)) return true;
    if (!p.alive || p.jail > 0 || p.hospital > 0) return true;
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
  if(state.slice)return plot.name;
  if (plot.big) return pr?.bigType ? BIG_NAMES[pr.bigType] : '大空地';
  return '小地产';
}
