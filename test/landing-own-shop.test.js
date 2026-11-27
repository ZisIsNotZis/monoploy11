import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { landingText, landingInfo, reachableLandings, plotVisitLine, routePreview } from '../src/engine/insight.js';
import { rentFor } from '../src/engine/economy.js';

// #3340：选落点那一屏把「己方 · 租 N」印在自己的店上，而引擎在自己的店旁**从不收租**。
//
// 为什么这是真缺陷，不是措辞偏好：
//   · flow.js 的付租分支第一句是 `if (owner?.team === p.team) { …加盖询问…; continue; }`。
//     自己停在自己的店旁，引擎问的是「要不要加盖」，一分钱不进账。
//   · 定步屏是全游戏**唯一**由玩家直接选落点的地方：3.46 次/局、20.8 个点选项/局
//     （120 局实测，`.scratch/3340/mislead.mjs`）。
//   · 其中 25.1% 的点选项里出现「己方 · 租 N」；这些行里 89.7% 的那个数比同屏所有对手租都大，
//     33% 是那个点数下**唯一**的落点信息。平均被印出来的数是 5,669。
//   ⇒ 最能拉动玩家选某个点数的那句话，在自家店上是不会兑现的数。
//
// 判据不钉「句子等于我的算式」，而钉「句子说的东西 = 引擎真做的事」：
// 只要引擎在自己店旁不收租，这一屏就不许报一个租给玩家。

const mk = () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  return { s, human: s.players.find(p => p.controller === 'human') };
};

// 找到「挨着我自己的、未停业的店」的那个路面格
function ownShopNode(s, human) {
  for (const node of s.map.nodes) {
    const hit = (node.adjacentPlots ?? []).find(id => {
      const pr = s.properties[id];
      return pr?.ownerId === human.id && !(pr.closed > 0);
    });
    if (hit) return { node, plotId: hit };
  }
  return null;
}

test('引擎事实：停在自己的店旁一分钱都不收（这是本条的前提）', () => {
  const { s, human } = mk();
  const found = ownShopNode(s, human);
  assert.ok(found, '夹具应能找到一块自己的店');
  const rent = rentFor(s, found.plotId);
  assert.ok(rent > 0, `夹具前提：自己那块店的 rentFor 应该是正数（实际 ${rent}）`);
  // 引擎里没有「自己的店给我钱」这条路径：rentToMe 必须恒为 0。
  const info = landingInfo(s, human, found.node.id);
  const mine = info.plots.find(p => p.id === found.plotId);
  assert.equal(mine.own, true);
  assert.equal(mine.rentToMe, 0,
    '自己的店 rentToMe 必须是 0 —— 引擎在自己的店旁只问加盖，不收租');
});

test('落点文案：自己的店不许出现「租 N」（那个数不会到账）', () => {
  const { s, human } = mk();
  const found = ownShopNode(s, human);
  const text = landingText(s, human, found.node.id);
  assert.equal(/租\s*[\d,]+/.test(text), false,
    `自己的店旁不该报一个租金：${text}`);
  assert.match(text, /你的店/, `要能看出这是自己的店：${text}`);
});

test('落点文案：自己的店要说引擎真会问的那件事（加盖多少钱 / 已到顶）', () => {
  const { s, human } = mk();
  const found = ownShopNode(s, human);
  const pr = s.properties[found.plotId];
  const text = landingText(s, human, found.node.id);
  if ((pr.level ?? 0) < (s.config.maxLevel ?? 3)) {
    assert.match(text, /加盖\s*[\d,]+/, `未到顶时应该报加盖价：${text}`);
    // 价必须与引擎在 buildPlot / 加盖询问里用的同一个数
    const info = landingInfo(s, human, found.node.id);
    const mine = info.plots.find(p => p.id === found.plotId);
    assert.equal(text.includes(mine.buildAskCost.toLocaleString()), true,
      `加盖价必须与引擎同源：${text} vs ${mine.buildAskCost}`);
  } else {
    assert.match(text, /不收租/, `到顶时没有可做的事，就必须说清自己停在这里没有收益：${text}`);
  }
});

