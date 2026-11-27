// #3346：只用「先复现已知数」的探针量价钱。
//
// 为什么这一支重写（而不是继续用 knobs.mjs / grid.mjs）：
// 那两个探针在「现状」那一档就印出了与权威量具不同的数（grid：grow 63.3%，
// 而 tools/balance-slice.mjs 是 48.3%）。它们内部自洽、跨局也可复现
// （support/probe-3346/isolation.mjs 证明逐局指纹逐位相同），所以问题在构造，
// 不是引擎。在任何解释之前，一支探针必须先**复现一个已知数**。
//
// 本支的硬约束：
//   ① 第 0 档必须是「不动任何东西」，并断言与 tools/balance-slice.mjs 的读数逐格相等
//      （默认 n=30 时是 48.3 / 41.7 / 48.3）。不等就直接退出，不印后面的格。
//   ② 每个变体只在 createGame 会 structuredClone 的那份地图上改价钱，
//      并且在 finally 里还原；改完立刻断言「除了价，其它字段逐位相同」。
//   ③ 判据不是「谁强」，而是**两个计划相对不花钱的差是否同一量级**，
//      以及它们失败的方式是否不同。差值只在这个 n 上有意义，全部印出区间。
//
// 判据背景（前几支量到的，不重测）：
//   · 买地是资产中性的（assetsOf 在 slice 只按 buyPrice 记），所以买什么只由
//     「每块钱买到多少收租机会」决定。
//   · 现状（yield-per-yuan.mjs）：书屋 28.62/千元 · 2 格小店 16.28 · 1 格小店 8.14。
//   · 书屋赢在租金而不是卡（what-wins.mjs：0.66–0.83 张卡/局）。
// 所以唯一在判据上有意思的旋钮是**价钱**：把 1 格小店的每千元产出抬上来。
//
// 用法：node support/probe-3346/price.mjs [30]
import { SLICE_MAP, SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 30);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINE = { grow: 48.3, take: 41.7, cross: 48.3 };   // tools/balance-slice.mjs --seeds 30 --opening contested

const wilson = (wins, n) => {
  const z = 1.96, p = wins / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length;
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

const snapshot = () => JSON.stringify({
  plots: SLICE_MAP.plots.map(p => ({ ...p })),
  init: SLICE_MAP.initialProperties.map(p => ({ ...p })),
});
const pristine = snapshot();

function setShopPrice(shop) {
  SLICE_MAP.plots.forEach(p => { p.price = p.big ? 26000 : shop; });
  SLICE_MAP.initialProperties.forEach(p => { p.price = SLICE_MAP.plots.find(x => x.id === p.plotId).price; });
  // 断言：只有 price 变了。
  const before = JSON.parse(pristine), after = JSON.parse(snapshot());
  const strip = o => JSON.stringify(o, (k, v) => (k === 'price' ? undefined : v));
  if (strip(before) !== strip(after)) throw new Error('改价时动了别的字段');
}
function restore() {
  const s = JSON.parse(pristine);
  SLICE_MAP.plots.forEach((p, i) => Object.assign(p, s.plots[i]));
  SLICE_MAP.initialProperties.forEach((p, i) => Object.assign(p, s.init[i]));
  if (snapshot() !== pristine) throw new Error('还原后地图与原图不同');
}

async function play({ style, seed, order, spend }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  const wanted = [style, ...order];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  let decisions = 0, smallBuys = 0, marketBuys = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      if (prompt.type === 'buy' && prompt.player?.id === seat0.id && prompt.plot) {
        if (spend === 'none') return false;
        if (spend === 'fill') {
          const mineOnStreet = state.map.plots.some(x => x.id !== prompt.plot.id && !x.big
            && x.street === prompt.plot.street && state.properties[x.id]?.ownerId === seat0.id);
          if (prompt.plot.big || !mineOnStreet) return false;
        }
        if (spend === 'big' && !prompt.plot.big) return false;
        const ok = aiAnswer(prompt, state);
        if (ok) { if (prompt.plot.big) marketBuys++; else smallBuys++; }
        return ok;
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    smallBuys, marketBuys,
    rentEarned: seat0.sliceStats.rentEarned,
    cash: seat0.cash,
    assets: assetsOf(state, seat0),
    ownsMarket: seat0.properties.includes('market'),
  };
}

async function balanceRows(style) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) {
    rows.push(await play({ style, seed, order, spend: null }));
  }
  return rows;
}
async function armRows(style, spend) {
  const rows = [];
  for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order: opponentOrders(style)[0], spend }));
  return rows;
}

try {
  // ① 第 0 档：不动任何东西，必须复现权威量具。
  setShopPrice(8000);
  console.log(`基线校验（n=${SEEDS * 2}/格，期望 ${STYLES.map(s => BASELINE[s]).join(' / ')}）`);
  const base = {};
  for (const style of STYLES) {
    base[style] = await balanceRows(style);
    const p = 100 * base[style].filter(r => r.win).length / base[style].length;
    const ok = Math.abs(p - BASELINE[style]) < 0.05;
    console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
    if (!ok) { console.error('基线没复现 —— 后面的格不印，先查探针。'); process.exit(2); }
  }
  const baseArms = {};
  for (const style of STYLES) {
    baseArms[style] = {};
    for (const spend of ['none', 'fill', 'big']) baseArms[style][spend] = await armRows(style, spend);
  }

  for (const shop of [8000, 4000, 2500]) {
    setShopPrice(shop);
    console.log(`\n===== 小店价钱 ${shop}（书屋 26,000 不动）=====`);
    const rates = [];
    for (const style of STYLES) {
      const rows = await balanceRows(style);
      const w = rows.filter(r => r.win).length / rows.length;
      rates.push(w);
      const [lo, hi] = wilson(Math.round(w * rows.length), rows.length);
      console.log(`  平衡 ${style.padEnd(6)} ${pct(w)} [${pct(lo)}, ${pct(hi)}]`
        + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length)}`
        + ` 买小店 ${mean(rows, 'smallBuys').toFixed(2)} 书屋到手 ${pct(rows.filter(r => r.ownsMarket).length / rows.length)}`
        + ` 收租 ${Math.round(mean(rows, 'rentEarned'))}`);
    }
    console.log(`  起手差距 ${((Math.max(...rates) - Math.min(...rates)) * 100).toFixed(1)}pp`);
    for (const style of STYLES) {
      const arms = {};
      for (const spend of ['none', 'fill', 'big']) arms[spend] = await armRows(style, spend);
      const wr = k => arms[k].filter(r => r.win).length / arms[k].length;
      const d = (a, b) => `${wr(a) >= wr(b) ? '+' : ''}${((wr(a) - wr(b)) * 100).toFixed(1)}pp`;
      console.log(`    ${style.padEnd(6)} 补街−不花 ${d('fill', 'none').padEnd(8)} 书屋−不花 ${d('big', 'none').padEnd(8)}`
        + ` 破产 补/书 ${pct(arms.fill.filter(r => r.bankrupt).length / arms.fill.length)}/${pct(arms.big.filter(r => r.bankrupt).length / arms.big.length)}`
        + ` 现金 补/书 ${Math.round(mean(arms.fill, 'cash'))}/${Math.round(mean(arms.big, 'cash'))}`);
    }
  }
} finally {
  restore();
}
