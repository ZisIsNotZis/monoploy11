import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { takeoverModel } from '../src/engine/insight.js';
import { applyCard } from '../src/engine/game.js';
import { rentFor } from '../src/engine/economy.js';
import { RENT_POOL } from '../src/engine/payback.js';

// #3333：用户在我 #3332 交的那一屏上当场抓到的错。
//
// 屏上写「灯火街茶铺 … 每局约 +2,078，另压对手 800」，而同局模型自己的
// perGame 是 1,278 —— 2,078 里**已经含**那 800，句尾又印了一次。
// 会读成「多赚 2,078，再额外压 800」。而且两个数单位还不同：
//   perGame = 我这块每次 2,000 × 我这块每局被踩 0.639 = 1,278  ← 每局
//   siblingLoss = 对手那块每次少收 800                          ← **每次**，不是每局
//
// 这三条判据分别咬住：量纲（两项都是每局）、互不包含（net 才是和）、
// 以及「屏幕上的数对得上真实收购前后的变化」。

const fresh = () => startSession(createSliceConfig({ human: false, seed: 1, style: 'take' }));

test('#3333 我方的「每局」与对手的「每局」都是同一个量纲，且互不包含', () => {
  const state = fresh();
  const me = state.players[0];
  const model = takeoverModel(state, me);
  assert.ok(model?.rows?.length, '夹具失效：没有候选');

  for (const r of model.rows) {
    // ① 我这块每局 = 每次租金 × 我这块每局被踩次数
    assert.equal(r.perGame, Math.round(r.rentMine * RENT_POOL.meansPerPlot[r.name]),
      `${r.name}: perGame 不是「每次租金 × 每局被踩次数」`);

    // ② 对手那块每局 = 每次少收 × 它自己每局被踩次数（**不是**把每次量当每局用）
    const siblings = state.map.plots.filter(p => p.street === r.street && p.id !== r.id);
    const siblingHits = siblings.reduce((s, p) => s + (RENT_POOL.meansPerPlot[p.name] ?? 0), 0);
    assert.equal(r.siblingPerGame, Math.round(r.siblingLoss * siblingHits),
      `${r.name}: siblingPerGame 不是「每次少收 × 对手每局被踩次数」`);

    // ③ 关键：net 是两者之和，但 perGame 里不含对手那笔。
    //    旧实现 net = perGame + siblingLoss（每次量），于是把 800 当成了每局，还印了两遍。
    assert.equal(r.net, r.perGame + r.siblingPerGame, `${r.name}: net 不是同量纲两项之和`);
    // 单位不同 ⇒ siblingPerGame 必须严格小于「把它当每局用」的旧写法
    // （对手那块每局被踩 < 1 次，否则这个断言不成立、要重新想量纲）。
    if (r.siblingLoss > 0) {
      assert.ok(siblingHits < 1, `${r.name}: 对手那块每局被踩 ${siblingHits} ≥ 1，量纲假设要重新检查`);
      assert.ok(r.siblingPerGame < r.siblingLoss,
        `${r.name}: siblingPerGame ${r.siblingPerGame} 没比单次量 ${r.siblingLoss} 小 —— 又没有换算成每局`);
    }
  }
});

test('#3333 屏幕上的每个数都对得上真实收购前后的变化（不接受推算值冒充实测）', () => {
  const model0 = takeoverModel(fresh(), fresh().players[0]);
  // 每个候选单独开一局，真调 applyCard，读真实租金变化
  for (const row of model0.rows) {
    const state = fresh();
    const me = state.players[0];
    const siblings = state.map.plots.filter(p => p.street === row.street && p.id !== row.id);
    const before = siblings.map(p => ({ id: p.id, rent: rentFor(state, p.id) }));
    const ok = applyCard(state, me, 'buyland', row.id);
    assert.equal(ok, true, `${row.name}: 收购没成交`);

    // ① 我这块的真实租金 == 模型用的 rentMine
    assert.equal(rentFor(state, row.id), row.rentMine,
      `${row.name}: 模型说买下后每次收 ${row.rentMine}，引擎实测 ${rentFor(state, row.id)}`);

    // ② 对手每块的真实少收，加起来 == 模型的 siblingLoss（每次量）
    const realLoss = before.reduce((s, b) => s + (b.rent - rentFor(state, b.id)), 0);
    assert.equal(row.siblingLoss, Math.round(realLoss),
      `${row.name}: 模型说对手每次少收 ${row.siblingLoss}，引擎实测 ${realLoss}`);
  }
});

test('#3333 net 排序仍然与实测结局同向（修量纲不能把方向修反）', () => {
  const state = fresh();
  const model = takeoverModel(state, state.players[0]);
  const byStreet = new Map();
  for (const r of model.rows) byStreet.set(r.street, Math.max(byStreet.get(r.street) ?? 0, r.net));
  // 实测（take，seed 1–300，只改买哪一间）：晚风街 5.0%/5.3%，灯火街 19.3%/19.3%
  assert.ok(byStreet.get('灯火街') > byStreet.get('晚风街'),
    `修完量纲后灯火街 ${byStreet.get('灯火街')} 不高于晚风街 ${byStreet.get('晚风街')}，与实测结局相反`);
});
