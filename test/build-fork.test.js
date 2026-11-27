import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, buildPlot, runGame } from '../src/engine/flow.js';
import { useCard } from '../src/engine/game.js';
import { aiAnswer } from '../src/engine/ai.js';
import { assetsOf, buyPrice, rentFor, buildCost } from '../src/engine/economy.js';
import { render } from '../src/ui/render.js';
import { buildOrderLine } from '../src/ui/slice.js';

// #3334：正常首局最早的一处花钱决定 —— 第 2 个决策就是「加盖 10,000」。
//
// 改前那一屏给的唯一金额是「估值增加 4,000」，而当场真账是
// 现金 -10,000、标价 +4,000、**总资产 -6,000**（真 buildPlot 量，不是推算）。
// 它也没说这一下与手里那张「翻修」卡是什么关系 —— 而卡只能下个回合用
// （flow.js playTurn：出牌 → 移动 → 落地 → build 提示），所以三条路的差价是真的：
//   付了再让卡升同一间 = 10,000 到 3 级；先免费再付 = 15,000 到 3 级。
//
// 这组判据钉四件事：
//   ① 三个数都在屏上，且都能用引擎独立重算出来（不是写死的 4,000/-6,000）；
//   ② 「不付」这一侧必须有话说 —— 手上有翻修卡时说清那张卡能免费做什么；
//   ③ 到 3 级的顺序差价必须与引擎真花的钱相等（调 buildPlot + useCard 复算）；
//   ④ 不在场的人不显示这笔账：别人的店、停业街、已满级。

function root() {
  const mk = () => ({ innerHTML: '', hidden: false, scrollTop: 0, scrollHeight: 0,
    querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
    style: {}, getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }) });
  return new Proxy({}, { get: (t, k) => (t[k] ??= mk()) });
}
const noop = new Proxy({}, { get: () => () => {} });
const slice = (style = 'grow', seed = 1) => startSession(createSliceConfig({ seed, style }));
const human = s => s.players.find(p => p.controller === 'human');

function renderBuild(state, cellId, cost) {
  const r = root();
  const saved = state.pending;
  state.pending = { type: 'build', cellId, cost };
  render(r, state, noop);
  state.pending = saved;
  return r.choice.innerHTML;
}
const forkOf = html => /data-fork[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1];

test('#3334 屏上同时给出「现金少多少 / 标价加多少 / 总资产变多少」，且与真 buildPlot 一致', () => {
  for (const style of ['grow', 'take', 'cross']) {
    const s = slice(style);
    const p = human(s);
    const id = p.properties[0];
    const cost = Math.round(buildCost(s.properties[id].level + 1) * s.priceIndex);

    // 独立复算：真的盖一次，读资产差，再撤回（用引擎，不用我的公式）。
    const before = assetsOf(s, p);
    const cash0 = p.cash;
    const mark0 = buyPrice(s, id);
    buildPlot(s, p, id);
    const realCash = cash0 - p.cash;
    const realMark = buyPrice(s, id) - mark0;
    const realNet = assetsOf(s, p) - before;

    const line = buildOrderLine(s, id, cost, p);
    assert.ok(line, `${style}：没有分叉句`);
    assert.ok(line.includes(`现金 -${cost.toLocaleString()}`), `${style}：现金那一笔不对：${line}`);
    assert.ok(line.includes(`标价 +${realMark.toLocaleString()}`), `${style}：标价 +${realMark} 没写出来：${line}`);
    assert.ok(line.includes(`总资产 ${realNet >= 0 ? '+' : '-'}${Math.abs(realNet).toLocaleString()}`),
      `${style}：总资产变化应为 ${realNet}：${line}`);
    assert.equal(realCash, cost, 'precondition：引擎扣的现金应等于提示里的费用');
    assert.equal(realNet, realMark - cost, 'precondition：总资产变化应等于标价增量减现金');
  }
});

