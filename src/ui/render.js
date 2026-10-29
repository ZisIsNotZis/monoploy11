import { TUNING } from '../data/tuning.js';
import { CARD_DEFS, current } from '../engine/game.js';
import { assetsOf } from '../engine/economy.js';
import { isPlatformActive } from '../engine/board.js';

const KIND_TAG = {
  start: '起', property: '地', big: '大', bank: '银', stock: '股', lottery: '彩',
  shop: '店', magic: '魔', news: '新', card: '卡', tax: '税', event: '事',
  god: '神', dog: '狗', beggar: '乞', merchant: '秘', hospitalGate: '医',
  jailGate: '监', hospital: '医', jail: '监', teleport: '传', platform: '机',
  empty: '·',
};
const BIG_TAG = {
  commercial: '商', hotel: '饭', bookstore: '书', energy: '能',
  realestate: '地', research: '研', park: '公',
};

export function render(root, state, actions) {
  const p = current(state);
  root.system.innerHTML = `<span class="pill">第 ${state.day} 天</span>
    <span class="pill">物价 ${state.priceIndex.toFixed(2)}</span>
    <span class="grow"></span>
    <button data-stock="1" ${state.phase === 'action' && !state.pending ? '' : 'disabled'}>股票</button>
    <button data-reset="1">重开</button>`;
  root.system.querySelector('[data-stock]').onclick = () => actions.openStock();
  root.system.querySelector('[data-reset]').onclick = () => actions.again();

  renderPlayers(root.players, state, p);
  renderBoard(root.board, state, p);
  renderActions(root.actions, state, p);
  renderHand(root, state, p, actions);
  renderLog(root, state);
  renderModal(root, state, p, actions);
}

function layout(map, W, H) {
  const cw = 62, ch = 38, margin = 34;
  const left = margin, top = margin, right = W - margin - cw, bottom = H - margin - ch;
  const stepX = (right - left) / 12, stepY = (bottom - top) / 12;
  const coords = {};
  for (const n of map.nodes) {
    if (n.ring === undefined) continue;
    const side = Math.floor(n.ring / 12), pos = n.ring % 12;
    if (side === 0) coords[n.id] = { x: left + pos * stepX, y: top };
    else if (side === 1) coords[n.id] = { x: right, y: top + pos * stepY };
    else if (side === 2) coords[n.id] = { x: right - pos * stepX, y: bottom };
    else coords[n.id] = { x: left, y: bottom - pos * stepY };
  }
  const g = (id) => coords[id] ?? { x: left, y: top };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const h = g('r30'), j = g('r31'), d = g('r43');
  coords.hospital = { x: clamp(h.x - 100, 8, right), y: clamp(h.y - 86, 8, bottom) };
  coords.jail = { x: clamp(j.x + 44, 8, right), y: clamp(j.y - 100, 8, bottom) };
  coords.t1 = { x: clamp(d.x + 120, 8, right), y: clamp(d.y - 10, 8, bottom) };
  coords.t2 = { x: clamp(d.x + 240, 8, right), y: clamp(d.y - 10, 8, bottom) };
  const a = g('r5'), b = g('r41');
  coords.p1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return coords;
}

function renderBoard(el, state, currentP) {
  const W = Math.max(360, el.clientWidth), H = Math.max(320, el.clientHeight);
  const coords = layout(state.map, W, H);
  const platformOn = isPlatformActive(state.map, state.day);
  const lines = state.map.edges.map(e => {
    const a = coords[e.a], b = coords[e.b];
    const off = e.kind === 'platform' && !platformOn;
    return `<line x1="${a.x + 31}" y1="${a.y + 19}" x2="${b.x + 31}" y2="${b.y + 19}"
      stroke="${off ? '#7a2a2a' : e.kind === 'platform' ? '#8a6a2a' : '#333842'}"
      stroke-width="${e.kind === 'road' ? 2 : 3}" stroke-dasharray="${off ? '4 6' : e.kind === 'side' ? '6 4' : ''}" />`;
  }).join('');

  const cells = state.map.nodes.map(n => {
    const c = coords[n.id];
    const pr = state.properties[n.id];
    const owner = pr?.ownerId ? state.players.find(q => q.id === pr.ownerId) : null;
    const here = state.players.filter(q => q.alive && q.position === n.id);
    const place = state.placements[n.id];
    const tag = KIND_TAG[n.kind] ?? '?';
    const big = BIG_TAG[n.bigType] ?? '';
    const border = owner ? owner.color : '#333842';
    const off = n.kind === 'platform' && !platformOn;
    return `<div class="cell ${off ? 'off' : ''}" style="left:${c.x}px;top:${c.y}px;border-color:${border}"
      title="${n.label}${pr ? ` · Lv.${pr.level}` : ''}">
      <div class="tag">${tag}${big ? '·' + big : ''} ${n.label}</div>
      <div class="lvl">${pr ? 'Lv' + pr.level : ''}</div>
      ${place ? `<div class="place">${place.kind === 'mine' ? '雷' : place.kind === 'dynamite' ? '炸' : place.kind === 'timebomb' ? '弹' : '障'}</div>` : ''}
      <div class="tokens">${here.map(q => `<span class="tok ${q.id === currentP?.id ? 'cur' : ''}" style="background:${q.color}" title="${q.name}">${q.name[0]}</span>`).join('')}</div>
    </div>`;
  }).join('');

  el.innerHTML = `<svg width="${W}" height="${H}" style="position:absolute;inset:0">${lines}</svg>${cells}`;
}

