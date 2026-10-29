import { TUNING } from '../data/tuning.js';
import { CARD_DEFS, cardName, current } from '../engine/game.js';
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
  root.hud.innerHTML = `<span class="pill">第 ${state.day} 天</span>
    <span class="pill">物价 ${state.priceIndex.toFixed(2)}</span>
    <span class="pill">${state.phase === 'over' ? '结束' : state.phase}</span>
    <span class="pill">seed ${state.seed}</span>`;
  renderPlayers(root.players, state, p, actions);
  renderBoard(root.board, state, p);
  renderActions(root.actions, state, p, actions);
  renderLog(root.log, state);
  renderHand(root, state, p, actions);
}

function renderBoard(el, state, currentP) {
  const W = 920, H = 920;
  const nodes = state.map.nodes;
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const platformOn = isPlatformActive(state.map, state.day);
  const lines = state.map.edges.map(e => {
    const a = byId[e.a], b = byId[e.b];
    const off = e.kind === 'platform' && !platformOn;
    return `<line x1="${a.x + 31}" y1="${a.y + 19}" x2="${b.x + 31}" y2="${b.y + 19}"
      stroke="${off ? '#7a2a2a' : e.kind === 'platform' ? '#8a6a2a' : '#333842'}"
      stroke-width="${e.kind === 'road' ? 2 : 3}" stroke-dasharray="${off ? '4 6' : e.kind === 'side' ? '6 4' : ''}" />`;
  }).join('');

  const cells = nodes.map(n => {
    const pr = state.properties[n.id];
    const owner = pr?.ownerId ? state.players.find(q => q.id === pr.ownerId) : null;
    const here = state.players.filter(q => q.alive && q.position === n.id);
    const place = state.placements[n.id];
    const tag = KIND_TAG[n.kind] ?? '?';
    const big = BIG_TAG[n.bigType] ?? '';
    const border = owner ? owner.color : '#333842';
    const off = n.kind === 'platform' && !platformOn;
    return `<div class="cell ${off ? 'off' : ''}" style="left:${n.x}px;top:${n.y}px;border-color:${border}"
      title="${n.label}${pr ? ` · Lv.${pr.level}` : ''}">
      <div class="tag">${tag}${big ? '·' + big : ''} ${n.label}</div>
      <div class="lvl">${pr ? 'Lv' + pr.level : ''}</div>
      ${place ? `<div class="place">${place.kind === 'mine' ? '雷' : place.kind === 'dynamite' ? '炸' : '障'}</div>` : ''}
      <div class="tokens">${here.map(q => `<span class="tok ${q.id === currentP?.id ? 'cur' : ''}" style="background:${q.color}" title="${q.name}">${q.name[0]}</span>`).join('')}</div>
    </div>`;
  }).join('');

  const availW = Number(el.clientWidth) || 920;
  const availH = Number(el.clientHeight) || 920;
  const scale = Math.max(0.45, Math.min(1, (availW - 42) / W, (availH - 16) / H));
  el.innerHTML = `<div class="board-inner" style="width:${W}px;height:${H}px;transform:scale(${scale});transform-origin:0 0">` +
    `<svg width="${W}" height="${H}" style="position:absolute;inset:0">${lines}</svg>${cells}</div>`;
}

