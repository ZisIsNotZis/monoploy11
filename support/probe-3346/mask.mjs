// #3346：把「书屋在掩盖一个更大的起手不平」验到大样本，才敢写进结论。
//
// bookhouse.mjs 的 30 seed 读数：书屋 26,000 → 起手差距 6.7pp；
// 书屋 40,000（没人买得起）→ **61.7pp**（grow 76.7 / take 15.0 / cross 28.3）。
// 那句话的分量太大，不能停在一格 60 局的样本上（SE≈6.5pp，61.7pp 不是噪声，
// 但「三条具体各是多少」会动）。这里用更大 n 只量这一件事。
//
// 判据：如果移除书屋后 grow 仍然显著高于另外两条（区间不重叠），
// 那么「起手差距」不是书屋造成的 —— 是**开局所有权 / 起手现金**造成的，
// 书屋只是把它压住了一部分。这决定了下一片该动哪。
//
// 用法：node support/probe-3346/mask.mjs [80]
import { SLICE_MAP, SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 80);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];

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

const pristinePlots = JSON.stringify(SLICE_MAP.plots);
const pristineInit = JSON.stringify(SLICE_MAP.initialProperties);
function setMarket(price) {
  SLICE_MAP.plots.forEach(p => { if (p.big) p.price = price; });
  SLICE_MAP.initialProperties.forEach(p => {
    if (SLICE_MAP.plots.find(x => x.id === p.plotId)?.big) p.price = price;
  });
}
function restore() {
  SLICE_MAP.plots.forEach((p, i) => Object.assign(p, JSON.parse(pristinePlots)[i]));
  SLICE_MAP.initialProperties.forEach((p, i) => Object.assign(p, JSON.parse(pristineInit)[i]));
  if (JSON.stringify(SLICE_MAP.plots) !== pristinePlots) throw new Error('还原失败');
}

async function play(style, order, seed) {
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
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return { win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive, assets: assetsOf(state, seat0),
    ownsMarket: seat0.properties.includes('market'),
    rentEarned: seat0.sliceStats.rentEarned };
}

try {
  for (const market of [26000, 40000]) {
    setMarket(market);
    console.log(`\n===== 书屋 ${market.toLocaleString()}（n=${SEEDS * 2}/格）=====`);
    const out = {};
    for (const style of STYLES) {
      const rows = [];
      for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play(style, order, seed));
      out[style] = rows;
      const w = rows.filter(r => r.win).length, n = rows.length;
      const [lo, hi] = wilson(w, n);
      console.log(`  ${style.padEnd(6)} ${pct(w / n)} [${pct(lo)}, ${pct(hi)}]`
        + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / n)}`
        + ` 书屋到手 ${pct(rows.filter(r => r.ownsMarket).length / n)}`
        + ` 终局资产 ${Math.round(mean(rows, 'assets'))}`);
    }
    const rate = s => out[s].filter(r => r.win).length / out[s].length;
    console.log(`  起手差距 ${((Math.max(...STYLES.map(rate)) - Math.min(...STYLES.map(rate))) * 100).toFixed(1)}pp`);
    for (let i = 0; i < STYLES.length; i++) for (let j = i + 1; j < STYLES.length; j++) {
      const a = wilson(out[STYLES[i]].filter(r => r.win).length, out[STYLES[i]].length);
      const b = wilson(out[STYLES[j]].filter(r => r.win).length, out[STYLES[j]].length);
      const disjoint = Math.max(a[0], b[0]) > Math.min(a[1], b[1]);
      console.log(`  ${STYLES[i]}↔${STYLES[j]} ${disjoint ? '分得开' : '区间重叠'}`);
    }
  }
} finally {
  restore();
}
