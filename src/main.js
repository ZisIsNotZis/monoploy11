import {
  createGame, roll, buyProperty, buildProperty, chooseDirection, useCard,
  doBank, doStock, leaveStock, doLottery, doMagic, doNews, doMerchant,
  doShop, doResearch, skipPending, current, CARD_DEFS, leavePending, openStock,
} from './engine/game.js';
import { render } from './ui/render.js';
import { CHARACTERS } from './data/characters.js';
import { BOSSES } from './data/bosses.js';



const $ = s => document.querySelector(s);
const root = {
  system: $('#system'), players: $('#players'), board: $('#board'),
  actions: $('#actions'), log: $('#log'), dice: $('#dice'), cards: $('#cards'),
  modal: $('#modal'), logToggle: $('#logToggle'),
};

let state = null;

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
  openStock() { openStock(state); rerender(); },
  stock(id, qty, side) { doStock(state, id, qty, side); rerender(); },
  shop(index) { doShop(state, index); rerender(); },
  research(index) { doResearch(state, index); rerender(); },
  merchant(index) { doMerchant(state, index); rerender(); },
  magic(effect) { doMagic(state, effect); rerender(); },
  again() { showSetup(); root.modal.hidden = true; root.modal.innerHTML = ''; },
  card(i) {
    const p = current(state);
    const id = p.cards[i];
    if (!id) return;
    const def = CARD_DEFS[id];
    if (!def) return;
    if (def.target !== 'self' && def.target !== 'all') {
      renderTargetPicker(state, p, i, def.target);
      return;
    }
    useCard(state, i, null);
    rerender();
  },
};

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
  root.modal.dataset.target = '1';
  root.modal.hidden = false;
  root.modal.innerHTML = `<div class="modal-box"><h3>选择目标：${CARD_DEFS[id].name}</h3>${body}
    <button data-cancel="1">取消</button></div>`;
  root.modal.querySelectorAll('button[data-target]').forEach(b => b.onclick = () => {
    const target = b.dataset.target || null;
    if (target) useCard(state, i, target);
    closeTarget();
  });
  const pick = root.modal.querySelector('button[data-pickcell]');
  if (pick) pick.onclick = () => {
    useCard(state, i, $('#cellTarget').value);
    closeTarget();
  };
  root.modal.querySelector('[data-cancel]').onclick = closeTarget;
}

function closeTarget() {
  root.modal.dataset.target = '';
  root.modal.hidden = true;
  root.modal.innerHTML = '';
  rerender();
}

function rerender() {
  if (state) render(root, state, actions);
}

function startGame() {
  const mode = $('#mode').value;
  const count = Number($('#count').value);
  const seed = 1;
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
    participants.push({
      name: b.name, charId: CHARACTERS[0].id, team: 'boss', controller: 'human',
      isBoss: true, bossId: b.id, bossTier: Number($('#tier').value), color: b.color,
    });
  }
  state = createGame({ seed, participants });
  $('#setup').hidden = true;
  rerender();
}

function showSetup() {
  $('#setup').hidden = false;
}

$('#boss').innerHTML = BOSSES.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
$('#mode').onchange = () => { $('#bossRow').hidden = $('#mode').value !== 'boss'; };
$('#start').onclick = startGame;
root.logToggle.onclick = () => { root.log.hidden = !root.log.hidden; };
showSetup();

const qs = new URLSearchParams(location.search);
if (qs.get('mode')) $('#mode').value = qs.get('mode');
if (qs.get('count')) $('#count').value = qs.get('count');
if (qs.get('boss')) $('#boss').value = qs.get('boss');
if (qs.get('tier')) $('#tier').value = qs.get('tier');
$('#bossRow').hidden = $('#mode').value !== 'boss';
if (qs.get('start')) startGame();
if (qs.get('autoRoll')) actions.roll(Number(qs.get('autoRoll')));
