import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, settleStreetBusiness, streetBusinessStatus } from '../src/engine/flow.js';
import { buyLedgerLines, streetBusinessIncrement } from '../src/engine/market-ledger.js';
import { businessLine } from '../src/ui/slice.js';

// #3391v：复核 #3425 第一轮第 4 条 —— 「672 条绿测试对这次唯一的玩法改动一句话都没说」。
//
// 这一片给 `streetBusinessIncrement`（买地屏那行）与 `businessLine`（侧栏那行）补覆盖。
// 它们共同的病是**沉默**：
//   · 条件不满足时返回 ''，看起来像「没事发生」，而不是「我没法说」；
//   · 停业时若把「能不能结算」和「凑没凑齐」混成一个布尔，那一行会被静默漏掉
//     （#3391t 自测抓到的就是这个）。
// 所以这里的断言尽量咬「**必须有一行**」，而不只是「内容对」。

const HUMAN_STREET = '晨光街';
const MINE = '3,1';       // 真局里人类在争街发牌下持有的那一间
const HALF = '4,1';       // 同一街的另一半，开局是无主空地（support/probe-3391/human-half.mjs）

function fresh(perShop = 250) {
  const state = startSession(createSliceConfig({
    human: true, seed: 1, style: 'grow', sliceContestedStreets: true,
    streetBusinessPerShop: perShop,
  }));
  const human = state.players.find(p => p.controller === 'human');
  assert.equal(state.properties[MINE].ownerId, human.id, '人类应当持有晨光街那一间');
  assert.equal(state.properties[HALF].ownerId, null, '另一半开局应当是无主空地');
  return { state, human };
}

test('营业进项：规则没开时三处输出都为空，且不改动任何状态', () => {
  const { state, human } = fresh(0);
  const snapshot = JSON.stringify(state.properties);
  assert.equal(streetBusinessIncrement(state, { streetName: HUMAN_STREET, big: false }, HALF), '');
  assert.equal(businessLine(state, human), '');
  const lines = buyLedgerLines(state, HALF, human);
  assert.equal(lines.some(l => l.includes('营业进项')), false,
    '规则没开时买地屏不该出现营业进项那一行');
  // 试算函数会临时改 state.properties 再恢复 —— 规则没开时必须**碰都不碰**。
  assert.equal(JSON.stringify(state.properties), snapshot);
  assert.equal(human.properties.includes(HALF), false);
});

test('营业进项：一间都没有时，说清还差几间与那时的量级', () => {
  // 前提是真实的：争街每条街只有 2 间，所以「买下还差 N 间」只在**这条街一间都不归你**时
  // 才可达（例如先收购走对手那一间、或整条街表下的别条街）。第一版我把这个前提写错了，
  // 用「已有一间」去期待「还差 1 间」—— 买下另一半就凑齐了，那句话永远不该出现。
  const { state, human } = fresh();
  const mine = state.properties[MINE];
  state.properties[MINE] = { ...mine, ownerId: null };
  human.properties = human.properties.filter(id => id !== MINE);

  const text = streetBusinessIncrement(state, { streetName: HUMAN_STREET, big: false }, HALF);
  assert.match(text, /还差 1 间/, `应当说出还差几间，实得：${text}`);
  assert.match(text, /每店每天 250/, `应当说出每店每天的量级，实得：${text}`);

  // 此刻还没凑齐 ⇒ 一分钱都不该入账。
  // 注意 `sliceStats.business` 只在**首次结算**时才被写（flow.js 用 `?? 0` 读），
  // 所以「没入账」在这里表现为「字段不存在」而不是 0 —— 两者都算没入账。
  assert.equal(streetBusinessStatus(state, human).find(r => r.street === HUMAN_STREET).qualifies, false);
  settleStreetBusiness(state);
  assert.equal(human.sliceStats.business ?? 0, 0);
});

test('营业进项：买下就凑齐时，说清每天多少、比现在多多少', () => {
  const { state, human } = fresh();
  const before = human.cash;
  const text = streetBusinessIncrement(state, { streetName: HUMAN_STREET, big: false }, HALF);
  assert.match(text, /就凑齐了/, `凑齐那句话必须出现，实得：${text}`);
  assert.match(text, /每天结算 500/, `两间 Lv.1 × 250 = 500，实得：${text}`);
  assert.match(text, /比现在多 500/, `现在这条街不结算，差额应当是全额，实得：${text}`);
  assert.match(text, /停业期间不入账/, '必须提前说清它什么时候不会到账');

  // 试算不能改真实余额，也不能把这块地真的记到人类名下。
  assert.equal(human.cash, before, '试算不该动现金');
  assert.equal(state.properties[HALF].ownerId, null, '试算不该改归属');
  assert.equal(human.properties.includes(HALF), false, '试算不该把地块写进我的列表');
});

