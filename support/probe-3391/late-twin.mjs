// #3391q：第二处高地到底是「另一种打算」还是「同一个计划买两次」。
//
// 两条量具错，先讲清（都否掉了更早的读数）：
//   ① late-center.mjs 的南街书库只用了 2×2 块的北侧一排 (5,6)(6,6)，注释却写「4 临街格」。
//      它真正贴着的路口只有 (5,5)(6,5) 两个（(5,7)/(6,7) 才靠 (5,8)/(6,8)），而书屋贴 9 个。
//      ⇒ two-plans-forced.mjs 的「等南 −20.6pp」混着几何错。
//   ② 印胜率时 pct(rate(...), n) 双重除，印出 0.4% 这种荒谬值。
// 本支：整块 2×2（4 个临街路口）+ frontage 硬断言 + 配对 bootstrap（stats.mjs）。
//
// 决策问题本身：同一 seed、同一批对手，走到南街书库面前，花钱买 vs 留现金。
// assetsOf 在 slice 里按 buyPrice 记地产 ⇒ 买地资产中性，两臂唯一差别是
// **收租机会 vs 现金周转**，这正是「值不值」的定义。
//
// 规则候选（--oneHigh）：一家只能持有一块大地产。动机来自实测：
// 南街书库 13,000 与 20,000 两档都是 +17pp，且**我已持有街心书屋时买它仍然 +14.8pp**
// ⇒ 钱换成大地块的临街格永远赚，一个座位能吃下两块高地（「北边是我」+ 买南 = 95.1%）。
// 没有稀缺就没有选择，所以先造稀缺再问「两种打算是否成立」。
//
// 用法：node support/probe-3391/south-value.mjs [60] [day] [price] [oneHigh]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buyPrice } from '../../src/engine/economy.js';
import { assertUnique, keyOf, pairedDiff, fmtCI } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 60);
const DAY = Number(process.argv[3] ?? 9);
const PRICE = Number(process.argv[4] ?? 13000);
const ONE_HIGH = process.argv[5] === 'oneHigh';
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
  120: { grow: 49.2, take: 38.3, cross: 45.0 },
};
const BASELINE = BASELINES[SEEDS * 2];
if (!BASELINE) throw new Error(`没有 n=${SEEDS * 2} 的基线`);

const NORTH = 'market';
const SOUTH = 'market-east';
// 东街 2×2（(8,3)(9,3)(8,4)(9,4)）：与街心书屋同为 2×2，贴着的路口数也相同。
// 为什么要换到这块：#3391p 的 twin-centers 用同一块但**同一天、同一个价**，
// 结果第 4 天买哪块只由 adjacentPlots 的数组顺序决定（先报价者买走）——那是顺序偏置，
// 不是选择。「同 frontage、不同开售日 + 不同价」这个组合还没量过，本支补上。
const SOUTH_CELLS = [{ x: 8, y: 3 }, { x: 9, y: 3 }, { x: 8, y: 4 }, { x: 9, y: 4 }];
// 街心书屋 2×2 贴 8 个路口（上 2、下 2、左 2、右 2）——我先前手写「9」是错的，
// 被下面这条断言抓住。所以这里不写死数字，直接与书屋的实际 frontage 比。
const bookFrontage = state => state.map.nodes.filter(n => (n.adjacentPlots ?? []).includes('market')).length;

const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const rate = xs => (xs.length ? xs.reduce((s, r) => s + (r.win ? 1 : 0), 0) / xs.length : 0);
const show = rows => pct(rate(rows) * rows.length, rows.length);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

function addSouthCenter(state) {
  state.map.plots.push({ id: SOUTH, cells: SOUTH_CELLS.map(c => ({ ...c })), big: true,
    street: '南街', name: '南街书库', price: PRICE, availableFromDay: DAY });
  state.properties[SOUTH] = { ownerId: null, level: 2, street: '南街', big: true,
    bigType: 'bookstore', closed: 0, inflate: 0, price: PRICE };
  state.map.initialProperties.push({ plotId: SOUTH, level: 2, bigType: 'bookstore', price: PRICE });
  let linked = 0;
  for (const node of state.map.nodes) {
    const [nx, ny] = node.id.split(',').map(Number);   // 网格坐标，不是像素
    if (!SOUTH_CELLS.some(c => Math.abs(c.x - nx) + Math.abs(c.y - ny) === 1)) continue;
    (node.adjacentPlots ??= []).push(SOUTH);
    linked++;
  }
  const want = bookFrontage(state);
  if (linked !== want)
    throw new Error(`东街书屋 frontage ${linked} ≠ 街心书屋 ${want} —— 两块不等，不能比`);
}

