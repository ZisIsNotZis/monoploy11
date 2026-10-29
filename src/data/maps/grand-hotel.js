// 大酒店：27×19 产品图。中心 3×3 大酒店被内环路完整包围，12 个路面格相邻。
const W = 27, H = 19, S = 44;
const key = (x, y) => `${x},${y}`;
const roads = new Set();
const add = (x, y) => roads.add(key(x, y));
const row = (x0, x1, y) => { for (let x = x0; x <= x1; x++) add(x, y); };
const col = (x, y0, y1) => { for (let y = y0; y <= y1; y++) add(x, y); };

// 外圈
row(2, 24, 2); row(2, 24, 16);
col(2, 2, 16); col(24, 2, 16);
// 中央内环
row(11, 15, 7); row(11, 15, 11);
col(11, 7, 11); col(15, 7, 11);
// 四条放射路，停在中心建筑外
col(13, 2, 7); col(13, 11, 16);
row(2, 11, 9); row(15, 24, 9);
// 四象限小环路
col(6, 2, 16); col(20, 2, 16);
row(2, 6, 5); row(20, 24, 5);
row(2, 6, 13); row(20, 24, 13);
// 医院/监狱侧路、上下传送门死路
add(1, 9); add(25, 9);
add(13, 1); add(13, 17);

const ground = {
  '2,2': ['start', '起点'],
  '4,2': ['bank', '银行'], '7,2': ['shop', '商店'], '10,2': ['money', '金钱格'],
  '16,2': ['news', '新闻'], '19,2': ['lottery', '乐透'], '22,2': ['card', '卡片'],
  '4,16': ['shop', '商店'], '7,16': ['magic', '魔法屋'], '10,16': ['card', '卡片'],
  '16,16': ['tax', '纳税'], '19,16': ['bank', '银行'], '22,16': ['lottery', '乐透'],
  '2,4': ['money', '金钱格'], '2,7': ['bank', '银行'], '2,12': ['shop', '商店'], '2,14': ['news', '新闻'],
  '24,4': ['lottery', '乐透'], '24,7': ['card', '卡片'], '24,12': ['magic', '魔法屋'], '24,14': ['shop', '商店'],
  '11,7': ['news', '新闻'], '15,7': ['shop', '商店'], '11,11': ['magic', '魔法屋'], '15,11': ['card', '卡片'],
  '13,4': ['bank', '银行'], '13,14': ['shop', '商店'],
  '6,9': ['event', '事件'], '20,9': ['money', '金钱格'],
  '6,5': ['tax', '纳税'], '20,5': ['news', '新闻'], '6,13': ['card', '卡片'], '20,13': ['magic', '魔法屋'],
  '1,9': ['hospital', '医院'], '25,9': ['jail', '监狱'],
  '13,1': ['teleport', '传送门'], '13,17': ['teleport', '传送门'],
};

const plotCells = new Map();
const plots = [];
let small = 0, big = 0;
function smallPlot(x, y, street, price = null) {
  const id = `plot_s${++small}`;
  const plot = { id, cells: [{ x, y }], big: false, street };
  if (price) plot.price = price;
  plots.push(plot);
  plotCells.set(key(x, y), id);
}
function bigPlot(x, y, w, h, street, price = null, name = null) {
  const id = `plot_b${++big}`;
  const cells = [];
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) cells.push({ x: xx, y: yy });
  const plot = { id, cells, big: true, street, name };
  if (price) plot.price = price;
  plots.push(plot);
  for (const c of cells) plotCells.set(key(c.x, c.y), id);
}

// 外圈小地产：每侧四簇，每簇三块。
for (const [street, y, xs] of [
  ['A', 1, [3, 4, 5]], ['B', 1, [8, 9, 10]], ['C', 1, [15, 16, 17]], ['D', 1, [20, 21, 22]],
  ['E', 17, [3, 4, 5]], ['F', 17, [8, 9, 10]], ['G', 17, [15, 16, 17]], ['H', 17, [20, 21, 22]],
]) for (const x of xs) smallPlot(x, y, street);
for (const [street, x, ys] of [
  ['I', 1, [3, 4, 5]], ['J', 1, [12, 13, 14]], ['K', 25, [3, 4, 5]], ['L', 25, [12, 13, 14]],
]) for (const y of ys) smallPlot(x, y, street);

