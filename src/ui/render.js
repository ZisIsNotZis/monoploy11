import { TUNING } from '../data/tuning.js';
import { CHARACTER_BY_ID } from '../data/characters.js';
import { CARD_DEFS, current, PASSIVE } from '../engine/game.js?v=90';
import { assetsOf } from '../engine/economy.js';
import { isPlatformActive } from '../engine/board-v2.js';
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
const GROUND_ICON = { start:'起', bank:'银', shop:'店', news:'新', card:'卡', tax:'税', event:'事', stock:'股', lottery:'彩', magic:'魔', hospital:'医', jail:'监', teleport:'传', platform:'机' };
const OCC_ICON = { god:'神', dog:'狗', beggar:'乞', merchant:'秘', mine:'雷', dynamite:'炸', timebomb:'弹', banana:'绊', jelly:'冻', trap:'陷', roadblock:'障' };
const GOD_ICON = { 财神:'财', 穷神:'穷', 福神:'福', 衰神:'衰', 天使:'天', 恶魔:'恶', 土地公:'土', 糊涂神:'糊', 武神:'武', 凶神:'凶' };
const STATUS_ICON = { 乌龟:'龟', 梦游:'梦', 冬眠:'眠', 冰冻:'冰', 停留:'停' };
const PASS_ROAD = new Set(['start', 'bank', 'lottery', 'card']);
const STOP_ROAD = new Set(['shop', 'news', 'magic', 'tax', 'event', 'god', 'dog', 'beggar', 'merchant', 'hospital', 'hospitalGate', 'jail', 'jailGate', 'teleport']);
const PASS_OCC = new Set(['mine', 'dynamite', 'timebomb', 'banana', 'jelly', 'trap', 'roadblock']);
const STOP_OCC = new Set(['god', 'dog', 'beggar', 'merchant']);
const OCC_HELP = {
  god: '神仙：停下触发', dog: '野狗：停下触发；50% 住院 2 回合，50% 损失 5000；载具/免疫天赋可躲',
  beggar: '乞丐：停下触发；施舍 3000，免疫天赋可免', merchant: '神秘人：停下触发；6 张卡最多买 2 张，每张 1000',
  mine: '地雷：经过触发；损失 8000', dynamite: '炸药：经过触发；损失 15000',
  timebomb: '定时炸弹：经过触发；附身 30 天，追上别人可转嫁', banana: '香蕉皮：经过触发；停留 1 回合',
  jelly: '果冻墙：经过触发；弹回 2 格', trap: '陷阱：经过触发；停留 1 回合', roadblock: '路障：经过触发；停留 1 回合',
};
const BIG_HELP = { commercial: '转盘收租', hotel: '强制对手住店', bookstore: '离店额外得卡', energy: '对手买卡更贵、停留收钱', realestate: '己方应付租金降低', research: '研发进阶卡', park: '不收费，只能被改建卡改成公园' };
const CELL_HELP = {
  start: '经过或停留：领取工资', property: '小地产：买地、加盖、收租',
  big: '大地产：先买空地，第二次投资时选择大型建筑',
  bank: '经过或停留：打开存取款面板', stock: '股票：随时买卖',
  lottery: '经过或停留：买一注 1–30 的号码，每 10 天开奖', shop: '停下触发：9 张卡，最多买 3 张',
  magic: '停下触发：选择魔法效果', news: '停下触发：立即结算随机新闻',
  card: '经过或停留：获得 1 张卡', tax: '停下触发：支付现金的 5%',
  event: '停下触发：随机现金事件', god: '停下触发：随机神仙附身', dog: '停下触发：50% 住院 2 回合，50% 损失 5000',
  beggar: '停下触发：损失 3000', merchant: '停下触发：6 张卡，最多买 2 张，每张 1000',
  hospitalGate: '医院入口，侧路连回主路', jailGate: '监狱入口，侧路连回主路',
  hospital: '停下触发：住院 2 回合', jail: '停下触发：入狱 2 回合', teleport: '停下触发：随机传送',
  platform: '活动机关板，会周期消失', empty: '',
};

