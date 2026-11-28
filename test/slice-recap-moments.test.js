import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { sliceRecapMoments, sliceResults } from '../src/ui/slice.js';

function fixture() {
  const state = startSession(createSliceConfig({human:true, style:'take', seed:47}));
  const human = state.players.find(p => p.controller === 'human');
  const rival = state.players.find(p => p !== human);
  const add = (day, p, lines, more) => state.slice.history.push({day, playerId:p.id, lines,
    money:0, assets:0, cardsPlayed:1, ...more});
  return {state, human, rival, add};
}

test('收摊先读到实际组合：停业落地免租、定步买书屋，租金来自实收而非应付', () => {
  const {state, human, rival, add} = fixture();
  const n = human.name, a = rival.name;
  add(1, human, ['定步生效：本回合走 1 步', `${n} 买下 晨光街茶铺（支付 8000）`]);
  add(2, human, [`${n} 使用 停业 → 晚风街，停租 2 天`, `${n} 向 ${a} 应付租金 0（晚风街茶铺） · 停业中，不计租`]);
  add(4, human, ['定步生效：本回合走 6 步', `${n} 买下 街心书屋（支付 26000）`]);
  add(7, human, [`${n} 使用 翻修 → 街心书屋，升到 3 级`]);
  add(12, rival, [`${a} 向 ${n} 应付租金 9600（街心书屋）`, `${a} 实付租金 4400（街心书屋），${n} 收到 4400`]);
  const before = JSON.stringify(state);
  assert.deepEqual(sliceRecapMoments(state, human), [
    {day:2, text:'你让晚风街停业，走到晚风街茶铺旁没付租。'},
    {day:4, text:'你用定步走 6 步，花 26,000 买下街心书屋，此后从它实收 4,400。'},
  ]);
  const html = sliceResults(state);
  assert.match(html, /<\/table>[\s\S]+这局，你做了什么[\s\S]+回看你改变局面的回合[\s\S]+定步生效：本回合走 6 步/);
  assert.equal(JSON.stringify(state), before);
});

test('不把选择步数当出发，不把别人的封租或不同街的免租算作自己的响应', () => {
  const {state, human, rival, add} = fixture();
  const n = human.name, a = rival.name;
  add(1, human, [`${n} 使用定步：本回合走 2 步`], {operatingReceipt:{}});
  add(2, rival, [`${a} 使用 停业 → 晚风街，停租 2 天`]);
  add(3, human, [`${n} 使用 停业 → 晨光街，停租 2 天`, `${n} 向 ${a} 应付租金 0（晚风街茶铺） · 停业中，不计租`]);
  add(4, human, [`${n} 掷出 6 点`, `${n} 买下 街心书屋（支付 26000）`]);
  add(7, human, [`${n} 使用 翻修 → 街心书屋，升到 3 级`]);
  assert.deepEqual(sliceRecapMoments(state, human), [
    {day:4, text:'你花 26,000 买下街心书屋，后来没收到它的租。'},
    {day:7, text:'你免费把街心书屋升到 3 级。'},
  ]);
});


test('实收的旺季优先于早先翻修；封租或被对手重新开旺季不能冒领', () => {
  const {state, human, rival, add} = fixture();
  const n = human.name, a = rival.name;
  const street = state.map.plots.find(p => p.id === 'market').street;
  add(4, human, ['定步生效：本回合走 1 步', `${n} 买下 街心书屋（支付 26000）`]);
  add(7, human, [`${n} 使用 翻修 → 街心书屋，升到 3 级`]);
  add(8, human, [`${n} 使用 旺季 → ${street}，租金翻倍 3 天`]);
  add(8, rival, [`${a} 实付租金 0（街心书屋），${n} 收到 0`, `${a} 使用 旺季 → ${street}，租金翻倍 3 天`]);
  add(8, rival, [`${a} 向 ${n} 应付租金 19200（街心书屋） · 旺季翻倍`, `${a} 实付租金 19200（街心书屋），${n} 收到 19200`]);
  add(9, human, [`${n} 使用 旺季 → ${street}，租金翻倍 3 天`]);
  add(10, rival, [`${a} 向 ${n} 应付租金 19200（街心书屋） · 旺季翻倍 · 现金不够，会破产`, `${a} 实付租金 17400（街心书屋），${n} 收到 17400`]);
  assert.deepEqual(sliceRecapMoments(state, human), [
    {day:4, text:'你用定步走 1 步，花 26,000 买下街心书屋。'},
    {day:9, text:'你打出旺季，第 10 天从街心书屋实收 17,400。'},
  ]);
});


test('对手付不出时只说实收；后面的旺季打在其他街不冒充书屋', () => {
  const {state, human, rival, add} = fixture();
  const n = human.name, a = rival.name;
  add(4, human, ['定步生效：本回合走 1 步', `${n} 买下 街心书屋（支付 26000）`]);
  add(9, human, [`${n} 使用 旺季 → 书屋，租金翻倍 3 天`]);
  add(9, rival, [`${a} 向 ${n} 应付租金 19200（街心书屋） · 旺季翻倍 · 现金不够，会破产`,
    `${a} 付不出 19200（租金），破产`, `${a} 实付租金 16200（街心书屋），${n} 收到 16200`]);
  add(10, human, [`${n} 使用 旺季 → 晨光街，租金翻倍 3 天`]);
  add(10, rival, [`${a} 向 ${n} 应付租金 8000（晨光街小店） · 旺季翻倍`, `${a} 实付租金 8000（晨光街小店），${n} 收到 8000`]);
  assert.deepEqual(sliceRecapMoments(state, human)[1], {day:9, text:'你打出旺季，当天从街心书屋实收 16,200。'});
  add(10, rival, [`${a} 向 ${n} 应付租金 19200（街心书屋） · 旺季翻倍`, `${a} 实付租金 19200（街心书屋），${n} 收到 19200`]);
  const moments = sliceRecapMoments(state, human);
  assert.deepEqual(moments[1], {day:9, text:'你开了旺季，从街心书屋实收 35,400（2 笔）。'});
  assert.ok(moments[0].text.includes('街心书屋'));
  assert.doesNotMatch(JSON.stringify(moments), /19,200/);
});
