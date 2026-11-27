// #3346：收购卡到底能不能当一条路线 —— 不许再靠「AI 会不会选它」间接回答。
//
// 上一支（second-sink.mjs）量到一件刺眼的事：**收购卡在真实对局里几乎不发生**。
//   actionAnswer 选它的次数：120 局里 3 次（target 提示 buyland/plot 共 3 次，
//   同一批 120 局里 worker 1,177 次、close 1,102 次、inflate 1,045 次）。
// 也就是说第一屏对「机会买家」的承诺（「看准别人养好的店，带着现金入场」）
// 在真实对局里**一次都兑现不了** —— 这正是用户说的「第二条路线」缺的那块。
//
// 这一支回答的是一个更基础的问题：**如果玩家硬要用它，它值不值？**
// 若强制使用之后胜率反而降，说明这张卡按现在的价目与 16 天的长度不成立，
// 那就不是「AI 不懂用」，而是产品承诺与规则不一致 —— 那种不一致只能改承诺或改规则。
//
// 口径：不花钱(none) / 硬用收购(force，手里有就打出、挑最便宜的合法目标) / 照 AI(ai)
// 每格 120 局（60 seed × 2 座位排列），基线必须复现 tools/balance-slice.mjs --seeds 60。
//
// 用法：node support/probe-3346/takeover-arm.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, acquisitionPrice, takeoverEligible } from '../../src/engine/economy.js';

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

async function play({ style, seed, order, arm }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  const wanted = [style, ...order];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0, plays = 0, buys = 0;
  let worthBefore = null;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === seat0.id;

      if (arm === 'none' && prompt.type === 'buy' && mine && prompt.plot) return false;

      if (arm === 'force' && prompt.type === 'action' && mine) {
        // 手里有收购卡、且此刻真有合法目标，就打它。合法与否问引擎（takeoverEligible），
        // 不在这里另写一份 —— #3333 的教训就是同一件事两份实现会漂。
        const idx = seat0.cards.indexOf('buyland');
        const legal = state.map.plots.filter(p => takeoverEligible(state, p.id)
          && purchaseOwnerIsNotMe(state, p.id, seat0)
          && seat0.cash >= acquisitionPrice(state, p.id));
        if (idx >= 0 && legal.length && (seat0.sliceCardsUsed ?? 0) < 2) {
          worthBefore = assetsOf(state, seat0);
          return { action: 'card', index: idx };
        }
        return aiAnswer(prompt, state);
      }

      if (arm === 'force' && prompt.type === 'target' && prompt.cardId === 'buyland') {
        const ids = (prompt.plotIds ?? []).filter(id => seat0.cash >= acquisitionPrice(state, id));
        const cheapest = ids.sort((a, b) => acquisitionPrice(state, a) - acquisitionPrice(state, b))[0];
        if (cheapest) { plays++; return cheapest; }
        return null;
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return { win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive, assets: assetsOf(state, seat0),
    cash: seat0.cash, plays, plots: seat0.properties.length,
    rentEarned: seat0.sliceStats.rentEarned };
}

function purchaseOwnerIsNotMe(state, id, me) {
  const pr = state.properties[id];
  return !!pr?.ownerId && pr.ownerId !== me.id;
}

try {
  console.log(`基线校验（n=${SEEDS * 2}/格）`);
  for (const style of STYLES) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) {
      rows.push(await play({ style, seed, order, arm: 'ai' }));
    }
    const p = 100 * rows.filter(r => r.win).length / rows.length;
    const ok = Math.abs(p - BASELINE[style]) < 0.05;
    console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
    if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
  }

  for (const arm of ['none', 'force']) {
    console.log(`\n===== ${arm === 'none' ? '不花钱（对照）' : '手里有收购卡就打出（硬用）'} =====`);
    for (const style of STYLES) {
      const rows = [];
      for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) {
        rows.push(await play({ style, seed, order, arm }));
      }
      console.log(`  ${style.padEnd(6)} ${pct(rows.filter(r => r.win).length / rows.length).padEnd(7)}`
        + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
        + ` 终局资产 ${Math.round(mean(rows, 'assets'))} 收购成功 ${mean(rows, 'plays').toFixed(2)}/局`
        + ` 地 ${mean(rows, 'plots').toFixed(2)}`);
    }
  }
} finally {
  // 本支不改编地图或 TUNING，无需还原。
}
