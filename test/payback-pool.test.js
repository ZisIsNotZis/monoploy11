import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig, SLICE_MAP } from '../src/data/slice.js';
import { startSession, runGame, buildPlot } from '../src/engine/flow.js';
import { sliceAnswer } from '../src/engine/slice-ai.js';
import { rentFor } from '../src/engine/economy.js';
import { render } from '../src/ui/render.js';
import { RENT_POOL, paybackFacts, poolShareLine, poolKLine, roundsToRecover, roundsLine, POOL_SOURCE } from '../src/engine/payback.js';
import { buildForwardLine } from '../src/ui/slice.js';

// #1044：付费加盖/买地那句
//
// 为什么改：#993 的主句是「满 K 次一定够本」。K 算术上成立，但 #998 用同一批 21 局量出
// 130 条提议里 K 被真达到 0 次（跨臂最多 4/354）——真发生的付费升级花掉 990,000，
// 而全场租金合计只有 468,600。玩家按这句话做决定，等于按一个不会发生的条件做决定。
//
// 钉五件事：
//   1. 主句是一个来自本盘实测的分母（不是未来量、不是 K 的同义改写）；
//   2. 三个打印点（提议框 / 加盖日志 / 买地框）用的是同一份取数与同一个 ceil；
//   3. K 降为尾部，但 #993 已签的不变量仍在（满 N 次一定够本，不写「才够本/至少要」）；
//   4. 停业仍然不说话就错：必须说话，且不说 K；
//   5. 表不是编的：逐局数组的均值/中位与单独量出来的对得上，店名与棋盘一致。

function root() {
  const mk = () => ({ innerHTML: '', hidden: false, scrollTop: 0, scrollHeight: 0,
    querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
    style: {}, getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }) });
  return new Proxy({}, { get: (t, k) => (t[k] ??= mk()) });
}
const noop = new Proxy({}, { get: () => () => {} });
const slice = (seed = 7, style = 'grow') => startSession(createSliceConfig({ seed, style }));

function renderBuild(state, cellId, cost) {
  const r = root();
  const saved = state.pending;
  state.pending = { type: 'build', cellId, cost, label: '小地产' };
  render(r, state, noop);
  state.pending = saved;
  return r.choice.innerHTML;
}

// #1143：「本盘」二字已经从常数句里拿掉（72 局常数不是这一局）。
// 主句现在必须先报来源，因此标记取来源前缀。
const POOL_MARK = '同规则 72 局';

// ① 提议框主句：池子比例必须在 K 句之前，且必须先报来源（#1143）。
test('#1044 提议框主句是池子比例，且排在 K 句之前', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 1;
  const html = renderBuild(s, id, 10000);
  const line = /data-forward-k[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1];
  assert.ok(line, `提议框里没有前向句：${html}`);
  const poolIdx = line.indexOf(POOL_MARK);
  assert.ok(poolIdx >= 0, `主句不是池子比例：${line}`);
  const kIdx = line.indexOf('满 2 次一定够本');
  assert.ok(kIdx > poolIdx, `K 句跑到了池子句前面（K 还在当主句）：${line}`);
  assert.ok(line.startsWith(POOL_MARK.slice(0, 6)) || poolIdx < 10, `池子句不在句首：${line}`);
  // #993 已签的不变量不能丢
  assert.equal(/才够本/.test(line), false, `把够本写成了下限：${line}`);
  assert.equal(/至少要/.test(line), false, `把够本写成了下限：${line}`);
  // 本单新增的硬约束：主句不许是预测
  assert.equal(/预计|大概会|应该会/.test(line), false, `主句里出现了预测口气：${line}`);
  // #1143 硬约束：常数不许挂「本盘」/「本局」。
  assert.equal(/本盘|本局/.test(line), false, `常数句里出现了「本盘/本局」：${line}`);
  assert.ok(line.startsWith(POOL_MARK), `主句没有先报来源：${line}`);
});

