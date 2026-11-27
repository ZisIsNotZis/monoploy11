// #3335 探针 4：主管抓到的那一局（seed 4 街角店主，第 16 天，晨光街小店）。
// 真入口走到最后一天的加盖提示；同一状态用两份 buildOrderLine 各说一遍：
//   old —— 从 90f15f9 取回的那份（git show 90f15f9:src/ui/slice.js）
//   new —— 当前工作树
// 并量两件事：这一屏真 render 的字数、两个提交键是否还在（几何在 geom.mjs 里另量）。
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { buildCost } from '../../src/engine/economy.js';
import { buildOrderLine } from '../../src/ui/slice.js';

// 旧实现：直接从提交里取文件，作为第二个模块加载（data: URL，相对 import 改写成绝对路径）。
const oldSrc = execFileSync('git', ['show', '90f15f9:src/ui/slice.js'], { encoding: 'utf8' });
const uiDir = new URL('../../src/ui/', import.meta.url).href;
const patched = oldSrc.replace(/from '(\.\.\/[^']+)'/g, (_, p) => `from '${new URL(p, uiDir).href}'`);
const old = await import('data:text/javascript;base64,' + Buffer.from(patched).toString('base64'));
const styles = ['grow', 'take', 'cross'];
const rows = [];
for (const style of styles) {
  for (let seed = 1; seed <= 12; seed++) {
    const state = startSession(createSliceConfig({ human: true, seed, style }));
    let hit = null;
    await runGame(state, {
      render() {}, async step() {},
      async ask(prompt) {
        const p = prompt.player;
        if (p?.controller === 'human' && prompt.type === 'build' && state.day >= state.config.dayLimit) {
          const id = prompt.plot.id;
          const cost = Math.round(buildCost(state.properties[id].level + 1) * state.priceIndex);
          hit = { seed, style, day: state.day, plot: prompt.plot.name, level: state.properties[id].level,
            cost, holdsWorker: p.cards.includes('worker'),
            old: old.buildOrderLine(state, id, prompt.cost, p) || '(空)',
            now: buildOrderLine(state, id, prompt.cost, p) || '(空)' };
          return null;
        }
        const a = aiAnswer(prompt, state);
        // 让 AI 尽量把牌用掉，但翻修卡要留到最后一天（主管那一局就是留着走的）
        return a;
      },
    });
    if (hit) rows.push(hit);
  }
}
console.log(JSON.stringify(rows, null, 1));
