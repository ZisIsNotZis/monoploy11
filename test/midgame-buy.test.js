import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/ui/render.js';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { rentFor } from '../src/engine/economy.js';

// #672：买地面板必须给出「这一把值不值」的三件事：代价（售价）、收益（此刻租）、值不值（账面回本）。
// 与 #646 不同，这里验的是**中局决策时**看得到，不是局末。

const mkEl = () => {
  const el = { _html: '', style: { setProperty() {} }, hidden: false, scrollTop: 0, scrollHeight: 0,
    classList: { add() {}, remove() {}, toggle() {} }, clientWidth: 1000, clientHeight: 800 };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = v; } });
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  el.addEventListener = () => {};
  return el;
};
const mkRoot = () => ({ system: mkEl(), players: mkEl(), board: mkEl(), log: mkEl(), insight: mkEl(),
  dice: mkEl(), cards: mkEl(), hand: mkEl(), choice: mkEl() });
const strip = s => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function setup(opts = {}) {
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = state.players.find(p => p.controller === 'human');
  const plot = state.map.plots.find(p => !p.big);
  const price = opts.price ?? 8000;
  state.pending = { type: 'buy', cellId: plot.id, price, label: '小地产', level: 0, bigType: null };
  state.phase = 'action';
  const root = mkRoot();
  render(root, state, new Proxy({}, { get: () => () => {} }));
  return { state, human, plot, price, choice: strip(root.choice.innerHTML) };
}

test('买地面板给出此刻的租（不是只有售价）', () => {
  const { choice } = setup();
  assert.match(choice, /售价 8,000/);
  assert.match(choice, /此刻这条街\s*租\s*[\d,]+/, '必须给出此刻的租');
});

test('回本回合数必须等于 ceil(售价 / 买下后的租)，不是拍一个数', () => {
  const { state, human, plot, price, choice } = setup();
  // 独立算：临时模拟买下后的 rentFor，再恢复
  const saved = { ...state.properties[plot.id] };
  let rent = 0;
  try {
    state.properties[plot.id] = { ...saved, ownerId: human.id, level: saved.level ?? 0 };
    rent = rentFor(state, plot.id);
  } finally { state.properties[plot.id] = saved; }
  const expect = Math.max(1, Math.ceil(price / rent));
  const m = /账面约 (\d+) 回合回本/.exec(choice);
  assert.ok(m, '必须有账面回本回合数');
  assert.equal(Number(m[1]), expect, `面板 ${m[1]} 必须等于独立算的 ${expect}`);
});

test('回本句必须带「账面」限定（不能把账面当承诺）', () => {
  const { choice } = setup();
  assert.match(choice, /账面/);
  assert.match(choice, /不走过来就不兑现|不兑现/, '必须说明这个数是账面');
});

test('这条街停业（租为 0）时，必须说“收不到租”，而不是什么都不显示', () => {
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const plot = state.map.plots.find(p => !p.big);
  // 把它改成停业：closed > 0 ⇒ rentFor 返回 0
  state.properties[plot.id] = { ...(state.properties[plot.id] ?? {}), closed: 2, ownerId: null };
  state.pending = { type: 'buy', cellId: plot.id, price: 8000, label: '小地产', level: 0, bigType: null };
  state.phase = 'action';
  const root = mkRoot();
  render(root, state, new Proxy({}, { get: () => () => {} }));
  const text = strip(root.choice.innerHTML);
  // 只有 rentFor 真的返回 0 时才断言（否则环境变了）
  const saved = { ...state.properties[plot.id] };
  const human = state.players.find(p => p.controller === 'human');
  let rent = null;
  try {
    state.properties[plot.id] = { ...saved, ownerId: human.id };
    rent = rentFor(state, plot.id);
  } finally { state.properties[plot.id] = saved; }
  if (rent === 0) {
    assert.match(text, /收不到租/, '停业时必须说出来；我曾在这里写成 return \'\' 什么都不显示');
    assert.ok(!/回合回本/.test(text), '收不到租就不该报回合数');
  }
});

test('不把售价当成“租”混进来（防止 R1 那类搬家）', () => {
  const { choice } = setup();
  const rents = [...choice.matchAll(/租\s*([\d,]+)/g)].map(m => m[1]);
  assert.ok(rents.length >= 1);
  assert.ok(!rents.includes('8,000'), '租不能等于售价（那说明是拿售价冒充租）');
});
