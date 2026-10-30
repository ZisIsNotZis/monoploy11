import { startSession, runGame } from './engine/flow.js';
import { render } from './ui/render.js?v=150';
import { CHARACTERS } from './data/characters.js';
import { BOSSES } from './data/bosses.js';
import { reachableWithin } from './engine/board-v2.js';
import { CARD_DEFS, teamColor } from './engine/game.js';
import { aiAnswer } from './engine/ai.js';
import { EXPERIENCE, aiPauseMs, CSS_TIMINGS } from './data/experience.js';
import { say, flushSpeech } from './ui/speech.js?v=150';
import { avatarSvg } from './ui/icons.js?v=150';

const $ = s => document.querySelector(s);
// 右侧栏可拖动：宽度写进 CSS 变量，棋盘随之缩放。
const sideGrip = $('#sideGrip');
if (sideGrip) {
  let dragging = false;
  sideGrip.addEventListener('pointerdown', e => {
    dragging = true;
    sideGrip.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  window.addEventListener('pointermove', e => {
    if (!dragging) return;
    const w = Math.max(300, Math.min(620, window.innerWidth - e.clientX));
    document.documentElement.style.setProperty('--side-w', `${Math.round(w)}px`);
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    try { localStorage.setItem('monopoly11:side-w', getComputedStyle(document.documentElement).getPropertyValue('--side-w')); } catch {}
    if (state) rerender();
  };
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
  try {
    const saved = localStorage.getItem('monopoly11:side-w');
    if (saved) document.documentElement.style.setProperty('--side-w', saved);
  } catch {}
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const [name, value] of Object.entries(CSS_TIMINGS)) document.documentElement.style.setProperty(name, value);
const root = {
  system: $('#system'), players: $('#players'), board: $('#board'),
  log: $('#log'), dice: $('#dice'), cards: $('#cards'), hand: $('#hand'), choice: $('#choice'),
};

let state = null;
let active = null; // { prompt, resolve }
let lastMoney = null;
let lastSnap = null;
let lastNews = 0;
const floatStack = new Map();

function spawnFloat(p, text, kind) {
  const tok = document.querySelector(`[data-cell="${p.position}"] [data-player="${p.id}"]`);
  const rect = tok?.getBoundingClientRect();
  const span = document.createElement('span');
  span.className = `money-float map-float ${kind}`;
  span.textContent = text;
  if (rect) {
    span.style.left = `${rect.left + rect.width / 2}px`;
    const n = floatStack.get(p.id) ?? 0;
    floatStack.set(p.id, n + 1);
    span.style.top = `${rect.top - 4 - Math.min(2, n) * 20}px`;
    setTimeout(() => floatStack.set(p.id, Math.max(0, (floatStack.get(p.id) ?? 1) - 1)), EXPERIENCE.floatMs);
  }
  document.body.appendChild(span);
  setTimeout(() => span.remove(), EXPERIENCE.floatMs);
}

function rerender() {
  if (!state) return;
  render(root, state, actions);
  if (state.lastNews?.seq && state.lastNews.seq !== lastNews) {
    lastNews = state.lastNews.seq;
    const side = document.querySelector('#side');
    side?.querySelectorAll('.news-banner').forEach(x => x.remove());
    const banner = document.createElement('div');
    banner.className = 'news-banner';
    banner.textContent = state.lastNews.text;
    side?.appendChild(banner);
    setTimeout(() => banner.remove(), EXPERIENCE.newsMs);
  }
  if (!lastMoney) {
    lastMoney = new Map(state.players.map(p => [p.id, p.cash + p.deposit]));
    lastSnap = new Map(state.players.map(p => [p.id, { cards: [...p.cards], god: p.god, status: p.status, jail: p.jail, hospital: p.hospital, props: p.properties.length, built: p.properties.reduce((n, id) => n + (state.properties[id]?.level ?? 0), 0) }]));
    return;
  }
  for (const p of state.players) {
    const prev = lastSnap.get(p.id);
    const built = p.properties.reduce((n, id) => n + (state.properties[id]?.level ?? 0), 0);
    const propertyChanged = !!prev && (p.properties.length > prev.props || built > prev.built);
    const old = lastMoney.get(p.id);
    const now = p.cash + p.deposit;
    if (old != null && now !== old) {
      const delta = now - old;
      spawnFloat(p, (delta > 0 ? '+' : '') + delta.toLocaleString(), delta > 0 ? 'up' : 'down');
      if (!propertyChanged) say(p, delta > 0 ? 'gain' : 'lose');
    }
    if (prev) {
      const gained = p.cards.filter((id, i) => !prev.cards.includes(id));
      const lost = prev.cards.filter((id, i) => !p.cards.includes(id));
      if (gained.length) { spawnFloat(p, '+' + (CARD_DEFS[gained[0]]?.name ?? '卡'), 'card'); say(p, 'card'); }
      if (lost.length) spawnFloat(p, '-' + (CARD_DEFS[lost[0]]?.name ?? '卡'), 'card');
      if (p.god !== prev.god) { spawnFloat(p, p.god ? '+' + p.god : '-' + (prev.god ?? '神'), 'status'); say(p, 'god'); }
      if (p.status !== prev.status) spawnFloat(p, p.status ? '+' + p.status : '-' + (prev.status ?? '状态'), 'status');
      if (p.jail !== prev.jail) { spawnFloat(p, p.jail > prev.jail ? '+监狱' : '-监狱', 'status'); if (p.jail > prev.jail) say(p, 'jail'); }
      if (p.hospital !== prev.hospital) { spawnFloat(p, p.hospital > prev.hospital ? '+医院' : '-医院', 'status'); if (p.hospital > prev.hospital) say(p, 'hospital'); }
    }
  }
  lastMoney = new Map(state.players.map(p => [p.id, p.cash + p.deposit]));
  lastSnap = new Map(state.players.map(p => [p.id, { cards: [...p.cards], god: p.god, status: p.status, jail: p.jail, hospital: p.hospital, props: p.properties.length, built: p.properties.reduce((n, id) => n + (state.properties[id]?.level ?? 0), 0) }]));
}

const ui = {
  render: rerender,
  say: (p, event) => say(p, event),
  async step() {
    rerender();
    await wait(EXPERIENCE.stepMs);
    // 移动途中触发的金钱/状态台词也会先播完，再走下一格。
    await flushSpeech();
  },
  async ask(prompt) {
    // 上一轮 render 触发的气泡/语音先结束，避免 AI 在台词播放时继续行动。
    await flushSpeech();
    if (prompt.player?.controller === 'ai') {
      await wait(aiPauseMs(prompt.type));
      return aiAnswer(prompt, state);
    }
    return new Promise(resolve => {
      const settle = value => {
        // 人类点完按钮后也等当前气泡关闭，再让引擎继续。
        flushSpeech().then(() => resolve(value));
      };
      active = { prompt, resolve: settle };
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
  if (p.type === 'diceValue' || p.type === 'steps') { state.pending = { type: p.type, min: p.min, max: p.max }; return; }
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
  if (p.type === 'buy') { state.pending = { type: 'buy', cellId: p.plot.id, price: p.price, label: p.plot.big ? '大空地' : '小地产', level: p.level ?? 0, bigType: p.bigType ?? null }; return; }
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
  diceValue(n) { answer(n); },
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
  { value: 'random', id: 'random', name: '随机角色' },
  ...CHARACTERS.map(c => ({ value: `char:${c.id}`, id: c.id, name: c.name })),
  ...BOSSES.flatMap(b => [1,2,3].map(t => ({ value: `boss:${b.id}:${t}`, id: b.id, name: `${b.name}·${['简单','普通','困难'][t-1]}` }))),
];
function choiceMeta(value) {
  if (value === 'random') return { id: 'random', name: '随机角色' };
  if (value.startsWith('boss:')) {
    const [, id, tier] = value.split(':');
    const b = BOSSES.find(x => x.id === id);
    return { id, name: `${b?.name ?? id}·${['简单','普通','困难'][Number(tier)-1]}` };
  }
  const id = value.slice(5);
  const c = CHARACTERS.find(x => x.id === id);
  return { id, name: c?.name ?? id };
}
function characterOptions(selected) {
  return CHOICES.map(c => `<option value="${c.value}" ${c.value === selected ? 'selected' : ''}>${c.name}</option>`).join('');
}
function renderSetupRows() {
  const count = Number($('#count').value);
  const box = $('#setupRows');
  box.innerHTML = Array.from({ length: count }, (_, i) => {
    const teams = Array.from({ length: count }, (_, j) => `<option value="t${j+1}" ${i === j ? 'selected' : ''}>队伍 ${j+1}</option>`).join('');
    return `<div class="setup-player">
      <div class="player-card-avatar" data-i="${i}"></div>
      <div class="player-card-fields">
        <select class="ctrl"><option value="human">人类</option><option value="ai" ${i > 0 ? 'selected' : ''}>AI</option></select>
        <select class="char">${characterOptions('random')}</select>
        <select class="team">${teams}</select>
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('.setup-player').forEach(row => {
    row.querySelector('.char').onchange = refreshSetupColors;
    row.querySelector('.team').onchange = refreshSetupColors;
  });
  refreshSetupColors();
}
function refreshSetupColors() {
  const rows = [...document.querySelectorAll('.setup-player')];
  const teams = [...new Set(rows.map(r => r.querySelector('.team').value))];
  rows.forEach(row => {
    const team = row.querySelector('.team').value;
    const members = rows.filter(r => r.querySelector('.team').value === team);
    const color = teamColor(teams.indexOf(team), members.indexOf(row), members.length);
    const meta = choiceMeta(row.querySelector('.char').value);
    const avatar = row.querySelector('.player-card-avatar');
    avatar.innerHTML = avatarSvg(meta.id, color, meta.name);
    avatar.style.borderColor = color;
  });
}

function startGame() {
  const rows = [...document.querySelectorAll('.setup-player')];
  const used = new Set();
  const participants = rows.map((row, i) => {
    const controller = row.querySelector('.ctrl').value;
    const team = row.querySelector('.team').value;
    let value = row.querySelector('.char').value;
    if (value === 'random') {
      const pool = CHARACTERS.filter(c => !used.has(c.id));
      const c = pool.length ? pool[Math.floor(Math.random() * pool.length)] : CHARACTERS[i % CHARACTERS.length];
      value = `char:${c.id}`;
    }
    if (value.startsWith('boss:')) {
      const [, bossId, tier] = value.split(':');
      const b = BOSSES.find(x => x.id === bossId);
      return { name: b?.name ?? bossId, charId: bossId, team, controller, isBoss: true, bossId, bossTier: Number(tier) };
    }
    const charId = value.slice(5);
    const c = CHARACTERS.find(x => x.id === charId);
    used.add(charId);
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
    moneyCap: Number($('#moneyCap').value),
    priceIndexStart: Number($('#priceStart').value),
    priceIndexStep: Number($('#priceStep').value),
    priceIndexEveryDays: Number($('#priceEvery').value),
    monthlyInterest: Number($('#interestRate').value) / 100,
    interestEveryDays: Number($('#interestEvery').value),
    hospitalTurns: Number($('#hospitalDays').value),
    jailTurns: Number($('#jailDays').value),
    lotteryTicket: Number($('#lotteryTicket').value),
    lotteryEveryDays: Number($('#lotteryEvery').value),
    lotteryJackpotBase: Number($('#lotteryBase').value),
    smallPlotPrice: Number($('#smallPrice').value),
    bigPlotPrice: Number($('#bigPrice').value),
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
