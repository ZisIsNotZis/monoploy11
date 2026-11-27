import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeSteps, rentRowsFor, stepPaybackSection } from '../src/ui/slice.js';

// #949：「这一步值不值」——把回本从**整局累计**改到**按升级那一步、按天对齐**。
//
// 改前口径的两处具体错（实测 94 步里踩到 8 次）：
//   ① 升级前该店收的租金被算进这一步；
//   ② 同一间店升两次时，两次花费被并成一次。
//
// 每个负对照只踩一条规矩，否则测的不是那条规矩。

const plots = [
  { id: 'p1', name: '晨光街茶铺', big: false },
  { id: 'p2', name: '街心书屋', big: true },
  { id: 'p3', name: '东巷小店', big: false },
];
const mk = ({ log = [], history = [], human = '我' } = {}) => ({
  players: [
    { id: 'h', name: human, controller: 'human', alive: true },
    { id: 'a', name: '甲', controller: 'ai', alive: true },
  ],
  map: { plots }, config: { dayLimit: 16 },
  log, slice: { history, assetByDay: [] },
});
// 用词必须与引擎原文逐字一致（flow.js:728 / FlowPay 两行）：名字后面有空格。
// 夹具先写错过一次（写成「我将…」），结果 upgradeSteps 一步都认不出来、11 条测试里 9 条报空 ——
// 那种情况下测试看着在跑，实际什么也没钉住。
const upPaid = (plot, lv, cost) => `我 将 ${plot} 升到 Lv.${lv}（花费 ${cost}）`;
const upFree = (plot, lv) => `我 使用 翻修 → ${plot}，升到 ${lv} 级`;
const paidRow = (day, payer, plot, n) => ({ day, text: `${payer} 实付租金 ${n}（${plot}），我 收到 ${n}` });
const oweRow = (day, payer, plot, n) => ({ day, text: `${payer} 向 我 应付租金 ${n}（${plot}）` });

// ——— 正向：只有这一步之后的租金算进来 ———
test('按步切段：升级之后的租金才算，首次够本那天要说得出来', () => {
  const s = mk({
    log: [paidRow(3, '甲', '晨光街茶铺', 4000),          // 升级前的，不该算
      { day: 5, text: upPaid('晨光街茶铺', 2, '6000') },
      paidRow(7, '甲', '晨光街茶铺', 4000),
      paidRow(9, '甲', '晨光街茶铺', 4000)],
    history: [{ day: 5, playerId: 'h', lines: [upPaid('晨光街茶铺', 2, '6000')] }],
  });
  const [step] = upgradeSteps(s);
  assert.equal(step.earned, 8000, '只算第 5 天之后的 8,000');
  assert.equal(step.hits, 2, '两次踩到');
  assert.notEqual(step.earned, 12000, '把升级前那 4,000 算进来就会变 12,000 —— 这是旧口径的错');
  assert.ok(step.earned >= step.target, '8,000 ≥ 6,000 应判够本');
  assert.equal(step.firstDay, 9, '累计到第 9 天才够 6,000');
  assert.match(step.verdict, /已回本，第 9 天收回本钱/);
});

// ——— 负对照①：升级前的租金不归这一步 ———
test('负对照①：同一间店升级前收的租金，不能算成这一步已经回本', () => {
  const s = mk({
    log: [paidRow(2, '甲', '晨光街茶铺', 20000),
      { day: 6, text: upPaid('晨光街茶铺', 2, '10000') },
      paidRow(8, '甲', '晨光街茶铺', 1000)],
    history: [{ day: 6, playerId: 'h', lines: [upPaid('晨光街茶铺', 2, '10000')] }],
  });
  const [step] = upgradeSteps(s);
  assert.equal(step.earned, 1000, '这一步只收到 1,000');
  assert.ok(step.earned < step.target, '1,000 < 10,000，没够本');
  assert.equal(/已回本/.test(step.verdict), false, `升级前那 20,000 不能拿来抵这一步：${step.verdict}`);
});

// ——— 负对照②：同一间店两次升级，花费不能并成一次 ———
test('负对照②：升两次是两个单位，各自的花费各自算、租金各归各段', () => {
  const s = mk({
    log: [{ day: 2, text: upPaid('东巷小店', 2, '5000') },
      paidRow(3, '甲', '东巷小店', 5000),
      { day: 6, text: upPaid('东巷小店', 3, '15000') },
      paidRow(7, '甲', '东巷小店', 3000)],
    history: [
      { day: 2, playerId: 'h', lines: [upPaid('东巷小店', 2, '5000')] },
      { day: 6, playerId: 'h', lines: [upPaid('东巷小店', 3, '15000')] },
    ],
  });
  const steps = upgradeSteps(s);
  assert.equal(steps.length, 2, '两次升级是两个单位，不能合并成一条');
  assert.equal(steps[0].earned, 5000, '第一步只拿第 3 天那 5,000，不拿第 7 天的');
  assert.equal(steps[0].state, 'ok', '5,000 ≥ 5,000 够本');
  assert.equal(steps[1].earned, 3000, '第二步只拿第 7 天那 3,000');
  assert.equal(steps[1].target, 15000, '第二步的花费是 15,000，不是并起来的 20,000');
  assert.equal(/已回本/.test(steps[1].verdict), false, `第二步 3,000 < 15,000：${steps[1].verdict}`);
});

