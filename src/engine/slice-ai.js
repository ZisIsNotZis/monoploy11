import { buyPrice, acquisitionPrice, rentFor } from './economy.js';
import { reachableLandings, sliceTargetIds } from './insight.js';
import { operateOffer } from './operate.js';
import { TUNING } from '../data/tuning.js';

// Only public board information is scored. No RNG draws or future dice are read.
const ownerOf = (state, pr) => state.players.find(p => p.id === pr?.ownerId);
const allied = (state, player, pr) => ownerOf(state, pr)?.team === player.team;
const reserve = state => state.day > 12 ? 3000 : 9000;
const best = rows => rows.reduce((a, b) => !a || b.score > a.score ? b : a, null);

function frontage(state, plotId) {
  return state.map.nodes.filter(n => n.adjacentPlots?.includes(plotId)).length;
}

function expectedRent(state, plotId) {
  const pr = state.properties[plotId];
  if (!pr || !pr.ownerId || pr.closed > 0) return 0;
  // Commercial rent is a public 1–6 multiplier; use its expectation, not a roll.
  if (pr.bigType === 'commercial') return 3000 * pr.level * state.priceIndex * 3.5;
  return rentFor(state, plotId);
}

function landingExposure(state, players) {
  const exposure = new Map();
  for (const player of players) for (let steps = 1; steps <= TUNING.dieFaces; steps++) {
    const nodes = reachableLandings(state, player, steps);
    for (const id of nodes) exposure.set(id, (exposure.get(id) ?? 0) + 1 / (TUNING.dieFaces * nodes.length));
  }
  return exposure;
}

function plotTargets(state, player, cardId) {
  let enemyExposure, selfExposure;
  const enemies = state.players.filter(p => p.alive && p.team !== player.team);
  return state.map.plots.flatMap(plot => {
    const pr = state.properties[plot.id];
    const own = allied(state, player, pr);
    if (cardId === 'worker') {
      if (!own || !pr || pr.level < 1 || pr.level >= (state.config.maxLevel ?? 3) || pr.closed > 0) return [];
      return [{ value: plot.id, score: pr.level * 3 + frontage(state, plot.id) + (pr.inflate > 0 ? 5 : 0) }];
    }
    if (cardId === 'buyland') {
      // #3333：**合法名单只有一处** —— insight.sliceTargetIds（内部 takeoverEligible）。
      //
      // 这一段原来自己写了一遍合法性（big / own / cash / 天数），没有空地这一条：
      // 于是 AI 的候选集 ⊃ 引擎的合法集。实测（seed 173）AI 认为最优的是 1,4——
      // 一块**无主**地，引擎根本不认（takeoverEligible 已把空地排除）。AI 返回它，
      // flow.js 的 allowed 过滤把它删成 null，卡没被消耗，action 屏再问一遍 ——
      // 这一局就永远走不下去了。人类点「取消」也是回到同一屏。
      //
      // 教训与 #3332 同构：同一件事有两份实现，就会有一份先漂。这里漂出来的不是
      // 一个错数字，是**一局卡死**。所以买不起/太晚这样的策略判断可以留在这里，
      // 但「哪些地块引擎会接受」必须问引擎。
      if (!sliceTargetIds(state, player, 'buyland').includes(plot.id)) return [];
      const price = acquisitionPrice(state, plot.id);
      if (player.cash < price + reserve(state) || state.day > state.config.dayLimit - 3) return [];
      enemyExposure ??= landingExposure(state, enemies);
      selfExposure ??= landingExposure(state, [player]);
      const fronts = state.map.nodes.filter(n => n.adjacentPlots?.includes(plot.id));
      const nextEnemyVisits = fronts.reduce((sum, n) => sum + (enemyExposure.get(n.id) ?? 0), 0);
      const selfVisit = fronts.reduce((sum, n) => sum + (selfExposure.get(n.id) ?? 0), 0);
      const remaining = Math.max(0, state.config.dayLimit - state.day - (pr?.closed ?? 0));
      // Beyond the next turn, use a conservative random-occupancy estimate. This
      // is a forecast, not access to future rolls or a promise opponents visit.
      const futureVisits = Math.max(0, remaining - 1) * fronts.length / state.map.nodes.length * enemies.length * 0.6;
      const hypothetical = { ...state, properties: { ...state.properties, [plot.id]: { ...pr, ownerId: player.id, closed: 0, inflate: 0 } } };
      const baseRent = rentFor(hypothetical, plot.id);
      const futureIncome = baseRent * (nextEnemyVisits + futureVisits);
      const avoidedRent = pr?.ownerId ? expectedRent(state, plot.id) * selfVisit : 0;
      const premium = price - buyPrice(state, plot.id);
      // Seller receives the full premium too: estate denial alone is not profit.
      const relativeCost = premium * (pr?.ownerId ? 2 : 1);
      const net = futureIncome * (pr?.ownerId ? 1.5 : 1) + avoidedRent - relativeCost - 500;
      return net > 0 ? [{ value: plot.id, score: net / 1500 }] : [];
    }
    return [];
  });
}

