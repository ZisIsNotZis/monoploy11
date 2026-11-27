// 可亲手试的第二块高地：#3391l。
//
// **这是对照页，不是产品改动。** 只在本页（support/compare/twin-center.html）生效，
// src/ 一个字节都不动，正式入口照旧只有一块街心书屋。
//
// 为什么先做成能亲手玩的对照，而不是直接改规则：
//   · 图上确实还有第二个 8 临街格的位置（(8,3)-(9,4)，见 probe-3391/frontage-space.mjs）；
//   · 放上第二块**等价**高地后（twin-centers.mjs，120 局/格，基线三格 ✅）：
//       grow 49.2 → 45.8 / take 38.3 → 44.2 / cross 45.0 → 50.0
//       占 0 块 4.9–29.5%（原来约 46% 的局一块都占不到）、占 1 块 68–90%
//       三起手差距 10.8pp → 4.2pp
//     ⇒ 「谁都拿不到」的局大幅减少；第 4 天从「能不能抢到唯一那块」变成「抢哪一块」。
//   · 但代价是真的：破产率 3–9% → 12–14%，cross/take 变强、grow 变弱。
//     谁该强是**产品决策**，不该由我替用户定。
// 所以：让人亲手玩一局再决定。
//
// 实现关键（踩过两次坑，别再踩）：
//   ① createGame 用 structuredClone 复制地图（game.js:29），所以**开局之后**改 SLICE_MAP 无效；
//      但 `MAPS[SLICE_MAP.id]` 就是这个对象本身，在**任何一局开始之前**改它，会进到每一局的克隆里。
//   ② plot.cells 是**网格坐标**，node.x 是**像素坐标**（x*cell）。混着比 ⇒ frontage = 0，
//      于是探针会印出「逐位相同」的假结论。
import { SLICE_MAP } from '../../src/data/slice.js';

const EAST_ID = 'market-east';
const EAST_CELLS = [{ x: 8, y: 3 }, { x: 9, y: 3 }, { x: 8, y: 4 }, { x: 9, y: 4 }];

function install() {
  if (SLICE_MAP.plots.some(p => p.id === EAST_ID)) return 0;
  SLICE_MAP.plots.push({
    id: EAST_ID, cells: EAST_CELLS.map(c => ({ ...c })), big: true, street: '东书屋',
    name: '东街书屋', price: 26000, availableFromDay: 4,
  });
  SLICE_MAP.initialProperties.push({ plotId: EAST_ID, level: 2, bigType: 'bookstore', price: 26000 });

  let linked = 0;
  for (const node of SLICE_MAP.nodes) {
    const [nx, ny] = node.id.split(',').map(Number);      // 网格坐标，不是像素
    if (!EAST_CELLS.some(c => Math.abs(c.x - nx) + Math.abs(c.y - ny) === 1)) continue;
    node.adjacentPlots ??= [];
    node.adjacentPlots.push(EAST_ID);
    linked++;
  }
  return linked;
}

const linked = install();
// 自检必须留在页面上：上一轮正是「没有这条断言」才把「从未发生」印成了「没用」。
if (linked !== 8) throw new Error(`东街书屋 frontage = ${linked}，应为 8 —— 注入没生效，别信这一局`);

const westFront = SLICE_MAP.nodes.filter(n => n.adjacentPlots?.includes('market')).length;
const shared = SLICE_MAP.nodes.filter(n =>
  n.adjacentPlots?.includes('market') && n.adjacentPlots?.includes(EAST_ID)).length;

document.documentElement.dataset.variant = 'twin-center';
document.documentElement.dataset.eastFront = String(linked);
document.documentElement.dataset.westFront = String(westFront);
document.documentElement.dataset.sharedFront = String(shared);
console.log(`[twin-center] 东街书屋已装上：frontage ${linked}（西 ${westFront}，共享 ${shared}），第 4 天开售，26,000`);

// 对局开始后（#setup 被 hidden），从棋盘本身确认第二块地真的画出来了。
// 只验渲染结果，不去碰 main.js 的私有 state —— 那个拿不到，硬碰就变成了测我自己造的一局。
{
  const mark = () => {
    if (!document.querySelector('#setup')?.hidden) return false;
    const board = document.querySelector('#board')?.textContent ?? '';
    const insight = document.querySelector('#insight')?.textContent ?? '';
    const seen = `${board} ${insight}`.includes('东街书屋');
    document.documentElement.dataset.eastSeen = seen ? 'yes' : 'no';
    return seen;
  };
  let n = 0;
  const t = setInterval(() => { if (mark() || ++n > 400) clearInterval(t); }, 300);
}
