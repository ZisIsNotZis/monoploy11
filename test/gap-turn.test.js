import test from 'node:test';
import assert from 'node:assert/strict';
import { firstFallBehindDay, gapTurningLine, sliceResults } from '../src/ui/slice.js';

// #646：离场屏要能指到「哪一步开始落后」。
// 这里用**人造快照**而不是跑整局：整局慢且依赖种子；人造快照能把边界（从未落后 / 首日即落后 / 旧结构无快照）逐一定住。

const players = [
  { id: 'h', name: '我', controller: 'human' },
  { id: 'a', name: '甲', controller: 'ai' },
  { id: 'b', name: '乙', controller: 'ai' },
];
const base = () => ({ players, slice: { history: [], assetByDay: [] }, map: { plots: [] }, config: { dayLimit: 16 } });

const mkDay = (day, h, a, b) => ({ day, assets: { h, a, b } });

test('首次落出榜首：返回那一天与名次，而不是终局总差', () => {
  const s = base();
  s.slice.assetByDay = [
    mkDay(1, 100, 90, 80),   // 第 1
    mkDay(2, 110, 120, 80),  // 掉到第 2
    mkDay(3, 110, 130, 80),
  ];
  const hit = firstFallBehindDay(s);
  assert.equal(hit.day, 2, '必须指到第 2 天，不是第 1 天也不是最后一天');
  assert.equal(hit.rank, 2);
  assert.equal(hit.gap, 10);
});

test('一直领先：返回 null（不编一个转折点）', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 100, 90, 80), mkDay(2, 120, 90, 80), mkDay(3, 130, 99, 80)];
  assert.equal(firstFallBehindDay(s), null);
  assert.ok(gapTurningLine(s).includes('全程都在第一位'));
});

test('开局即落后：标 fromStart，不包装成“转向”', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 80, 100, 90), mkDay(2, 85, 100, 90)];
  const hit = firstFallBehindDay(s);
  assert.equal(hit.day, 1);
  assert.equal(hit.fromStart, true);
  // 文案已分三档，不再有“开局时你就落后”这一种说法（那是分档前）”。
  // 这里只需确定：给了首日天数，且没说成“从第 N 天起落到…”（那会暗示有个转折）。
  const line = gapTurningLine(s);
  assert.ok(line.includes('第 1 天'));
  assert.ok(!line.includes('起落到'), '开局即落后不该被说成“从第 N 天起落到”');
});

test('旧结构无 assetByDay：降级说明可见，且不出现任何天数句', () => {
  const s = base();
  s.slice.assetByDay = undefined;
  assert.equal(firstFallBehindDay(s), null);
  const line = gapTurningLine(s);
  assert.ok(line.includes('无法指出从哪一天开始落后'), '降级要说出来');
  assert.ok(!/第\s*\d+\s*天/.test(line), '降级时不许编天数');
  assert.ok(!line.includes('全程都在第一位'), '没数据时不许说“全程第一”');
});

test('只有 1 天：也降级（不足以判断转折）', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 100, 90, 80)];
  assert.equal(firstFallBehindDay(s), null);
  assert.ok(gapTurningLine(s).includes('无法指出'));
});

test('缺某个玩家的资产字段：降级而不是当成 0', () => {
  const s = base();
  s.slice.assetByDay = [{ day: 1, assets: { h: 100 } }, { day: 2, assets: { h: 110, a: 120 } }];
  assert.equal(firstFallBehindDay(s), null);
  const line = gapTurningLine(s);
  assert.ok(line.includes('无法指出'));
  // 这条是本轮的重点：数据不全与“一直领先”共用过 null，会把缺数据说成“你全程第一”。
  assert.ok(!line.includes('全程都在第一位'), '缺字段时不许说“全程第一”——那是编造');
});

test('离场屏真的把这一句渲染进去（不是只导出个函数）', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 100, 90, 80), mkDay(2, 110, 120, 80)];
  s.players.forEach(p => { p.cash = 0; p.deposit = 0; p.properties = []; p.sliceStats = { rentEarned: 0, rentPaid: 0, cardsPlayed: 0, takeovers: 0 }; });
  s.players.forEach(p => { p.alive = true; });
  s.over = true;
  s.winnerTeam = players[1].team;
  s.properties = {};
  const html = sliceResults(s);
  assert.ok(html.includes('第 2 天'), '离场屏正文里必须有这个天数');
  assert.ok(html.includes('落到第 2 名'));
});

