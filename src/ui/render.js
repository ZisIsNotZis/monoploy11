import { TUNING } from '../data/tuning.js';
import { CARD_DEFS, current } from '../engine/game.js';
import { assetsOf } from '../engine/economy.js';
import { isPlatformActive } from '../engine/board.js';
import { CARD_DESC } from '../data/card-desc.js';

const KIND_TAG = {
  start: '起', property: '地', big: '大', bank: '银', stock: '股', lottery: '彩',
  shop: '店', magic: '魔', news: '新', card: '卡', tax: '税', event: '事',
  god: '神', dog: '狗', beggar: '乞', merchant: '秘', hospitalGate: '医',
  jailGate: '监', hospital: '医', jail: '监', teleport: '传', platform: '机',
  empty: '·',
};
const BIG_TAG = { commercial: '商', hotel: '饭', bookstore: '书', energy: '能', realestate: '地', research: '研', park: '公' };
const BIG_NAME = { commercial: '商业中心', hotel: '大饭店', bookstore: '书店', energy: '能源中心', realestate: '地产公司', research: '研究所', park: '公园' };
const GROUND_ICON = { start:'起', bank:'银', shop:'店', news:'新', card:'卡', tax:'税', event:'事', stock:'股', lottery:'彩', magic:'魔', hospital:'医', jail:'监', teleport:'传', platform:'机', empty:'·' };
const OCC_ICON = { god:'神', dog:'狗', beggar:'乞', merchant:'秘', mine:'雷', dynamite:'炸', timebomb:'弹', banana:'绊', jelly:'冻', trap:'陷', roadblock:'障' };
const BIG_HELP = { commercial: '转盘收租', hotel: '强制对手住店', bookstore: '离店额外得卡', energy: '对手买卡更贵、停留收钱', realestate: '己方应付租金降低', research: '研发进阶卡', park: '不收费，只能被改建卡改成公园' };
const CELL_HELP = {
  start: '经过或停留领取工资', property: '小地产：买地、加盖、收租',
  big: '大地产：先买空地，第二次投资时选择大型建筑',
  bank: '银行：存款、取款、每月利息', stock: '股票：随时买卖',
  lottery: '乐透：买 1–30 的号码，每 10 天开奖', shop: '商店：9 张卡，最多买 3 张',
  magic: '魔法屋：选择效果，随机对象', news: '新闻：随机事件',
  card: '经过获得 1 张卡', tax: '纳税：现金的 5%',
  event: '随机事件', god: '随机神仙附身', dog: '野狗：损失现金或住院',
  beggar: '乞丐：施舍现金', merchant: '神秘人：6 张卡，最多买 2 张',
  hospitalGate: '医院入口，侧路连回主路', jailGate: '监狱入口，侧路连回主路',
  hospital: '医院：住院', jail: '监狱：入狱', teleport: '随机传送门',
  platform: '活动机关板，会周期消失', empty: '普通路面',
};

export function render(root, state, actions) {
  const p = current(state);
  root.system.innerHTML = `<span class="pill">第 ${state.day} 天</span>
    <span class="pill">物价 ${state.priceIndex.toFixed(2)}</span>
    <span class="grow"></span>
    <button data-stock="1" ${state.phase === 'action' && !state.pending ? '' : 'disabled'}>股票</button>
    <button data-bank="1" ${state.phase === 'action' && !state.pending ? '' : 'disabled'}>银行</button>
    <button data-reset="1">重开</button>`;
  root.system.querySelector('[data-stock]').onclick = () => actions.openStock();
  root.system.querySelector('[data-bank]').onclick = () => actions.openBank();
  root.system.querySelector('[data-reset]').onclick = () => actions.again();

  renderPlayers(root.players, state, p);
  renderBoard(root.board, state, p);
  renderLog(root.log, state);
  if (state.pending || state.phase === 'over') {
    root.choice.hidden = false;
    root.cards.hidden = true;
    root.dice.hidden = true;
    renderChoice(root.choice, state, p, actions);
  } else {
    root.choice.hidden = true;
    root.cards.hidden = false;
    root.dice.hidden = false;
    renderHand(root, state, p, actions);
  }
}

