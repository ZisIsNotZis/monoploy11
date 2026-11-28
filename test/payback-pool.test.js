import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSliceConfig, SLICE_MAP } from '../src/data/slice.js';
import { startSession, runGame, buildPlot } from '../src/engine/flow.js';
import { sliceAnswer } from '../src/engine/slice-ai.js';
import { rentFor } from '../src/engine/economy.js';
import { render } from '../src/ui/render.js';
import { RENT_POOL, paybackFacts, poolShareLine, poolKLine, roundsToRecover, roundsLine, paybackAccount, seasonTerms, seasonLength, POOL_SOURCE } from '../src/engine/payback.js';
import { buildForwardLine, buildForwardK } from '../src/ui/slice.js';

// n0 是 payback.js 内部的格式化函数；测试只需要一致地把 10000 印成「10,000」。
const n0 = n => Math.round(n).toLocaleString();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  // #3391z：这里原来硬编码「满 2 次一定够本」—— 那个 2 是**旧口径**（用升级后全额
  // 5,600 算出来的）的数字，而且措辞也改成了「本笔每次多收 X，满 K 次一定回本」。
  // 硬编码旧值会让一条本该守「次序」的判据同时继承回本口径的 bug。
  // 现在按现算的 K 拼，只判次序。
  const info = buildForwardK(s, id, 10000);
  assert.ok(info && info.K > 0, '这条判据需要一个能算出的 K');
  const kIdx = line.indexOf(`满 ${info.K} 次一定回本`);
  assert.ok(kIdx >= 0, `K 句没出现（按现算 K=${info.K}）：${line}`);
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
  // #3391z：单位从「回合」改成「次」—— 数的是被踩到的次数，引擎没有「每回合收租」。
  // #3391z：这句现在必须能**单独读懂**：写清「满额收到 N 次」，且
  // 停业那次收 0、被抬价那次不足都不算。所以不再是精确等值，
  // 而是「开头是那个次数 + 条件被写出来了」。
  const rline = roundsLine(cost, gain);
  const n = Math.max(1, Math.ceil(cost / gain));
  assert.ok(rline.startsWith(`${n} 次回本`), `回本次数不对：${rline}`);
  // #3391zp2（第四轮收紧了这一条的口径，#3391z 的判据不变）：
  // 原来的写法要求 roundsLine **自己**写出「停业/少付/不算」。但那会让一屏上说两遍同一句
  //（升级行紧跟在账行后面，第一版屏上真的出现了两遍「停业那次收 0」）。
  // 「能单独读懂」的对象是**流水这一屏**，不是这一行：紧邻的上一条就是那段账。
  // 所以改成屏级判据，且仍然是可判的：账行必须在，且本轮不许自己漏掉条件。
  p.cash = 999_999;
  buildPlot(s, p, id);
  const rows2 = s.log.map(e => e.text);
  // 紧邻：升级行的**上一行**就是那段账（读者从下往上读会先看到次数）。
  // 取「最后一次升级的那一行」，再取它前一行 —— 两边同一个索引，不会像上一版那样把
  // 「最后一次账」与「第一次升级」拿来比（那是测试自己的错，不是产品的）。
  const upIdx = rows2.map(t => t.includes('次回本')).lastIndexOf(true);
  assert.ok(upIdx > 0, `流水里没有升级行：${rows2.slice(-3).join(' / ')}`);
  const account2 = rows2[upIdx - 1];
  assert.ok(/这笔怎么算/.test(account2) && /÷/.test(account2),
    `升级行的上一行不是那段账（那「按上一条算」就是假指引）：${account2}`);
  assert.ok(/收到全额/.test(account2) && /停业/.test(account2) && /不算/.test(account2),
    `账行没写清什么条件下才算回本：${account2}`);
  // 一屏上不许把三种情形重复两遍（第一版屏上真出现过两遍「停业那次收 0」）。
  const screen = rows2.slice(upIdx - 2, upIdx + 1).join('\n');
  assert.equal(screen.split('停业那次收 0').length - 1, 1,
    `同一屏把三种情形说了不止一遍：${screen}`);
});