// #646 补：开局即落后不能一句“之后没反超过”带过。
// take 风格实测 6/6 局都是第 1 天落后，那句对那个风格是废话。
test('开局即落后、但曾爬上去且保住名次：说差距走向，不说“又落到第 N 名”', () => {
  const s = base();
  // 第1天第3名(90) → 第3天追平第2名(100, 并列算第2) → 终局仍是第2名，
  // 但差距从 20000 拉到 60000。
  // 上一版我写成 120/100/110 —— 那 120 其实是第 1 名，不是第 2 名。数据自己算错了。
  s.slice.assetByDay = [mkDay(1, 80, 100, 120), mkDay(2, 90, 100, 120),
    mkDay(3, 100, 100, 160), mkDay(4, 100, 110, 160)];
  const hit = firstFallBehindDay(s);
  assert.equal(hit.day, 1);
  assert.equal(hit.fromStart, true);
  assert.equal(hit.bestRank, 2, '第3天追平100后，只有160高于我 ⇒ 第2名');
  assert.equal(hit.bestDay, 3);
  const line = gapTurningLine(s).replace(/<[^>]*>/g, '');
  assert.ok(line.includes('第 3 天追到第 2 名'), '必须指出爬上去过');
  assert.ok(line.includes('差距反而从'), '名次保住但差距扩大要说出来');
  assert.ok(!/又落到第\s*2\s*名/.test(line), '名次没变不许说“又落到”——那是语病');
});

test('开局即落后、从未爬上去：说“一直没反超过”，并给首末两个差距', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 90, 100, 110), mkDay(2, 90, 105, 110), mkDay(3, 71, 110, 110)];
  const hit = firstFallBehindDay(s);
  assert.equal(hit.fromStart, true);
  assert.equal(hit.bestRank, 3, '从未爬上去，最好名次就是第 1 天那个');
  const line = gapTurningLine(s).replace(/<[^>]*>/g, '');
  assert.ok(line.includes('一直没反超过'));
  assert.ok(line.includes('第 1 天就落后'));
  assert.ok(line.includes('结束时落后'));
});

test('第 1 天领先后来落下（现有档）：仍说“之前一直在第一位”', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 100, 90, 80), mkDay(2, 105, 90, 80), mkDay(3, 106, 130, 80)];
  const hit = firstFallBehindDay(s);
  assert.equal(hit.day, 3);
  assert.equal(hit.fromStart, undefined);
  assert.ok(gapTurningLine(s).includes('之前一直在第一位'));
});

// #646 修真缺陷：第一档曾无条件说「之前一直在第一位」，
// 但那只在「第 1 天就是第一」时成立。实测反例：
//   第1天第3名(80) → 第2天第1名(120) → 第3天掉到第2名(110 vs 130)
// 旧文案会说“之前一直在第一位”，而第1天他明明是第3名 —— 那是编造。
test('曾爬到第1名但不是从开局就领先：不许说“之前一直在第一位”', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 80, 100, 90), mkDay(2, 120, 100, 90), mkDay(3, 110, 130, 90)];
  const hit = firstFallBehindDay(s);
  assert.equal(hit.firstDayRank, 3, '第1天是第3名');
  assert.equal(hit.bestRank, 1);
  assert.equal(hit.bestDay, 2);
  const line = gapTurningLine(s).replace(/<[^>]*>/g, '');
  assert.ok(!line.includes('之前一直在第一位'), '第1天不是第一，就不许说“一直在第一位”');
  assert.ok(line.includes('曾爬到过第 1 名'), '要说出曾爬到过哪里');
  assert.ok(line.includes('第 2 天'));
});

test('第1天确实是第一、掉下去就再没回去：说“之前一直在第一位”是对的', () => {
  const s = base();
  // 注意：不能中途又回第一，否则会走“往返”分支（那也是对的，但不是这条要验的）。
  s.slice.assetByDay = [mkDay(1, 120, 100, 90), mkDay(2, 110, 130, 90), mkDay(3, 100, 140, 90)];
  const hit = firstFallBehindDay(s);
  assert.equal(hit.firstDayRank, 1);
  assert.equal(hit.lastRank1Day, 1, '掉下去后没再回第一');
  // 第3天 100 vs 甲140 / 乙90 ⇒ 只有甲高于我 ⇒ 第2名（先前写成 3 是我算错）。
  assert.equal(hit.finalRank, 2);
  const line = gapTurningLine(s).replace(/<[^>]*>/g, '');
  assert.ok(line.includes('之前一直在第一位'), '第1天确实第一，这句话成立');
  assert.ok(!line.includes('又回到过第一'), '没回去过就不许说回去过');
});

