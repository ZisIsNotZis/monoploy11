import { startSession, runGame } from './engine/flow.js';
import { render } from './ui/render.js?v=100';
import { CHARACTERS } from './data/characters.js';
import { BOSSES } from './data/bosses.js';
import { reachableWithin } from './engine/board-v2.js';
import { CARD_DEFS, teamColor } from './engine/game.js';
import { aiAnswer } from './engine/ai.js';
import { speak } from './ui/voice.js';
import { avatarSvg } from './ui/icons.js';

const $ = s => document.querySelector(s);
const root = {
  system: $('#system'), players: $('#players'), board: $('#board'),
  log: $('#log'), dice: $('#dice'), cards: $('#cards'), hand: $('#hand'), choice: $('#choice'),
};

let state = null;
let active = null; // { prompt, resolve }
let lastMoney = null;
let lastSnap = null;

function spawnFloat(p, text, kind) {
  const tok = document.querySelector(`[data-cell="${p.position}"] [data-player="${p.id}"]`);
  const rect = tok?.getBoundingClientRect();
  const span = document.createElement('span');
  span.className = `money-float map-float ${kind}`;
  span.textContent = text;
  if (rect) {
    span.style.left = `${rect.left + rect.width / 2}px`;
    span.style.top = `${rect.top - 4}px`;
  }
  document.body.appendChild(span);
  setTimeout(() => span.remove(), 1200);
}

function rerender() {
  if (!state) return;
  render(root, state, actions);
  if (!lastMoney) {
    lastMoney = new Map(state.players.map(p => [p.id, p.cash + p.deposit]));
    lastSnap = new Map(state.players.map(p => [p.id, { cards: [...p.cards], god: p.god, status: p.status, jail: p.jail, hospital: p.hospital }]));
    return;
  }
  for (const p of state.players) {
    const old = lastMoney.get(p.id);
    const now = p.cash + p.deposit;
    if (old != null && now !== old) {
      const delta = now - old;
      spawnFloat(p, (delta > 0 ? '+' : '') + delta.toLocaleString(), delta > 0 ? 'up' : 'down');
      speak(p, delta > 0 ? 'gain' : 'lose');
    }
    const prev = lastSnap.get(p.id);
    if (prev) {
      const gained = p.cards.filter((id, i) => !prev.cards.includes(id));
      const lost = prev.cards.filter((id, i) => !p.cards.includes(id));
      if (gained.length) { spawnFloat(p, '+' + (CARD_DEFS[gained[0]]?.name ?? '卡'), 'card'); speak(p, 'card'); }
      if (lost.length) spawnFloat(p, '-' + (CARD_DEFS[lost[0]]?.name ?? '卡'), 'card');
      if (p.god !== prev.god) { spawnFloat(p, p.god ? '+' + p.god : '-' + (prev.god ?? '神'), 'status'); speak(p, 'god'); }
      if (p.status !== prev.status) spawnFloat(p, p.status ? '+' + p.status : '-' + (prev.status ?? '状态'), 'status');
      if (p.jail !== prev.jail) { spawnFloat(p, p.jail > prev.jail ? '+监狱' : '-监狱', 'status'); if (p.jail > prev.jail) speak(p, 'jail'); }
      if (p.hospital !== prev.hospital) { spawnFloat(p, p.hospital > prev.hospital ? '+医院' : '-医院', 'status'); if (p.hospital > prev.hospital) speak(p, 'hospital'); }
    }
  }
  lastMoney = new Map(state.players.map(p => [p.id, p.cash + p.deposit]));
  lastSnap = new Map(state.players.map(p => [p.id, { cards: [...p.cards], god: p.god, status: p.status, jail: p.jail, hospital: p.hospital }]));
}

const ui = {
  render: rerender,
  async step() {
    rerender();
    await new Promise(r => setTimeout(r, 500));
  },
  ask(prompt) {
    if (prompt.player?.controller === 'ai') {
      return new Promise(resolve => setTimeout(() => resolve(aiAnswer(prompt, state)), 220));
    }
    return new Promise(resolve => {
      active = { prompt, resolve };
      applyPromptToState(prompt);
      rerender();
    });
  },
};

function answer(value) {
  if (!active) return;
  const { resolve } = active;
  active = null;
  state.pending = null;
  state.mapPick = null;
  resolve(value);
}

