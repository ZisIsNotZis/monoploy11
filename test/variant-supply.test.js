import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPLIES, SLICE_STYLES, SLICE_CARDS, createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';

// 对照版（8001）靠 af-variant-inject.js 在运行时改 SUPPLIES 里 grow 那一项：
//     grow.cards = ['inflate', 'inflate']
// 而 flow.js 发放时是 `SUPPLIES.find(s => s.id === id)` 再逐个 addCard。
//
// 这两处如果读的不是同一个对象实例（比如引擎侧在定义时就拷贝了 options），
// 就会出现最坏的情况：**面板显示「旺季 + 旺季」，实际发的还是「翻修 + 旺季」**。
// 那样真人玩出来的手感结论是废的 —— 他玩的是原版，读的面板是对照版。
//
// 所以这条测试不看面板文字，直接看「选了 grow 之后手里真多出哪两张卡」。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 整局 supply 会出多次（第 4/7/10/13 天……），每次都答 grow 会累加成 6 张。
// 只看第一次：发完之后就用哨兵结束这局。
class GotSupply extends Error {}

async function playThroughFirstSupply(state, answerId) {
  const me = state.players[0];
  const record = { options: null, cardsBefore: null };
  try {
    await runGame(state, {
      render() {},
      async step() {},
      async ask(prompt) {
        if (prompt.type === 'supply' && prompt.player.id === me.id) {
          if (record.options) throw new GotSupply();   // 第二次出现就收工
          record.options = prompt.options.map(o => ({ id: o.id, cards: [...o.cards] }));
          record.cardsBefore = [...me.cards];
          return answerId;
        }
        if (record.options && prompt.type === 'supply') throw new GotSupply();
        if (prompt.type === 'action') return { action: 'roll', dice: 1 };
        if (prompt.type === 'direction') return prompt.options[0];
        if (prompt.type === 'discard') return 0;
        return false;
      },
    });
  } catch (error) {
    if (!(error instanceof GotSupply)) throw error;
  }
  assert.ok(record.options, '整局没出现过我方的 supply 提示，测法失效');
  return record;
}

test('原版：选了 grow 真发「翻修 + 旺季」（基线，证明测法本身有效）', async () => {
  const state = startSession(createSliceConfig({ style: 'grow', human: true }));
  const record = await playThroughFirstSupply(state, 'grow');
  const growOption = record.options.find(o => o.id === 'grow');
  assert.deepEqual(growOption.cards, ['worker', 'inflate'], '原版 grow 补给应仍是翻修+旺季');
});

test('关键：改 SUPPLIES 里 grow 的 cards，发放真的跟着变（不是只改文字）', async () => {
  // 模拟 af-variant-inject.js 做的事：改数组里那个对象的字段。
  const grow = SUPPLIES.find(item => item.id === 'grow');
  const original = [...grow.cards];
  try {
    grow.cards = ['inflate', 'inflate'];
    const state = startSession(createSliceConfig({ style: 'grow', human: true }));
    const record = await playThroughFirstSupply(state, 'grow');

    // 1) 提示里给出去的选项（面板来源）
    const growOption = record.options.find(o => o.id === 'grow');
    assert.deepEqual(growOption.cards, ['inflate', 'inflate'], '提示里的 grow 选项没跟着变');

    // 2) 真正要紧的：选完之后手里多出来的卡。
    //    不靠卡序（前面还有起手牌），只数相对开选之前多出的 id。
    //    弃牌只减不加，所以正数增量就是这次发的。
    const after = state.players[0].cards;
    const count = (list, id) => list.filter(x => x === id).length;
    const gained = [];
    for (const id of new Set([...after, ...record.cardsBefore])) {
      const d = count(after, id) - count(record.cardsBefore, id);
      for (let i = 0; i < d; i++) gained.push(id);
    }
    assert.deepEqual(gained.sort(), ['inflate', 'inflate'],
      `选了 grow 后实际多出的是 ${JSON.stringify(gained)}，不是两张旺季 —— 面板与发放脱节`);
  } finally {
    grow.cards = original;
  }
});