export function render(root, state, actions) {
  const p = current(state);
  root.system.innerHTML = `<span class="pill">第 ${state.day} 天</span>
    <span class="pill">物价 ${state.priceIndex.toFixed(2)}</span>
    <span class="grow"></span>
    <button data-stock="1" ${state.phase === 'action' && !state.pending ? '' : 'disabled'}>股票</button>`;
  root.system.querySelector('[data-stock]').onclick = () => actions.openStock();

  renderPlayers(root.players, state, p);
  renderBoard(root.board, state, p, actions);
  renderLog(root.log, state);
  const choosing = !!state.pending || !!state.mapPick || state.phase === 'over';
  root.hand.classList.toggle('choice', choosing);
  if (choosing) {
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
    const what = plot?.big ? (pr?.bigType ? BIG_NAME[pr.bigType] : '大空地') : '小地产';
    return `路：旁边是 ${what}${pr ? `｜${owner?.name ?? '无主'} Lv.${pr.level}` : ''}`;
  }
  let s = `${n.label}：${CELL_HELP[n.kind] ?? ''}`;
  if (n.kind === 'big') s = `${pr?.bigType ? BIG_NAME[pr.bigType] : '大空地'}：${pr?.bigType ? BIG_HELP[pr.bigType] : '第二次投资选择建筑'}`;
  if (pr) s += `｜${owner?.name ?? '无主'} Lv.${pr.level}`;
  if (n.kind === 'god') s += '｜财神、穷神、福神、衰神、天使、恶魔、土地公、糊涂神、武神、凶神';
  return s;
}

