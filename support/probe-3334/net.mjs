// #3334 探针 5：两件必须由引擎回答、不能由我推的事。
//  A. 付费加盖真的让总资产少多少（调 buildPlot，前后读 assetsOf）—— 不是「标价 +4,000」。
//  B. 到 3 级的价格真的取决于顺序吗（先付费再翻修 vs 先翻修再付费，调真 useCard）。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, buildPlot } from '../../src/engine/flow.js';
import { useCard } from '../../src/engine/game.js';
import { assetsOf, rentFor, buyPrice, buildCost } from '../../src/engine/economy.js';

const out = {};

for (const style of ['grow', 'take', 'cross']) {
  const s = startSession(createSliceConfig({ seed: 1, style }));
  const p = s.players.find(q => q.controller === 'human') ?? s.players[0];
  const id = p.properties[0];
  const lv = s.properties[id].level;
  const cost = Math.round(buildCost(lv + 1) * s.priceIndex);
  const a0 = assetsOf(s, p), cash0 = p.cash, mark0 = buyPrice(s, id), rent0 = rentFor(s, id);
  buildPlot(s, p, id);
  out[`${style}_paid`] = {
    level: `${lv}->${s.properties[id].level}`, cost, cash: `${cash0}->${p.cash}`,
    mark: `${mark0}->${buyPrice(s, id)}`, rent: `${rent0}->${rentFor(s, id)}`,
    assets: `${a0}->${assetsOf(s, p)}`, dAssets: assetsOf(s, p) - a0,
  };
}

// B：同一间店、同一张翻修卡，两种顺序各自花掉多少现金，最后是不是都 3 级。
function order(first) {
  const s = startSession(createSliceConfig({ seed: 1, style: 'grow' }));
  const p = s.players.find(q => q.controller === 'human');
  const id = p.properties[0];
  const cash0 = p.cash;
  const payPaid = () => buildPlot(s, p, id);
  const payFree = () => {
    const idx = p.cards.indexOf('worker');
    s.phase = 'action';
    useCard(s, idx, id);          // 真卡：免费 +1 级
  };
  if (first === 'paid') { payPaid(); payFree(); } else { payFree(); payPaid(); }
  return { level: s.properties[id].level, cashSpent: cash0 - p.cash, rent: rentFor(s, id) };
}
out.order = { paidFirst: order('paid'), freeFirst: order('free') };

// C：手里有没有翻修卡 —— 起手三种风格各一次（事实，不是估计）。
out.hands = Object.fromEntries(['grow', 'take', 'cross'].map(style => {
  const s = startSession(createSliceConfig({ seed: 1, style }));
  return [style, s.players.find(q => q.controller === 'human').cards];
}));

console.log(JSON.stringify(out, null, 1));