function layout(map, W, H) {
  const mx = 100, my = 60, gap = 4, cw = 48, ch = 48;
  const left = mx, right = W - mx - cw, top = my, bottom = H - my - ch;
  const coords = {};
  const sides = [
    { side: 0, nodes: [], span: right - left, cross: cw, horizontal: true },
    { side: 1, nodes: [], span: bottom - top, cross: ch, horizontal: false },
    { side: 2, nodes: [], span: right - left, cross: cw, horizontal: true },
    { side: 3, nodes: [], span: bottom - top, cross: ch, horizontal: false },
  ];
  for (const n of map.nodes) if (n.ring !== undefined) sides[Math.floor(n.ring / 12)].nodes.push(n);
  for (const s of sides) s.nodes.sort((a, b) => a.ring - b.ring);
  for (const s of sides) {
    const n = s.nodes.length;
    const unit = s.span / (n + 1);
    let cursor = 0;
    for (const node of s.nodes) {
      if (s.side === 0) coords[node.id] = { x: left + cursor, y: top, w: unit, h: ch };
      if (s.side === 1) coords[node.id] = { x: right, y: top + cursor, w: cw, h: unit };
      if (s.side === 2) coords[node.id] = { x: right - cursor - unit, y: bottom, w: unit, h: ch };
      if (s.side === 3) coords[node.id] = { x: left, y: bottom - cursor - unit, w: cw, h: unit };
      cursor += unit;
    }
  }
  for (const c of Object.values(coords)) { c.cx = c.x + c.w / 2; c.cy = c.y + c.h / 2; }
  const g = (id) => coords[id] ?? { x: left, y: top, w: cw, h: ch, cx: left + cw / 2, cy: top + ch / 2 };
  const h = g('r30'), j = g('r31'), d = g('r43');
  coords.hospital = { x: h.cx - 24, y: h.y - 74, w: cw, h: ch };
  coords.jail = { x: j.cx + 40, y: j.y - 84, w: cw, h: ch };
  coords.t1 = { x: d.x + 120, y: d.cy - 24, w: cw, h: ch };
  coords.t2 = { x: d.x + 210, y: d.cy - 24, w: cw, h: ch };
  const a = g('r5'), b = g('r41');
  coords.p1 = { x: (a.cx + b.cx) / 2 - 24, y: (a.cy + b.cy) / 2 - 24, w: cw, h: ch };
  for (const c of Object.values(coords)) { c.cx = c.x + c.w / 2; c.cy = c.y + c.h / 2; }
  return coords;
}

function cellTitle(n, pr, owner, state) {
  if (n.plotId) {
    const plot = state.map.plots.find(p => p.id === n.plotId);
    return `路：旁边是 ${plot?.label ?? ''}${pr ? `｜${owner?.name ?? '无主'} Lv.${pr.level}` : ''}`;
  }
  let s = `${n.label}：${CELL_HELP[n.kind] ?? ''}`;
  if (n.kind === 'big') s = `${pr?.bigType ? BIG_NAME[pr.bigType] : '大空地'}：${pr?.bigType ? BIG_HELP[pr.bigType] : '第二次投资选择建筑'}`;
  if (pr) s += `｜${owner?.name ?? '无主'} Lv.${pr.level}`;
  if (n.kind === 'god') s += '｜财神、穷神、福神、衰神、天使、恶魔、土地公、糊涂神、武神、凶神';
  return s;
}

