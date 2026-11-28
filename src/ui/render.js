import { TUNING } from '../data/tuning.js';
import { CHARACTER_BY_ID } from '../data/characters.js';
import { CARD_DEFS, current, PASSIVE } from '../engine/game.js?v=150';
import { assetsOf, buyPrice, acquisitionPrice, rentFor } from '../engine/economy.js';
import { isPlatformActive } from '../engine/board-v2.js';
import { CARD_DESC } from '../data/card-desc.js';
import { svgIcon, tokenSvg, cardSvg, avatarSvg, structureSvg, obstacleSvg } from './icons.js?v=150';
import { reachableLandings, landingInfo, landingText, routePreview, sliceTargetIds, nextTurnWords, nextTurnStreetNames, streetCardModel, supplyWorth } from '../engine/insight.js';
import { operateOffer } from '../engine/operate.js';
import { renderSliceInsight, sliceResults, sliceCardName, sliceCardDescription, sliceCardLine, upgradeAfterLine, money, buildForwardLine, buildOpportunityLine, buildOrderLine } from './slice.js';
import { buyLedgerLines } from '../engine/market-ledger.js';
import { poolShareLine, roundsToRecover } from '../engine/payback.js';
import { superdiceLines } from './superdice-preview.js';

const KIND_TAG = {
  start: '起', property: '地', big: '大', bank: '银', stock: '股', lottery: '彩',
  shop: '店', magic: '魔', news: '新', card: '卡', tax: '税', event: '事',
  god: '神', dog: '狗', beggar: '乞', merchant: '秘', hospitalGate: '医',
  jailGate: '监', hospital: '医', jail: '监', teleport: '传', platform: '机',
  empty: '·',
};
const BIG_TAG = { commercial: '商', hotel: '饭', bookstore: '书', energy: '能', realestate: '地', research: '研', park: '公' };
const BIG_NAME = { commercial: '商业中心', hotel: '大饭店', bookstore: '书店', energy: '能源中心', realestate: '地产公司', research: '研究所', park: '公园' };
const GROUND_ICON = { start:'起', bank:'银', money:'金', shop:'店', news:'新', card:'卡', tax:'税', event:'事', stock:'股', lottery:'彩', magic:'魔', hospital:'医', jail:'监', teleport:'传', platform:'机' };
const OCC_ICON = { god:'神', dog:'狗', beggar:'乞', merchant:'秘', mine:'雷', dynamite:'炸', timebomb:'弹', banana:'绊', jelly:'冻', trap:'陷', roadblock:'障' };
const GOD_ICON = { 财神:'财', 穷神:'穷', 福神:'福', 衰神:'衰', 天使:'天', 恶魔:'恶', 土地公:'土', 糊涂神:'糊', 武神:'武', 凶神:'凶' };
const STATUS_ICON = { 乌龟:'龟', 梦游:'梦', 冬眠:'眠', 冰冻:'冰', 停留:'停' };
const PASS_ROAD = new Set(['start', 'bank', 'lottery', 'card', 'money']);
const STOP_ROAD = new Set(['shop', 'news', 'magic', 'tax', 'event', 'god', 'dog', 'beggar', 'merchant', 'hospital', 'hospitalGate', 'jail', 'jailGate', 'teleport']);
const PASS_OCC = new Set(['mine', 'dynamite', 'timebomb', 'banana', 'jelly', 'trap', 'roadblock']);
const STOP_OCC = new Set(['god', 'dog', 'beggar', 'merchant']);
const OCC_HELP = {
  god: '神仙：停下触发', dog: '野狗：停下触发；被咬住院，载具/免疫天赋可躲',
  beggar: '乞丐：停下触发；施舍 5000，免疫天赋可免', merchant: '神秘人：停下触发；6 张卡最多买 2 张，按基础价 ×0.5',
  mine: '地雷：经过触发；损失 20000', dynamite: '炸药：经过触发；损失 30000',
  timebomb: '定时炸弹：经过触发；附身 30 步，追上别人可转嫁', banana: '香蕉皮：经过触发；强制前进 1 格',
  jelly: '果冻墙：经过触发；弹回 2 格', trap: '陷阱：经过触发；停止移动', roadblock: '路障：经过触发；停止移动',
};
const BIG_HELP = { commercial: '转盘收租', hotel: '强制对手住店', bookstore: '离店额外得卡', energy: '对手买卡更贵、停留收钱', realestate: '己方应付租金降低', research: '研发进阶卡', park: '不收费，只能被改建卡改成公园' };
const CELL_HELP = {
  start: '经过或停留：领取工资', property: '小地产：买地、加盖、收租',
  big: '大地产：先买空地，第二次投资时选择大型建筑',
  bank: '经过或停留：打开存取款面板', stock: '股票：随时买卖',
  lottery: '经过或停留：买一注 1–30 的号码，每 10 天开奖', shop: '停下触发：9 张卡，最多买 3 张',
  magic: '停下触发：选择魔法效果', news: '停下触发：立即结算随机新闻',
  card: '经过或停留：获得 1 张卡', money: '经过或停留：获得现金', tax: '停下触发：支付现金的 5%',
  event: '停下触发：随机现金事件', god: '停下触发：随机神仙附身', dog: '停下触发：被咬住院；载具/免疫可躲',
  beggar: '停下触发：按本局乞丐金额支付', merchant: '停下触发：6 张卡，最多买 2 张，按基础价 ×0.5',
  hospitalGate: '医院入口，侧路连回主路', jailGate: '监狱入口，侧路连回主路',
  hospital: '停下触发：住院 2 回合', jail: '停下触发：入狱 2 回合', teleport: '停下触发：随机传送',
  platform: '活动机关板，会周期消失', empty: '',
};

function cellHelp(state, kind) {
  const cap = state.config?.moneyCap ?? TUNING.moneyCap;
  const ticketEvery = state.config?.lotteryEveryDays ?? TUNING.lotteryEveryDays;
  const hospital = state.config?.hospitalTurns ?? TUNING.hospitalTurns;
  const jail = state.config?.jailTurns ?? TUNING.jailTurns;
  if (kind === 'money') return `经过或停留：获得 1 到 ${cap.toLocaleString()} 的现金`;
  if (kind === 'lottery') return `经过或停留：买一注 1–30 的号码，每 ${ticketEvery} 天开奖`;
  if (kind === 'hospital') return `停下触发：住院 ${hospital} 回合`;
  if (kind === 'jail') return `停下触发：入狱 ${jail} 回合`;
  if (kind === 'dog') return `停下触发：被咬住院 ${hospital} 回合；载具/免疫天赋可躲`;
  if (kind === 'beggar') return `停下触发：损失 ${TUNING.beggarAsk.toLocaleString()}`;
  if (kind === 'merchant') return '停下触发：6 张卡，最多买 2 张，按基础价 ×0.5';
  return CELL_HELP[kind] ?? '';
}

function occHelp(state, kind, name) {
  if (kind === 'dog') return `野狗：停下触发；被咬住院 ${state.config?.hospitalTurns ?? TUNING.hospitalTurns} 回合，载具/免疫天赋可躲`;
  if (kind === 'beggar') return `乞丐：停下触发；施舍 ${TUNING.beggarAsk.toLocaleString()}，免疫天赋可免`;
  if (kind === 'merchant') return '神秘人：停下触发；6 张卡最多买 2 张，按基础价 ×0.5';
  if (kind === 'mine') return `地雷：经过触发；损失 ${TUNING.mineDamage.toLocaleString()}`;
  if (kind === 'dynamite') return `炸药：经过触发；损失 ${TUNING.bombDamage.toLocaleString()}`;
  return `${OCC_HELP[kind] ?? ''}${kind === 'god' ? '：' + name : ''}`;
}

