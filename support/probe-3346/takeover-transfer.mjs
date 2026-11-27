// #3346b：收购为什么在切片里是负期望 —— 看**成交那一刻**的账。
//
// assetsOf（economy.js:160）在切片里只按 buyPrice 记地产，不含加盖价值。
// 而收购价是 buyPrice × 1.25（economy.js:78）。于是同一块地：
//   买方 现金 −12,500，资产 +10,000  ⇒ 资产 −2,500（= 溢价，凭空消失）
//   卖方 现金 +12,500，资产 −10,000  ⇒ 资产 +2,500（= 溢价，凭空出现）
// 也就是说收购不是「投资」，是一次**定向转移**：买方把自己的资产搬给对手，还替对手
// 承担了风险。这在 3 人局里尤其糟 —— 你花钱让其中一个对手更接近终点。
//
// 这一支不改规则，只在对局里量每一次收购前后，买卖双方 assetsOf 的实际变化。
// 若实测 ≈ 上述代数，则「靠收购补齐一条街」的负期望就与 AI 是否聪明无关：
// 它是账本本身的结构。
//
// 用法：node support/probe-3346/takeover-transfer.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, acquisitionPrice, buyPrice } from '../../src/engine/economy.js';
import { sliceTargetIds } from '../../src/engine/insight.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const rows = [];

// 让 0 号位（人类座位）主动收购，好让样本集中在真实成交上。
async function play(style, seed) {
  const others = SLICE_STYLES.filter(s => s.id !== style).map(s => s.id);
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...others].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const me = state.players[0];
  let decisions = 0, pending = null, banKey = null;
  const turnKey = () => `${state.day}:${state.turn}`;

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === me.id;
      if (prompt.type === 'action' && mine && (me.sliceCardsUsed ?? 0) < 2 && banKey !== turnKey()) {
        const idx = me.cards.indexOf('buyland');
        const legal = sliceTargetIds(state, me, 'buyland').filter(id => me.cash >= acquisitionPrice(state, id));
        if (idx >= 0 && legal.length) {
          const pick = legal.sort((a, b) => acquisitionPrice(state, a) - acquisitionPrice(state, b))[0];
          pending = { plotId: pick, sellerId: state.properties[pick].ownerId,
            meBefore: assetsOf(state, me),
            sellerBefore: assetsOf(state, state.players.find(p => p.id === state.properties[pick].ownerId)),
            cashBefore: me.cash, price: acquisitionPrice(state, pick), mark: buyPrice(state, pick), day: state.day };
          return { action: 'card', index: idx };
        }
        return aiAnswer(prompt, state);
      }
      if (prompt.type === 'target' && prompt.cardId === 'buyland' && mine) {
        const ids = (prompt.plotIds ?? []).filter(id => me.cash >= acquisitionPrice(state, id));
        if (!ids.length) { banKey = turnKey(); return aiAnswer(prompt, state); }
        const cheapest = ids.sort((a, b) => acquisitionPrice(state, a) - acquisitionPrice(state, b))[0];
        return cheapest;
      }
      return aiAnswer(prompt, state);
    },
  });

  // 终局再核一次：pending 里记的是成交前，这里用终局无法回溯，所以改在每一步结算后读。
  // （见下：step 里在 pending 存在且现金已变时收账）
  return pending;
}

// 更可靠的做法：不用 step 时机，改为「下一回合开始时」把上一笔 pending 结账。
// 这里直接用一个包装：每局结束后重新跑一遍同样 seed，但在 ask 里检测成交。
async function playMeasured(style, seed) {
  const others = SLICE_STYLES.filter(s => s.id !== style).map(s => s.id);
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...others].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const me = state.players[0];
  let decisions = 0, arm = null, banKey = null;
  const turnKey = () => `${state.day}:${state.turn}`;
  const out = [];

  const snapshot = () => Object.fromEntries(state.players.map(p => [p.id, assetsOf(state, p)]));

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === me.id;
      // 每次询问前先看：上一笔收购是否已经结算（现金变了）
      if (arm && me.cash !== arm.cashBefore) {
        const seller = state.players.find(p => p.id === arm.sellerId);
        const now = snapshot();
        out.push({ ...arm,
          meAfter: now[me.id], sellerAfter: seller ? now[seller.id] : null,
          meDelta: now[me.id] - arm.meBefore, sellerDelta: seller ? now[seller.id] - arm.sellerBefore : null,
          ownerNow: state.properties[arm.plotId].ownerId });
        arm = null;
      }
      if (prompt.type === 'action' && mine && (me.sliceCardsUsed ?? 0) < 2 && banKey !== turnKey()) {
        const idx = me.cards.indexOf('buyland');
        const legal = sliceTargetIds(state, me, 'buyland').filter(id => me.cash >= acquisitionPrice(state, id));
        if (idx >= 0 && legal.length) {
          const pick = legal.sort((a, b) => acquisitionPrice(state, a) - acquisitionPrice(state, b))[0];
          const sellerId = state.properties[pick].ownerId;
          arm = { plotId: pick, sellerId, meBefore: assetsOf(state, me),
            sellerBefore: assetsOf(state, state.players.find(p => p.id === sellerId)),
            cashBefore: me.cash, price: acquisitionPrice(state, pick), mark: buyPrice(state, pick), day: state.day };
          return { action: 'card', index: idx };
        }
        return aiAnswer(prompt, state);
      }
      if (prompt.type === 'target' && prompt.cardId === 'buyland' && mine) {
        const ids = (prompt.plotIds ?? []).filter(id => me.cash >= acquisitionPrice(state, id));
        if (!ids.length) { banKey = turnKey(); return aiAnswer(prompt, state); }
        return ids.sort((a, b) => acquisitionPrice(state, a) - acquisitionPrice(state, b))[0];
      }
      return aiAnswer(prompt, state);
    },
  });
  return out;
}

const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
for (const style of ['take', 'cross']) {
  const deals = [];
  for (let seed = 1; seed <= SEEDS; seed++) deals.push(...await playMeasured(style, seed));
  console.log(`\n${style}：实测收购成交 ${deals.length} 笔（${SEEDS} 局）`);
  if (!deals.length) continue;
  console.log(`  价格 ${Math.round(mean(deals, 'price'))}  标价 ${Math.round(mean(deals, 'mark'))}  溢价 ${Math.round(mean(deals, 'price') - mean(deals, 'mark'))}`);
  console.log(`  成交时买方资产变化 ${mean(deals, 'meDelta').toFixed(0)}  （≈ 溢价取负：${-(mean(deals, 'price') - mean(deals, 'mark')).toFixed(0)}）`);
  console.log(`  成交时卖方资产变化 ${mean(deals, 'sellerDelta').toFixed(0)}`);
  const exact = deals.filter(d => Math.abs(d.meDelta + (d.price - d.mark)) <= 1).length;
  console.log(`  逐笔核对「买方资产变化 = −溢价」：${exact}/${deals.length} 笔吻合（±1 元）`);
  console.log(`  买后是否持有该地：${deals.filter(d => d.ownerNow).length}/${deals.length}`);
}
