import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { landingText, landingInfo, reachableLandings, plotVisitLine, routePreview } from '../src/engine/insight.js';
import { buyPrice, buildCost, rentFor } from '../src/engine/economy.js';

// #3341：定步屏是给玩家**挑落点**用的。一行的金额如果不能在这一刻兑现，
// 那一行必须自己说出来（还差 N / 会破产），否则玩家得自己在脑子里做减法 ——
// 而 supervisor 就是在这一屏上被耍的：
//   穿街高手 seed 1 第 13 天，现金 20,000，定步 1 步写「停在这里可加盖 30,000」，走过去按钮按不动。
//
// 判据钉的是「句子说的东西 = 引擎真会接受的动作」，三个金额各有各的引擎口径：
//   · 加盖 / 买地看 cash        buildPlot `if (p.cash < cost) return;`
//                              buyPlot   `if (p.cash < buyPrice(state, id)) return;`
//                              按钮禁用  `(p?.cash ?? 0) < pending.cost`
//   · 付租看 cash + deposit     pay() `const available = from.cash + from.deposit; … 破产`
// 所以这里**不**复制一份判断：直接从引擎原语重算，再要求句子与它一致。
//
// 实测（120 局，support/probe-3341/unaffordable.mjs，改前 → 改后）：
//   4,634 个点选项里，报着做不起的数却没标出来的行 **223 → 0**
//     （加盖 176 / 买地 22 / 付租会导致破产 25）
//   其中加盖那 176 行，176/176 是该行最大的数，21 行是该点数下唯一的信息。

const human = s => s.players.find(p => p.controller === 'human');
const buildAsk = (s, id, pr) =>
  Math.round((pr.big ? 30_000 : buildCost((pr.level ?? 0) + (s.slice ? 1 : 0))) * s.priceIndex);

// 引擎会不会让这个动作发生（不是「我算的数对不对」）。
const engineAllows = (s, p, plotId) => {
  const pr = s.properties[plotId], owner = s.players.find(q => q.id === pr?.ownerId);
  const own = owner?.team === p.team;
  if (!owner) return p.cash >= buyPrice(s, plotId);
  if (own) {
    if (!pr || (pr.level ?? 0) >= (s.config.maxLevel ?? 3) || (pr.closed ?? 0) > 0) return true; // 没有要花钱的动作
    return p.cash >= buildAsk(s, plotId, pr);
  }
  if ((pr?.closed ?? 0) > 0 || pr?.bigType === 'park' || p.god === '财神') return true;
  return p.cash + p.deposit >= rentFor(s, plotId);
};

const MARKED = /还差\s*[\d,]+|会破产|做不起/;

test('引擎事实：这一屏三个金额各有各的分母（cash vs cash+deposit）', () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const me = human(s);
  me.deposit = 5_000;
  const node = s.map.nodes.find(n => (n.adjacentPlots ?? []).length);
  const opp = s.players.find(p => p.controller !== 'human');
  const plotId = node.adjacentPlots[0];
  s.properties[plotId] = { ...(s.properties[plotId] ?? {}), ownerId: opp.id, level: 1, closed: 0 };
  const owed = rentFor(s, plotId);
  me.cash = Math.max(0, owed - 5_000 - 1);       // 现金不够，押金补上就够
  const info = landingInfo(s, me, node.id).plots.find(x => x.id === plotId);
  assert.equal(info.affordable, true,
    `付租走 pay()：现金 ${me.cash} + 押金 ${me.deposit} 够付 ${owed}，就不该说做不起`);
  // 买地不看押金：同一笔钱在买地那一行是「不够」。
  const pr = s.properties[plotId];
  pr.ownerId = null;
  const buyInfo = landingInfo(s, me, node.id).plots.find(x => x.id === plotId);
  assert.equal(buyInfo.affordable, me.cash >= buyPrice(s, plotId),
    `买地只看 cash（buyPlot 原句），这里 cash=${me.cash} 价=${buyPrice(s, plotId)}`);
});

test('复现 supervisor 那一帧：现金 20,000 时，书屋那句不许只说「可加盖 30,000」', () => {
  const s = startSession(createSliceConfig({ human: true, seed: 1, style: 'cross' }));
  const me = human(s);
  let checked = 0;
  return runGame(s, {
    render() {}, async step() {}, async say() {},
    async ask(prompt) {
      if (prompt.type === 'diceValue' && prompt.player?.controller === 'human') {
        // 走到一个「自己的店可加盖、但此刻买不起」的屏上就必须标出来
        for (let n = 1; n <= 6; n++) {
          for (const id of reachableLandings(s, me, n)) {
            const info = landingInfo(s, me, id);
            for (const plot of info.plots) {
              if (!(plot.own && plot.canBuild && !engineAllows(s, me, plot.id))) continue;
              const text = landingText(s, me, id);
              assert.match(text, /还差\s*[\d,]+/,
                `现金 ${me.cash}、加盖 ${plot.buildAskCost}：这一行必须说还差多少 —— ${text}`);
              checked++;
            }
          }
        }
      }
      s.pending = null; s.mapPick = null;
      return aiAnswer(prompt, s);
    },
  }).then(() => assert.ok(checked > 0, '这一局应当至少出现过一次「可加盖但买不起」（否则本断言空过）'));
});

