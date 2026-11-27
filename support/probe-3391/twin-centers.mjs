// #3391l：**两块真正等价的高地** —— 这是本片最接近「两种打算」的规则改动。
//
// 为什么前面都失败，这一支为什么不同：
//   · two-plans-forced.mjs：给第二种打法一块 4 临街格的地（第 9 天 13,000），仍比照常打差 20.6pp。
//   · rent-attribute.mjs（随机指派）：书屋 28.3pp 价值里 20.6pp 来自租金。
//   · frontage-space.mjs：这张图上**确实还有第二个 8 临街格的位置** —— (8,3)-(9,4) 那块 2×2。
//     ⇒ 之前所有「第二处高地」都太弱（4–6 格），不是「两地高不好」，是「第二个不够高」。
//
// 这一支在地图东侧 (8,3) 放**和街心书屋完全等价**的第二块：8 临街格、第 4 天、26,000、同样租金。
// 于是三家人面对两个同价同质的高地，钱只够买一块 ⇒ 第 4 天必须选一处：
//   · 选哪处：两块都在地图上，位置不同 ⇒ 谁踩到的次数不同（用实测打印）
//   · 谁去抢：三家人互相争，必然有 1–2 家拿不到 —— 但**另一块还在**
//   ⇒ 若「占 0 块」的局从 46% 掉下来、且「占 1 块」不再是 80–100%，就是取舍出现了。
//
// 只动本局 state.map（createGame 已 clone），不动产品字节，不改价目。
//
// 用法：node support/probe-3391/twin-centers.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
  120: { grow: 49.2, take: 38.3, cross: 45.0 },
};
const BASELINE = BASELINES[SEEDS * 2];
if (!BASELINE) throw new Error(`没有 n=${SEEDS * 2} 的基线`);
const WEST = 'market';
const EAST = 'market-east';
const EAST_CELLS = [{ x: 8, y: 3 }, { x: 9, y: 3 }, { x: 8, y: 4 }, { x: 9, y: 4 }];

const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const pct100 = rows => 100 * rows.filter(r => r.win).length / rows.length;
const rates = {};
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

function addEastCenter(state) {
  state.map.plots.push({ id: EAST, cells: EAST_CELLS.map(c => ({ ...c })), big: true, street: '东书屋',
    name: '东街书屋', price: 26000, availableFromDay: 4 });
  state.properties[EAST] = { ownerId: null, level: 2, street: '东书屋', big: true,
    bigType: 'bookstore', closed: 0, inflate: 0, price: 26000 };
  state.map.initialProperties.push({ plotId: EAST, level: 2, bigType: 'bookstore', price: 26000 });
  let linked = 0;
  for (const node of state.map.nodes) {
    const [nx, ny] = node.id.split(',').map(Number);
    if (!EAST_CELLS.some(c => Math.abs(c.x - nx) + Math.abs(c.y - ny) === 1)) continue;
    (node.adjacentPlots ??= []).push(EAST);
    linked++;
  }
  return linked;
}

async function play({ style, seed, order, twin }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (twin) addEastCenter(state);
  const seat0 = state.players[0];
  let decisions = 0, minCash = seat0.cash;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      minCash = Math.min(minCash, seat0.cash);
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const held = twin ? [WEST, EAST] : [WEST];
  const owns = id => state.properties[id]?.ownerId === seat0.id;
  const owners = new Set(held.map(id => state.properties[id]?.ownerId).filter(Boolean));
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    mine: held.filter(owns).length,
    split: twin && owners.size === 2,
    rents: seat0.sliceStats.rentEarned,
    minCash, assets: assetsOf(state, seat0),
  };
}

async function runArm(style, twin) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, twin }));
  return rows;
}

