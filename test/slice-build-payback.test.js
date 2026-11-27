import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, buildPlot } from '../src/engine/flow.js';
import { useCard } from '../src/engine/game.js';
import { rentFor, buildCost } from '../src/engine/economy.js';

// #570：翻修/加盖的日志必须能让玩家算出「这步要几回合回本」。
//
// 回本 = ceil(花费 / 每回合增量租金)。
// 这里不复述实现，而是**用 rentFor 与 buildCost 独立重算一遍**，再要求与日志相等。
//
// 教训（这条写下来防重犯）：第一版把成本写成 `10000 * 当前等级`，
// 而引擎的 `buildCost(level)` 是 `max(1,level)*5000`，且切片里传的是
// `pr.level + 1`（升级后的等级）。于是一个 2→3 的加盖是 buildCost(3)=15000，不是 20000。
// 成本算错，测试就会去指控一个正确的实现。

const logText = s => s.log.map(l => l.text);
const slice = () => startSession(createSliceConfig({ seed: 7, style: 'grow' }));

function expectedPayback(s, id, cost, targetLevel) {
  const pr = s.properties[id];
  const lv = pr.level;
  pr.level = targetLevel - 1;
  const prev = rentFor(s, id);
  pr.level = lv;
  const gain = rentFor(s, id) - prev;
  return gain > 0 ? Math.max(1, Math.ceil(cost / gain)) : 0;
}

test('付费加盖的回本回合数与用 rentFor+buildCost 独立算出的值一致', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 2;
  p.cash = 500000;
  // 与 flow.js 的 buildPlot 同一套成本公式（切片：buildCost(升级后等级) × priceIndex）。
  const cost = Math.round(buildCost(s.properties[id].level + 1) * s.priceIndex);
  buildPlot(s, p, id);
  assert.equal(s.properties[id].level, 3, 'precondition: 加盖应已生效');
  const expected = expectedPayback(s, id, cost, 3);
  assert.ok(expected > 0, `增量应为正，否则测不出回本（算得 ${expected}）`);
  const line = logText(s).find(t => t.includes('回合回本'));
  assert.ok(line, '加盖日志里没有回本回合数');
  assert.ok(line.includes(`（花费 ${cost}）`), `日志里的花费不是 ${cost}：${line}`);
  assert.ok(line.includes(`${expected} 回合回本`), `回本数不是独立算出的 ${expected}：${line}`);
});

test('免费翻修写成「立即回本」，不是编一个回合数', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  const idx = p.cards.indexOf('worker');
  assert.ok(idx >= 0, '起手应该有翻修卡');
  s.phase = 'action';
  useCard(s, idx, id);
  const line = logText(s).find(t => t.includes('使用 翻修'));
  assert.ok(line, '没有翻修日志');
  assert.match(line, /立即回本/);
  assert.equal(/回合回本/.test(line), false, `免费翻修不该编出回合数：${line}`);
});

test('算完回本后等级没被留在低级（否则属性被永久改坏）', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 2;
  p.cash = 500000;
  buildPlot(s, p, id);
  assert.equal(s.properties[id].level, 3, `日志算完回本后等级被留在 ${s.properties[id].level}`);
});

test('满级时既不加盖也不产生回本文本', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = s.config.maxLevel;
  p.cash = 500000;
  const logs = s.log.length;
  buildPlot(s, p, id);
  assert.equal(s.log.length, logs, '满级时不该产生日志');
  assert.equal(logText(s).some(t => t.includes('回合回本')), false);
});

test('完整模式不加回本文本', () => {
  const s = startSession({ seed: 490, startingCards: 0 });
  const [p] = s.players;
  const plot = s.map.plots.find(x => !x.big);
  s.properties[plot.id] = { ownerId: p.id, level: 2, street: plot.street, big: false, bigType: null, closed: 0, inflate: 0, price: plot.price };
  p.properties.push(plot.id);
  p.cash = 500000;
  const logs = s.log.length;
  buildPlot(s, p, plot.id);
  const added = s.log.slice(logs).map(l => l.text).join(' ');
  assert.equal(/回本/.test(added), false, `完整模式被加了回本文本：${added}`);
});
