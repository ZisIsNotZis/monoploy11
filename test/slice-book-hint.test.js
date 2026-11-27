import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { renderSliceInsight } from '../src/ui/slice.js';
import { rentFor, assetsOf } from '../src/engine/economy.js';

// #554 候选 C：书屋易主后，玩家下一次做决定时必须在该屏看到「书屋在谁手上 + 走邻街付多少」。
//
// 为什么需要一个单独的测试：
//   这句提示是渲染层的一行字符串，删掉它不会让任何现有测试变红 ——
//   而它正是 #542 里「最贵的一次误会」（书屋买卖只写一句「支付 26000」）。
//
// 钉三件事：
//   1. 有主时侧栏出现书屋归属与金额，且金额 === rentFor（不能是写死的常量）；
//   2. 停业时不是报租金，而是报停业还剩几天（否则玩家被误导为会掉钱）；
//   3. 第 4 天前仍报「开售」提示，不被书屋提示顶掉（两段不能互相吞）。

class FakeEl { constructor() { this.innerHTML = ''; this.hidden = false; } }

function render(state, p) {
  const el = new FakeEl();
  renderSliceInsight(el, state, p ?? state.players.find(x => x.controller === 'human'));
  return el.innerHTML;
}

test('书屋未开售时，侧栏说的是开售日期，不是归属', () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  s.day = 1;
  const html = render(s);
  assert.match(html, /第 4 天开售/, '第 1 天应提示开售');
  assert.equal(/走邻街/.test(html), false, '第 1 天书屋无主时不该出现邻街租金提示');
});

test('书屋有主后，侧栏写明归属与当前邻街租金，且等于 rentFor', () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  s.day = 8;
  const human = s.players.find(p => p.controller === 'human');
  const bookId = s.map.plots.find(p => p.big).id;
  s.properties[bookId].ownerId = s.players[1].id;
  const html = render(s);
  const rent = rentFor(s, bookId);
  assert.match(html, /书屋在/, '缺少书屋归属');
  assert.ok(html.includes(s.players[1].name), '没写出书屋主人的名字');
  assert.match(html, /走邻街/, '缺少走邻街的后果');
  assert.ok(html.includes(rent.toLocaleString()), `金额不等于 rentFor（${rent}）：${html}`);
  // 数字必须带时效词，否则玩家会当成固定值（同局里书屋从 4,000 涨到 19,200）。
  assert.match(html, /现在走邻街/, '金额没标「现在」，会被当成固定值');
  assert.equal(human.id === s.players[1].id, false);
});

test('书屋停业时报「停业还剩 N 天」，不报会让玩家误以为要掉钱的金额', () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  s.day = 8;
  const bookId = s.map.plots.find(p => p.big).id;
  s.properties[bookId].ownerId = s.players[1].id;
  s.properties[bookId].closed = 2;
  const html = render(s);
  assert.match(html, /剩 2 天/, '停业剩余天数没写出来');
  // 注意：这里必须写 .test(html)。第一版写成 assert.equal(/走邻街付/, false)，
  // 是拿正则对象跟 false 比，永远不等 ⇒ 必然失败（不是实现错）。
  assert.equal(/走邻街付/.test(html), false, `停业时不该写「会付 X」：${html}`);
});

test('书屋是自己的时候标（你），且仍给出金额', () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  s.day = 8;
  const human = s.players.find(p => p.controller === 'human');
  const bookId = s.map.plots.find(p => p.big).id;
  s.properties[bookId].ownerId = human.id;
  const html = render(s);
  assert.match(html, /（你）/, '自己的书屋没标（你）');
  assert.match(html, /走邻街/);
});

test('局已结束时不再提示邻街租金（那时已经没有下一回合可用）', () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  s.day = 8;
  const bookId = s.map.plots.find(p => p.big).id;
  s.properties[bookId].ownerId = s.players[1].id;
  s.over = true; s.phase = 'over';
  const html = render(s);
  assert.equal(/走邻街/.test(html), false, `结算页还在说邻街租金，属于噪声：${html}`);
  assert.match(html, /收摊结算/, '结算标题应仍在');
});

test('渲染不改状态：调用前后书屋租金与资产完全相同（侧栏不能消耗随机数或写状态）', () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  s.day = 8;
  const bookId = s.map.plots.find(p => p.big).id;
  s.properties[bookId].ownerId = s.players[1].id;
  const human = s.players.find(p => p.controller === 'human');
  const before = JSON.stringify({ rent: rentFor(s, bookId), assets: assetsOf(s, human), rng: s.rng?.state ?? null });
  render(s);
  render(s);
  const after = JSON.stringify({ rent: rentFor(s, bookId), assets: assetsOf(s, human), rng: s.rng?.state ?? null });
  assert.equal(after, before, '渲染改变了状态（或随机数），侧栏必须是只读的');
});
