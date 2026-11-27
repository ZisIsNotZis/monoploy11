import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { renderSliceInsight, turnCauseLine, quietTurnLine } from '../src/ui/slice.js';

// #1295：玩家在决策屏上必须能回答「我刚才那笔钱为什么变了」。
//
// 为什么需要这个测试：这句原因原先只在 <details> 里，默认不可见；把它提到 summary 上
// 之后，**唯一的失败模式是编造** —— 拼不齐也硬写一句，玩家就得到一条假账。
// 所以这里钉三件事：
//   1. 有原因时，默认可见的 <summary> 里就有来源与金额（不是只在折叠正文里）；
//   2. 拼不齐（日志缺行）时返回 null 且 summary 不多写一个字，绝不编；
//   3. 破产回合按「实付」算，不按「应付」—— 两者在破产时差 5,800（seed 1 take D9）。

const turn = (money, lines) => ({ day: 3, money, assets: 0, lines });

test('买地的钱变，原因直接出现在默认可见的 summary 里', () => {
  const last = turn(-8000, [
    '—— 第 4 天 · 街角店主 的回合 ——',
    '街角店主 停在 街道，旁边是 月色街小店',
    '街角店主 买下 月色街小店（支付 8000）；你还剩 36,000，对手踩到付你 2,000',
  ]);
  const cause = turnCauseLine(last, '街角店主');
  assert.equal(cause, '买下 月色街小店 8,000');

  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = s.players.find(p => p.controller === 'human');
  human.lastTurn = last;
  const el = { innerHTML: '', hidden: false };
  renderSliceInsight(el, s, human);
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(el.innerHTML)?.[1] ?? '';
  assert.ok(summary.includes('买下 月色街小店 8,000'), `summary 里没有原因：${summary}`);
  assert.ok(summary.includes('-8,000'), 'summary 里没有资金变化量');
});

test('收租按实付：破产时不能拿「应付租金」冒充已付', () => {
  // 真实 seed 1 take D9：应付 19,200（旺季翻倍），实付 5,800，余额不够破产。
  const last = turn(-5800, [
    '街角店主 向 机会买家 应付租金 19200（街心书屋） · 旺季翻倍 · 现金不够，会破产',
    '街角店主 实付租金 5800（街心书屋），机会买家 收到 5800 · 你剩 0',
  ]);
  const cause = turnCauseLine(last, '街角店主');
  assert.ok(cause.includes('5,800'), `应按实付：${cause}`);
  assert.equal(/19,200/.test(cause), false, `不能把应付当已付：${cause}`);
});

test('日志拼不齐时沉默，不编一个数', () => {
  // 钱变了 8,000，但日志里没有任何一行解释它 —— 这种情况必须返回 null。
  const last = turn(-8000, ['街角店主 掷出 4 点', '街角店主 停在 街道']);
  assert.equal(turnCauseLine(last, '街角店主'), null);

  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = s.players.find(p => p.controller === 'human');
  human.lastTurn = last;
  const el = { innerHTML: '', hidden: false };
  renderSliceInsight(el, s, human);
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(el.innerHTML)?.[1] ?? '';
  assert.match(summary, /你上回合：资金 -8,000/, '基本的资金行仍要保留');
  assert.equal(/（/.test(summary), false, `拼不齐时不该多出括号里的解释：${summary}`);
});

