// #3346：书屋能不能从「唯一值得花的钱」变成**一个取舍**。
//
// 已量到（不重测）：
//   · 书屋赢在租金（what-wins.mjs：送卡只有 0.66–0.83 张/局）。
//   · 买地资产中性（assetsOf 在 slice 只按 buyPrice 记），所以分数只由租金流向决定。
//   · 缩小店价钱**救不了补街**（price.mjs：4,000 / 2,500 两档，补街−不花 都没超过 +6.7pp，
//     反而把起手差距从 6.7pp 拉到 26.7pp）。所以「第二条路线」不在小店价上。
//
// 这一支动书屋自己的两个量，看它是否变成一个真的取舍：
//   价钱 ↑ ⇒ 抢它要压上更多现金（失败方式：现金被锁死、付不起租）
//   租金 ↓ ⇒ 它的收益下降（失败方式：押错宝，钱花了没回来）
// 判据是**三件事一起**，缺一条都不算成功：
//   ① 押书屋相对不花还能赢（不是 0）：它是路线，不是陷阱
//   ② 补街相对不花不显著变负：第二条路线还在
//   ③ 两条路线的破产率/现金形态不同：失败方式不同
//
// 探针纪律（这条是这一片学到的）：第 0 档不动任何东西，必须逐格复现
// tools/balance-slice.mjs --seeds 30 --opening contested = 48.3 / 41.7 / 48.3，
// 不相等就退出，不印后面的格。
//
// 用法：node support/probe-3346/bookhouse.mjs [30]
import { SLICE_MAP, SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { TUNING } from '../../src/data/tuning.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 30);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINE = { grow: 48.3, take: 41.7, cross: 48.3 };

const VARIANTS = [
  { market: 26000, big: 1.6, label: '现状（书屋 26,000 · ×1.6）' },
  { market: 40000, big: 1.6, label: '书屋 40,000 · ×1.6' },
  { market: 52000, big: 1.6, label: '书屋 52,000 · ×1.6' },
  { market: 26000, big: 1.0, label: '书屋 26,000 · ×1.0' },
  { market: 40000, big: 1.0, label: '书屋 40,000 · ×1.0' },
  { market: 40000, big: 0.7, label: '书屋 40,000 · ×0.7' },
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

const pristine = JSON.stringify({
  plots: SLICE_MAP.plots, init: SLICE_MAP.initialProperties,
});
const originalBig = TUNING.bigRentMultiplier;
const originalShots = JSON.parse(pristine);

function setMarket(price, big) {
  SLICE_MAP.plots.forEach(p => { if (p.big) p.price = price; });
  SLICE_MAP.initialProperties.forEach(p => {
    if (SLICE_MAP.plots.find(x => x.id === p.plotId)?.big) p.price = price;
  });
  TUNING.bigRentMultiplier = big;
  // 断言只动了这两个东西。
  const now = { plots: SLICE_MAP.plots, init: SLICE_MAP.initialProperties };
  const strip = o => JSON.stringify(o, (k, v) => (k === 'price' ? undefined : v));
  if (strip(now) !== strip(originalShots)) throw new Error('改价时动了别的字段');
}
function restore() {
  SLICE_MAP.plots.forEach((p, i) => Object.assign(p, originalShots.plots[i]));
  SLICE_MAP.initialProperties.forEach((p, i) => Object.assign(p, originalShots.init[i]));
  TUNING.bigRentMultiplier = originalBig;
  if (JSON.stringify({ plots: SLICE_MAP.plots, init: SLICE_MAP.initialProperties }) !== pristine) {
    throw new Error('还原后地图与原图不同');
  }
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
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0, marketBuys = 0, smallBuys = 0;
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
    marketBuys, smallBuys,
    ownsMarket: seat0.properties.includes('market'),
    marketRentNow: rentFor(state, 'market'),
    rentEarned: seat0.sliceStats.rentEarned,
    assets: assetsOf(state, seat0),
    cash: seat0.cash,
  };
}

const balanceRows = async style => {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, spend: null }));
  return rows;
};
const armRows = async (style, spend) => {
  const rows = [];
  for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order: opponentOrders(style)[0], spend }));
  return rows;
};

try {
  setMarket(26000, 1.6);
  console.log(`基线校验（n=${SEEDS * 2}/格，期望 ${STYLES.map(s => BASELINE[s]).join(' / ')}）`);
  for (const style of STYLES) {
    const rows = await balanceRows(style);
    const p = 100 * rows.filter(r => r.win).length / rows.length;
    const ok = Math.abs(p - BASELINE[style]) < 0.05;
    console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
    if (!ok) { console.error('基线没复现 —— 后面的格不印，先查探针。'); process.exit(2); }
  }

  for (const v of VARIANTS) {
    setMarket(v.market, v.big);
    console.log(`\n===== ${v.label} =====`);
    const rates = [];
    for (const style of STYLES) {
      const rows = await balanceRows(style);
      const w = rows.filter(r => r.win).length / rows.length;
      rates.push(w);
      const [lo, hi] = wilson(Math.round(w * rows.length), rows.length);
      console.log(`  平衡 ${style.padEnd(6)} ${pct(w)} [${pct(lo)}, ${pct(hi)}]`
        + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length)}`
        + ` 书屋到手 ${pct(rows.filter(r => r.ownsMarket).length / rows.length).padEnd(6)}`
        + ` 收租 ${Math.round(mean(rows, 'rentEarned'))}`);
    }
    console.log(`  起手差距 ${((Math.max(...rates) - Math.min(...rates)) * 100).toFixed(1)}pp`);
    for (const style of STYLES) {
      const arms = {};
      for (const spend of ['none', 'fill', 'big']) arms[spend] = await armRows(style, spend);
      const wr = k => arms[k].filter(r => r.win).length / arms[k].length;
      const bk = k => arms[k].filter(r => r.bankrupt).length / arms[k].length;
      const sgn = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`;
      console.log(`    ${style.padEnd(6)} 补街−不花 ${sgn(wr('fill') - wr('none')).padEnd(8)}`
        + ` 书屋−不花 ${sgn(wr('big') - wr('none')).padEnd(8)}`
        + ` 不花/补街/书屋 胜率 ${pct(wr('none'))}/${pct(wr('fill'))}/${pct(wr('big'))}`
        + ` 破产 ${pct(bk('none'))}/${pct(bk('fill'))}/${pct(bk('big'))}`);
    }
  }
} finally {
  restore();
}
