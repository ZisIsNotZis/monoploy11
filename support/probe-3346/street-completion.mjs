// #3346b：第一屏承诺的是「买下另一半这条街就归你一个人」（src/main.js:470）。
// 而 #3346 的 takeover-arm 量的是「挑最便宜的合法目标」——那几乎从不是**补齐自己那条街**。
// 这一支只问一件事：**为了补齐一条街而收购，是不是正期望？**
//
// 为什么这可能和「随便收购」结论不同（而且 AI 现在看不见它）：
//   slice-ai.js plotTargets('buyland') 的估值是
//     net = 新店未来租金 × 1.5 + 免掉的租 − 相对成本 − 500
//   它算的是**买来的那一块**。但补齐一条街会让同一街**已经属于自己的那块**也拿到
//   同街连锁（economy.js rentFor：chain = 1 + 0.4 × (同街己方块数 − 1)），即 1.0 → 1.4，
//   **+40%**。那部分收入完全不在这条式子里。所以「AI 算得对，路是负期望」这个结论
//   只对被它算过的那种收购成立，不包括第一屏承诺的那种。
//
// 三臂（被量起手固定 0 号位，对手两种座位排列）：
//   ai        照 AI 打（基线，必须复现 tools/balance-slice.mjs --opening contested）
//   complete  手里有收购卡、且有目标能**补齐己方一条街**时，挑补齐后租金最高的那个打
//   cheapest  手里有收购卡就挑最便宜的合法目标打（= #3346 takeover-arm 的 force，作对照）
//
// 只改「怎么选」，不碰引擎、不碰价目、不碰 TUNING —— 所以它回答的是规则问题，
// 不是「改一个系数会不会更好」的问题。
//
// 用法：node support/probe-3346/street-completion.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, acquisitionPrice, buyPrice, rentFor, ownsStreet } from '../../src/engine/economy.js';
import { reachableLandings, sliceTargetIds } from '../../src/engine/insight.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
  120: { grow: 49.2, take: 38.3, cross: 45.0 },
};
const BASELINE = BASELINES[SEEDS * 2];
if (!BASELINE) throw new Error(`没有 n=${SEEDS * 2} 的基线（先加一格再跑）`);

const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length;
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

function exposureOf(state, players) {
  const exposure = new Map();
  for (const player of players) for (let steps = 1; steps <= 6; steps++) {
    const nodes = reachableLandings(state, player, steps);
    for (const id of nodes) exposure.set(id, (exposure.get(id) ?? 0) + 1 / (6 * nodes.length));
  }
  return exposure;
}

// 补齐一条街后，我自己**已经拥有**的那些块会涨多少（每次被对手踩到的增量）。
// 这是 AI 估值式里没有的那一项。
function chainUplift(state, me, street, takenId) {
  const hypothetical = { ...state, properties: { ...state.properties,
    [takenId]: { ...state.properties[takenId], ownerId: me.id, closed: 0, inflate: 0 } } };
  let perVisit = 0;
  for (const id of Object.keys(state.properties)) {
    const pr = state.properties[id];
    if (pr.street !== street || pr.ownerId !== me.id || pr.big) continue;
    perVisit += rentFor(hypothetical, id) - rentFor(state, id);
  }
  return perVisit;
}

