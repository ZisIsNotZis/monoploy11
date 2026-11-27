import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig, SLICE_MAP } from '../src/data/slice.js';
import { startSession, runGame, buyPlot, buildPlot } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { assetsOf, rentFor, buildCost } from '../src/engine/economy.js';
import { render } from '../src/ui/render.js';
import { nextGameLine, money } from '../src/ui/slice.js';
import {
  MARKET_LEDGER, MARKET_SOURCE, MARKET_PLOT, buyLedgerFacts, buyLedgerLines,
  holdLeversFacts, bigBuildCost,
} from '../src/engine/market-ledger.js';

// #3338（supervisor #3358 在 a7564dd 的真机上抓到的两处「绕晕」）：
//
//   ① 满级书屋那支叫他「下一局把它放在你的路线上（停步的落点选它旁边），满级的租才收得到」。
//      他自己那一局（grow/seed 9）停在书屋旁边 7 次，一分钱没收 —— 引擎里自己的店只问加盖。
//   ② 买地时劝退（「72 局里 56 局的整局租金还不够这一笔」），打完却叫他第 4 天去买。
//
// 两处的根因都是**两屏用了不同的账**：买地屏拿花掉的钱去比全场租金池，结算屏比的是
// 「买了 vs 没买」的终局差。所以修法不是在两边各改字，而是让两边读同一份数。
//
// 这个文件钉四件事：
//   A. 账是真的：买地前后总资产差 0（真 buyPlot + 真 assetsOf），不是我在句子里这么写；
//   B. 两屏同源：买地屏的常数行与结算屏的常数句都来自 MARKET_LEDGER，逐字可对；
//   C. 口径不混：「本局账本」那几行只许出现本局数；常数行必须自报来源；
//   D. 书屋加盖报的是引擎真扣款（30,000），不是小店价（buildCost）。
//
// 反向对照（D2）在下面：把小店价塞回那句话，判据必须变红。

const strip = s => String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const human = state => state.players.find(p => p.controller === 'human');

function mkRoot() {
  const mk = () => ({ innerHTML: '', hidden: false, scrollTop: 0, scrollHeight: 0,
    querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
    style: {}, getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }) });
  const root = {};
  for (const k of ['system', 'players', 'board', 'log', 'insight', 'dice', 'cards', 'hand', 'choice']) root[k] = mk();
  return root;
}
const noop = new Proxy({}, { get: () => () => {} });

// 一块「第 4 天、无主、无主已建」的真地：就是买地屏真实会遇到的形状。
function buyFixture(style = 'grow', seed = 7) {
  const state = startSession(createSliceConfig({ human: true, seed, style }));
  state.day = 4;
  const plot = state.map.plots.find(x => x.big);
  return { state, plot, me: human(state) };
}

// 小店夹子：C / C3 要看的是「路线 + 现金压力 + 走位」三种标签共存，
// 而 buyFixture 给的是书屋（书屋没有同街邻居，路线那一行按设计不印）。
function buyLedgerLinesFixture(style = 'cross', seed = 1) {
  const state = startSession(createSliceConfig({ human: true, seed, style }));
  state.day = 4;
  const me = human(state);
  // 挑一块真能在屏上出现的无主小店：开售了、买得起。
  const plot = state.map.plots.find(x => !x.big && !state.properties[x.id].ownerId
    && state.day >= (x.availableFromDay ?? 1) && buyLedgerFacts(state, x.id, me)?.cashAfter >= 0);
  assert.ok(plot, '夹具里没有可买的小店');
  return { state, plot, me };
}

function renderBuy(state, plot) {
  const root = mkRoot();
  const saved = state.pending;
  state.pending = { type: 'buy', cellId: plot.id, price: buyLedgerFacts(state, plot.id).price,
    label: '大空地', level: state.properties[plot.id].level, bigType: state.properties[plot.id].bigType };
  render(root, state, noop);
  state.pending = saved;
  return root.choice.innerHTML;
}

