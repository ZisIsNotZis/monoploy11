// #3391：两种打算要能「说得出什么时候值得、会放弃什么」，所以必须有**照常打**这一组对照，
// 而且要真的互斥。
//
// 上一支（two-plans.mjs）有两个缺陷，这一支修掉：
//   1. `complete` 臂只拦「己方街道的另一半」这一种买地，别的买地询问都交给 AI ——
//      于是它照样会买街心书屋（买到 40–55%）。两臂没有互斥，比的不是两种打算。
//      现在 `complete` 明确**拒绝书屋**。
//   2. 没有「照常打」那一组的 破产/垫底/最低现金，所以「付出的代价」无从对照。
//
// 三臂（同一 seed、同一批对手，只换 0 号位怎么花钱）：
//   ai        照常打（对照）
//   book      押书屋：书屋一开售就凑钱买；其余照 AI
//   complete  补齐街：只买己方街道的另一半（留 3,000 缓冲），**不买书屋**；升级优先给已补齐的街
//
// 失败方式（这才是「会放弃什么」）：
//   破产率 = 输得响；垫底率 = 没破产但资产垫底（输得安静）；最低现金 = 现金被占住的代价。
//
// 用法：node support/probe-3346/plans-vs-control.mjs [60]
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

const BOOK = 'market';
const BUFFER = 3000;
const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};
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
  let decisions = 0, minCash = seat0.cash;

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === seat0.id;
      minCash = Math.min(minCash, seat0.cash);

      if (arm !== 'ai' && prompt.type === 'buy' && mine && prompt.plot) {
        const id = prompt.plot.id ?? prompt.plot;
        if (id === BOOK) {
          if (arm === 'book') {
            // 押书屋：付得起就买（这正是它放弃的东西：现金）
            return seat0.cash >= buyPrice(state, id);
          }
          return false; // 补齐街：不买书屋
        }
        if (arm === 'complete') {
          const small = state.map.plots.filter(p => !p.big);
          const streets = new Set(seat0.properties.map(x => state.properties[x].street));
          const plot = small.find(p => p.id === id);
          if (plot && streets.has(plot.street) && !state.properties[id].ownerId) {
            return seat0.cash - buyPrice(state, id) >= BUFFER;
          }
          // 补齐街：别的空地也不买 —— AI 见空地就买会把道路线拉宽，那就不是「补齐一条街」了
          return false;
        }
        return aiAnswer(prompt, state);
      }

      if (arm === 'complete' && prompt.type === 'action' && mine && (seat0.sliceCardsUsed ?? 0) < 2) {
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
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    last: ranked[ranked.length - 1].id === seat0.id,
    assets: assetsOf(state, seat0), minCash,
    rentEarned: seat0.sliceStats.rentEarned,
    hasBook: seat0.properties.includes(BOOK),
    completed: [...new Set(seat0.properties.map(x => state.properties[x].street))]
      .filter(s => isComplete(state, seat0, s)).length,
  };
}

// 先断言基线，再读变体
console.log(`基线校验（n=${SEEDS * 2}/格，争街）`);
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, arm: 'ai' }));
  const p = 100 * rows.filter(r => r.win).length / rows.length;
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
}

const LABEL = { ai: '照常打（对照）', book: '押书屋（不补齐）', complete: '补齐整条街（不买书屋）' };
for (const arm of ['ai', 'book', 'complete']) {
  console.log(`\n===== ${LABEL[arm]} =====`);
  for (const style of STYLES) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, arm }));
    const n = rows.length, w = rows.filter(r => r.win).length;
    console.log(`  ${style.padEnd(6)} 胜 ${pct(w, n).padEnd(7)}`
      + ` 破产 ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
      + ` 垫底 ${pct(rows.filter(r => r.last).length, n).padEnd(6)}`
      + ` 最低现金 ${Math.round(mean(rows, 'minCash')).toLocaleString().padStart(7)}`
      + ` 收租 ${String(Math.round(mean(rows, 'rentEarned'))).padStart(5)}`
      + ` 终局资产 ${String(Math.round(mean(rows, 'assets'))).padStart(6)}`
      + ` 书屋持有 ${pct(rows.filter(r => r.hasBook).length, n).padEnd(6)}`
      + ` 整街 ${mean(rows, 'completed').toFixed(2)}`);
  }
}