// 规则：一家只能持有一块大地产。对三家一视同仁；return true 表示「这次买地被规则否掉」。
function blockedByOneHigh(state, prompt) {
  const pl = prompt.player;
  if (!pl) return false;
  const id = prompt.plot?.id ?? prompt.plot;
  const plot = prompt.plot?.big !== undefined ? prompt.plot : state.map.plots.find(p => p.id === id);
  if (!plot?.big) return false;
  return pl.properties.some(pid => state.properties[pid]?.big);
}

async function play({ style, seed, order, arm, withSouth = true }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (withSouth) addSouthCenter(state);
  const seat0 = state.players[0];
  let decisions = 0, minCash = seat0.cash, sawSouth = false, southDay = null;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      minCash = Math.min(minCash, seat0.cash);
      if (prompt.type === 'buy' && ONE_HIGH && blockedByOneHigh(state, prompt)) return false;
      const mine = prompt.player?.id === seat0.id;
      if (prompt.type === 'buy' && mine) {
        const id = prompt.plot?.id ?? prompt.plot;
        const affordable = seat0.cash >= (prompt.price ?? buyPrice(state, id));
        if (id === SOUTH) {
          // buyPlot 现金不够时会静默不买（flow.js:670），所以先核一次现金，
          // 否则「强制买」臂会把没成交的局记成买了 —— 那是「把沉默当读数」。
          if (affordable) {
            sawSouth = true;
            if (arm === 'buy') { southDay = state.day; return true; }
          }
          if (arm === 'skip') return false;
          if (arm === 'north') return false;
          if (arm === 'south') return affordable;
        }
        if (id === NORTH) {
          if (arm === 'south') return false;
          if (arm === 'north') return affordable;
        }
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const ownerOf = id => state.properties[id]?.ownerId ?? null;
  return {
    // stats.mjs 用 `${style}:${seed}` 作配对键；同一 seed 有两种对手排列，
    // 所以把排列并进 style 字段，保证键唯一（否则会误报「重复样本」）。
    style: `${style}|${order.join('>')}`, styleId: style, seed,
    win: state.players.find(p => p.team === state.winnerTeam) === seat0 ? 1 : 0,
    bankrupt: !seat0.alive,
    sawSouth, southDay: sawSouth ? southDay : null,
    ownsSouth: ownerOf(SOUTH) === seat0.id,
    northMine: ownerOf(NORTH) === seat0.id,
    northTaken: ownerOf(NORTH) != null,
    rents: seat0.sliceStats.rentEarned,
    paid: seat0.sliceStats.rentPaid ?? 0,
    minCash, assets: assetsOf(state, seat0),
  };
}

async function arm(name) {
  const rows = [];
  for (const style of STYLES) for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, arm: name }));
  return rows;
}

// 基线必须在**未改动的**原始地图上复现，否则量的不是产品。
console.log(`基线校验（原始地图，无南街书库；规则=${ONE_HIGH ? '一人一块大地' : '现状'}）`);
for (const style of STYLES) {
  const rs = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rs.push(await play({ style, seed, order, arm: 'ai', withSouth: false }));
  const p = 100 * rate(rs);
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }
}

const names = ['ai', 'buy', 'skip', 'north', 'south'];
const arms = {};
for (const nm of names) arms[nm] = await arm(nm);
if (new Set(names.map(k => arms[k].length)).size !== 1) throw new Error('各臂行数不一致 —— 配对会错位');
assertUnique(arms.buy, 'buy');
assertUnique(arms.skip, 'skip');

