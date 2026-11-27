import test from 'node:test';
import assert from 'node:assert/strict';
import { gapTurningLine, gapDayCauseLine, gapWideningWindow } from '../src/ui/slice.js';

// #926：离场屏在「哪几天差距拉大」（#912）之后，再加一句「差距涨得最多的是第几天、那天谁做了什么」。
//
// 这句话的前提不是「能编出一个理由」，而是**算术对账**：
// 那天所有可见事件的逐笔贡献加起来，必须正好等于当天的差距增量；差一分钱就不写。
// 实测 21 局里只有 8 局能说，其余 7 个说话局只说窗口、不说原因。
//
// 每个负对照都只踩一条规矩（否则测的不是那条规矩）。

const players = [
  { id: 'h', name: '我', controller: 'human', alive: true },
  { id: 'a', name: '甲', controller: 'ai', alive: true },
  { id: 'b', name: '乙', controller: 'ai', alive: true },
];
const plots = [
  { id: 'p1', name: '晨光街小店', big: false },
  { id: 'p2', name: '街心书屋', big: true },
];
const mkDay = (day, h, a, b) => ({ day, assets: { h, a, b } });
const base = days => ({
  players, map: { plots }, config: { dayLimit: 16 },
  slice: { history: [], assetByDay: days },
  log: [],
});
const plain = s => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const DAY_SENTENCE = /差距涨得最多的是第\s*(\d+)\s*天：那天(.+?)，那天结束时你落后\s*([\d,]+)。/;

// 差距 0/70/40/90：窗口是 1→4（增量 90），但「涨得最多的一天」是第 2 天（+70）——
// 终点不是涨得最猛的那天。这一条同时能抓住「把当天落后额错写成窗口终点值」的 bug。
// 第 2 天两侧都动了（甲 +90、我 +20，净 +70）：这样「取最大」与「取最小」会得到不同的人，
// 「按金额取最大」这条规矩被改坏时测试会红。
const interiorDays = () => [mkDay(1, 100, 100, 100), mkDay(2, 120, 190, 100),
  mkDay(3, 120, 160, 100), mkDay(4, 120, 210, 100)];

// 差距 0/0/10/60/50：窗口 1→4（增量 60），涨最多的是第 4 天（+50）。
const growDays = () => [mkDay(1, 100, 100, 100), mkDay(2, 100, 100, 100),
  mkDay(3, 100, 110, 100), mkDay(4, 100, 160, 100), mkDay(5, 100, 150, 100)];

// ——— 正向：只有这一笔事件，且它刚好把当天增量对平 ———
test('自对账平了才说：指出涨最多那天、那天谁做了什么、那天的落后额', () => {
  const s = base(interiorDays());
  s.log = [{ day: 2, text: '甲 经过起点 +90' }, { day: 2, text: '我 在金钱格获得 20' }];
  const win = gapWideningWindow(s);
  assert.deepEqual([win.dayFrom, win.dayTo, win.toGap], [1, 4, 90], '窗口应是 1→4、终点差距 90');
  const line = plain(gapTurningLine(s));
  assert.ok(/拉开得最多/.test(line), '#912 的窗口句逐字保留：' + line);
  const m = DAY_SENTENCE.exec(line);
  assert.ok(m, '日级句必须出现：' + line);
  assert.equal(Number(m[1]), 2, '应该是差距涨最多的第 2 天（不是窗口终点第 4 天）');
  assert.equal(Number(m[3].replace(/,/g, '')), 70, '那天的落后额必须是当天真实值，不是终点值');
  assert.ok(/甲/.test(m[2]), '要说清是谁：' + m[2]);
});

// ——— 负对照①：日志对不上当天增量 ———
test('逐笔合计对不上当天增量：日级句一个字不说（不编原因）', () => {
  const s = base(growDays());
  // 当天差距 +50，但日志只记了一笔 +100：对账不平，不许挑它当原因
  s.log = [{ day: 4, text: '甲 经过起点 +100' }];
  assert.ok(gapWideningWindow(s), '窗口本身仍存在');
  assert.equal(gapDayCauseLine(s), '', '对不上就不写');
  const line = plain(gapTurningLine(s));
  assert.ok(/拉开得最多/.test(line), '窗口句仍在：' + line);
  assert.ok(!DAY_SENTENCE.test(line), '不许出现日级句：' + line);
});

