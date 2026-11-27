import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { actualRentByPlot } from '../src/ui/slice.js';

// #574 的 actualRentByPlot 从 state.log 数实际收租，而引擎的 log 有 400 行上限（economy.js:153）。
// 一旦一局日志超过 400 行，早先的收租行会被静默丢弃 ⇒ 结算页的「实收 N 次」会偏小。
// 偏小不说话，比报错危险：玩家会以为自己少收了钱。
//
// 两条一起钉：
//   1. 真实对局的日志必须离上限有余量；
//   2. 触顶时确实会丢 —— 证明第 1 条不是多余的小心。

test('整局日志离 400 行上限有足够余量（否则实际收租会静默偏小）', async () => {
  const seeds = [1, 2, 3, 7, 11, 19, 23];
  const sizes = [];
  for (const seed of seeds) {
    const s = startSession(createSliceConfig({ seed, style: 'grow' }));
    await runGame(s, {
      render() {}, async step() {}, async say() {},
      async ask(p) { return aiAnswer(p, s); },
    });
    sizes.push({ seed, n: s.log.length });
  }
  const max = Math.max(...sizes.map(x => x.n));
  const detail = sizes.map(x => `seed${x.seed}:${x.n}行`).join(' ');
  assert.ok(max < 400, `有局触到 400 行上限，实际收租会偏小：${detail}`);
  // 不卡太紧，但超过 300 就该改实现（独立累加，而不是靠 log 快照）。
  assert.ok(max < 300, `日志已接近 400 行上限（${max}），应改成独立累加。${detail}`);
});

test('日志触顶时确实会丢掉最早的收租行（证明上一条不是多余的小心）', () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  // 先放 10 笔早期收租，再塞满填充行，让总数超过 400。
  for (let i = 0; i < 10; i++) s.log.push({ day: 1, text: `甲 向 乙 应付租金 100（测试店${i}）` });
  for (let i = 0; i < 420; i++) s.log.push({ day: 2, text: `填充行 ${i}` });
  assert.ok(s.log.length > 400, `前置条件：应超过 400（实际 ${s.log.length}）`);
  // 照抄引擎 economy.js 的规则：超过 400 就从头部丢。
  s.log.splice(0, s.log.length - 400);
  assert.equal(actualRentByPlot(s).size, 0, '最早那 10 笔收租应已被截掉 —— 这就是偏小的机制');
});
