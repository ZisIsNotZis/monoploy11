import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { nextGameLine, money, sliceResults } from '../src/ui/slice.js';
import { rentFor, buildCost } from '../src/engine/economy.js';

// #3337：结算屏那句「下局试试」原来是**三条按起手写死的推销句**，与本局无关。
// 实测其中一条是坑（300 seed 配对：胜 126→60，资产 −20,945），而且三条从不提本局真正的杠杆
// （街心书屋、半条街）。这一片把它换成从本局 state/log 算出来的一句。
//
// 这条测试钉住四件事：
//   ① 句子里出现的每个数字都能从本局 state/log 回算出来（不是写死的常数）；
//   ② 破产那一支必须指出击穿它的那一笔，且与日志原文一致；
//   ③ 另一半在对手手里的半条街**不能**被推荐去补齐（那只能靠收购，而收购实测是亏的）；
//   ④ 旧的三条写死句不再出现。
//
// 跑真整局而不只喂夹具：句子依赖 log 原文（买下 / 实付租金），夹具造不出来的偏差正是要抓的。

const seed = (style, s) => {
  const state = startSession(createSliceConfig({ human: true, seed: s, style }));
  state.over = true; state.phase = 'over';
  return state;
};

const human = state => state.players.find(p => p.controller === 'human');
const push = (state, text, day = 1) => state.log.push({ day, text });

test('旧的三条写死建议不再出现（任何起手）', () => {
  for (const style of ['grow', 'take', 'cross']) {
    const state = seed(style, 1);
    state.phase = 'over';
    const html = sliceResults(state);
    assert.doesNotMatch(html, /带现金收购别人养好的店/, `${style}: 旧的 grow 建议还在（实测那是最差的一条路）`);
    assert.doesNotMatch(html, /先把自己的两间店升起来，再抓一轮旺季/, `${style}: 旧的 take 建议还在`);
    assert.doesNotMatch(html, /留住停业卡，等对方开旺季/, `${style}: 旧的 cross 建议还在`);
  }
});

test('任何起手、任何局面都有一条句子，且不是空串', () => {
  for (const style of ['grow', 'take', 'cross']) {
    const line = nextGameLine(seed(style, 3));
    assert.ok(line.length > 8, `${style}: 句子太短或为空：${JSON.stringify(line)}`);
    assert.doesNotMatch(line, /undefined|NaN|null/, `${style}: 句子里有未求值的占位：${line}`);
  }
});

test('破产那一支：指出击穿它的那一笔，金额与天数都来自日志原文', () => {
  const state = seed('grow', 1);
  const me = human(state);
  me.alive = false;
  push(state, `${me.name} 向 甲 应付租金 7000（晚风街小店） · 现金不够，会破产`, 9);
  push(state, `${me.name} 实付租金 7000（晚风街小店），甲 收到 7000`, 9);
  push(state, `${me.name} 向 乙 应付租金 11200（灯火街小店） · 现金不够，会破产`, 12);
  push(state, `${me.name} 实付租金 11200（灯火街小店），乙 收到 11200`, 12);
  const line = nextGameLine(state);
  assert.match(line, /11,200/, `应报出最大的一笔（11,200），得到：${line}`);
  assert.match(line, /第 12 天/, `应报出它发生的那一天：${line}`);
  assert.match(line, /灯火街小店/, `应报出是哪间店：${line}`);
  assert.doesNotMatch(line, /7,000/, '不应报出较小的一笔');
});

test('书屋在对手机里：句子的金额 = 引擎 rentFor/日志，不是写死的「近一万」', () => {
  const state = seed('grow', 1);
  const me = human(state);
  const rival = state.players.find(p => p.team !== me.team);
  state.properties.market = { ...state.properties.market, ownerId: rival.id, level: 2, bigType: 'bookstore' };
  push(state, `${rival.name} 买下 街心书屋（支付 26000）`, 4);
  push(state, `${me.name} 实付租金 3200（街心书屋），${rival.name} 收到 3200`, 8);
  push(state, `${me.name} 实付租金 3200（街心书屋），${rival.name} 收到 3200`, 11);
  const line = nextGameLine(state);
  assert.match(line, /街心书屋/, `应点名书屋：${line}`);
  assert.match(line, new RegExp(money(26000)), `应报出标价 26,000：${line}`);
  assert.match(line, /6,400/, `应报出两笔实付的合计 6,400（3,200×2）：${line}`);
  assert.match(line, /2 次/, `应报出踩到几次：${line}`);
  assert.match(line, new RegExp(`第 4 天`), `应报出对手哪一天拿走的：${line}`);
});

