// 第一条体验切片：有限内容、公开规则、短局；不改变完整模式的数据。
export const SLICE_CARDS = {
  worker: { name: '翻修', desc: '免费让己方一栋已建房屋升 1 级，最高 3 级。先升级，再涨价，制造收租窗口。' },
  inflate: { name: '旺季', desc: '一整条街租金翻倍，持续 3 天。对手可以封租，或改走另一条路。' },
  close: { name: '停业', desc: '一整条街停租 2 天，旺季计时仍继续。先封租，再穿过危险街区。' },
  remotedice: { name: '定步', desc: '本回合走 1–6 步，由你选。选点数时会列出可能落点；岔路仍可选路。' },
  buyland: { name: '收购', desc: '花标价的 125% 收购任意非己方小店；原主人拿到全款。保留等级和状态，书屋必须亲自到场购买。' },
};
export const SUPPLIES = [
  { id: 'grow', name: '把生意做大', cards: ['worker', 'inflate'], desc: '翻修 + 旺季：升级自己的店，抓住几天收租窗口。' },
  { id: 'take', name: '找机会接盘', cards: ['buyland', 'remotedice'], desc: '收购 + 定步：买下关键位置，再选择落点。收购要留足现金。' },
  { id: 'cross', name: '穿过危险街', cards: ['close', 'remotedice'], desc: '停业 + 定步：压住一条街的租金，安全穿行或抢落点。' },
];
// 三种起手的第一屏承诺是「三条不同的打算」，不是「一个强、两个陷阱」。
//
// 数字（`node tools/balance-slice.mjs`，真实入口、同一套 AI、每格 300 局、
// 对手座位两种排列真的换开）：
//   改前 grow 52.3% / take 9.7% / cross 10.3%（最大差距 42.7 个百分点）
//   改后 grow 45.7% / take 32.0% / cross 34.7%（最大差距 13.7 个百分点）
// held-out（seed 1001–1150，与调参用的 1–150 不相交）：49.0 / 34.3 / 35.7，差距 14.7。
//
// **这证明的是「差距收窄」，不是「三条一样强」。** #3330 曾把 42.0 / 39.0 / 42.7 报成
// 「彼此一个标准误内」——那三个数是**固定对手顺序**下的读数，量法描述本身没被核对过；
// 把座位真的换开之后差距是 13.7 个百分点，不是零。#3331 更正了这句话，没有改这三个现金：
// 再加钱只会把 grow 变弱（候选 42/48/49 让 grow 掉到 41.3），不是让三条都强。
// 过程与复跑见 docs/evidence/RESULT-3331.md。
//
// 弱的是「开局能做的事太少」，不是「卡面文字不对」。补偿放在起始现金上：
// 它是开局就写在屏上的一个数，不是隐藏天赋，也不是给某个起手开的后门。
// 起手卡保持原样，`take` 仍是收购线、`cross` 仍是封租线。
export const SLICE_STYLES = [
  { id: 'grow', name: '街角店主', charId: 'sunxiaomei', hook: '把小店经营成别人绕不开的招牌。', hand: ['worker', 'inflate', 'remotedice'], cash: 42000 },
  { id: 'take', name: '机会买家', charId: 'atubo', hook: '看准别人养好的店，带着现金入场。', hand: ['buyland', 'remotedice', 'close'], cash: 45000 },
  { id: 'cross', name: '穿街高手', charId: 'tangtang', hook: '封住危险街，再把自己送到好位置。', hand: ['close', 'remotedice', 'worker'], cash: 46000 },
];

