// #3346：如果「第二条路线」不存在，是不是因为场上只有一个值得买的资产？
//
// 已经量到的（不重测）：
//   · 买地资产中性（assetsOf 在 slice 只按 buyPrice 记），分数只由租金流向决定。
//   · 每千元期望租金：书屋 28.62 / 2 格小店 16.28 / 1 格小店 8.14（yield-per-yuan.mjs）。
//   · 缩小店价救不了补街（price.mjs：4,000/2,500 两档，补街−不花 不超过 +6.7pp，
//     起手差距反而涨到 26.7pp）。
//   · 拿掉书屋后 grow 79.4 / take 21.3 / cross 33.8（mask.mjs，n=160）：
//     书屋是**压住**不平的那一半，不是不平的来源。
//   · 只改 p.style、其它全同：49.2 / 25.8 / 19.2（style-only.mjs）——
//     AI 对自己那套卡的 ×1.3 偏好本身就在制造差距。
//
// 所以「第二条路线」缺的可能不是价钱，而是**另一个能承接现金的资产**。
// 这一支测的就是它：让 take 起手（收购卡）真的去收对手的店，而不是买空地。
// 现状里 take 的 AI 也会收购，但 reserve(state) 是 9,000（第 12 天后 3,000），
// 而收购价 = buyPrice×1.25 = 10,000/块 —— 于是「收一间对手的店」只比 reserve 高 1,000，
// 在一局 16 天里几乎总被现金闸门挡掉。
//
// 判据：拿掉 reserve 那道闸（探针里替 take 臂作答）后，
//   ① take 的胜率是否抬到 grow 附近
//   ② take 的失败方式是否变了（破产率、终局资产）
// 若抬不动，说明「收购」这条路本身不成立，下一片该动的是别的东西（不许再调价）。
//
// 用法：node support/probe-3346/second-sink.mjs [60]
import { SLICE_MAP, SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buyPrice, acquisitionPrice } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
// 基线必须跟着 n 走。这两个数都是 tools/balance-slice.mjs --opening contested 的实测：
//   --seeds 30 → 48.3 / 41.7 / 48.3（每格 60 局）
//   --seeds 60 → 49.2 / 38.3 / 45.0（每格 120 局）
// 把 30 seed 的数写死用在 60 seed 上，会得到「基线没复现」的假警报 ——
// 这一步浪费过一次时间，所以这里按 n 查表，而不是硬编码一个。
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
  120: { grow: 49.2, take: 38.3, cross: 45.0 },
};
const BASELINE = BASELINES[SEEDS * 2];
if (!BASELINE) throw new Error(`没有 n=${SEEDS * 2} 的基线；先跑 tools/balance-slice.mjs --seeds ${SEEDS} --opening contested 取数`);

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

// 一局。mode：
//   'ai'       —— 引擎原样（对照）
//   'takeover' —— 对 take 提议，只要买得起就答应（把 reserve 闸门拿掉）
// 两条分支都仍然遵守「现金不足就真买不了」这条硬规则：engine 自己会拒。
async function play({ style, seed, order, mode }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  const wanted = [style, ...order];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0, takeovers = 0, marketBuys = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      if (prompt.type === 'buy' && prompt.player?.id === seat0.id && prompt.plot) {
        if (mode === 'takeover') {
          // 只改「买不买」这一个决定，而且只在买得起时改。引擎仍会再核一次价。
          if (seat0.cash >= prompt.price) { if (prompt.plot.big) marketBuys++; return true; }
          return false;
        }
      }
      // 收购卡的 target 提示：mode=takeover 时替 take 挑最便宜的合法目标。
      if (mode === 'takeover' && prompt.type === 'target' && prompt.cardId === 'buyland') {
        const ids = prompt.plotIds ?? [];
        const best = ids.map(id => ({ id, price: acquisitionPrice(state, id) }))
          .filter(x => seat0.cash >= x.price)
          .sort((a, b) => a.price - b.price)[0];
        if (best) { takeovers++; return best.id; }
        return null;
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return { win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive, assets: assetsOf(state, seat0),
    cash: seat0.cash, takeovers, marketBuys,
    rentEarned: seat0.sliceStats.rentEarned,
    plots: seat0.properties.length };
}

try {
  setMarket(26000);
  console.log(`基线校验（n=${SEEDS * 2}/格，期望 ${STYLES.map(s => BASELINE[s]).join(' / ')}）`);
  for (const style of STYLES) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) {
      rows.push(await play({ style, seed, order, mode: 'ai' }));
    }
    const p = 100 * rows.filter(r => r.win).length / rows.length;
    const ok = Math.abs(p - BASELINE[style]) < 0.05;
    console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
    if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
  }

  console.log('\n===== 对照：引擎原样 =====');
  for (const style of STYLES) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) {
      rows.push(await play({ style, seed, order, mode: 'ai' }));
    }
    console.log(`  ${style.padEnd(6)} ${pct(rows.filter(r => r.win).length / rows.length).padEnd(7)}`
      + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
      + ` 终局资产 ${Math.round(mean(rows, 'assets'))} 现金 ${Math.round(mean(rows, 'cash'))}`
      + ` 收购 ${mean(rows, 'takeovers').toFixed(2)} 地 ${mean(rows, 'plots').toFixed(2)}`);
  }

  console.log('\n===== 拿掉 reserve 闸门：买得起就买（含收对手的店）=====');
  for (const style of STYLES) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) {
      rows.push(await play({ style, seed, order, mode: 'takeover' }));
    }
    console.log(`  ${style.padEnd(6)} ${pct(rows.filter(r => r.win).length / rows.length).padEnd(7)}`
      + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
      + ` 终局资产 ${Math.round(mean(rows, 'assets'))} 现金 ${Math.round(mean(rows, 'cash'))}`
      + ` 收购 ${mean(rows, 'takeovers').toFixed(2)} 地 ${mean(rows, 'plots').toFixed(2)}`);
  }
} finally {
  restore();
}
