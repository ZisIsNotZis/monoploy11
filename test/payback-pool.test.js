import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig, SLICE_MAP } from '../src/data/slice.js';
import { startSession, runGame, buildPlot } from '../src/engine/flow.js';
import { sliceAnswer } from '../src/engine/slice-ai.js';
import { rentFor } from '../src/engine/economy.js';
import { render } from '../src/ui/render.js';
import { RENT_POOL, paybackFacts, poolShareLine, poolKLine, roundsToRecover, roundsLine, paybackAccount, POOL_SOURCE } from '../src/engine/payback.js';
import { buildForwardLine, buildForwardK } from '../src/ui/slice.js';

// n0 是 payback.js 内部的格式化函数；测试只需要一致地把 10000 印成「10,000」。
const n0 = n => Math.round(n).toLocaleString();

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
  const account = paybackAccount(cost, info.unit, info.K, info.after);
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
  // ③ 三种情形分开写：抬价是多收
  assert.match(account, /旺季那次租金翻倍/, `没写旺季是多收：${account}`);
  assert.match(account, /不是少付/, `没把抬价与少付区分开：${account}`);
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
