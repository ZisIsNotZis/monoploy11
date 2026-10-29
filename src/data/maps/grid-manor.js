// 网格棋盘：路面和地产都是同一张棋盘上的方形单元。
// 路面 1x1，可走；地产 1x1 或 2x2，不可走，但与相邻路面的边接触时触发。
const W = 19, H = 13, S = 48;

const roads = new Set();
const add = (x, y) => roads.add(`${x},${y}`);
for (let x = 2; x <= 16; x++) { add(x, 2); add(x, 10); add(x, 6); }
for (let y = 2; y <= 10; y++) { add(2, y); add(16, y); add(9, y); }
// 医院/监狱侧路，死路末端是设施，允许。
add(1, 6); add(17, 6);
// 死路末端必须是随机传送门。
add(9, 0); add(9, 1);

const ground = {
  '3,2': ['bank', '银行'], '4,2': ['shop', '商店'], '5,2': ['news', '新闻'],
  '6,2': ['card', '卡片'], '7,2': ['magic', '魔法屋'], '8,2': ['lottery', '乐透'],
  '10,2': ['stock', '股票'], '11,2': ['tax', '纳税'], '12,2': ['event', '事件'],
  '13,2': ['card', '卡片'], '14,2': ['empty', '路'],
  '2,4': ['shop', '商店'], '2,5': ['stock', '股票'], '2,7': ['bank', '银行'],
  '16,4': ['lottery', '乐透'], '16,5': ['news', '新闻'], '16,8': ['card', '卡片'],
  '4,6': ['card', '卡片'], '5,6': ['news', '新闻'], '13,6': ['magic', '魔法屋'], '14,6': ['shop', '商店'],
  '9,0': ['teleport', '传送门'], '1,6': ['hospital', '医院'], '17,6': ['jail', '监狱'],
};

const plotCells = new Map(); // "x,y" -> plotId
const plots = [];
let small = 0, big = 0;
function addSmall(x, y, street) {
  const id = `plot_s${++small}`;
  plots.push({ id, cells: [{ x, y }], big: false, street, label: `${street}${small}` });
  plotCells.set(`${x},${y}`, id);
}
function addBig(x, y, label) {
  const id = `plot_b${++big}`;
  plots.push({ id, cells: [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }], big: true, street: null, label });
  for (const c of plots.at(-1).cells) plotCells.set(`${c.x},${c.y}`, id);
}

// 四个象限的临路边：小地产 1x1，大地产 2x2。
for (let x = 3; x <= 8; x++) addSmall(x, 3, 'A');
for (let x = 5; x <= 8; x++) addSmall(x, 5, 'A');
addBig(3, 4, '商业中心');
addBig(10, 3, '大饭店');
for (let x = 12; x <= 15; x++) addSmall(x, 3, 'B');
for (let x = 10; x <= 15; x++) addSmall(x, 5, 'B');
addBig(14, 4, '书店');
for (let x = 3; x <= 4; x++) addSmall(x, 7, 'C');
for (let x = 6; x <= 8; x++) addSmall(x, 7, 'C');
for (let x = 3; x <= 8; x++) addSmall(x, 9, 'C');
addBig(5, 8, '能源中心');
for (let x = 10; x <= 15; x++) addSmall(x, 7, 'D');
for (let x = 10; x <= 13; x++) addSmall(x, 9, 'D');
addBig(14, 8, '地产公司');
addBig(10, 9, '研究所');

// 节点：所有路面单元
const nodes = [];
for (const key of roads) {
  const [x, y] = key.split(',').map(Number);
  const [kind, label] = ground[key] ?? ['empty', '路'];
  nodes.push({ id: key, x: x * S, y: y * S, kind, label, ring: undefined });
}
const nodeBy = Object.fromEntries(nodes.map(n => [n.id, n]));

// 正交相邻的路面边
const edges = [];
for (const n of nodes) {
  const [x, y] = n.id.split(',').map(Number);
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const id = `${x + dx},${y + dy}`;
    if (nodeBy[id]) edges.push({ a: n.id, b: id, kind: 'road' });
  }
}

// 每个路面格相邻的地产（只算边接触，不算角）
for (const n of nodes) {
  const [x, y] = n.id.split(',').map(Number);
  const ids = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const id = plotCells.get(`${x + dx},${y + dy}`);
    if (id && !ids.includes(id)) ids.push(id);
  }
  n.adjacentPlots = ids;
}

export const GRID_MANOR = {
  id: 'grid-manor', name: '网格庄园（三层）', mode: 'traditional',
  w: W, h: H, cell: S, startId: '2,2',
  nodes, edges, plots,
  platform: null,
  facility: { hospital: '1,6', jail: '17,6' },
};