function makeMap() {
  const cell = 52, roads = new Set(), key = (x, y) => `${x},${y}`;
  const add = (x, y) => roads.add(key(x, y));
  for (let x = 2; x <= 10; x++) { add(x, 2); add(x, 8); add(x, 5); }
  for (let y = 2; y <= 8; y++) { add(2, y); add(10, y); }
  // 中央小环与上下两条路线相接；医院、监狱只保留兼容侧路。
  for (let y = 2; y <= 5; y++) { add(4, y); add(7, y); }
  add(0, 5); add(1, 5); add(11, 5); add(12, 5);
  const plots = [];
  for (const [street, spots] of [
    ['晨光街', [[3, 1], [4, 1]]], ['晚风街', [[8, 1], [9, 1]]],
    ['灯火街', [[3, 9], [4, 9]]], ['月色街', [[8, 9], [9, 9]]],
    ['西巷', [[1, 3], [1, 4]]], ['东巷', [[11, 6], [11, 7]]],
  ]) spots.forEach(([x, y], i) => plots.push({ id: key(x, y), cells: [{ x, y }], street, big: false, name: `${street}${i ? '茶铺' : '小店'}`, price: 8000 }));
  plots.push({ id: 'market', cells: [{x:5,y:3},{x:6,y:3},{x:5,y:4},{x:6,y:4}], big:true, street:'书屋', name:'街心书屋', price:26000, availableFromDay:4 });
  const ground = { '2,2':['start','发薪处'], '10,2':['money','零工'], '2,8':['money','零工'], '10,8':['money','零工'], '0,5':['hospital','医院'], '12,5':['jail','监狱'] };
  const nodes = [...roads].map(id => {
    const [x,y] = id.split(',').map(Number), [kind,label] = ground[id] ?? ['empty','街道'];
    return { id, x:x*cell, y:y*cell, kind, label, adjacentPlots: plots.filter(p => p.cells.some(c => Math.abs(c.x-x)+Math.abs(c.y-y)===1)).map(p=>p.id) };
  });
  const edges = [];
  for (const id of roads) { const [x,y]=id.split(',').map(Number); for (const [dx,dy] of [[1,0],[0,1]]) { const b=key(x+dx,y+dy); if(roads.has(b)) edges.push({a:id,b,kind:'road'}); } }
  return { id:'street-party', name:'街角生意', w:13, h:11, cell, startId:'2,2', nodes, edges, plots,
    facility:{hospital:'1,5',jail:'11,5'}, intro:'16 天营业。每人两间小店；书屋第 4 天开售，每 3 天选一组补给。最多连用两张卡，再掷骰。总资产最高者赢。',
    initialProperties:plots.map(p=>({plotId:p.id,level:p.big?2:1,bigType:p.big?'bookstore':null,price:p.price})) };
}
export const SLICE_MAP = makeMap();

export function createSliceConfig({ seed = 1, style = 'grow', human = true, ...overrides } = {}) {
  const chosen = SLICE_STYLES.find(s=>s.id===style) ?? SLICE_STYLES[0];
  const styles = [chosen, ...SLICE_STYLES.filter(s=>s.id!==chosen.id)];
  return { mode:'slice', seed, mapId:SLICE_MAP.id, dayLimit:16, startingCash:42000, startingDeposit:0,
    startingCards:0, handLimit:7, maxLevel:3, priceIndexStep:0, interestEveryDays:1000, moneyCap:3000,
    participants:styles.map((s,i)=>({name:s.name,charId:s.charId,style:s.id,team:`t${i+1}`,controller:i===0&&human?'human':'ai'})), ...overrides };
}

export function initializeSlice(state) {
  const starts = [['3,2','4,2',['3,1','4,1']], ['8,2','7,2',['8,1','9,1']], ['3,5','4,5',['3,9','4,9']]];
  state.players.forEach((p,i)=> {
    const style = SLICE_STYLES.find(s=>s.id===state.config.participants?.[i]?.style) ?? SLICE_STYLES[i%3];
    p.style=style.id; p.talents=[]; p.cards=[...style.hand];
    // 起手自带的开工现金：只覆盖这个起手自己的开局，和别的起手无关。
    if (style.cash != null) p.cash = style.cash;
    const [position,facing,ids]=starts[i%starts.length]; p.position=position;p.facing=facing;p.lastNode=null;
    for(const id of ids) {state.properties[id].ownerId=p.id;p.properties.push(id);}
    p.sliceStats={rentPaid:0,rentEarned:0,cardsPlayed:0,takeovers:0};
  });
  state.slice={history:[],turnStart:null};
}