test('整屏判据：报着做不起的数却没标出来的行，必须是 0（改前 223）', async () => {
  const bad = [];
  let rows = 0;
  for (const style of ['grow', 'take', 'cross']) {
    for (let seed = 1; seed <= 12; seed++) {
      const s = startSession(createSliceConfig({ human: true, seed, style }));
      const me = human(s);
      await runGame(s, {
        render() {}, async step() {}, async say() {},
        async ask(prompt) {
          if (prompt.type === 'diceValue' && prompt.player?.controller === 'human') {
            const texts = new Set();
            for (let n = 1; n <= 6; n++) for (const id of reachableLandings(s, me, n)) texts.add(landingText(s, me, id));
            for (const text of texts) {
              rows++;
              // 三类「此刻做不起」：句子里的数超过它能花的那笔钱。
              for (const m of text.matchAll(/可加盖\s*([\d,]+)/g)) {
                const cost = Number(m[1].replace(/,/g, ''));
                if (cost > me.cash && !MARKED.test(text) && bad.length < 5) bad.push({ cash: me.cash, cost, text });
              }
              for (const m of text.matchAll(/可买\s*([\d,]+)/g)) {
                const price = Number(m[1].replace(/,/g, ''));
                if (price > me.cash && !MARKED.test(text) && bad.length < 5) bad.push({ cash: me.cash, price, text });
              }
              for (const m of text.matchAll(/付租\s*([\d,]+)/g)) {
                const owed = Number(m[1].replace(/,/g, ''));
                if (owed > me.cash + me.deposit && !/会破产/.test(text) && bad.length < 5) bad.push({ owed, text });
              }
            }
          }
          s.pending = null; s.mapPick = null;
          return aiAnswer(prompt, s);
        },
      });
    }
  }
  assert.ok(rows > 500, `样本太少（${rows} 行），这条判据会空过`);
  assert.deepEqual(bad, [], `这一屏仍在报一个此刻做不到的数：${JSON.stringify(bad)}`);
});

test('做得到的那一行不加字（别把屏变吵）', () => {
  // 造一个「现金远超一切」的局面：所有自己的店都该是原来的样子。
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const me = human(s);
  me.cash = 500_000;
  const node = s.map.nodes.find(n => (n.adjacentPlots ?? []).some(id => s.properties[id]?.ownerId === me.id));
  const text = landingText(s, me, node.id);
  assert.equal(MARKED.test(text), false, `做得到的时候不该出现「还差/会破产」：${text}`);
});

test('岔路前瞻与落点说明同口径：做不起的加盖价也要标出来', async () => {
  const s = startSession(createSliceConfig({ human: true, seed: 1, style: 'cross' }));
  const me = human(s);
  const bad = [];
  let seen = 0;
  let idx = 0;
  await runGame(s, {
    render() {}, async step() {}, async say() {},
    async ask(prompt) {
      if (prompt.type === 'direction' && prompt.player?.controller === 'human') {
        // 每 4 个岔路挑一个把现金砍到 1 —— 好让「可加盖但买不起」真的出现在前瞻里
        if (idx++ % 4 === 0) me.cash = 1;
        for (const id of prompt.options ?? []) {
          const pv = routePreview(s, me, me.position, id, prompt.remainingSteps ?? 0);
          for (const e of [pv.text, ...(pv.outlook ?? [])]) {
            for (const m of e.matchAll(/可加盖\s*([\d,]+)/g)) {
              seen++;
              if (Number(m[1].replace(/,/g, '')) > me.cash && !MARKED.test(e) && bad.length < 5) bad.push({ cash: me.cash, e });
            }
          }
        }
      }
      s.pending = null; s.mapPick = null;
      return aiAnswer(prompt, s);
    },
  });
  assert.ok(seen > 0, '应当至少出现一次「可加盖」前瞻（否则本断言空过）');
  assert.deepEqual(bad, [], `岔路前瞻里仍有做不起的加盖价没标出来：${JSON.stringify(bad)}`);
});

test('plotVisitLine：三种归属 × 做得到/做不起 都说清', () => {
  const base = { name: 'X', street: 'S', owner: null, own: false, price: 8000, rent: 0, closed: 0,
    inflate: 0, availableFromDay: 1, level: 0, rentToMe: 0, canBuild: false, buildAskCost: null,
    affordable: true, shortForBuild: 0, shortForBuy: 0, shortForRent: 0 };
  const s = { day: 5 };
  // 做得到：与改前逐字一致（不给屏加噪音）
  assert.equal(plotVisitLine({ ...base, owner: '对手', rent: 2800, rentToMe: -2800 }, s), '对手 · 付租 2,800');
  assert.equal(plotVisitLine({ ...base, own: true, owner: '我', level: 1, canBuild: true, buildAskCost: 10000 }, s), '你的店 Lv.1 · 停在这里可加盖 10,000');
  assert.equal(plotVisitLine({ ...base, price: 8000 }, s), '可买 8,000');
  // 做不起：带可核的差额 / 后果
  assert.equal(plotVisitLine({ ...base, own: true, owner: '我', level: 1, canBuild: true,
    buildAskCost: 30000, affordable: false, shortForBuild: 10000 }, s), '你的店 Lv.1 · 可加盖 30,000，还差 10,000');
  assert.equal(plotVisitLine({ ...base, price: 8000, affordable: false, shortForBuy: 3000 }, s), '可买 8,000，还差 3,000');
  assert.equal(plotVisitLine({ ...base, owner: '对手', rent: 9600, rentToMe: -9600,
    affordable: false, shortForRent: 400 }, s), '对手 · 付租 9,600 · 现金不够，会破产');
});
