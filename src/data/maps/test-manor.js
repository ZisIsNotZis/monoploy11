// M1 的“全系统测试图”：一个 48 格主环 + 监狱/医院侧路 + 死路传送门 + 活动机关板捷径。
// 拓扑是自设计的（原版骑士庄园只确证是单环），目的是一次性覆盖所有格子类型。
// M2 再补 16 张原版/同构图。

const props = (street, n) =>
  Array.from({ length: n }, (_, i) => ({ k: 'property', street, label: `${street}${i + 1}` }));

const PLAN = [
  { k: 'start', label: '起点' },
  ...props('A', 6),
  { k: 'bank', label: '银行' },
  { k: 'shop', label: '商店' },
  { k: 'news', label: '新闻' },
  { k: 'big', big: 'commercial', label: '商业中心' },
  { k: 'big', big: 'hotel', label: '大饭店' },

  ...props('B', 6),
  { k: 'stock', label: '股票' },
  { k: 'lottery', label: '乐透' },
  { k: 'magic', label: '魔法屋' },
  { k: 'card', label: '卡片' },
  { k: 'big', big: 'bookstore', label: '书店' },
  { k: 'big', big: 'energy', label: '能源中心' },

  ...props('C', 6),
  { k: 'hospitalGate', label: '医院口' },
  { k: 'jailGate', label: '监狱口' },
  { k: 'big', big: 'realestate', label: '地产公司' },
  { k: 'big', big: 'research', label: '研究所' },
  { k: 'event', label: '事件' },
  { k: 'tax', label: '纳税' },

  ...props('D', 6),
  { k: 'god', label: '神仙' },
  { k: 'dog', label: '野狗' },
  { k: 'beggar', label: '乞丐' },
  { k: 'merchant', label: '神秘人' },
  { k: 'big', big: 'park', label: '公园' },
  { k: 'card', label: '卡片' },
];

const RING = 48;
const SIDE_NODES = [
  { id: 'hospital', kind: 'hospital', label: '医院', x: 410, y: 710 },
  { id: 'jail', kind: 'jail', label: '监狱', x: 340, y: 710 },
  { id: 't1', kind: 'empty', label: '岔路', x: 165, y: 340 },
  { id: 't2', kind: 'teleport', label: '传送门', x: 270, y: 340 },
  { id: 'p1', kind: 'platform', label: '机关板', x: 235, y: 255 },
];

function ringCoord(i) {
  const side = Math.floor(i / 12);
  const pos = i % 12;
  if (side === 0) return { x: 60 + pos * 70, y: 60 };
  if (side === 1) return { x: 830, y: 60 + pos * 70 };
  if (side === 2) return { x: 830 - pos * 70, y: 830 };
  return { x: 60, y: 830 - pos * 70 };
}

const nodes = [];
for (let i = 0; i < RING; i++) {
  const p = PLAN[i];
  const c = ringCoord(i);
  nodes.push({ id: `r${i}`, kind: p.k, street: p.street, bigType: p.big, label: p.label, x: c.x, y: c.y, ring: i });
}
nodes.push(...SIDE_NODES);
const NODE = Object.fromEntries(nodes.map(n => [n.id, n]));

const edges = [];
const addEdge = (a, b, kind = 'road') => {
  edges.push({ a, b, kind });
};

for (let i = 0; i < RING; i++) addEdge(`r${i}`, `r${(i + 1) % RING}`);
addEdge('r30', 'hospital', 'side');
addEdge('r31', 'jail', 'side');
addEdge('r43', 't1', 'side');
addEdge('t1', 't2', 'side');
addEdge('r5', 'p1', 'platform');
addEdge('p1', 'r41', 'platform');

export const TEST_MANOR = {
  id: 'test-manor',
  name: '测试庄园（全系统）',
  mode: 'traditional',
  ringSize: RING,
  startId: 'r0',
  nodes,
  edges,
  platform: { nodeId: 'p1', everyDays: 4, onPhase: [0, 1] },
  facility: { hospital: 'r30', jail: 'r31' },
};