// 内圈小地产：全部直接贴内环路。
for (const y of [7, 8, 9, 10]) smallPlot(10, y, 'M');
for (const y of [7, 8, 9, 10]) smallPlot(16, y, 'N');
smallPlot(12, 6, 'O'); smallPlot(14, 6, 'O');
smallPlot(12, 12, 'P'); smallPlot(14, 12, 'P');

// 四角大地产：左上、右上各被三条路包住，共 6 个邻接路面。
bigPlot(3, 3, 2, 2, 'A', 45_000, '西北商会');
bigPlot(22, 3, 2, 2, 'D', 45_000, '东北饭店');
bigPlot(3, 14, 2, 2, 'E', 35_000, '西南仓库');
bigPlot(22, 14, 2, 2, 'H', 35_000, '东南市场');
// 中心大酒店：3×3，四周 12 个路面格。
bigPlot(12, 8, 3, 3, 'CENTER', 90_000, '中央大酒店');
// 两个内圈大地产，构成第二条投资线。
bigPlot(7, 10, 2, 2, 'M', 30_000, '西侧公寓');
bigPlot(18, 10, 2, 2, 'N', 30_000, '东侧公寓');

const nodes = [];
for (const id of roads) {
  const [x, y] = id.split(',').map(Number);
  const [kind, label] = ground[id] ?? ['empty', '路'];
  nodes.push({ id, x: x * S, y: y * S, kind, label });
}
const nodeBy = Object.fromEntries(nodes.map(n => [n.id, n]));
const edges = [];
for (const n of nodes) {
  const [x, y] = n.id.split(',').map(Number);
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const id = key(x + dx, y + dy);
    if (nodeBy[id]) edges.push({ a: n.id, b: id, kind: 'road' });
  }
}
for (const n of nodes) {
  const [x, y] = n.id.split(',').map(Number);
  const ids = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const id = plotCells.get(key(x + dx, y + dy));
    if (id && !ids.includes(id)) ids.push(id);
  }
  n.adjacentPlots = ids;
  n.centerFront = ids.includes('plot_b5');
}

const initialProperties = [
  { plotId: 'plot_b5', level: 3, bigType: 'hotel', price: 90_000 },
  { plotId: 'plot_b1', level: 2, bigType: 'commercial', price: 45_000 },
  { plotId: 'plot_b2', level: 2, bigType: 'hotel', price: 45_000 },
  // 外圈无主联排，开局就能看到建筑。
  { plotId: plots.find(p => !p.big && p.cells[0].x === 4 && p.cells[0].y === 1).id, level: 1, price: 12_000 },
  { plotId: plots.find(p => !p.big && p.cells[0].x === 9 && p.cells[0].y === 1).id, level: 1, price: 12_000 },
  { plotId: plots.find(p => !p.big && p.cells[0].x === 16 && p.cells[0].y === 1).id, level: 2, price: 18_000 },
  { plotId: plots.find(p => !p.big && p.cells[0].x === 21 && p.cells[0].y === 1).id, level: 1, price: 12_000 },
  { plotId: plots.find(p => !p.big && p.cells[0].x === 1 && p.cells[0].y === 4).id, level: 1, price: 10_000 },
  { plotId: plots.find(p => !p.big && p.cells[0].x === 25 && p.cells[0].y === 4).id, level: 2, price: 18_000 },
  { plotId: plots.find(p => !p.big && p.cells[0].x === 4 && p.cells[0].y === 17).id, level: 1, price: 10_000 },
  { plotId: plots.find(p => !p.big && p.cells[0].x === 21 && p.cells[0].y === 17).id, level: 1, price: 10_000 },
  { plotId: plots.find(p => !p.big && p.cells[0].x === 10 && p.cells[0].y === 8).id, level: 1, price: 14_000 },
  { plotId: plots.find(p => !p.big && p.cells[0].x === 16 && p.cells[0].y === 8).id, level: 1, price: 14_000 },
];

export const GRAND_HOTEL = {
  id: 'grand-hotel', name: '大酒店', mode: 'traditional',
  w: W, h: H, cell: S, startId: '2,2',
  nodes, edges, plots, initialProperties,
  platform: null,
  intro: '中央大酒店 Lv.3，无主，12 个路面入口，标价 90,000；四角各有 6 个入口的 2×2 大地产。',
  facility: { hospital: '1,9', jail: '25,9' },
};