// 补齐后那条街是否整条归我（切片每街恰好 2 块）。
function completesStreet(state, me, plotId) {
  const street = state.properties[plotId].street;
  if (state.map.plots.find(p => p.id === plotId)?.big) return false;
  const plots = state.map.plots.filter(p => p.street === street && !p.big);
  if (plots.length !== 2) return false;
  const mine = plots.filter(p => state.properties[p.id].ownerId === me.id).length;
  return mine === 1; // 再拿下这一块 = 2/2
}

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
  let decisions = 0, plays = 0, completePlays = 0, completeOffers = 0;
  // 目标屏返回 null 会让引擎回到动作屏（flow.js:211 `if (!target) continue`），
  // 于是「动作屏再选收购 → 目标屏再放弃」会无限循环。这不是引擎的缺陷，是玩家也会
  // 遇到的一屏（点取消就回上一屏）。所以本回合放弃过一次收购，就不再重复提它。
  let banKey = null;
  const turnKey = () => `${state.day}:${state.turn}`;

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === seat0.id;
      const busy = (seat0.sliceCardsUsed ?? 0) < 2;

      if (arm !== 'ai' && prompt.type === 'action' && mine && busy && banKey !== turnKey()) {
        const idx = seat0.cards.indexOf('buyland');
        const legal = sliceTargetIds(state, seat0, 'buyland')
          .filter(id => state.properties[id].ownerId !== seat0.id)
          .filter(id => seat0.cash >= acquisitionPrice(state, id));
        const completable = legal.filter(id => completesStreet(state, seat0, id));
        if (idx >= 0 && completable.length) completeOffers++;
        if (idx >= 0 && legal.length) {
          let pick = null;
          if (arm === 'complete') {
            // 补齐后「这条街每次被踩多收多少」最高者。
            pick = completable
              .map(id => ({ id, gain: chainUplift(state, seat0, state.properties[id].street, id) }))
              .sort((a, b) => b.gain - a.gain)[0]?.id ?? null;
          } else {
            pick = legal.sort((a, b) => acquisitionPrice(state, a) - acquisitionPrice(state, b))[0];
          }
          if (pick) { if (completesStreet(state, seat0, pick)) completePlays++; return { action: 'card', index: idx }; }
        }
        return aiAnswer(prompt, state);
      }
      if (arm !== 'ai' && prompt.type === 'target' && prompt.cardId === 'buyland') {
        const ids = (prompt.plotIds ?? []).filter(id => seat0.cash >= acquisitionPrice(state, id));
        if (!ids.length) return null;
        if (arm === 'cheapest') {
          const cheapest = ids.sort((a, b) => acquisitionPrice(state, a) - acquisitionPrice(state, b))[0];
          plays++; return cheapest;
        }
        const completable = ids.filter(id => completesStreet(state, seat0, id));
        if (completable.length) {
          const best = completable
            .map(id => ({ id, gain: chainUplift(state, seat0, state.properties[id].street, id) }))
            .sort((a, b) => b.gain - a.gain)[0];
          plays++; return best.id;
        }
        // 本回合没有想补的街：交回 AI 决定（不要 return null —— 那会让动作屏
        // 再问一次、再选出同一张卡，无限转圈。玩家点「取消」后是真的回到上一屏，
        // 而这里是脚本，必须给出一个**终止**的选择，所以让 AI 照常打完这张卡）。
        banKey = turnKey();
        return aiAnswer(prompt, state);
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return { win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive, assets: assetsOf(state, seat0), plays, completePlays, completeOffers,
    rentEarned: seat0.sliceStats.rentEarned, takeovers: seat0.sliceStats.takeovers ?? 0 };
}

try {
  console.log(`基线校验（n=${SEEDS * 2}/格，争街）`);
  for (const style of STYLES) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, arm: 'ai' }));
    const p = 100 * rows.filter(r => r.win).length / rows.length;
    const ok = Math.abs(p - BASELINE[style]) < 0.05;
    console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
    if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
  }

  for (const arm of ['complete', 'cheapest']) {
    console.log(`\n===== ${arm === 'complete' ? '只为补齐己方一条街而收购' : '挑最便宜的合法目标收购（对照）'} =====`);
    for (const style of STYLES) {
      const rows = [];
      for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, arm }));
      console.log(`  ${style.padEnd(6)} ${pct(rows.filter(r => r.win).length / rows.length).padEnd(7)}`
        + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
        + ` 收购 ${mean(rows, 'plays').toFixed(2)}/局 (补齐 ${mean(rows, 'completePlays').toFixed(2)})`
        + ` 补齐机会 ${mean(rows, 'completeOffers').toFixed(2)}/局`
        + ` 收租 ${Math.round(mean(rows, 'rentEarned'))}`);
    }
  }
} finally {
  // 不改编地图、价目或 TUNING，无需还原。
}