function renderBoard(el, state, currentP, actions) {
  const map = state.map;
  const S = map.cell ?? 48;
  const W = (map.w ?? 19) * S, H = (map.h ?? 13) * S;
  const plotCells = new Map();
  for (const plot of map.plots ?? []) for (const c of plot.cells) plotCells.set(`${c.x},${c.y}`, plot);
  const nodes = Object.fromEntries(map.nodes.map(n => [n.id, n]));
  const dir = currentP ? (currentP.facing ?? currentP.lastNode) : null;
  const dirOptions = new Set(state.pending?.type === 'direction' ? state.pending.options : []);
  const pickMode = !!state.mapPick;
  const pickCells = state.mapPick?.cells ? new Set(state.mapPick.cells) : null;
  const cur = currentP ? nodes[currentP.position] : null;
  const tgt = dir ? nodes[dir] : null;
  const angle = cur && tgt ? Math.atan2(tgt.y - cur.y, tgt.x - cur.x) * 180 / Math.PI : null;

  const plots = (map.plots ?? []).map(plot => {
    const pr = state.properties[plot.id];
    const owner = pr?.ownerId ? state.players.find(q => q.id === pr.ownerId) : null;
    const name = plot.big ? (pr?.bigType ? BIG_NAME[pr.bigType] : '大空地') : '小地产';
    const glyph = plot.big ? (pr?.bigType ? ({ commercial:'商', hotel:'饭', bookstore:'书', energy:'能', realestate:'地', research:'研', park:'公' }[pr.bigType] ?? '大') : '大') : (pr?.level > 0 ? '房' : '地');
    const xs = plot.cells.map(c => c.x), ys = plot.cells.map(c => c.y);
    const x = Math.min(...xs) * S, y = Math.min(...ys) * S;
    const w = (plot.big ? 2 : 1) * S;
    const title = `${name}${owner ? `｜${owner.name} Lv.${pr.level}` : '｜无主'}`;
    const pickPlot = state.mapPick?.plot;
    const filter = state.mapPick?.filter;
    const filterPlayer = state.players.find(q => q.id === state.mapPick?.playerId);
    let pickAllowed = true;
    if (filter) {
      const owner = pr?.ownerId ? state.players.find(q => q.id === pr.ownerId) : null;
      pickAllowed = !!pr && !!filterPlayer && !plot.big && pr.level > 0 && (filter === 'teamBuiltSmall' ? owner?.team === filterPlayer.team && !pr.closed : filter === 'enemyBuiltSmall' ? !!owner && owner.team !== filterPlayer.team : true);
    }
    const pickClass = pickPlot && pickAllowed ? 'pick-target' : (pickPlot ? 'pick-blocked' : '');
    const marks = [
      pr?.closed > 0 ? `<b class="mark stop">停${pr.closed}</b>` : '',
      pr?.inflate > 0 ? `<b class="mark inflate">涨${pr.inflate}</b>` : '',
    ].join('');
    const level = plot.big ? '' : (pr?.level > 0 ? `<span class="lvp">${'•'.repeat(Math.min(5, pr.level))}</span>` : '');
    return `<div class="prop ${plot.big ? 'bigprop' : ''} ${pickClass} ${pr ? (pr.level > 0 ? 'built' : 'empty-ground') : ''}" data-plot="${plot.id}"${pickPlot && pickAllowed ? ` data-pick-plot="${plot.id}"` : ''} title="${title}"
      style="left:${x + 1}px;top:${y + 1}px;width:${w - 2}px;height:${w - 2}px;border-color:${owner?.color ?? '#3a404b'};background:${owner ? owner.color + '22' : '#181c22'}">
      <div class="picon">${glyph}</div>${level}${marks}
    </div>`;
  }).join('');

  const roads = map.nodes.map(n => {
    const here = state.players.filter(q => q.alive && q.position === n.id);
    const place = state.placements[n.id];
    const ground = GROUND_ICON[n.kind] ?? (n.kind === 'empty' ? '' : '?');
    const title = n.kind === 'empty' ? '' : `${n.label}${CELL_HELP[n.kind] ? '：' + CELL_HELP[n.kind] : ''}`;
    const roadStop = STOP_ROAD.has(n.kind);
    const roadPass = PASS_ROAD.has(n.kind);
    const occStop = !!place && STOP_OCC.has(place.kind);
    const occPass = !!place && PASS_OCC.has(place.kind);
    const dirTarget = dirOptions.has(n.id);
    const canPick = pickMode && (!pickCells || pickCells.has(n.id));
    const extra = dirTarget ? 'dir-target' : canPick ? 'pick-target' : '';
    const attr = dirTarget ? ` data-dir-cell="${n.id}"` : canPick ? ` data-pick-cell="${n.id}"` : '';
    const cur = state.map.nodes.find(x => x.id === currentP?.position);
    const da = cur ? Math.atan2(n.y - cur.y, n.x - cur.x) * 180 / Math.PI : 0;
    const flow = `${roadStop ? 'road-stop' : ''} ${roadPass ? 'road-pass' : ''} ${occStop ? 'occ-stop' : ''} ${occPass ? 'occ-pass' : ''}`;
    const occTitle = place ? `${OCC_HELP[place.kind] ?? ''}${place.kind === 'god' ? '：' + place.name : ''}` : '';
    return `<div class="cell ${extra} ${flow}${!ground ? ' no-ground' : ''}${ground ? ' has-ground' : ''}${place ? ' has-occ' : ''}" data-cell="${n.id}"${attr}
      style="left:${n.x + 1}px;top:${n.y + 1}px;width:${S - 2}px;height:${S - 2}px">
      ${ground ? `<div class="gicon" title="${title}">${ground}</div>` : ''}
      ${place ? `<div class="occs" title="${occTitle}">${place.kind === 'god' ? (GOD_ICON[place.name] ?? '神') : (OCC_ICON[place.kind] ?? '?')}</div>` : ''}
      ${dirTarget ? `<i class="dir-mark" style="--a:${da}deg"></i>` : ''}
      <div class="tokens">${here.map(q => {
        const d = q.facing ?? q.lastNode; const t = d ? nodes[d] : null;
        const a = t ? Math.atan2(t.y - n.y, t.x - n.x) * 180 / Math.PI : 0;
        return `<span class="tok ${q.id === currentP?.id ? 'cur' : ''}" data-player="${q.id}" style="--c:${q.color};background:${q.color};transform:rotate(${a + 90}deg)" title="${q.name}"><span class="ini" style="transform:rotate(${-(a + 90)}deg)">${q.name[0]}</span><i class="ptr"></i></span>`;
      }).join('')}</div>
    </div>`;
  }).join('');

  const availW = Number(el.clientWidth) || W, availH = Number(el.clientHeight) || H;
  const scale = Math.max(0.3, Math.min(1.25, (availW - 24) / W, (availH - 24) / H));
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.innerHTML = `<div class="grid-fit" style="width:${Math.round(W * scale)}px;height:${Math.round(H * scale)}px">` +
    `<div class="grid-board" style="width:${W}px;height:${H}px;transform:scale(${scale});transform-origin:0 0">${plots}${roads}</div></div>`;
  el.querySelectorAll('[data-dir-cell]').forEach(c => c.onclick = () => actions.direction(c.dataset.dirCell));
  el.querySelectorAll('[data-pick-cell]').forEach(c => c.onclick = () => actions.pickCell(c.dataset.pickCell));
  el.querySelectorAll('[data-pick-plot]').forEach(c => c.onclick = () => actions.pickPlot(c.dataset.pickPlot));
}

