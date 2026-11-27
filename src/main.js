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
import { createSliceConfig, SLICE_STYLES, SLICE_CARDS } from './data/slice.js';
import { reachableLandings } from './engine/insight.js';

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
  log: $('#log'), insight:$('#insight'), dice: $('#dice'), cards: $('#cards'), hand: $('#hand'), choice: $('#choice'),
};

let state = null;
let active = null; // { prompt, resolve }
let rollFocus = null;
function clearRollFocus() {
  const ticket = rollFocus;
  rollFocus = null;
  ticket?.watch.abort();
  return ticket;
}
function clearRollSession(session) {
  if (rollFocus?.state === session) clearRollFocus();
}
function sameRollTurn(ticket) {
  return !!ticket && ticket.state === state && !state.over && ticket.day === state.day &&
    ticket.turn === state.turn && state.order[state.turn] === ticket.player.id;
}
function armRollFocus(event) {
  clearRollFocus();
  const origin = event?.currentTarget;
  const player = active?.prompt.player;
  // A native keyboard activation uses the button's trusted, zero-detail click.
  if (!state?.slice || state.over || active?.prompt.type !== 'action' || player?.controller !== 'human' ||
      state.order[state.turn] !== player.id || !event?.isTrusted || event.detail !== 0 || event.pointerType ||
      !origin || origin !== document.activeElement || !document.hasFocus() || !root.dice.contains(origin)) return;
  const watch = new AbortController();
  rollFocus = {state, day: state.day, turn: state.turn, player, origin, watch};
  const options = {capture: true, signal: watch.signal};
  document.addEventListener('focusin', clearRollFocus, options);
  // A click on the nonfocusable board can leave BODY active and emit no focusin.
  document.addEventListener('pointerdown', e => { if (e.isTrusted) clearRollFocus(); }, options);
  window.addEventListener('blur', clearRollFocus, {signal: watch.signal});
}
function handoffRollFocus(ticket, prompt) {
  if (!sameRollTurn(ticket) || prompt.type !== 'direction' || prompt.player !== ticket.player ||
      state.pending?.type !== 'direction' || state.mapPick || root.choice.hidden || !document.hasFocus()) return;
  const activeElement = document.activeElement;
  if (activeElement !== ticket.origin && activeElement !== document.body) return;
  const first = [...root.choice.querySelectorAll('button[data-dir]:not(:disabled)')]
    .find(button => button.getClientRects().length && getComputedStyle(button).visibility === 'visible');
  first?.focus(); // Let native focus scroll the existing route layout; no scroll override.
}
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
  if (rollFocus && !sameRollTurn(rollFocus)) clearRollFocus();
  if (!state) return;
  // 「画出来可点」必须等于「点了会被接住」：answerable 由答案槽 active 决定，
  // 气泡在播、回合已作答而引擎还没前进时，掷骰键与手牌就不该看起来能用。
  render(root, state, actions, {answerable: !!active});
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
      if (!propertyChanged && !state.slice) say(p, delta > 0 ? 'gain' : 'lose');
    }
    if (prev) {
      const gained = p.cards.filter((id, i) => !prev.cards.includes(id));
      const lost = prev.cards.filter((id, i) => !p.cards.includes(id));
      if (gained.length) { spawnFloat(p, '+' + ((state.slice?SLICE_CARDS:CARD_DEFS)[gained[0]]?.name ?? '卡'), 'card'); if(!state.slice) say(p, 'card'); }
      if (lost.length) spawnFloat(p, '-' + ((state.slice?SLICE_CARDS:CARD_DEFS)[lost[0]]?.name ?? '卡'), 'card');
      if (p.god !== prev.god) { spawnFloat(p, p.god ? '+' + p.god : '-' + (prev.god ?? '神'), 'status'); say(p, 'god'); }
      if (p.status !== prev.status) spawnFloat(p, p.status ? '+' + p.status : '-' + (prev.status ?? '状态'), 'status');
      if (p.jail !== prev.jail) { spawnFloat(p, p.jail > prev.jail ? '+监狱' : '-监狱', 'status'); if (p.jail > prev.jail) say(p, 'jail'); }
      if (p.hospital !== prev.hospital) { spawnFloat(p, p.hospital > prev.hospital ? '+医院' : '-医院', 'status'); if (p.hospital > prev.hospital) say(p, 'hospital'); }
    }
  }
  lastMoney = new Map(state.players.map(p => [p.id, p.cash + p.deposit]));
  lastSnap = new Map(state.players.map(p => [p.id, { cards: [...p.cards], god: p.god, status: p.status, jail: p.jail, hospital: p.hospital, props: p.properties.length, built: p.properties.reduce((n, id) => n + (state.properties[id]?.level ?? 0), 0) }]));
}