function applyPromptToState(p) {
  state.pending = null;
  state.mapPick = null;
  if (!p) return;
  if (p.type === 'action') return;
  if (p.type === 'target') {
    if (p.kind === 'cell') {
      const cells = p.max ? [...reachableWithin(state.map, p.player.position, p.max)] : null;
      state.mapPick = { max: p.max, cells, cardId: p.cardId };
    } else if (p.kind === 'street' || p.kind === 'plot') {
      state.mapPick = { plot: true, value: p.kind, filter: p.plotFilter, playerId: p.player?.id };
    }
    state.pending = { type: 'target', kind: p.kind, cardId: p.cardId, label: p.label, players: p.players };
    return;
  }
  if (p.type === 'buy') { state.pending = { type: 'buy', cellId: p.plot.id, price: p.price, label: p.plot.big ? '大空地' : '小地产' }; return; }
  if (p.type === 'build') { state.pending = { type: 'build', cellId: p.plot.id, cost: p.cost, label: p.plot.big ? '大空地' : '小地产' }; return; }
  if (p.type === 'chooseBig') { state.pending = { type: 'chooseBig', cellId: p.plot.id }; return; }
  if (p.type === 'direction') { state.pending = { type: 'direction', options: p.options }; return; }
  if (p.type === 'bank') { state.pending = { type: 'bank' }; return; }
  if (p.type === 'stock') { state.pending = { type: 'stock' }; return; }
  if (p.type === 'lottery') { state.pending = { type: 'lottery' }; return; }
  if (p.type === 'shop' || p.type === 'merchant' || p.type === 'research') {
    state.shopOffer = p.offers; state.shopBought = p.bought; state.shopLimit = p.limit;
    state.pending = { type: p.type };
    return;
  }
  if (p.type === 'response') { state.pending = { type: 'response', cardId: p.cardId, response: p.response, label: p.label }; return; }
  if (p.type === 'magic') { state.pending = { type: 'magic', options: p.options ?? [] }; return; }
}

function plotAllowed(plot) {
  const filter = state.mapPick?.filter;
  if (!filter) return true;
  const pr = state.properties[plot.id];
  const owner = pr?.ownerId ? state.players.find(q => q.id === pr.ownerId) : null;
  const playerId = state.mapPick?.playerId;
  const player = state.players.find(q => q.id === playerId);
  if (!player || !pr || plot.big || !(pr.level > 0)) return false;
  if (filter === 'teamBuiltSmall') return owner?.team === player.team && !pr.closed;
  if (filter === 'enemyBuiltSmall') return owner && owner.team !== player.team;
  return true;
}

const actions = {
  roll(n) { answer({ action: 'roll', dice: n }); },
  card(i) { answer({ action: 'card', index: i }); },
  openStock() { answer({ action: 'stock' }); },
  stock(id, qty, side) { answer({ action: side === 'buy' ? 'buy' : 'sell', stockId: id, qty }); },
  direction(id) { answer(id); },
  pickCell(id) { answer(id); },
  pickPlot(id) { const plot = state.map.plots.find(x => x.id === id); if (!plot) return; if (!plotAllowed(plot)) return; answer(state.mapPick?.value === 'street' ? plot.street : id); },
  chooseBig(type) { answer(type); },
  magic(id) { answer({ id }); },
  lottery(number) { answer({ action: 'buy', number }); },
  shop(index) { answer({ action: 'buy', index }); },
  merchant(index) { answer({ action: 'buy', index }); },
  research(index) { answer({ action: 'buy', index }); },
  act(name) {
    if (!active) return;
    const p = active.prompt;
    if (name === 'buy' || name === 'build') return answer(true);
    if (name === 'skip') return answer(false);
    if (name === 'leave') return answer({ action: 'leave' });
    if (name === 'news') return answer(true);
    if (name === 'bank-confirm') return answer({ action: 'bank', keep: numberInput() });
    if (name === 'yes') return answer(true);
    if (name === 'no') return answer(false);
    if (name === 'cancel-pick') return answer(null);
  },
  openBank() {},
};

function numberInput() { return Number($('#amount')?.value ?? 0); }

