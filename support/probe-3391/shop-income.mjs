// #3391r：让**小店**有一条不依赖对手骰子的收入 —— 这是 supervisor 要的方向。
//
// 为什么之前的「养店」不成立（两条都量过，别再猜）：
//   · 加盖（把店升级）：放松门槛只 −0.3pp [−1.7, 0.8]，而且现状本来就每局加盖 1.18 次
//     ⇒ 不是被闸门挡住，是**小店本身没有独立收入**。
//   · 补街（买同街另一半）：更差（#3346）。
// 结构性原因（本片反复验证）：小店的收入 = 对手踩到它时付的租，而对手的落点由骰子决定。
// 街心书屋有 8 个贴边路口，小店平均 1–2 个 ⇒ 收租机会差 4–6 倍。
// 「把钱换成贴边路口最多的大地块」因此永远最优，支出只有一种用途，就不可能有第二种打算。
//
// 于是要补的不是系数，是**收入的来源**：给「同一条街上开满 2 间小店」一个每天结算的营业进项，
// 让它跟骰子无关。这样两条路各有条件与代价：
//   · 抢书屋：一次付 26,000，第 4 天，收入靠对手路过（高方差、高上限）
//   · 开小店：先凑齐一条街（8,000×2 + 加盖），收入是**每天固定**的（低方差、要熬）
//
// 本探针只做**规则模拟**（不改 src）：每天开局前给每位玩家按「己方满街小店」发营业进项。
// 参数：每间满级(Lv.1)小店每天 700；同街第 2 间起同街乘数照旧作用于租金但不作用于营业。
// 三家一视同仁 —— 这不是给某个起手开后门，是改收入结构。
//
// 用法：node support/probe-3391/shop-income.mjs [60] [perShop]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buyPrice } from '../../src/engine/economy.js';
import { assertUnique, keyOf, pairedDiff, fmtCI } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 60);
const PER_SHOP = Number(process.argv[3] ?? 700);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
  120: { grow: 49.2, take: 38.3, cross: 45.0 },
};
const BASELINE = BASELINES[SEEDS * 2];
if (!BASELINE) throw new Error(`没有 n=${SEEDS * 2} 的基线`);

const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const rate = xs => (xs.length ? xs.reduce((s, r) => s + (r.win ? 1 : 0), 0) / xs.length : 0);
const show = rows => pct(rate(rows) * rows.length, rows.length);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

// 一条街上「己方已开张的小店」间数。大建筑不算 —— 那是书屋那条路。
function shopsOnStreet(state, p, street) {
  return p.properties.filter(id => {
    const pr = state.properties[id];
    return pr && !pr.big && pr.street === street && pr.level > 0 && pr.closed <= 0;
  }).length;
}

// 营业进项：必须**拥有那条街的全部小店**（「整条街是你的」才是条件），
// 每间每天 PER_SHOP，按等级线性（Lv.1 = 1×，Lv.3 = 3×）。
// 这是「小店自己的理由」：不靠对手踩到才收得到。
function dailyIncome(state, p) {
  // 每条街上「全部小店」，用来判断是否整条街归我。
  const streetShops = new Map();
  for (const pl of state.map.plots) {
    if (pl.big) continue;
    const cur = streetShops.get(pl.street) ?? [];
    cur.push(pl.id);
    streetShops.set(pl.street, cur);
  }
  let total = 0;
  for (const [street, ids] of streetShops) {
    // 条件：这条街每一间小店都是我的、都开着张。少一间就没有营业进项。
    const mine = ids.every(id => {
      const pr = state.properties[id];
      return pr && pr.ownerId === p.id && pr.level > 0 && pr.closed <= 0;
    });
    if (!mine) continue;
    for (const id of ids) total += PER_SHOP * Math.max(1, state.properties[id].level);
  }
  return total;
}

async function play({ style, seed, order, arm, withIncome }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  // #3391s：改用**引擎里的规则**（flow.js settleStreetBusiness），不再在探针里自己发钱。
  // 为什么改：探针自己发钱只能证明「如果我发钱会怎样」；要能让人亲手玩，规则必须在引擎里。
  // config.streetBusinessPerShop = 0 时引擎什么都不做，所以「现状」臂仍是产品原样。
  state.config.streetBusinessPerShop = withIncome ? PER_SHOP : 0;
  const seat0 = state.players[0];
  let decisions = 0, minCash = seat0.cash, income = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      minCash = Math.min(minCash, seat0.cash);
      minCash = Math.min(minCash, seat0.cash);
      const mine = prompt.player?.id === seat0.id;
      if (prompt.type === 'buy' && mine) {
        const id = prompt.plot?.id ?? prompt.plot;
        const price = prompt.price ?? buyPrice(state, id);
        const ok = seat0.cash >= price;
        if (arm === 'book') {                       // 只要书屋
          if (id === 'market') return ok;
          if (state.map.plots.find(p => p.id === id)?.big) return false;
        }
        if (arm === 'shops') {                      // 只要小店（从不买书屋）
          if (id === 'market') return false;
        }
        if (arm === 'bookOnly') {                   // 只要书屋（不买任何小店）
          // 上一版这里漏了：两条臂都买小店 ⇒ 两臂都拿到营业进项，进项互相抵消，
          // 于是「小店路 − 书屋路」量到的是「两条都走」，不是取舍。
          const pl = prompt.plot?.big !== undefined ? prompt.plot : state.map.plots.find(p => p.id === id);
          if (!pl?.big) return false;
        }
      }
      if (prompt.type === 'build' && arm === 'bookOnly') return false;
      if (prompt.type === 'build' && arm === 'shops' && prompt.player?.id === seat0.id) {
        return seat0.cash >= prompt.cost + 2_000;    // 小店路线愿意加盖
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const ownsBook = state.properties.market?.ownerId === seat0.id;
  const shops = state.players[0].properties.filter(id => {
    const pr = state.properties[id];
    return pr && !pr.big && pr.level > 0;
  }).length;
  return {
    style: `${style}|${order.join('>')}`, styleId: style, seed,
    win: state.players.find(p => p.team === state.winnerTeam) === seat0 ? 1 : 0,
    bankrupt: !seat0.alive,
    ownsBook, shops, income: seat0.sliceStats.business ?? 0,
    rents: seat0.sliceStats.rentEarned,
    paid: seat0.sliceStats.rentPaid ?? 0,
    minCash, assets: assetsOf(state, seat0),
  };
}

async function arm(name, withIncome) {
  const rows = [];
  for (const style of STYLES) for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, arm: name, withIncome }));
  return rows;
}

