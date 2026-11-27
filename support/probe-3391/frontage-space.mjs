// #3391k：这张地图上**还存在第二块 8 临街格的地吗**？
//
// 为什么要问：two-plans-forced.mjs 量到，给第二种打法一块 4 临街格、第 9 天、13,000 的高地，
// 它仍然比「照常打」差 20.6pp。而 rent-attribute.mjs（随机指派）说书屋 28.3pp 的价值里
// 20.6pp 来自租金。两条合起来指向一个很窄的结论：**收租机会（= 临街格数）不够，就赢不了**。
//
// 那么「造第二块同等级高地」这个方向能不能成立？这张图 13×11，路面是
//   y=2,5,8 的 x=2..10；x=2,10 的 y=2..8；x=4,7 的 y=2..5。
// 把每个**空闲格**的临街数算出来，再找 4 格连成 2×2 时的临街总数 —— 那是第二块书屋的候选。
// 若不存在第二个 8 格位置，那「两块等价高地」在这张图上就不可能，必须动地图或动几何，
// 这是用户级取舍，不该由我擅自改。
//
// 用法：node support/probe-3391/frontage-space.mjs
import { SLICE_MAP } from '../../src/data/slice.js';

const W = SLICE_MAP.w, H = SLICE_MAP.h;
const road = new Set(SLICE_MAP.nodes.map(n => n.id));
const occupied = new Set();
for (const p of SLICE_MAP.plots) for (const c of p.cells) occupied.add(`${c.x},${c.y}`);

const frontage = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
  .filter(([dx, dy]) => road.has(`${x + dx},${y + dy}`)).length;

console.log('空地上每个格的临街数（只印 >0 的）');
const free = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const key = `${x},${y}`;
  if (road.has(key) || occupied.has(key)) continue;
  const f = frontage(x, y);
  if (f > 0) free.push({ x, y, f });
}
console.log(free.map(c => `(${c.x},${c.y})${c.f}`).join('  '));

// 2×2 候选：临街数按「格的外侧边」数，与 makeMap 的口径一致（只数贴路的边）
const block = (x, y) => {
  const cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
  if (cells.some(([a, b]) => road.has(`${a},${b}`) || occupied.has(`${a},${b}`))) return null;
  let n = 0;
  for (const [a, b] of cells) n += frontage(a, b);
  // 内部相邻的边不算临街：两两之间若有格相接，会被上面的 frontage 漏算（内部格不相邻路，本来就不计）
  return { x, y, frontage: n, cells };
};
const blocks = [];
for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
  const b = block(x, y);
  if (b && b.frontage > 0) blocks.push(b);
}
blocks.sort((a, b) => b.frontage - a.frontage);
console.log('\n2×2 空块，按临街数排序（前三名）');
for (const b of blocks.slice(0, 3)) {
  console.log(`  (${b.x},${b.y}) 临街 ${b.frontage}`);
}
const centerFront = SLICE_MAP.nodes.filter(n => n.adjacentPlots?.includes('market')).length;
console.log(`\n街心书屋现有临街 ${centerFront} 格`);
const second = blocks.find(b => b.frontage >= centerFront);
console.log(second
  ? `⇒ 存在第二个 ${second.frontage} 格位置 (${second.x},${second.y}) —— 「两块等价高地」可行`
  : `⇒ **不存在**第二个 ≥${centerFront} 格的位置：这张图上书屋是唯一的。`
    + `\n   「第二块等价高地」必须改地图/几何，属用户级取舍。`);

// 2×1 候选（拆分方案用）：临街数上限是多少
const pairs = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) {
  const cells = [[x, y], [x + 1, y]];
  if (cells.some(([a, b]) => road.has(`${a},${b}`) || occupied.has(`${a},${b}`))) continue;
  const f = cells.reduce((s, [a, b]) => s + frontage(a, b), 0);
  pairs.push({ x, y, f });
}
pairs.sort((a, b) => b.f - a.f);
console.log(`\n2×1 空块的最高临街数：${pairs[0]?.f} 在 (${pairs[0]?.x},${pairs[0]?.y})`
  + ` ⇒ 拆成两半时每半最多 ${pairs[0]?.f} 格`);
