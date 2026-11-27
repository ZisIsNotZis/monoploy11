// #3343：买地屏新加的那一行「补齐 / 开新的」必须和引擎对得上。
//
// 我加这一行的理由是：屏上原来只有「这一块自己的租金」，于是「补齐自己那条街」
// 与「买一块陌生的地」在玩家眼里一模一样，而前者还带着整条街的乘数。
// 但一行字只要印出来就会被当成事实，所以这里逐条核对：
//   ① 印出的 streetBefore → streetAfter 与 rentFor 直接算的一致；
//   ② 「每轮到手 +gain」等于 after − before；
//   ③ 争街布局里确实存在「补齐」那种屏（streetMineCount > 0），
//      默认布局里则大多是「开新的」（每家开局就整条街满了）。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession } from '../../src/engine/flow.js';
import { buyLedgerFacts, buyLedgerLines } from '../../src/engine/market-ledger.js';
import { rentFor, buyPrice } from '../../src/engine/economy.js';

for (const contested of [false, true]) {
  console.log('\n===== ' + (contested ? '争街 ?cross=1' : '默认开局') + ' =====');
  for (const style of ['grow', 'take', 'cross']) {
    const state = startSession(createSliceConfig({ human: false, seed: 1, style, sliceContestedStreets: contested }));
    const p = state.players[0];
    for (const plot of state.map.plots) {
      const pr = state.properties[plot.id];
      if (pr.ownerId) continue;
      if (state.day < (plot.availableFromDay ?? 1)) continue;
      const f = buyLedgerFacts(state, plot.id, p);
      if (!f) continue;
      const lines = buyLedgerLines(state, plot.id, p);
      // 独立重算：把这块地给我之后，我那条街上已有的店各涨多少。
      const mine = state.map.plots.filter(x => x.id !== plot.id && !x.big && x.street === plot.street
        && state.players.find(q => q.id === state.properties[x.id].ownerId)?.team === p.team);
      const saved = { ...pr };
      let before = 0, after = 0;
      for (const x of mine) before += rentFor(state, x.id);
      state.properties[plot.id] = { ...pr, ownerId: p.id };
      for (const x of mine) after += rentFor(state, x.id);
      state.properties[plot.id] = saved;
      const ok = before === f.streetBefore && after === f.streetAfter && (after - before) === f.streetGain;
      console.log(`\n[${style}] ${plot.name}（${plot.street}） 买价 ${buyPrice(state, plot.id)}`);
      console.log(`  账本核对: before ${f.streetBefore} / after ${f.streetAfter} / gain ${f.streetGain}` +
        ` · 独立重算 ${before}/${after}/${after - before} ⇒ ${ok ? 'OK' : '不符'}`);
      for (const l of lines) console.log('  · ' + l);
    }
  }
}