export function render(root, state, actions, opts = {}) {
  const p = current(state);
  const center = state.map.plots.find(x => x.name === '中央大酒店');
  const centerPr = center ? state.properties[center.id] : null;
  const centerOwner = centerPr?.ownerId ? state.players.find(q => q.id === centerPr.ownerId) : null;
  const remainingSteps = state.slice && state.pending?.type === 'direction' ? state.pending.remainingSteps : 0;
  const stepCue = remainingSteps > 0 ? `<span class="map-hint-steps">还剩 ${remainingSteps} 步</span>` : '';
  root.system.innerHTML = `<span class="pill">第 ${state.day} 天</span>
    <span class="pill">物价 ${state.priceIndex.toFixed(2)}</span>
    ${center ? `<span class="pill center-pill" title="${centerOwner ? centerOwner.name : '无主'}｜Lv.${centerPr?.level ?? 0}｜${state.map.nodes.filter(n => n.adjacentPlots?.includes(center.id)).length} 个入口｜${(centerPr?.price ?? 0).toLocaleString()}">中心 ${centerOwner?.name ?? '无主'} Lv.${centerPr?.level ?? 0}</span>` : ''}
    <span class="grow"></span>
    ${state.slice?`<span class="pill">${state.pending?.type === 'direction' ? `<span class="map-hint-default">街角生意 · 每回合两张卡</span>${stepCue}<span class="map-hint-cue">直接点地图上高亮的路面</span>` : '街角生意 · 每回合两张卡'}</span>`:`<button data-stock="1" ${state.phase === 'action' && !state.pending ? '' : 'disabled'}>股票</button>`}`;
  const stockButton=root.system.querySelector('[data-stock]'); if(stockButton) stockButton.onclick = () => actions.openStock();

  renderPlayers(root.players, state, p);
  renderSliceInsight(root.insight,state,p);
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
    // #3278：隐藏决策板时必须同时停掉它那条提示订阅。提示挂在**最外层裁切祖先**上
    // （实测是 #hand，不是 #choice），所以 hidden 掉 #choice 并不会隐藏它：上一屏的
    // 「↓ 还有 N 个方向在下面」会留在动作屏底部，指向已经不存在的东西（实测 390×844
    // OUT-C-stray/record-11-stray-hint，提示在 #hand 里、#choice 隐藏）。
    // resetOverflowHint 自己的契约就是「换屏就停订阅」，这里正是换屏的另一半。
    resetOverflowHint(root.choice);
    root.cards.hidden = false;
    root.dice.hidden = false;
    renderHand(root, state, p, actions, opts);
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
  let s = `${n.label}：${cellHelp(state, n.kind)}`;
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
    const baseName = plot.big ? (pr?.bigType ? BIG_NAME[pr.bigType] : '大空地') : '小地产';
    const name = plot.name ?? baseName;
    const glyph = plot.big ? (pr?.bigType ? ({ commercial:'商', hotel:'饭', bookstore:'书', energy:'能', realestate:'地', research:'研', park:'公' }[pr.bigType] ?? '大') : '大') : (pr?.level > 0 ? '房' : '地');
    const glyphSvg = structureSvg(plot, pr);
    const xs = plot.cells.map(c => c.x), ys = plot.cells.map(c => c.y);
    const x = Math.min(...xs) * S, y = Math.min(...ys) * S;
    const w = (Math.max(...xs) - Math.min(...xs) + 1) * S;
    const h = (Math.max(...ys) - Math.min(...ys) + 1) * S;
    const frontage = state.map.nodes.filter(n => n.adjacentPlots?.includes(plot.id)).length;
    const status = owner ? `${owner.name} Lv.${pr.level}` : (pr?.level > 0 ? `无主已建 Lv.${pr.level}` : '无主空地');
    const title = `${name}${pr?.bigType ? `（${BIG_NAME[pr.bigType]}）` : ''}｜${status}｜标价 ${buyPrice(state, plot.id).toLocaleString()}${frontage ? `｜${frontage} 个入口` : ''}`;
    const pickPlot = state.mapPick?.plot;
    const filter = state.mapPick?.filter;
    const filterPlayer = state.players.find(q => q.id === state.mapPick?.playerId);
    let pickAllowed = true;
    if(state.mapPick?.plotIds) pickAllowed=state.mapPick.plotIds.includes(plot.id);
    if (filter) {
      const owner = pr?.ownerId ? state.players.find(q => q.id === pr.ownerId) : null;
      pickAllowed = pickAllowed && !!pr && !!filterPlayer && !plot.big && pr.level > 0 && (filter === 'teamBuiltSmall' ? owner?.team === filterPlayer.team && !pr.closed : filter === 'enemyBuiltSmall' ? !!owner && owner.team !== filterPlayer.team : true);
    }
    const pickClass = pickPlot && pickAllowed ? 'pick-target' : (pickPlot ? 'pick-blocked' : '');
    const marks = [
      pr?.closed > 0 ? `<b class="mark stop">停${pr.closed}</b>` : '',
      pr?.inflate > 0 ? `<b class="mark inflate">涨${pr.inflate}</b>` : '',
    ].join('');
    // #3332：收购候选四个都是 10,000，价一样 —— 只写着价就等于什么也没区分。
    // 实测这四个的平均结局是 5.0% / 5.3% / 19.3% / 19.3%（n=300，同种子）；
    // 差别全在「这条街有人走吗」。所以角标改成「价 · 每局大概能收多少」，
    // 数与卡面/面板同源（takeoverModel → rentFor × 实测被踩频率）。
    const takeRow = state.mapPick?.cardId === 'buyland' && state.mapPick?.takeover
      ? state.mapPick.takeover.rows.find(r => r.id === plot.id) : null;
    // 收购候选的价全都一样（都是 10,000），所以这里印价等于没印；印**每局大概能收多少**
    // —— 那才是这四个候选真正不同的地方。价在面板里逐条列着。
    // #3333：角标只印**我这块**每局收多少（perGame），不印 perGame+siblingPerGame。
    // 角标只有一格宽，两个数塞不下；而把「他少收」并进来会让人以为那块地的租金值这个数。
    // 两项都在面板里分开写（那里有位置说清是谁的）。
    // #3333（用户报的那一屏带出来的第二处）：选收购目标时，**地图上每一块**都在印价 ——
    // 自己的两间、无主地、书屋，全都写「收 10,000」。而这张卡只收「别人已开张的小店」，
    // 那些地根本不是候选（它们是 pick-blocked 的灰色块）。印价等于告诉玩家可以点。
    //
    // 修法：只给**真候选**（takeRow 存在的那几块）印数；其余保留归属与状态，不印价。
    // 不是隐藏信息 —— 标价在 title 里、买/收购别处都有；这里只是不再声称那一块能收。
    // 非候选（自己的店、无主地、书屋）只写它**本来**是什么 —— 租金 / 可买价 / 开售日，
    // 那是地图一直都在提供的信息，不是这张卡的报价。写一排「不能收」虽然不假，
    // 但九块都写一遍会把地图变成噪音，而且玩家真正要比较的是四块候选之间的关系。
    // 收购报价只出现在真候选上（takeRow），与面板同一个数。
    const captionValue = state.slice && !owner && state.day < (plot.availableFromDay ?? 1)
      ? `第 ${plot.availableFromDay} 天开售`
      : takeRow ? `约 +${money(takeRow.perGame)}`
      : owner ? (pr.closed ? '停租' : `租 ${money(rentFor(state, plot.id))}`)
      : `购 ${money(buyPrice(state, plot.id))}`;
    const level = plot.big ? '' : (pr?.level > 0 ? `<span class="lvp">${'•'.repeat(Math.min(5, pr.level))}</span>` : '');
    return `<div class="prop ${plot.big ? 'bigprop' : ''} ${plot.name === '中央大酒店' ? 'grand' : ''} ${pr && !owner ? 'unowned' : ''} ${pickClass} ${pr ? (pr.level > 0 ? 'built' : 'empty-ground') : ''}" data-plot="${plot.id}"${pickPlot && pickAllowed ? ` data-pick-plot="${plot.id}"` : ''} title="${title}"
      style="left:${x + 1}px;top:${y + 1}px;width:${w - 2}px;height:${h - 2}px;border-color:${owner?.color ?? '#3a404b'};background:${owner ? owner.color + '22' : '#181c22'}">
      <div class="picon">${glyphSvg}</div>${level}${marks}${state.slice?`<span class="plot-caption">${name}<br>${owner?.name??'无主'}<br><b>${captionValue}</b></span>`:''}
    </div>`;
  }).join('');

  const zones = (map.zones ?? []).map(z => `<div class="zone" style="left:${z.x * S}px;top:${z.y * S}px;width:${z.w * S}px;height:${z.h * S}px;background:${z.color}"></div>`).join('');

  const roads = map.nodes.map(n => {
    const here = state.players.filter(q => q.alive && q.position === n.id);
    const place = state.placements[n.id];
    const ground = n.kind === 'empty' ? '' : (svgIcon(n.kind) ?? GROUND_ICON[n.kind] ?? '?');
    const title = n.kind === 'empty' ? '' : `${n.label}：${cellHelp(state, n.kind)}`;
    const roadStop = STOP_ROAD.has(n.kind);
    const roadPass = PASS_ROAD.has(n.kind);
    const occStop = !!place && STOP_OCC.has(place.kind);
    const occPass = !!place && PASS_OCC.has(place.kind);
    const dirTarget = dirOptions.has(n.id);
    const canPick = pickMode && !state.mapPick?.plot && (!pickCells || pickCells.has(n.id));
    const extra = dirTarget ? 'dir-target' : canPick ? 'pick-target' : '';
    const attr = dirTarget ? ` data-dir-cell="${n.id}"` : canPick ? ` data-pick-cell="${n.id}"` : '';
    const cur = state.map.nodes.find(x => x.id === currentP?.position);
    const da = cur ? Math.atan2(n.y - cur.y, n.x - cur.x) * 180 / Math.PI : 0;
    const flow = `${roadStop ? 'road-stop' : ''} ${roadPass ? 'road-pass' : ''} ${occStop ? 'occ-stop' : ''} ${occPass ? 'occ-pass' : ''}`;
    const [nx, ny] = n.id.split(',').map(Number);
    const linked=id=>state.map.edges.some(e=>((e.a===n.id&&e.b===id)||(e.b===n.id&&e.a===id))&&!state.map.runtime?.closed.has([n.id,id].sort().join('|')));
    const links = `${linked(`${nx},${ny-1}`)?' link-n':''}${linked(`${nx},${ny+1}`)?' link-s':''}${linked(`${nx-1},${ny}`)?' link-w':''}${linked(`${nx+1},${ny}`)?' link-e':''}`;
    const occTitle = place ? occHelp(state, place.kind, place.name) : '';
    return `<div class="cell ${extra} ${flow}${links}${n.surface ? ` surface-${n.surface}` : ''}${n.centerFront ? ' center-front' : ''}${!ground ? ' no-ground' : ''}${ground ? ' has-ground' : ''}${place ? ' has-occ' : ''}${here.length ? ' has-token' : ''}" data-cell="${n.id}"${attr}
      style="left:${n.x + 1}px;top:${n.y + 1}px;width:${S - 2}px;height:${S - 2}px">
      ${ground ? `<div class="gicon" title="${title}">${ground}</div>` : ''}
      ${place ? `<div class="occs" title="${occTitle}">${obstacleSvg(place.kind, place.name)}</div>` : ''}
      ${dirTarget ? `<i class="dir-mark" style="--a:${da}deg"></i>` : ''}
      <div class="tokens">${here.map(q => {
        const d = q.facing ?? q.lastNode; const t = d ? nodes[d] : null;
        const a = t ? Math.atan2(t.y - n.y, t.x - n.x) * 180 / Math.PI : 0;
        return `<span class="tok ${q.id === currentP?.id ? 'cur' : ''}" data-player="${q.id}" style="--c:${q.color};color:${q.color};transform:rotate(${a + 90}deg)" title="${q.name}"><span class="tok-avatar" style="transform:rotate(${-(a + 90)}deg)">${avatarSvg(q.charId, q.color, q.name)}</span><i class="ptr"></i></span>`;
      }).join('')}</div>
    </div>`;
  }).join('');

  const availW = Number(el.clientWidth) || W, availH = Number(el.clientHeight) || H;
  const minScale = typeof window !== 'undefined' && window.innerWidth <= 760 ? 0.55 : 0.3;
  const scale = Math.max(minScale, Math.min(3.2, (availW - 24) / W, (availH - 24) / H));
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.innerHTML = `<div class="grid-fit" style="width:${Math.round(W * scale)}px;height:${Math.round(H * scale)}px">` +
    `<div class="grid-board" style="width:${W}px;height:${H}px;transform:scale(${scale});transform-origin:0 0">${zones}${plots}${roads}</div></div>`;
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
        <span class="avatar">${avatarSvg(p.charId, p.color, p.name)}</span>
        <b>${p.name}</b><span class="team">${p.team}${p.isBoss ? ' T' + p.bossTier : ''}</span>
        <span class="pmeta">现 ${short(p.cash)} 存 ${short(p.deposit)} · 地 ${p.properties.length} · ${state.map.nodes.find(n => n.id === p.position)?.label ?? '-'}${p.dirMode ? ` · 方向${{ cw: '顺', ccw: '逆', random: '随机', choose: '自选' }[p.dirMode]}` : ''}</span>
        <span class="pslots">
          <span class="slot bind" title="绑定状态：${p.god ?? '无'}">${p.god ? (GOD_ICON[p.god] ?? '神') + p.godDays : '—'}</span>
          <span class="slot body" title="人物状态：${p.status ?? (p.skipTurns ? '停留 ' + p.skipTurns : '无')}">${p.status ? (STATUS_ICON[p.status] ?? '状') + p.statusDays : (p.skipTurns ? '停' + p.skipTurns : '—')}</span>
          <span class="slot phys" title="物理状态：${p.jail ? '监狱 ' + p.jail : p.hospital ? '医院 ' + p.hospital : '无'}">${p.jail ? '监' + p.jail : p.hospital ? '医' + p.hospital : '—'}</span>
        </span>
      </div>
    </div>`;
  }).join('');
}

// #719：岔口选项多到装不下时，折叠线以下的路线玩家看不见也猜不到。
// 这里只做两件可测的事：算「有几条在**玩家真正能看到的范围**之外」，把它写成一行提示。
// 不改可达性、不改顺序、不改金额。

export function hiddenOptionCount(container, items) {
  return hiddenOptionSides(container, items).below;
}

// #878：上一版只数「底边越过可见带下沿」。真浏览器实测（390×844 真入口，四向岔口）：
//   玩家为够到下面的选项往上滚之后，先前的选项会被推出可见带**上沿**，
//   而此时提示仍写「↓ 还有 N 个方向在下面」—— 方向说反；
//   若同时没有下方选项，below 归 0，提示被移除，上面那几项**彻底没有任何提示**。
// 实测截图之外的读数见 .scratch/878-volume/hint-settle.json：
//   hs120/160/200 多组上沿外 1 条而提示写「下面」；hs190 四组上沿外 1 条而提示为 null。
// 只数条数，不改任何可达性/顺序判断；两侧都数。
export function hiddenOptionSides(container, items) {
  const top = container.top;
  const bottom = container.top + container.height;
  let above = 0, below = 0;
  for (const r of items) {
    if (r.bottom > bottom + 1) below++;
    else if (r.top < top - 1) above++;
  }
  return { above, below };
}

export function overflowHintText(n) {
  return `↓ 还有 ${n} 个方向在下面`;
}

// above=0 时与旧文本逐字相同（既有断言断言的就是这一串），只在真有上方项时才多说一句。
export function overflowHintTextSides({ above = 0, below = 0 } = {}, label = '方向') {
  const parts = [];
  if (above > 0) parts.push(`↑ 还有 ${above} 个${label}在上面`);
  if (below > 0) parts.push(`↓ 还有 ${below} 个${label}在下面`);
  return parts.join(' · ');
}

// #742：同一种「下面还有东西但玩家不知道」的形态，补给屏也有。
// 实测（真 Edge 1280×800，真开一局后同帧量）：补给屏 4 个入口里只有 1 个完全在可视区，
// 而且这是**原有**缺陷（#hand.choice 261px 高、内容 387px）—— 不是这单引入的，
// 但本单给每包加的第 3 行把它又往下压了一档（改前 2 个可见 → 改后 1 个）。
// 不能只把字加进去就不管入口还在不在：那样「看得懂」反而变成「选不到」。
// #786：窄屏判定抽成纯函数，好让测试直接断言这条分支，
// 而不是等着「真浏览器恰好窄」才能考到。与 styles.css 的 @media(max-width:760px) 同界。
export function isNarrowViewport(width) {
  // 拿不到视口（Node 渲测桩）时按“不窄”处理：宁可多一行 desc，也不要让测试与线上不一致。
  return typeof width === 'number' && width > 0 && width <= 760;
}

export function supplyOverflowText(n) {
  // #878：既接受旧的数字（既有断言就这么调），也接受新的 {above, below}。
  if (n && typeof n === 'object') return overflowHintTextSides(n, '补给选项');
  return `↓ 还有 ${n} 个补给选项在下面`;
}

// 实测（真 Edge 1280×800）：只拿 #choice 自己的矩形当边界是错的。
//   #choice bottom=882，但它的父 #hand 也是 overflow:auto，bottom=790。
//   玩家真正能看到的底边是 min(所有裁切祖先 + 视口) = 790。
// 上一版用 882 当边界 ⇒ 少算被遮条数（说「还有 1 个」，实际 2 个），
// 而且提示自己也被 #hand 裁掉（提示在 834..867，看不见）。
// 这里把「真正的可见边界」和「该把提示挂在哪」一起算出来。
export function visibleBounds(el, viewport, doc = globalThis.document) {
  let top = -Infinity, bottom = Infinity, host = null;
  // 实际在裁的每一层都记下来：滚动可能发生在**任意一层**，不只最外层。
  // 实测 390×844：顶部裁者是 #hand，滚过之后裁者是 #choice —— 只绑 host 就漏了。
  const clippers = [];
  for (let node = el; node; node = node.parentElement) {
    const cs = globalThis.getComputedStyle?.(node);
    // #3264d：position:fixed 的元素**脱离**祖先的裁切 —— 它自己的 overflow 仍然裁它的内容，
    // 但祖先的裁切线不再落在它身上。旧行为把固定板 424.5..844 与 #hand 的 648..837 取交，
    // 于是补给屏四项全在屏上、全可点，提示却写「↑ 还有 2 个在上面」（实测 OUT-9-walk）。
    // 这就是 #3232 那一类「屏上说假话」：几何变了，量具没跟上。自己算裁切者，然后停。
    const fixed = cs?.position === 'fixed';
    const clips = cs && /hidden|auto|scroll|clip/.test(String(cs.overflowY) + String(cs.overflow));
    if (!clips && !fixed) continue;
    if (typeof node.getBoundingClientRect !== 'function') continue;
    const r = node.getBoundingClientRect();
    top = Math.max(top, r.top);
    bottom = Math.min(bottom, r.bottom);
    if (clips) clippers.push(node);
    // 挂点取**最外层的非 body/html 裁切者**：body 在 styles.css 里是 overflow:hidden，
    // 把提示挂到 body 上虽然看得见，但下次 render 无法可靠回收（会逐帧累加），
    // 而且它脱离了 #hand 的布局。实测 #hand 底边 790 < 视口 800，挂它已经够。
    if (node !== doc?.body && node !== doc?.documentElement) host = node;
    // #3264d：定位到 fixed 就是裁切链的末端 —— 祖先的裁切不再作用于它，停在这里。
    if (fixed) break;
  }
  const vh = viewport ?? globalThis.innerHeight;
  if (typeof vh === 'number' && vh > 0) bottom = Math.min(bottom, vh);
  return { top, bottom, height: bottom - top, host, clippers };
}

const overflowObservers = new WeakMap();

export function resetOverflowHint(el) {
  // #3232：提示可能**当时还不存在**（挂载那帧 n=0，之后由滚动补出来），所以只删 DOM 不够：
  // 上一屏那条 recalc 订阅必须一起停掉，否则它会在新屏的 DOM 上把提示复活出来。
  overflowObservers.get(el)?.();
  overflowObservers.delete(el);
  // 提示可能挂在 el 本身或某个祖先上（实测是 #hand），所以两者都扫。
  for (const node of [el, el?.parentElement].filter(Boolean)) {
    for (const old of [...(node.querySelectorAll?.('[data-overflow-hint]') ?? [])]) old.remove?.();
    if (node.hasAttribute?.('data-overflow-hint')) node.remove?.();
  }
}

// 需要真实布局。拿不到布局（测试桩/隐藏）或没有 document 时返回 null，
// 宁可不出提示，也不许凭 options.length 编一个数字。
// 提示挂在**最外层裁切祖先**上（实测是 #hand），否则它自己会被裁掉。
// itemSelector / text 可换（默认就是「方向」那一套），这样补给屏能复用同一套几何判定，
// 而不是再写一份「哪个祖先在裁、裁掉几个」的逻辑。
export function mountOverflowHint(el, itemSelector = '.route-choice', text = overflowHintTextSides) {
  resetOverflowHint(el);
  if (typeof el.getBoundingClientRect !== 'function') return null;
  const doc = globalThis.document;
  if (!doc?.createElement) return null;
  const items = [...el.querySelectorAll(itemSelector)];
  if (!items.length) return null;
  const bounds = visibleBounds(el, undefined, doc);
  if (!Number.isFinite(bounds.bottom)) return null;
  const sides = hiddenOptionSides({ top: bounds.top, height: bounds.height }, items.map(b => b.getBoundingClientRect()));
  // #3232：这一行是本次修复的全部要点。上一版在这里 `if (n <= 0) return null`，
  // 于是「挂载那一帧正好不越界」的屏在本轮**永远不会再声明**：recalc 只维护已存在的提示，
  // 从不下沉到创建路径。实测（#3218）：岔路屏挂载瞬间 #hand 被焦点滚动挪了 29px ⇒
  // below=0 ⇒ 没有提示对象 ⇒ 玩家滚回顶部、选项仍被裁 21.2px，也没有任何「下面还有」。
  // 现在：计数为 0 只表示「此刻不用显示」，订阅照旧装上；往后的滚动/resize 一旦让
  // 越界数从 0 变正，就**创建**提示。已存在提示的维护路径（改数字/换方向/移除/重挂）不变。
  const host = bounds.host ?? el;
  const lifetime = new AbortController();
  // 同一个屏内复用同一个元素：实测 #878 R2 要求「移除后回来」不能逐帧新建（会累加）。
  let hint = null;
  let visible = false;
  let lastSides = null;
  const show = current => {
    // 比两侧而不是只比总数：above1/below0 与 above0/below1 总数都是 1，
    // 只比总数会让文字停在写反的方向上（#878 实测就是这一类）。
    if (visible && lastSides?.above === current.above && lastSides?.below === current.below) return;
    lastSides = current;
    const count = current.above + current.below;
    if (count <= 0) {
      // 全部看到了就收掉提示，免得它占一行还把「还有 0 个」挂在那儿；对象留着下次复用。
      if (visible && hint) hint.remove();
      visible = false;
      return;
    }
    if (!hint) {
      hint = doc.createElement('div');
      hint.className = 'route-more';
      // 内联样式：styles.css 是页面五指纹之一，本次不许动它。
      // pointer-events:none：提示是 sticky 浮在列表底部的，实测它会盖住它正在指的那一项
      // （.scratch/845-hole/four5.json 里「向左」的 blocking 就是 route-more）⇒「告诉你下面还有」变「挡住你点」。
      // #3278：**不许占布局空间**。sticky 会保留 flow（这正是 #786 记的「提示占着底部
      // 34px」），而 #hand 是 bottom-anchored、#choice 内容也是底对齐：append 一条 34px 的
      // 提示会把可见带从上方撑高 34px，于是「插入」这件事自己抹掉了它要报告的短缺。
      // 两个方向都实测到过：插入后量 → 计数变 0，提示被自己收掉、路线重新被静默裁切
      // （OUT-H key3 parent:null）；插入前量 → 提示留着说「还有 1 个」，而两个方向都已可见
      // （OUT-G）。absolute 让插入不改变任何 item box，计数前后一致、文字在显示时始终为真。
      // 宿主若是 static，就把它变成 relative（只影响定位，不改尺寸与流）。
      // 能力探测而不是 try/catch：#742 的教训 —— 桩宿主可能没有 .style。定位只在真
      // 浏览器里影响绘制，桩里跳过它不影响任何几何断言。
      if (host.style && getComputedStyle(host)?.position === 'static') host.style.position = 'relative';
      hint.setAttribute('style', 'position:absolute;left:0;right:0;bottom:0;z-index:5;pointer-events:none;padding:4px 6px;'
        + 'text-align:center;color:#f4ce7c;background:#1b2028;border:1px solid #64543a;border-radius:6px;');
      hint.setAttribute('data-recalc-bound', '1');
    }
    hint.setAttribute('data-overflow-hint', String(count));
    hint.textContent = text(current);
    if (!visible) {
      host.appendChild(hint);
      visible = true;
    }
  };
  const recalc = () => {
    if (lifetime.signal.aborted) return;
    // 每次重算都用当前布局，不信任缓存的 bounds：滚动会改变元素的视口位置。
    const b = visibleBounds(el, undefined, doc);
    if (!Number.isFinite(b.bottom)) return;
    show(hiddenOptionSides({ top: b.top, height: b.height }, items.map(x => x.getBoundingClientRect())));
  };
  show(sides);
  // 测试桩/非 DOM 宿主可能没有 addEventListener —— 不能因此把整个渲染弄崩。
  // （#742 我在补给屏犯过同类：假定调用方一定给 cards。这里选择能力探测，不是 try/catch 掩盖。）
  // 绑到**每一层裁切容器**，不只 host：实测手机上真正在滚的是 #choice，而 host 是 #hand
  // （已到顶，不再派发 scroll）⇒ 数字停在旧值，屏上写「还有 1 个」而几何上还有 3 个。
  const scrollTargets = [...new Set([host, ...(bounds.clippers ?? [])].filter(Boolean))];
  for (const t of scrollTargets) {
    if (typeof t.addEventListener === 'function') t.addEventListener('scroll', recalc, { passive: true, signal: lifetime.signal });
  }
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('resize', recalc, { passive: true, signal: lifetime.signal });
  }
  // #3232：换屏时停掉这条订阅。只删 DOM 不够 —— 提示此时可能还不存在，
  // 上一屏的 recalc 会在新屏上把它造出来（那正是本片要修的东西，不能泄漏到下一屏）。
  overflowObservers.set(el, () => {
    lifetime.abort();
    if (hint && visible) hint.remove();
  });
  // 返回形状保持旧契约：真溢出时给 { n, el, host, recalc }，不溢出时 null（既有 4 条断言钉着这个）。
  return sides.above + sides.below > 0
    ? { n: sides.above + sides.below, el: hint, host, recalc }
    : null;
}

function renderSuperdice(el, state, p, actions, nums) {
  el.innerHTML = `<h3>超级骰子</h3><p class="hint">先选步数看预览，确认才用卡。按当前盘面预览，有岔路仍在移动时选。</p>
    <div class="dice-choice superdice-values" role="group" aria-label="预览步数">${nums.map(n => `<button type="button" data-superdice-value="${n}" aria-label="预览 ${n} 步" aria-pressed="false">${n}</button>`).join('')}</div>
    <p class="superdice-lines" data-superdice-lines role="status" aria-live="polite" aria-atomic="true">选一个步数，看可能的落点与停格税。</p>
    <button type="button" data-superdice-confirm disabled>确认用卡</button><button type="button" data-superdice-cancel>不用这张卡</button>`;
  const values = [...el.querySelectorAll('[data-superdice-value]')];
  const lines = el.querySelector('[data-superdice-lines]');
  const confirm = el.querySelector('[data-superdice-confirm]');
  let picked = null;
  for (const b of values) b.onclick = () => {
    picked = Number(b.dataset.superdiceValue);
    for (const item of values) item.setAttribute('aria-pressed', String(item === b));
    lines.textContent = superdiceLines(state, p, picked).join('\n');
    confirm.textContent = `用卡：设为 ${picked} 步`;
    confirm.disabled = false;
  };
  confirm.onclick = () => { if (picked != null) actions.diceValue(picked); };
  el.querySelector('[data-superdice-cancel]').onclick = () => actions.diceValue(null);
}

function renderChoice(el, state, p, actions) {
  resetOverflowHint(el);
  if (state.phase === 'over') {
    if(state.slice) {el.innerHTML=sliceResults(state);el.querySelector('[data-replay]').onclick=actions.replay;return;}
    const rows = [...state.players].sort((a, b) => assetsOf(state, b) - assetsOf(state, a))
      .map((x, i) => `<tr><td>${i + 1}</td><td>${x.name}</td><td>${x.team}</td><td>${assetsOf(state, x).toLocaleString()}</td><td>${x.properties.length}</td><td>${x.alive ? '' : '破产'}</td></tr>`).join('');
    const center = state.map.plots.find(x => x.name === '中央大酒店');
    const centerPr = center ? state.properties[center.id] : null;
    const centerOwner = centerPr?.ownerId ? state.players.find(x => x.id === centerPr.ownerId) : null;
    const reason = state.day > (state.config.dayLimit ?? 50) ? `第 ${state.config.dayLimit ?? 50} 天资产结算` : '对手全部破产';
    el.innerHTML = `<h3>比赛结束：${state.winnerTeam ?? '—'} 胜</h3>
      <p class="hint">${reason} · 总租金 ${Math.round(state.stats.rents).toLocaleString()} · 破产 ${state.stats.bankruptcies} 人 · 中心大酒店：${centerOwner?.name ?? '无主'}</p>
      <table class="rank"><thead><tr><th>#</th><th>角色</th><th>队伍</th><th>资产</th><th>地产</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    return;
  }
  if (state.mapPick) {
    const name = state.slice?sliceCardName(state.mapPick.cardId):(state.mapPick?.label ?? CARD_DEFS[state.mapPick.cardId]?.name ?? '卡片');
    // #741：旺季/停业是「选一条街」，后果取决于这条街归谁，而且两张卡方向相反——
    // 「对手 2 间、你 0 间」的街上开旺季是帮对手，停业才是压对手。
    // 原来只有一句「直接点地图上的地产」，玩家得自己在地图上数名字。
    // 街级数字全走 streetCardModel（内部 rentFor），与真实结算同源。
    if (state.slice && state.mapPick?.value === 'street') {
      const rows = streetCardModel(state, p, state.mapPick.cardId);
      // #3319：排序键必须与卡面/补给屏的「对你值多少」是同一个数。
      // 旧键是 |对手每次踩到的钱变化| —— 那会把「帮对手最多的街」排到第一。
      // 实测 142 帧：45 帧里对你最优的街根本不在 4 条可见行里；63 帧旺季屏的第一行就是亏钱的选择。
      // 卡面写「对你最值 +14,000 · 晨光街」，同一张卡点开后头四行全是负数的街，那是两屏互相打脸。
      //
      // net 不在这里算：streetCardModel 每一行自带（insight.js），supplyWorth 用的也是它。
      // 本函数上一版自己写了一份公式，于是「同一件事有两份实现」——
      // 那正是这一轮要修的病，不在新代码里重新种一遍。
      const netOf = r => r.net ?? 0;
      const sorted = rows.slice().sort((a, b) => netOf(b) - netOf(a));
      const MAX = 4;
      const shown = sorted.slice(0, MAX);
      const rest = sorted.slice(MAX);
      const line = r => {
        // 状态必须写明：0 元会被读成「这条街本来就不收钱」（判据 S4）。
        // 用词不能省：「已停业」「已在旺季」是玩家判 0 元的唯一依据（S4）。
        const mark = r.closed > 0 ? `·已停业${r.closed}天`
          : r.inflate > 0 ? `·已在旺季${r.inflate}天` : '';
        // #683 规矩「只写会变的东西」在这里要读对：**不写的应该是箭头，不是金额**。
        // 已在旺季的街再开旺季，租金不变（计时器重设），
        //   「对手5,600→5,600」浪费一行宽度，还让这行折成 2 行 ——
        //   390×844 实测正是这个折行把「取消」顶出 #hand（行 44.8px vs 22.4px，下沿 865 > 837）。
        // 但把金额整个删掉更坏：玩家仍然要看这个数才能比较，只是不需要看第二次。
        // 所以不变时写一次（「对手5,600」），变时照旧写两下（「对手5,600→11,200」）。
        const pair = (label, before, after) => {
          if (!before && !after) return '';
          return before === after ? `${label}${money(before)}` : `${label}${money(before)}→${money(after)}`;
        };
        const own = r.mineCount ? ` ${pair('你', r.mine, r.after.mine)}` : '';
        const oppPart = r.oppCount ? `：${pair('对手', r.opponent, r.after.opponent)}` : '';
        // 单条目标点：≤40 字（S6）。空格只省字不省信息，所以计数与金额之间不空。
        return `<li>${r.street} 你${r.mineCount}间/对手${r.oppCount}间${mark}${oppPart}${own}</li>`;
      };
      // 被截断的街不是消失：点出剩下的里仅次于已列出的那条（同 net 键）。
      const more = rest.length ? `<li>还有 ${rest.length} 条，对你最值 ${rest[0].street}</li>` : '';
      // 字数：卡牌长描述在本帧重复无益（地图上同一张卡已高亮），换成一句动作指令。
      // 单条 ≤40 字，整框 ≤200 字（判据 S6）；超出的街用「还有 N 条」概括并点出对你最值的那条。
      //
      // #3319：把「这次该点哪条」直接写在标题下那一行。旧文案只说「数字是现在→用卡后」，
      // 五行数要玩家自己横向比较；现在直接给出 net 最高的街（与上面排序同一个数）。
      //
      // 四种局面必须四句话，尤其 bestNet===0 的两种不能合并：
      //   ① 所有街都是 0（都已在本卡的状态里）：开哪条都一样，那确实「不动账」。
      //   ② 最好的那条是 0，但其他街对你是负的（开在对手街上只会帮他）：
      //      这时说「对你都不动账」是假话。实测 grow/1 D4 就是这一种：
      //      晨光街（已在旺季）0，而晚风街/灯火街各 -5,600。
      // 每一句都在真页面上量过 390×844 与 1280×800 都是 1 行、
      // 「取消」中心命中 itself（见证据 receipt-3319/picker-live.md）；
      // 这个上限不是审美：2 行时 choice 下沿 865 越过 #hand 的 837，取消键真的点不到 ——
      // 旧文案里那条不变的「你22,400→22,400」折行就是这个后果（已一并去掉）。
      const bestRow = sorted[0] ?? null;
      const bestNet = bestRow ? netOf(bestRow) : 0;
      const worstNet = bestRow ? netOf(sorted[sorted.length - 1]) : 0;
      const bestPart = !bestRow ? ''
        : bestNet > 0 ? `对你最值 +${money(bestNet)} · ${bestRow.street}`
        : bestNet < 0 ? `最好也亏 ${money(-bestNet)}（${bestRow.street}）`
        : worstNet < 0 ? `${bestRow.street} 不动账，其余帮对手`
        : `全都不动账`;
      el.innerHTML = `<h3>${name}</h3><p class="hint">数字是现在每次踩到的租 → 用卡后${bestPart ? `；${bestPart}` : ''}</p>` +
        `<ul class="street-card">${shown.map(line).join('')}${more}</ul><button data-act="cancel-pick">取消</button>`;
      el.querySelector('[data-act="cancel-pick"]').onclick = () => actions.act('cancel-pick');
      return;
    }
    const hint = state.mapPick?.plot ? '直接点地图上的地产选择目标' : '直接点地图上高亮的路面';
    // #3332：收购的四个候选**价一样、等级一样、标称租一样**，只写着价就等于什么也没说。
    // 实测（take，seed 1–300，只改买哪一间）：晚风街 5.0%/5.3%，灯火街 19.3%/19.3%。
    // 差别是「这条街有没有人走」。这里把那个差别摆成一行可比的数。
    const take = state.slice && state.mapPick?.cardId === 'buyland' && state.mapPick?.takeover
      ? state.mapPick.takeover : null;
    const takeLines = take ? take.rows.map(r => {
      const who = r.seller ? `从${r.seller}` : '收购';
      // #3333（用户当场抓到的那处）：这里原来写「每局约 +2,078，另压对手 800」，
      // 而 2,078 里**已经含**那 800，且 800 是「对手每次」的单次量、不是每局。
      // 读起来是「多赚 2,078，再额外压 800」——一个数重复了一次，两个数单位还不同。
      //
      // 现在拆成两笔**同量纲（都是每局）且互不包含**的账：
      //   我：我这块每局约收 N（rentMine × 每局被踩次数）
      //   他：对手同街另一块每局约少收 M（每次少收 × 它自己的每局被踩次数）
      // 比较时看两者之和（排序用的也是它），但屏上不把它们相加成一个数就完事 ——
      // 「你多赚」和「他少收」对胜负的作用不同，混成一个数会让人以为那 800 是白得的。
      const mine = `我这块每局约 +${money(r.perGame)}`;
      const theirs = r.siblingPerGame > 0 ? `他少收约 ${money(r.siblingPerGame)}` : '';
      // 店名自己已经含街名（「灯火街茶铺」），不再前缀一次街名，否则一行里写两遍。
      return `<li>${r.name} ${money(r.cost)}（${who}）<b>${mine}</b>${theirs ? ` · ${theirs}` : ''}</li>`;
    }).join('') : '';
    // #1398：翻修选目标要写「升完多少」。原先只说「升 1 级」，地图角标只说**当前**租，
    // 两个候选都写「租 2,800」，玩家看不出升完差多少。
    // 实测（同一帧 A/B）：加这一行面板长 31px、取消键仍可命中、角标被盖 0 / 地产块点不到 0。
    const upg = state.slice && state.mapPick?.cardId === 'worker'
      ? upgradeAfterLine(state, p, state.mapPick.plotIds ?? [])
      : '';
    el.innerHTML = `<h3>${name}</h3><p class="hint">${state.slice?sliceCardDescription(state.mapPick.cardId)+'<br>':''}${hint}</p>`
      + (takeLines ? `<ul class="street-card">${takeLines}</ul>` : '')
      + (upg ? `<p class="hint" data-upgrade-after>${upg}</p>` : '')
      + `<button data-act="cancel-pick">取消</button>`;
    el.querySelector('[data-act="cancel-pick"]').onclick = () => actions.act('cancel-pick');
    return;
  }
  const pending = state.pending;
  if (!pending) return;
  if(pending.type==='supply') {
    // #742：补给不可退，而引擎在 flow.js:207-208 对零目标卡是静默跳过——
    // 选完才发现这三天白给。手牌区早就写「现在没有合法目标」，补给屏却没有。
    // 合法性只问 sliceTargetIds，不在这里重写规则；停业/定步对它恒真，就不编数字。
    // 单位必须跟「玩家实际要选的东西」一致，而不是跟 sliceTargetIds 的内部粒度一致：
    //   worker 数已建房屋 → 栋；buyland 数地块 → 块；
    //   inflate 的合法目标是逐块的，但玩家选的是**一条街**，所以从同一份 id 输出里
    //   数不重复的街 → 「旺季6条街」。写「旺季12块」是如实但没用：12 不是它能做的决策数。
    // 不写金额：金额随等级/旺季变，写在选包处会被当固定值（#554）。
    const displayCount = (card, ids) => card === 'inflate'
      ? new Set(ids.map(id => state.map.plots.find(pl => pl.id === id)?.street).filter(Boolean)).size
      : ids.length;
    const UNIT = { worker: '栋', buyland: '块', inflate: '条街' };
    const fit = (card) => {
      const name = sliceCardName(card);
      if (card === 'close' || card === 'remotedice') return `${name}随时可用`;
      const n = displayCount(card, sliceTargetIds(state, p, card));
      return n > 0 ? `${name}${n}${UNIT[card] ?? '处'}` : `<em>${name}用不上</em>`;
    };
    // 没有 cards 字段的选项（旧调用方/桩数据）不能因此崩 —— 渲染层不该假定数据形状。
    // 真缺就不写这一段，而不是写一个空的「现在可用：」。
    //
    // 为什么要并进同一行而不是另起一个 <small>：真 Edge 1280×800 实测（真开一局后同帧量），
    // #hand.choice 只有 ~264px 高而内容 ~424px，四个入口里只有 1–2 个落在可视区。
    // 另起一行每包多 ~20px，直接把第一个可选包挤出屏幕 —— 那就成了「看得懂但选不到」。
    // 并进 span 只多一行换行的高度，不是每包多一整行。
    // #759：把「值不值」也写在同一行。每个金额都由 supplyWorth（内部 rentFor/buyPrice）算出，
    // 不在这里拼数字。旺季/停业是「每踩到一次」的量，屏上必须带「每次」二字，
    // 否则玩家会当总额（#554）——这条由测试锁住。
    const worthOf = (card) => {
      const w = supplyWorth(state, p, card);
      if (!w) return '';
      if (card === 'worker') {
        if (!w.count) return '';
        // 「每栋+X」是说谎：实测 60/60 帧里各栋增益不同（高等级栋涨得多、低等级涨得少）。
        // 玩家按「每栋」理解会算成 shown×N，在 grow/5 D4 上就是 22,400 vs 真实 15,200（高估 47%）。
        // 所以：只有一档时才写「每栋+」；多档时写**区间**，且写明「合计」都不乘。
        // 一张卡只升**一栋**（game.js:520 只改 pr.level +1），所以不能报总和。
        // 写成「单栋+X–Y」：玩家知道挑哪栋拿哪档，也知道总量不是乘以栋数。
        // 一张卡只升**一栋**（game.js:520 只改 pr.level +1），所以不能报总和。
        // 写成「单栋+X–Y」：玩家知道挑哪栋拿哪档，也知道总量不是乘以栋数。
        const lo = w.each[w.each.length - 1], hi = w.each[0];
        return lo === hi ? `单栋+${money(hi)}` : `单栋+${money(lo)}–${money(hi)}`;
      }
      if (card === 'buyland') {
        if (!w.count) return '';
        // 块数已经在「收购N块」里，这里只说价钱区间，不重写 N。
        return w.cheapest === w.dearest ? `每块${money(w.cheapest)}` : `每块${money(w.cheapest)}–${money(w.dearest)}`;
      }
      if (card === 'inflate' || card === 'close') {
        if (!w.best) return '';
        // 一律从「对你」说话，因为这次用的是真实付款方向（flow.js:599 踩到的人付给地主）：
        //   旺季 —— 你在这条街多收（你也有店就写出来）；对手是地主时，你趿到要多付。
        //   停业 —— 对手那条街归零（你路过安全）；你自己那条街也归零（你少收）。
        // 上一版写「对手每次多付」把付款方当成了对手，方向正好相反；
        // 而且「最佳街」按对手租降序选，推的恰好是**最帮对手**的街。
        // 「每次」不能省：这是单次量，不是一局总收入（#554）。
        const n = w.best.net;
        // #797：net=0 时旧写法会输出「对你不变（你每次多收）」——两个半句相互矛盾。
        // 这种情况是“你也有店，两边抵消”，必须直接说出来，而不是先报不变再报多收。
        if (n === 0) {
          const both = w.best.myGain > 0 && w.best.myCost > 0
            ? `你多收${money(w.best.myGain)}也多付${money(w.best.myCost)}，两抵`
            : '这条街对你分文不动';
          return `${both}·${w.best.street}`;
        }
        const sign = n > 0 ? `每次+${money(n)}` : `每次-${money(-n)}`;
        // 内层也要带「每次」：不带的「对手少收8,400」会被读成一局的总量（#554）。
        const who = card === 'inflate'
          ? (w.best.myGain > 0 ? `你每次多收` : `你每次多付`)
          : (w.best.myGain > 0 ? `你每次也少收${money(w.best.myGain)}` : `对手每次少收${money(w.best.myCost)}`);
        return `${sign}（${who}）·${w.best.street}`;
      }
      return '';
    };
    // #797：同名卡不能排两遍——屏上两行一模一样的「旺季3条街（每次-5,600）」
    // 会被读成“两张叠加 = -11,200”，而实测第二张打同一街是**重置**、不叠加。
    //
    // 但只写“不叠加”也会害人：两张打**不同街**时各自生效（各 +11,200）。
    // 所以重置型卡（inflate/close）必须**限制与机会同时写**；
    // 而 worker 是递增的（同栋 +2,800 后 +5,600），绝不能套“不叠加”，那会让人不敢升。
    //
    // 不写「覆盖 N 条街」：实测可选的 inflate 目标 = 12 块地 / 6 条街，
    // 两张卡每次只选 1 条 ⇒ 最多覆盖 2 条。这个数靠推断不如只写机制。
    const RESET_CARDS = new Set(['inflate', 'close']);
    const fitLine = (o) => {
      if (!Array.isArray(o.cards) || !o.cards.length) return '';
      const order = [];
      const count = new Map();
      for (const c of o.cards) {
        if (!count.has(c)) { count.set(c, 0); order.push(c); }
        count.set(c, count.get(c) + 1);
      }
      const parts = order.map(c => {
        const n = count.get(c);
        const w = worthOf(c);
        return fit(c) + (n > 1 ? `×${n}` : '') + (w ? `（${w}）` : '');
      });
      const resetDup = order.filter(c => count.get(c) > 1 && RESET_CARDS.has(c));
      const dupNote = resetDup.length
        ? '　※ 同一街重开只重置时间，不叠加；换一条街两张都生效'
        : '';
      return ` · 现在可用：${parts.join(' · ')}${dupNote}`;
    };
    // #786 H2：窄屏下四个入口共需 ~418px，而 #hand 只有 ~231px（差一半）。
    // 前四次“挪提示”的招都失败（记在 .scratch/786-p4/H2-four-attempts.md），因为差的不是几像素。
    // 真正能做的是减内容：`desc` 是静态推销词（「翻修 + 旺季：升级自己的店…」），
    // 第 4/7/10/13 天反复出现；而「现在可用：翻修2栋（单栋+2,800–5,600）」才是这次的决策依据。
    // 实测：隐去 desc 后「保留现有手牌」从 812–847（不可见）变成 759–793（可命中）。
    // 只在窄屏生效——桌面 px 充裕，desc 保留。
    const narrow = isNarrowViewport(globalThis.innerWidth);
    const descPart = (o) => (narrow ? '' : o.desc);
    el.innerHTML=`<h3>这三天，你想怎么做？</h3><p class="hint">选两张新卡。大家都能选同样的补给，不会被起手风格锁定。手牌最多 ${p.handLimit} 张，超出后自行弃牌。</p><div class="supply-options">${pending.options.map(o=>`<button data-supply="${o.id}"><strong>${o.name}</strong><span>${descPart(o)}${fitLine(o)}</span></button>`).join('')}</div><button data-supply="">保留现有手牌，不补给</button>`;
    el.querySelectorAll('[data-supply]').forEach(b=>b.onclick=()=>actions.supply(b.dataset.supply));
    // 把「保留现有手牌」也算进去：它也是玩家要看见的入口，实测它排在最后最容易被遮。
    // 几何判定复用的是 #719 那一套（哪个祖先在裁、裁掉几个），不重写。
    mountOverflowHint(el, '.supply-options button, button[data-supply=""]', supplyOverflowText);
    return;
  }
  if(pending.type==='discard') {
    // #1398：弃牌屏必须用与手牌卡面**同一份**措辞。
    // 改前两屏都是通用描述（一致）；我在手牌上加了盘面数之后，弃牌屏若不跟就会变成
    // 「手牌写着能收购 6 块、每块 10,000；几秒后在弃牌屏上同一张卡只剩通用话」——
    // 而弃牌正是要拿这两个数比「丢掉哪张亏得少」。
    // 几何已 A/B 过（discab.mjs，seed5 take，9 个按钮）：两种写法逐条 h=89.2、可见 8/9、可命中 7/9
    // 完全相同，所以换字不加重溢出。
    el.innerHTML=`<h3>为下一步腾个位置</h3><p>还需弃 ${pending.excess} 张。点击一张不想保留的卡。</p>${pending.cards.map((id,i)=>`<button class="discard-card" data-discard="${i}"><b>${sliceCardName(id)}</b> · ${sliceCardLine(state,p,id)}</button>`).join('')}`;
    el.querySelectorAll('[data-discard]').forEach(b=>b.onclick=()=>actions.discard(+b.dataset.discard));return;
  }
  if (pending.type === 'diceValue' || pending.type === 'steps') {
    const isSteps = pending.type === 'steps';
    const min = pending.min ?? (isSteps ? 0 : 1), max = pending.max ?? (isSteps ? 12 : 6);
    const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    if (!state.slice && isSteps) {
      renderSuperdice(el, state, p, actions, nums);
      return;
    }
    const title = state.slice?'定步':isSteps ? '超级骰子' : '遥控骰子';
    const desc = state.slice?'选 1–6 步，再按「出发」才会移动。下面列出可能落点，途中岔路仍由你选。':isSteps ? '选择本回合要走的步数；方向按正常规则处理。' : '选择本回合每颗骰子的点数；最终步数 = 点数 × 骰子数。';
    el.innerHTML = `<h3>${title}</h3><p class="hint">${desc}</p><div class="dice-choice${state.slice?' landing-options':''}">${nums.map(n => `<button data-dice-choice="${n}">${n}${state.slice?` 步<span>${[...new Set(reachableLandings(state,p,n).map(id=>landingText(state,p,id)))].join('；')}</span>`:''}</button>`).join('')}</div>`;
    el.querySelectorAll('[data-dice-choice]').forEach(b => b.onclick = () => actions.diceValue(+b.dataset.diceChoice));
    if(state.slice)el.querySelectorAll('[data-dice-choice]').forEach(b=>{b.onmouseenter=b.onfocus=()=>actions.preview(+b.dataset.diceChoice);b.onmouseleave=b.onblur=()=>actions.preview(null);});
    return;
  }
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
    const base = plot?.big ? (pending.bigType ? BIG_NAME[pending.bigType] : '大空地') : '小地产';
    const label = pending.level > 0 ? `${base} Lv.${pending.level}（无主已建）` : base;
    const poor = (p?.cash ?? 0) < pending.price;
    html = box(`购买 ${label}`, `<p>售价 ${pending.price.toLocaleString()}${poor ? ' · 现金不足' : ''}</p>
      ${state.slice?`<p class="hint">买下这间店就归你；${plot.big?'书屋每次收租额外产出一张卡。':'同街己方两间已建店铺会增加租金。'}这笔钱换到了什么、还差多少（若买不起），见下面三行。资金不够付租会破产。</p>`:''}
      ${state.slice&&plot?(()=>{/* #672：中局给“这一把值不值”的代价/收益，不只售价 */
        // 买下会改变同街与等级，所以先临时“模拟买下”再 rentFor，算完立刻恢复。
        // 这与 flow.js:647-651 给加盖算回本的做法同构（临时改状态→读 rentFor→恢复）。
        const pr = state.properties[plot.id] ?? {};
        const saved = { ownerId: pr.ownerId, level: pr.level };
        let rent = 0;
        try {
          state.properties[plot.id] = { ...pr, ownerId: p.id, level: pr.level ?? 0 };
          rent = rentFor(state, plot.id);
        } finally {
          if (saved.ownerId === undefined) delete state.properties[plot.id]
          else Object.assign(state.properties[plot.id], saved);
        }
        // rent 为 0 有两种：这条街停业封租，或买下也收不到钱。
        // 两种情况都必须说出来 —— “买下也拿不到租”正是玩家最该知道的事（
        // 实测 take/seed=11 第13天就碰到了，而旧写法直接 return ''，一个字不提）。
        // #3338：这一支也要带那三行账。收不到租的时候，「这笔钱变成了同价的地」和
        // 「买完还剩多少、够付几次」正是玩家最需要看到的两件事 —— 旧写法直接 return，
        // 结果这一屏只剩一句「收不到租」，等于把最贵的那个事实藏起来。
        const ledgerRows = buyLedgerLines(state, plot.id, p)
          .map(t => `<p class="hint" data-ledger>${t}</p>`).join('');
        if (!rent) {
          const why = state.properties[plot.id]?.closed > 0 ? '这条街现在停业，买下也收不到租' : '此刻买下收不到租';
          return `<p class="hint"><b>${why}</b>；不计回本回合数。</p>${ledgerRows}`;
        }
        // 账面回本：按“对手每回合会踩到一次”算，只是账，不是承诺（#574 已证 77% 未兑现）。
        // 旧的「账面约 N 回合回本」逐字保留（test/midgame-buy.test.js:52 钉着）。
        // #3338：后面不再接 poolShareLine。那一句说的是「这一笔占全场租金多少、几局收不回来」，
        // 它把这笔钱当**花掉的钱**；而买地是资产换手（真 buyPlot 前后 assetsOf 差 0）。
        // 结果是买地屏劝退、结算屏劝买，同一局里前后两句打脸。改成 market-ledger 的三行：
        // 记分（总资产不变）/ 现金压力（买完剩多少、够付对手最贵的一次租几次）/ 对手走位（72 局分布）。
        //
        // #3339：单位错了，而且是我的三行账把它照出来的。引擎按**停到这块地上**收租
        // （flow.js:659 的「实付租金」行只在 landingPhase 写），从来没有「每回合收租」这回事。
        // 「约 7 回合回本」= 价格 ÷ 每次满租，把「收几次」叫成了「几回合」；同一屏下面那张表
        // 说这间书屋整局平均实收 11,948（26,000 的约 46%）。两句都是真数，却是两本账 ——
        // 正是 #3358 让我修的那个病，只是这次两句话在同一屏上。
        // 改成说清单位：按此刻满租要**收几次**才够本，并明写租金只在对手停过来时收。
        const payouts = roundsToRecover(pending.price, rent);
        return `<p class="hint">此刻这条街 租 ${money(rent)}；账面：按这个价收到 ${payouts} 次才够本`
          + `（租金只在对手停到这块地上时收，不是每回合收；对手不走过来就不兑现）。</p>${ledgerRows}`;
      })():''}
      <button data-act="buy" ${poor ? 'disabled' : ''}>买下</button><button data-act="skip">放弃</button>`);
  } else if (pending.type === 'build') {
    const plot = state.map.plots.find(x => x.id === pending.cellId);
    const label = plot?.big ? '大空地' : '小地产';
    const poor = (p?.cash ?? 0) < pending.cost;
    html = box(`加盖 ${label}`, `<p>费用 ${pending.cost.toLocaleString()}${poor ? ' · 现金不足' : ''}</p>
      ${state.slice?`<p class="hint">升到 ${state.properties[plot.id].level+1} 级；小店基础租金翻倍，最高 3 级。书屋按等级计租。剩余现金 ${money(p.cash-pending.cost)}。</p>`:''}
      ${(() => { const fo = buildOrderLine(state, plot?.id, pending.cost, p); return fo ? `<p class="hint" data-fork>${fo}</p>` : ''; })()}
      ${(() => { const op = buildOpportunityLine(state, plot?.id, pending.cost, p); return op ? `<p class="hint" data-opportunity>${op}</p>` : ''; })()}
      ${(() => { const fk = buildForwardLine(state, plot?.id, pending.cost); return fk ? `<p class="hint" data-forward-k>${fk}</p>` : ''; })()}
      <button data-act="build" ${poor ? 'disabled' : ''}>加盖</button><button data-act="skip">放弃</button>`);
  } else if (pending.type === 'chooseBig') {
    html = box('选择大型建筑', `<div class="offers">${['commercial','hotel','bookstore','energy','realestate','research']
      .map(t => `<button class="offer" data-big="${t}"><b>${BIG_NAME[t]}</b><span>${t === 'commercial' ? '转盘租金' : t === 'hotel' ? '强制住店' : t === 'bookstore' ? '离店得卡' : t === 'energy' ? '对手买卡更贵' : t === 'realestate' ? '己方租金减免' : '研发进阶卡'}</span></button>`).join('')}</div>`);
  } else if (pending.type === 'direction') {
    const direction=id=>{const from=state.map.nodes.find(n=>n.id===p.position),to=state.map.nodes.find(n=>n.id===id);return to.x>from.x?'向右':to.x<from.x?'向左':to.y>from.y?'向下':'向上';};
    const routeLabel = id => {
      const preview = routePreview(state, p, p.position, id, pending.remainingSteps ?? 0);
      // 措辞只说「再往前可达」，不说「本回合还会走到」：最后一步时这只是后续布局。
      // #710：排序与 depth 都在 insight.js 里算好了（depth 升序 → 同 depth 内代价优先）。
      // 这里只负责按 depth 分组，控字数：每个 depth 组只加一次“N 步后”。
      // 可见上限 6 条（与之前的 4 条相比放宽，但每多的是“沿途”信息，不是重复）。
      const detail = preview.outlookDetail ?? preview.outlook.map((e, i) => ({ entry: e, depth: 0, tier: 0 }));
      // A3 字数上限：可见只 4 项（与 #697 一致）。
      // 报告实测 6 项时均字 255（上限 177），所以回 4。
      // 优先保留 tier>=3（代价/风险），再按原顺序补足 4 项。
      // 字数预算（实测，88 个 direction 帧）：
      //   全部 tier            → ahead 均 79 字/选项，代价+风险 100% 上屏
      //   只留 tier>=2         → 55 字，100%/100%
      //   只留 tier>=3         → 41 字，100%/100%   ← 采用
      // 只显示“代价”(对手未停业租) 与“风险”(医院/监狱)：
      //   玩家在岔口要回答的是“走哪边要付钱/会损失”，
      //   己方租(tier2)是收益但不由这一步决定，机会类不是代价。
      const MIN_TIER = 3;
      const essential = detail.filter(x => x.tier >= MIN_TIER);
      const byDepth = [];
      for (const it of essential) {
        const g = byDepth.find(x => x.depth === it.depth);
        if (g) g.items.push(it);
        else byDepth.push({ depth: it.depth, items: [it] });
      }
      // 根 #719 硬约束：
      //   · 单方向代价（tier 4）最多 4 条，超出用“还有 N 条”概括，并点出其中**代价最高**的那条
      //   · 禁堆叠：不得出现“等 N 项 …还有 M 组 等 K 项”
      //   · 字数上限 260
      const MAX_COST = 4;
      // 先按**最终渲染顺序**排代价（depth 升序 → tier 降序），再取前 MAX_COST。
      // 上一版直接用 detail 的原始顺序 slice，导致“显示的”与“被概括的”不是互补的两批，
      // 文案里的“还有 N 条”会算错（实测 take/5 第8天 3,5：7 条截 3 条却写“还有 2 条”）。
      const costItems = essential.filter(x => x.tier === 4)
        .slice().sort((a, b) => (a.depth - b.depth) || (b.tier - a.tier));
      const riskItems = essential.filter(x => x.tier === 3);
      let costShown = costItems;
      let costOverflow = null;
      if (costItems.length > MAX_COST) {
        costShown = costItems.slice(0, MAX_COST);
        const rest = costItems.slice(MAX_COST);
        const amt = e => { const m = /租\s*([\d,]+)/.exec(e.entry); return m ? Number(m[1].replace(/,/g, '')) : 0; };
        const biggest = rest.reduce((a, b) => (amt(b) > amt(a) ? b : a), rest[0]);
        // “其中最大 X”这条会被写进文案 ⇒ 它算作**可见**。
        // 上一版把 rest.length 全部当“没显示”，于是“还有 2 条”里含了那条已点名的，数字说谎。
        const stillHidden = rest.filter(x => x !== biggest);
        costShown = costShown.concat([biggest]);
        costOverflow = stillHidden.length > 0
          ? `还有 ${stillHidden.length} 条代价更低`
          : null;
      }
      const kept = [...costShown, ...riskItems].sort((a, b) => (a.depth - b.depth) || (b.tier - a.tier));
      const chosenGroups = [];
      for (const it of kept) {
        const g = chosenGroups.find(x => x.depth === it.depth);
        if (g) g.items.push(it); else chosenGroups.push({ depth: it.depth, items: [it] });
      }
      // depth 是相对 clone（第一落点）的步数；对玩家说“N 步后”时把第一落点算作第 1 步。
      const aheadText = chosenGroups.map(g => `${g.depth} 步后 ${g.items.map(x => x.entry).join('、')}`).join('；');
      const tail = costOverflow ? `（${costOverflow}）` : '';
      const ahead = aheadText
        ? `<em>再往前：${aheadText}${tail}</em>`
        : '';
      return `<span>${preview.text || '一路街道，没有店铺'}</span>${ahead}`;
    };
    // #719 D1：实测 345 个真实 direction 帧里有 15 帧，两个选项的落点说明**逐字相同**
    // （例 grow/seed=5 第1天 从 7,2 出发：向左与向下都写「街心书屋：第 4 天开售」）。
    // 两条路真实的差别只剩「下一回合从哪个格出发、能往哪走」，屏上没有这一条。
    // 只在真重文时补，不重文的帧文本逐字不变（判据 C2）。
    // routePreview 会枚举 5 层可达，很贵；而 tieHint 需要拿到**所有**选项的正文。
    // 上一版让 tieHint 对每个选项重算一遍全部正文 ⇒ O(N²) 次 routePreview，
    // 真浏览器里主线程被卡死、页面不响应（实测所有 CDP evaluate 超时）。
    // 这里只算一次、缓存起来。
    const bodyCache = new Map();
    const flatBody = x => {
      if (!bodyCache.has(x)) {
        bodyCache.set(x, String(routeLabel(x)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
      }
      return bodyCache.get(x);
    };
    const tiedIds = (() => {
      const count = new Map();
      for (const x of pending.options) {
        const k = flatBody(x);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
    })();
    const tieHint = id => {
      if (!tiedIds.has(flatBody(id))) return '';
      // 两层几何事实，都是现算、都可核：
      //   ① 下回合从这格能往哪走（长廊上的格子会一样，不够）
      //   ② 这格挨着哪条街（实测 take/11 第14天 靠它才分得开）
      const bits = [];
      const words = nextTurnWords(state, id);
      if (words) bits.push(`下回合能往 ${words}`);
      const streets = nextTurnStreetNames(state, id);
      if (streets) bits.push(`挨着 ${streets}`);
      return bits.length ? `<em>${bits.join(' · ')}</em>` : '';   // 都算不出就不编（C1）
    };
    html = box(pending.remainingSteps>0?`还剩 ${pending.remainingSteps} 步，往哪走？`:'下回合朝哪走？', `<p class="hint">直接点地图上高亮的路面${state.slice?'，或选下面的路线。':''}</p>${state.slice?pending.options.map((id, index)=>`<button class="route-choice" data-dir="${id}"><b>${direction(id)}${index===0 && pending.options.length===2 ? '<small class="route-inline-more">共 2 个方向 · 可逐项查看</small>' : ''}</b>${routeLabel(id)}${tieHint(id)}</button>`).join(''):''}`);
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
        <span class="shop-art">${cardSvg(item.id)}</span><span class="shop-price">${price}</span></button>`;
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
  el.querySelectorAll('button[data-dice-choice]').forEach(b => b.onclick = () => actions.diceValue(+b.dataset.diceChoice));
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
  // #719：几何读数只能在布局完成后取，所以放在这里而不是拼 html 时。
  if (pending.type === 'direction') mountOverflowHint(el);
  // #3232（预登记的行为变化）：build 屏是**静默裁切**——两个提交在预算底以下 152px、
  // 页面不可滚，而它从来没调过 mountOverflowHint（render.js:649/:897 只有 direction/supply）。
  // 只修「0→正能创建」修不到它：它在挂载那一刻就已越界，只是根本没人去算。
  // 复用同一套几何与同一个挂点（#hand），不新写判定、不动 styles.css。
  // 文案用「选项」而不是默认的「方向」：这屏里越界的是提交键，不是方向。
  else if (pending.type === 'build') {
    mountOverflowHint(el, '#choice button', sides => overflowHintTextSides(sides, '选项'));
  }
}

function renderLog(el, state) {
  el.innerHTML = state.log.slice(-120).map(l => `<li>D${l.day} ${l.text}</li>`).join('');
  el.scrollTop = el.scrollHeight;
}

function maxDice(p) { return Math.min(TUNING.maxDice, 1 + Math.max(0, p.vehicle ?? 0)); }

// Read the live counters, not the card duration: the day may have advanced since it was played.
function closedShopNotice(state, p) {
  const byStreet = new Map();
  for (const plot of state.map.plots) {
    const shop = state.properties[plot.id];
    if (shop?.ownerId !== p.id || !(shop.closed > 0) || !(shop.level > 0)) continue;
    const key = `${plot.street}:${shop.closed}`;
    const group = byStreet.get(key) ?? { street: plot.street, days: shop.closed, names: [] };
    group.names.push(plot.name);
    byStreet.set(key, group);
  }
  if (!byStreet.size) return '';
  const rows = [...byStreet.values()].map(({ street, days, names }) => {
    const single = names.length === 1;
    const shops = names.map(name => name.startsWith(street) ? name.slice(street.length) || name : name);
    return `<div><b>${single ? names[0] : street}停业 · 还剩 ${days} 天</b><span>你的${single ? '这间店' : shops.join('、')}暂不收租</span></div>`;
  });
  return `<div id="closed-shops" class="closed-shops">${rows.join('')}</div>`;
}

function renderHand(root, state, p, actions, opts = {}) {
  if (!p) { root.dice.innerHTML = ''; root.cards.innerHTML = ''; return; }
  // #3278：`state` 说「轮到你掷骰」并不等于**此刻的点击会被接住**。answer() 收下一个答案后
  // 会走 `settle` → `flushSpeech()`（一句气泡 1.2–1.8s）才让引擎前进，而这段窗口里没有任何
  // 东西重画这一屏：roll/手牌留着 enabled，点击却撞上 `if (!active) return;` 被静默丢掉。
  // 所以 canRoll 还要问一句「答案槽开着吗」（main.js 自己的回答能力，由它的唯一所有者在
  // rerender 时传入）。省略 opts（纯渲染测试、tools 里的渲染）保持旧行为。
  const canRoll = state.phase === 'action' && !state.pending && p.controller!=='ai' && opts.answerable !== false;
  root.dice.innerHTML = Array.from({ length: maxDice(p) }, (_, i) =>
    `<button data-roll="${i + 1}" ${canRoll ? '' : 'disabled'}>${i + 1} 骰</button>`).join('');
  root.dice.querySelectorAll('button[data-roll]').forEach(b => b.onclick = () => actions.roll(+b.dataset.roll));
  if(state.slice) {
    // #3468：动作屏上并排的第二条路。
    // 一句里必须同时有「做这笔得多少」「放弃的是什么」，否则它就只是一个更大的掷骰键。
    // 金额只从 operateOffer 来（引擎结算用同一个函数），所以按钮写多少、实收就是多少。
    const offer = operateOffer(state, p);
    // 一整行放不下第三块：这里**只能是单行**。
    // 实测（support/compare/operate-entry-smoke.mjs，1280×800）第一版用了嵌套的
    // `<span class="hint">`，骰子行被抬高 16px，第三张手牌底边 845.7 → 900，
    // 中心点不再命中自己 —— 与 #1398 同一类回归。所以代价写在同一行里，用 · 隔开。
    const operateBtn = offer
      ? `<button data-operate="1" class="operate-btn" ${canRoll && !offer.blocked ? '' : 'disabled'} title="${offer.blocked ? `${offer.street} 己方店面停业中，今天开门没有进项` : `留在 ${offer.street}，本回合不移动、不过起点、不落地`}">开门营业 +${money(offer.amount)} · 不走</button>`
      : '';
    const atDecision = state.phase === 'action' && p.controller === 'human';
    const fixed = atDecision ? p.diceValue : null;
    const closed = atDecision ? closedShopNotice(state, p) : '';
    const rollLabel = fixed == null ? '掷骰 · 1–6 步' : `出发 · 固定 ${fixed} 步`;
    root.dice.innerHTML=`${closed}<button data-roll="1" ${closed ? 'aria-describedby="closed-shops" ' : ''}${canRoll?'':'disabled'}>${rollLabel}</button>${operateBtn}<span class="hint">还能用 ${Math.max(0,2-(p.sliceCardsUsed??0))} 张卡</span>`;
    root.dice.querySelector('[data-roll]').onclick=event=>actions.roll(1,event);
    const opBtn = root.dice.querySelector('[data-operate]');
    if (opBtn) opBtn.onclick = () => actions.operate();
    // #1398：卡面写这一局此刻的数（sliceCardLine 内部只调 supplyWorth，不改 state）。
    root.cards.innerHTML=p.controller==='ai'?'<p class="hint">留意对手改造了哪条街，等轮到你时再作打算。</p>':p.cards.map((id,i)=>{const valid=!['worker','buyland'].includes(id)||sliceTargetIds(state,p,id).length;return `<button class="slice-card" data-card="${i}" ${canRoll&&(p.sliceCardsUsed??0)<2&&valid?'':'disabled'}><b>${sliceCardName(id)}</b><span>${sliceCardLine(state,p,id)}</span>${valid?'':'<em>现在没有合法目标</em>'}</button>`;}).join('');
    root.cards.querySelectorAll('[data-card]').forEach(b=>b.onclick=()=>actions.card(+b.dataset.card));return;
  }
  const n = p.cards.length;
  const step = n > 1 ? Math.min(120, (350 - 74) / (n - 1)) : 78;
  const overlap = step < 78;
  root.cards.innerHTML = p.cards.map((id, i) => {
    const def = CARD_DEFS[id];
    const tip = `${def?.name ?? id}：${CARD_DESC[id] ?? ''}`;
    const rot = overlap ? (i - (n - 1) / 2) * 1.6 : 0;
    const passive = PASSIVE.has(id);
    return `<button class="card${passive ? ' disabled' : ''}" data-card="${i}" ${passive ? 'disabled' : ''} style="--i:${i};z-index:${i};margin-left:${i ? Math.round(step - 74) : 0}px;transform:rotate(${rot}deg)" title="${passive ? '被动卡，在触发时询问是否使用' : tip}">
      <div class="art">${cardSvg(id)}</div>
    </button>`;
  }).join('');
  root.cards.querySelectorAll('button[data-card]').forEach(b => b.onclick = () => actions.card(+b.dataset.card));
}
