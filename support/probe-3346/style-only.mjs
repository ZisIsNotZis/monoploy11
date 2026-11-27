// #3346：把「起手差距」逼到只剩一个变量 —— p.style 本身。
//
// 为什么这一支能定位：
//   · initializeSlice 用 starts[i % 3] 按**座位号**发地，而所有探针都把被量的起手
//     放在 0 号位 ⇒ 三条起手每局拿到的两块地、出发格**完全相同**。
//   · decompose.mjs 把现金(45,000)与手牌(都发 grow 那三张)抹平后，差距仍是 53–58pp。
//   所以剩下的差别只可能来自 p.style 这个字段本身。
//
// p.style 在产品里只被两处读：
//   slice-ai.js actionAnswer：`style==='grow' && ['worker','inflate']` 等 → ×1.3
//   slice-ai.js supply：      `scores[player.style] *= 1.3`
// 也就是说：**起手的强弱主要来自 AI 对「自己那一套卡」的偏好强度**，不是地形，也不是钱。
// 这条如果是真的，它是这一片最值钱的结论 —— 它说明上一片反复调价格/乘数都救不动，
// 因为被调的东西根本不是原因。
//
// 做法：开局一律按 grow 初始化（手牌、现金、座位都一样），只把 0 号位的 style
// 改掉再跑。四档：grow（对照）/ take / cross / 空（一个不存在的 style）。
// 「空」那一档是负对照：如果它和三条都不一样，说明这份量具量的是别的东西。
//
// 用法：node support/probe-3346/style-only.mjs [60]
import { SLICE_MAP, SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const AS = ['grow', 'take', 'cross', 'none'];

const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length;
const others = SLICE_STYLES.filter(s => s.id !== 'grow').map(s => s.id);
const ORDERS = [[others[0], others[1]], [others[1], others[0]]];

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

async function play(as, order, seed) {
  // 一律按 grow 开局：手牌、现金、座位、发地全都一样。
  const config = createSliceConfig({ human: false, seed, style: 'grow', sliceContestedStreets: true });
  const wanted = ['grow', ...order];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  const handBefore = seat0.cash;
  const plotsBefore = seat0.properties.join(',');
  // 只改这一个字段。现金/手牌/地都保持 grow 开局的样子，并断言它们没变。
  seat0.style = as;
  if (seat0.cash !== handBefore || seat0.properties.join(',') !== plotsBefore) throw new Error('改 style 时动了别的');
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
  for (const market of [26000, 40000]) {
    setMarket(market);
    console.log(`\n===== 书屋 ${market.toLocaleString()} · 只改 p.style · n=${SEEDS * 2}/格 =====`);
    console.log('（每局：同样的两块地、同样的出发格、同样的现金 42,000、同样的三张手牌）');
    const out = {};
    for (const as of AS) {
      const rows = [];
      for (const order of ORDERS) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play(as, order, seed));
      out[as] = rows;
      console.log(`  style=${as.padEnd(6)} 胜率 ${pct(rows.filter(r => r.win).length / rows.length).padEnd(7)}`
        + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
        + ` 终局资产 ${String(Math.round(mean(rows, 'assets'))).padStart(6)}`
        + ` 收租 ${String(Math.round(mean(rows, 'rentEarned'))).padStart(6)}`
        + ` 出牌 ${mean(rows, 'cardsPlayed').toFixed(2)}`);
    }
    const rate = k => out[k].filter(r => r.win).length / out[k].length;
    console.log(`  三条之间的差距 ${((Math.max(...AS.slice(0, 3).map(rate)) - Math.min(...AS.slice(0, 3).map(rate))) * 100).toFixed(1)}pp`);
  }
} finally {
  restore();
}