const CHOICES = [
  ...CHARACTERS.map(c => ({ value: `char:${c.id}`, id: c.id, name: c.name })),
  ...BOSSES.flatMap(b => [1,2,3].map(t => ({ value: `boss:${b.id}:${t}`, id: b.id, name: `${b.name}·${['简单','普通','困难'][t-1]}`, boss: true }))),
];
function choiceMeta(value) {
  if (value.startsWith('boss:')) {
    const [, id, tier] = value.split(':');
    const b = BOSSES.find(x => x.id === id);
    return { id, name: `${b?.name ?? id}·${['简单','普通','困难'][Number(tier)-1]}`, boss: true };
  }
  const id = value.slice(5);
  const c = CHARACTERS.find(x => x.id === id);
  return { id, name: c?.name ?? id, boss: false };
}
function pickerMarkup(value, color) {
  const meta = choiceMeta(value);
  return `<span class="picker-avatar">${avatarSvg(meta.id, color, meta.name)}</span><span class="picker-name">${meta.name}</span>`;
}
function renderSetupRows() {
  const count = Number($('#count').value);
  const box = $('#setupRows');
  box.innerHTML = Array.from({ length: count }, (_, i) => {
    const char = CHARACTERS[i % CHARACTERS.length];
    const teams = Array.from({ length: count }, (_, j) => `<option value="t${j+1}" ${i === j ? 'selected' : ''}>队伍 ${j+1}</option>`).join('');
    return `<div class="setup-player">
      <select class="ctrl" data-i="${i}"><option value="human">人类</option><option value="ai">AI</option></select>
      <div class="char-picker" data-value="char:${char.id}">
        <button type="button" class="char-current"></button>
        <div class="char-menu" hidden></div>
      </div>
      <select class="team" data-i="${i}">${teams}</select>
    </div>`;
  }).join('');
  box.querySelectorAll('.setup-player').forEach(row => {
    row.querySelector('.team').onchange = refreshSetupColors;
    row.querySelector('.char-current').onclick = () => {
      const menu = row.querySelector('.char-menu');
      menu.hidden = !menu.hidden;
    };
  });
  refreshSetupColors();
}
function refreshSetupColors() {
  const rows = [...document.querySelectorAll('.setup-player')];
  const teams = [...new Set(rows.map(r => r.querySelector('.team').value))];
  rows.forEach((row, i) => {
    const team = row.querySelector('.team').value;
    const members = rows.filter(r => r.querySelector('.team').value === team);
    const color = teamColor(teams.indexOf(team), members.indexOf(row), members.length);
    row.dataset.color = color;
    const picker = row.querySelector('.char-picker');
    const value = picker.dataset.value;
    const btn = picker.querySelector('.char-current');
    btn.innerHTML = pickerMarkup(value, color);
    const menu = picker.querySelector('.char-menu');
    menu.innerHTML = CHOICES.map(choice => `<button type="button" class="char-option ${choice.value === value ? 'sel' : ''}" data-value="${choice.value}"><span class="picker-avatar">${avatarSvg(choice.id, color, choice.name)}</span><span>${choice.name}</span></button>`).join('');
    menu.querySelectorAll('.char-option').forEach(opt => opt.onclick = () => {
      picker.dataset.value = opt.dataset.value;
      menu.hidden = true;
      refreshSetupColors();
    });
  });
}

function startGame() {
  const rows = [...document.querySelectorAll('.setup-player')];
  const participants = rows.map((row, i) => {
    const controller = row.querySelector('.ctrl').value;
    const team = row.querySelector('.team').value;
    const value = row.querySelector('.char-picker').dataset.value;
    if (value.startsWith('boss:')) {
      const [, bossId, tier] = value.split(':');
      const b = BOSSES.find(x => x.id === bossId);
      return { name: b?.name ?? bossId, charId: bossId, team, controller, isBoss: true, bossId, bossTier: Number(tier) };
    }
    const charId = value.slice(5);
    const c = CHARACTERS.find(x => x.id === charId);
    return { name: c?.name ?? charId, charId, team, controller };
  });
  const startingHand = $('#testcards').checked ? ['remotedice', 'roadblock', 'jelly', 'turn'] : undefined;
  const seed = Number($('#seed').value) || 1;
  state = startSession({
    seed, participants, startingHand,
    startingCash: Number($('#startingCash').value),
    startingDeposit: Number($('#startingDeposit').value),
    startingCards: Number($('#startingCards').value),
    handLimit: Number($('#handLimit').value),
    dayLimit: Number($('#dayLimit').value),
    mapId: $('#map').value,
  });
  $('#setup').hidden = true;
  runGame(state, ui).then(() => ui.render(state));
}

function showSetup() { $('#setup').hidden = false; }
$('#count').onchange = renderSetupRows;
$('#start').onclick = startGame;
renderSetupRows();
showSetup();

const qs = new URLSearchParams(location.search);
if (qs.get('count')) { $('#count').value = qs.get('count'); renderSetupRows(); }
if (qs.get('seed')) $('#seed').value = qs.get('seed');
if (qs.get('testcards')) $('#testcards').checked = true;
if (qs.get('start')) startGame();