// 人类已出局、全局还没结束：剩下的回合玩家没有任何决定可做，只是陪看。
// 这时按 outMs 走（只缩短等待，不跳过回合、不改结算），否则出局之后还要以正常速度
// 陪 AI 打完剩几天（实测 seed1 take 13.5s、seed4 grow 15.8s）。
function watchingOnly(state) {
  if (!state?.slice || state.over) return false;
  const human = state.players.find(q => q.controller === 'human');
  return !!human && !human.alive;
}
const paceMs = (state, normalMs) => (watchingOnly(state) ? EXPERIENCE.slice.outMs : normalMs);

const ui = {
  render: rerender,
  say: (p, event) => state.slice?Promise.resolve():say(p, event),
  async step() {
    rerender();
    await wait(state.slice?paceMs(state, EXPERIENCE.slice.stepMs):EXPERIENCE.stepMs);
    // 移动途中触发的金钱/状态台词也会先播完，再走下一格。
    await flushSpeech();
  },
  async ask(prompt) {
    // #3278：人类这一屏要在气泡播完**之前**就画出来，并接住这段时间里的点击。
    //   旧顺序 `await flushSpeech()` → `active = {…}` 有两个洞：
    //   (a) 气泡期间（每句 1.2–1.8s）flow.js 早已 render 过本屏（phase='action'、pending=null）
    //       ⇒ 掷骰键/手牌画成可用，`answer()` 却因 active==null 静默丢掉每一次点击；
    //   (b) 上一屏留下的 active 会吞下这次点击，把旧答案再交回引擎（重渲染成同一屏）。
    //   现在：先换槽、画屏，再等气泡；气泡期间点中的答案立刻被接住，引擎在 settle 里
    //   等气泡播完再继续（引擎时序不变，点击不再丢）。
    const ticket = rollFocus;
    const takeHandoff = () => (ticket && ticket === rollFocus ? clearRollFocus() : null);
    if (prompt.player?.controller === 'ai') {
      // AI 分支原样：先等气泡，再按节奏作答。
      await flushSpeech();
      takeHandoff();
      await wait(state.slice?paceMs(state, EXPERIENCE.slice.aiMs):aiPauseMs(prompt.type));
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
      // 键盘续接等气泡播完再做（那时焦点还在原处）；气泡期间已作答就不再抢焦点。
      flushSpeech().then(() => {
        if (!active || active.prompt !== prompt) return;
        handoffRollFocus(takeHandoff(), prompt);
      });
    });
  },
};

function answer(value) {
  if (!active) return;
  const { resolve, prompt } = active;
  active = null;
  state.pending = null;
  state.mapPick = null;
  state.previewSteps=null;
  // #3278：槽空了就必须立刻改画面。action 屏在作答之后、引擎前进之前（settle 里还等着
  // 气泡播完）没有再画过一次，于是 roll/手牌继续 enabled 而点击被丢掉 —— 玩家在同一个屏上
  // 连点 20 次、每次都被静默吞掉（OUT-S-360-ask pressLog[40..59]，logLen 恒 3535）。
  // 只对 action 屏这么做：其它屏（direction/buy/...）若在这里抢先重画，会先把它们翻成
  // 动作屏再被引擎换掉，那是另一种闪烁，记在 RESULT 的残余里而不是顺手改。
  if (prompt?.type === 'action') rerender();
  // #3319c：上面的「只对 action」在补给/选街这类屏上留下同一个洞 —— 实测 D4 补给屏
  // 被连点 13 次、每次 hit=itself、logLen 恒 1314，直到气泡播完才关。原因不是节奏：
  // 点中的是**真的那颗按钮**，answer() 已经清了槽，但屏还画在那里，后面 12 次点击
  // 全部被 `if (!active) return;` 静默丢掉，玩家看不出「这一下已经收下了」。
  //
  // 修法与 action 屏同一条规矩（「画出来可点」必须等于「点了会被接住」）：
  // 作答后立刻把这一屏的按钮全部置灰。不改 DOM 结构、不换屏、不等引擎，
  // 引擎随后画出的屏会照常覆盖它。`disabled` 同时也让驱动器的 F6 判据
  // （「按下的控件自己有没有销账」）对非动作屏成立，那条判据此前只对动作屏发言。
  else if (prompt && prompt.type) {
    const panel = document.querySelector('#choice');
    panel?.querySelectorAll('button').forEach(b => { b.disabled = true; });
  }
  resolve(value);
}