function landingScore(state, player, nodeId) {
  const node = state.map.nodes.find(n => n.id === nodeId);
  if (!node) return -1000;
  let score = ['hospital', 'jail', 'teleport'].includes(node.kind) ? -100 : 0;
  if (node.kind === 'money') score += 3;
  for (const plotId of node.adjacentPlots ?? []) {
    const pr = state.properties[plotId];
    if (!pr?.ownerId) {
      const plot = state.map.plots.find(p => p.id === plotId);
      if (state.day < (plot?.availableFromDay ?? 1)) continue;
      if (player.cash >= buyPrice(state, plotId) + reserve(state)) score += pr?.big ? 8 : 5;
    } else if (allied(state, player, pr)) {
      if (pr.level < (state.config.maxLevel ?? 3) && state.day < state.config.dayLimit - 1 && player.cash >= (pr.big ? 30000 : (pr.level + 1) * 5000) + reserve(state)) score += 5 + pr.level;
      else score += 1;
    } else score -= expectedRent(state, plotId) / 700;
  }
  return score;
}

function stepScores(state, player) {
  return Array.from({ length: 6 }, (_, i) => {
    const steps = i + 1;
    const landings = reachableLandings(state, player, steps);
    return { value: steps, score: Math.max(-1000, ...landings.map(id => landingScore(state, player, id))) };
  });
}

function streetTargets(state, player, cardId) {
  const reachable = new Set(stepScoresForNodes(state, player));
  const rows = new Map();
  for (const plot of state.map.plots) {
    const pr = state.properties[plot.id];
    if (!pr?.ownerId || !pr.level || pr.closed > 0) continue;
    const own = allied(state, player, pr);
    if (cardId === 'inflate' && pr.inflate > 0) continue;
    const amount = expectedRent(state, plot.id);
    const exposed = state.map.nodes.some(n => reachable.has(n.id) && n.adjacentPlots?.includes(plot.id));
    const score = cardId === 'inflate'
      ? amount / 1000 * frontage(state, plot.id) * (own ? 1 : -1)
      : amount / 1000 * (own ? -2 : exposed ? 3 : 0.3);
    rows.set(plot.street, (rows.get(plot.street) ?? 0) + score);
  }
  return [...rows].map(([value, score]) => ({ value, score })).filter(row => row.score > 0);
}

function stepScoresForNodes(state, player) {
  return Array.from({ length: TUNING.dieFaces }, (_, i) => reachableLandings(state, player, i + 1)).flat();
}

