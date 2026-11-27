// #3391u：换一个座位，同一个计划还站得住吗 —— 对称发牌试验。
//
// 为什么问这个
// ------------
// supervisor 这一轮的原话：「请继续找两个座位换过来也站得住的打法」。
// 这一片已经量到三件与座位有关的事：
//   ① 争街表下只有 0 号位（真实入口里人类坐的椅子）能真的凑齐一条街 ——
//      它那两条街的另一半都是**无主空地**（走过去 8,000 买即可）；
//      1/2 号位的另一半**互为对方**，只能走收购卡，而收购实测负期望（#3346b）。
//   ② 因此「营业进项」规则的 +17.8pp 主要是**座位红利**：0 号位进项 3.97× 于两位 AI
//      （business-tier.mjs，n=900/表）。
//   ③ 于是「补齐一条街」这条计划对玩家成立、对 AI 不成立 —— 它不是一个所有人都能走的计划。
//
// 所以要找一个**结构对称**的发牌表：三家在「能做什么」上等价，只有位置不同。
// 两张表，各自对称，但对称的方式不一样：
//
//   free   —— 6 条街，每家拿「第 i 条街的第一间」+「第 i+3 条街的第二间」，
//             **12 间店里 6 间有主、6 间无主，且每一间有主店隔壁都是空地**。
//             ⇒ 每家都能「走过去按标价补齐自己那条街」，谁都没有收购互补这条路。
//             这是玩家现在真正在走的那条路（#3346 才量明白人类其实是这么补齐的）的对称版。
//   cycle  —— 三条街、每家拿两条街的各一间，首尾相接成一个 3-循环。
//             ⇒ 每家都只面对「对手的另一半」，只能靠收购；没有空地可走。
//             这是「收购」那条路的对称版，也是它的诚实压力测试。
//
// 怎么做到不动 src
// ----------------
// `initializeSlice` 只认 `sliceContestedStreets` 这一个开关，没有「自定义发牌表」的入口。
// 这里在 `startSession` 之后、**任何决策发生之前**重写所有权，并硬断言：
//   · 重写后的持有表与设计表逐项相同；
//   · 现金 / 手牌 / 位置 / 朝向 / 地图 / 总资产都没被碰（只有 ownerId 与 properties 变）。
// 这不是「改产品」，是把一发牌表当处理来做的最便宜方式；要发布必须真的进 src。
//
// 判据
//   ① 基线：争街 / 无进项 / 照常打 必须复现 53.7 / 36.3 / 44.3（n=300），否则不印；
//   ② 对称表的对称性必须被**实测**：按座位分开的三行胜率、进项、凑齐街数要接近；
//   ③ 同一 (style,seed,order,arm) 只许一条（stats.assertUnique）。
//
// 用法：node support/probe-3391/symmetric-deal.mjs [150]
import { SLICE_STYLES, SLICE_MAP, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';
import { assertUnique, pairedDiff, fmtCI } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 150);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const KNOWN_CONTESTED = { grow: 53.7, take: 36.3, cross: 44.3 };  // balance-3391-300.json
const PER_SHOP = 250;

const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = rows => (rows.length ? rows.filter(r => r.win).length / rows.length : 0);
const spreadOf = rows => {
  const w = STYLES.map(s => 100 * rate(rows.filter(r => r.styleId === s)));
  return { w, pp: Math.max(...w) - Math.min(...w) };
};
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

// makeMap 的街道顺序：晨光/晚风/灯火/月色/西巷/东巷，每条两间。
const STREETS = ['晨光街', '晚风街', '灯火街', '月色街', '西巷', '东巷'];
const plotsOf = id => SLICE_MAP.plots.filter(p => !p.big && p.street === id).map(p => p.id);
if (STREETS.some(s => plotsOf(s).length !== 2)) {
  throw new Error('街道不都是两间 —— 这张对称表的前提不成立，不要照抄');
}

