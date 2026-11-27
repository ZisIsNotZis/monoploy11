import { buyPrice, rentFor } from './economy.js';
import { reachableLandings } from './insight.js';

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
  for (const player of players) for (let steps = 1; steps <= 6; steps++) {
    const nodes = reachableLandings(state, player, steps);
    for (const id of nodes) exposure.set(id, (exposure.get(id) ?? 0) + 1 / (6 * nodes.length));
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
      const price = Math.round(buyPrice(state, plot.id) * 1.25);
      if (plot.big || own || player.cash < price + reserve(state) || state.day > state.config.dayLimit - 3) return [];
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
  return Array.from({ length: 6 }, (_, i) => reachableLandings(state, player, i + 1)).flat();
}

function actionAnswer(state, player) {
  if ((player.sliceCardsUsed ?? 0) >= 2) return { action: 'roll', dice: 1 };
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
  return choice ? { action: 'card', index: choice.value } : { action: 'roll', dice: 1 };
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