// ②b #3391zp2（supervisor 第四轮）：「确认和流水当成同一笔账」。
// 他的原话：拿着流水单仍会用 4,000 去除成本。根因是**两处各说各的**，屏上没有除法。
// 现在除法只在 paybackAccount 里写一次，两个打印点都调它。这条钉三件事：
//   ① 确认框与流水行包含**同一句**账（逐字相等，不是各写一句像的）；
//   ② 那句账里有除法本身（花费 ÷ 每次多收 = N 次），且 N 与 buildForwardK 现算的 K 一致；
//   ③「少付」与「抬价」分成两句 —— 抬价是多收（一次算两次），上一版写成「不足」是反的。
// 负对照：把旧句子塞回去，① 与 ③ 必须同时红。
test('#3391zp2 确认框与流水单是同一笔账，且抬价不被说成少付', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 1;
  p.cash = 999_999;
  const cost = 10000;
  const info = buildForwardK(s, id, cost);
  assert.ok(info.unit > 0 && info.K > 0, '这条判据需要一个能算出的账');
  // #3391zp3：账里多了季节那两句（平常/旺季各一个说法），所以参数也要把季节带进去 ——
  // 不传的话就等于拿一句“屏上不存在的话”去比对，那比的是测试自己造的句子。
  const terms = seasonTerms(s, id, info.level);
  // #3450：这里原来漏了第 6 个参数 seasonDays，于是拿一句**产品从来不会印的话**去比对。
  // 平常分支有了季节长度之后，产品句子与这句就不再逐字相等 —— 红的不是措辞，是这条判据自己
  // 少传了一个产品真的在传的参数（与它上面那句「参数也要把季节带进去」自相矛盾）。
  const account = paybackAccount(cost, info.unit, info.K, info.after, terms, seasonLength(s));
  // ① 两块屏都说同一句
  const confirm = buildForwardLine(s, id, cost);
  assert.ok(confirm.includes(account), `确认框没有那句共用的除法：${confirm}`);
  buildPlot(s, p, id);
  const rows = s.log.map(e => e.text);
  const ledger = rows.find(t => t.includes(account));
  assert.ok(ledger, `流水单没有那句共用的除法（两处必须逐字相同）：${rows.slice(-3).join(' / ')}`);
  // ② 除法在里面，且次数与现算一致
  // 按**含义**判：两个操作数与结果都对，且写明分母是「每次多收」。
  // 不按一句具体措辞判 —— 上一版就因此把「措辞一改就红」写进了判据。
  assert.match(account, new RegExp(`${n0(cost)} ÷ [^÷=]{0,12}${n0(info.unit)} = ${info.K} 次`),
    `账里没有除法或次数不对：${account}`);
  assert.match(account, /每次多收/, `账里没点名分母是每次多收：${account}`);
  // ③ 少付照写；抬价不许**重复计数**。
  // #3391zp3（supervisor 第五轮）：上一版这条要求出现「旺季那次租金翻倍…算两次」。
  // 那是错的口径：rentFor 的 inflate 已经乘在 unit 里（economy.js:33），再说一次就把同一笔钱数两遍，
  // 读者于是把旺季的 2 次又除以 2，得出「1 次就回本」。所以这条改成**反向**：那句话必须不在。
  assert.equal(/算两次/.test(account), false, `旺季被重复计数（unit 已含翻倍）：${account}`);
  assert.equal(/被抬价那次不足/.test(account), false, `抬价被说成不足（反了）：${account}`);
  assert.match(account, /对手付不出/, `少付那一种没写：${account}`);
  assert.match(account, /停业那次收 0/, `停业那一种没写：${account}`);
  // 负对照：上一版的黏连串 + 上一版的错说法，必须真的不存在
  assert.equal(account.includes('一定回本升级后全额租金'), false, `旧黏连串又回来了：${account}`);
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

// ⑦ 买地框（第三个打印点）不再印池子句 —— #3338。
//
// 为什么改：那句「72 局里有 56 局的整局租金还不够这一笔」把 26,000 当**花掉的钱**，
// 而买地是资产换手（真 buyPlot 前后 assetsOf 差 0）。它让买地屏劝退，而结算屏劝买，
// 玩家在同一局里先后读到，只能认为有一句在骗人。买地屏现在印 market-ledger 的三行。
// 这条判据守住「池子句不许回到买地屏」，并指向新的判据文件。
test('#3338 买地框不再印池子句（那笔钱没有消失，它变成了同价的地）', () => {
  const s = slice();
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
  // 注意：不能拿 POOL_MARK（「同规则 72 局」）当唯一特征 —— market-ledger 的表也用同一个来源前缀，
  // 那是件好事（两份表同一批量、同一句话报来源）。池子句自己的特征是「一整局全场租金 / 整局租金还不够」。
  assert.equal(html.includes(poolShareLine(8000, plot.name)), false,
    `池子句回到了买地屏（它说的是「这一笔占全场租金多少」，把一个资产换手当成了花销）：${html}`);
  assert.equal(/一整局全场租金|整局租金还不够这一笔/.test(html), false,
    `买地屏又拿「收不回本钱」的口气说一笔资产换手：${html}`);
  // 替代它的是三行本局账，第一行必须自报口径，且说明总资产不变。
  assert.match(html, /本局账本：现金 [\d,]+ → [\d,]+/, `买地框没有本局账：${html}`);
  assert.match(html, /总资产不变/, `买地框没说清这笔钱变成了地：${html}`);
  assert.equal(html.includes('这间店没有单独实测'), false, `降级成了“无实测”：${html}`);
  const expected = RENT_POOL.meansPerPlot[plot.name];
  assert.ok(Number.isFinite(expected), `夹具选的 ${plot.name} 不在实测表里`);
  // 这间店自己的走位频率仍然必须出现（不能落回全盘均值）。
  assert.ok(html.includes(`这间店整局被踩到 ${expected.toFixed(2)} 次/局`),
    `买地框没报这间店自己的频率（应 ${expected.toFixed(2)}）：${html}`);
});

// ⑧ 尾部上限句：不编数，且停业/无 unit 时不出。
test('#1044 尾部上限句只在 unit 与 K 都算得出时出现', () => {
  assert.equal(poolKLine(0, 3), '');
  assert.equal(poolKLine(5600, 0), '');
  // #3391z：unit 现在是**增量**，第三参数 full 是升级后的全额。
  // 两种账都要出现 —— 只给全额会让读者算出更早回本（supervisor 撞到的就是那个）。
  const s = poolKLine(2800, 4, 5600);
  assert.ok(s.includes('2,800'), `K 句没写增量：${s}`);
  assert.ok(s.includes('5,600'), `K 句没写全额（两种账要并列）：${s}`);
  assert.ok(s.includes('满 4 次一定回本。'), `${s}`);
  assert.ok(s.includes('不是回合'), `K 句没说清单位是次数不是回合：${s}`);
});

// ⑧b #3391zp（屏幕检查抓到）：这一行是**三个句子**拼起来的。上一版只拼串、不带句末标点，
// 屏上读成「…一定回本升级后全额租金 5,600/次」—— 一句里塞了两件事，读者会把「回本」后面
// 那个数当成回本条件的一部分。这条钉的是**标点**，不是措辞：
//   ① 「一定回本」后面必须是句末标点；
//   ② full 缺省时也不许把「不算回本单位：」黏起来；
//   ③ 负对照用上一版真实出现过的黏连串 —— 否则这条判据是空跑。
test('#3391zp K 句的每一句自带句末标点，拼接处不黏连', () => {
  const withFull = poolKLine(2800, 4, 5600);
  const noFull = poolKLine(2800, 4, 0);
  for (const [name, s] of [['full', withFull], ['no-full', noFull]]) {
    assert.match(s, /一定回本[。；]/, `${name}：「一定回本」后面没有句末标点：${s}`);
    assert.equal(s.includes('回本升级'), false, `${name}：还是黏在一起：${s}`);
    assert.equal(s.includes('回本单位'), false, `${name}：「不算回本」与单位句黏连：${s}`);
  }
  // 有 full 时那一句也要自带句号，否则和最后的单位句黏。
  assert.match(withFull, /不算回本。/, `full 句没有句末标点：${withFull}`);
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

  // C 买地框：池子句已在 #3338 撤掉（它把一个资产换手当成了花销）。
  // 这条判据现在钉的是「它确实撤了，而且新三行自带自己的口径标签」。
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
  assert.equal(htmlC.includes(poolShareLine(8000, plot.name)), false, `C 买地框还挂着 72 局池子句：${htmlC}`);
  assert.equal(/一整局全场租金|整局租金还不够这一笔/.test(htmlC), false, `C 买地框又用「收不回本钱」的口径：${htmlC}`);
  // 留下来的是本局账：它的主语是「本局」，而里面的数都来自这一局（上面 A/B 的纪律反过来）。
  assert.match(htmlC, /本局账本：/, `C 买地框没有本局账：${htmlC}`);
  // 常数（72 局那张表）仍然出现，但必须自己带来源，不许借「本局」二字开口。
  assert.match(htmlC, /同规则 72 局/, `C 买地框引了常数却没报来源：${htmlC}`);
});

// ⑩ #3391zp3（supervisor 第五轮）：**旺季不许被数两遍**，且旺季现场必须给出更差的数。
//
// 他的原话：「我用同一间店复算了已经在旺季的状态：平常增量 2,800、要四次，旺季增量 5,600、
// 要两次。屏上给出旺季的两次后，仍说旺季每次可算两次，容易读成一次就回本。」
// 根因在 rentFor：`inflate>0 ? 2 : 1` 乘在 base 之后，所以 unit **本来就已经含翻倍**；
// 再说「一次算两次」= 同一笔钱数两遍 → 读者把 2 次又除以 2 → 1 次。
//
// 这条钉四件事（两个季节各一遍）：
//   ① unit 与 K 来自现算，且旺季里的 unit 就是平常的两倍（乘二只有 economy.js 一处）；
//   ② 句子里**不许**出现「算两次」这类重复计数的说法（负对照：把它塞回去必须红）；
//   ③ 旺季现场必须写出「旺季结束后每次只多收 X，要 M 次」这个更差的数；
//   ④ 平常现场必须写出「进了旺季会多收多少」，也就是说明会变 —— 而不是默默乘进去。
test('#3391zp3 旺季不重复计数，且两个季节都说清会变', () => {
  const cost = 10000;
  const hot = (() => {
    const s = slice();
    const [p] = s.players;
    const id = p.properties[0];
    s.properties[id].level = 1;
    s.properties[id].inflate = 2;            // 这一局这条街正在旺季
    const info = buildForwardK(s, id, cost);
    const terms = seasonTerms(s, id, info.level);
    const line = buildForwardLine(s, id, cost);
    // ① 现算：旺季的增量必须是平常的两倍，K 是减半后的数
    assert.ok(terms.inflating, '旺季夹具没造出来（inflate 没生效）');
    assert.equal(info.unit, terms.hotUnit, '旺季里的 unit 不是旺季口径');
    assert.equal(terms.hotUnit, terms.plainUnit * 2, '旺季增量不是平常的两倍 —— 乘二的地方不止一处？');
    assert.equal(info.K, Math.ceil(cost / terms.hotUnit), 'K 不是 ceil(花费/旺季增量)');
    // ② 不许重复计数
    assert.equal(/算两次/.test(line), false, `旺季被数了两遍：${line}`);
    // ③ 必须给出旺季结束后更差的那个数
    const plainK = Math.ceil(cost / terms.plainUnit);
    assert.ok(line.includes(`每次只多收 ${n0(terms.plainUnit)}`), `没写旺季结束后的增量：${line}`);
    assert.ok(line.includes(`就要 ${plainK} 次`), `没写旺季结束后要几次：${line}`);
    assert.ok(plainK > info.K, '这条判据要的是「结束后更差」，两个数却没拉开');
    // 夹具里 inflate=2 表示「还剩 2 天」，⑤ 要对着这个数判
    return { s, id, info, terms };
  })();

  // ④ 平常现场：说明会变，且不把旺季的数乘进 K
  const s2 = slice();
  const [p2] = s2.players;
  const id2 = p2.properties[0];
  s2.properties[id2].level = 1;
  s2.properties[id2].inflate = 0;
  const info2 = buildForwardK(s2, id2, cost);
  const terms2 = seasonTerms(s2, id2, info2.level);
  const line2 = buildForwardLine(s2, id2, cost);
  assert.equal(terms2.inflating, false, '平常夹具被污染了');
  assert.equal(info2.unit, terms2.plainUnit, '平常里的 unit 不是平常口径');
  assert.ok(terms2.hotUnit > terms2.plainUnit, '旺季没有更贵？那这条判据的前提不成立');
  assert.ok(line2.includes(`每次会多收 ${n0(terms2.hotUnit)}`), `平常现场没说旺季会多收多少：${line2}`);
  assert.ok(line2.includes(`回到 ${info2.K} 次`), `平常现场没说旺季过去后又变回几次：${line2}`);

  // hotLine 先取：下面 ④b 与 ⑤ 都要用它。
  const hotLine = buildForwardLine(hot.s, hot.id, cost);

  // ④b #3450（supervisor 第六轮真机，**两次**）：他要的是「先在旺季收过两次，结束后还差几次」。
  // 我第一版只写方向（「收过的算贵的、剩下少于 K 次」），他回的仍是「答不上来」——
  // 方向不能拿去做决定。现在屏上直接给一笔**能用屏上自己的数逐位复算**的例子，
  // 而且两个分支都要给（他第一次撞到的恰恰是 `inHot >= 天数` 那一支，我当时只改了另一支）。
  //
  // 判据不认措辞：从屏上抽出「旺季踩 m 次、收回 G、剩 L、再 n 次」，逐个与现算值比。
  const checkExample = (name, line, plan, hot) => {
    const m = /旺季里踩到 (\d+) 次/.exec(line);
    assert.ok(m, `${name}分支没给可用数复算的例子：${line}`);
    const got = /收回 ([\d,]+)，剩 ([\d,]+)/.exec(line);
    const rest = /再 (\d+) 次(?:就够本|$)/.exec(line);
    assert.ok(got && rest, `${name}分支的例子不全（收回/剩余/剩余次数）：${line}`);
    const n = Number(got[1].replace(/,/g, '')), left = Number(got[2].replace(/,/g, ''));
    assert.equal(n, Number(m[1]) * hot, `${name}：收回的数不等于 次数×旺季价`);
    assert.equal(left, cost - n, `${name}：剩余的钱不等于 花费−已收`);
    assert.equal(Number(rest[1]), Math.ceil(left / plan), `${name}：剩余次数不等于 ceil(剩余÷平常价)`);
    // 负对照：例子一删，上面三条就无从判 —— 产品退回「两个端点、中间留白」。
    assert.equal(/旺季里踩到 \d+ 次/.test(line.replace(/例：[^。]*。/, '')), false, `${name}：负对照没生效`);
  };
  checkExample('平常', line2, terms2.plainUnit, terms2.hotUnit);
  checkExample('旺季', hotLine, hot.terms.plainUnit, hot.terms.hotUnit);

  // ④c #3453 复核第 1、2 条（两条真缺陷），**#3456 又把第一条的修法推翻了**：
  //   ① 例子里的 m 原来固定取 inHot−1，不看窗口。我把它夹成 min(inHot−1, 剩余天数)，
  //      等于把**天数当成了次数上限** —— supervisor 实跑 seed 42 机会买家第 15 天，
  //      晨光街茶铺一天收到两笔全额（7,800 与 11,200）。所以上界是「对手数 × 剩余天数」。
  //   ② ④b 的夹具只有 inHot=2 一档，m 写成 inHot−2 也全绿 —— 那条判据在夹具里分不出对错。
  // 所以这里：(a) 断言 m == min(inHot−1, 对手数 × 剩余天数)；(b) 补 inHot=3 的一格（月色街茶铺式：
  // 10,000 / 平常 2,000 / 旺季 4,000）—— 这一档 m 应该是 2，写成 1 立刻红；
  // (c) 负对照：把上界改回「只看天数」，只剩 1 天那一档必须变红（否则本条又变成 pin 旧修法）。
  const clampCase = (() => {
    const s = slice();
    const [p] = s.players;
    const id = s.map.plots.find(x => x.name === '月色街茶铺').id;
    for (const plot of s.map.plots) {
      if (plot.id === id) continue;
      if (!plot.big) s.properties[plot.id].ownerId = null;
      s.properties[plot.id].inflate = 0; s.properties[plot.id].closed = 0;
    }
    s.properties[id].ownerId = p.id; s.properties[id].level = 1;
    s.properties[id].closed = 0;
    if (!p.properties.includes(id)) p.properties.push(id);
    return { s, id };
  })();
  for (const daysLeft of [1, 2, 3]) {
    clampCase.s.properties[clampCase.id].inflate = daysLeft;
    const terms3 = seasonTerms(clampCase.s, clampCase.id, 1);
    const line3 = buildForwardLine(clampCase.s, clampCase.id, 10000);
    const inHot3 = Math.ceil(10000 / terms3.hotUnit);
    assert.equal(inHot3, 3, `夹具没造出 inHot=3 那一档（实得 ${inHot3}）`);
    const m = /旺季里踩到 (\d+) 次/.exec(line3);
    assert.ok(m, `旺季只剩 ${daysLeft} 天时没有例子：${line3}`);
    // 上界 = 剩余天数 × 当天能踩到的对手数（3 人局里是 2），**不是剩余天数**。
    const cap3 = daysLeft * terms3.maxPerDay;
    assert.equal(terms3.maxPerDay, 2, `夹具的对手数不对（实得 ${terms3.maxPerDay}）`);
    assert.equal(Number(m[1]), Math.min(inHot3 - 1, cap3),
      `剩余 ${daysLeft} 天时例子举的「踩到 ${m[1]} 次」不是 min(inHot−1, 对手数×天数=${cap3})：${line3}`);
    // 自相矛盾的反面：只要没超过窗口容量，就不算打架。超出容量才是假话。
    assert.ok(Number(m[1]) <= cap3, `剩余 ${daysLeft} 天却举了 ${m[1]} 次，超出窗口容量 ${cap3}：${line3}`);
    // 负对照：把上界退回「只看天数」，剩 1 天那一档会从 2 变成 1 —— 本条必须能看见这个差别。
    const daysOnly = Math.min(inHot3 - 1, daysLeft);
    if (daysOnly !== Math.min(inHot3 - 1, cap3)) {
      assert.notEqual(daysOnly, Number(m[1]),
        `剩余 ${daysLeft} 天：产品仍按「天数=次数上限」取数（${daysOnly}），与对手数×天数不一致`);
    }
    // 例子自己的算术仍要成立（复算，不认措辞）。
    const got = /收回 ([\d,]+)，剩 ([\d,]+)/.exec(line3);
    assert.equal(Number(got[1].replace(/,/g, '')), Number(m[1]) * terms3.hotUnit,
      `剩余 ${daysLeft} 天：收回的数不等于 次数×旺季价`);
  }
  clampCase.s.properties[clampCase.id].inflate = 0;   // 复原，不污染同进程后续

  // ⑤ #3446 第②条（复核抓到，真缺陷）：旺季的 K 只在**旺季还开着**时成立，
  // 「满 2 次」不能写成无条件上界（旺季一共 3 天，2 次踩到一间小店几乎不可能）。
  // 所以旺季现场必须带上兑现期限，且期限读的是 pr.inflate（不推测）。
  assert.match(hotLine, /还剩 2 天|今天是最后一天/, `旺季没说还剩几天：${hotLine}`);
  assert.match(hotLine, /得在旺季结束前踩到/, `旺季没说那几次要在期限前兑现：${hotLine}`);
  // 负对照：把期限那句删掉，「满 2 次」就会变回一个会过期的许诺 —— 上面两条必须同时红。
  // #3456：这句话中间现在可能夹着窗口容量那个括号（「…结束前踩到（这几天最多…）；」），
  // 所以负对照不能只匹配「踩到；」这种紧邻形状 —— 那会让它对**当前的**句子失效，
  // 变成一条永远通过的检查。改成从「得在旺季结束前踩到」到下一个「；」整段抹掉。
  const noDeadline = hotLine.replace(/得在旺季结束前踩到[^；]*；/, '');
  assert.notEqual(noDeadline, hotLine, '负对照没生效：找不到那半句');
  assert.equal(/得在旺季结束前踩到/.test(noDeadline), false, '负对照没生效');

  // ⑥ #3446 第③条：同一屏上每个关键数只该出现一次（我自己写的「一个数只说一遍」）。
  // 上一版：2,800 出现 4 次、5,600 3 次，读者得从四个「2,800」里挑哪个是分母。
  // #3450 / #3453：例子里一个数是当**操作数**用的（收回 = 次数×单价），与 ⑥ 要防的病
  //（读者得从几个候选里挑分母）不是一回事。但**不能整句抹掉**（#3453 复核第 3 条指出的真雷）：
  // 抹掉后例子里的错价与**第三个价**都绿 —— 那正是 ⑥ 该叫的地方。
  // 所以改成**令牌级**：例子里只允许多次出现那几个被 ④b 复算过的数，不许出现任何价格串。
  for (const [name, line, nums] of [
    ['平常', line2, ['2,800']],
    ['旺季', hotLine, ['5,600', '2,800']],
  ]) {
    const ex = /例：[^。]*。/.exec(line);
    assert.ok(ex, `${name}屏上没有那笔例子 —— ⑥ 的例子检查就变成了空跑`);
    // 例子内不许出现「多数钱」的价格串（2,800 / 5,600 / 11,200 之类）：它的四个数
    //（次数、收回、剩余、剩余次数）都已由 ④b/④c 复算，再冒一个价就是多余的候选分母。
    const priceInExample = /[\d,]{3,}/g;
    const big = (ex[0].match(priceInExample) ?? []).filter(x => x !== '10,000');
    // 例子里允许出现的钱只有「收回」与「剩」两个（已验算）；多余的一个都不许。
    assert.ok(big.length <= 2, `${name}：例子里出现了多于两个金额（多出来的就是没验算的候选分母）：${ex[0]}`);
    const prose = line.replace(/例：[^。]*。/, '');
    for (const n of nums) {
      const c = prose.split(n).length - 1;
      assert.ok(c <= 2, `${name}屏上（除法与提醒部分）「${n}」出现了 ${c} 次（每个数最多两处：除法／提醒）：${line}`);
    }
  }

  // 负对照：把上一版那句「一次算两次」塞回去，② 必须立刻红（否则这条判据是空跑）
  assert.equal(/(^|[^算])算两次/.test(`${line2}旺季那次租金翻倍，所以那一次算两次`), true,
    '负对照没生效：塞进去的旧说法没被这条正则抓到');

  // 现场一致性：两块屏（确认框 / 流水单）都用同一份季节口径
  hot.s.properties[hot.id].inflate = 0;   // 复原，避免污染同进程后续断言
});

// ⑦ #3446 第⑤条（复核抓到）：`ceil` 曾经有三份 —— payback.js / ui/slice.js / engine/flow.js。
// 这个仓自己的规矩写在 payback.roundsToRecover 的上方：「整个仓库只有一个 ceil 实现」。
// 三份的后果不是风格问题：改一处口径（比如改成「差一点也算一次」）另两处不会跟着改，
// 于是同一笔加盖在确认框、流水单、结算面板上印出三个不同的次数。
//
// 这条判据读源码而不是读行为 —— 行为判据抓不到「两份恰好相等」的情形，
// 而下一轮改口径时它们才会分开。
test('#3446 回本次数只有一处 ceil 实现', () => {
  const SRC = path.join(ROOT, 'src');
  const hits = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
        // 注释里提到不算：这一轮的注释本来就一直在说 ceil。
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        // 只认「花费 ÷ 收益」形的回本 ceil：操作数里必须有一个回本口径的名字。
        // 不按「所有 ceil」收 —— game.js:229 的 `ceil(n / 3)` 是分座位，与回本无关，
        // 把它算进来会让这条判据变成“改不动别人的代码”，那不叫判据。
        if (/Math\.ceil\(\s*(cost|spend|price)\s*\//.test(line)) {
          hits.push(`${path.relative(ROOT, p)}: ${line.trim()}`);
        }
      });
    }
  };
  walk(SRC);
  // #3448 复核 C 条：这里原来把**行号**和**变量名**都钉进了期望值，于是两种真实回归漏过去：
  //   · `const ceilAlias = Math.ceil;` 再 `Math.max(1, ceilAlias(cost / gain))`
  //   · `const due = cost;` 再 `Math.max(1, Math.ceil(due / gain))`
  //   两者都过了 36 条判据（我实测过），而那正是这条判据声称要防的「改口径时各自漂开」。
  // 现在分两层：
  //   ① 行为层 —— 同一个花费/增量，所有能出次数的地方必须返回同一个数；
  //   ② 源码层 —— 不认变量名，只数「src 里除 payback.js 外还有没有 Math.ceil」。
  // 期望值里**不带行号**：#3448 复核 C 条同时指出，钉行号会让「删掉三行无关注释」就假红
  // （我自己刚把 204 移到 231，立刻红了一次）。这里只钉「文件 + 这条语句」的形状。
  assert.deepEqual(hits, ['src/engine/payback.js: return Math.max(1, Math.ceil(cost / perRound));'],
    '回本次数的 ceil 不止一处 —— 改口径时它们会各自漂开（读到的：\n' + hits.join('\n') + '\n）；'
    + '注意这一层只认 cost/spend/price 作分子，换名字或换别名的重实现由下面的行为层兜住');

  // ② 不认名字：src 里任何 Math.ceil 都必须在 payback.js 里。
  // 这条抓的是「换变量名/换别名」的写法 —— 正则层看不见它们。
  const ceilOutside = [];
  const walk2 = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk2(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (!/Math\.ceil|\.ceil\(/.test(line)) return;
        const rel = path.relative(ROOT, p);
        // 允许：payback.js（唯一实现）、以及与非回本无关的两处已登记位置。
        if (rel === 'src/engine/payback.js') return;
        // 两处已登记的非回本 ceil（分座位 / 补给日）。空白不敏感：
        // 我第一版写死了 `n / 3` 的空格，而源码是 `state.day/3`，于是假红一次。
        if (rel === 'src/engine/game.js' && /ceil\(\s*n\s*\/\s*3\s*\)/.test(line)) return;
        if (rel === 'src/ui/slice.js' && /ceil\(\s*state\.day\s*\/\s*3\s*\)/.test(line)) return;
        ceilOutside.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
  };
  walk2(SRC);
  assert.deepEqual(ceilOutside, [],
    'payback.js 以外又出现了 ceil —— 换名字/换别名正是上一版判据看不见的那种重实现：\n'
    + ceilOutside.join('\n') + '\n');
  // 负对照：上一版那两处（slice.js / flow.js）都用了 cost 作分子，
  // 所以同一个正则吃得到它们 —— 否则这条判据是空跑。
  for (const old of [
    'K: Math.max(1, Math.ceil(cost / gain))',
    'const k = Math.max(1, Math.ceil(cost / paybackGain));',
  ]) {
    assert.equal(/Math\.ceil\(\s*(cost|spend|price)\s*\//.test(old), true, `负对照没生效：${old}`);
  }
});