const short = n => n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);

function renderPlayers(el, state, currentP) {
  el.innerHTML = state.players.map(p => {
    const cls = p.id === currentP?.id ? 'player cur' : 'player';
    const char = CHARACTER_BY_ID[p.charId];
    const skills = (char?.talents ?? []).filter(t => p.talents?.includes(t.id)).map(t => `${t.name}：${t.desc}`).join('\n');
    const skillTitle = `${p.name}${skills ? '\n' + skills : ''}`;
    return `<div class="${cls}" style="border-left-color:${p.color}" title="${skillTitle}">
      <div class="pline">
        <span class="avatar" style="background:${p.color}">${p.name[0]}</span>
        <b>${p.name}</b><span class="team">${p.team}${p.isBoss ? ' T' + p.bossTier : ''}</span>
        <span class="pmeta">现 ${short(p.cash)} 存 ${short(p.deposit)} · ${state.map.nodes.find(n => n.id === p.position)?.label ?? '-'}</span>
        <span class="pslots">
          <span class="slot bind" title="绑定状态：${p.god ?? '无'}">${p.god ? (GOD_ICON[p.god] ?? '神') + p.godDays : '—'}</span>
          <span class="slot body" title="人物状态：${p.status ?? (p.skipTurns ? '停留 ' + p.skipTurns : '无')}">${p.status ? (STATUS_ICON[p.status] ?? '状') + p.statusDays : (p.skipTurns ? '停' + p.skipTurns : '—')}</span>
          <span class="slot phys" title="物理状态：${p.jail ? '监狱 ' + p.jail : p.hospital ? '医院 ' + p.hospital : '无'}">${p.jail ? '监' + p.jail : p.hospital ? '医' + p.hospital : '—'}</span>
        </span>
      </div>
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
  if (state.mapPick) {
    const name = state.mapPick?.label ?? CARD_DEFS[state.mapPick.cardId]?.name ?? '卡片';
    const hint = state.mapPick?.plot ? '直接点地图上的地产选择目标' : '直接点地图上高亮的路面';
    el.innerHTML = `<h3>${name}</h3><p class="hint">${hint}</p><button data-act="cancel-pick">取消</button>`;
    el.querySelector('[data-act="cancel-pick"]').onclick = () => actions.act('cancel-pick');
    return;
  }
  const pending = state.pending;
  if (!pending) return;
  const box = (title, body) => `<h3>${title}</h3>${body}`;
  let html = '';
  if (pending.type === 'target') {
    if (pending.kind === 'cell') {
      html = box('选择目标', '<p class="hint">直接点地图上高亮的路面</p><button data-act="cancel-pick">取消</button>');
    } else if (pending.kind === 'player') {
      html = box('选择目标', (pending.players ?? state.players.filter(q => q.alive)).map(q => `<button data-target="${q.id}">${q.name}（${q.team}）</button>`).join('') + '<button data-act="cancel-pick">取消</button>');
    } else {
      html = box(pending.label ?? '选择目标', '<p class="hint">请直接点地图上的地产</p><button data-act="cancel-pick">取消</button>');
    }
  } else  if (pending.type === 'buy') {
    const plot = state.map.plots.find(x => x.id === pending.cellId);
    const label = plot?.big ? '大空地' : '小地产';
    html = box(`购买 ${label}`, `<p>售价 ${pending.price.toLocaleString()}</p>
      <button data-act="buy">买下</button><button data-act="skip">放弃</button>`);
  } else if (pending.type === 'build') {
    const plot = state.map.plots.find(x => x.id === pending.cellId);
    const label = plot?.big ? '大空地' : '小地产';
    html = box(`加盖 ${label}`, `<p>费用 ${pending.cost.toLocaleString()}</p>
      <button data-act="build">加盖</button><button data-act="skip">放弃</button>`);
  } else if (pending.type === 'chooseBig') {
    html = box('选择大型建筑', `<div class="offers">${['commercial','hotel','bookstore','energy','realestate','research']
      .map(t => `<button class="offer" data-big="${t}"><b>${BIG_NAME[t]}</b><span>${t === 'commercial' ? '转盘租金' : t === 'hotel' ? '强制住店' : t === 'bookstore' ? '离店得卡' : t === 'energy' ? '对手买卡更贵' : t === 'realestate' ? '己方租金减免' : '研发进阶卡'}</span></button>`).join('')}</div>`);
  } else if (pending.type === 'direction') {
    html = box('选择方向', `<p class="hint">直接点地图上高亮的路面</p>`);
  } else if (pending.type === 'bank') {
    const cash = p?.cash ?? 0;
    const total = cash + (p?.deposit ?? 0);
    html = box('银行', `<p class="hint">拖动分配现金和存款：最左全存银行，最右全放现金。</p>
      <input id="amount" type="range" min="0" max="${total}" step="1000" value="${cash}">
      <p class="hint">现金 <b id="amountOut">${cash.toLocaleString()}</b> · 银行存款 <b id="depositOut">${(total - cash).toLocaleString()}</b></p>
      <div><button data-act="bank-confirm">确定</button><button data-act="leave">取消</button></div>`);
  } else if (pending.type === 'stock') {
    html = box('股票', state.stocks.map(s => `<div class="row">${s.name} ${s.price.toFixed(1)}
      <button data-buy="${s.id}">买 10</button><button data-sell="${s.id}">卖 10</button></div>`).join('') +
      `<button data-act="leave">关闭</button>`);
  } else if (pending.type === 'lottery') {
    const mine = state.lottery.tickets.filter(t => t.playerId === p.id).length;
    html = box(`乐透 · 已买 ${mine} 注`, `<p>票价 ${TUNING.lotteryTicket}；奖池 ${state.lottery.jackpot}</p>
      <div class="numgrid">${Array.from({ length: 30 }, (_, i) => {
        const n = i + 1, sold = state.lottery.sold.includes(n);
        return `<button data-lottery="${n}" ${sold ? 'disabled' : ''}>${n}</button>`;
      }).join('')}</div><button data-act="leave">离开</button>`);
  } else if (pending.type === 'shop' || pending.type === 'merchant' || pending.type === 'research') {
    const title = pending.type === 'shop' ? `商店 ${state.shopBought}/${state.shopLimit}` :
      pending.type === 'merchant' ? `神秘人 ${state.shopBought}/${state.shopLimit}` : `研究所 ${state.shopBought}/${state.shopLimit}`;
    const key = pending.type;
    const offers = (state.shopOffer ?? []).map((item, i) => {
      const price = pending.type === 'shop' && p.talents.includes('shop_discount') ? Math.round(item.price * 0.7) : item.price;
      const off = state.shopBought >= state.shopLimit ? 'disabled' : '';
      const name = CARD_DEFS[item.id]?.name ?? item.id;
      return `<button class="shop-card" data-${key}="${i}" ${off} title="${name}：${CARD_DESC[item.id] ?? ''}">
        <span class="shop-art">${name.slice(0, 1)}</span><span class="shop-price">${price}</span></button>`;
    }).join('');
    html = box(title, `<div class="shop-grid">${offers}</div><button data-act="skip">离开</button>`);
  } else if (pending.type === 'response') {
    const label = pending.label ?? pending.cardId;
    const text = pending.response === 'samefate' ? '要使用同命卡，把同一效果反弹给使用者吗？' : pending.response === 'transfer' ? '要使用转移卡，把这次效果转给别人吗？' : '要使用无懈卡，取消这张卡吗？';
    html = box('响应', `<p class="hint">${label}</p><p>${text}</p><button data-act="yes">使用</button><button data-act="no">不用</button>`);
  } else if (pending.type === 'magic') {
    html = box('魔法屋', `<div class="offers">${(pending.options ?? []).map(o => `<button class="offer" data-magic="${o.id}" ${o.disabled ? 'disabled' : ''}><b>${o.name}</b><span>${o.desc}</span></button>`).join('')}</div>`);
  } else if (pending.type === 'news') {
    html = box('新闻', `<button data-act="news">看新闻</button>`);
  } else {
    html = box('处理中', `<button data-act="skip">继续</button>`);
  }
  el.innerHTML = html;
  el.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => actions.act(b.dataset.act));
  el.querySelectorAll('button[data-target]').forEach(b => b.onclick = () => actions.pickCell ? actions.pickCell(b.dataset.target) : null);
  el.querySelectorAll('button[data-dir]').forEach(b => b.onclick = () => actions.direction(b.dataset.dir));
  el.querySelectorAll('button[data-big]').forEach(b => b.onclick = () => actions.chooseBig(b.dataset.big));
  el.querySelectorAll('button[data-buy]').forEach(b => b.onclick = () => actions.stock(b.dataset.buy, 10, 'buy'));
  el.querySelectorAll('button[data-sell]').forEach(b => b.onclick = () => actions.stock(b.dataset.sell, 10, 'sell'));
  el.querySelectorAll('button[data-lottery]').forEach(b => b.onclick = () => actions.lottery(+b.dataset.lottery));
  el.querySelectorAll('button[data-shop]').forEach(b => b.onclick = () => actions.shop(+b.dataset.shop));
  el.querySelectorAll('button[data-research]').forEach(b => b.onclick = () => actions.research(+b.dataset.research));
  el.querySelectorAll('button[data-magic]').forEach(b => b.onclick = () => actions.magic(b.dataset.magic));
  const amount = el.querySelector('#amount');
  if (amount && pending.type === 'bank') {
    const max = (p?.cash ?? 0) + (p?.deposit ?? 0);
    const out = () => { const v = Number(amount.value); el.querySelector('#amountOut').textContent = v.toLocaleString(); el.querySelector('#depositOut').textContent = (max - v).toLocaleString(); };
    amount.addEventListener('input', out);
  }
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
  const n = p.cards.length;
  const step = n > 1 ? Math.min(120, (350 - 74) / (n - 1)) : 78;
  const overlap = step < 78;
  root.cards.innerHTML = p.cards.map((id, i) => {
    const def = CARD_DEFS[id];
    const tip = `${def?.name ?? id}：${CARD_DESC[id] ?? ''}`;
    const rot = overlap ? (i - (n - 1) / 2) * 1.6 : 0;
    const passive = PASSIVE.has(id);
    return `<button class="card${passive ? ' disabled' : ''}" data-card="${i}" ${passive ? 'disabled' : ''} style="--i:${i};z-index:${i};margin-left:${i ? Math.round(step - 74) : 0}px;transform:rotate(${rot}deg)" title="${passive ? '被动卡，在触发时询问是否使用' : tip}">
      <div class="art">${(def?.name ?? id).slice(0, 1)}</div>
    </button>`;
  }).join('');
  root.cards.querySelectorAll('button[data-card]').forEach(b => b.onclick = () => actions.card(+b.dataset.card));
}