// ── A. 账是真的，而且是引擎算的 ────────────────────────────────────────────────
test('A 买下无主地：真 buyPlot 前后总资产差 0、现金正好少一个标价', () => {
  const { state, plot, me } = buyFixture();
  const facts = buyLedgerFacts(state, plot.id, me);
  assert.ok(facts, '算不出这一笔的账');
  const before = assetsOf(state, me), cash0 = me.cash;
  buyPlot(state, me, plot.id, plot);
  assert.equal(assetsOf(state, me) - before, facts.assetsDelta,
    '句子里写的资产变化与真 buyPlot 的结果不一致');
  assert.equal(cash0 - me.cash, facts.price, '现金变化不等于标价');
  assert.equal(facts.assetsDelta, 0, '无主买地的总资产变化必须是 0（现金 → 同价的地）');
});

// #3358 supervisor 在 grow/19 第 4 天抓到的真缺陷：现金 13,000、书屋 26,000，
// 而三行账还在算「现金 13,000 → -13,000」与「够付 -3 次」—— 算术真、可用假。
// 买不起时玩家的问题不是「买完剩多少」，是「差多少」。
test('A2 买不起时：只说差多少 + 那份 72 局表，不印任何负数“买完剩…”', () => {
  const { state, plot, me } = buyFixture('grow', 19);
  me.cash = 13_000;
  const facts = buyLedgerFacts(state, plot.id, me);
  assert.ok(facts.cashAfter < 0, '夹具没造成「买不起」的局面');
  assert.equal(facts.assetsDelta, 0, '买不起也仍是资产换手（这一点不变）');
  const lines = buyLedgerLines(state, plot.id, me);
  const text = lines.join(' ');
  assert.match(text, /买不起/, `没有说买不起：${text}`);
  assert.ok(text.includes(money(-facts.cashAfter)), `没说差多少（应含 ${money(-facts.cashAfter)}）：${text}`);
  // 关键：任何负数都不许出现。它只会让玩家算「-13,000 是什么意思」。
  assert.doesNotMatch(text, /-\d/, `出现了负数：${text}`);
  assert.doesNotMatch(text, /够付 -\d|→ -\d/, `还在算买完的负数：${text}`);
  // 那份 72 局表仍必须在 —— 它对下一局有用，而这一屏正是玩家在想「要不要留钱」的时刻。
  assert.match(text, /同规则 72 局/, `买不起时把最有用的那一行也丢了：${text}`);
});

// 「够付 0 次」算术对，但读起来像 bug（supervisor 在 grow/4 上也提到了）。
test('A3 买完现金不够付一次租：不许印「够付 0 次」，要说清一次都付不起', () => {
  const { state, plot, me } = buyFixture('grow', 4);
  // 造成「刚好买得起、剩 0 元」：这是「够付 0 次」界面的真实形状。
  const probe = buyLedgerFacts(state, plot.id, me);
  me.cash = probe.price;
  const f = buyLedgerFacts(state, plot.id, me);
  assert.equal(f.cashAfter, 0, '夹具没把现金调到恰好够价');
  if (!(f.rivalMaxRent > 0 && f.cashAfter >= 0 && f.hitsCovered === 0)) return; // 夹具不成立就不假装验证过
  const text = buyLedgerLines(state, plot.id, me).join(' ');
  assert.doesNotMatch(text, /够付 0 次/, `印了「够付 0 次」：${text}`);
  assert.match(text, /连一次都付不起/, `没说清一次都付不起：${text}`);
});