// ② 三个打印点同源：同样的 (cost, 店名) 出同样的池子句；回合数只由一个 ceil 出。
test('#1044 三个打印点的池子句与回合数来自同一个实现', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  const plot = s.map.plots.find(x => x.id === id);
  const cost = 10000;
  const expected = poolShareLine(cost, plot.name);
  assert.ok(expected.length > 0);
  // 提议框
  s.properties[id].level = 1;
  const line = /data-forward-k[^>]*>([\s\S]*?)<\/p>/.exec(renderBuild(s, id, cost))?.[1] ?? '';
  assert.ok(line.includes(POOL_MARK), `提议框没接共享句：${line}`);
  // 日志（引擎）：必须是新增的「这笔账」行，不是把池子数塞进 Q3 半句
  p.cash = 999_999;
  buildPlot(s, p, id);
  const poolRow = s.log.filter(e => e.text.includes(POOL_MARK)).map(e => e.text);
  assert.equal(poolRow.length, 1, `日志里应恰好一行池子句，实际 ${poolRow.length}：${poolRow.join(' / ')}`);
  assert.ok(poolRow[0].endsWith(expected), `日志与提议框的池子句不一致：\n日志 ${poolRow[0]}\n期望结尾 ${expected}`);
  // 回合数：唯一实现
  const rent = rentFor(s, id);
  const prev = (() => { const lv = s.properties[id].level; s.properties[id].level = lv - 1;
    const v = rentFor(s, id); s.properties[id].level = lv; return v; })();
  const gain = rent - prev;
  assert.equal(roundsToRecover(cost, gain), Math.max(1, Math.ceil(cost / gain)));
  assert.equal(roundsLine(cost, gain), `${Math.max(1, Math.ceil(cost / gain))} 回合回本`);
});

// ③ 日志里「；」之后仍然只有 rentFor 一个金额（#807 已签，不许被新句撞坏）。
//    这条单独测一遍，是因为它最容易在“顺手把新数塞进旧半句”时破。
test('#1044 新句没有污染 Q3 半句（「；」之后只许 rentFor 那一个金额）', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  p.cash = 999_999;
  s.properties[id].level = 1;
  buildPlot(s, p, id);
  const up = s.log.filter(e => /升到 Lv\./.test(e.text)).pop()?.text ?? '';
  assert.ok(up.includes('；'), `升级行里没有 Q3 半句：${up}`);
  const q3 = up.slice(up.indexOf('；'));
  const nums = [...new Set([...q3.matchAll(/[\d,]{3,}/g)].map(m => m[0]))];
  assert.deepEqual(nums, [rentFor(s, id).toLocaleString()],
    `Q3 半句混进了别的金额：${JSON.stringify(nums)} :: ${q3}`);
});

// ④ 停业：必须说话，不说 K，也不说比例（那笔本钱在停业期间没有回收路径）。
test('#1044 停业时照实说算不出，且不印池子比例', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].closed = 2;
  const line = buildForwardLine(s, id, 10000);
  assert.ok(line.includes('停业'), `停业时没说出来：${line}`);
  assert.equal(/满 \d+ 次/.test(line), false, `停业时不该印 K：${line}`);
  assert.equal(line.includes(POOL_MARK), false, `停业时不该印“占全场租金多少”：${line}`);
});

