// 规则型 AI：只通过 ui.ask 返回动作，不直接改状态。
import { CARD_DEFS } from './game.js';

const ATTACK = new Set(['turtle','turn','stay','sleep','hibernate','scheme','missile','pick','audit','equalpoor','magic','sendgod']);
const SELF = new Set(['motorcycle','car','invitegod','godfavor','glory','green','free']);
const PLOT_CARDS = new Set(['worker','truck','buyland','rebuild','monster','exchange']);

function assets(p) {
  return p.cash + p.deposit + p.properties.reduce((s, id) => s + 10000, 0);
}

function pickCardIndex(p, state) {
  if (p.aiUsedCard) return -1;
  for (let i = 0; i < p.cards.length; i++) {
    const id = p.cards[i];
    if (ATTACK.has(id) || SELF.has(id) || PLOT_CARDS.has(id)) return i;
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

export function aiAnswer(prompt, state) {
  const p = prompt.player;
  switch (prompt.type) {
    case 'action': {
      const i = pickCardIndex(p, state);
      if (i >= 0) { p.aiUsedCard = true; return { action: 'card', index: i }; }
      return { action: 'roll', dice: 1 };
    }
    case 'buy': return p.cash >= prompt.price + 30_000;
    case 'build': return p.cash >= prompt.cost + 30_000;
    case 'chooseBig': return 'commercial';
    case 'direction': return prompt.options?.[0] ?? null;
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
      const idx = offers.findIndex(o => p.cash >= o.price + 20_000);
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
