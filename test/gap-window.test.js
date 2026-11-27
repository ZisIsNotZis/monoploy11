import test from 'node:test';
import assert from 'node:assert/strict';
import { gapTurningLine, gapWideningWindow, gapDailySeries } from '../src/ui/slice.js';

// #912：离场屏此前说不出「差距是在哪几天拉开的」。
// 这里只用**人造快照**定住三件事：窗口选得对、端点是那天真实差距、没有可说窗口时不编。
// 真实 21 局分布另见 .scratch/912-gapwindow/check-window.mjs（独立重算 + 逐局比对）。

const players = [
  { id: 'h', name: '我', controller: 'human' },
  { id: 'a', name: '甲', controller: 'ai' },
  { id: 'b', name: '乙', controller: 'ai' },
];
const base = () => ({ players, slice: { history: [], assetByDay: [] }, map: { plots: [] }, config: { dayLimit: 16 } });
const mkDay = (day, h, a, b) => ({ day, assets: { h, a, b } });
const plain = s => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const SENTENCE = /你和第一名的差距在第\s*(\d+)\s*天到第\s*(\d+)\s*天\s*之间拉开得最多：/;

// —— 正向：差距单边拉大，句子必须出现且窗口是那两天 ——
test('差距单边拉大：指出起来，两端都是当天真实差距', () => {
  const s = base();
  // 差距 0/40/100/160/150：涨到第 4 天见顶，第 5 天回了一点。
  // 所以终点应是第 4 天（涨到顶那天），不是末日的 150。
  s.slice.assetByDay = [mkDay(1, 100, 100, 90), mkDay(2, 100, 140, 90),
    mkDay(3, 100, 200, 90), mkDay(4, 100, 260, 90), mkDay(5, 100, 250, 90)];
  const win = gapWideningWindow(s);
  assert.equal(win.dayFrom, 1, '起点应是差距最小的第 1 天');
  assert.equal(win.dayTo, 4, '终点应是差距最大的第 4 天，不是末日的 150');
  assert.equal(win.fromGap, 0);
  assert.equal(win.toGap, 160);
  const line = plain(gapTurningLine(s));
  const m = SENTENCE.exec(line);
  assert.ok(m, '屏上必须有窗口句：' + line);
  assert.equal(Number(m[1]), 1);
  assert.equal(Number(m[2]), 4);
  // 差距 0 不等于“独自第一”：那可能只是并列。本文件从不把并列写成“第一位”。
  assert.ok(line.includes('第 1 天你还没落后'), '起点为 0 时不说“落后 0”：' + line);
  assert.ok(!line.includes('第 1 天你还在第一位'), '并列时不许声称在第一位：' + line);
  assert.ok(line.includes('第 4 天落后 160'), '终点金额必须是第 4 天的真实差距：' + line);
});

// —— 负对照①：来回摆。差距冲上去又原样回落，没有“拉得最多”这一说 ——
test('来回摆（拉开后又原样缩回）：不许编一个窗口', () => {
  const s = base();
  // 差距 0/60/0：一天冲上去、第二天原样缩回。这正是 grow/13 的形状
  // （实测 3,000 冲上去又 3,000 回落，终局他其实还在第一位）。
  s.slice.assetByDay = [mkDay(1, 100, 100, 90), mkDay(2, 100, 160, 90), mkDay(3, 100, 100, 90)];
  assert.equal(gapWideningWindow(s), null, '上升幅度不超过单日回落时，没有“拉开得最多”可言');
  const line = plain(gapTurningLine(s));
  assert.ok(!SENTENCE.test(line), '不许出现窗口句：' + line);
});

// —— 负对照②：差距全程没净增长 ——
test('差距从没净增长过：不许编窗口', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 100, 180, 90), mkDay(2, 100, 150, 90), mkDay(3, 100, 120, 90)];
  assert.equal(gapWideningWindow(s), null);
  assert.ok(!SENTENCE.test(plain(gapTurningLine(s))));
});

// —— 并列：峰值平台多天时取最早到达的那天，不取平台末尾 ——
test('差距在峰值上停了好几天：取最早涨到顶的那天', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 100, 100, 90), mkDay(2, 100, 160, 90),
    mkDay(3, 100, 200, 90), mkDay(4, 100, 200, 90), mkDay(5, 100, 200, 90)];
  const win = gapWideningWindow(s);
  assert.equal(win.dayTo, 3, '第 3 天就涨到顶了，不该报第 5 天');
  assert.equal(win.dayFrom, 1);
});

// —— 破产局：差距已被出局解释，不再报窗口 ——
test('破产局不报窗口（出局已经解释了差距）', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 100, 120, 90), mkDay(2, 60, 200, 90), mkDay(3, 0, 240, 90)];
  const line = plain(gapTurningLine(s));
  assert.ok(line.includes('资金耗尽出局'), '破产句仍要在：' + line);
  assert.ok(!SENTENCE.test(line), '破产局不说窗口：' + line);
});

