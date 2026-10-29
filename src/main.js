import { makeRng } from './engine/rng.js';
import {
  createGame, roll, buyProperty, buildProperty, chooseDirection, endTurn,
  useCard, doBank, doStock, leaveStock, doLottery, doMagic, doNews,
  doMerchant, doShop, skipPending, current, CARD_DEFS, leavePending,
} from './engine/game.js';
import { render } from './ui/render.js';

const root = {
  topbar: document.querySelector('#topbar'),
  players: document.querySelector('#players'),
  board: document.querySelector('#board'),
  actions: document.querySelector('#actions'),
  log: document.querySelector('#log'),
  hand: document.querySelector('#hand'),
};

let state = createGame({ seed: 1 });
let pendingCard = null;

const PLAYER_TARGET_CARDS = new Set(['equalpoor', 'stay', 'turtle']);

const actions = {
  roll(n) { roll(state, n); rerender(); },
  direction(id) { chooseDirection(state, id); rerender(); },
  act(name) {
    if (name === 'buy') buyProperty(state);
    else if (name === 'build') buildProperty(state);
    else if (name === 'skip') skipPending(state);
    else if (name === 'next' || name === 'leave') leavePending(state);
    else if (name === 'news') doNews(state);
    else if (name === 'ticket') doLottery(state);
    else if (name === 'deposit') doBank(state, 'deposit', numberInput());
    else if (name === 'withdraw') doBank(state, 'withdraw', numberInput());
    rerender();
  },
  stock(id, qty, side) { doStock(state, id, qty, side); rerender(); },
  shop(id) { doShop(state, id); rerender(); },
  merchant(id) { doMerchant(state, id); rerender(); },
  magic(effect) { doMagic(state, effect); rerender(); },
  card(i) {
    const p = current(state);
    const id = p.cards[i];
    if (!id) return;
    if (PLAYER_TARGET_CARDS.has(id)) {
      pendingCard = i;
      renderTargetPicker(state, p, i);
      return;
    }
    useCard(state, i, randomTeleportTarget(id));
    rerender();
  },
};

function randomTeleportTarget(id) {
  if (id !== 'teleport') return null;
  const nodes = state.map.nodes.filter(n => n.kind !== 'teleport' && n.kind !== 'platform');
  return nodes[Math.floor(state.rng.float() * nodes.length)].id;
}

function numberInput() {
  return Number(document.querySelector('#amount')?.value ?? 0);
}

function renderTargetPicker(state, p, i) {
  const id = p.cards[i];
  root.actions.innerHTML = `<h3>选择目标：${CARD_DEFS[id].name}</h3>` +
    state.players.filter(q => q.alive && q.id !== p.id).map(q =>
      `<button data-target="${q.id}">${q.name}（${q.team}）</button>`).join('') +
    `<button data-target="">取消</button>`;
  root.actions.querySelectorAll('button[data-target]').forEach(b => b.onclick = () => {
    const target = b.dataset.target || null;
    if (target) useCard(state, i, target);
    pendingCard = null;
    rerender();
  });
}

function rerender() {
  render(root, state, actions);
}

rerender();
