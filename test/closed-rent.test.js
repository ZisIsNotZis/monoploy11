import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { landingText, landingInfo } from '../src/engine/insight.js';

// #682：停业的地产必须写清「不付租」。
//
// 缺陷：outlook 里对手的地停业时写成「晚风街（机会买家 · 停业）」，
// 玩家很容易读成“那是他的地盘（危险）”，而**停业 = 走过去不付租**，反而是安全。
// 两侧（landingText 与 routePreview.outlook）必须口径一致。

const mk = () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  return { s, human: s.players.find(p => p.controller === 'human') };
};

test('landingText：对手地块停业时，必须写“停业 · 不付租”', () => {
  const { s, human } = mk();
  const opp = s.players.find(p => p.controller !== 'human');
  const node = s.map.nodes.find(n => (n.adjacentPlots ?? []).length);
  assert.ok(node, '地图应有带相邻地产的节点');
  const plotId = node.adjacentPlots[0];
  s.properties[plotId] = { ...(s.properties[plotId] ?? {}), ownerId: opp.id, level: 1, closed: 2 };
  const text = landingText(s, human, node.id);
  assert.match(text, /停业/, `应含“停业”：${text}`);
  assert.match(text, /不付租/, `停业必须说清“不付租”，否则会被读成危险：${text}`);
});

test('landingText：己方地块停业时同样写“停业 · 不付租”（口径一致）', () => {
  const { s, human } = mk();
  const node = s.map.nodes.find(n => (n.adjacentPlots ?? []).length);
  const plotId = node.adjacentPlots[0];
  s.properties[plotId] = { ...(s.properties[plotId] ?? {}), ownerId: human.id, level: 1, closed: 2 };
  const text = landingText(s, human, node.id);
  assert.match(text, /停业 · 不付租/, `己方停业也要写清：${text}`);
});

test('landingText：未停业时不得出现“不付租”（防误伤）', () => {
  const { s, human } = mk();
  const opp = s.players.find(p => p.controller !== 'human');
  const node = s.map.nodes.find(n => (n.adjacentPlots ?? []).length);
  const plotId = node.adjacentPlots[0];
  s.properties[plotId] = { ...(s.properties[plotId] ?? {}), ownerId: opp.id, level: 1, closed: 0 };
  const text = landingText(s, human, node.id);
  assert.ok(!/不付租/.test(text), `未停业不该说不付租：${text}`);
  assert.match(text, /租\s*[\d,]+/, `未停业应给租金：${text}`);
});

test('outlook：两条路径的停业写法一致（不能一处写一处不写）', async () => {
  const { routePreview } = await import('../src/engine/insight.js');
  const { runGame } = await import('../src/engine/flow.js');
  const { aiAnswer } = await import('../src/engine/ai.js');
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const seen = { closed: [], old: [] };
  await runGame(s, {
    render() {}, async step() {}, async say() {},
    async ask(prompt) {
      if (prompt.type === 'direction' && prompt.player?.controller === 'human') {
        const me = prompt.player;
        const rs = prompt.remainingSteps ?? 0;
        for (const id of prompt.options) {
          const pv = routePreview(s, me, me.position, id, rs);
          for (const e of [pv.text, ...pv.outlook]) {
            if (/停业 · 不付租/.test(e)) seen.closed.push(e);
            if (/（[^）]* · 停业）/.test(e)) seen.old.push(e);
          }
        }
      }
      s.pending = null; s.mapPick = null;
      return aiAnswer(prompt, s);
    },
  });
  assert.equal(seen.old.length, 0, `不应再有旧写法「… · 停业）」：${seen.old.slice(0, 3).join(' | ')}`);
  assert.ok(seen.closed.length > 0, '该局应至少出现一次“停业 · 不付租”（否则本断言无效）');
});
