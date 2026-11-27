// #3391q：为什么「升级小店」这条路从来不是打法 —— 先怀疑闸门，再怀疑平衡。
//
// 线索（src/engine/ai.js:95）：
//     case 'build': return p.cash >= prompt.cost + 30_000;
// 起手现金 42,000，加盖一次 5,000–10,000。也就是说**现金超过 35,000–40,000 才肯加盖**，
// 而第 4 天街心书屋要 26,000 —— 于是「升级小店」这条线在半场之前根本不会被选中，
// 这跟 yield-per-yuan（书屋 28.62 / 两格小店 16.28 / 一格小店 8.14）是两件事：
// 前者是闸门，后者是收益率。之前 #3346 的「深耕小店 take 6.7%」是被**强制**花钱量出来的，
// 没回答「如果 AI 愿意花，它值不值」。
//
// 本支：只给 0 号位换一个更愿意加盖的门（cost + slack），三家对手保持产品现状，
// 看同局胜率差。若更愿意加盖反而更差 ⇒ 这条路确实差，方向可以关掉；
// 若更好 ⇒ 挡住它的是一行阈值，不是平衡。
//
// 用法：node support/probe-3391/build-gate.mjs [60] [slack]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';
import { assertUnique, keyOf, pairedDiff, fmtCI } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 60);
const SLACK = Number(process.argv[3] ?? 8000);
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

async function play({ style, seed, order, arm }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  let decisions = 0, builds = 0, buildSpend = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      // 只改 0 号位（被量的座位）的加盖门槛；对手仍是产品现状。
      const ans = aiAnswer(prompt, state);
      // 两个臂都要计数 —— 上一版只在不臂里加，于是「现状 加盖 0.00」是**我没数**，
      // 不是「没发生」。这就是「把沉默当读数」的同一个错。
      if (prompt.type === 'build' && prompt.player?.id === seat0.id) {
        const want = arm === 'slack' ? seat0.cash >= prompt.cost + SLACK : !!ans;
        if (want) { builds++; buildSpend += prompt.cost; }
        return want;
      }
      return ans;
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const ownerOf = id => state.properties[id]?.ownerId ?? null;
  return {
    style: `${style}|${order.join('>')}`, styleId: style, seed,
    win: state.players.find(p => p.team === state.winnerTeam) === seat0 ? 1 : 0,
    bankrupt: !seat0.alive,
    builds, buildSpend,
    ownsBook: ownerOf('market') === seat0.id,
    rents: seat0.sliceStats.rentEarned,
    paid: seat0.sliceStats.rentPaid ?? 0,
    minCash: seat0.cash, assets: assetsOf(state, seat0),
  };
}

async function arm(name) {
  const rows = [];
  for (const style of STYLES) for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, arm: name }));
  return rows;
}

console.log('基线校验（产品现状）');
for (const style of STYLES) {
  const rs = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rs.push(await play({ style, seed, order, arm: 'base' }));
  const p = 100 * rate(rs);
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }
}

const base = await arm('base'), slack = await arm('slack');
assertUnique(base, 'base');
assertUnique(slack, 'slack');
const n = base.length;
console.log(`\n每臂 n=${n}；加盖门槛 cost + ${SLACK}（仅 0 号位）`);
console.log('臂      胜率    破产   加盖次数  加盖支出  收租   占书屋 n');
for (const [nm, rows] of [['现状', base], ['愿意加盖', slack]]) {
  console.log(`${nm.padEnd(7)} ${show(rows).padEnd(7)}`
    + ` ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` ${mean(rows, 'builds').toFixed(2).padStart(8)}`
    + ` ${String(Math.round(mean(rows, 'buildSpend'))).padStart(9)}`
    + ` ${String(Math.round(mean(rows, 'rents'))).padStart(5)}`
    + ` ${String(rows.filter(r => r.ownsBook).length).padStart(8)}`);
}
console.log(`\n同局配对（愿意加盖 − 现状）：${fmtCI(pairedDiff(slack, base))}`);
console.log('\n分起手：');
for (const sid of STYLES) {
  const s = slack.filter(r => r.styleId === sid), b = base.filter(r => r.styleId === sid);
  console.log(`  ${sid.padEnd(6)} n=${String(s.length).padStart(3)} 现状 ${show(b).padEnd(6)}`
    + ` 愿意加盖 ${show(s).padEnd(6)} 差 ${fmtCI(pairedDiff(s, b))}`);
}