// ── B. 两屏同源 ───────────────────────────────────────────────────────────────
test('B 买地屏与结算屏引的是同一份表、同一句话的来源', () => {
  const buyState = buyFixture();
  const html = renderBuy(buyState.state, buyState.plot);
  assert.ok(html.includes(MARKET_SOURCE), `买地屏没报来源：${html}`);

  // 结算屏：对手拿走书屋那一支，必须同时报来源与同一个 mean。
  const end = startSession(createSliceConfig({ human: true, seed: 1, style: 'grow' }));
  const rival = end.players.find(p => p.team !== human(end).team);
  end.properties.market = { ...end.properties.market, ownerId: rival.id, level: 2 };
  const line = nextGameLine(end);
  assert.ok(line.includes('72 局'), `结算屏没报来源：${line}`);
  assert.ok(line.includes(money(MARKET_LEDGER.whenMine.earnedMean)),
    `结算屏没引表里的均值 ${money(MARKET_LEDGER.whenMine.earnedMean)}：${line}`);
  assert.ok(line.includes(String(MARKET_LEDGER.whenMine.games)),
    `结算屏没引表里的局数：${line}`);
});

test('B2 两屏都不再说「不够本钱」那套（那是花掉的口径，不是换手）', () => {
  const { state, plot } = buyFixture();
  const html = renderBuy(state, plot);
  assert.equal(/整局租金还不够这一笔|一整局全场租金/.test(html), false,
    `买地屏还在用「收不回本钱」的口气：${html}`);
  // 结算屏的三支也都不许回到「这一笔占全场租金多少」。
  for (const setup of ['rival', 'mine', 'nobody']) {
    const s = startSession(createSliceConfig({ human: true, seed: 2, style: 'take' }));
    const me = human(s);
    if (setup === 'rival') {
      const r = s.players.find(p => p.team !== me.team);
      s.properties.market = { ...s.properties.market, ownerId: r.id };
    } else if (setup === 'mine') {
      s.properties.market = { ...s.properties.market, ownerId: me.id, level: 3 };
    } else {
      s.properties.market = { ...s.properties.market, ownerId: null };
    }
    const line = nextGameLine(s);
    assert.equal(/整局租金还不够|占全场租金/.test(line), false,
      `${setup} 支又回到「收不回本钱」的口径：${line}`);
  }
});

// ── C. 口径不混 ───────────────────────────────────────────────────────────────
// 这是 #1143 定下的纪律，也是 supervisor 被绕晕的真正原因：同一屏里若有「本局」与「72 局」
// 两种数，各自必须带标签。买地屏现在两行都带（「本局账本：」「同规则 72 局」）。
// #3343：行数从 3 行变多了（新增「这条路是补齐 / 开新的」一行），所以这里改成
// **按标签找行**而不是按位置取行 —— 保留的是纪律（每行自报口径），不是行号。
// 行序本身仍被 C3 钉着：记分 → 路线 → 现金压力 → 走位。
test('C 买地屏每一行都自带口径标签', () => {
  const { state, plot } = buyLedgerLinesFixture();
  const lines = buyLedgerLines(state, plot.id);
  assert.ok(lines.length >= 3, `应该至少三行账，实际 ${lines.length}`);
  const score = lines.find(l => /^本局账本：/.test(l));
  assert.ok(score, `没有记分那一行：${JSON.stringify(lines)}`);
  assert.ok(score.includes('总资产不变'), `记分行没说清资产换手：${score}`);
  const cash = lines.find(l => /买完剩/.test(l));
  assert.ok(cash, `没有现金压力那一行：${JSON.stringify(lines)}`);
  assert.match(cash, /此刻/, `现金压力那行的租金是当场值，必须写「此刻」：${cash}`);
  const walking = lines.find(l => /^同规则 72 局/.test(l));
  assert.ok(walking, `常量那一行没有自报来源：${JSON.stringify(lines)}`);
  // 「本局账本」那一行里不许出现任何常数（它是本局的账）。
  assert.equal(/72 局|seed/.test(score), false, `本局那行混进了常数口径：${score}`);
});