test('#3334 手上有翻修卡时，「不付」那一侧必须说清那张卡能免费做什么', () => {
  const s = slice('grow');
  const p = human(s);
  const id = p.properties[0];
  assert.ok(p.cards.includes('worker'), 'precondition：grow 起手带翻修卡');
  const line = buildOrderLine(s, id, 10000, p);
  assert.match(line, /不付[：:].*翻修卡/, `没说不付会怎样：${line}`);
  assert.match(line, /翻修卡下回合免费/, `没写清那张卡下回合能免费升：${line}`);
  // 反向：手里没有卡就不许说「卡可以留着」——take 起手没有翻修卡。
  const t = slice('take');
  const tp = human(t);
  assert.equal(tp.cards.includes('worker'), false, 'precondition：take 起手不带翻修卡');
  const tline = buildOrderLine(t, tp.properties[0], 10000, tp);
  assert.equal(/翻修卡下回合免费/.test(tline), false, `没有卡却说了卡的事：${tline}`);
  assert.match(tline, /没有翻修卡/, `没有卡时要照实说：${tline}`);
});

test('#3334 到 3 级的顺序差价：屏上写的数 = 引擎真花的钱（10,000 vs 15,000）', () => {
  const spend = order => {
    const s = slice('grow');
    const p = human(s);
    const id = p.properties[0];
    const cash0 = p.cash;
    const pay = () => buildPlot(s, p, id);
    const free = () => { const i = p.cards.indexOf('worker'); s.phase = 'action'; useCard(s, i, id); };
    if (order === 'paid') { pay(); free(); } else { free(); pay(); }
    return { spent: cash0 - p.cash, level: s.properties[id].level, rent: rentFor(s, id) };
  };
  const a = spend('paid'), b = spend('free');
  assert.equal(a.level, 3, 'precondition：先付再免费应到 3 级');
  assert.equal(b.level, a.level, 'precondition：两种顺序应到同一级');
  assert.equal(b.rent, a.rent, 'precondition：同一级租金应相同（否则比的不是顺序）');
  assert.ok(b.spent > a.spent, 'precondition：先免费再付应更贵');

  const s = slice('grow');
  const p = human(s);
  const line = buildOrderLine(s, p.properties[0], 10000, p);
  assert.ok(line.includes(`先付再免费 ${a.spent.toLocaleString()}`), `屏上不是引擎的先付总额 ${a.spent}：${line}`);
  assert.ok(line.includes(`先免费再付 ${b.spent.toLocaleString()}`), `屏上不是引擎的先免费总额 ${b.spent}：${line}`);
  assert.ok(line.includes(`差 ${(b.spent - a.spent).toLocaleString()}`), `差价不是 ${b.spent - a.spent}：${line}`);
});

test('#3334 这条账只给店主人：别人的店、停业街、已满级都不印', () => {
  const s = slice('grow');
  const p = human(s);
  const id = p.properties[0];
  // 别人的店
  s.properties[id].ownerId = s.players[1].id;
  assert.equal(buildOrderLine(s, id, 10000, p), '', '别人的店不该给这笔账');
  s.properties[id].ownerId = p.id;
  // 停业街
  s.properties[id].closed = 2;
  assert.equal(buildOrderLine(s, id, 10000, p), '', '停业街由已签的停业句负责，不该重复');
  s.properties[id].closed = 0;
  // 已满级
  s.properties[id].level = s.config.maxLevel;
  assert.equal(buildOrderLine(s, id, 15000, p), '', '满级没有下一级可说');
  // 非切片局
  s.config.mode = 'full';
  assert.equal(buildOrderLine(s, id, 10000, p), '', '完整模式没有这张卡');
});

test('#3334 真入口：这条句真的出现在首局那个加盖屏上（不是只导出没人用）', async () => {
  let captured = null;
  const s = startSession(createSliceConfig({ human: true, seed: 1, style: 'grow' }));
  await runGame(s, {
    render() {}, async step() {},
    async ask(prompt) {
      const p = prompt.player;
      if (!captured && p?.controller === 'human' && prompt.type === 'build') {
        const html = renderBuild(s, prompt.plot.id, prompt.cost);
        captured = { day: s.day, fork: forkOf(html), cost: prompt.cost };
        return null;
      }
      return aiAnswer(prompt, s);
    },
  });
  assert.ok(captured, '首局没有出现加盖提示（前提失效，要重看入口）');
  assert.equal(captured.day, 1, '正常首局最早这一次加盖应发生在第 1 天');
  assert.ok(captured.fork, '真 render 的加盖屏上没有 data-fork');
  assert.ok(captured.fork.includes(`现金 -${captured.cost.toLocaleString()}`), `分叉句没给出代价：${captured.fork}`);
});
