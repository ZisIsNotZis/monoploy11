// #3346：把「街角店主为什么强」拆成三份 —— 现金、手牌、开局位置。
//
// 上一支（mask.mjs，n=160/格）已经量到一件分量很大的事：
//   书屋 26,000（现状）：grow 51.9 / take 35.6 / cross 41.9，差距 16.3pp
//   书屋 40,000（没人买得起）：grow 79.4 / take 21.3 / cross 33.8，差距 **58.1pp**，三对全分开
// 也就是说：**书屋不是不平的来源，它是把不平压住的那一半**。把它拿走，grow 的
// 优势反而露出来。所以「第二条路线」写不出来，根子不在书屋的价，而在
// 三条起手本身 —— 三条之间有一个与决断无关的结构差。
//
// 三条起手在数据上只差三样东西（src/data/slice.js 的 SLICE_STYLES）：
//   现金 42,000 / 45,000 / 46,000 · 手牌三张 · 开局两块地（STARTS_CONTESTED）
// 这一支一次只抹平一样，看差距掉多少。抹平走的是**运行时改 clone 的 config**
// （createSliceConfig 之后覆盖），不碰 src/。
//
// 探针纪律：第 0 档必须复现 mask.mjs 在书屋 40,000 的读数（79.4/21.3/33.8，n=160）。
// 不相等就退出。n 小时允许 ±5pp 的漂移，超出就说明构造不同。
//
// 用法：node support/probe-3346/decompose.mjs [60]
import { SLICE_MAP, SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];

// 「抹平」的三档。market 固定 40,000 = 把书屋从局里拿掉，这样量的是起手本身。
const VARIANTS = [
  { key: '现状起手', flatCash: false, flatHand: false },
  { key: '现金抹平 45,000', flatCash: true, flatHand: false },
  { key: '手牌抹平（都发 grow 那三张）', flatCash: false, flatHand: true },
  { key: '现金 + 手牌都抹平', flatCash: true, flatHand: true },
];

const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length;
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

const pristinePlots = JSON.stringify(SLICE_MAP.plots);
const pristineInit = JSON.stringify(SLICE_MAP.initialProperties);
const originalStyles = SLICE_STYLES.map(s => ({ ...s, hand: [...s.hand] }));

function setMarket(price) {
  SLICE_MAP.plots.forEach(p => { if (p.big) p.price = price; });
  SLICE_MAP.initialProperties.forEach(p => {
    if (SLICE_MAP.plots.find(x => x.id === p.plotId)?.big) p.price = price;
  });
}
function flat(v) {
  SLICE_STYLES.forEach(s => {
    const src = originalStyles.find(o => o.id === s.id);
    s.cash = v.flatCash ? 45000 : src.cash;
    s.hand = v.flatHand ? [...originalStyles.find(o => o.id === 'grow').hand] : [...src.hand];
  });
}
function restore() {
  SLICE_MAP.plots.forEach((p, i) => Object.assign(p, JSON.parse(pristinePlots)[i]));
  SLICE_MAP.initialProperties.forEach((p, i) => Object.assign(p, JSON.parse(pristineInit)[i]));
  SLICE_STYLES.forEach((s, i) => { s.cash = originalStyles[i].cash; s.hand = [...originalStyles[i].hand]; });
  if (JSON.stringify(SLICE_MAP.plots) !== pristinePlots) throw new Error('还原失败');
  if (SLICE_STYLES.some((s, i) => s.cash !== originalStyles[i].cash || s.hand.join() !== originalStyles[i].hand.join())) {
    throw new Error('起手表还原失败');
  }
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
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
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
    rentEarned: seat0.sliceStats.rentEarned,
    cardsPlayed: seat0.sliceStats.cardsPlayed };
}

try {
  setMarket(40000);
  for (const v of VARIANTS) {
    flat(v);
    console.log(`\n===== ${v.key} · 书屋 40,000 · n=${SEEDS * 2}/格 =====`);
    const out = {};
    for (const style of STYLES) {
      const rows = [];
      for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play(style, order, seed));
      out[style] = rows;
      console.log(`  ${style.padEnd(6)} ${pct(rows.filter(r => r.win).length / rows.length).padEnd(7)}`
        + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
        + ` 终局资产 ${String(Math.round(mean(rows, 'assets'))).padStart(6)}`
        + ` 收租 ${String(Math.round(mean(rows, 'rentEarned'))).padStart(6)}`
        + ` 出牌 ${mean(rows, 'cardsPlayed').toFixed(2)}`);
    }
    const rate = s => out[s].filter(r => r.win).length / out[s].length;
    const spread = Math.max(...STYLES.map(rate)) - Math.min(...STYLES.map(rate));
    console.log(`  起手差距 ${(spread * 100).toFixed(1)}pp`);
  }
} finally {
  restore();
}
