// #3346：在「每块钱买到多少收租机会」这条判据上找一组能站住的价，再谈产品化。
//
// 前面两支已经量到（不要重测）：
//   · support/probe-3346/what-wins.mjs：书屋赢在**租金**（0.66–0.83 张卡/局，卡不是原因）。
//   · support/probe-3346/yield-per-yuan.mjs：每千元期望租金 书屋 28.62 / 2 格小店 16.28 / 1 格小店 8.14。
//   · support/probe-3346/knobs.mjs：只抬高书屋价钱会把它**从局里抹掉**（到手 0%），
//     同时把三条起手的差距拉到 57.5pp —— 因为那时唯一的路是小店，而三条起手换租金的能力不等。
//
// 所以这一支同时动两侧，扫两张价目，判据是**三条一起看**：
//   ① 起手差距（越小越好，但 0 不是目标 —— 三条打法本来就该不同）
//   ② 两个计划各自相对「不花」的差（要同一量级，否则还是一条路）
//   ③ 两个计划的**失败方式**不同：押书屋应该更容易破产/现金被锁，
//      补街应该更慢但更抗打（破产更低、终局资产更平均）
//
// 只改运行时 clone 的价目与 TUNING.bigRentMultiplier，不碰 src/。
// 用法：node support/probe-3346/grid.mjs [30]
import { SLICE_MAP, SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { TUNING } from '../../src/data/tuning.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 30);
const STYLES = ['grow', 'take', 'cross'];
const DECISION_LIMIT = 5000;

// bigRentMultiplier 在 rentFor 里只乘 big 地产；0.4 = 现状。
const VARIANTS = [];
for (const big of [0.4, 0.25, 0.15]) for (const shop of [8000, 6000]) {
  VARIANTS.push({ big, shop, label: `书屋×${big} · 小店 ${shop}` });
}

const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length;
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

const originalPrices = SLICE_MAP.plots.map(p => p.price);
const originalInit = SLICE_MAP.initialProperties.map(p => p.price);
const originalBig = TUNING.bigRentMultiplier;
function applyPrices(shop) {
  SLICE_MAP.plots.forEach(p => { p.price = p.big ? originalPrices[SLICE_MAP.plots.indexOf(p)] : shop; });
  SLICE_MAP.initialProperties.forEach(p => {
    const plot = SLICE_MAP.plots.find(x => x.id === p.plotId);
    p.price = plot.price;
  });
}
function restore() {
  SLICE_MAP.plots.forEach((p, i) => { p.price = originalPrices[i]; });
  SLICE_MAP.initialProperties.forEach((p, i) => { p.price = originalInit[i]; });
  TUNING.bigRentMultiplier = originalBig;
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
  let decisions = 0;
  await runGame(state, {
    render() {},
    async step() {},
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
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    rentEarned: seat0.sliceStats.rentEarned,
    assets: assetsOf(state, seat0),
    ownsMarket: seat0.properties.includes('market'),
    marketBuys: seat0.properties.filter(id => state.map.plots.find(p => p.id === id)?.big).length,
  };
}

try {
  for (const v of VARIANTS) {
    TUNING.bigRentMultiplier = v.big;
    applyPrices(v.shop);
    console.log(`\n########## ${v.label} ##########`);
    const rates = [];
    for (const style of STYLES) {
      const rows = [];
      for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) {
        rows.push(await play({ style, seed, order, spend: null }));
      }
      rates.push(rows.filter(r => r.win).length / rows.length);
      console.log(`  平衡 ${style.padEnd(6)} ${pct(rates[rates.length - 1])}`
        + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length)}`
        + ` 书屋到手 ${pct(rows.filter(r => r.ownsMarket).length / rows.length)}`
        + ` 收租 ${Math.round(mean(rows, 'rentEarned'))}`);
    }
    const spread = Math.max(...rates) - Math.min(...rates);
    console.log(`  起手差距 ${(spread * 100).toFixed(1)}pp`);
    let line = [];
    for (const style of STYLES) {
      const arm = {};
      for (const spend of ['none', 'fill', 'big']) {
        const rows = [];
        for (let seed = 1; seed <= SEEDS; seed++) {
          rows.push(await play({ style, seed, order: opponentOrders(style)[0], spend }));
        }
        arm[spend] = rows;
      }
      const d = (a, b) => arm[a].filter(r => r.win).length / arm[a].length - arm[b].filter(r => r.win).length / arm[b].length;
      line.push(`${style}: 补街 ${d('fill', 'none') >= 0 ? '+' : ''}${(d('fill', 'none') * 100).toFixed(1)}pp`
        + `/ 书屋 ${d('big', 'none') >= 0 ? '+' : ''}${(d('big', 'none') * 100).toFixed(1)}pp`
        + ` 破产(补/书) ${pct(arm.fill.filter(r => r.bankrupt).length / arm.fill.length)}`
        + `/${pct(arm.big.filter(r => r.bankrupt).length / arm.big.length)}`);
    }
    for (const l of line) console.log(`  ${l}`);
  }
} finally {
  restore();
}