function renderBoard(el, state, currentP) {
  const map = state.map;
  const S = map.cell ?? 48;
  const W = (map.w ?? 19) * S, H = (map.h ?? 13) * S;
  const plotCells = new Map();
  for (const plot of map.plots ?? []) for (const c of plot.cells) plotCells.set(`${c.x},${c.y}`, plot);
  const nodes = Object.fromEntries(map.nodes.map(n => [n.id, n]));
  const dir = currentP ? (currentP.facing ?? currentP.lastNode) : null;
  const cur = currentP ? nodes[currentP.position] : null;
  const tgt = dir ? nodes[dir] : null;
  const angle = cur && tgt ? Math.atan2(tgt.y - cur.y, tgt.x - cur.x) * 180 / Math.PI : null;

  const plots = (map.plots ?? []).map(plot => {
    const pr = state.properties[plot.id];
    const owner = pr?.ownerId ? state.players.find(q => q.id === pr.ownerId) : null;
    const name = plot.big ? (pr?.bigType ? BIG_NAME[pr.bigType] : '大空地') : plot.label;
    const cells = plot.cells.map((c, i) => {
      const title = `${name}${owner ? `｜${owner.name} Lv.${pr.level}` : '｜无主'}`;
      return `<div class="prop ${plot.big ? 'bigprop' : ''}" data-plot="${plot.id}" title="${title}"
        style="left:${c.x * S + 1}px;top:${c.y * S + 1}px;width:${S - 2}px;height:${S - 2}px;border-color:${owner?.color ?? '#3a404b'};background:${owner ? owner.color + '22' : '#181c22'}">
        ${i === 0 ? `<div class="pname">${name}</div><div class="plv">${pr ? 'Lv' + pr.level : ''}</div>` : ''}
      </div>`;
    }).join('');
    if (!plot.big) return cells;
    const xs = plot.cells.map(c => c.x), ys = plot.cells.map(c => c.y);
    const x = Math.min(...xs) * S, y = Math.min(...ys) * S;
    return cells + `<div class="big-outline" style="left:${x}px;top:${y}px;width:${2 * S}px;height:${2 * S}px;border-color:${owner?.color ?? '#4a5260'}"></div>`;
  }).join('');

  const roads = map.nodes.map(n => {
    const here = state.players.filter(q => q.alive && q.position === n.id);
    const place = state.placements[n.id];
    const ground = GROUND_ICON[n.kind] ?? (n.kind === 'empty' ? '·' : '?');
    const title = `${n.label}${CELL_HELP[n.kind] ? '：' + CELL_HELP[n.kind] : ''}${n.adjacentPlots?.length ? '｜邻接 ' + n.adjacentPlots.length + ' 块地产' : ''}`;
    return `<div class="cell" data-cell="${n.id}" title="${title}"
      style="left:${n.x + 1}px;top:${n.y + 1}px;width:${S - 2}px;height:${S - 2}px">
      <div class="gicon">${ground}</div>
      <div class="subtag">${n.kind === 'empty' ? '' : n.label}</div>
      ${place ? `<div class="occs" title="${place.name ?? place.kind}">${OCC_ICON[place.kind] ?? '?'}</div>` : ''}
      <div class="tokens">${here.map(q => `<span class="tok ${q.id === currentP?.id ? 'cur' : ''}" style="background:${q.color}" title="${q.name}">${q.name[0]}</span>`).join('')}</div>
      ${n.id === currentP?.position && angle != null ? `<span class="face" style="transform:rotate(${angle}deg)">➤</span>` : ''}
    </div>`;
  }).join('');

  const availW = Number(el.clientWidth) || W, availH = Number(el.clientHeight) || H;
  const scale = Math.max(0.3, Math.min(1.25, (availW - 24) / W, (availH - 24) / H));
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.innerHTML = `<div class="grid-fit" style="width:${Math.round(W * scale)}px;height:${Math.round(H * scale)}px">` +
    `<div class="grid-board" style="width:${W}px;height:${H}px;transform:scale(${scale});transform-origin:0 0">${plots}${roads}</div></div>`;
}

