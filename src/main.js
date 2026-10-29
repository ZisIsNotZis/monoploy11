import {
  createGame, roll, buyProperty, buildProperty, doChooseBig, chooseDirection, useCard,
  doBank, doStock, leaveStock, doLottery, doMagic, doNews, doMerchant,
  doShop, doResearch, skipPending, current, CARD_DEFS, leavePending, openStock, openBank,
} from './engine/game.js?v=70';
import { render } from './ui/render.js?v=70';
import { CHARACTERS } from './data/characters.js';
import { BOSSES } from './data/bosses.js';

const $ = s => document.querySelector(s);
const root = {
  system: $('#system'), players: $('#players'), board: $('#board'),
  log: $('#log'), dice: $('#dice'), cards: $('#cards'), hand: $('#hand'), choice: $('#choice'),
};

let state = null;
let busy = false;

const actions = {
  roll(n) {
    if (!state || busy) return;
    busy = true;
    const before = snapshot();
    animateDice(280).then(() => {
      roll(state, n);
      rerender();
      showMoneyDelta(before);
      flashPath();
      busy = false;
    });
  },
  direction(id) { chooseDirection(state, id); rerender(); },
  pickCell(id) {
    if (!state?.mapPick) return;
    const { index } = state.mapPick;
    state.mapPick = null;
    const before = snapshot();
    useCard(state, index, id);
    rerender();
    showMoneyDelta(before);
  },
  act(name) {
    const before = snapshot();
    if (name === 'buy') buyProperty(state);
    else if (name === 'build') buildProperty(state);
    else if (name === 'skip') skipPending(state);
    else if (name === 'next' || name === 'leave') leavePending(state);
    else if (name === 'news') doNews(state);
    else if (name === 'cancel-pick') { state.mapPick = null; rerender(); return; }
    else if (name === 'deposit') doBank(state, 'deposit', numberInput());
    else if (name === 'withdraw') doBank(state, 'withdraw', numberInput());
    rerender(); showMoneyDelta(before);
  },
  openStock() { openStock(state); rerender(); },
  openBank() { openBank(state); rerender(); },
  stock(id, qty, side) { const before = snapshot(); doStock(state, id, qty, side); rerender(); showMoneyDelta(before); },
  shop(index) { const before = snapshot(); doShop(state, index); rerender(); showMoneyDelta(before); },
  research(index) { const before = snapshot(); doResearch(state, index); rerender(); showMoneyDelta(before); },
  merchant(index) { const before = snapshot(); doMerchant(state, index); rerender(); showMoneyDelta(before); },
  magic(effect) { const before = snapshot(); doMagic(state, effect); rerender(); showMoneyDelta(before); },
  lottery(number) { const before = snapshot(); doLottery(state, number); rerender(); showMoneyDelta(before); },
  chooseBig(type) { doChooseBig(state, type); rerender(); },
  again() { showSetup(); },
  card(i) {
    const p = current(state);
    const id = p.cards[i];
    if (!id) return;
    const def = CARD_DEFS[id];
    if (!def) return;
    if (def.target === 'cell') {
      state.mapPick = { index: i, kind: 'cell' };
      rerender();
      return;
    }
    if (def.target !== 'self' && def.target !== 'all') {
      renderTargetPicker(state, p, i, def.target);
      return;
    }
    const before = snapshot();
    useCard(state, i, null);
    rerender();
    showMoneyDelta(before);
  },
};

function snapshot() {
  if (!state) return [];
  return state.players.map(p => ({ id: p.id, cash: p.cash, deposit: p.deposit }));
}

function showMoneyDelta(before) {
  if (!before) return;
  state.players.forEach(p => {
    const old = before.find(x => x.id === p.id);
    if (!old) return;
    const delta = (p.cash + p.deposit) - (old.cash + old.deposit);
    if (!delta) return;
    const tok = document.querySelector(`[data-cell="${p.position}"] [data-player="${p.id}"]`);
    const rect = tok?.getBoundingClientRect();
    const span = document.createElement('span');
    span.className = 'money-float map-float ' + (delta > 0 ? 'up' : 'down');
    span.textContent = (delta > 0 ? '+' : '') + delta.toLocaleString();
    if (rect) {
      span.style.position = 'fixed';
      span.style.left = `${rect.left + rect.width / 2}px`;
      span.style.top = `${rect.top - 4}px`;
    }
    document.body.appendChild(span);
    setTimeout(() => span.remove(), 1300);
  });
}