function renderPlayers(el, state, currentP, actions) {
  el.innerHTML = `<div class="side-head"><span>角色</span><button data-reset="1">重开</button></div>` + state.players.map(p => {
    const cls = p.id === currentP?.id ? 'player cur' : 'player';
    return `<div class="${cls}" style="border-left-color:${p.color}">
      <div class="ptitle">
        <span class="avatar" style="background:${p.color}">${p.name[0]}</span>
        <span>${p.name}</span>
        <span class="team">${p.team}${p.isBoss ? ` · T${p.bossTier}` : ''}</span>
        ${p.isBoss ? '<span class="boss">BOSS</span>' : ''}
      </div>
      <div class="prow">现金 ${p.cash.toLocaleString()} · 存款 ${p.deposit.toLocaleString()} · 资产 ${assetsOf(state, p).toLocaleString()}</div>
      <div class="prow">位置 ${state.map.nodes.find(n => n.id === p.position)?.label ?? '-'} · 卡 ${p.cards.length}/${p.handLimit}</div>
      <div class="slots">
        <span class="slot">神 <b>${p.god ?? '—'}</b></span>
        <span class="slot">状态 <b>${p.status ?? '—'}</b></span>
        <span class="slot">载具 <b>${p.vehicle ?? '—'}</b></span>
      </div>
      ${p.jail ? `<div class="bad">监禁 ${p.jail}</div>` : ''}
      ${p.hospital ? `<div class="bad">住院 ${p.hospital}</div>` : ''}
    </div>`;
  }).join('');
  el.querySelector('[data-reset]').onclick = () => actions.again();
}

function renderActions(el, state, p, actions) {
  if (state.phase === 'over') {
    const rows = [...state.players].sort((a, b) => assetsOf(state, b) - assetsOf(state, a))
      .map((x, i) => `<tr><td>${i + 1}</td><td>${x.name}</td><td>${x.team}</td><td>${assetsOf(state, x).toLocaleString()}</td><td>${x.alive ? '' : '破产'}</td></tr>`).join('');
    el.innerHTML = `<div class="big-msg">比赛结束，队伍 ${state.winnerTeam ?? '—'} 获胜</div>
      <table class="rank"><thead><tr><th>#</th><th>角色</th><th>队伍</th><th>资产</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <button data-act="again">再来一局</button>`;
    el.querySelector('[data-act="again"]').onclick = () => actions.again();
    return;
  }
  const pending = state.pending;
  if (pending?.type === 'buy') {
    el.innerHTML = `<h3>购买 ${state.map.nodes.find(n => n.id === pending.cellId).label}</h3>
      <p>售价 ${pending.price.toLocaleString()}</p>
      <button data-act="buy">买下</button><button data-act="skip">放弃</button>`;
  } else if (pending?.type === 'build') {
    el.innerHTML = `<h3>加盖 ${state.map.nodes.find(n => n.id === pending.cellId).label}</h3>
      <p>费用 ${pending.cost.toLocaleString()}</p>
      <button data-act="build">加盖</button><button data-act="skip">放弃</button>`;
  } else if (pending?.type === 'direction') {
    el.innerHTML = `<h3>选择方向</h3>${pending.options.map(id =>
      `<button data-dir="${id}">${state.map.nodes.find(n => n.id === id).label}</button>`).join('')}`;
  } else if (pending?.type === 'bank') {
    el.innerHTML = `<h3>银行</h3><input id="amount" type="number" value="10000" step="1000">
      <button data-act="deposit">存款</button><button data-act="withdraw">取款</button>
      <button data-act="leave">离开</button>`;
  } else if (pending?.type === 'stock') {
    el.innerHTML = `<h3>股票</h3>${state.stocks.map(s => `<div class="row">
      ${s.name} ${s.price.toFixed(1)} <button data-buy="${s.id}">买10</button>
      <button data-sell="${s.id}">卖10</button></div>`).join('')}
      <button data-act="leave">离开</button>`;
  } else if (pending?.type === 'lottery') {
    el.innerHTML = `<h3>乐透</h3><p>票价 ${TUNING.lotteryTicket}，奖池 ${state.lottery.jackpot}</p>
      <button data-act="ticket">买一张</button><button data-act="skip">离开</button>`;
  } else if (pending?.type === 'shop') {
    el.innerHTML = `<h3>商店</h3>${(state.shopOffer ?? []).map(id => `<button data-shop="${id}">${cardName(id)} 2000</button>`).join('')}
      <button data-act="skip">离开</button>`;
  } else if (pending?.type === 'research') {
    el.innerHTML = `<h3>研究所</h3>${(state.shopOffer ?? []).map(id => `<button data-research="${id}">${cardName(id)} 5000</button>`).join('')}
      <button data-act="skip">离开</button>`;
  } else if (pending?.type === 'magic') {
    el.innerHTML = `<h3>魔法屋</h3>
      <button data-magic="money">获得 10000</button>
      <button data-magic="lose">随机对手 -10000</button>
      <button data-magic="card">获得 1 张卡</button>
      <button data-magic="jail">随机对手入狱</button>`;
  } else if (pending?.type === 'news') {
    el.innerHTML = `<h3>新闻</h3><button data-act="news">看新闻</button>`;
  } else if (pending?.type === 'merchant') {
    el.innerHTML = `<h3>神秘人（1000/张）</h3>${(state.shopOffer ?? []).map(id => `<button data-merchant="${id}">${cardName(id)}</button>`).join('')}
      <button data-act="skip">离开</button>`;
  } else if (state.phase === 'action') {
    el.innerHTML = `<h3>${p.name} 的行动</h3><p class="hint">先用卡/存取款，再在右下掷骰；掷骰后回合结束。</p>`;
  } else {
    el.innerHTML = `<h3>结算中</h3><button data-act="next">继续</button>`;
  }
  el.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => actions.act(b.dataset.act));
  el.querySelectorAll('button[data-dir]').forEach(b => b.onclick = () => actions.direction(b.dataset.dir));
  el.querySelectorAll('button[data-buy]').forEach(b => b.onclick = () => actions.stock(b.dataset.buy, 10, 'buy'));
  el.querySelectorAll('button[data-sell]').forEach(b => b.onclick = () => actions.stock(b.dataset.sell, 10, 'sell'));
  el.querySelectorAll('button[data-shop]').forEach(b => b.onclick = () => actions.shop(b.dataset.shop));
  el.querySelectorAll('button[data-research]').forEach(b => b.onclick = () => actions.research(b.dataset.research));
  el.querySelectorAll('button[data-magic]').forEach(b => b.onclick = () => actions.magic(b.dataset.magic));
  el.querySelectorAll('button[data-merchant]').forEach(b => b.onclick = () => actions.merchant(b.dataset.merchant));
}