// C3 行序：记分在最前，走位（常数口径）在最后。数字读起来才不会把两本账混在一句里。
test('C3 行序：本局账本在最前，72 局常数在最后', () => {
  const { state, plot } = buyLedgerLinesFixture();
  const lines = buyLedgerLines(state, plot.id);
  assert.match(lines[0], /^本局账本：/);
  assert.match(lines[lines.length - 1], /^同规则 72 局/);
});

// C4 「这条路是补齐」那一行的钱必须能自己回算：
// 买下这块地后，我那条街的租金从 before 涨到 after，差就是它说的「每轮到手 +gain」。
// 这是 #3343 的新行 —— 用户要的那条「补齐一条街」，在此之前屏上完全看不见。
// C5 真入口撞到的那一屏：这条街**停业**时，买地屏原来整段只说「买下也收不到租」，
// 「这条路是补齐还是开新的」一个字不提 —— 而停业正是最该说清路线的时候。
// 判据：停业时仍要印出路线行，并且它用的是「开业时的价」，同时明写此刻在停业。
test('C5 街道停业时，路线那一行照样在，并说明上面的价是开业价', () => {
  const state = startSession(createSliceConfig({ human: true, seed: 1, style: 'cross', sliceContestedStreets: true }));
  const me = human(state);
  const target = state.map.plots.find(plot => !plot.big && !state.properties[plot.id].ownerId
    && state.map.plots.some(x => x.id !== plot.id && !x.big && x.street === plot.street
      && state.players.find(q => q.id === state.properties[x.id].ownerId)?.team === me.team));
  assert.ok(target, '争街夹具里应当存在一块能补齐的空地');
  // 把这条街整体停业。
  const closedSaved = {};
  for (const x of state.map.plots) if (x.street === target.street) {
    closedSaved[x.id] = state.properties[x.id].closed;
    state.properties[x.id] = { ...state.properties[x.id], closed: 2 };
  }
  try {
    const lines = buyLedgerLines(state, target.id, me);
    const route = lines.find(l => /^这条路是补齐/.test(l));
    assert.ok(route, `停业时路线行不见了：${JSON.stringify(lines)}`);
    // 停业时说的是「再次开业后」的价（supervisor 读不出「每轮到手」到底是哪一种）。
    assert.match(route, /再次开业时/, `停业时没说清这是哪个时候的价：${route}`);
    // 引擎真相：租金只在对手停过来时收。屏上不许出现「每轮 / 每回合到手」这种说法。
    assert.equal(/每轮到手|每回合到手/.test(route), false, `又把租金说成每回合进账了：${route}`);
    assert.match(route, /对手停到/, `没说清钱是什么时候到手：${route}`);
    assert.match(route, /停业/, `停业这件事必须写在同一句里：${route}`);
    // 真入口 OUT-3343-final 印过「再加上这间自己的 0」—— 0 不许当成一个数说出来。
    assert.equal(/再加上这间自己的 0\b/.test(route), false, `把 0 当成涨租印出来了：${route}`);
    // 而且那些数不能因为停业就变成 0 —— 0 → 0 等于什么都没说。
    const nums = route.match(/[\d,]{3,}/g) ?? [];
    assert.ok(nums.some(num => Number(num.replace(/,/g, '')) > 0), `停业把数字都抹成 0 了：${route}`);
  } finally {
    for (const [id, c] of Object.entries(closedSaved)) state.properties[id] = { ...state.properties[id], closed: c };
  }
});