function applyPromptToState(p) {
  state.pending = null;
  state.mapPick = null;
  if (!p) return;
  if(p.type==='supply'||p.type==='discard') {state.pending={...p,player:undefined};return;}
  if (p.type === 'action') return;
  if (p.type === 'diceValue' || p.type === 'steps') { state.pending = { type: p.type, min: p.min, max: p.max }; return; }
  if (p.type === 'target') {
    if (p.kind === 'cell') {
      const cells = p.max ? [...reachableWithin(state.map, p.player.position, p.max)] : null;
      state.mapPick = { max: p.max, cells, cardId: p.cardId };
    } else if (p.kind === 'street' || p.kind === 'plot') {
      state.mapPick = { plot: true, value: p.kind, filter: p.plotFilter, playerId: p.player?.id, cardId:p.cardId, plotIds:p.plotIds };
    }
    state.pending = { type: 'target', kind: p.kind, cardId: p.cardId, label: p.label, players: p.players };
    return;
  }
  if (p.type === 'buy') { state.pending = { type: 'buy', cellId: p.plot.id, price: p.price, label: p.plot.big ? '大空地' : '小地产', level: p.level ?? 0, bigType: p.bigType ?? null }; return; }
  if (p.type === 'build') { state.pending = { type: 'build', cellId: p.plot.id, cost: p.cost, label: p.plot.big ? '大空地' : '小地产' }; return; }
  if (p.type === 'chooseBig') { state.pending = { type: 'chooseBig', cellId: p.plot.id }; return; }
  if (p.type === 'direction') { state.pending = { type: 'direction', options: p.options, remainingSteps:p.remainingSteps }; return; }
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
  if(state.mapPick?.plotIds && !state.mapPick.plotIds.includes(plot.id)) return false;
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
  supply(id) {answer(id);},
  discard(index) {answer(index);},
  // 结算屏的「换个打法，再开一局」要落回**能再开一局**的地方。以前它删掉 slice/style，
  // 于是落到完整模式设置页（12 张地图、人数、地图下拉），而且三种起手一个都没预选：
  // 第一次玩完的人想再来一局，先要在一堆完整模式选项里找到切片入口再重选起手。
  // 390 整局实测就是这样（record-10-replay.json：sliceEntryAfterReplay=false, picks=[]）。
  // 现在回到切片第一屏、保留刚才那手起手、只把种子 +1：换打法是一个选择，不是重新找路。
  replay() {
    const me = state.players?.find(p => p.controller === 'human');
    const style = me?.style ?? state.config?.participants?.[0]?.style;
    const url = new URL(location.href);
    url.searchParams.delete('start');
    url.searchParams.set('slice', '1');
    if (style) url.searchParams.set('style', style); else url.searchParams.delete('style');
    url.searchParams.set('seed', state.seed + 1);
    location.href = url.href;
  },
  preview(n) {
    const p=state.players.find(p=>p.id===state.order[state.turn]);
    const ids=new Set(n==null?[]:reachableLandings(state,p,n));
    document.querySelectorAll('[data-cell]').forEach(el=>el.classList.toggle('landing-preview',ids.has(el.dataset.cell)));
  },
  roll(n, event) { armRollFocus(event); answer({ action: 'roll', dice: n }); },
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

function readSetupSeed() {
  const seed = $('#seed').valueAsNumber;
  return Number.isFinite(seed) ? seed : 1;
}

function startGame() {
  clearRollFocus();
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
  const seed = readSetupSeed();
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
// 三种起手强度不同，默认不勾任何一项：必须由玩家选一手再开局。
$('#sliceStyles').innerHTML=SLICE_STYLES.map(s=>`<label class="style-choice"><input type="radio" name="sliceStyle" value="${s.id}"><strong>${s.name}</strong><span>${s.hook}</span></label>`).join('');
function startSlice() {
  clearRollFocus();
  const picked=document.querySelector('[name="sliceStyle"]:checked')?.value;
  if(!SLICE_STYLES.some(s=>s.id===picked)) {
    const note=$('#sliceStyleNote');
    if(note) {note.hidden=false;note.textContent='先选一手起手（街角店主 / 机会买家 / 穿街高手），再开一局。';}
    return;
  }
  const style=picked;
  const seed=readSetupSeed();
  state=startSession(createSliceConfig({style,seed}));
  lastMoney=null;lastSnap=null;lastNews=0;
  document.body.classList.add('slice-mode');
  $('#setup').hidden=true;
  const session = state;
  runGame(session, ui).then(() => {
    clearRollSession(session);
    if (state === session) ui.render(session);
  }).catch(error => {
    clearRollSession(session);
    console.error(error);
    if (state !== session) return;
    root.choice.hidden = false;
    root.choice.textContent = `对局暂停：${error.message}`;
  });
}
$('#startSlice').onclick=startSlice;
renderSetupRows();
showSetup();

const qs = new URLSearchParams(location.search);
if (qs.get('count')) { $('#count').value = qs.get('count'); renderSetupRows(); }
if (qs.get('seed')) $('#seed').value = qs.get('seed');
if (qs.get('testcards')) $('#testcards').checked = true;
// 三种起手强度差很大，必须由玩家自己选。带 slice 参数只停在第一屏，不再自动开局；
// 想直接指定起手可加 style=grow|take|cross，但仍需玩家点「开一局街角生意」。
if (qs.get('slice')) {
  document.body.classList.add('slice-entry');
  const preset = qs.get('style');
  if (SLICE_STYLES.some(s => s.id === preset)) {
    const radio = document.querySelector(`[name="sliceStyle"][value="${preset}"]`);
    if (radio) radio.checked = true;
  }
} else if (qs.get('start')) startGame();
