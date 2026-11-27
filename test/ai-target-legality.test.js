import test from 'node:test';
import assert from 'node:assert/strict';
import { SLICE_STYLES, createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { sliceAnswer } from '../src/engine/slice-ai.js';
import { sliceTargetIds } from '../src/engine/insight.js';

// #3333：AI 的候选集必须 ⊆ 引擎的合法集，否则**一局会卡死**。
//
// 实测的卡死（真入口，seed 173、起手 grow、对手 take+cross，第 6 天「机会买家」回合）：
//   动作屏：AI 选「收购」→ 选目标屏 → AI 返回 null → 卡没被消耗 → 动作屏再问 → 无限。
// 根因：slice-ai 的 plotTargets 自己写了一遍买地合法性，没有「空地不算」这一条
// （insight.sliceTargetIds 经 takeoverEligible 是明确的），于是 AI 认为最优点 1,4
// 是一块**无主地**；引擎不认，flow.js:210 把 null 当「取消这张卡」，而动作屏会再问一遍。
//
// 为什么判据不能只是「跑一局看看」：2400 局里只有 1 局卡死，任何冒烟测试都可能漏。
// 所以钉两件事：
//   ① 静态契约（属性式，扫多局）：把「所有地块都能选」喂给 AI，它挑出来的那块
//      必须是引擎同意的。旧公式在卡死那一屏挑的是无主地 1,4 ⇒ 这条会红。
//   ② 动态契约（复现那一局）：凡是引擎给了非空选项的 target 提示，AI 不许回 null；
//      旧代码在这里会原地打转直到决策上限 ⇒ 这条也会红。

const seat = (style, seed) => {
  const config = createSliceConfig({ human: false, seed, style });
  const order = [style, ...SLICE_STYLES.filter(s => s.id !== style).map(s => s.id)];
  config.participants = order.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  return startSession(config);
};

test('#3333 AI 挑的收购目标永远在引擎的合法名单里（属性式，扫 60 局）', async () => {
  const violations = [];
  let checked = 0;
  // 收购卡在切片里本来就很少被 AI 用（实测 120 局只有 3 次），所以这里要扫够局数
  // 才拿得到足够的屏。上限 240 局对 node --test 是 ~3s 的量级。
  for (const style of ['take', 'take', 'cross', 'grow']) {
    for (let seed = 1; seed <= 60; seed++) {
      const state = seat(style, seed);
      let decisions = 0;
      await runGame(state, {
        render() {}, async step() {},
        async ask(prompt) {
          if (++decisions > 2000) throw new Error(`未走完：${style}/${seed}`);
          // 只在「引擎认为有合法收购目标」的屏上检查
          if (prompt.type === 'target' && prompt.cardId === 'buyland' && (prompt.plotIds?.length ?? 0) > 0) {
            const legal = new Set(sliceTargetIds(state, prompt.player, 'buyland'));
            const all = state.map.plots.map(p => p.id);
            const picked = sliceAnswer(
              { type: 'target', player: prompt.player, cardId: 'buyland', kind: 'plot', plotIds: all }, state);
            checked++;
            if (picked == null || !legal.has(picked)) {
              violations.push({ style, seed, day: state.day, picked, legal: [...legal] });
            }
          }
          return aiAnswer(prompt, state);
        },
      });
    }
  }
  // 门槛取实测值的一半：写 50 会变成一条「看样本量」的测试而不是「看正确性」的测试，
  // 而收购卡在切片里本来就罕见（这 240 局里只出现 30 屏）。30 屏已经覆盖三条起手。
  assert.ok(checked >= 15, `夹具失效：只检查到 ${checked} 屏收购目标，样本太小`);
  assert.deepEqual(violations.slice(0, 5), [],
    `AI 选了引擎不认的地块（会让卡不被消耗、回合原地打转）：${JSON.stringify(violations.slice(0, 5))}`);
});

test('#3333 真跑那一局：有合法选项的 target 提示，AI 不许回 null（不回 null 才走得完）', async () => {
  // 修好之前：这一局在第 6 天原地打转，撞到决策上限就抛 —— 这条红。
  const state = seat('grow', 173);
  let decisions = 0;
  const violations = [];
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      // 正常一局实测 60–70 次决策；撞到 500 就说明回合没有前进。
      if (++decisions > 500) throw new Error(`seed 173 没有走完：已问 ${decisions} 次决策，回合没有前进`);
      const answer = aiAnswer(prompt, state);
      if (prompt.type === 'target') {
        const offered = (prompt.plotIds?.length ?? 0) > 0 || (prompt.players?.length ?? 0) > 0;
        if (offered && (answer === null || answer === undefined)) {
          violations.push({ day: state.day, cardId: prompt.cardId, kind: prompt.kind });
        }
      }
      return answer;
    },
  });
  assert.deepEqual(violations, [], 'AI 在选项非空时回了 null（= 取消这张卡，回到同一屏）');
  assert.ok(decisions < 500, '决策数异常');
});