// ⑤ 表不是编的。两件事：逐局数组自洽（条数/均值），以及从真跑里抽样复现量级。
test('#1044 租金池表自洽，且与真跑抽样对得上', async () => {
  assert.equal(RENT_POOL.innings.length, RENT_POOL.games, '逐局数组条数不等于局数');
  const asc = [...RENT_POOL.innings].sort((a, b) => a - b);
  assert.deepEqual(RENT_POOL.innings, asc, '逐局数组必须是升序（中位靠它取）');
  const mean = RENT_POOL.innings.reduce((a, b) => a + b, 0) / RENT_POOL.games;
  assert.equal(Math.round(mean), 15550, `均值变了：${mean}`);
  assert.equal(Object.keys(RENT_POOL.meansPerPlot).length, 13, '店数不是 13');
  assert.deepEqual(Object.keys(RENT_POOL.meansPerPlot).sort(), SLICE_MAP.plots.map(x => x.name).sort(),
    '表的店名与切片棋盘不一致（改棋盘忘改表）');
  const meansSum = Object.values(RENT_POOL.meansPerPlot).reduce((a, b) => a + b, 0);
  const fromRows = RENT_POOL.rentRows / RENT_POOL.games;
  assert.ok(Math.abs(meansSum - fromRows) < 0.05,
    `每店均值之和 ${meansSum.toFixed(3)} 与收租行/局 ${fromRows.toFixed(3)} 对不上`);

  // 抽样：3 局，量整局真到账租金，落进表的范围（最低 0、最高 58,600）
  const sample = [];
  for (const [style, seed] of [['grow', 1], ['take', 5], ['cross', 11]]) {
    const s = startSession(createSliceConfig({ seed, style }));
    let n = 0;
    await runGame(s, { render() {}, async step() {}, async say() {},
      async ask(q) { if (++n > 20000) throw new Error('limit'); s.pending = null; s.mapPick = null; return sliceAnswer(q, s); } });
    sample.push(s.stats.rents);
  }
  for (const v of sample) {
    assert.ok(v >= Math.min(...RENT_POOL.innings) && v <= Math.max(...RENT_POOL.innings),
      `抽样局的真到账租金 ${v} 落在表的范围外（${Math.min(...RENT_POOL.innings)}–${Math.max(...RENT_POOL.innings)}）`);
  }
});

// ⑥ 句子里每个数都能在表里找到，且没有被四舍五入抬大。
test('#1044 池子句里的数出自表，且百分比不向上取整', () => {
  const f = paybackFacts(10000);
  const mean = RENT_POOL.innings.reduce((a, b) => a + b, 0) / RENT_POOL.games;
  assert.equal(f.mean, mean);
  assert.equal(f.gamesBelow, RENT_POOL.innings.filter(x => x < 10000).length);
  assert.equal(f.gamesBelow, 29, `10,000 那档的局数变了：${f.gamesBelow}`);
  const line = poolShareLine(10000, '晨光街茶铺');
  const pct = Number(/([\d.]+)%/.exec(line)?.[1]);
  assert.ok(pct <= 100 * 10000 / mean + 1e-9, `百分比比真值还大：${pct} vs ${100 * 10000 / mean}`);
  assert.ok(Math.abs(pct - Math.round(100 * 10000 / mean * 10) / 10) < 1e-9, `百分比不是一位小数：${line}`);
  assert.ok(line.includes('15,550'), `句子里没有均值：${line}`);
  assert.ok(line.includes('72 局'), `句子里没有局数：${line}`);
});

// ⑦ 买地框（第三个打印点）也必须带池子句，并且要报**这间店自己的**实测频率。
//    为什么单独测：这条路径我在交付前真的漏读过一次 —— 调 poolShareLine 时忘了传店名，
//    于是它静默降级成“每间店平均 0.28 次（这间店没有单独实测）”，13 间店全都有实测表却说没有。
//    不报错的静默降级比报错危险，所以这里钉住店名必须被传下去。
test('#1044 买地框带池子句，且报的是这间店自己的实测频率', () => {
  const s = slice();
  // 选一块「此刻买下真能收到租」的地：收不到租时买地框走的是另一句（已签的“不计回本回合数”）。
  // 第一版我凭「!x.big」随便挑一块，结果那块租为 0，测到的是另一条分支，红得没错。
  const plot = s.map.plots.find(x => !x.big && rentFor(s, x.id) > 0);
  assert.ok(plot, '夹具里没有可收租的小地，这条断言会空过');
  const pr = s.properties[plot.id];
  s.properties[plot.id] = { ...pr, ownerId: null };
  const r = root();
  const saved = s.pending;
  s.pending = { type: 'buy', cellId: plot.id, price: 8000, label: '小地产', level: 0, bigType: null };
  render(r, s, noop);
  s.pending = saved;
  const html = r.choice.innerHTML;
  assert.ok(html.includes(POOL_MARK), `买地框没有池子句：${html}`);
  assert.equal(html.includes('这间店没有单独实测'), false, `买地框降级成了“无实测”：${html}`);
  const expected = RENT_POOL.meansPerPlot[plot.name];
  assert.ok(Number.isFinite(expected), `夹具选的 ${plot.name} 不在实测表里`);
  // #1143：措辞从「这间店平均每局被踩」改成「这间店在那 72 局里平均每局被踩」
  // （常数要报来源）。断言意图不变：必须出现这间店自己的那个数，不能落回全盘均值。
  assert.ok(html.includes(`这间店在那 ${RENT_POOL.games} 局里平均每局被踩 ${expected.toFixed(2)} 次`),
    `买地框没报这间店自己的频率（应 ${expected.toFixed(2)}）：${html}`);
});

