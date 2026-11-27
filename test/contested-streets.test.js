// #3342 开局所有权：本片最硬的一条结构事实，以及它的候选改法。
//
// 事实（改前就在产品里，不是本片引入的）：
//   每条街只有两间小店，而三家起手各自拿**同一条街的两间** ⇒
//   同街加成 `1 + 0.4 × (本队该街店数 − 1)` 在 t=0 就已经是 ×1.4（满）。
//   于是「凑齐一条街」这个最经典的大富翁计划，开局第一秒就完成了。
//
// 这条测试有三件事要钉住：
//   ① 默认路径仍然是「整条街」—— 本片不偷偷改玩家今天玩到的东西；
//   ② 争街路径（?cross=1）每条街确实只剩一半，而且没有一条街被整条分给一个人；
//   ③ 两条路径的小店总数、每家人数一致 —— 改的是分布，不是资源量。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig, initializeSlice, SLICE_MAP } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { rentFor } from '../src/engine/economy.js';

const smallShops = () => SLICE_MAP.plots.filter(p => !p.big);

function ownership(state) {
  return smallShops().map(plot => ({
    id: plot.id,
    street: plot.street,
    name: plot.name,
    owner: state.properties[plot.id]?.ownerId ?? null,
  }));
}

test('默认开局：每家整条街两间，同街加成 t=0 就是满的（这是被改之前的现状）', () => {
  const state = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow' }));
  const rows = ownership(state);
  for (const player of state.players) {
    const mine = rows.filter(r => r.owner === player.id);
    assert.equal(mine.length, 2, `${player.style} 应当有 2 间小店`);
    assert.equal(new Set(mine.map(r => r.street)).size, 1,
      `${player.style} 的两间店应当在同一条街上（现状）`);
  }
  // 同街加成已经满了：一条街两间全归我 ⇒ rentFor 比只剩一间高 40%。
  const player = state.players[0];
  const id = player.properties[0];
  const both = rentFor(state, id);
  const solo = (() => {
    const other = player.properties[1];
    const saved = state.properties[other].ownerId;
    state.properties[other].ownerId = null;
    const value = rentFor(state, id);
    state.properties[other].ownerId = saved;
    return value;
  })();
  assert.equal(both, Math.round(solo * 1.4), `同街加成应当已经吃满：${both} 应为 ${solo} × 1.4`);
});

test('争街开局：每条街都不再整条归一个人，但每家人数与小店总数不变', () => {
  const state = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: true }));
  const rows = ownership(state);
  assert.equal(rows.length, smallShops().length, '小店总数不能变');

  for (const player of state.players) {
    assert.equal(rows.filter(r => r.owner === player.id).length, 2,
      `${player.style} 仍应有 2 间（改分布，不改资源量）`);
  }

  const byStreet = new Map();
  for (const row of rows) {
    const list = byStreet.get(row.street) ?? [];
    list.push(row.owner);
    byStreet.set(row.street, list);
  }
  const ownedWhole = [...byStreet].filter(([, owners]) => owners.every(o => o && o === owners[0]));
  assert.deepEqual(ownedWhole, [], `争街开局里不应有整条街归一个人：${JSON.stringify(ownedWhole)}`);
});

test('争街开局里，确实存在「买下/收购另一半就能独占整条街」的街', () => {
  const state = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: true }));
  const human = state.players[0];
  const rows = ownership(state);
  const myStreets = new Set(rows.filter(r => r.owner === human.id).map(r => r.street));
  const completable = [...myStreets].filter(street => {
    const others = rows.filter(r => r.street === street && r.owner !== human.id);
    // 另一半只能是无主或对手的 —— 两种都是可推进的方向（掏钱 / 收购卡）。
    return others.length === 1 && others[0].owner !== human.id;
  });
  assert.ok(completable.length >= 1,
    `至少应当有一条「只差另一半」的街，实得 ${JSON.stringify([...myStreets])}`);
});

test('两条路径的开局现金与手牌完全一致（改的只有所有权）', () => {
  const whole = startSession(createSliceConfig({ human: false, seed: 1, style: 'cross' }));
  const split = startSession(createSliceConfig({ human: false, seed: 1, style: 'cross', sliceContestedStreets: true }));
  for (let i = 0; i < whole.players.length; i++) {
    assert.equal(whole.players[i].cash, split.players[i].cash, `第 ${i} 家现金变了`);
    assert.deepEqual(whole.players[i].cards, split.players[i].cards, `第 ${i} 家手牌变了`);
    assert.equal(whole.players[i].position, split.players[i].position, `第 ${i} 家起点变了`);
  }
});