// #3468：「开门营业」的估值 —— 与它放弃的那个回合放在**同一个单位（现金）**里比。
//
// 这是 AI 的启发式，不是产品规则：金额本身来自 operate.js（与按钮、引擎同一份）。这里只
// 回答「本回合站着收这笔，还是掷骰去捡另一个」。
//
// 两项：
//   · 落点当场进出（过发薪处、零工、付给别人的租金）—— 只算确定的格子。
//     自家店不在里面：引擎只在移动结束后对**别人**的店结租，自家店只问加盖；
//   · 机动权的固定估值 MOVE_OPTION：站着不动的机会成本不是零，但也不能大到「永不营业」，
//     这个数是**量出来的**（support/probe-3468/operate-route.mjs 的 option 扫描），
//     不是拍的。
export const MOVE_OPTION = 1200;

// #3468 复核抓到：这里曾把「停到自家/同盟的店旁」算成 **+租金**。
// 引擎不是这么结的 —— groundPhase 在 owner.team === p.team 时只问「要不要加盖」，
// 一分钱不收也不付（flow.js 的 `owner?.team === p.team` 分支）。把自家店当收入会让
// 「这一回合能捡到多少」虚高，于是 operateChoice 更难开门：9 seed 的 productOn 里有
// 198/3141 个真正开得出营业的分岔点被这个虚高挡住。
// 更糟的是探针里那份同名函数早就修过（它的注释原话：「把“自己的店”当成了收入，
// 于是 opSmart 的估值虚高」），而产品里这一份没跟着改 —— 于是 RESULT-3468 量的
// 不是产品在跑的那套估值。两份实现必然漂，现在探针改为 import 这里的 turnCash。
function landingCash(state, player, nodeId) {
  const node = state.map.nodes.find(n => n.id === nodeId);
  if (!node) return -1000;
  if (node.kind === 'money') return 1500;              // 零工：随机收入，最多 3,000
  if (node.kind === 'hospital' || node.kind === 'jail') return -4000;  // 停两回合
  let cash = 0;
  for (const plotId of node.adjacentPlots ?? []) {
    const pr = state.properties[plotId];
    if (!pr || !pr.ownerId) continue;
    // 自家/同盟的店：引擎不收也不付 ⇒ 对这一回合的现金是 0，不是收入。
    if (allied(state, player, pr)) continue;
    const rent = rentFor(state, plotId);
    if (rent) cash -= rent;
  }
  return cash;
}

// 导出是给探针用的（support/probe-3468/operate-route.mjs 的 opSmart 臂）：证据必须量
// 产品真正在跑的估值。上一版两边各写一份，产品这份漂成了「自家店 = 收入」。
export function turnCash(state, player) {
  let bestCash = -Infinity;
  for (let steps = 1; steps <= TUNING.dieFaces; steps++) {
    for (const nodeId of reachableLandings(state, player, steps)) {
      bestCash = Math.max(bestCash, landingCash(state, player, nodeId));
    }
  }
  return Number.isFinite(bestCash) ? bestCash : 0;
}

// 有牌可出时，先出牌：营业会结束本回合，而牌只能在本回合出。
// 所以「营业」只在**已经没牌可出**或手里的牌确实不值得出的时候才让步 ——
// 这一段不重写牌的估值，只问 actionAnswer 原本会不会选一张牌。
function operateChoice(state, player, bestCardScore) {
  const offer = operateOffer(state, player);
  if (!offer || offer.blocked || offer.amount <= 0) return null;
  if (bestCardScore > 0) return null;                 // 先把牌打完，再考虑站着收钱
  const moving = turnCash(state, player) + MOVE_OPTION;
  return offer.amount > moving ? { action: 'operate' } : null;
}

