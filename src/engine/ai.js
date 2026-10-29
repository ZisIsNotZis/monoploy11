// 规则型 AI：只通过 ui.ask 返回动作，不直接改状态。
import { CARD_DEFS } from './game.js';

const ATTACK = new Set(['turtle','turn','stay','sleep','hibernate','scheme','missile','pick','audit','equalpoor','magic','sendgod']);
const SELF = new Set(['motorcycle','car','invitegod','godfavor','glory','green','free']);
const PLOT_CARDS = new Set(['worker','truck','buyland','rebuild','monster','exchange']);
// 这些基础卡集满 5 张能合成进阶卡；AI 拿到 3 张后不再烧掉，留作合成。
const FUSION_BASE = new Set(['missile', 'inflate', 'close', 'sendgod', 'monster', 'invitegod']);

function assets(p) {
  return p.cash + p.deposit + p.properties.reduce((s, id) => s + 10000, 0);
}

function pickCardIndex(p, state) {
  if (p.aiUsedCard) return -1;
  const counts = {};
  for (const id of p.cards) counts[id] = (counts[id] ?? 0) + 1;
  for (let i = 0; i < p.cards.length; i++) {
    const id = p.cards[i];
    if ((ATTACK.has(id) || SELF.has(id) || PLOT_CARDS.has(id)) && !(FUSION_BASE.has(id) && (counts[id] ?? 0) >= 3)) return i;
  }
  return -1;
}

function choosePlayerTarget(prompt) {
  const list = (prompt.players ?? []).filter(q => q.alive);
  if (!list.length) return null;
  const enemies = list.filter(q => q.team !== prompt.player.team);
  const pool = enemies.length ? enemies : list;
  return pool.sort((a, b) => assets(b) - assets(a))[0].id;
}

function choosePlotTarget(prompt, state) {
  const p = prompt.player;
  const id = prompt.cardId;
  const own = p.properties
    .map(pid => ({ pid, pr: state.properties[pid] }))
    .filter(x => x.pr && !x.pr.big && x.pr.level > 0)
    .sort((a, b) => a.pr.level - b.pr.level);
  const enemy = Object.entries(state.properties)
    .filter(([, pr]) => pr.ownerId && pr.ownerId !== p.id && !pr.big && pr.level > 0)
    .map(([pid, pr]) => ({ pid, pr }));
  if (id === 'worker') return own[0]?.pid ?? null;
  if (id === 'buyland') {
    const unowned = state.map.plots.find(plot => !state.properties[plot.id]?.ownerId);
    return unowned?.id ?? enemy[0]?.pid ?? null;
  }
  if (id === 'rebuild') return Object.entries(state.properties).find(([, pr]) => pr.big && pr.bigType && pr.bigType !== 'park')?.[0] ?? null;
  if (id === 'exchange') return enemy[0]?.pid ?? null;
  return enemy[0]?.pid ?? state.map.plots[0]?.id ?? null;
}

function chooseDirection(prompt, state) {
  const p = prompt.player;
  const opts = prompt.options ?? [];
  if (!opts.length) return null;
  const nodes = Object.fromEntries(state.map.nodes.map(n => [n.id, n]));
  let best = opts[0], bestScore = -Infinity;
  for (const id of opts) {
    const n = nodes[id];
    if (!n) continue;
    let score = state.rng.float() * 2;
    if (n.kind === 'hospital' || n.kind === 'jail' || n.kind === 'teleport') score -= 80;
    if (n.kind === 'money' || n.kind === 'card' || n.kind === 'lottery' || n.kind === 'shop') score += 12;
    for (const pid of n.adjacentPlots ?? []) {
      const pr = state.properties[pid];
      if (!pr || !pr.ownerId) score += 18;
      else {
        const owner = state.players.find(q => q.id === pr.ownerId);
        if (owner?.team === p.team) score += 14 + (pr.level ?? 0) * 2;
        else score -= 18 + (pr.level ?? 0) * 4 + (pr.bigType === 'hotel' ? 12 : 0);
      }
    }
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

export function aiAnswer(prompt, state) {
  const p = prompt.player;
  switch (prompt.type) {
    case 'action': {
      const i = pickCardIndex(p, state);
      if (i >= 0) { p.aiUsedCard = true; return { action: 'card', index: i }; }
      return { action: 'roll', dice: 1 };
    }
    case 'buy': {
      const plot = prompt.plot;
      if (plot?.name === '中央大酒店') return p.cash >= prompt.price + 5_000;
      if (plot?.big) return p.cash >= prompt.price + 15_000;
      return p.cash >= prompt.price + 30_000;
    }
    case 'build': return p.cash >= prompt.cost + 30_000;
    case 'chooseBig': return prompt.plot?.name === '中央大酒店' ? 'hotel' : 'commercial';
    case 'direction': return chooseDirection(prompt, state);
    case 'target': {
      if (prompt.kind === 'player') return choosePlayerTarget(prompt);
      if (prompt.kind === 'plot') return choosePlotTarget(prompt, state);
      if (prompt.kind === 'cell') return null;
      if (prompt.kind === 'street') return state.map.plots[0]?.street ?? null;
      return null;
    }
    case 'bank': {
      const total = p.cash + p.deposit;
      return { action: 'bank', keep: Math.floor(total * 0.7) };
    }
    case 'stock': return { action: 'leave' };
    case 'lottery': return { action: 'leave' };
    case 'shop': case 'merchant': case 'research': {
      const offers = prompt.offers ?? [];
      // 优先买自己手里已有同名的那张，凑五卡合成。
      const held = id => p.cards.filter(c => c === id).length;
      let idx = -1; let best = -1;
      offers.forEach((o, i) => {
        if (p.cash < o.price + 20_000) return;
        const n = held(o.id);
        if (n > best) { best = n; idx = i; }
      });
      return idx >= 0 && (prompt.bought ?? 0) < (prompt.limit ?? 2) ? { action: 'buy', index: idx } : { action: 'leave' };
    }
    case 'magic': {
      const options = prompt.options ?? [];
      const preferred = ['cards','deposit','god','teleport','punish','destroy'];
      for (const id of preferred) {
        const opt = options.find(x => x.id === id && !x.disabled);
        if (opt) return { id };
      }
      return options.find(x => !x.disabled) ? { id: options.find(x => !x.disabled).id } : null;
    }
    case 'response': return true;
    default: return null;
  }
}