function renderPlayers(el, state, currentP) {
  el.innerHTML = state.players.map(p => {
    const cls = p.id === currentP?.id ? 'player cur' : 'player';
    return `<div class="${cls}" style="border-left-color:${p.color}">
      <div class="ptitle"><span class="avatar" style="background:${p.color}">${p.name[0]}</span><span>${p.name}</span>
        <span class="team">${p.team}${p.isBoss ? ` · T${p.bossTier}` : ''}</span></div>
      <div class="prow">现金 ${p.cash.toLocaleString()} · 存款 ${p.deposit.toLocaleString()}</div>
      <div class="prow">${state.map.nodes.find(n => n.id === p.position)?.label ?? '-'}${p.jail ? ' · 监禁' + p.jail : ''}${p.hospital ? ' · 住院' + p.hospital : ''}${(p.facing ?? p.lastNode) ? ' · 朝向 ' + (state.map.nodes.find(n => n.id === (p.facing ?? p.lastNode))?.label ?? '') : ''}</div>
      <div class="slots"><span class="slot">神 <b>${p.god ?? '—'}</b></span><span class="slot">状态 <b>${p.status ?? '—'}</b></span><span class="slot">载具 <b>${p.vehicle ?? '—'}</b></span></div>
    </div>`;
  }).join('');
}