test('营业进项：这条街停业时仍然要说，而且要说「开业后才入账」', () => {
  const { state, human } = fresh();
  // 把已持有那一间挂上停业：所有权仍凑齐，但这刻不能结算。
  state.properties[MINE] = { ...state.properties[MINE], closed: 2 };
  const text = streetBusinessIncrement(state, { streetName: HUMAN_STREET, big: false }, HALF);
  assert.notEqual(text, '', '停业正是最需要解释的时候，这一行不能沉默（#3391t 的坑）');
  assert.match(text, /停业/, `必须点出停业，实得：${text}`);
  assert.match(text, /开业后每天结算 500/, `要说清开业后是多少，实得：${text}`);
  assert.match(text, /停业期满前不入账/, '必须说明现在不入账');

  // 侧栏同样点到停业。但要把**两条街都**挂上停业才验得到：侧栏挑「最接近」的那一条时
  // 所有权优先、其次才是「有没停业」（#3391t 的排序修正），所以只停一条时它会正确地去提
  // 另一条没停业的街 —— 那是设计，不是缺陷。
  state.properties['9,9'] = { ...state.properties['9,9'], closed: 2 };
  state.properties['8,9'] = { ...state.properties['8,9'], closed: 2 };
  const line = businessLine(state, human);
  assert.match(line, /停业/, `侧栏应当点出停业，实得：${line}`);
});

test('营业进项：侧栏把「买下就凑齐」排在「还差一间」前面，且停业不影响排序', () => {
  // #3391t 自测抓到的缺陷：第一版按「已持有 − 停业」排序，于是玩家刚花钱补齐的街
  // （2/2 但两张停业卡生效）被排到一条 1/2 的街后面，屏上提的是后者 —— 玩家会以为买错了。
  const { state, human } = fresh();
  const other = '9,9';   // 人类在月色街的那一间
  assert.equal(state.properties[other].ownerId, human.id);

  // 让晨光街先凑齐（但两间都停业），月色街仍是 1/2。
  state.properties[HALF] = { ...state.properties[HALF], ownerId: human.id };
  human.properties.push(HALF);
  state.properties[MINE] = { ...state.properties[MINE], closed: 2 };
  state.properties[HALF] = { ...state.properties[HALF], closed: 2 };

  const rows = streetBusinessStatus(state, human);
  assert.equal(rows.find(r => r.street === HUMAN_STREET).owned, 2, '前提：晨光街 2/2');
  assert.equal(rows.find(r => r.street === '月色街').owned, 1, '前提：月色街 1/2');

  const line = businessLine(state, human);
  // 屏上必须先提晨光街（2/2，只是停业中），不能提月色街（还差 1 间）——
  // 否则玩家会以为自己刚补的那条街没买对。
  assert.ok(line.includes(HUMAN_STREET), `应当提已凑齐的 ${HUMAN_STREET}，实得：${line}`);
  assert.equal(line.includes('月色街'), false, `不该提还差一间的月色街，实得：${line}`);
  assert.match(line, /停业/, '已凑齐但停业时，必须说清原因');
});

test('营业进项：已凑齐且开着张时，侧栏报出已入账的数', () => {
  const { state, human } = fresh();
  state.properties[HALF] = { ...state.properties[HALF], ownerId: human.id };
  human.properties.push(HALF);
  settleStreetBusiness(state);
  assert.equal(human.sliceStats.business, 500, '两间 Lv.1 × 250 应当结算 500');
  const line = businessLine(state, human);
  assert.match(line, /营业进项已入 500/, `侧栏应当报出已入账的数，实得：${line}`);
  // 已凑齐时买地屏不该再推销这件事。
  assert.equal(streetBusinessIncrement(state, { streetName: HUMAN_STREET, big: false }, HALF), '');
});

test('营业进项：这块地已经在我手上的列表里时，试算不会把它塞第二遍', () => {
  const { state, human } = fresh();
  // 构造「归属已经是我、但街还没凑齐」的中间态（另一块是别条街），再对同一块试算。
  const lenBefore = human.properties.length;
  state.properties[HALF] = { ...state.properties[HALF], ownerId: human.id };
  human.properties.push(HALF);
  const lenWithHalf = human.properties.length;
  assert.equal(lenWithHalf, lenBefore + 1);
  // 再对同一块调一次：`includes` 应当拦住重复 push，收尾也只截回调用前的长度。
  streetBusinessIncrement(state, { streetName: HUMAN_STREET, big: false }, HALF);
  assert.equal(human.properties.length, lenWithHalf, '试算不该把同一块地记两遍');
  assert.equal(human.properties.filter(id => id === HALF).length, 1);
});

test('营业进项：试算把 state.properties 与 p.properties 原样还回来（内容与身份）', () => {
  const { state, human } = fresh();
  const propsObj = state.properties;
  const mineArr = human.properties;
  const mineLen = mineArr.length;
  const cell = state.properties[HALF];
  const before = JSON.stringify(state.properties);

  streetBusinessIncrement(state, { streetName: HUMAN_STREET, big: false }, HALF);
  streetBusinessIncrement(state, { streetName: HUMAN_STREET, big: false }, HALF);

  assert.equal(state.properties, propsObj, 'state.properties 的对象身份不该被换掉');
  assert.equal(state.properties[HALF], cell, '那一格应当是原来那个对象');
  assert.equal(human.properties, mineArr, 'p.properties 的数组身份不该被换掉（#3424 修的就是这个）');
  assert.equal(mineArr.length, mineLen);
  assert.equal(JSON.stringify(state.properties), before, '逐字段也该一模一样');
});

test('营业进项：书屋不参与（大建筑走另一条口径）', () => {
  const { state, human } = fresh();
  assert.equal(streetBusinessIncrement(state, { streetName: '书屋', big: true }, 'market'), '');
  assert.equal(businessLine(state, human).includes('书屋'), false);
});