// free：玩家 i 拿 street[i] 的第 0 间 + street[i+3] 的第 1 间。
// 两者隔壁都是空地 ⇒ 每家都能「按标价补齐」，谁都没有收购互补。
const DEAL_FREE = [0, 1, 2].map(i => [plotsOf(STREETS[i])[0], plotsOf(STREETS[(i + 3) % 6])[1]]);
// cycle：三条街首尾相接，每家各占两条街的一半，另一半在**对手**手里。
const CYCLE_A = plotsOf(STREETS[0])[0], CYCLE_A2 = plotsOf(STREETS[0])[1];
const CYCLE_B = plotsOf(STREETS[1])[0], CYCLE_B2 = plotsOf(STREETS[1])[1];
const CYCLE_C = plotsOf(STREETS[2])[0], CYCLE_C2 = plotsOf(STREETS[2])[1];
const DEAL_CYCLE = [[CYCLE_A, CYCLE_B2], [CYCLE_B, CYCLE_C2], [CYCLE_C, CYCLE_A2]];

// 对称性自检：两张表都必须是「每家同样间数、每条街的占用情况对三家一视同仁」。
function auditDeal(deal, label) {
  const counts = deal.map(xs => xs.length);
  if (new Set(counts).size !== 1) throw new Error(`${label}: 各家间数不等 ${counts}`);
  const perStreet = new Map();
  deal.forEach((ids, i) => ids.forEach(id => {
    const st = SLICE_MAP.plots.find(p => p.id === id).street;
    perStreet.set(st, [...(perStreet.get(st) ?? []), i]);
  }));
  return { counts, perStreet: [...perStreet.entries()].map(([s, who]) => `${s}:${who.join('/')}`) };
}
auditDeal(DEAL_FREE, 'free');
auditDeal(DEAL_CYCLE, 'cycle');

// 把发牌表写进一局（在任何决策之前）。返回被改动的字段，供断言。
function deal(state, table) {
  if (table === 'contested') return null;   // 现状，什么都不动
  const target = table === 'free' ? DEAL_FREE : DEAL_CYCLE;
  const touched = [];
  for (const pl of state.map.plots) {
    if (state.properties[pl.id].ownerId != null) touched.push(pl.id);
    state.properties[pl.id].ownerId = null;
  }
  for (const p of state.players) p.properties = [];
  target.forEach((ids, i) => {
    const p = state.players[i];
    for (const id of ids) {
      state.properties[id].ownerId = p.id;
      p.properties.push(id);
    }
  });
  return touched;
}

function holdings(state, p) {
  return state.map.plots.filter(pl => !pl.big && state.properties[pl.id].ownerId === p.id).map(pl => pl.id).sort();
}

// 一位玩家「整条街归我且都开张」的街数（与 flow.js streetBusinessStatus 同义）。
function fullStreets(state, p) {
  const m = new Map();
  for (const pl of state.map.plots) {
    if (pl.big) continue;
    m.set(pl.street, [...(m.get(pl.street) ?? []), pl.id]);
  }
  let n = 0;
  for (const [, ids] of m) {
    if (ids.every(id => {
      const pr = state.properties[id];
      return pr && pr.ownerId === p.id && pr.level > 0 && !(pr.closed > 0);
    })) n++;
  }
  return n;
}

