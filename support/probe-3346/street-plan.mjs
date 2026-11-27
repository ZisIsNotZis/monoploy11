// #3391：第一条真正**玩家可选**的第二打法 ——「补齐整条街」。
//
// 为什么是它，不是收购：
//   half-owners.mjs 量到人类座位那两条街的另一半**都是无主空地**，按标价 8,000 就能买，
//   根本用不上收购卡（收购是 10,000 的 125% 溢价，且只对别人开着的店）。所以第一屏那句
//   「买下另一半这条街就归你一个人」在玩法上=「走过去按标价买」，是一条真实存在的路。
//   street-completion.mjs 又量到：人类座位一局其实补齐 1.10–1.17/2 条街 —— 这条路已经在
//   发生，只是没人把它当**计划**讲出来。
//
// 好处是什么（economy.js rentFor，切片每街 2 块）：
//   补齐前 chain 1.0，补齐后两块都 1.4 ⇒ 每被踩一次，两块各多收 0.4×base。
//   资产中性（assetsOf 只按 buyPrice 记），所以全部收益是**租金流**。
//   Lv1 每次 +1,600；升到 Lv3 base=8,000 ⇒ 每次 +6,400。
//
// 这一支量的就是：**把这条街当计划**（有现金就补齐、并优先升级已补齐的街）
// 是否比照 AI 打更好，以及代价是什么（现金被占住、破产率）。
//
// 两臂：
//   ai     照 AI（基线，必须复现 balance-slice --opening contested）
//   street 以「补齐整条街」为先：能买下己方街道的另一半就买；升级优先给已补齐的街
//
// 用法：node support/probe-3346/street-plan.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buyPrice, buildCost } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
  120: { grow: 49.2, take: 38.3, cross: 45.0 },
};
const BASELINE = BASELINES[SEEDS * 2];
if (!BASELINE) throw new Error(`没有 n=${SEEDS * 2} 的基线`);

const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length;
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

// 我这条街的另一半（同街、非我、小店）
function halfOfMyStreet(state, me) {
  const small = state.map.plots.filter(p => !p.big);
  const mine = new Set(me.properties);
  const streets = new Set([...mine].map(id => state.properties[id].street));
  return small.filter(p => streets.has(p.street) && !mine.has(p.id))
    .map(p => ({ plot: p, owner: state.properties[p.id].ownerId }));
}
const isComplete = (state, me, street) => {
  const small = state.map.plots.filter(p => !p.big && p.street === street);
  return small.length === 2 && small.every(p => state.properties[p.id].ownerId === me.id);
};

async function play({ style, seed, order, arm }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0, halfBuys = 0, halfOffers = 0, peakHeld = 0;

  const maybeBuyHalf = () => {
    // 只买己方街道的另一半、无主、且付得起（留 3,000 缓冲，能付一次租）
    const halves = halfOfMyStreet(state, seat0).filter(h => !h.owner);
    if (halves.length) halfOffers++;
    const target = halves
      .map(h => ({ h, cost: buyPrice(state, h.plot.id) }))
      .filter(x => seat0.cash - x.cost >= 3000)
      .sort((a, b) => a.cost - b.cost)[0];
    return target ?? null;
  };

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === seat0.id;

      if (arm === 'street' && prompt.type === 'buy' && mine && prompt.plot) {
        // 引擎在落到空地时问「买不买」。我们只在**那是己方街道的另一半**时买。
        const id = prompt.plot.id ?? prompt.plot;
        const small = state.map.plots.filter(p => !p.big);
        const streets = new Set(seat0.properties.map(x => state.properties[x].street));
        const plot = small.find(p => p.id === id);
        if (plot && streets.has(plot.street) && !state.properties[id].ownerId) {
          if (seat0.cash - buyPrice(state, id) >= 3000) { halfBuys++; return true; }
          return false;
        }
        return aiAnswer(prompt, state);
      }

      // 升级优先给「已补齐的街」
      if (arm === 'street' && prompt.type === 'action' && mine && (seat0.sliceCardsUsed ?? 0) < 2) {
        const idx = seat0.cards.indexOf('worker');
        if (idx >= 0) {
          const complete = [...new Set(seat0.properties.map(x => state.properties[x].street))]
            .filter(s => isComplete(state, seat0, s));
          if (complete.length) {
            const best = seat0.properties
              .filter(x => complete.includes(state.properties[x].street))
              .filter(x => state.properties[x].level < 3 && state.properties[x].closed === 0
                && seat0.cash >= buildCost(state.properties[x].level + 1))
              .sort((a, b) => state.properties[a].level - state.properties[b].level)[0];
            if (best) return { action: 'card', index: idx };
          }
        }
        // 有现金就顺手补齐（不必落到那块地上也能买 —— 但引擎只允许在落点买，
        // 所以这里只能靠 landing 时的 buy 询问；不额外造动作。）
      }
      return aiAnswer(prompt, state);
    },
  });
  peakHeld = Math.max(peakHeld, seat0.properties.length);
  if (!state.over) throw new Error('Engine returned before game ended');
  const completedStreets = [...new Set(seat0.properties.map(x => state.properties[x].street))]
    .filter(s => isComplete(state, seat0, s)).length;
  return { win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive, assets: assetsOf(state, seat0),
    rentEarned: seat0.sliceStats.rentEarned, halfBuys, halfOffers, completedStreets,
    cash: seat0.cash, plots: seat0.properties.length };
}

console.log(`基线校验（n=${SEEDS * 2}/格，争街）`);
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, arm: 'ai' }));
  const p = 100 * rows.filter(r => r.win).length / rows.length;
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
}

console.log('\n===== 把「补齐整条街」当计划（买己方街道的另一半 + 升级已补齐的街）=====');
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, arm: 'street' }));
  console.log(`  ${style.padEnd(6)} ${pct(rows.filter(r => r.win).length / rows.length).padEnd(7)}`
    + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
    + ` 补齐成交 ${mean(rows, 'halfBuys').toFixed(2)}/局 (机会 ${mean(rows, 'halfOffers').toFixed(2)})`
    + ` 终局整街 ${mean(rows, 'completedStreets').toFixed(2)} 条`
    + ` 收租 ${Math.round(mean(rows, 'rentEarned'))} 终局现金 ${Math.round(mean(rows, 'cash'))}`);
}