test('书屋没人买：说它本局的标价，租金用引擎 rentFor 算', () => {
  const state = seed('cross', 2);
  state.properties.market = { ...state.properties.market, ownerId: null, level: 2, bigType: 'bookstore' };
  const line = nextGameLine(state);
  assert.match(line, /街心书屋/, `应点名书屋：${line}`);
  assert.match(line, /26,000/, `应报出标价：${line}`);
  assert.match(line, /第 4 天/, `应报出它第几天开售：${line}`);
  assert.doesNotMatch(line, /近一万|约一万/, '不许用记忆里的约数代替引擎算出的租金');
});

// 这一片本来还想在屏上推荐「补齐只占一半的街」（80% 的局结束时有这么一条，同街两间把 Lv1
// 从 2,000 抬到 2,800，是本片测到的第二好杠杆）。但它排在书屋之后，而切片地图永远有书屋，
// 于是在真局里一次也到不了。所以那一段被删掉，而不是留一句永远不会执行的话。
// 这条测试钉住“别把它加回来而不解决可达性”。
test('没有任何真局会走到「补齐半条街」那一支（否则就不该删）', () => {
  for (const style of ['grow', 'take', 'cross']) {
    for (const s of [1, 2, 3]) {
      const state = seed(style, s);
      const line = nextGameLine(state);
      assert.doesNotMatch(line, /补齐/, `${style}/${s}: 回到了「补齐」分支（它排在书屋之后，真局到不了）：${line}`);
    }
  }
});

test('半条街的另一半在对手手里：不得推荐「补齐」（那只能靠收购卡，实测是亏的）', () => {
  const state = seed('grow', 1);
  const me = human(state);
  const rival = state.players.find(p => p.team !== me.team);
  const plots = state.map.plots.filter(x => x.street === '晨光街' && !x.big);
  state.properties[plots[0].id] = { ...state.properties[plots[0].id], ownerId: me.id, level: 1 };
  state.properties[plots[1].id] = { ...state.properties[plots[1].id], ownerId: rival.id, level: 1 };
  state.properties.market = { ...state.properties.market, ownerId: me.id };
  const line = nextGameLine(state);
  assert.doesNotMatch(line, /补齐.*晨光街|晨光街.*补齐/,
    `不该推荐补齐一条另一半在对手手里的街（只能靠收购卡）：${line}`);
});

// 已经买下书屋时，本局「拿到没拿到」不再是问题 —— 下一局的问题是「拿到之后做什么」。
// 所以那一支必须给出下一个动作的引擎真值（buildCost 与 rentFor），而不是复述本局。
test('已买下书屋且未到顶：给出到顶的价钱与租金，两个数都与引擎一致', () => {
  const state = seed('grow', 1);
  const me = human(state);
  state.properties.market = { ...state.properties.market, ownerId: me.id, level: 2, bigType: 'bookstore' };
  state.log.push({ day: 5, text: `${me.name} 买下 街心书屋（支付 26000）` });
  const line = nextGameLine(state);
  const cost = Math.round(buildCost(3) * (state.priceIndex ?? 1));
  const saved = state.properties.market.level;
  state.properties.market.level = 2; const now = rentFor(state, 'market');
  state.properties.market.level = 3; const top = rentFor(state, 'market');
  state.properties.market.level = saved;
  assert.match(line, new RegExp(money(cost)), `应报出到顶的花费 ${money(cost)}：${line}`);
  assert.match(line, new RegExp(money(now)), `应报出现在每次 ${money(now)}：${line}`);
  assert.match(line, new RegExp(money(top)), `应报出到顶后每次 ${money(top)}：${line}`);
  assert.match(line, /2 级/, `应说出现在几级：${line}`);
});

test('句子里的钱一律是 money() 的格式（与排名表同一个格式化函数）', () => {
  for (const style of ['grow', 'take', 'cross']) {
    const line = nextGameLine(seed(style, 5));
    for (const m of line.match(/\d{4,}/g) ?? []) {
      assert.equal(m, money(Number(m.replace(/,/g, ''))), `${style}: ${m} 不是 money() 的输出：${line}`);
    }
  }
});