// ——— 负对照③：别的店的租金不归这一步 ———
test('负对照③：别的店收到的租金不能算进这一步', () => {
  const s = mk({
    log: [{ day: 4, text: upPaid('晨光街茶铺', 2, '6000') },
      paidRow(5, '甲', '东巷小店', 9000),
      paidRow(6, '甲', '晨光街茶铺', 1000)],
    history: [{ day: 4, playerId: 'h', lines: [upPaid('晨光街茶铺', 2, '6000')] }],
  });
  const [step] = upgradeSteps(s);
  assert.equal(step.earned, 1000, '只算这间店的 1,000');
  assert.equal(/已回本/.test(step.verdict), false, `东巷那 9,000 不归晨光街：${step.verdict}`);
});

// ——— 负对照④：0 元行（停业封租）—
test('负对照④：撞上停业算被踩到，但不能算收到钱', () => {
  const s = mk({
    log: [{ day: 4, text: upFree('晨光街茶铺', 2) },
      paidRow(5, '甲', '晨光街茶铺', 0)],
    history: [{ day: 4, playerId: 'h', lines: [upFree('晨光街茶铺', 2)] }],
  });
  const [step] = upgradeSteps(s);
  assert.equal(step.hits, 1, '走过一次要算被踩到');
  assert.equal(step.zeroHits, 1, '要单列停业那次');
  assert.equal(step.earned, 0, '一分钱没收');
  assert.equal(/已回本/.test(step.verdict), false, `0 元不能说够本：${step.verdict}`);
  assert.match(step.verdict, /一次也没收到钱/);
});

// ——— 负对照⑤：应付 ≠ 实付 ———
test('负对照⑤：对方付不出时，只能算真到账的钱（不是应缴的）', () => {
  const s = mk({
    log: [{ day: 4, text: upPaid('街心书屋', 2, '20000') },
      oweRow(5, '甲', '街心书屋', 19200),
      paidRow(5, '甲', '街心书屋', 14000)],
    history: [{ day: 4, playerId: 'h', lines: [upPaid('街心书屋', 2, '20000')] }],
  });
  const [step] = upgradeSteps(s);
  assert.equal(step.earned, 14000, '只能算真到账的 14,000');
  assert.notEqual(step.earned, 33200, '应付+实付相加或只读应付都会把没收到的钱算成收入');
  assert.equal(step.hits, 1, '两条行是同一次收租，不能算两次');
});

// ——— 记分口径 vs 现金口径 ———
test('记分上不亏但现金没收回：必须两个数都写，不能说「已回本」', () => {
  const s = mk({
    log: [{ day: 3, text: upPaid('东巷小店', 2, '10000') },
      paidRow(4, '甲', '东巷小店', 7000)],
    history: [{ day: 3, playerId: 'h', lines: [upPaid('东巷小店', 2, '10000')] }],
  });
  const [step] = upgradeSteps(s);
  assert.equal(step.value, 4000, '小店一级抬 4,000 标价');
  assert.equal(step.cashNeed, 6000, '现金上要收够 10,000 − 4,000 = 6,000');
  assert.equal(step.earned, 7000, '7,000 ≥ 6,000，记分上不亏');
  assert.equal(step.state, 'unread', '但 7,000 < 10,000，现金没收回，不算够本');
  assert.equal(/已回本/.test(step.verdict), false, `不能说已回本：${step.verdict}`);
  assert.match(step.verdict, /记分上不亏/);
  assert.match(step.verdict, /现金还差 3,000/);
  assert.equal(/现金还差 -/.test(step.verdict), false, `现金缺口不可能是负数：${step.verdict}`);
});

// ——— 旧断言靠的两种写法都要保留 ———
test('段落保留旧标题与「实收 N 次 / 金额」写法（已签收断言钉着）', () => {
  const s = mk({
    log: [{ day: 4, text: upFree('晨光街茶铺', 2) }, paidRow(5, '甲', '晨光街茶铺', 4200)],
    history: [{ day: 4, playerId: 'h', lines: [upFree('晨光街茶铺', 2)] }],
  });
  const html = stepPaybackSection(s);
  assert.match(html, /你升级过的店，本局到底回本没有/);
  assert.match(html, /实收 1 次 \/ 4,200/);
  assert.match(html, /第 4 天/);
  assert.match(html, /第 5 天收回本钱/);
});

