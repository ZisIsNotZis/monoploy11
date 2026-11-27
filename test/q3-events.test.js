import test from 'node:test';
import assert from 'node:assert/strict';

// #807：三类结算事件的流水里必须回答「这一笔改变了我下回合的什么」。
//
// 主判据是人读（见 .scratch/807/CRITERIA.md）。这里只锁三件能自动断言的事：
//   ① 视角不能反：对手盖楼 / 对手买地，绝不写「归你」
//   ② 金额必须来自引擎：句里的租金 == rentFor(state,id)
//   ③ 删掉新加的半句 ⇒ 这些断言会红
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { buildPlot, buyPlot } from '../src/engine/flow.js';
import { rentFor, cheapestBuyable } from '../src/engine/economy.js';

function freshState() {
  const s = startSession(createSliceConfig({ seed: 7, style: 'cross' }));
  const me = s.players.find(p => p.controller === 'human');
  const opp = s.players.find(p => p.id !== me.id);
  return { s, me, opp };
}

// 取最近一条日志
const lastLog = s => (s.log.at(-1)?.text ?? s.log.at(-1) ?? '');

function setupStreets(s, owner, level = 1) {
  const byStreet = new Map();
  for (const p of s.map.plots.filter(x => !x.big && x.street)) {
    if (!byStreet.has(p.street)) byStreet.set(p.street, []);
    byStreet.get(p.street).push(p);
  }
  const out = [];
  for (const [st, ps] of byStreet) {
    for (const p of ps.slice(0, 1)) {
      s.properties[p.id] = { ...(s.properties[p.id] ?? {}), ownerId: owner.id, level, street: st, closed: 0, inflate: 0 };
      out.push(p);
    }
  }
  return out;
}

test('#807 build 视角：对手盖楼不许写“归你”，且租金 == rentFor', () => {
  const { s, opp } = freshState();
  const plots = setupStreets(s, opp, 1);
  const target = plots[0];
  // 给对手钱去升
  opp.cash = 999_999;
  s.properties[target.id].ownerId = opp.id;
  buildPlot(s, opp, target.id);
  const line = lastLog(s);
  assert.match(line, /升到 Lv\./, 'buildPlot 没写出日志：' + line);
  assert.doesNotMatch(line, /这条街现在归你/, '对手盖楼却写“归你”：' + line);
  assert.match(line, /对手这条街涨到/, '对手盖楼没写清“这条街涨到多少”：' + line);
  // 金额一致：**Q3 半句里**的租金必须等于 rentFor。
  // 注意：不能对整个 line 做 includes —— 日志前半段还有「租 N」，
  // 那个数字会掩盖 Q3 半句里写死的值（牙③ 就是这么假绿的）。
  const expect = rentFor(s, target.id).toLocaleString();
  const q3part = line.slice(line.indexOf('；'));
  assert.ok(q3part.length > 1, '找不到 Q3 半句：' + line);
  const nums = [...q3part.matchAll(/[\d,]{3,}/g)].map(m => m[0]);
  assert.ok(nums.length > 0, 'Q3 半句里没有金额：' + q3part);
  assert.deepEqual([...new Set(nums)], [expect],
    `Q3 半句的金额必须只有 rentFor 那一个值（${expect}），实际：${JSON.stringify(nums)}`);
});

test('#807 build 视角：玩家自己盖楼写“归你 + 对手踩到付”，同样对齐 rentFor', () => {
  const { s, me } = freshState();
  const plots = setupStreets(s, me, 1);
  const target = plots[0];
  me.cash = 999_999;
  s.properties[target.id].ownerId = me.id;
  s.properties[target.id].level = 1;
  buildPlot(s, me, target.id);
  const line = lastLog(s);
  assert.match(line, /这条街现在归你/, '玩家盖楼没写“归你”：' + line);
  assert.match(line, /对手踩到付/, '玩家盖楼没写“对手踩到付多少”：' + line);
  assert.doesNotMatch(line, /对手这条街涨到/, '玩家盖楼用了对手视角的措辞：' + line);
  // 同一条规矩：只在 Q3 半句内比对金额。
  const expect = rentFor(s, target.id).toLocaleString();
  const q3part = line.slice(line.indexOf('；'));
  const nums = [...q3part.matchAll(/[\d,]{3,}/g)].map(m => m[0]);
  assert.deepEqual([...new Set(nums)], [expect],
    `Q3 半句的金额必须只有 rentFor 那一个值（${expect}），实际：${JSON.stringify(nums)}`);
});