test('落点文案：对手的店仍然要写明我要付多少（防误伤）', () => {
  const { s, human } = mk();
  const opp = s.players.find(p => p.controller !== 'human');
  const node = s.map.nodes.find(n => (n.adjacentPlots ?? []).length);
  const plotId = node.adjacentPlots[0];
  s.properties[plotId] = { ...(s.properties[plotId] ?? {}), ownerId: opp.id, level: 1, closed: 0 };
  const text = landingText(s, human, node.id);
  assert.match(text, /付租\s*[\d,]+/, `对手的店必须说我付多少：${text}`);
  assert.match(text, new RegExp(opp.name), `要点名对手：${text}`);
});

test('这一屏真的这么画：定步屏的每个点选项都不许把自家店的租印给玩家', () => {
  const { s, human } = mk();
  const rows = [];
  for (let n = 1; n <= 6; n++) {
    for (const id of reachableLandings(s, human, n)) {
      const info = landingInfo(s, human, id);
      if (info.plots.some(p => p.own && p.rentToMe !== 0)) rows.push({ n, id, why: 'own plot reported a rent' });
      const text = landingText(s, human, id);
      if (/\b己方\b/.test(text)) rows.push({ n, id, why: `still prints 「己方」: ${text}` });
    }
  }
  assert.deepEqual(rows, [], `定步屏仍在把自家的租报给玩家：${JSON.stringify(rows.slice(0, 3))}`);
});

test('岔路前瞻与落点说明同口径：己方店不许写「租 N」', () => {
  const { s, human } = mk();
  // 直接走一局，在每个 direction 屏上把两条路的措辞都抓下来
  const bad = [];
  return runGame(s, {
    render() {}, async step() {}, async say() {},
    async ask(prompt) {
      if (prompt.type === 'direction' && prompt.player?.controller === 'human') {
        for (const id of prompt.options ?? []) {
          const pv = routePreview(s, human, human.position, id, prompt.remainingSteps ?? 0);
          for (const e of [pv.text, ...(pv.outlook ?? [])]) {
            // 己方店此刻若还能加盖，就应写加盖价；否则写不收租。两种情况都不许是「己方 · 租 N」。
            if (/己方\s*·\s*租/.test(e)) bad.push(e);
          }
        }
      }
      s.pending = null; s.mapPick = null;
      return aiAnswer(prompt, s);
    },
  }).then(() => {
    assert.deepEqual(bad.slice(0, 3), [], `岔路前瞻还在写「己方 · 租 N」：${bad.slice(0, 3).join(' | ')}`);
  });
});

test('plotVisitLine 是唯一措辞入口：三种归属都说得清', () => {
  const base = { name: 'X', street: 'S', owner: null, own: false, price: 8000, rent: 0, closed: 0,
    inflate: 0, availableFromDay: 1, level: 0, rentToMe: 0, canBuild: false, buildAskCost: null };
  const s = { day: 5 };
  assert.match(plotVisitLine({ ...base, owner: '对手', rent: 2800, rentToMe: -2800 }, s), /付租 2,800/);
  assert.match(plotVisitLine({ ...base, owner: '对手', rent: 2800, rentToMe: -2800, closed: 2 }, s), /不付租/);
  assert.match(plotVisitLine({ ...base, owner: '我', own: true, rent: 2800, level: 1, canBuild: true, buildAskCost: 10000 }, s), /可加盖 10,000/);
  assert.match(plotVisitLine({ ...base, own: true, owner: '我', level: 3, canBuild: false }, s), /不收租/);
  assert.match(plotVisitLine({ ...base, availableFromDay: 9 }, { day: 3 }), /第 9 天开售/);
  assert.match(plotVisitLine({ ...base, price: 8000 }, { day: 3 }), /可买 8,000/);
});