function flashPath() {
  const path = state.lastRoll?.path ?? [];
  path.forEach((id, i) => {
    const cell = root.board.querySelector(`[data-cell="${id}"]`);
    if (!cell) return;
    setTimeout(() => cell.classList.add('path'), i * 70);
    setTimeout(() => cell.classList.remove('path'), 450 + i * 70);
  });
}

function animateDice(ms) {
  return new Promise(resolve => {
    const start = Date.now();
    const timer = setInterval(() => {
      root.dice.innerHTML = `<button>${1 + Math.floor(Math.random() * 6)}</button>`;
      if (Date.now() - start > ms) {
        clearInterval(timer);
        resolve();
      }
    }, 55);
  });
}

function numberInput() { return Number($('#amount')?.value ?? 0); }

function renderTargetPicker(state, p, i, kind) {
  const id = p.cards[i];
  let body = '';
  if (kind === 'player') {
    body = state.players.filter(q => q.alive && q.id !== p.id).map(q =>
      `<button data-target="${q.id}">${q.name}（${q.team}）</button>`).join('');
  } else if (kind === 'street') {
    body = ['A', 'B', 'C', 'D'].map(s => `<button data-target="${s}">${s} 街</button>`).join('');
  } else if (kind === 'cell') {
    body = `<select id="cellTarget">${state.map.nodes.map(n =>
      `<option value="${n.id}">${n.label}</option>`).join('')}</select>
      <button data-pickcell="1">确定</button>`;
  }
  root.choice.hidden = false;
  root.cards.hidden = true;
  root.dice.hidden = true;
  root.choice.innerHTML = `<h3>选择目标：${CARD_DEFS[id].name}</h3>${body}<button data-cancel="1">取消</button>`;
  root.choice.querySelectorAll('button[data-target]').forEach(b => b.onclick = () => {
    if (b.dataset.target) useCard(state, i, b.dataset.target);
    rerender();
  });
  const pick = root.choice.querySelector('button[data-pickcell]');
  if (pick) pick.onclick = () => { useCard(state, i, $('#cellTarget').value); rerender(); };
  root.choice.querySelector('[data-cancel]').onclick = () => rerender();
}

function rerender() {
  if (state) render(root, state, actions);
}

function initSideResize() {
  const side = $('#side'), grip = $('#sideGrip');
  if (!grip) return;
  let dragging = false;
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    dragging = true;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', e => {
    if (!dragging) return;
    const w = Math.max(300, Math.min(680, window.innerWidth - e.clientX));
    document.documentElement.style.setProperty('--side-w', `${Math.round(w)}px`);
  });
  grip.addEventListener('pointerup', () => { if (dragging) { dragging = false; rerender(); } });
  grip.addEventListener('pointercancel', () => { dragging = false; });
}

function startGame() {
  const mode = $('#mode').value;
  const count = Number($('#count').value);
  const participants = [];
  if (mode === 'free') {
    for (let i = 0; i < count; i++) {
      const c = CHARACTERS[i % CHARACTERS.length];
      participants.push({ name: c.name, charId: c.id, team: `t${i + 1}`, controller: 'human' });
    }
  } else {
    for (let i = 0; i < Math.max(1, count - 1); i++) {
      const c = CHARACTERS[i % CHARACTERS.length];
      participants.push({ name: c.name, charId: c.id, team: 'ch', controller: 'human' });
    }
    const b = BOSSES.find(x => x.id === $('#boss').value) ?? BOSSES[0];
    participants.push({ name: b.name, charId: CHARACTERS[0].id, team: 'boss', controller: 'human', isBoss: true, bossId: b.id, bossTier: Number($('#tier').value), color: b.color });
  }
  state = createGame({ seed: 1, participants });
  $('#setup').hidden = true;
  rerender();
}

function showSetup() { $('#setup').hidden = false; }

$('#boss').innerHTML = BOSSES.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
$('#mode').onchange = () => { $('#bossRow').hidden = $('#mode').value !== 'boss'; };
$('#start').onclick = startGame;
initSideResize();
showSetup();

const qs = new URLSearchParams(location.search);
if (qs.get('mode')) $('#mode').value = qs.get('mode');
if (qs.get('count')) $('#count').value = qs.get('count');
if (qs.get('boss')) $('#boss').value = qs.get('boss');
if (qs.get('tier')) $('#tier').value = qs.get('tier');
$('#bossRow').hidden = $('#mode').value !== 'boss';
if (qs.get('start')) startGame();
if (qs.get('vehicle') && state) current(state).vehicle = Number(qs.get('vehicle'));
if (qs.get('autoRoll')) actions.roll(Number(qs.get('autoRoll')));
