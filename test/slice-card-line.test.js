import test from 'node:test';
import assert from 'node:assert/strict';

// #1398：动作屏的卡面要写**这一局此刻**的数。
//
// 为什么需要这条测试：卡面上的每个金额都必须与引擎同源（rentFor / buyPrice）。
// 唯一的失败模式是「编数」——盘面变了卡面没变、或写一个盘面上算不出来的数，
// 玩家就按一句假账做决定。所以这里钉四件事：
//   1. 有可用目标时，卡面同时有「效果主句」与「盘面此刻的数」，且数等于 supplyWorth 的输出；
//   2. 没有可用目标时，卡面不多写任何一个数字（交给已签的「现在没有合法目标」）；
//   3. 非切片局 / 拿不到玩家时，只给通用效果，不编；
//   4. 拼装过程**不改 state**：调用前后对 properties/现金/日志取指纹必须相同。
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { sliceCardLine, sliceCardDescription, upgradeAfterLine, money } from '../src/ui/slice.js';
import { supplyWorth, sliceTargetIds } from '../src/engine/insight.js';

const sum = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const fingerprint = state => sum(JSON.stringify({
  props: Object.fromEntries(Object.entries(state.properties).map(([k, v]) => [k, [v.ownerId, v.level, v.closed, v.inflate, v.street]])),
  cash: state.players.map(p => [p.id, p.cash, p.deposit, (p.cards ?? []).join(',')]),
  log: (state.log ?? []).map(l => l.day + ':' + l.text).join('|'),
}));
const digits = s => String(s).match(/\d[\d,]*/g) ?? [];

test('有可用目标时，卡面给出效果 + 盘面此刻的数，且数与引擎同源', () => {
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = state.players.find(p => p.controller === 'human');
  const line = sliceCardLine(state, human, 'worker');
  const w = supplyWorth(state, human, 'worker');
  assert.ok(w.count >= 1, '夹具应当至少有 1 栋可升');
  assert.match(line, /免费升己方一栋已建店 1 级（最高 3 级）/, '效果主句必须还在');
  assert.match(line, new RegExp(`现在可升 ${w.count} 栋`));
  // 每个金额都必须能在 supplyWorth 的输出里找到，一个不多。
  const shown = digits(line.replace(/^\D*\d+ 级/, '').replace(/最高 3 级/, ''));
  const allowed = new Set([...w.each.map(v => money(v)), String(w.count)]);
  for (const d of shown) assert.ok(allowed.has(d), `卡面出现了引擎没给的数: ${d} (line=${line})`);
});

test('没有可用目标时，卡面不多写一个数', () => {
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = state.players.find(p => p.controller === 'human');
  // 把手上所有小店都升到顶：worker 就没有合法目标了（业务上等价于中后期）。
  for (const [id, pr] of Object.entries(state.properties)) {
    if (pr.ownerId === human.id) pr.level = state.config.maxLevel ?? 3;
  }
  assert.equal(supplyWorth(state, human, 'worker').count, 0);
  assert.equal(sliceCardLine(state, human, 'worker'), sliceCardDescription('worker'),
    '没有目标时必须逐字等于通用效果，不许追加任何数');
});

test('规则事实不能为了省字被删（书屋须到场 / 对手可封租 / 旺季计时照走）', () => {
  const state = startSession(createSliceConfig({ seed: 7, style: 'take' }));
  const human = state.players.find(p => p.controller === 'human');
  const buy = sliceCardLine(state, human, 'buyland');
  if (buy !== sliceCardDescription('buyland')) assert.match(buy, /书屋须到场/, '收购卡的规则事实丢了');
  const inf = sliceCardLine(state, human, 'inflate');
  if (inf !== sliceCardDescription('inflate')) assert.match(inf, /对手可封租/, '旺季卡的规则事实丢了');
  const clo = sliceCardLine(state, human, 'close');
  if (clo !== sliceCardDescription('close')) assert.match(clo, /旺季计时照走/, '停业卡的规则事实丢了');
});

test('旺季/停业卡不点名街道（点名会与点开后的面板排序打架）', () => {
  // 实测：面板按 |对手租变化| 排前 4 条，streetsWorth 按 net 取第一条，
  // 24 局 1366 帧里 651 帧两者不同的街 —— 屏上点名就是自相矛盾。
  const state = startSession(createSliceConfig({ seed: 1, style: 'grow' }));
  const human = state.players.find(p => p.controller === 'human');
  const streets = [...new Set(state.map.plots.map(p => p.street))];
  for (const id of ['inflate', 'close']) {
    const line = sliceCardLine(state, human, id);
    for (const s of streets) assert.ok(!line.includes(s), `${id} 卡面出现了街名 ${s}：${line}`);
    assert.ok(!/最值/.test(line), `${id} 卡面用了「最值」而不是可核的上限：${line}`);
    assert.match(line, /最多 [\d,]+/, `${id} 卡面没有可核的上限：${line}`);
  }
});

test('弃牌屏与手牌卡面用同一份撑辞（否则同一张卡两屏不一致）', async () => {
  // 实测过：手牌写「现在能收购 6 块，每块 10,000–15,000」，几秒后的弃牌屏只剩通用描述。
  // 弃牌正是要拿这两个数比「丢哪张亏得少」的地方。
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8');
  const discard = /pending\.type==='discard'[\s\S]{0,1200}?data-discard[\s\S]{0,400}?\n/.exec(src);
  assert.ok(discard, '找不到弃牌分支');
  assert.match(discard[0], /sliceCardLine\(state,p,id\)/, '弃牌屏必须调 sliceCardLine，不能退回 sliceCardDescription');
});