function renderChoice(el, state, p, actions) {
  if (state.phase === 'over') {
    const rows = [...state.players].sort((a, b) => assetsOf(state, b) - assetsOf(state, a))
      .map((x, i) => `<tr><td>${i + 1}</td><td>${x.name}</td><td>${x.team}</td><td>${assetsOf(state, x).toLocaleString()}</td><td>${x.alive ? '' : '破产'}</td></tr>`).join('');
    el.innerHTML = `<h3>比赛结束：${state.winnerTeam ?? '—'} 胜</h3>
      <table class="rank"><thead><tr><th>#</th><th>角色</th><th>队伍</th><th>资产</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    return;
  }
  const pending = state.pending;
  if (!pending) return;
  const box = (title, body) => `<h3>${title}</h3>${body}`;
  let html = '';
  if (pending.type === 'buy') {
    const n = state.map.nodes.find(x => x.id === pending.cellId);
    html = box(`购买 ${n.label}`, `<p>售价 ${pending.price.toLocaleString()}</p>
      <button data-act="buy">买下</button><button data-act="skip">放弃</button>`);
  } else if (pending.type === 'build') {
    const n = state.map.nodes.find(x => x.id === pending.cellId);
    html = box(`加盖 ${n.label}`, `<p>费用 ${pending.cost.toLocaleString()}</p>
      <button data-act="build">加盖</button><button data-act="skip">放弃</button>`);
  } else if (pending.type === 'chooseBig') {
    html = box('选择大型建筑', `<div class="offers">${['commercial','hotel','bookstore','energy','realestate','research']
      .map(t => `<button class="offer" data-big="${t}"><b>${BIG_NAME[t]}</b><span>${t === 'commercial' ? '转盘租金' : t === 'hotel' ? '强制住店' : t === 'bookstore' ? '离店得卡' : t === 'energy' ? '对手买卡更贵' : t === 'realestate' ? '己方租金减免' : '研发进阶卡'}</span></button>`).join('')}</div>`);
  } else if (pending.type === 'direction') {
    html = box('选择方向', pending.options.map(id =>
      `<button data-dir="${id}">${state.map.nodes.find(n => n.id === id).label}</button>`).join(''));
  } else if (pending.type === 'bank') {
    html = box('银行', `<input id="amount" type="number" value="10000" step="1000">
      <div><button data-act="deposit">存款</button><button data-act="withdraw">取款</button>
      <button data-act="leave">${pending.free ? '关闭' : '离开'}</button></div>`);
  } else if (pending.type === 'stock') {
    html = box('股票', state.stocks.map(s => `<div class="row">${s.name} ${s.price.toFixed(1)}
      <button data-buy="${s.id}">买 10</button><button data-sell="${s.id}">卖 10</button></div>`).join('') +
      `<button data-act="leave">关闭</button>`);
  } else if (pending.type === 'lottery') {
    html = box('乐透', `<p>票价 ${TUNING.lotteryTicket}；买 1–30 的号码，每 10 天开奖；奖池 ${state.lottery.jackpot}</p>
      <div class="numgrid">${Array.from({ length: 30 }, (_, i) => {
        const n = i + 1, sold = state.lottery.sold.includes(n);
        return `<button data-lottery="${n}" ${sold ? 'disabled' : ''}>${n}</button>`;
      }).join('')}</div><button data-act="skip">离开</button>`);
  } else if (pending.type === 'shop' || pending.type === 'merchant' || pending.type === 'research') {
    const title = pending.type === 'shop' ? `商店 ${state.shopBought}/${state.shopLimit}` :
      pending.type === 'merchant' ? `神秘人 ${state.shopBought}/${state.shopLimit}` : `研究所 ${state.shopBought}/${state.shopLimit}`;
    const key = pending.type;
    const offers = (state.shopOffer ?? []).map((item, i) => {
      const price = pending.type === 'shop' && p.talents.includes('shop_discount') ? Math.round(item.price / 2) : item.price;
      const off = state.shopBought >= state.shopLimit ? 'disabled' : '';
      return `<button class="offer" data-${key}="${i}" ${off}><b>${CARD_DEFS[item.id]?.name ?? item.id}</b><span>${price}</span></button>`;
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
  el.innerHTML = html;
  el.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => actions.act(b.dataset.act));
  el.querySelectorAll('button[data-dir]').forEach(b => b.onclick = () => actions.direction(b.dataset.dir));
  el.querySelectorAll('button[data-big]').forEach(b => b.onclick = () => actions.chooseBig(b.dataset.big));
  el.querySelectorAll('button[data-buy]').forEach(b => b.onclick = () => actions.stock(b.dataset.buy, 10, 'buy'));
  el.querySelectorAll('button[data-sell]').forEach(b => b.onclick = () => actions.stock(b.dataset.sell, 10, 'sell'));
  el.querySelectorAll('button[data-lottery]').forEach(b => b.onclick = () => actions.lottery(+b.dataset.lottery));
  el.querySelectorAll('button[data-shop]').forEach(b => b.onclick = () => actions.shop(+b.dataset.shop));
  el.querySelectorAll('button[data-research]').forEach(b => b.onclick = () => actions.research(+b.dataset.research));
  el.querySelectorAll('button[data-magic]').forEach(b => b.onclick = () => actions.magic(b.dataset.magic));
  el.querySelectorAll('button[data-merchant]').forEach(b => b.onclick = () => actions.merchant(+b.dataset.merchant));
}

function renderLog(el, state) {
  el.innerHTML = state.log.slice(-120).map(l => `<li>D${l.day} ${l.text}</li>`).join('');
  el.scrollTop = el.scrollHeight;
}

function maxDice(p) { return Math.min(TUNING.maxDice, 1 + Math.max(0, p.vehicle ?? 0)); }

function renderHand(root, state, p, actions) {
  if (!p) { root.dice.innerHTML = ''; root.cards.innerHTML = ''; return; }
  const canRoll = state.phase === 'action' && !state.pending;
  root.dice.innerHTML = Array.from({ length: maxDice(p) }, (_, i) =>
    `<button data-roll="${i + 1}" ${canRoll ? '' : 'disabled'}>${i + 1} 骰</button>`).join('');
  root.dice.querySelectorAll('button[data-roll]').forEach(b => b.onclick = () => actions.roll(+b.dataset.roll));
  root.cards.innerHTML = p.cards.map((id, i) => {
    const def = CARD_DEFS[id];
    const tip = `${def?.name ?? id}：${CARD_DESC[id] ?? ''}`;
    return `<button class="card" data-card="${i}" title="${tip}">
      <div class="art">${(def?.name ?? id).slice(0, 1)}</div>
    </button>`;
  }).join('');
  root.cards.querySelectorAll('button[data-card]').forEach(b => b.onclick = () => actions.card(+b.dataset.card));
}
