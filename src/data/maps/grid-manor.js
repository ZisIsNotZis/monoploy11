// 25x17 网格：路面 1x1 可走；地产 1x1 或 2x2，放在路边。
// 地产按“簇”布置，每簇最多 5 块，簇间留空断开。
const W = 25, H = 17, S = 44;
const roads = new Set();
const add = (x, y) => roads.add(`${x},${y}`);
for (let x = 2; x <= 22; x++) { add(x, 2); add(x, 14); add(x, 8); }
for (let y = 2; y <= 14; y++) { add(2, y); add(22, y); add(12, y); }
add(1, 8); add(23, 8); // 医院/监狱直线侧路
add(12, 0); add(12, 1); // 死路末端传送门

const ground = {
  '3,2': ['bank', '银行'], '4,2': ['shop', '商店'], '5,2': ['news', '新闻'],
  '6,2': ['card', '卡片'], '7,2': ['magic', '魔法屋'], '8,2': ['lottery', '乐透'],
  '10,2': ['empty', '路'], '11,2': ['tax', '纳税'], '13,2': ['event', '事件'],
  '14,2': ['card', '卡片'], '15,2': ['empty', '路'],
  '2,4': ['shop', '商店'], '2,5': ['empty', '路'], '2,11': ['bank', '银行'],
  '22,4': ['lottery', '乐透'], '22,5': ['news', '新闻'], '22,11': ['card', '卡片'],
  '4,8': ['card', '卡片'], '5,8': ['news', '新闻'], '18,8': ['magic', '魔法屋'], '19,8': ['shop', '商店'],
  '12,0': ['teleport', '传送门'], '1,8': ['hospital', '医院'], '23,8': ['jail', '监狱'],
};

const plotCells = new Map();
const plots = [];
let small = 0, big = 0;
function smallPlot(x, y, street) {
  const id = `plot_s${++small}`;
  plots.push({ id, cells: [{ x, y }], big: false, street, label: `${street}${small}` });
  plotCells.set(`${x},${y}`, id);
}
function bigPlot(x, y, street, label) {
  const id = `plot_b${++big}`;
  const cells = [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }];
  plots.push({ id, cells, big: true, street, label });
  for (const c of cells) plotCells.set(`${c.x},${c.y}`, id);
}
function cluster(street, bigAt, smalls) {
  if (bigAt) bigPlot(bigAt[0], bigAt[1], street, {
    A: '商业中心', B: '大饭店', C: '书店', D: '能源中心',
    E: '地产公司', F: '研究所', G: '公园', H: '仓库',
  }[street] ?? '大空地');
  for (const [x, y] of smalls) smallPlot(x, y, street);
}
// 8 簇，每簇 3–5 块；簇间至少隔一格空。
// 每簇都贴着一条路；小地块都直接临路，大地产整块临路。
cluster('A', [3, 3], [[5, 3], [6, 3], [7, 3]]);
cluster('B', [13, 3], [[15, 3], [16, 3], [17, 3]]);
cluster('C', [3, 9], [[5, 9], [6, 9], [7, 9]]);
cluster('D', [13, 9], [[15, 9], [16, 9], [17, 9]]);
cluster('E', null, [[21, 3], [21, 4], [21, 5], [21, 6]]);
cluster('F', null, [[21, 9], [21, 10], [21, 11], [21, 12]]);
cluster('G', null, [[5, 13], [6, 13], [7, 13], [8, 13]]);
cluster('H', null, [[15, 13], [16, 13], [17, 13], [18, 13]]);
// 外圈路的外侧也可以有地产；都贴着外圈路，簇间留空。
cluster('I', null, [[3, 1], [4, 1], [5, 1], [6, 1]]);
cluster('J', null, [[1, 3], [1, 4], [1, 5], [1, 6]]);
cluster('K', null, [[3, 15], [4, 15], [5, 15], [6, 15]]);
cluster('L', null, [[23, 3], [23, 4], [23, 5], [23, 6]]);
cluster('M', null, [[23, 10], [23, 11], [23, 12], [23, 13]]);
cluster('N', null, [[1, 10], [1, 11], [1, 12], [1, 13]]);
cluster('O', null, [[14, 1], [15, 1], [16, 1], [17, 1]]);
cluster('P', null, [[14, 15], [15, 15], [16, 15], [17, 15]]);

const nodes = [];
for (const key of roads) {
  const [x, y] = key.split(',').map(Number);
  const [kind, label] = ground[key] ?? ['empty', '路'];
  nodes.push({ id: key, x: x * S, y: y * S, kind, label });
}
const nodeBy = Object.fromEntries(nodes.map(n => [n.id, n]));
const edges = [];
for (const n of nodes) {
  const [x, y] = n.id.split(',').map(Number);
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const id = `${x + dx},${y + dy}`;
    if (nodeBy[id]) edges.push({ a: n.id, b: id, kind: 'road' });
  }
}
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
  facility: { hospital: '1,8', jail: '23,8' },
};