const n = arms.ai.length;
console.log(`\n每臂 n=${n}（${SEEDS} seed × 3 起手 × 2 座位排列）；0 号位按臂强制`);
console.log('臂      胜率    破产   收租   付租   最低现金  资产   占南 n  占北 n');
for (const nm of names) {
  const rows = arms[nm];
  console.log(`${nm.padEnd(6)} ${show(rows).padEnd(7)}`
    + ` ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` ${String(Math.round(mean(rows, 'rents'))).padStart(5)}`
    + ` ${String(Math.round(mean(rows, 'paid'))).padStart(5)}`
    + ` ${String(Math.round(mean(rows, 'minCash'))).padStart(8)}`
    + ` ${String(Math.round(mean(rows, 'assets'))).padStart(6)}`
    + ` ${String(rows.filter(r => r.ownsSouth).length).padStart(6)}`
    + ` ${String(rows.filter(r => r.northMine).length).padStart(6)}`);
}

// 稀缺性是否真的成立：一人一块大地时，「既占北又占南」必须是 0。
const both = arms.ai.filter(r => r.northMine && r.ownsSouth).length;
const freeN = arms.ai.filter(r => !r.northTaken).length;
console.log(`\n稀缺性检查：照常打里「同时占北与南」${both}/${n}；北边无人买 ${pct(freeN, n)}`);
if (ONE_HIGH && both > 0) throw new Error('一人一块大地规则没生效 —— 有座位同时持两块');
if (!ONE_HIGH && both === 0) throw new Error('现状下竟没人同时持两块 —— 探针没量到想量的东西');

const spread = k => {
  const w = STYLES.map(s => rate(arms[k].filter(r => r.styleId === s)));
  return 100 * (Math.max(...w) - Math.min(...w));
};
console.log(`三起手差距：照常 ${spread('ai').toFixed(1)}pp；只抢北 ${spread('north').toFixed(1)}pp；只抢南 ${spread('south').toFixed(1)}pp`);

// 决策发生在「买臂真的成交」的局里；不买的臂也限制在同一批键上，否则不可比。
const dealt = new Set(arms.buy.filter(r => r.ownsSouth).map(keyOf));
const buySub = arms.buy.filter(r => dealt.has(keyOf(r)));
const skipByKey = new Map(arms.skip.map(r => [keyOf(r), r]));
const pairs = buySub.map(a => ({ a, b: skipByKey.get(keyOf(a)), styleId: a.styleId }));
if (pairs.some(x => !x.b)) throw new Error('配对缺失 —— 两臂不是同一批局');

console.log(`\n=== 同一局：买下南街书库 vs 留现金（n=${pairs.length} 对）===`);
console.log(`  买 ${show(pairs.map(x => x.a))} vs 不买 ${show(pairs.map(x => x.b))}`);
console.log(`  配对差 ${fmtCI(pairedDiff(pairs.map(x => x.a), pairs.map(x => x.b)))}`);
const disagree = pairs.filter(x => x.a.win !== x.b.win).length;
console.log(`  两者结果不同的局 ${disagree}/${pairs.length}（${pct(disagree, pairs.length)}）`);

console.log(`\n=== 分起手（同局配对）===`);
for (const sid of STYLES) {
  const g = pairs.filter(x => x.styleId === sid);
  if (!g.length) { console.log(`  ${sid} n=0`); continue; }
  console.log(`  ${sid.padEnd(6)} n=${String(g.length).padStart(3)}  买 ${show(g.map(x => x.a)).padEnd(6)}`
    + ` 不买 ${show(g.map(x => x.b)).padEnd(6)}  差 ${fmtCI(pairedDiff(g.map(x => x.a), g.map(x => x.b)))}`);
}

console.log(`\n=== 按「北边书屋归谁」拆（同局配对）===`);
for (const label of ['北边是我', '北边是别人', '没人买北边']) {
  const sel = x => label === '北边是我' ? x.a.northMine
    : label === '北边是别人' ? (!x.a.northMine && x.a.northTaken) : !x.a.northTaken;
  const g = pairs.filter(sel);
  if (!g.length) { console.log(`  ${label} n=0`); continue; }
  console.log(`  ${label.padEnd(5)} n=${String(g.length).padStart(3)}  买 ${show(g.map(x => x.a)).padEnd(6)}`
    + ` 不买 ${show(g.map(x => x.b)).padEnd(6)}  差 ${fmtCI(pairedDiff(g.map(x => x.a), g.map(x => x.b)))}`);
}

// 两种计划是否真的不同 —— 失败方式分开才算「两种打算」。
console.log(`\n=== 两种计划（只抢北 vs 只抢南），同一批对手 ===`);
const nb = new Map(arms.north.map(r => [keyOf(r), r]));
const planPairs = arms.south.map(s => ({ s, n: nb.get(keyOf(s)) })).filter(x => x.n);
console.log(`  只抢北 ${show(planPairs.map(x => x.n))} vs 只抢南 ${show(planPairs.map(x => x.s))}`);
console.log(`  配对差（南−北）${fmtCI(pairedDiff(planPairs.map(x => x.s), planPairs.map(x => x.n)))}`);
console.log(`  抢到北边 ${pct(planPairs.filter(x => x.n.northMine).length, planPairs.length)}`
  + ` 抢到南边 ${pct(planPairs.filter(x => x.s.ownsSouth).length, planPairs.length)}`);

console.log(`\n=== 失败方式（输的局）===`);
for (const nm of ['ai', 'north', 'south']) {
  const lost = arms[nm].filter(r => !r.win);
  console.log(`  ${nm.padEnd(6)} n=${String(lost.length).padStart(3)}`
    + ` 破产 ${pct(lost.filter(r => r.bankrupt).length, lost.length).padEnd(6)}`
    + ` 最低现金 ${String(Math.round(mean(lost, 'minCash'))).padStart(6)}`
    + ` 付租 ${String(Math.round(mean(lost, 'paid'))).padStart(5)}`
    + ` 收租 ${String(Math.round(mean(lost, 'rents'))).padStart(5)}`);
}