test('#1458：两栏都是 0 的回合写「掷出几点、停在哪」，不编金额', () => {
  // 实测 1,812 帧动作屏里 683 帧（37.7%）是两栏都 0，玩家只看到「资金 +0 · 资产 +0」。
  // 这一句只复用日志原文：掷点数与落点都是引擎已经写进日志的行。
  const last = { day: 5, money: 0, assets: 0, lines: [
    '—— 第 5 天 · 街角店主 的回合 ——',
    '街角店主 掷出 4 点',
    '街角店主 停在 街道，旁边是 西巷茶铺',
  ] };
  assert.equal(turnCauseLine(last, '街角店主'), '掷出 4 点，停在 街道；这回合钱没动');
  // 落点行后面那句（旁边是哪家店）不塞进这一行：它会把 summary 撑到第二行
  assert.equal(/旁边是/.test(turnCauseLine(last, '街角店主')), false);
  // 只取最后一次落点：果冻墙弹回会写两次「停在」
  assert.equal(turnCauseLine({ day: 2, money: 0, assets: 0, lines: [
    '街角店主 掷出 3 点',
    '街角店主 停在 果冻墙',
    '街角店主 停在 街道',
  ] }, '街角店主'), '掷出 3 点，停在 街道；这回合钱没动');
  // 原地不动（skipMove）也要说得出话
  assert.equal(turnCauseLine({ day: 2, money: 0, assets: 0, lines: [
    '街角店主 停留，本回合移动 0 步',
  ] }, '街角店主'), '这回合原地不动；这回合钱没动');
  // 对手的掷骰不能记到我头上：没有我自己的动作就不写
  assert.equal(turnCauseLine({ day: 2, money: 0, assets: 0, lines: [
    '机会买家 掷出 5 点',
    '机会买家 停在 街道',
  ] }, '街角店主'), null);
  // 资金或资产只要有一个不为 0，就不走这一路（那是 #1295/#1444 的分支）
  assert.equal(turnCauseLine({ day: 2, money: 2000, assets: 0, lines: ['街角店主 掷出 2 点'] }, '街角店主'), null);
});

test('#1458：两栅都是 0 时是**换掉**那一行，不是后面再挂一句（否则多占一行）', () => {
  // 实测（真 Edge 1280×800，同一帧、同一 365px 宽）：
  //   追加 ⇒ summary 1 行变 2 行（H 20.8→41.6），第三张卡中心从命中变 out-of-view（bottom 845.7→863.2）；
  //   换成 ⇒ 仍是 1 行，第三张卡仍可点（含最长标签「发薪处」也是 1 行）。
  // 卡面几何硬约束：多一行就把第三张卡推出可点范围，所以这里钉住渲染形状。
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = s.players.find(p => p.controller === 'human');
  human.lastTurn = { day: 2, money: 0, assets: 0, lines: [
    '街角店主 掷出 2 点',
    '街角店主 停在 发薪处'] };
  const el = { innerHTML: '', hidden: false };
  renderSliceInsight(el, s, human);
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(el.innerHTML)?.[1] ?? '';
  assert.equal(summary, '你上回合：掷出 2 点，停在 发薪处；这回合钱没动');
  // 两个 0 不再出现（换掉了，而不是留在前面）
  assert.equal(/资金 \+0/.test(summary), false, `不该留着「资金 +0」：${summary}`);
  // 明细仍可展开逐行核对
  assert.ok(el.innerHTML.includes('<li>街角店主 停在 发薪处</li>'), '折叠明细丢了');

  // 资金真变的帧必须逐字不变（这是改 #1295 已签口径的硬前提）
  human.lastTurn = { day: 3, money: -8000, assets: 4000, lines: [
    '街角店主 买下 月色街小店（支付 8000）'] };
  renderSliceInsight(el, s, human);
  const moneySummary = /<summary>([\s\S]*?)<\/summary>/.exec(el.innerHTML)?.[1] ?? '';
  assert.equal(moneySummary, '你上回合：资金 -8,000 · 资产 +4,000（买下 月色街小店 8,000）');
});

test('别人的转账不算进我的资金变化', () => {
  const last = turn(-2000, [
    '机会买家 在金钱格获得 3000',
    '街角店主 实付租金 2000（晚风街茶铺），机会买家 收到 2000 · 你剩 20,000',
  ]);
  const cause = turnCauseLine(last, '街角店主');
  assert.equal(cause, '向 机会买家 付租 2,000（晚风街茶铺）');
  assert.equal(/3,000/.test(cause), false, '把对手的收入算进我的账');
});

test('资金没变时不说钱的原因（0 元没有来源可说），但说这一回合做了什么', () => {
  // #1458 改了后半句：钱没动的回合不再只写「资金 +0 · 资产 +0」。
  // 它不编任何金额——「这回合钱没动」本身就是已签那句话的事实，只是补上了动作。
  assert.equal(turnCauseLine(turn(0, ['街角店主 掷出 5 点']), '街角店主'),
    '掷出 5 点；这回合钱没动');
  assert.equal(turnCauseLine(turn(0, ['街角店主 停留，本回合移动 0 步']), '街角店主'),
    '这回合原地不动；这回合钱没动');
  assert.equal(quietTurnLine(null, '街角店主'), null);
  assert.equal(turnCauseLine(null, '街角店主'), null);
});