// —— 快照不可用：连逐日行一起不说 ——
test('快照不完整：不说窗口也不给逐日行', () => {
  const s = base();
  s.slice.assetByDay = [{ day: 1, assets: { h: 100 } }, { day: 2, assets: { h: 110, a: 120 } }];
  assert.equal(gapWideningWindow(s), null);
  assert.equal(gapDailySeries(s), null);
  const line = plain(gapTurningLine(s));
  assert.ok(line.includes('无法指出'), '降级说明仍要在：' + line);
});

// —— 措辞：不许出现因果/转折断言 ——
test('窗口句不含因果措辞', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 100, 100, 90), mkDay(2, 100, 150, 90), mkDay(3, 100, 210, 90)];
  const line = plain(gapTurningLine(s));
  assert.ok(SENTENCE.test(line));
  for (const word of ['开始输', '反超后', '之后就一直', '转折', '因为', '导致', '造成']) {
    assert.ok(!line.includes(word), `不许出现“${word}”：${line}`);
  }
});

// —— 不重复旧句：旧句已经把窗口两端都写了，就不再说一遍 ——
// 实测 21 局里有 3 局是这三种形状（grow/7、cross/7、cross/11）。
test('旧句已写「第1天→首次落后那天」：不再重复说一遍', () => {
  const s = base();
  // 第 1 天并列第一，第 3 天落到第 2 名落后 5,000，之后差距只缩不涨。
  s.slice.assetByDay = [mkDay(1, 100, 100, 90), mkDay(2, 100, 100, 90),
    mkDay(3, 100, 105, 90), mkDay(4, 100, 103, 90)];
  const win = gapWideningWindow(s);
  assert.deepEqual([win.dayFrom, win.dayTo, win.fromGap, win.toGap], [1, 3, 0, 5], '窗口本身仍是 1→3');
  const line = plain(gapTurningLine(s));
  assert.ok(line.includes('第 3 天'), '旧句仍要在：' + line);
  assert.ok(!SENTENCE.test(line), '窗口与旧句完全重合，不该重说：' + line);
  assert.ok(!line.includes('逐日落后第一名'), '也不该给逐日行：' + line);
});

test('旧句已写「差距反而从 A 拉到 B」：不再重复说一遍', () => {
  const s = base();
  // cross/7 的形状：开局第 3 名（落后 10），第 3 天升到第 2 名（是因为乙掉下去了，不是因为我追上了），
  // 差距一路从 10 拉到 46，旧句会写「第 3 天追到第 2 名并保持到最后，差距反而从 10 拉到 46」。
  s.slice.assetByDay = [mkDay(1, 80, 86, 90), mkDay(2, 80, 86, 90),
    mkDay(3, 90, 120, 85), mkDay(4, 96, 142, 85)];
  const line = plain(gapTurningLine(s));
  assert.ok(line.includes('差距反而从'), '旧句本来就会说差距走向：' + line);
  assert.ok(!SENTENCE.test(line), '那段就是窗口本身，不该再单开一句：' + line);
});

test('旧句只给首末两个差距、窗口更窄：仍要说（那是新信息）', () => {
  const s = base();
  // 开局落后 10,000，中途拉到 40,000，最后回落到 20,000。
  // 旧句给的是 10,000 与 20,000；窗口是 1→3（10,000→40,000）——旧句没说 40,000，所以要说。
  s.slice.assetByDay = [mkDay(1, 80, 90, 70), mkDay(2, 80, 120, 70),
    mkDay(3, 80, 120, 70), mkDay(4, 90, 110, 70)];
  const line = plain(gapTurningLine(s));
  assert.ok(SENTENCE.test(line), '窗口带新数字就该说：' + line);
});

// —— 可核性：逐日行必须与快照逐天对得上，端点就在这一行里 ——
test('逐日行与快照逐天一致，玩家能拿它验窗口句', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 100, 100, 90), mkDay(2, 100, 130, 90),
    mkDay(3, 100, 190, 90), mkDay(4, 100, 150, 90)];
  const series = gapDailySeries(s);
  assert.deepEqual(series, [{ day: 1, gap: 0 }, { day: 2, gap: 30 }, { day: 3, gap: 90 }, { day: 4, gap: 50 }]);
  const line = plain(gapTurningLine(s));
  assert.ok(line.includes('逐日落后第一名多少'), '逐日行要在屏上（可展开）');
  for (const x of series) assert.ok(line.includes(`第 ${x.day} 天 ${x.gap.toLocaleString()}`), `逐日行缺第 ${x.day} 天：${line}`);
});
