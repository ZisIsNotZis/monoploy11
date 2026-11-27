// #3391：监督者要的是「一局能亲手对照的开局，让两种打算都能说出什么时候值得、会放弃什么」。
// 在做成屏幕之前，必须先回答：**这两种打算真的不同吗？**
//
// 两种打算（同一张牌桌、同一批对手、同一批 seed，只换 0 号位怎么花钱）：
//   bookhouse  押书屋：第 4 天开售就尽量凑钱买街心书屋（26,000），其余照 AI。
//   complete   补齐街：从不买书屋；把现金用于买下己方街道的另一半（8,000）+ 升级已补齐的街。
//
// 要看的不是只有胜率 —— 而是**失败方式**：
//   bookhouse 失败长什么样：现金被 26,000 抽干 → 付不起租 → 破产/中途被超。
//   complete  失败长什么样：永远差一块地 → 租金上不去 → 没破产但资产垫底（输得不响）。
// 若两者的「破产率 / 终局垫底率 / 最低现金」明显不同，那它就值得做成第一屏的对照；
// 若三条都一样，那这局没有两个打法，只有一条路和一条更差的路。
//
// 用法：node support/probe-3346/two-plans.mjs [60]
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

const BOOK_ID = 'market';
const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length;
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};
const isComplete = (state, me, street) => {
  const small = state.map.plots.filter(p => !p.big && p.street === street);
  return small.length === 2 && small.every(p => state.properties[p.id].ownerId === me.id);
};

async function play({ style, seed, order, plan }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0, minCash = seat0.cash, bookBought = false, halfBuys = 0;
  const onBook = () => seat0.properties.includes(BOOK_ID);

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === seat0.id;
      minCash = Math.min(minCash, seat0.cash);

      if (prompt.type === 'buy' && mine && prompt.plot) {
        const id = prompt.plot.id ?? prompt.plot;
        // 押书屋：书屋一开售就买（只要付得起），其他照 AI
        if (plan === 'bookhouse' && id === BOOK_ID && !onBook()) {
          if (seat0.cash >= buyPrice(state, id)) { bookBought = true; return true; }
          return false;
        }
        // 补齐街：只买己方街道的另一半
        if (plan === 'complete') {
          const small = state.map.plots.filter(p => !p.big);
          const streets = new Set(seat0.properties.map(x => state.properties[x].street));
          const plot = small.find(p => p.id === id);
          if (plot && streets.has(plot.street) && !state.properties[id].ownerId) {
            if (seat0.cash - buyPrice(state, id) >= 3000) { halfBuys++; return true; }
            return false;
          }
        }
        return aiAnswer(prompt, state);
      }

      if (plan === 'complete' && prompt.type === 'action' && mine && (seat0.sliceCardsUsed ?? 0) < 2) {
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
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const ranked = [...state.players].sort((a, b) => assetsOf(state, b) - assetsOf(state, a));
  const rank = ranked.findIndex(p => p.id === seat0.id) + 1;
  return { win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive, rank, assets: assetsOf(state, seat0), minCash,
    rentEarned: seat0.sliceStats.rentEarned, bookBought, halfBuys,
    completedStreets: [...new Set(seat0.properties.map(x => state.properties[x].street))]
      .filter(s => isComplete(state, seat0, s)).length,
    hasBook: onBook() };
}

// 先断言基线，再读变体（#3346 的教训）
console.log(`基线校验（n=${SEEDS * 2}/格，争街）`);
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, plan: 'ai' }));
  const p = 100 * rows.filter(r => r.win).length / rows.length;
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
}

for (const plan of ['bookhouse', 'complete']) {
  console.log(`\n===== ${plan === 'bookhouse' ? '押书屋（第 4 天凑钱买街心书屋）' : '补齐整条街（只买己方街的另一半 + 升级）'} =====`);
  for (const style of STYLES) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, plan }));
    if (plan === 'bookhouse' && rows.some(r => !r.bookBought) && rows.every(r => !r.bookBought)) {
      console.log(`  ${style.padEnd(6)} ⚠ 一次都没买到书屋 —— 这一格不成立`);
      continue;
    }
    console.log(`  ${style.padEnd(6)} ${pct(rows.filter(r => r.win).length / rows.length).padEnd(7)}`
      + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
      + ` 垫底 ${pct(rows.filter(r => r.rank === 3).length / rows.length).padEnd(6)}`
      + ` 最低现金 ${Math.round(mean(rows, 'minCash')).toLocaleString()}`
      + ` 收租 ${Math.round(mean(rows, 'rentEarned'))}`
      + (plan === 'bookhouse' ? ` 买到书屋 ${pct(rows.filter(r => r.bookBought).length / rows.length)}`
        : ` 补齐 ${mean(rows, 'completedStreets').toFixed(2)} 条`));
  }
}