test('翻修选目标屏要写「升完多少」，且与手牌的单栋增量一致', () => {
  // 实测：那一屏原先只说「升 1 级」，地图角标只说**当前**租，两个候选都写 2,800，
  // 玩家看不出升完差多少 —— 先前把它判成「能答」是错的。
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = state.players.find(p => p.controller === 'human');
  const ids = sliceTargetIds(state, human, 'worker');
  assert.ok(ids.length >= 1, '夹具应当至少有 1 栋可升');
  const line = upgradeAfterLine(state, human, ids);
  assert.match(line, /升完/, `没能说出升完多少：${line}`);
  assert.match(line, /\d[\d,]*→\d[\d,]*|→/, `缺少「前→后」的租：${line}`);
  // 与手牌同源：手牌说「单栋+X」，这一屏的数字必须对得上
  const card = sliceCardLine(state, human, 'worker');
  const m = /单栋\+(\d[\d,]*)/.exec(card);
  if (m) assert.ok(line.includes(m[1]), `两屏数字不一致：卡面 ${m[1]}，选目标屏 ${line}`);
  // 不改 state
  const fp = JSON.stringify(Object.entries(state.properties).map(([k, v]) => [k, v.level, v.ownerId]));
  upgradeAfterLine(state, human, ids);
  assert.equal(JSON.stringify(Object.entries(state.properties).map(([k, v]) => [k, v.level, v.ownerId])), fp);
});

test('#1444：资金 0 但资产变了的回合也要写原因（免费翻修曾被漏掉）', async () => {
  // 实测：611 帧动作屏里 44 帧（7.2%）是「资金 +0 · 资产 +4,000」而完全没有原因，
  // 全是因为 turnCauseLine 看到 money 为 0 就返回 null。那 44 帧全是「免费翻修升一级」。
  const { turnCauseLine, assetCauseLine } = await import('../src/ui/slice.js');
  const last = { day: 2, money: 0, assets: 4000, lines: [
    '—— 第 1 天 · 街角店主 的回合 ——',
    '街角店主 使用 翻修 → 晨光街小店，升到 2 级，租 5,600（免费，立即回本）；这条街现在归你，对手踩到付 5,600',
  ] };
  assert.equal(assetCauseLine(last, '街角店主'), '翻修 晨光街小店 升到 2 级');
  assert.equal(turnCauseLine(last, '街角店主'), '翻修 晨光街小店 升到 2 级');
  // 别人翻的修不能记到我头上
  assert.equal(turnCauseLine(last, '机会买家'), null);
  // 资金真的动过时仍走原来的路（逐字不变）
  const moneyTurn = { day: 3, money: -8000, assets: 4000, lines: [
    '街角店主 买下 月色街小店（支付 8000）'] };
  assert.equal(turnCauseLine(moneyTurn, '街角店主'), '买下 月色街小店 8,000');
  // #1458 改了这条：两栏为 0 时写「掷出 N 点；这回合钱没动」（见文末的 #1458 守护）。
  assert.equal(turnCauseLine({ day: 1, money: 0, assets: 0, lines: ['街角店主 掷出 3 点'] }, '街角店主'),
    '掷出 3 点；这回合钱没动');
  // 方向：资产是跌的（买地又免费翻修）⇒ 不能拿「升级」当理由（实测曾输出）
  assert.equal(turnCauseLine({ day: 5, money: 0, assets: -4000, lines: [
    '街角店主 买下 月色街小店（支付 8000）',
    '街角店主 使用 翻修 → 晨光街小店，升到 2 级，租 5,600（免费，立即回本）'] }, '街角店主'), null);
  // 一幅账盖不住涨幅 ⇒ 不说（4,000 的升幅解释不了 8,000 的资产涨幅）
  assert.equal(turnCauseLine({ day: 5, money: 0, assets: 8000, lines: [
    '街角店主 使用 翻修 → 晨光街小店，升到 2 级，租 5,600（免费，立即回本）'] }, '街角店主'), null);
  // 两栏都是 0 时现在写一句真动作（#1458，用户已批）：占比 1,812 帧里的 683 帧（37.7%）。
  // 它改的是 #1295 已签的「资金 +0 恒不写」，例外就在这一条上，逐字钉住。
  assert.equal(turnCauseLine({ day: 5, money: 0, assets: 0, lines: [
    '—— 第 5 天 · 街角店主 的回合 ——',
    '街角店主 掷出 2 点',
    '街角店主 停在 街道，旁边是 西巷茶铺'] }, '街角店主'),
    '掷出 2 点，停在 街道；这回合钱没动');
  // 两栋都升 = 两笔都写出来
  assert.equal(turnCauseLine({ day: 5, money: 0, assets: 8000, lines: [
    '街角店主 使用 翻修 → 街心书屋，升到 3 级，租 8,000',
    '街角店主 使用 翻修 → 晨光街小店，升到 2 级，租 5,600'] }, '街角店主'),
    '翻修 街心书屋 升到 3 级 + 翻修 晨光街小店 升到 2 级');
});

test('非切片局或没有玩家时，只给通用效果', () => {
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = state.players.find(p => p.controller === 'human');
  assert.equal(sliceCardLine({ ...state, slice: null }, human, 'worker'), sliceCardDescription('worker'));
  assert.equal(sliceCardLine(state, null, 'worker'), sliceCardDescription('worker'));
});

test('拼卡面不改 state：属性/现金/手牌/日志指纹前后相同', () => {
  const state = startSession(createSliceConfig({ seed: 7, style: 'take' }));
  const human = state.players.find(p => p.controller === 'human');
  const before = fingerprint(state);
  for (const id of ['worker', 'inflate', 'close', 'remotedice', 'buyland']) sliceCardLine(state, human, id);
  assert.equal(fingerprint(state), before);
});
