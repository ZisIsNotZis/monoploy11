// #3391i：书屋的价值到底是不是「租金」？—— 用随机指派 + 关掉租金来直接判。
//
// 为什么必须再测一次：
//   · what-wins.mjs 量到「持书屋者收租 4480–5983/局，送卡仅 0.66 张」
//     我当时写成「卡不是原因，租金是」。**那只是相关性**：谁持有一块地都会收它的租。
//   · rent-fork.mjs（押注 vs 不押，n=360/臂）更奇怪：把 `bigRentMultiplier`
//     从 1.6 一路砍到 0.35（租金只剩 22%），押注仍然 +5.3pp，几乎不动。
//     ⇒ 若租金真是机制，砍掉 78% 的租金应该把优势砍掉大半。它没有。
//
// 这一支用 randomize-book 的随机指派设计（去掉选择效应、等值现金对照），
// 再加一个**租金归零**的处理臂：
//   book0 = 直接持有书屋，但 bigRentMultiplier = 0 ⇒ 它一分租都不收，也一分不付
// 若 book0 仍显著高于 cash，那「书屋的价值」就**不是租金**，而是别的东西
// （所有权本身、对手失去它、或我还没看到的计分口径）。这才是要写进结论的那一句。
//
// 用法：node support/probe-3391/rent-attribute.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buyPrice, rentFor } from '../../src/engine/economy.js';
import { TUNING } from '../../src/data/tuning.js';
import { makeRng } from '../../src/engine/rng.js';
import { assertUnique, pairedDiff, fmtCI } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BOOK = 'market';
const DEFAULT = TUNING.bigRentMultiplier;

const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);

function makeGame(style, seed) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  const others = SLICE_STYLES.filter(s => s.id !== style).map(s => s.id);
  config.participants = [style, ...others].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  return startSession(config);
}

async function play({ style, seed, seatIndex, arm }) {
  const state = makeGame(style, seed);
  const price = buyPrice(state, BOOK);
  const seat = state.players[seatIndex];
  if (arm === 'cash') seat.cash += price;
  if (arm === 'book' || arm === 'book0') {
    state.properties[BOOK].ownerId = seat.id;
    seat.properties.push(BOOK);
  }
  // 租金倍率按臂设定（块内单设，退出时恢复）
  TUNING.bigRentMultiplier = arm === 'book0' ? 0 : DEFAULT;
  let decisions = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      return aiAnswer(prompt, state);
    },
  });
  TUNING.bigRentMultiplier = DEFAULT;
  if (!state.over) throw new Error('Engine returned before game ended');
  return {
    // #3391n：配对键（style/seed）必须跟着行返回，否则 assertUnique 只能看到 undefined
    // 并直接把第一对就判成「重复」—— 这个断言第一次跑就把我自己拦住了。
    style, seed, seatIndex,
    win: state.players.find(p => p.team === state.winnerTeam) === seat,
    bankrupt: !seat.alive,
    rents: seat.sliceStats.rentEarned,
    paidRent: seat.sliceStats.rentPaid ?? 0,
    assets: assetsOf(state, seat),
    stillOwns: state.properties[BOOK].ownerId === seat.id,
    bookRentNow: rentFor(state, BOOK),
  };
}

async function arm(name) {
  const rows = [];
  for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
    const seatIndex = makeRng(seed * 7919 + STYLES.indexOf(style) * 104729 + 13).int(3);
    // #3391n：这里原来有 `for (let rep = 0; rep < 2; rep++)`，把同一局跑了两遍。
    // 引擎确定性 ⇒ 第二遍逐字段相同，于是「360 局/臂」实为 180 局，且区间被压窄。已删。
    rows.push(await play({ style, seed, seatIndex, arm: name }));
  }
  assertUnique(rows, `rent-attribute/${name}`);
  return rows;
}

// 归零断言：book0 臂里，书屋在任何时刻都不该产生租金。
{
  const s = makeGame('take', 1);
  TUNING.bigRentMultiplier = 0;
  s.properties[BOOK].ownerId = s.players[0].id;
  s.players[0].properties.push(BOOK);
  const zero = rentFor(s, BOOK);
  TUNING.bigRentMultiplier = DEFAULT;
  const normal = rentFor(s, BOOK);
  console.log(`租金断言：倍率 0 ⇒ ${zero}（默认 ${DEFAULT} ⇒ ${normal}）`);
  if (zero !== 0) throw new Error('归零没生效 —— 这一支测的就不是「没有租金」');
}

const arms = {};
for (const a of ['none', 'cash', 'book', 'book0']) {
  // 每条臂都覆盖同一批 (style, seed) —— 否则下面的配对比较会直接抛。
  arms[a] = await arm(a);
  const n = arms[a].length;
  console.log(`\n臂 ${a.padEnd(5)} n=${n} 胜 ${pct(arms[a].filter(r => r.win).length, n).padEnd(7)}`
    + ` 破产 ${pct(arms[a].filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` 收租 ${String(Math.round(mean(arms[a], 'rents'))).padStart(5)}`
    + ` 终局书屋租金读数 ${Math.round(mean(arms[a], 'bookRentNow')).toString().padStart(5)}`
    + ` 仍持有 ${pct(arms[a].filter(r => r.stillOwns).length, n).padEnd(6)}`
    + ` 资产 ${Math.round(mean(arms[a], 'assets'))}`);
}

// #3391n：区间改成**配对**的。同一 seed 只差处理 ⇒ 配对比值把「这个种子本来就难」的方差吃掉，
// 这是同 seed 跑多臂换来的信息；旧的独立样本公式既丢掉了配对、又用了复印出来的 n。
console.log('\n=== 拆开「财富」与「租金」（同一 seed 配对，bootstrap 4000 次）===');
for (const [a, b, label] of [
  ['cash', 'none', '白得 26,000 现金'],
  ['book', 'cash', '同样 26,000，做成书屋（含租金）'],
  ['book0', 'cash', '同样 26,000，做成书屋但**租金归零**'],
  ['book', 'book0', '租金带来的全部增量'],
]) {
  const d = pairedDiff(arms[a], arms[b]);
  const excludesZero = d.lo > 0 || d.hi < 0;
  console.log(`  ${label.padEnd(30)} ${fmtCI(d)} ${excludesZero ? '显著' : '不显著'}`
    + `  朴素公式会印 ±${(196 * d.naiveSe).toFixed(1)}`);
}
// 租金分量的另一种说法：书屋（含租）与 书屋（无租）之差里，“归零臂自己也值多少”。
console.log('\n（“5–14pp 来自所有权本身”这一句的读法：book0 对 cash 的差就是它；见上表。）');
