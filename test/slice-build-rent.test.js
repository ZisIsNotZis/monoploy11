import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, buildPlot } from '../src/engine/flow.js';
// 日志是在 useCard 里写的，applyCard 只改状态 —— 第一版用错入口，
// 所以「没有翻修日志」直接红。这也说明测试本身有牙。
import { useCard } from '../src/engine/game.js';
import { rentFor } from '../src/engine/economy.js';

// #565 候选 B：翻修/加盖后，日志必须写出「这间店现在收多少」。
//
// 为什么需要测试：
//   #542 测出 build 类 13 个事件 Q3 命中 0 —— 玩家点完「翻修」要去地图上看小字
//   才知道自己刚刚做了什么。引擎早就算好了 rentFor，只是没往上贴。
//
// 钉四件事：
//   1. 卡牌翻修（game.js:415）带租金，且 === 升级后的 rentFor（不写死）；
//   2. 付费加盖（flow.js:628）同理；
//   3. 金额必须是升级**之后**的值（写升级前的值看着对，实际误导）；
//   4. 切片以外的模式不受影响。

const logText = s => s.log.map(l => l.text);
const slice = () => startSession(createSliceConfig({ seed: 7, style: 'grow' }));

test('卡牌翻修写出租金，且是升级后的 rentFor', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  const before = rentFor(s, id);
  const idx = p.cards.indexOf('worker');
  assert.ok(idx >= 0, '起手应该有翻修卡');
  s.phase = 'action';
  useCard(s, idx, id);
  const after = rentFor(s, id);
  assert.notEqual(after, before, '升级后租金没变，测不出新旧差异，这条断言无意义');
  const line = logText(s).find(t => t.includes('使用 翻修'));
  assert.ok(line, '没有翻修日志');
  assert.ok(line.includes(after.toLocaleString()), `日志里不是升级后的租金 ${after}：${line}`);
});

test('付费加盖写出租金，且是升级后的 rentFor', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 2;
  p.cash = 500000;
  const before = rentFor(s, id);
  buildPlot(s, p, id);
  const after = rentFor(s, id);
  assert.equal(s.properties[id].level, 3, '加盖没生效');
  assert.notEqual(after, before, '加盖后租金没变，测不出新旧差异');
  const line = logText(s).find(t => t.includes('升到 Lv.'));
  assert.ok(line, '没有加盖日志');
  assert.ok(line.includes(after.toLocaleString()), `加盖日志里不是升级后的租金 ${after}：${line}`);
  // #3391zp3：这条断言的原意是「『租 N』那个字段必须是升级后的 rentFor」，
  // 但旧写法是「整行不许出现升级前的租金」—— 太宽：升级行现在自带回本除法
  // （「花 10,000 ÷ 每次多收 2,800 = 4 次」），而小店 1→2 级时**增量恰好等于升级前的租金**，
  // 于是正确的句子被这条判据判红。判据继承旧口径（#3391z 已记过一次）：改口径后先看它在守什么。
  // 现在只钉那个字段：取「租 N」这一处。
  // 取「租」后面那个千分位金额，不吃逗号（`[\d,]+` 会把分隔逗号也吃进数字里）。
  const MONEY = /租 (\d{1,3}(?:,\d{3})*)/;
  const rentField = MONEY.exec(line)?.[1];
  assert.equal(rentField, after.toLocaleString(), `「租」那个字段不是升级后的租金 ${after}：${line}`);
  // 负对照：把那一处换成升级前的值，必须读成 before —— 否则这条判据是空跑。
  const broken = line.replace(`租 ${after.toLocaleString()}`, `租 ${before.toLocaleString()}`);
  assert.notEqual(broken, line, '负对照没生效：整行里找不到「租 N」那一处');
  assert.equal(MONEY.exec(broken)?.[1], before.toLocaleString(),
    '负对照没生效：换成升级前租金后没被读出来');
});

test('满级后再加盖不产生日志（否则玩家会以为自己升级成功）', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = s.config.maxLevel;
  p.cash = 500000;
  const before = rentFor(s, id);
  const logs = s.log.length;
  buildPlot(s, p, id);
  assert.equal(s.properties[id].level, s.config.maxLevel, '满级还被升级了');
  assert.equal(s.log.length, logs, '满级时不该产生新的日志');
  assert.equal(rentFor(s, id), before);
});

test('完整模式不受影响（不出现切片专用的「，租 N」后缀）', () => {
  const s = startSession({ seed: 490, startingCards: 0 });
  const [p] = s.players;
  const plot = s.map.plots.find(x => !x.big);
  s.properties[plot.id] = { ownerId: p.id, level: 1, street: plot.street, big: false, bigType: null, closed: 0, inflate: 0, price: plot.price };
  p.properties.push(plot.id);
  p.cards = ['worker'];
  s.phase = 'action';
  useCard(s, 0, plot.id);
  const line = logText(s).find(t => t.includes('使用') && t.includes(p.name));
  assert.ok(line, '完整模式应该有翻修日志（否则这条断言是空跑）');
  assert.equal(/，租 /.test(line), false, `完整模式被加上了切片专用后缀：${line}`);
});