test('C4 补齐那一行的涨租额与 rentFor 直接算的一致', () => {
  const state = startSession(createSliceConfig({ human: true, seed: 1, style: 'cross', sliceContestedStreets: true }));
  const me = human(state);
  const target = state.map.plots.find(plot => !plot.big && !state.properties[plot.id].ownerId
    && state.map.plots.some(x => x.id !== plot.id && !x.big && x.street === plot.street
      && state.players.find(q => q.id === state.properties[x.id].ownerId)?.team === me.team));
  assert.ok(target, '争街夹具里应当存在一块能补齐的空地');
  const f = buyLedgerFacts(state, target.id, me);
  assert.ok(f.streetMineCount >= 1 && f.streetGain > 0, `夹具没有触发补齐行情：${JSON.stringify(f)}`);
  const mine = state.map.plots.filter(x => x.id !== target.id && !x.big && x.street === target.street
    && state.players.find(q => q.id === state.properties[x.id].ownerId)?.team === me.team);
  const saved = { ...state.properties[target.id] };
  let before = 0, after = 0;
  for (const x of mine) before += rentFor(state, x.id);
  state.properties[target.id] = { ...saved, ownerId: me.id };
  for (const x of mine) after += rentFor(state, x.id);
  state.properties[target.id] = saved;
  assert.equal(f.streetBefore, before);
  assert.equal(f.streetAfter, after);
  const line = buyLedgerLines(state, target.id, me).find(l => /^这条路是补齐/.test(l));
  assert.ok(line, '没有印出补齐那一行');
  assert.ok(line.includes(money(before)) && line.includes(money(after)), `行里的两个数不是算出来的：${line}`);
  assert.ok(line.includes(money(after - before)), `没把「多收多少」说出来：${line}`);
});

test('C2 现金压力那一行的钱能自己回算：剩多少 ÷ 对手最贵一租 = 够付几次', () => {
  const { state, plot, me } = buyFixture();
  const f = buyLedgerFacts(state, plot.id, me);
  assert.ok(f.rivalMaxRent > 0, '夹具里对手没有能收租的店，这条断言会空过');
  assert.equal(f.hitsCovered, Math.floor(f.cashAfter / f.rivalMaxRent), '够付次数不是算出来的');
  const line = buyLedgerLines(state, plot.id)[1];
  assert.ok(line.includes(money(f.rivalMaxRent)) && line.includes(String(f.hitsCovered)),
    `这一行没有把两个数一起给出来：${line}`);
});

// ── D. 书屋加盖报的是引擎真扣款 ────────────────────────────────────────────────
test('D 书屋加盖：报的价 = 真 buildPlot 的扣款 = bigBuildCost，且不等于小店价', () => {
  const s = startSession(createSliceConfig({ human: true, seed: 1, style: 'grow' }));
  const me = human(s);
  s.properties.market = { ...s.properties.market, ownerId: me.id, level: 2 };
  me.cash = 500_000;
  const before = me.cash;
  buildPlot(s, me, MARKET_PLOT);
  const charged = before - me.cash;
  assert.equal(charged, bigBuildCost(s), 'bigBuildCost 与引擎扣款不一致');
  assert.notEqual(charged, Math.round(buildCost(3) * (s.priceIndex ?? 1)),
    '书屋与小店同价 —— 这条判据区分不了两个口径（说明夹具或公式变了）');
  const levers = holdLeversFacts(s, me);
  assert.ok(levers, '算不出持有者的杠杆');
  assert.equal(levers.buildCostToTop, null, '已经到顶了还报了一个加盖价');
});

test('D2 反面：把小店价塞回那句话，判据必须变红', () => {
  const s = startSession(createSliceConfig({ human: true, seed: 1, style: 'grow' }));
  const me = human(s);
  s.properties.market = { ...s.properties.market, ownerId: me.id, level: 2 };
  const wrong = Math.round(buildCost(3) * (s.priceIndex ?? 1));
  // 直接复算：句子里的数必须等于 bigBuildCost；把它换成 buildCost 就不等。
  assert.notEqual(wrong, bigBuildCost(s), '两个口径恰好同价时，这条负对照什么也证明不了');
  const facts = holdLeversFacts(s, me);
  assert.equal(facts.buildCostToTop, bigBuildCost(s));
  assert.notEqual(facts.buildCostToTop, wrong, '负对照没咬住');
});

