// #3346：能不能用**价钱**把第二条路线做出来 —— 先量，不改产品。
//
// 诊断（support/probe-3346/yield-per-yuan.mjs）：slice 里买地是**资产中性**的
// （assetsOf 只按 buyPrice 记地产，现金换地产分数当场不变），所以一块地值不值得买
// 只有一个判据：**每块钱买到多少收租机会**。现状
//   书屋 28.62 / 千元 · 2 个相邻格的小店 16.28 · 1 个相邻格的小店 8.14
// 而这块板 43 个格、16 天、3 人 ⇒ 全场合计约 48 次落点，一个「1 个相邻格」的店
// 整局平均只被踩约 1.1 次：花 8,000 换回约 3,000 租金。这就是「花钱买小店」
// 在实测里一律 -25~-31pp 的结构原因，不是系数不够大（#3344 已把同街乘数翻到 2.5 倍，
// 补齐只从 +12.5 走到 +13.8）。
//
// 租金和价钱在判据里是一比一可换的（rent/price），所以只扫价钱就能覆盖两个方向：
// 小店降价 = 提高小店的每块钱产出；书屋涨价 = 压低它自己的。
// 这是**探针**：只在运行时改 clone 出来的地图，不碰 src/，不留产品字节。
//
// 每格：
//   balance：三条起手各 60 seed × 2 座位排列（与 tools/balance-slice.mjs 同口径）
//   arms：    fill（只补己方街）/ none（不花钱）/ big（只押书屋），60 seed
//
// 用法：node support/probe-3346/knobs.mjs [60]
import { SLICE_MAP, SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const STYLES = ['grow', 'take', 'cross'];
const DECISION_LIMIT = 5000;

const VARIANTS = [
  { key: '现状', shop: 8000, market: 26000 },
  { key: '小店 4,000', shop: 4000, market: 26000 },
  { key: '小店 4,000 + 书屋 52,000', shop: 4000, market: 52000 },
  { key: '小店 2,500 + 书屋 52,000', shop: 2500, market: 52000 },
  { key: '只书屋 52,000', shop: 8000, market: 52000 },
];

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

// 价钱改在**地图的初始属性**上：createGame 会 structuredClone(SLICE_MAP)，
// buyPrice 读 pr.price，所以这就是产品里「改标价」的同一处。
const originalPlots = SLICE_MAP.plots.map(p => p.price);
const originalInit = SLICE_MAP.initialProperties.map(p => p.price);
function setPrices({ shop, market }) {
  SLICE_MAP.plots.forEach((p, i) => { p.price = p.big ? market : shop; });
  SLICE_MAP.initialProperties.forEach((p, i) => {
    const plot = SLICE_MAP.plots.find(x => x.id === p.plotId);
    p.price = plot.price;
  });
}
function restorePrices() {
  SLICE_MAP.plots.forEach((p, i) => { p.price = originalPlots[i]; });
  SLICE_MAP.initialProperties.forEach((p, i) => { p.price = originalInit[i]; });
}

async function play({ style, seed, order, spend }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  const wanted = [style, ...order];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (state.players.map(p => p.style).join(',') !== wanted.join(',')) throw new Error('SEATING MISMATCH');
  const seat0 = state.players[0];
  let decisions = 0, buys = 0, marketBuys = 0;
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
        const ok = aiAnswer(prompt, state);
        if (ok) { buys++; if (prompt.plot.big) marketBuys++; }
        return ok;
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    buys, marketBuys,
    rentEarned: seat0.sliceStats.rentEarned,
    assets: assetsOf(state, seat0),
    ownsMarket: seat0.properties.includes('market'),
  };
}

try {
  for (const v of VARIANTS) {
    setPrices(v);
    console.log(`\n########## ${v.key}（小店 ${v.shop} / 书屋 ${v.market}）##########`);
    const bal = {};
    for (const style of STYLES) {
      const rows = [];
      for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) {
        rows.push(await play({ style, seed, order, spend: null }));
      }
      bal[style] = rows;
      const wins = rows.filter(r => r.win).length;
      const [lo, hi] = wilson(wins, rows.length);
      console.log(`  平衡 ${style.padEnd(6)} ${pct(wins / rows.length).padEnd(7)} [${pct(lo)}, ${pct(hi)}]`
        + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
        + ` 买地 ${mean(rows, 'buys').toFixed(2)}（书屋 ${mean(rows, 'marketBuys').toFixed(2)}）`);
    }
    const rates = STYLES.map(s => bal[s].filter(r => r.win).length / bal[s].length);
    console.log(`  最大差距 ${((Math.max(...rates) - Math.min(...rates)) * 100).toFixed(1)}pp`);
    for (const style of STYLES) {
      const cell = {};
      for (const spend of ['none', 'fill', 'big']) {
        const rows = [];
        for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order: opponentOrders(style)[0], spend }));
        cell[spend] = rows;
        console.log(`    ${style.padEnd(6)} ${spend.padEnd(4)} ${pct(rows.filter(r => r.win).length / rows.length).padEnd(7)}`
          + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
          + ` 买地 ${mean(rows, 'buys').toFixed(2)} 书屋到手 ${pct(rows.filter(r => r.ownsMarket).length / rows.length)}`);
      }
      const delta = (a, b) => {
        const d = cell[a].filter(r => r.win).length / cell[a].length - cell[b].filter(r => r.win).length / cell[b].length;
        return `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}pp`;
      };
      console.log(`          补街−不花 = ${delta('fill', 'none')}　书屋−不花 = ${delta('big', 'none')}`);
    }
  }
} finally {
  restorePrices();
}