function actionAnswer(state, player) {
  if ((player.sliceCardsUsed ?? 0) >= 2) {
    const op = operateChoice(state, player, 0);
    return op ?? { action: 'roll', dice: 1 };
  }
  const choices = player.cards.flatMap((cardId, index) => {
    let score = 0;
    if (cardId === 'worker') score = best(plotTargets(state, player, cardId))?.score ?? 0;
    if (cardId === 'buyland') score = best(plotTargets(state, player, cardId))?.score ?? 0;
    if (cardId === 'inflate') score = (best(streetTargets(state, player, cardId))?.score ?? 0) * 0.7;
    if (cardId === 'close') score = (best(streetTargets(state, player, cardId))?.score ?? 0) * 0.8;
    if (cardId === 'remotedice' && player.diceValue == null && player.forcedDice == null) {
      const scores = stepScores(state, player);
      const max = best(scores).score;
      score = Math.max(0, max - scores.reduce((sum, row) => sum + row.score, 0) / scores.length);
    }
    if ((player.style === 'grow' && ['worker', 'inflate'].includes(cardId)) || (player.style === 'take' && cardId === 'buyland') || (player.style === 'cross' && ['close', 'remotedice'].includes(cardId))) score *= 1.3;
    return score > 0 ? [{ value: index, score }] : [];
  });
  const choice = best(choices);
  if (choice) return { action: 'card', index: choice.value };
  return operateChoice(state, player, 0) ?? { action: 'roll', dice: 1 };
}

export function sliceAnswer(prompt, state) {
  const player = prompt.player;
  switch (prompt.type) {
    case 'action': return actionAnswer(state, player);
    case 'target': {
      let targets = prompt.kind === 'street'
        ? streetTargets(state, player, prompt.cardId)
        : plotTargets(state, player, prompt.cardId);
      if (prompt.plotIds) {
        const allowed = new Set(prompt.kind === 'street'
          ? state.map.plots.filter(plot => prompt.plotIds.includes(plot.id)).map(plot => plot.street)
          : prompt.plotIds);
        targets = targets.filter(row => allowed.has(row.value));
      }
      return best(targets)?.value ?? null;
    }
    case 'diceValue': case 'steps': return best(stepScores(state, player)).value;
    case 'direction': {
      const choices = (prompt.options ?? []).map(id => {
        const moving = prompt.remainingSteps > 0;
        const remaining = moving ? Math.max(0, prompt.remainingSteps - 1) : 2;
        const clone = { ...player, position: id, facing: null, lastNode: player.position };
        const endpoints = remaining ? reachableLandings(state, clone, remaining) : [id];
        return { value: id, score: Math.max(-1000, ...endpoints.map(nodeId => landingScore(state, player, nodeId))) };
      });
      return best(choices)?.value ?? null;
    }
    case 'supply': {
      const ids = (prompt.options ?? []).map(o => typeof o === 'string' ? o : o.id);
      const held = id => player.cards.filter(card => card === id).length;
      const grow = best(plotTargets(state, player, 'worker'));
      const take = best(plotTargets(state, player, 'buyland'));
      const danger = best(streetTargets(state, player, 'close'));
      const scores = {
        grow: (grow ? 6 + grow.score * 0.3 : 1) / (1 + held('worker')),
        take: (take ? 7 + take.score * 0.4 : 1) / (1 + held('buyland')),
        cross: (danger ? 3 + Math.min(6, danger.score * 0.3) : 1) / (1 + held('close')),
      };
      scores[player.style] = (scores[player.style] ?? 0) * 1.3;
      return best(ids.map(value => ({ value, score: scores[value] ?? 0 })))?.value ?? null;
    }
    case 'discard': {
      const counts = {};
      const rows = (prompt.cards ?? player.cards).map((id, index) => {
        const repeat = counts[id] ?? 0;
        counts[id] = repeat + 1;
        const value = id === 'worker' ? (plotTargets(state, player, id).length ? 9 : 1)
          : id === 'buyland' ? (plotTargets(state, player, id).length ? 8 : 3)
          : id === 'remotedice' ? 8 : id === 'close' ? 6 : id === 'inflate' ? 5 : 0;
        return { value: index, score: -value + repeat * 2 };
      });
      return best(rows)?.value ?? 0;
    }
    case 'buy': return player.cash >= prompt.price + reserve(state);
    case 'build': return state.day < state.config.dayLimit - 1 && player.cash >= prompt.cost + reserve(state);
    case 'chooseBig': return 'commercial';
    case 'bank': return { action: 'bank', keep: player.cash + player.deposit };
    case 'response': return true;
    default: return { action: 'leave' };
  }
}