console.log(`基线校验（原始地图，单高地）`);
const base = {};
for (const style of STYLES) {
  base[style] = await runArm(style, false);
  const p = 100 * base[style].filter(r => r.win).length / base[style].length;
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  // 对照组「一块高地都不占」的比例也必须由数据印出来 —— 页面与 RESULT 里那句
  // 「约 46%」是手写的，上一轮就是这么漂的。
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`
    + `  基线占 0 块 ${pct(base[style].filter(r => r.mine === 0).length, base[style].length)}`);
  if (!ok) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }
}

// 等价断言：两块必须同临街、同价、同开售日，否则「两块等价高地」就是空话
{
  const s = startSession(createSliceConfig({ human: false, seed: 1, style: 'take', sliceContestedStreets: true }));
  const linked = addEastCenter(s);
  const west = s.map.nodes.filter(n => n.adjacentPlots?.includes(WEST)).length;
  const shared = s.map.nodes.filter(n => n.adjacentPlots?.includes(WEST) && n.adjacentPlots?.includes(EAST)).length;
  // #3391m：上一版的租金断言是**空断言**。rentFor 在无主时直接 return 0，
  // 而这两块开局都无主 ⇒ 印出来是「租金 0 vs 0」，0===0 永远成立，实际什么都没验。
  // 现在临时把两块都记给同一个座位再算，比完恢复（只动本局 state，与产品字节无关）。
  const seat = s.players[0];
  s.properties[WEST].ownerId = seat.id; s.properties[EAST].ownerId = seat.id;
  const rentW = rentFor(s, WEST), rentE = rentFor(s, EAST);
  s.properties[WEST].ownerId = null; s.properties[EAST].ownerId = null;
  console.log(`\n等价校验：西 ${west} 格 / 东 ${linked} 格（共享 ${shared}），同一持有者租金 ${rentW} vs ${rentE}`);
  if (linked !== west) throw new Error('两块不等价 —— 这不是「两块同样的高地」');
  if (rentW === 0) throw new Error('租金读数是 0 —— 断言仍然无效（rentFor 无主即 0）');
  if (rentW !== rentE) throw new Error(`两块租金不等价：${rentW} vs ${rentE}`);
  // 共享的临街格是**几何事实**：西块最右 x=6、东块最左 x=8，中间那列路面 (7,3)(7,4)
  // 同时贴着两块。站在那儿能同时看到两个报价 —— 那正是「第 4 天选哪一块」的那一刻。
  // 决定收租多寡的是**各自**的 8 格（上面已经断言），所以这里只印出来、不判红。
  // （第一次真机验时我把「共享 0」写成硬条件，页面报 2 —— 是断言错了，不是注入错了。）
  console.log(`        共享临街格 ${shared}（几何：两块中间那列路面，站在那能同时看到两个报价）`);
}

console.log('\n===== 两块等价高地（街心书屋 + 东街书屋，各 8 临街格）=====');
for (const style of STYLES) {
  const rows = await runArm(style, true);
  const n = rows.length;
  const seats = [0, 1, 2].map(k => rows.filter(r => r.mine === k));
  const b = base[style];
  console.log(`  ${style.padEnd(6)} 基础 ${pct(b.filter(r => r.win).length, b.length).padEnd(7)}`
    + ` → 两块高地 ${pct(rows.filter(r => r.win).length, n).padEnd(7)}`
    + ` 破产 ${pct(b.filter(r => r.bankrupt).length, b.length)} → ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` 两人各持一块 ${pct(rows.filter(r => r.split).length, n)}`);
  console.log(`         占 0 块 n=${String(seats[0].length).padStart(3)} 胜 ${pct(seats[0].filter(r => r.win).length, seats[0].length).padEnd(6)}`
    + ` 占 1 块 n=${String(seats[1].length).padStart(3)} 胜 ${pct(seats[1].filter(r => r.win).length, seats[1].length).padEnd(6)}`
    + ` 占 2 块 n=${String(seats[2].length).padStart(3)} 胜 ${pct(seats[2].filter(r => r.win).length, seats[2].length)}`);
  console.log(`         收租 ${String(Math.round(mean(rows, 'rents'))).padStart(5)}`
    + ` 最低现金 ${String(Math.round(mean(rows, 'minCash'))).padStart(6)}`);
  rates[style] = { base: pct100(b), twin: pct100(rows) };
}

// #3391m：三起手差距由这里算，不手写。上一版 RESULT 与对照页都写「10.8→4.2」，
// 而这一支自己印出的三格是 45.8 / 44.2 / 50.0 ⇒ 5.8pp。差的那 1.6pp 是我手填的。
const spread = o => Math.max(...Object.values(o)) - Math.min(...Object.values(o));
const hi = o => STYLES.find(s => o[s] === Math.max(...Object.values(o)));
const lo = o => STYLES.find(s => o[s] === Math.min(...Object.values(o)));
const baseRates = Object.fromEntries(STYLES.map(s => [s, rates[s].base]));
const twinRates = Object.fromEntries(STYLES.map(s => [s, rates[s].twin]));
console.log(`\n三起手差距：基线 ${spread(baseRates).toFixed(1)}pp（${hi(baseRates)} 高 / ${lo(baseRates)} 低）`
  + ` → 两块高地 ${spread(twinRates).toFixed(1)}pp（${hi(twinRates)} 高 / ${lo(twinRates)} 低）`);