function renderLog(el, state) {
  el.innerHTML = state.log.slice(-80).map(l => `<li>D${l.day} ${l.text}</li>`).join('');
  el.scrollTop = el.scrollHeight;
}

function maxDice(p) { return 1 + Math.max(0, p.vehicle ?? 0); }

function renderHand(root, state, p, actions) {
  if (!p) { root.dice.innerHTML = ''; root.cards.innerHTML = ''; return; }
  const canRoll = state.phase === 'action' && !state.pending;
  const max = Math.min(TUNING.maxDice, maxDice(p));
  root.dice.innerHTML = `<h3>骰子</h3>` +
    Array.from({ length: max }, (_, i) => `<button data-roll="${i + 1}" ${canRoll ? '' : 'disabled'}>${i + 1} 骰</button>`).join('') +
    `<div class="hint">${p.vehicle ? (p.vehicle === 2 ? '汽车：最多 3 骰' : '机车：最多 2 骰') : '步行：1 骰'}</div>`;
  root.dice.querySelectorAll('button[data-roll]').forEach(b => b.onclick = () => actions.roll(+b.dataset.roll));

  root.cards.innerHTML = p.cards.map((id, i) => {
    const def = CARD_DEFS[id];
    return `<button class="card" data-card="${i}" title="${def?.name ?? id}">
      <div class="art">${(def?.name ?? id).slice(0, 1)}</div>
      <div class="name">${def?.name ?? id}</div>
      <div class="meta"><span>${def?.target === 'self' ? '自身' : def?.target === 'all' ? '全场' : def?.target === 'player' ? '角色' : def?.target === 'cell' ? '地块' : '街道'}</span><span>${i + 1}</span></div>
    </button>`;
  }).join('') + `<span class="handhint">${p.cards.length}/${p.handLimit}</span>`;
  root.cards.querySelectorAll('button[data-card]').forEach(b => b.onclick = () => actions.card(+b.dataset.card));
}