console.log('基线校验（产品现状，不加营业进项）');
for (const style of STYLES) {
  const rs = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rs.push(await play({ style, seed, order, arm: 'ai', withIncome: false }));
  const p = 100 * rate(rs);
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }
}

const plain = await arm('ai', false);
const withInc = await arm('ai', true);
const bookArm = await arm('bookOnly', true);
const shopArm = await arm('shops', true);
for (const [k, v] of Object.entries({ plain, withInc, bookArm, shopArm })) assertUnique(v, k);
const n = plain.length;

console.log(`\n每臂 n=${n}；营业进项 ${PER_SHOP}/店/天，条件=同街己方 ≥2 间小店`);
console.log('臂            胜率    破产   店铺数  营业进项  收租   最低现金  占书屋 n');
for (const [nm, rows] of [['现状(无进项)', plain], ['加进项·照常打', withInc],
  ['加进项·只买小店', shopArm], ['加进项·只要书屋(不买小店)', bookArm]] ) {
  console.log(`${nm.padEnd(13)} ${show(rows).padEnd(7)}`
    + ` ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` ${mean(rows, 'shops').toFixed(2).padStart(7)}`
    + ` ${String(Math.round(mean(rows, 'income'))).padStart(8)}`
    + ` ${String(Math.round(mean(rows, 'rents'))).padStart(5)}`
    + ` ${String(Math.round(mean(rows, 'minCash'))).padStart(8)}`
    + ` ${String(rows.filter(r => r.ownsBook).length).padStart(8)}`);
}

// 断言：进项真的发出了（否则「加进项」是空臂），且不是只给某个起手。
const incTotal = withInc.reduce((s, r) => s + r.income, 0);
console.log(`\n进项确实发出：总计 ${incTotal}（平均每局 ${Math.round(incTotal / n)}）`);
if (incTotal === 0) throw new Error('营业进项一次都没发 —— 这条是空臂，不许印结论');

// 关键问题：两条路是否各有理由 —— 在「只买小店」与「只要书屋」之间比。
const bookByKey = new Map(bookArm.map(r => [keyOf(r), r]));
const pairs = shopArm.map(s => ({ s, b: bookByKey.get(keyOf(s)), sid: s.styleId })).filter(x => x.b);
if (!pairs.length) throw new Error('两条路没有配上的局');
console.log(`\n=== 小店路 − 书屋路（同一局配对，n=${pairs.length}）===`);
console.log(`  小店路 ${show(pairs.map(x => x.s))} vs 书屋路 ${show(pairs.map(x => x.b))}`);
console.log(`  差 ${fmtCI(pairedDiff(pairs.map(x => x.s), pairs.map(x => x.b)))}`);
console.log('\n分起手：');
for (const sid of STYLES) {
  const g = pairs.filter(x => x.sid === sid);
  if (!g.length) continue;
  console.log(`  ${sid.padEnd(6)} n=${String(g.length).padStart(3)}`
    + ` 小店 ${show(g.map(x => x.s)).padEnd(6)} 书屋 ${show(g.map(x => x.b)).padEnd(6)}`
    + ` 差 ${fmtCI(pairedDiff(g.map(x => x.s), g.map(x => x.b)))}`);
}

console.log('\n=== 进项对「照常打」的整体影响 ===');
console.log(`  加进项 − 现状 ${fmtCI(pairedDiff(withInc, plain))}`);
const spread = k => {
  const rows = k === 'plain' ? plain : withInc;
  const w = STYLES.map(s => rate(rows.filter(r => r.styleId === s)));
  return 100 * (Math.max(...w) - Math.min(...w));
};
console.log(`  三起手差距：现状 ${spread('plain').toFixed(1)}pp → 加进项 ${spread('inc').toFixed(1)}pp`);

console.log('\n=== 失败方式（输的局）===');
for (const [nm, rows] of [['照常+进项', withInc], ['只买小店', shopArm], ['只要书屋', bookArm]]) {
  const lost = rows.filter(r => !r.win);
  console.log(`  ${nm.padEnd(8)} n=${String(lost.length).padStart(3)}`
    + ` 破产 ${pct(lost.filter(r => r.bankrupt).length, lost.length).padEnd(6)}`
    + ` 最低现金 ${String(Math.round(mean(lost, 'minCash'))).padStart(6)}`
    + ` 营业 ${String(Math.round(mean(lost, 'income'))).padStart(5)}`
    + ` 收租 ${String(Math.round(mean(lost, 'rents'))).padStart(5)}`);
}
