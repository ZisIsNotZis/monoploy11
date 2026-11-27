// #3391f：**实验**，不是观察。
//
// supervisor 的反驳成立，我接受：race-conditional.mjs 的「持有者 80–100%、别人拿到 3–5%」
// 是**按终局拥有者分组**的读数 —— 那是一个 post-treatment 变量。
// 想在第 4 天买下书屋，需要手里正好有 26,000 且走到那个路口；能同时做到这几件事的人
// 本来就更可能赢。所以那个数把「买得起」和「有书屋」混在了一起，不能说成因果。
//
// 这里换成**随机指派**：开局就把书屋直接记在某个座位上（不花钱、不走位、不掷骰），
// 对照臂给同一座位等值的**现金**（书屋 26,000，正是它买价 —— slice 里 assetsOf 只按
// buyPrice 记地产，所以「持有书屋」与「多 26,000 现金」在记分上**等值**）。
// 两臂唯一差别就是「这 26,000 是地，还是钱」。
//
// 于是：
//   · 随机指派 ⇒ 去掉「买得起的人本来就更强」的选择偏差
//   · 等值现金对照 ⇒ 去掉「白得一笔钱」的财富效应
//   剩下的差才是「这块钱变成收租机会」本身的效果。
//
// 每个 style × seed 都换一次受试座位（独立的 seeded rng，与对局 rng 无关），
// 所以读数对「谁坐哪个座位」是平衡的。
//
// 用法：node support/probe-3391/randomize-book.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buyPrice } from '../../src/engine/economy.js';
import { makeRng } from '../../src/engine/rng.js';
import { assertUnique, pairedDiff, fmtCI } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BOOK = 'market';

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

// arm: 'none' | 'book' | 'cash'
function treat(state, arm, seatIndex, bookPrice) {
  if (arm === 'none') return;
  const seat = state.players[seatIndex];
  if (arm === 'cash') { seat.cash += bookPrice; return; }
  const pr = state.properties[BOOK];
  if (pr.ownerId) throw new Error(`指派前书屋已归一 ${pr.ownerId}`);
  pr.ownerId = seat.id;
  seat.properties.push(BOOK);
}

async function play({ style, seed, seatIndex, arm }) {
  const state = makeGame(style, seed);
  const bookPrice = buyPrice(state, BOOK);   // 26,000，且 assetsOf 就按这个数记
  treat(state, arm, seatIndex, bookPrice);
  const seat = state.players[seatIndex];
  if (arm === 'book' && state.properties[BOOK].ownerId !== seat.id)
    throw new Error('指派没生效');
  let decisions = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return {
    style, seed, seatIndex,           // 配对键，见 stats.mjs
    win: state.players.find(p => p.team === state.winnerTeam) === seat,
    bankrupt: !seat.alive,
    assets: assetsOf(state, seat),
    rents: seat.sliceStats.rentEarned,
    stillOwnsBook: state.properties[BOOK].ownerId === seat.id,
  };
}

async function arm(armName) {
  const rows = [];
  for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
    // 受试座位：独立 rng，与对局随机数无关
    const seatIndex = makeRng(seed * 7919 + STYLES.indexOf(style) * 104729 + 13).int(3);
    // #3391n：原来这里跑了两遍同一局（引擎确定性 ⇒ 逐字段相同），把 180 局印成 360 局。已删。
    rows.push(await play({ style, seed, seatIndex, arm: armName }));
  }
  assertUnique(rows, `randomize-book/${armName}`);
  return rows;
}

// 报价必须与 assetsOf 的记分口径一致，否则「等值」就是空话。
{
  const s = makeGame('take', 1);
  const p = buyPrice(s, BOOK);
  const before = assetsOf(s, s.players[0]);
  s.players[0].cash += p;
  const cashDelta = assetsOf(s, s.players[0]) - before;
  const s2 = makeGame('take', 1);
  const b2 = assetsOf(s2, s2.players[0]);
  s2.properties[BOOK].ownerId = s2.players[0].id;
  s2.players[0].properties.push(BOOK);
  const bookDelta = assetsOf(s2, s2.players[0]) - b2;
  console.log(`等值校验：+${p} 现金 ⇒ 资产 +${cashDelta}；直接持有书屋 ⇒ 资产 +${bookDelta}`);
  if (cashDelta !== bookDelta) throw new Error('两臂在记分上不等值 —— 这个对照不干净，别印数');
}

const arms = {};
for (const a of ['none', 'cash', 'book']) {
  arms[a] = await arm(a);
  const n = arms[a].length;
  console.log(`\n臂 ${a.padEnd(4)} n=${n}  胜 ${pct(arms[a].filter(r => r.win).length, n).padEnd(7)}`
    + ` 破产 ${pct(arms[a].filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` 收租 ${String(Math.round(mean(arms[a], 'rents'))).padStart(5)}`
    + ` 终局资产 ${Math.round(mean(arms[a], 'assets'))}`);
}
console.log(`\n（book 臂受试座位终局仍持有书屋 ${pct(arms.book.filter(r => r.stillOwnsBook).length, arms.book.length)}）`);

// #3391n：区间改成配对的（同 seed 只差处理），并且 n 是**真实局数**而不是复印次数。
const d = pairedDiff(arms.book, arms.cash);
const dWealth = pairedDiff(arms.cash, arms.none);
console.log('\n=== 随机指派：持有书屋 vs 等值现金（同一 seed、同一受试座位，配对）===');
console.log(`  书屋 ${pct(arms.book.filter(r => r.win).length, arms.book.length)}  现金 ${pct(arms.cash.filter(r => r.win).length, arms.cash.length)}  差 ${fmtCI(d)}`);
console.log(`  现金臂相对无处理：${fmtCI(dWealth)} ⇒ 这就是「白得 26,000」本身值多少`);
console.log(`  朴素独立样本公式会印 ±${(196 * d.naiveSe).toFixed(1)} —— 那是用复印出来的 n 算的，别再用。`);
const excludesZero = d.lo > 0 || d.hi < 0;
if (!excludesZero) console.log('  ⚠ 差在噪声内：不能说「拥有书屋导致胜利」');
else console.log(`  ⇒ 在等值财富下，持有书屋${d.d > 0 ? '显著提高' : '显著降低'}胜率`);
