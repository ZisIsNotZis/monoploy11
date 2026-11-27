import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig, SLICE_MAP } from '../src/data/slice.js';
import { startSession, landingPhase, groundPhase } from '../src/engine/flow.js';
import { rentRowsFor } from '../src/ui/slice.js';

// #1026：`groundPhase` 缺在押检查。
//
// 缺陷：`landingPhase`（flow.js:524/:525）落在医院/监狱格时把人送到 facility 格并设
// jail/hospital，而 playTurn 紧接着**无条件**调 `groundPhase`。于是「被送进去」的那一回合
// 仍在 facility 格结算邻店：会收租（实测 0 次，因为那两格邻的是自家店）、会弹加盖框
// （实测 5 次，各花 10,000）。`landingPhase:504` 本来就有同一前提，`groundPhase` 漏了。

const quiet = () => ({ render() {}, async step() {}, async say() {}, async ask() { return false; } });

function fixture(seed = 7, style = 'grow') {
  const s = startSession(createSliceConfig({ seed, style }));
  const me = s.players.find(p => p.controller === 'human');
  const opp = s.players.find(p => p.id !== me.id);
  return { s, me, opp };
}
function own(s, owner, plotId, level = 2) {
  s.properties[plotId] = { ownerId: owner.id, level, big: false, bigType: null, closed: 0, inflate: 0 };
  if (!owner.properties.includes(plotId)) owner.properties.push(plotId);
}
const rentLines = (s, from) => s.log.slice(from).map(e => e.text).filter(t => /实付租金|应付租金/.test(t));

// 医院格 '0,5' → facility 医院 '1,5'，邻 西巷茶铺 '1,4'；监狱格 '12,5' → 监狱 '11,5'，邻 东巷小店 '11,6'。
for (const [label, cell, plotId, plotName] of [
  ['医院', '0,5', '1,4', '西巷茶铺'],
  ['监狱', '12,5', '11,6', '东巷小店'],
]) {
  test(`入狱/住院那一回合不结算邻店：停在${label}格，旁边是对手的${plotName}`, async () => {
    const { s, me, opp } = fixture();
    own(s, opp, plotId);
    me.position = cell;
    const from = s.log.length;
    const ui = quiet();
    await landingPhase(s, me, ui);
    assert.ok((me.jail ?? 0) > 0 || (me.hospital ?? 0) > 0, `${label}格应把人送进在押状态`);
    assert.equal(me.position, SLICE_MAP.facility[label === '医院' ? 'hospital' : 'jail'], '应先落到 facility 格');
    const cashBefore = me.cash, oppCashBefore = opp.cash;
    await groundPhase(s, me, ui);
    assert.deepEqual(rentLines(s, from), [], `在押回合不该出现收租行：${rentLines(s, from).join(' | ')}`);
    assert.equal(me.cash, cashBefore, '在押回合不该再花钱');
    assert.equal(opp.cash, oppCashBefore, '在押回合不该再收钱');
  });
}

test('在押回合不再弹加盖框（改前在 facility 格上真的弹过，各花 10,000）', async () => {
  const { s, me, opp } = fixture();
  own(s, opp, '11,6', 1);
  // 同级店在己方手里，才会触发「自己停在自家店旁」的加盖提议。
  s.properties['11,6'] = { ownerId: me.id, level: 1, big: false, bigType: null, closed: 0, inflate: 0 };
  if (!me.properties.includes('11,6')) me.properties.push('11,6');
  me.position = '12,5';
  const asked = [];
  const ui = { render() {}, async step() {}, async say() {}, async ask(p) { asked.push(p.type); return false; } };
  await landingPhase(s, me, ui);
  await groundPhase(s, me, ui);
  assert.ok(!asked.includes('build'), `在押回合不该问加盖：${asked.join(',')}`);
  assert.ok(!asked.includes('buy'), `在押回合不该问买地：${asked.join(',')}`);
  assert.equal(s.properties['11,6'].level, 1, '在押回合不该改变等级');
});

test('不误伤：正常停在对手店旁仍在结算（收租行照样出现）', async () => {
  const { s, me, opp } = fixture();
  own(s, opp, '1,4');
  me.position = '2,4';   // 空路面，邻 西巷茶铺
  const from = s.log.length;
  await groundPhase(s, me, quiet());
  assert.ok(rentLines(s, from).length >= 2, '非在押的邻店结算必须照旧');
  assert.ok(opp.cash > 0, '对手应当收到租金');
});

test('不误伤：活着且不在押时守卫不拦（已死的人本来就被 landingPhase:504 拦住）', async () => {
  const { s, me, opp } = fixture();
  own(s, opp, '1,4');
  me.position = '2,4';
  assert.equal(me.jail ?? 0, 0);
  assert.equal(me.hospital ?? 0, 0);
  const from = s.log.length;
  await groundPhase(s, me, quiet());
  assert.ok(s.log.slice(from).length > 0, '不在押时不该静默返回');
});