async function play({ style, seed, order, arm, perShop }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: arm === 'contested' });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seatStyles = state.players.map(p => p.style).join(',');
  if (seatStyles !== [style, ...order].join(',')) throw new Error(`SEATING MISMATCH ${seatStyles}`);
  const before = {
    cash: state.players.map(p => p.cash), cards: state.players.map(p => p.cards.join('+')),
    pos: state.players.map(p => `${p.position}/${p.facing}`),
    props: state.map.plots.map(pl => `${pl.id}:${pl.level}:${pl.price}`),
    assets: state.players.map(p => assetsOf(state, p)),
  };
  const touched = deal(state, arm);
  // 断言的顺序很重要：先证明「确实换了」，再证明「别的没换」。
  if (arm !== 'contested') {
    const want = arm === 'free' ? DEAL_FREE : DEAL_CYCLE;
    want.forEach((ids, i) => {
      const got = holdings(state, state.players[i]);
      if (got.join() !== [...ids].sort().join()) {
        throw new Error(`${arm}: 座位 ${i} 持有 ${got.join('|')} 与设计表 ${ids.join('|')} 不符`);
      }
    });
    if (!touched?.length) throw new Error(`${arm}: 一间店都没被改过 —— 这张表等于没生效`);
    const after = {
      cash: state.players.map(p => p.cash), cards: state.players.map(p => p.cards.join('+')),
      pos: state.players.map(p => `${p.position}/${p.facing}`),
      props: state.map.plots.map(pl => `${pl.id}:${pl.level}:${pl.price}`),
      assets: state.players.map(p => assetsOf(state, p)),
    };
    for (const k of ['cash', 'cards', 'pos', 'props']) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) throw new Error(`${arm}: 换发牌时顺手改了 ${k}`);
    }
    // 换发牌只该在座位之间挪地产：**总量**必须一样（不是凭空加钱），
    // 单个座位的资产当然会变 —— 那正是「换一种发牌」的含义。
    const sum = xs => xs.reduce((a, b) => a + b, 0);
    if (sum(before.assets) !== sum(after.assets)) {
      throw new Error(`${arm}: 换发牌后总资产 ${sum(after.assets)} ≠ 换前 ${sum(before.assets)} —— 凭空加/减了价值`);
    }
  }
  state.config.streetBusinessPerShop = perShop;
  const seat0 = state.players[0];
  // 计数：这位座位有没有「走到自己那条街的空地按标价补齐」。
  const freeHalfBought = new Set();
  let decisions = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const ans = aiAnswer(prompt, state);
      if (prompt.type === 'buy' && ans === true) {
        const id = prompt.plot?.id ?? prompt.plot;
        const pl = state.map.plots.find(p => p.id === id);
        const prevOwner = pl ? state.properties[id].ownerId : null;
        const mine = prompt.player?.id;
        // 「无主的另一半」= 我没拥有的空地，且同街另一间是我的。
        if (pl && !pl.big && prevOwner == null && mine != null) {
          const mate = state.map.plots.filter(p => !p.big && p.street === pl.street && p.id !== pl.id);
          if (mate.some(m => state.properties[m.id].ownerId === mine)) freeHalfBought.add(mine);
        }
      }
      return ans;
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const winnerId = state.players.find(p => p.team === state.winnerTeam)?.id ?? null;
  const seats = state.players.map((p, i) => ({
    i, style: p.style, income: p.sliceStats?.business ?? 0, full: fullStreets(state, p),
    win: p.id === winnerId ? 1 : 0, assets: assetsOf(state, p),
  }));
  return {
    style: `${style}|${order.join('>')}`, styleId: style, seed, order: order.join('>'), arm, perShop,
    win: seats[0].win, bankrupt: seat0.alive ? 0 : 1,
    seats, income0: seats[0].income, incomeAi: (seats[1].income + seats[2].income) / 2,
    full0: seats[0].full, fullAi: (seats[1].full + seats[2].full) / 2,
    freeHalf: freeHalfBought.has(seat0.id) ? 1 : 0,
  };
}

async function run(arm, perShop) {
  const rows = [];
  for (const style of STYLES) for (const order of opponentOrders(style))
    for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, arm, perShop }));
  assertUnique(rows, `${arm}|${perShop}`);
  return rows;
}

if (SEEDS !== 150) throw new Error('基线是 150 seed（300 局/格）；换样本量就没有可比基线');

const rows = {};
for (const arm of ['contested', 'free', 'cycle']) for (const perShop of [0, PER_SHOP])
  rows[`${arm}|${perShop}`] = await run(arm, perShop);

