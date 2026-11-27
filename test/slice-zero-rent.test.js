import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { sliceResults, actualRentByPlot } from '../src/ui/slice.js';

// 根 #574 验收发现的真缺陷：停业封租时 `应付租金 0（店名）` 的行也会命中统计，
// 旧实现把它计成「被踩到」（hits+1, paid+0），而免费翻修的判定是 `hits > 0`
// ⇒ 会打出「实收 1 次 / 0 — 已回本」。
//
// 那是谎话：人确实走过去了，但一分钱没收，根本没有回本。
// 这条测试就是钉住它：0 元行必须单列，回本判定只看真收到的钱。

function slice() {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  s.over = true; s.phase = 'over';
  return s;
}

function humanWithHistory(state, lines) {
  const human = state.players.find(p => p.controller === 'human');
  state.slice.history.push({ day: 4, playerId: human.id, money: 0, assets: 0, cardsPlayed: 0, lines });
  return human;
}

test('0 元收租行被单列为 freeHits，不会被当成「收到钱」', () => {
  const s = slice();
  s.log.push({ day: 5, text: '甲 向 乙 应付租金 0（东巷小店）' });
  const r = actualRentByPlot(s).get('东巷小店');
  assert.equal(r.hits, 1, '走过一次应计入 hits');
  assert.equal(r.paid, 0, '封租那次不能算钱');
  assert.equal(r.freeHits, 1, '应单列为 freeHits');
});

test('免费翻修只撞上停业（0 元）时，不能说已回本', () => {
  const s = slice();
  const human = humanWithHistory(s, ['我 使用 翻修 → 东巷小店，升到 2 级']);
  void human;
  s.log.push({ day: 5, text: '甲 向 乙 应付租金 0（东巷小店）' });
  const html = sliceResults(s);
  assert.equal(/已回本/.test(html), false, `一分钱没收却说已回本：${html}`);
  assert.match(html, /账面回本没兑现/, '必须说未兑现');
  assert.match(html, /走过 1 次但一次也没收到钱/, '应拆穿「走过但没收钱」');
  assert.match(html, /1 次撞上停业/, '应说明原因');
});

test('既有收到钱又有停业时，报已回本但标明其中几次没收钱', () => {
  const s = slice();
  humanWithHistory(s, ['我 使用 翻修 → 晨光街茶铺，升到 2 级']);
  s.log.push({ day: 5, text: '甲 向 乙 应付租金 4200（晨光街茶铺）' });
  s.log.push({ day: 9, text: '甲 向 乙 应付租金 0（晨光街茶铺）' });
  const html = sliceResults(s);
  assert.match(html, /已回本/);
  assert.match(html, /实收 2 次 \/ 4,200/, `次数应包含停业那次，金额不包含：${html}`);
  assert.match(html, /其中 1 次撞上停业/, '应标出哪几次没收钱');
});

test('付费加盖：全部撞上停业（0 元）时不能说已回本', () => {
  const s = slice();
  humanWithHistory(s, ['我 将 东巷小店 升到 Lv.2（花费 15000）']);
  s.log.push({ day: 5, text: '甲 向 乙 应付租金 0（东巷小店）' });
  s.log.push({ day: 6, text: '甲 向 乙 应付租金 0（东巷小店）' });
  const html = sliceResults(s);
  assert.equal(/已回本/.test(html), false, `实收 0 < 花费 15000，不该说已回本：${html}`);
  assert.match(html, /账面回本没兑现/);
});