test('注入脚本改的字段名与发放代码读的字段名一致（防有人改一边不改另一边）', () => {
  // 夹具的正式家是 support/compare/；.scratch 只是开发机上的旧位置，干净检出里没有它。
  const committed = path.join(ROOT, 'support', 'compare', 'af-variant-inject.js');
  const legacy = path.join(ROOT, '.scratch', 'af-variant-inject.js');
  const inject = readFileSync(existsSync(committed) ? committed : legacy, 'utf8');
  assert.match(inject, /grow\.cards\s*=/, '注入脚本不再直接改 cards 字段');
  const flow = readFileSync(path.join(ROOT, 'src', 'engine', 'flow.js'), 'utf8');
  // 发放点必须是「按 id 找到那个对象，再读 .cards」——不是拷贝成快照
  assert.match(flow, /const pack\s*=\s*SUPPLIES\.find\(/, '发放点不再按 id 取同一实例');
  assert.match(flow, /pack\.cards/, '发放点不再读 pack.cards');
});

// 对照实验必须是单变量：如果除了 grow 补给之外还有别的可见配置跟着变，
// 真人「哪版好玩」的结论就无法归因到 grow 这一个改动上。
// 尤其要钉住：**两版起手手牌相同**。差异是「翻修不再从补给里来」，
// 不是「没有翻修」——起手那张 worker 两版都有。这句话不钉住，
// 将来有人把起手也一起改了，实验对象就悄悄地换了。
test('单变量：注入只改 grow 补给，起手手牌与其他两项补给完全不变', () => {
  const snapshot = () => ({
    supplies: SUPPLIES.map(s => ({ id: s.id, name: s.name, cards: [...s.cards], desc: s.desc })),
    hand: [...SLICE_STYLES.find(s => s.id === 'grow').hand],
    charId: SLICE_STYLES.find(s => s.id === 'grow').charId,
    cardNames: Object.fromEntries(Object.entries(SLICE_CARDS).map(([k, v]) => [k, v.name])),
    configKeys: Object.keys(createSliceConfig({ style: 'grow', human: true, seed: 1 })).sort(),
  });

  const before = snapshot();
  const grow = SUPPLIES.find(item => item.id === 'grow');
  const original = [...grow.cards];
  const originalDesc = grow.desc;
  try {
    grow.cards = ['inflate', 'inflate'];
    grow.desc = `${SLICE_CARDS.inflate.name} + ${SLICE_CARDS.inflate.name}：连开两轮旺季，翻修不再从补给里来。`;
    const after = snapshot();

    // 起手手牌、角色、卡表、配置键结构都必须一样
    assert.deepEqual(after.hand, before.hand, '注入把起手手牌也改了 —— 对照不再是单变量');
    assert.deepEqual(after.hand, ['worker', 'inflate', 'remotedice'], '起手手牌变了');
    assert.equal(after.charId, before.charId, '角色变了');
    assert.deepEqual(after.cardNames, before.cardNames, '卡表变了');
    assert.deepEqual(after.configKeys, before.configKeys, '配置结构变了');

    // 其他两项补给一字不动
    for (const id of ['take', 'cross']) {
      assert.deepEqual(
        after.supplies.find(s => s.id === id),
        before.supplies.find(s => s.id === id),
        `${id} 补给被连带改了`,
      );
    }

    // 允许的差异只有 grow 那一项
    const changed = after.supplies.filter((s, i) => JSON.stringify(s) !== JSON.stringify(before.supplies[i]));
    assert.equal(changed.length, 1, `有 ${changed.length} 项补给变了，应该只有 grow`);
    assert.equal(changed[0].id, 'grow', '变了的不是 grow 那一项');

    // 说清楚这个实验到底改了什么：是“翻修不再从补给里来”。
    // 起手那张 worker 仍在，所以不是“没有翻修”。
    assert.ok(after.hand.includes('worker'), '起手已不含 worker —— 那就不是原本那个对照实验了');
    assert.ok(!after.supplies.find(s => s.id === 'grow').cards.includes('worker'), 'grow 补给里不该再有 worker');
  } finally {
    grow.cards = original;
    grow.desc = originalDesc;
  }
});