// ⑧ 尾部上限句：不编数，且停业/无 unit 时不出。
test('#1044 尾部上限句只在 unit 与 K 都算得出时出现', () => {
  assert.equal(poolKLine(0, 3), '');
  assert.equal(poolKLine(5600, 0), '');
  const s = poolKLine(5600, 2);
  assert.ok(s.includes('5,600') && s.includes('满 2 次一定够本'), s);
  assert.equal(roundsToRecover(10000, 0), null);
  assert.equal(roundsLine(10000, 0), '');
});

// ⑨ #1143：三个打印点，只要句子里的数是常数（RENT_POOL / LANDING_STATS），
//    就一律不许挂「本盘」/「本局」。用户判据：「若我在任何一处印出「本盘」，而该数来自
//    RENT_POOL 这个固定数组，则本单不通过。」
//    为什么这是真缺陷：15,550 是 72 局数组的均值，单局不可能有「平均」。
//    读者只能读成「这一局大概是这个数」—— 数字真，但对象错了。
test('#1143 常数句一律不许写「本盘」/「本局」，且必须先报来源', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 1;

  // A 提议框
  const lineA = /data-forward-k[^>]*>([\s\S]*?)<\/p>/.exec(renderBuild(s, id, 10000))?.[1] ?? '';
  assert.ok(lineA, '提议框没有前向句');
  assert.equal(/本盘|本局/.test(lineA), false, `A 提议框出现「本盘/本局」：${lineA}`);
  assert.ok(lineA.includes(POOL_SOURCE), `A 提议框没报来源：${lineA}`);

  // B 加盖日志的「这笔账」行
  p.cash = 999_999;
  s.properties[id].level = 1;
  buildPlot(s, p, id);
  const lineB = s.log.filter(e => e.text.includes('这笔账')).map(e => e.text).pop() ?? '';
  assert.ok(lineB, '日志里没有「这笔账」行');
  assert.equal(/本盘|本局/.test(lineB), false, `B 加盖日志出现「本盘/本局」：${lineB}`);
  assert.ok(lineB.includes(POOL_SOURCE), `B 加盖日志没报来源：${lineB}`);

  // C 买地框
  const s2 = slice();
  const plot = s2.map.plots.find(x => !x.big && rentFor(s2, x.id) > 0);
  assert.ok(plot, '夹具里没有可收租的小地，这条断言会空过');
  s2.properties[plot.id] = { ...s2.properties[plot.id], ownerId: null };
  const r = root();
  const saved = s2.pending;
  s2.pending = { type: 'buy', cellId: plot.id, price: 8000, label: '小地产', level: 0, bigType: null };
  render(r, s2, noop);
  s2.pending = saved;
  const htmlC = r.choice.innerHTML;
  assert.equal(/本盘|本局/.test(htmlC), false, `C 买地框出现「本盘/本局」：${htmlC}`);
  assert.ok(htmlC.includes(POOL_SOURCE), `C 买地框没报来源：${htmlC}`);
});
