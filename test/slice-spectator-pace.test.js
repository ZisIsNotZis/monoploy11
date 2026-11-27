import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { EXPERIENCE } from '../src/data/experience.js';
import { renderSliceInsight } from '../src/ui/slice.js';

// #1343：人类出局之后，剩余回合玩家没有任何决定可做，只是陪 AI 打完。
//
// 为什么需要这个测试：实测（真 Edge，1280×800，正常入口）出局→结算这段要
// 13.5s（seed 1 take）/ 15.8s（seed 4 grow）。出局本身已经是惩罚，
// 再让玩家以正常速度看完剩下的天，等于把「没看懂就过去了」变成「只能干看」。
// 这里只钉两件事：
//   1. 陪看节奏确实比正常节奏快，且快得有意义（不是 220→200 这种看不见的差别）；
//   2. 出局那一刻的侧栏标题说的是「你已出局」，不是「X 正在行动…」。
// 不改任何胜负/结算 —— 那条由 .scratch/1343-cut/postdeath.mjs 逐局对拍（36/36 一致）。

test('陪看节奏明显快于正常节奏（出局后不该再按正常速度播）', () => {
  assert.equal(typeof EXPERIENCE.slice.outMs, 'number');
  assert.ok(EXPERIENCE.slice.outMs > 0, '不能是 0：0 会让整局在几帧内闪完，玩家连结果都看不清');
  assert.ok(EXPERIENCE.slice.outMs <= EXPERIENCE.slice.aiMs / 3,
    `陪看节奏至少要快到正常 AI 间隔的三分之一，实际 ${EXPERIENCE.slice.outMs} vs ${EXPERIENCE.slice.aiMs}`);
  assert.ok(EXPERIENCE.slice.outMs < EXPERIENCE.slice.stepMs,
    '陪看节奏也要快于逐格移动，否则移动段仍是正常速度');
});

test('出局那一刻侧栏标题写「你已出局」，不写「对手正在行动…」', () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = s.players.find(p => p.controller === 'human');
  const ai = s.players.find(p => p.controller !== 'human');
  human.alive = false;              // 只改存活标记：这是引擎在破产时做的事
  human.lastTurn = { day: 3, money: -9800, assets: -57800, lines: [
    '街角店主 实付租金 9800（西巷小店），机会买家 收到 9800 · 你剩 0',
  ] };
  s.over = false;
  const el = { innerHTML: '', hidden: false };
  renderSliceInsight(el, s, ai);
  assert.match(el.innerHTML, /你已出局/, `出局那一刻没写清楚：${el.innerHTML.slice(0, 200)}`);
  assert.equal(/正在行动/.test(el.innerHTML), false, '出局后仍写「对手正在行动…」，玩家会以为游戏卡住');
});

test('人类还活着时，标题照旧写「轮到你了」/「X 正在行动…」', () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = s.players.find(p => p.controller === 'human');
  const ai = s.players.find(p => p.controller !== 'human');
  assert.equal(human.alive, true);
  const el = { innerHTML: '', hidden: false };
  renderSliceInsight(el, s, ai);
  assert.match(el.innerHTML, /正在行动/);
  assert.equal(/你已出局/.test(el.innerHTML), false, '人还活着就说他出局了');
});

test('局已结束时标题是「收摊结算」，不被出局文案盖掉', () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = s.players.find(p => p.controller === 'human');
  const ai = s.players.find(p => p.controller !== 'human');
  human.alive = false;
  s.over = true;
  const el = { innerHTML: '', hidden: false };
  renderSliceInsight(el, s, ai);
  assert.match(el.innerHTML, /收摊结算/);
  assert.equal(/你已出局/.test(el.innerHTML), false, '结算屏已经解释了出局，不必再顶一行');
});
