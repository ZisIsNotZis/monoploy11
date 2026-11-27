// #3391：最后一种「第二条打法」候选 —— 深耕己方小店（不买书屋、不补齐街道）。
//
// 前面已量掉三条：收购 ✗、补齐整条街 ✗、封书屋 ✗；押书屋 ✓（三条起手 +10/+5/+4.2pp）。
// 若「深耕」也不行，那就可以确凿地说：**当前规则下书屋之外没有第二种打法**，
// 这不是文案问题，是结构问题（frontage-audit：书屋 29.07 次/局 vs 小店 4.26 次）。
//
// 这一臂：不买任何新地（除非 AI 自己要），worker 优先给「等级最低、在己方街上」的店，
// inflate 优先给「己方店最多」的街。也就是你把钱全部变成**自己那几间店的租金**。
//
// 用法：node support/probe-3346/deepen-plan.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buildCost, rentFor } from '../../src/engine/economy.js';

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
const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
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
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0, upgrades = 0, inflates = 0, bookBuys = 0;

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === seat0.id;

      if (arm === 'deepen' && prompt.type === 'buy' && mine && prompt.plot) {
        const id = prompt.plot.id ?? prompt.plot;
        if (id === BOOK) { bookBuys++; return false; } // 深耕：绝不买书屋
        return aiAnswer(prompt, state);
      }

      // 升级：优先等级最低的**己方小店**（书屋不在此列 —— 深耕是「把小店做大」这条路）
      const upgradable = () => seat0.properties
        .filter(x => !state.properties[x].big)
        .filter(x => state.properties[x].level >= 1 && state.properties[x].level < 3
          && state.properties[x].closed === 0
          && seat0.cash >= buildCost(state.properties[x].level + 1))
        .sort((a, b) => state.properties[a].level - state.properties[b].level)[0];

      if (arm === 'deepen' && prompt.type === 'action' && mine && (seat0.sliceCardsUsed ?? 0) < 2) {
        const w = seat0.cards.indexOf('worker');
        if (w >= 0 && upgradable()) { upgrades++; return { action: 'card', index: w }; }
      }
      if (arm === 'deepen' && prompt.type === 'target' && prompt.cardId === 'worker' && mine) {
        const ids = (prompt.plotIds ?? [])
          .filter(id => !state.properties[id].big)
          .filter(id => seat0.cash >= buildCost(state.properties[id].level + 1));
        const best = ids.sort((a, b) => state.properties[a].level - state.properties[b].level)[0];
        if (best) { upgrades++; return best; }
        return aiAnswer(prompt, state);
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
    assets: assetsOf(state, seat0), upgrades, bookBuys,
    rentEarned: seat0.sliceStats.rentEarned,
    levels: seat0.properties.map(id => state.properties[id].level).sort((a, b) => b - a).join(''),
  };
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

console.log('\n===== 深耕己方小店（不买书屋、不补齐街道，钱全变成升级）=====');
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, arm: 'deepen' }));
  const n = rows.length;
  console.log(`  ${style.padEnd(6)} 胜 ${pct(rows.filter(r => r.win).length, n).padEnd(7)}`
    + ` 破产 ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` 垫底 ${pct(rows.filter(r => r.last).length, n).padEnd(6)}`
    + ` 升级 ${mean(rows, 'upgrades').toFixed(2)} 次/局`
    + ` 收租 ${String(Math.round(mean(rows, 'rentEarned'))).padStart(5)}`
    + ` 终局资产 ${String(Math.round(mean(rows, 'assets'))).padStart(6)}`);
}