function renderPlayers(el, state, currentP) {
  el.innerHTML = state.players.map(p => {
    const cls = p.id === currentP?.id ? 'player cur' : 'player';
    return `<div class="${cls}" style="border-left-color:${p.color}">
      <div class="ptitle">
        <span class="avatar" style="background:${p.color}">${p.name[0]}</span>
        <span>${p.name}</span>
        <span class="team">${p.team}${p.isBoss ? ` · T${p.bossTier}` : ''}</span>
      </div>
      <div class="prow">现金 ${p.cash.toLocaleString()} · 存款 ${p.deposit.toLocaleString()}</div>
      <div class="prow">${state.map.nodes.find(n => n.id === p.position)?.label ?? '-'}${p.jail ? ' · 监禁' + p.jail : ''}${p.hospital ? ' · 住院' + p.hospital : ''}</div>
      <div class="slots"><span class="slot">神 <b>${p.god ?? '—'}</b></span><span class="slot">状态 <b>${p.status ?? '—'}</b></span><span class="slot">载具 <b>${p.vehicle ?? '—'}</b></span></div>
    </div>`;
  }).join('');
}

function renderActions(el, state, p) {
  if (state.phase === 'over') {
    const rows = [...state.players].sort((a, b) => assetsOf(state, b) - assetsOf(state, a))
      .map((x, i) => `<tr><td>${i + 1}</td><td>${x.name}</td><td>${x.team}</td><td>${assetsOf(state, x).toLocaleString()}</td><td>${x.alive ? '' : '破产'}</td></tr>`).join('');
    el.innerHTML = `<h3>比赛结束：${state.winnerTeam ?? '—'} 胜</h3>
      <table class="rank"><thead><tr><th>#</th><th>角色</th><th>队伍</th><th>资产</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    return;
  }
  if (state.pending) { el.innerHTML = `<span class="hint">等待选择…</span>`; return; }
  el.innerHTML = `<span class="hint">先用卡/股票，再掷骰；掷骰后回合结束。</span>`;
}

function maxDice(p) { return Math.min(TUNING.maxDice, 1 + Math.max(0, p.vehicle ?? 0)); }

function renderHand(root, state, p, actions) {
  if (!p) { root.dice.innerHTML = ''; root.cards.innerHTML = ''; return; }
  const canRoll = state.phase === 'action' && !state.pending;
  const max = maxDice(p);
  root.dice.innerHTML = Array.from({ length: max }, (_, i) =>
    `<button data-roll="${i + 1}" ${canRoll ? '' : 'disabled'}>${i + 1} 骰</button>`).join('');
  root.dice.querySelectorAll('button[data-roll]').forEach(b => b.onclick = () => actions.roll(+b.dataset.roll));
  root.cards.innerHTML = p.cards.map((id, i) => {
    const def = CARD_DEFS[id];
    return `<button class="card" data-card="${i}" title="${def?.name ?? id}">
      <div class="art">${(def?.name ?? id).slice(0, 1)}</div>
      <div class="name">${def?.name ?? id}</div>
    </button>`;
  }).join('');
  root.cards.querySelectorAll('button[data-card]').forEach(b => b.onclick = () => actions.card(+b.dataset.card));
}

function renderLog(root, state) {
  root.log.innerHTML = state.log.slice(-120).map(l => `<li>D${l.day} ${l.text}</li>`).join('');
}

function renderModal(root, state, p, actions) {
  if (!state.pending) {
    if (root.modal.dataset.target !== '1') { root.modal.hidden = true; root.modal.innerHTML = ''; }
    return;
  }
  const pending = state.pending;
  const box = (title, body) => `<div class="modal-box"><h3>${title}</h3>${body}</div>`;
  let html = '';
  if (pending.type === 'buy') {
    const n = state.map.nodes.find(x => x.id === pending.cellId);
    html = box(`购买 ${n.label}`, `<p>售价 ${pending.price.toLocaleString()}</p>
      <button data-act="buy">买下</button><button data-act="skip">放弃</button>`);
  } else if (pending.type === 'build') {
    const n = state.map.nodes.find(x => x.id === pending.cellId);
    html = box(`加盖 ${n.label}`, `<p>费用 ${pending.cost.toLocaleString()}</p>
      <button data-act="build">加盖</button><button data-act="skip">放弃</button>`);
  } else if (pending.type === 'direction') {
    html = box('选择方向', pending.options.map(id =>
      `<button data-dir="${id}">${state.map.nodes.find(n => n.id === id).label}</button>`).join(''));
  } else if (pending.type === 'bank') {
    html = box('银行', `<input id="amount" type="number" value="10000" step="1000">
      <div><button data-act="deposit">存款</button><button data-act="withdraw">取款</button>
      <button data-act="leave">离开</button></div>`);
  } else if (pending.type === 'stock') {
    html = box('股票', state.stocks.map(s => `<div class="row">
      ${s.name} ${s.price.toFixed(1)}
      <button data-buy="${s.id}">买 10</button><button data-sell="${s.id}">卖 10</button></div>`).join('') +
      `<button data-act="leave">关闭</button>`);
  } else if (pending.type === 'lottery') {
    html = box('乐透', `<p>票价 ${TUNING.lotteryTicket}，奖池 ${state.lottery.jackpot}</p>
      <button data-act="ticket">买一张</button><button data-act="skip">离开</button>`);
  } else if (pending.type === 'shop' || pending.type === 'merchant' || pending.type === 'research') {
    const title = pending.type === 'shop' ? `商店 ${state.shopBought}/${state.shopLimit}` :
      pending.type === 'merchant' ? `神秘人 ${state.shopBought}/${state.shopLimit}` : `研究所 ${state.shopBought}/${state.shopLimit}`;
    const dataKey = pending.type === 'shop' ? 'shop' : pending.type === 'merchant' ? 'merchant' : 'research';
    const offers = (state.shopOffer ?? []).map((item, i) => {
      const price = pending.type === 'shop' && p.talents.includes('shop_discount') ? Math.round(item.price / 2) : item.price;
      const disabled = state.shopBought >= state.shopLimit ? 'disabled' : '';
      return `<button class="offer" data-${dataKey}="${i}" ${disabled}><b>${CARD_DEFS[item.id]?.name ?? item.id}</b><span>${price}</span></button>`;
    }).join('');
    html = box(title, `<div class="offers">${offers}</div><button data-act="skip">离开</button>`);
  } else if (pending.type === 'magic') {
    html = box('魔法屋', `<button data-magic="money">获得 10000</button>
      <button data-magic="lose">随机对手 -10000</button>
      <button data-magic="card">获得 1 张卡</button>
      <button data-magic="jail">随机对手入狱</button>`);
  } else if (pending.type === 'news') {
    html = box('新闻', `<button data-act="news">看新闻</button>`);
  } else {
    html = box('处理中', `<button data-act="skip">继续</button>`);
  }
  root.modal.hidden = false;
  root.modal.innerHTML = html;
  bindModal(root.modal, actions);
}

function bindModal(el, actions) {
  el.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => actions.act(b.dataset.act));
  el.querySelectorAll('button[data-dir]').forEach(b => b.onclick = () => actions.direction(b.dataset.dir));
  el.querySelectorAll('button[data-buy]').forEach(b => b.onclick = () => actions.stock(b.dataset.buy, 10, 'buy'));
  el.querySelectorAll('button[data-sell]').forEach(b => b.onclick = () => actions.stock(b.dataset.sell, 10, 'sell'));
  el.querySelectorAll('button[data-shop]').forEach(b => b.onclick = () => actions.shop(+b.dataset.shop));
  el.querySelectorAll('button[data-research]').forEach(b => b.onclick = () => actions.research(+b.dataset.research));
  el.querySelectorAll('button[data-magic]').forEach(b => b.onclick = () => actions.magic(b.dataset.magic));
  el.querySelectorAll('button[data-merchant]').forEach(b => b.onclick = () => actions.merchant(+b.dataset.merchant));
}
