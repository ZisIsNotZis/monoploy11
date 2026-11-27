// #3335 探针 6：最后一天那一屏的字数（旧句 vs 新句），并证明它比第 1 天那屏更短 ——
// 第 1 天那屏的几何已经用真 Chrome 量过（support/probe-3334/geom-report.json：511=511 不滚、两键可点）。
import { execFileSync } from 'node:child_process';
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession } from '../../src/engine/flow.js';
import { buildCost } from '../../src/engine/economy.js';
import { buildOrderLine } from '../../src/ui/slice.js';

const oldSrc = execFileSync('git', ['show', '90f15f9:src/ui/slice.js'], { encoding: 'utf8' });
const uiDir = new URL('../../src/ui/', import.meta.url).href;
const patched = oldSrc.replace(/from '(\.\.\/[^']+)'/g, (_, p) => `from '${new URL(p, uiDir).href}'`);
const old = await import('data:text/javascript;base64,' + Buffer.from(patched).toString('base64'));

const out = [];
for (const style of ['grow', 'take', 'cross']) {
  const s = startSession(createSliceConfig({ seed: 1, style }));
  const p = s.players.find(q => q.controller === 'human');
  const id = p.properties[0];
  const cost = Math.round(buildCost(s.properties[id].level + 1) * s.priceIndex);
  const day1 = { old: old.buildOrderLine(s, id, cost, p), now: buildOrderLine(s, id, cost, p) };
  s.day = s.config.dayLimit;
  const last = { old: old.buildOrderLine(s, id, cost, p), now: buildOrderLine(s, id, cost, p) };
  out.push({ style, holdsWorker: p.cards.includes('worker'),
    day1: { oldLen: day1.old.length, nowLen: day1.now.length },
    lastDay: { oldLen: last.old.length, nowLen: last.now.length, old: last.old, now: last.now } });
}
console.log(JSON.stringify(out, null, 1));