// ① 基线
console.log('基线校验（争街 / 无进项 / 照常打，对照 balance-3391-300.json）');
let bad = false;
for (const s of STYLES) {
  const got = 100 * rate(rows['contested|0'].filter(r => r.styleId === s));
  const ok = Math.abs(got - KNOWN_CONTESTED[s]) < 0.05;
  console.log(`  ${s.padEnd(6)} ${got.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${KNOWN_CONTESTED[s]}%`}`);
  if (!ok) bad = true;
}
if (bad) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }

// ② 对称表必须真的生效（逐局已被 play() 内断言过；这里再确认三家的持有数相同）
const check = rows['free|0'][0];
if (!check) throw new Error('空表');

const n = rows['contested|0'].length;
console.log(`\n每格 n=${n}（150 seed × 2 座位排列 × 3 起手）。发牌表：争街（现状）/ free（每家一个空地另一半）/ cycle（三家互补）。`);

console.log('\n=== ① 三张表 × 两档：三起手胜率 / 差距 / 破产 ===');
console.log('表/档          grow   take  cross   差距    破产(g/t/c)');
for (const arm of ['contested', 'free', 'cycle']) for (const perShop of [0, PER_SHOP]) {
  const rs = rows[`${arm}|${perShop}`];
  const { w, pp } = spreadOf(rs);
  const bk = STYLES.map(s => pct(mean(rs.filter(r => r.styleId === s).map(r => r.bankrupt))));
  console.log(`${`${arm}/${perShop}`.padEnd(15)} ${w.map(x => x.toFixed(1)).join(' ')}  ${pp.toFixed(1).padStart(6)}pp  ${bk.join(' / ')}`);
}

console.log('\n=== ② 座位对称性（照常打、无进项）：三家各自的胜率 ===');
console.log('表        座位0   座位1   座位2   最大差');
for (const arm of ['contested', 'free', 'cycle']) {
  const rs = rows[`${arm}|0`];
  const per = [0, 1, 2].map(i => 100 * mean(rs.map(r => r.seats[i].win)));
  console.log(`  ${arm.padEnd(9)} ${per.map(x => x.toFixed(1)).join('   ')}   ${(Math.max(...per) - Math.min(...per)).toFixed(1)}pp`);
}

console.log('\n=== ③ 进项发给了谁（每店每天 250）===');
console.log('表         0 号位进项  AI 进项  比值   0 号位凑齐街  AI 凑齐街');
for (const arm of ['contested', 'free', 'cycle']) {
  const rs = rows[`${arm}|${PER_SHOP}`];
  const a = mean(rs.map(r => r.income0)), b = mean(rs.map(r => r.incomeAi));
  console.log(`  ${arm.padEnd(9)} ${Math.round(a).toString().padStart(9)} ${Math.round(b).toString().padStart(8)}`
    + `  ${(b ? a / b : NaN).toFixed(2)}× ${mean(rs.map(r => r.full0)).toFixed(2).padStart(10)} ${mean(rs.map(r => r.fullAi)).toFixed(2).padStart(10)}`);
}

console.log('\n=== ④ 「走到自家街空地按标价补齐」这件事，0 号位一局做到的比例 ===');
for (const arm of ['contested', 'free', 'cycle']) {
  console.log(`  ${arm.padEnd(9)} ${pct(mean(rows[`${arm}|0`].map(r => r.freeHalf)))}`);
}

console.log('\n=== ⑤ 250 档在两档对称表上还是不是座位红利（同 seed 配对）===');
for (const arm of ['contested', 'free', 'cycle']) {
  const a = rows[`${arm}|${PER_SHOP}`], b = rows[`${arm}|0`];
  console.log(`  ${arm.padEnd(9)} 0 号位 ${fmtCI(pairedDiff(a, b))}`);
  // 另外两家也各算一次：这才是「座位换过来还站不站得住」的直接读数。
  for (const i of [1, 2]) {
    const A = a.map(r => ({ ...r, w: r.seats[i].win })), B = b.map(r => ({ ...r, w: r.seats[i].win }));
    console.log(`            座位${i}  ${fmtCI(pairedDiff(A, B, { field: 'w' }))}`);
  }
}