// ——— 负对照②：当天领先者换人 ———
test('当天领先者换人：不归因到某一个人', () => {
  // 第 2 天甲是唯一最高（200）；第 3 天乙反超到 260 成为领先者，但昨天乙只有 100。
  // 这时「乙涨了」不能解释差距变化，因为差距的基准已经换人。
  // 逐笔只记乙 +60，恰好等于当天增量 60，所以算术对账能过；拦住它的只能是「换人」这一条。
  const s = base([mkDay(1, 100, 200, 100), mkDay(2, 100, 200, 100),
    mkDay(3, 100, 240, 260), mkDay(4, 100, 240, 260)]);
  s.log = [{ day: 3, text: '乙 在金钱格获得 60' }];
  assert.ok(gapWideningWindow(s), '窗口存在');
  assert.equal(gapDayCauseLine(s), '', '换人日不归因');
});

// ——— 负对照③：单笔不足 60% ———
test('当天由多笔小事共同造成（最大单笔占 40%）：不挑一笔当原因', () => {
  const s = base(growDays());
  // 当天增量 50，逐笔 20+20+10 = 50 能对平，但最大单笔只占 40%
  s.log = [{ day: 4, text: '甲 经过起点 +20' }, { day: 4, text: '甲 在金钱格获得 20' },
    { day: 4, text: '甲 在金钱格获得 10' }];
  assert.equal(gapDayCauseLine(s), '', '单笔占比不足就不挑一笔');
});

// ——— 估值口径：书架升级按 8,000/级 ———
test('付费升级按地块真实估值算：大店 +8,000，不是 +4,000', () => {
  // 我花 10,000 升「街心书屋」（大店）：现金 −10,000、地产 +8,000 ⇒ 资产 −2,000 ⇒ 差距 +2,000。
  // 若估值错成 4,000，这笔会算成 −6,000，与快照对不上，句子就不出现。
  // 第 2 天先小掉一点（首次落后的日子），这样窗口终点与首次落下日不同，
  // 否则 #912 的「旧句已说」规则会把窗口句本身抑制掉，测不到本单的东西。
  const s = base([mkDay(1, 10000, 10000, 9000), mkDay(2, 9000, 10000, 9000),
    mkDay(3, 7000, 10000, 9000)]);
  s.log = [{ day: 3, text: '我 将 街心书屋 升到 Lv.2（花费 10000）' }];
  const line = plain(gapTurningLine(s));
  const m = DAY_SENTENCE.exec(line);
  assert.ok(m, '估值算对才能对平并出句：' + line);
  assert.equal(Number(m[1]), 3, '涨最多的是第 3 天');
  assert.equal(Number(m[3].replace(/,/g, '')), 3000, '第 3 天结束时落后 3,000');
  assert.ok(/你/.test(m[2]), '这笔是我做的：' + m[2]);
});

// ——— 措辞纪律 ———
test('日级句不含因果措辞', () => {
  const s = base(interiorDays());
  s.log = [{ day: 2, text: '甲 经过起点 +90' }, { day: 2, text: '我 在金钱格获得 20' }];
  const line = plain(gapTurningLine(s));
  for (const w of ['开始输', '反超后', '之后就一直', '转折', '因为', '导致', '造成', '所以']) {
    assert.ok(!line.includes(w), `不许出现「${w}」：${line}`);
  }
});

// ——— 可核性：天数与金额都能在快照里找到 ———
test('句子里的天数与金额都能在快照里找到', () => {
  const s = base(interiorDays());
  s.log = [{ day: 2, text: '甲 经过起点 +90' }, { day: 2, text: '我 在金钱格获得 20' }];
  const line = plain(gapTurningLine(s));
  const m = DAY_SENTENCE.exec(line);
  assert.ok(m);
  const entry = s.slice.assetByDay.find(e => e.day === Number(m[1]));
  assert.ok(entry, '引用的天必须在快照里');
  const human = players.find(p => p.controller === 'human');
  const real = Math.round(Math.max(...players.map(p => entry.assets[p.id])) - entry.assets[human.id]);
  assert.equal(Number(m[3].replace(/,/g, '')), real, '金额必须等于当天真实差距');
});

// ——— 降级 ———
test('快照不全或没有窗口时：日级句一起不说', () => {
  const s = base([{ day: 1, assets: { h: 100 } }, { day: 2, assets: { h: 110, a: 120 } }]);
  assert.equal(gapDayCauseLine(s), '');
});