// #3358 supervisor 在 grow/4 上抓到的第二处：终局那条街在停业，结算却说「每次 0 变 0」。
// 两个 0 相乘得 0 不是玩家的账；停业时 rentFor 直接返回 0，旺季卡盖不过它。
test('D3 书屋终局停业：旺季那句必须说清「停业先结束」，且不许出现「0 变 0」', () => {
  const s = startSession(createSliceConfig({ human: true, seed: 4, style: 'grow' }));
  const me = human(s);
  s.properties.market = { ...s.properties.market, ownerId: me.id, level: 3, closed: 1 };
  const levers = holdLeversFacts(s, me);
  assert.equal(levers.closed, 1, '夹具没把书屋置为停业');
  assert.equal(levers.rent, 0, '停业时 rentFor 应为 0');
  assert.ok(levers.reopened > 0, '停业结束后的租金应算得出来（这就是旺季的前提）');
  assert.equal(levers.reopenedInflated, levers.reopened * 2);
  const line = nextGameLine(s);
  assert.doesNotMatch(line, /0 变 0/, `又印了一遍「0 变 0」：${line}`);
  assert.match(line, /停业/, `没说这条街在停业：${line}`);
  assert.ok(line.includes(money(levers.reopened)) && line.includes(money(levers.reopenedInflated)),
    `没给出停业结束后的两个数（${money(levers.reopened)} 变 ${money(levers.reopenedInflated)}）：${line}`);
});

// ── E. 表不是编的 ─────────────────────────────────────────────────────────────
test('E 表自洽：归属局数之和 = 72，分布条数 = 局数，均值在分布范围内合理', () => {
  const { ownership, whenMine, games } = MARKET_LEDGER;
  assert.equal(games, 72, '表的前提是 72 局（与 RENT_POOL / LANDING_STATS 同一批量）');
  assert.equal(ownership.mine + ownership.rival + ownership.nobody, games, '归属局数之和不是 72');
  assert.equal(whenMine.games, ownership.mine, '我持有时统计的局数不等于归属表里的局数');
  assert.equal(whenMine.stoppedByRival.reduce((a, b) => a + b, 0), whenMine.games,
    '被踩分布的局数之和不等于我持有的局数');
  assert.ok(whenMine.earnedZero <= whenMine.games);
  assert.ok(whenMine.myOwnStops.total >= whenMine.myOwnStops.games, '自己停的总次数少于局数');
});

// 抽一局真跑，核「自己停旁边从不收租」这条引擎事实 —— 这是 supervisor 报的那个坑的根。
test('E2 真局抽样：我持有书屋时，日志里没有任何一笔「我为书屋付租」的行', async () => {
  let checked = 0, selfStops = 0, selfPaid = 0;
  for (const [style, seed] of [['grow', 9], ['take', 4], ['cross', 3]]) {
    const state = startSession(createSliceConfig({ human: true, seed, style }));
    await runGame(state, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, state); } });
    const me = human(state);
    if (state.properties.market?.ownerId !== me.id) continue;
    checked += 1;
    for (const e of state.log ?? []) {
      const text = String(e.text);
      if (new RegExp(`^${me.name} 停在 \\S+，旁边是 街心书屋$`).test(text)) selfStops += 1;
      // 引擎只会写「X 实付租金 N（街心书屋），Y 收到 N」。我持有它时，付款方不可能是自己。
      if (new RegExp(`^${me.name} 实付租金 \\d+（街心书屋）`).test(text)) selfPaid += 1;
    }
  }
  // 拿到书屋的那几局里，自己停旁边的次数是真实存在的（这正是玩家会误以为能收租的时刻）。
  assert.ok(checked >= 1, '抽样里没有一局我拿到书屋，这条判据会空过');
  assert.ok(selfStops >= 1, '抽样里我一次也没停在自己书屋旁边 —— 那这条判据什么也没验证');
  assert.equal(selfPaid, 0, `我持有书屋的局里出现了「我为它付租」${selfPaid} 次 —— 自己的店不收自己的租，这就是 supervisor 那个坑的根`);
});
