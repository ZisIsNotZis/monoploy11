import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SLICE_STYLES, createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';

// #3330：第一屏承诺「三条不同的打算」。改前实测（真实入口、每格 300 局）是
// grow 49.0% / take 13.7% / cross 14.7% —— 那不是三个选择，是一个选择加两个陷阱。
//
// 这个文件钉住三件事，都不靠「跑三千局」：
//   ① 三条起手的开工现金差异被**写下来**，且只允许往弱的一方补（grow 不得高于另外两家）；
//   ② 这个数真的进到局里（通过真实入口，不是只在数据表里）；
//   ③ 第一屏把它印出来 —— 影响最大的那个数不能只活在 state 里。
//
// 为什么不把胜率钉进测试：跑一局约 0.2 s，300 局 × 3 起手 ≈ 3 分钟，而且噪声 ±3%。
// 平衡值由 docs/evidence/RESULT-3330.md 的记录与 scripts 复算，测试只钉「规则没被悄悄改回去」。

const STYLE_IDS = ['grow', 'take', 'cross'];

test('三条起手的开工现金：写下来了，且只往弱的一方补', () => {
  for (const id of STYLE_IDS) {
    const style = SLICE_STYLES.find(s => s.id === id);
    assert.ok(style, `缺起手 ${id}`);
    assert.equal(typeof style.cash, 'number', `${id} 没有开工现金 —— 玩家会在第一屏看到一个没写出来的差别`);
    assert.ok(style.cash >= 42000, `${id} 的开工现金低于基线 42000，等于给某个起手开后门`);
  }
  const grow = SLICE_STYLES.find(s => s.id === 'grow').cash;
  for (const id of ['take', 'cross']) {
    const other = SLICE_STYLES.find(s => s.id === id).cash;
    assert.ok(other >= grow,
      `${id} 的开工现金（${other}）低于 grow（${grow}）—— 补偿方向反了，弱的那家会更弱`);
  }
  // 想改数字的人必须同时改证据：这里只挡「改回原样」与「补错方向」。
  assert.deepEqual(SLICE_STYLES.map(s => [s.id, s.cash]),
    [['grow', 42000], ['take', 45000], ['cross', 46000]],
    '开工现金变了：这是平衡决定，不是顺手改的常量。改它要同时更新RESULT-3330 的实测表');
});

test('开工现金通过真实入口进到局里（不是只在数据表里）', () => {
  for (const id of STYLE_IDS) {
    const want = SLICE_STYLES.find(s => s.id === id).cash;
    const state = startSession(createSliceConfig({ style: id, seed: 1 }));
    const human = state.players[0];
    assert.equal(human.style, id, `选 ${id} 却落在 ${human.style}`);
    assert.equal(human.cash, want, `${id} 开局现金 ${human.cash} ≠ 数据表里的 ${want}`);
    // 对手不能被这个起手的选择顺手改肥：他们的现金应当仍是基线。
    for (const p of state.players.slice(1)) {
      const oppWant = SLICE_STYLES.find(s => s.id === p.style).cash;
      assert.equal(p.cash, oppWant, `对手 ${p.style} 的现金 ${p.cash} ≠ 它自己起手的 ${oppWant}`);
    }
  }
});

test('第一屏把开工现金印出来（影响最大的数不能只活在 state 里）', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const picker = /sliceStyles'\)\.innerHTML\s*=\s*SLICE_STYLES\.map\(([\s\S]*?)\)\.join/.exec(main);
  assert.ok(picker, '找不到起手列表的渲染代码');
  assert.match(picker[1], /s\.cash/,
    '起手卡片没有印开工现金 —— 玩家看得见的是 hook，决定胜负的是没写的那个数');
  assert.match(picker[1], /toLocaleString\(\)/, '现金要按千分位写，裸数字在窄屏上难读');
});