test('不是人类升的店不进这一段', () => {
  const s = mk({
    log: [{ day: 4, text: '甲 将 东巷小店 升到 Lv.2（花费 10000）' }],
    history: [{ day: 4, playerId: 'a', lines: ['甲 将 东巷小店 升到 Lv.2（花费 10000）'] }],
  });
  assert.equal(upgradeSteps(s).length, 0);
  assert.equal(stepPaybackSection(s), '');
});

// ——— 句子纪律 ———
test('判定里不出现评价词，也不出现比较符（只给事实）', () => {
  const s = mk({
    log: [{ day: 3, text: upPaid('东巷小店', 2, '10000') }, paidRow(4, '甲', '东巷小店', 7000)],
    history: [{ day: 3, playerId: 'h', lines: [upPaid('东巷小店', 2, '10000')] }],
  });
  for (const step of upgradeSteps(s)) {
    for (const w of ['值得', '不值得', '因为', '导致', '应该']) {
      assert.equal(step.verdict.includes(w), false, `出现评价词「${w}」：${step.verdict}`);
    }
    assert.equal(/>/.test(step.verdict), false, '判定里不该出现比较符');
  }
});

// ——— #981：付费档的「0 次踩到」必须能分清「没人来」与「钱记在下一步」———
test('#981 付费档 0 次踩到：并列出本局该店共被踩几次、这次升级之后几次', () => {
  const s = mk({
    log: [{ day: 4, text: upPaid('东巷小店', 2, '10000') }],
    history: [{ day: 4, playerId: 'h', lines: [upPaid('东巷小店', 2, '10000')] }],
  });
  const [step] = upgradeSteps(s);
  assert.equal(step.hits, 0);
  assert.equal(step.wholeHits, 0, '本局这间店一次也没被踩');
  assert.equal(step.afterUpHits, 0);
  assert.match(step.verdict, /本局这间店一共被踩 0 次/, `应并列出整局次数：${step.verdict}`);
  assert.match(step.verdict, /这次升级之后 0 次/);
});

test('#981 付费档：钱到了但落在下一次升级之后 —— 两个数必须不一样', () => {
  const s = mk({
    log: [{ day: 2, text: upPaid('东巷小店', 2, '10000') },
      { day: 5, text: upFree('东巷小店', 3) },
      paidRow(9, '甲', '东巷小店', 6000)],
    history: [
      { day: 2, playerId: 'h', lines: [upPaid('东巷小店', 2, '10000')] },
      { day: 5, playerId: 'h', lines: [upFree('东巷小店', 3)] },
    ],
  });
  const [first] = upgradeSteps(s);
  assert.equal(first.hits, 0, '窗口在下一次升级就截止了，这一段 0 次');
  assert.equal(first.wholeHits, 1, '整局这间店被踩过 1 次');
  assert.equal(first.afterUpHits, 1, '这次升级之后确实来过 1 次');
  assert.match(first.verdict, /一共被踩 1 次/, `必须能看出「人来了」：${first.verdict}`);
  assert.match(first.verdict, /这次升级之后 1 次/);
  assert.equal(/已回本/.test(first.verdict), false, '钱不在这一步的窗口里，不能说已回本');
});

test('#981 免费档的那句话逐字不动（这条钉子守已签收措辞）', () => {
  const s = mk({
    log: [{ day: 4, text: upFree('晨光街茶铺', 2) }],
    history: [{ day: 4, playerId: 'h', lines: [upFree('晨光街茶铺', 2)] }],
  });
  const [step] = upgradeSteps(s);
  assert.equal(step.verdict, '这一步之后 0 次踩到 — 账面回本没兑现',
    `免费档多一个字都算改已签收的句子：${step.verdict}`);
});

// ——— rentRowsFor 的基本契约（供上面几条共用的底座） ———
test('rentRowsFor：实付优先、应付只兜底，不重复计同一次收租', () => {
  const s = mk({
    log: [{ day: 5, text: '甲 向 我 应付租金 19200（街心书屋）' },
      { day: 5, text: '甲 实付租金 14000（街心书屋），我 收到 14000' },
      { day: 6, text: '甲 向 我 应付租金 3000（东巷小店）' }],
  });
  const rows = rentRowsFor(s, s.players[0]);
  assert.equal(rows.length, 2, '同一次收租的两条行只能折成一行');
  assert.deepEqual(rows.map(r => r.earned).sort((a, b) => a - b), [3000, 14000]);
});