// #646：finalRank 曾取“首次落下那天”的值，不是终局。
// 反例：第1天第3名(80) → 第2天第1名(120) → 第3天掉(110 vs 130) → 第4天回第1名(200)。
// 旧代码报 finalRank=2，但终局他其实是第1名 —— 说错了话。
test('finalRank 必须是终局名次，不是首次落下那天的名次', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 80, 100, 90), mkDay(2, 120, 100, 90),
    mkDay(3, 110, 130, 90), mkDay(4, 200, 130, 90)];
  const hit = firstFallBehindDay(s);
  assert.equal(hit.day, 3);
  assert.equal(hit.finalRank, 1, '终局第4天他是第1名');
  assert.equal(hit.finalDay, 4);
  assert.equal(hit.lastRank1Day, 4);
});

test('掉下去又回第一：必须说结尾回到了第一，否则玩家以为输了', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 80, 100, 90), mkDay(2, 120, 100, 90),
    mkDay(3, 110, 130, 90), mkDay(4, 200, 130, 90)];
  const line = gapTurningLine(s).replace(/<[^>]*>/g, '');
  assert.ok(line.includes('又回到第一位'), '必须说结尾回到第一');
  assert.ok(line.includes('保持到结束'));
});

test('第1天第一→掉→回第一→又掉：说出来回，不能只说首次落下', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 120, 100, 90), mkDay(2, 110, 130, 90),
    mkDay(3, 200, 130, 90), mkDay(4, 150, 160, 90)];
  const hit = firstFallBehindDay(s);
  assert.equal(hit.day, 2);
  assert.equal(hit.lastRank1Day, 3);
  assert.equal(hit.finalRank, 2);
  assert.equal(hit.finalGap, 10);
  const line = gapTurningLine(s).replace(/<[^>]*>/g, '');
  assert.ok(line.includes('又回到过第一'), '中途回去过要说');
  assert.ok(line.includes('落后 10'), '终局差距要用终局值，不是首次落下的 20');
});

// #646：不变量自检。
//
// 前面那些测试都是"给定快照 → 断言期望文案"。这类测试有个共同盲区：
// 如果实现把一个真实存在的数字放错了位置（例如把"首次落下的值"写成"终局值"），
// 那个数字本身仍然真实，单条断言若不逐字段查就查不出来。
//
// 这里换一种思路：文案里出现的每个数字都必须能在 assetByDay 里找到来源。
// 编造的数字、不存在的天、与终局不自洽的值，一个都跑不掉。
//
// 这个自检本身做过牙证明：往文案里注入「第 99 天 / 888,888」后，24 局里 4 局报错。
test('不变量：文案里的天数/金额/名次都能追溯到 assetByDay', () => {
  const rankAt = (days, players, humanId, k) => {
    const d = days[k];
    const mine = d.assets[humanId];
    return players.map(p => d.assets[p.id]).filter(v => v > mine).length + 1;
  };
  const cases = [
    [mkDay(1, 80, 100, 90), mkDay(2, 120, 100, 90), mkDay(3, 110, 130, 90), mkDay(4, 200, 130, 90)],
    [mkDay(1, 120, 100, 90), mkDay(2, 110, 130, 90), mkDay(3, 200, 130, 90), mkDay(4, 150, 160, 90)],
    [mkDay(1, 80, 100, 90), mkDay(2, 95, 105, 90), mkDay(3, 60, 140, 90)],
    [mkDay(1, 120, 100, 90), mkDay(2, 130, 100, 90), mkDay(3, 100, 140, 90)],
  ];
  for (const days of cases) {
    const s = base();
    s.slice.assetByDay = days;
    const human = s.players.find(p => p.controller === 'human');
    const line = gapTurningLine(s).replace(/<[^>]*>/g, '');
    const hit = firstFallBehindDay(s);
    // 天数必须在表里
    for (const m of line.matchAll(/第\s*(\d+)\s*天/g)) {
      const d = Number(m[1]);
      assert.ok(days.some(e => e.day === d), `引用了不存在的第 ${d} 天：${line}`);
    }
    // 金额必须是某一天的真实差距
    const validMoney = new Set();
    const validRank = new Set();
    for (const d of days) {
      const mine = d.assets[human.id];
      const nums = s.players.map(p => d.assets[p.id]);
      validMoney.add(Math.max(...nums) - mine);
      validRank.add(nums.filter(v => v > mine).length + 1);
    }
    for (const m of line.matchAll(/([\d,]{2,})/g)) {
      if (!m[1].includes(',')) continue;
      const v = Number(m[1].replace(/,/g, ''));
      assert.ok(validMoney.has(v), `金额 ${m[1]} 不来自任何一天的差距：${line}`);
    }
    for (const m of line.matchAll(/第\s*(\d+)\s*名/g)) {
      assert.ok(validRank.has(Number(m[1])), `名次 ${m[1]} 不来自任何一天：${line}`);
    }
    // 终局值必须与最后一行独立算出的值一致
    const last = days.length - 1;
    const lastRank = rankAt(days, s.players, human.id, last);
    const lastGap = Math.max(...s.players.map(p => days[last].assets[p.id])) - days[last].assets[human.id];
    if (hit) {
      assert.equal(hit.finalRank, lastRank, 'finalRank 必须等于独立算的终局名次');
      assert.equal(hit.finalGap, lastGap, 'finalGap 必须等于独立算的终局差距');
    }
    // 首次落下那天：前一天必须是第 1 名
    if (hit && !hit.fromStart) {
      const idx = days.findIndex(d => d.day === hit.day);
      assert.ok(idx > 0, '首次落下不能在第 1 天（那属于 fromStart）');
      assert.equal(rankAt(days, s.players, human.id, idx - 1), 1, '首次落下那天的前一天必须是第 1 名');
    }
  }
});

