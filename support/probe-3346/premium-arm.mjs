// #3346：溢价降到某一档之后，收购卡会不会真的被用起来、并成为一条路线？
//
// 背景（不许改写）：net-why.mjs 量到 985 个合法收购候选里 net>0 的 **0 个**，
// 均值 net −4374，其中「相对成本」（溢价×2）5,299 远大于「未来收入」903。
// 所以在现在的 1.25 溢价下，AI 正确地判定这张卡不划算 —— 这不是 bug，是设计。
//
// 这一支只回答两个问题：
//   ① 溢价降到多少，AI 才真的开始用它（发生次数从 0 变正）
//   ② 真用起来之后，take 的胜率会不会抬到 grow 附近，且失败方式不同（破产率）
// 若溢价降到 1.00（原价转手，原主人不赚）仍然抬不动，那「收购路线」缺的就不是价钱，
// 而是「16 天里收回一家店」这件事本身在 43 格的地图上不成立 —— 那是地图/天数的事。
//
// 基线必须复现 tools/balance-slice.mjs --seeds 60 --opening contested = 49.2/38.3/45.0。
//
// 用法：node support/probe-3346/premium-arm.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, acquisitionPrice } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
  120: { grow: 49.2, take: 38.3, cross: 45.0 },
};
const BASELINE = BASELINES[SEEDS * 2];

const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length;
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

async function play({ style, seed, order }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  const wanted = [style, ...order];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0, offers = 0, chosen = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      if (prompt.type === 'action' && prompt.player?.id === seat0.id) {
        const before = seat0.cards.slice();
        const ans = aiAnswer(prompt, state);
        if (ans.action === 'card' && before[ans.index] === 'buyland') chosen++;
        return ans;
      }
      if (prompt.type === 'target' && prompt.cardId === 'buyland') {
        offers++;
        return aiAnswer(prompt, state);
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return { win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive, assets: assetsOf(state, seat0),
    cash: seat0.cash, chosen, offers,
    plots: seat0.properties.length, rentEarned: seat0.sliceStats.rentEarned };
}

// 基线**只**在出厂溢价上校验：改了溢价当然会改变胜率，拿同一张基线去咬每一档
// 会把「这个档真的不一样」读成「探针坏了」。这一点我第一版写错了，白跑一轮。
const isShipped = /^const TAKEOVER_PREMIUM = 1\.25;/m.test(
  await (await import('node:fs/promises')).readFile(new URL('../../src/engine/economy.js', import.meta.url), 'utf8'));
const measured = {};
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order }));
  measured[style] = rows;
}
if (isShipped) {
  console.log(`基线校验（出厂溢价 ×1.25，n=${SEEDS * 2}/格）`);
  let ok = true;
  for (const style of STYLES) {
    const p = 100 * measured[style].filter(r => r.win).length / measured[style].length;
    const good = Math.abs(p - BASELINE[style]) < 0.05;
    if (!good) ok = false;
    console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${good ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  }
  if (!ok) { console.error('基线没复现 —— 探针坏了。'); process.exit(2); }
} else {
  console.log(`（溢价不是出厂的 1.25，跳过基线校验；这是被测的那一档）`);
}

console.log('\n（同一档溢价下三条起手）');
for (const style of STYLES) {
  const rows = measured[style];
  console.log(`  ${style.padEnd(6)} ${pct(rows.filter(r => r.win).length / rows.length).padEnd(7)}`
    + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
    + ` 收购打出 ${mean(rows, 'chosen').toFixed(2)} 次/局（目标屏 ${mean(rows, 'offers').toFixed(2)}）`
    + ` 地 ${mean(rows, 'plots').toFixed(2)} 终局资产 ${Math.round(mean(rows, 'assets'))}`);
}
