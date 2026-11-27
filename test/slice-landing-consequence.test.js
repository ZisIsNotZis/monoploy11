import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { renderSliceInsight, turnCauseLine } from '../src/ui/slice.js';

// #1478：两栏都是 0 的回合，除了「掷出几点、停在哪」，还要说得出**这一停有没有后果**。
//
// 为什么需要：37.7% 的回合里，玩家停在别人的停业店旁白跑一趟，屏上只写「停在 街道」——
// 他既不知道自己为什么没收钱，也不知道是对方封了租。
//
// 数据来源只有引擎已经写进日志的那两种（不新算、不编）：
//   ① 「应付租金 0（X） · 停业中，不计租」 ⇒ 「X封租」
//   ② 「在金钱格获得 N」+「实付租金 N」    ⇒ 「收付相抵」
// 其余 92.8% 的回合确实没有任何地产生意，就该是「这回合钱没动」——不许为了好看硬加一句。

const zero = lines => ({ day: 3, money: 0, assets: 0, lines });
const NAME = '街角店主';

test('#1478：停在别人停业的店旁，写出店名与「封租」', () => {
  const last = zero([
    '—— 第 14 天 · 街角店主 的回合 ——',
    '街角店主 掷出 1 点',
    '街角店主 停在 街道，旁边是 灯火街小店',
    '街角店主 向 穿街高手 应付租金 0（灯火街小店） · 停业中，不计租',
    '街角店主 实付租金 0（灯火街小店），穿街高手 收到 0 · 你剩 29,000，够买一块 月色街小店（8,000）',
  ]);
  assert.equal(turnCauseLine(last, NAME), '掷出 1 点，停在 街道；灯火街小店封租');
});

test('#1478：一进一出刚好抵平时说「收付相抵」，且两个金额都来自日志', () => {
  const last = zero([
    '—— 第 12 天 · 街角店主 的回合 ——',
    '街角店主 掷出 4 点',
    '街角店主 在金钱格获得 2000',
    '街角店主 停在 街道，旁边是 月色街茶铺',
    '街角店主 向 机会买家 应付租金 2000（月色街茶铺）',
    '街角店主 实付租金 2000（月色街茶铺），机会买家 收到 2000 · 你剩 19,400',
  ]);
  assert.equal(turnCauseLine(last, NAME), '掷出 4 点，停在 街道；收付相抵');
});

test('#1478：没有后果的回合仍然是「这回合钱没动」，不许硬凑一句', () => {
  // 63.3% 的双 0 回合是这种：一段没有任何地产生意的路。
  assert.equal(turnCauseLine(zero([
    '街角店主 掷出 2 点',
    '街角店主 停在 街道',
  ]), NAME), '掷出 2 点，停在 街道；这回合钱没动');
  // 旁边是**自己的**店：那是「可以加盖」的下一步提示，不是这一停的后果，现在不写。
  assert.equal(turnCauseLine(zero([
    '街角店主 掷出 2 点',
    '街角店主 停在 街道，旁边是 西巷茶铺',
  ]), NAME), '掷出 2 点，停在 街道；这回合钱没动');
  // 无主店：价格是「可以买」的提示，同属下一步，不是后果。
  assert.equal(turnCauseLine(zero([
    '街角店主 掷出 1 点',
    '街角店主 停在 街道，旁边是 月色街小店',
  ]), NAME), '掷出 1 点，停在 街道；这回合钱没动');
});

test('#1478：对手的停业租金不能算成我的后果', () => {
  const last = zero([
    '街角店主 掷出 3 点',
    '街角店主 停在 街道',
    '机会买家 向 穿街高手 应付租金 0（灯火街小店） · 停业中，不计租',
  ]);
  assert.equal(turnCauseLine(last, NAME), '掷出 3 点，停在 街道；这回合钱没动');
});

test('#1478：只有真收付过才叫相抵；只进不出仍是「钱没动」', () => {
  // 有进账、没有租金支出 ⇒ 资金不可能真是 0（除非被别处扣掉，那时 #1295 的分支负责）。
  const last = zero([
    '街角店主 掷出 2 点',
    '街角店主 在金钱格获得 2000',
    '街角店主 停在 街道',
  ]);
  assert.equal(turnCauseLine(last, NAME), '掷出 2 点，停在 街道；这回合钱没动');
});

test('#1478：整行仍是 1 行——最长格标签 + 最长店名不翻行', () => {
  // 真 Edge 1280×800、同一帧、365px 侧栏实测（.scratch/1478-consequence/fit10.mjs）：
  //   可用内容宽 343px；「掷出 6 点，停在 发薪处；晨光街茶铺封租」自然宽 305.2px ⇒ 余量 37.8px。
  //   对照：「晨光街茶铺停业0租」325.8px 只余 17.2px，已在翻行边缘（实测 331.2px 处翻行）。
  // 这里钉住屏上形状与字数上限：#1458 的几何硬约束是「1 行」，不是「字符数」，
  // 所以守护取实测安全档 —— 新串的自然宽不许超过 330px 那一档对应的长度。
  const s = startSession(createSliceConfig({ seed: 2, style: 'grow' }));
  const human = s.players.find(p => p.controller === 'human');
  human.lastTurn = zero([
    '街角店主 掷出 6 点',
    '街角店主 停在 发薪处，旁边是 晨光街茶铺',
    '街角店主 向 穿街高手 应付租金 0（晨光街茶铺） · 停业中，不计租',
  ]);
  const el = { innerHTML: '', hidden: false };
  renderSliceInsight(el, s, human);
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(el.innerHTML)?.[1] ?? '';
  assert.equal(summary, '你上回合：掷出 6 点，停在 发薪处；晨光街茶铺封租');
  // 「资金 +0」不再出现（仍是换掉整行，不是追加）
  assert.equal(/资金 \+0/.test(summary), false, `不该留着「资金 +0」：${summary}`);
  // 折叠明细仍逐行可核
  assert.ok(el.innerHTML.includes('<li>街角店主 停在 发薪处，旁边是 晨光街茶铺</li>'), '折叠明细丢了');
});