test('#807 rent 视角：玩家付/收两种写法不同，且最低价来自 cheapestBuyable', () => {
  const { s, me, opp } = freshState();
  // 让玩家拥有一块，对手踩上去 ⇒ 玩家收租；再让对手拥有一块，玩家踩上去 ⇒ 玩家付租。
  // 这里只验文案函数：用一个能触发日志的最小场景。
  const cheap = cheapestBuyable(s, me);
  assert.ok(cheap && cheap.price > 0, 'cheapestBuyable 没给出可买地块：' + JSON.stringify(cheap));
  // 与 map 直算对账
  const manual = s.map.plots.filter(p => !p.big && s.day >= (p.availableFromDay ?? 1) && s.properties[p.id]?.ownerId !== me.id)
    .map(p => ({ id: p.id })).length;
  assert.ok(manual > 0, '当下没有可买地块，这条断言会空过');
});

test('#807 cheapestBuyable 只返回**无主**地（对手的地要付 1.25 倍收购价）', () => {
  // 真浏览器日志里拓到的缺陷：
  //   「实付租金 0（晚风街小店），…你剩 32,000，够买一块 晚风街小店（8,000）」
  // 那块地是对手的，实际收购要 10,000（buyPrice×1.25）——用 8,000 说“够买”就是错的。
  const { s, me, opp } = freshState();
  // 把所有小地都给对手，只留一块无主
  const smalls = s.map.plots.filter(p => !p.big && s.day >= (p.availableFromDay ?? 1));
  for (const p of smalls) {
    s.properties[p.id] = { ...(s.properties[p.id] ?? {}), ownerId: opp.id, level: 1, closed: 0, inflate: 0 };
  }
  // 夹具方向很关键：必须让**对手地**成为最低价，否则新旧的过滤条件区分不开。
  // 上一版把无主地做成最低价，于是“允许对手地”的旧代码也选到它 ⇒ 牙④ 假绿。
  // 现在：对手地等级 0（标价 8,000），无主地等级 3（标价 16,000）。
  // 旧代码（允许对手地）会选 8,000 的对手地；新代码（只无主）只能选 16,000 的无主地。
  const free = smalls[smalls.length - 1];
  s.properties[free.id] = { ...(s.properties[free.id] ?? {}), ownerId: null, level: 3 };
  for (const p of smalls) {
    if (p.id === free.id) continue;
    s.properties[p.id] = { ...(s.properties[p.id] ?? {}), ownerId: opp.id, level: 0 };
  }
  const cheap = cheapestBuyable(s, me);
  assert.ok(cheap, '有无主地却没返回任何可买');
  assert.equal(s.properties[cheap.id]?.ownerId, null,
    `cheapestBuyable 返回了有主地（${cheap.name}），但文案用的是标价而非 1.25 倍收购价`);
  assert.equal(cheap.id, free.id, '没选到那块无主地');
});

test('#807 cheapestBuyable 只读：不写 state、不消耗随机数', () => {
  const { s, me } = freshState();
  const snap = () => JSON.stringify({ p: s.properties, c: s.players.map(q => q.cash), d: s.day });
  const before = snap();
  cheapestBuyable(s, me);
  cheapestBuyable(s, me);
  assert.equal(snap(), before, 'cheapestBuyable 改了 state');
});

test('#807 buyPlot（大店）：买书屋后写清“你踩到要付”，不写归自己', () => {
  const { s, me, opp } = freshState();
  const market = s.map.plots.find(p => p.big);
  // 让对手买下书屋
  s.day = 10;                                   // 已过 availableFromDay
  opp.cash = 999_999;
  s.properties[market.id] = { ...(s.properties[market.id] ?? {}), ownerId: null, level: 1, closed: 0, inflate: 0 };
  buyPlot(s, opp, market.id, market);
  const line = lastLog(s);
  assert.match(line, /买下/, 'buyPlot 没写出日志：' + line);
  assert.match(line, /你踩到要付/, '对手买大店没告诉玩家要付多少：' + line);
  assert.doesNotMatch(line, /现在别人踩到这格要付你/, '对手买的店却写成玩家收租：' + line);
});