// #646：破产后资产归 0，快照仍逐日记录。旧文案会把“出局后的 0”当成普通落后去比较：
//   “…结束时落到第 3 名（落后 113,600）” —— 而人第 9 天就破产了。
// 玩家读到会以为还有翻盘可能。
test('人类破产：说“第 N 天资金耗尽出局”，不说“结束时落后多少”', () => {
  const s = base();
  s.slice.assetByDay = [mkDay(1, 62000, 58000, 62000), mkDay(2, 62000, 62000, 62000),
    mkDay(3, 56000, 62000, 62000), mkDay(4, 62000, 62000, 62000),
    mkDay(9, 0, 93400, 65600), mkDay(16, 0, 113600, 59400)];
  const hit = firstFallBehindDay(s);
  assert.equal(hit.busted, true, '末尾资产 0 且曾 >0 ⇒ 破产');
  assert.equal(hit.bustDay, 9);
  const line = gapTurningLine(s).replace(/<[^>]*>/g, '');
  assert.ok(line.includes('第 9 天资金耗尽出局'), '必须说出局日');
  assert.ok(!line.includes('结束时落到'), '破产后不许再报“结束时落到第N名”');
});

test('并列第一：说“追平/同分”，不说“回到过第一”', () => {
  const s = base();
  // 第4天三人同分 62000（并列），第6天掉下去
  s.slice.assetByDay = [mkDay(1, 62000, 58000, 62000), mkDay(2, 62000, 62000, 62000),
    mkDay(3, 56000, 62000, 62000), mkDay(4, 62000, 62000, 62000),
    mkDay(6, 56400, 66000, 69600)];
  const hit = firstFallBehindDay(s);
  assert.equal(hit.bestRank, 1);
  assert.equal(hit.bestAlone, false, '第4天是三人并列，不是独自第一');
  const line = gapTurningLine(s).replace(/<[^>]*>/g, '');
  assert.ok(/追平|同分/.test(line), '并列要用“追平/同分”');
  assert.ok(!/回到过第一/.test(line), '并列不许说“回到过第一”');
});

test('时序：说“之前曾爬到/追平”时，引用的天必须早于首次落下那天', () => {
  const s = base();
  // grow/seed=1 的真实形状：第4/5/8天并列第一，第9天独自第一，但首次落下在...
  // 这里构造：首次落下在第6天，而“独自第一”直到第9天才出现。
  s.slice.assetByDay = [mkDay(4, 66000, 62000, 66000), mkDay(5, 66000, 62000, 66000),
    mkDay(6, 60000, 66000, 62000), mkDay(9, 75000, 69000, 66000)];
  const hit = firstFallBehindDay(s);
  assert.equal(hit.day, 6, '首次落下在第6天');
  const line = gapTurningLine(s).replace(/<[^>]*>/g, '');
  // 文案里所有“第 N 天”若出现在“之前曾”之后，必须 < hit.day... 简化做法：
  // “曾…（第 N 天）”里的 N 不能晚于 hit.day。
  const m = /之前曾[^（]*（第 (\d+) 天）/.exec(line);
  if (m) assert.ok(Number(m[1]) < hit.day, `引用了落下之后的天：第 ${m[1]} 天 ≥ ${hit.day}`);
  assert.ok(!/之前曾爬到过第 1 名（第 9 天）/.test(line), '不许出现时序倒置的那句');
});
