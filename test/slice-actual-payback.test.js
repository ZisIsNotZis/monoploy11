import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { sliceResults, actualRentByPlot } from '../src/ui/slice.js';

// #574：账面回本 vs 本局实际回本。
//
// 两个必须分开的事（分开才不会撒谎）：
//   建造那一刻未来未知 ⇒ 建造日志只能说账面；
//   局结束后事实已定 ⇒ 结算页才能说实际。
//
// 这里钉：结算页那段的数必须等于从 state.log 独立数出来的值。

function slice() {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  s.over = true; s.phase = 'over';
  return s;
}

// 独立数：不复用 actualRentByPlot，逐条正则数一遍。
function countRent(state) {
  const m = new Map();
  for (const e of state.log) {
    const r = /^\S+ 向 \S+ 应付租金 (\d+)（([^）]+)）/.exec(e.text);
    if (!r) continue;
    const row = m.get(r[2]) ?? { hits: 0, paid: 0 };
    row.hits += 1; row.paid += Number(r[1]);
    m.set(r[2], row);
  }
  return m;
}

test('actualRentByPlot 与逐条手工统计完全一致', () => {
  const s = slice();
  s.log.push({ day: 3, text: '甲 向 乙 应付租金 5000（晨光街茶铺）' });
  s.log.push({ day: 4, text: '甲 向 乙 应付租金 0（晨光街茶铺）' });
  s.log.push({ day: 5, text: '丙 向 丁 应付租金 700（西巷茶铺）' });
  // 只比 hits/paid：实现现在多了 freeHits（单列停业封租），拿整对象比会红。
  const viaFn = actualRentByPlot(s);
  const manual = countRent(s);
  assert.equal(viaFn.size, manual.size, '店数不一致');
  for (const [k, v] of manual) {
    const f = viaFn.get(k);
    assert.ok(f, `缺店 ${k}`);
    assert.equal(f.hits, v.hits, `${k} hits 不一致`);
    assert.equal(f.paid, v.paid, `${k} paid 不一致`);
  }
  assert.equal(actualRentByPlot(s).get('晨光街茶铺').hits, 2, '停业同一条也算被踩到一次');
  assert.equal(actualRentByPlot(s).get('晨光街茶铺').paid, 5000, '停业那次金额 0，合计应仍为 5000');
});

test('结算页写出「实收 N 次 / 金额」，且与日志一致', () => {
  const s = slice();
  const human = s.players.find(p => p.controller === 'human');
  const plot = human.properties[0];
  const name = s.map.plots.find(p => p.id === plot).name;
  s.log.push({ day: 5, text: `甲 向 乙 应付租金 4200（${name}）` });
  s.slice.history.push({ day: 4, playerId: human.id, money: 0, assets: 0, cardsPlayed: 0, lines: [`${human.name} 使用 翻修 → ${name}，升到 2 级`] });
  const html = sliceResults(s);
  assert.match(html, /你升级过的店，本局到底回本没有/, '结算页缺少实际回本段');
  assert.match(html, /实收 1 次 \/ 4,200/, `次数或金额不对：${html}`);
  assert.match(html, /已回本/, '免费翻修被踩到一次就该判回本');
});

test('从未被踩到的店必须明说「0 次踩到」，不编回合数', () => {
  const s = slice();
  const human = s.players.find(p => p.controller === 'human');
  const name = s.map.plots.find(p => p.id === human.properties[0]).name;
  s.slice.history.push({ day: 4, playerId: human.id, money: 0, assets: 0, cardsPlayed: 0, lines: [`${human.name} 使用 翻修 → ${name}，升到 2 级`] });
  const html = sliceResults(s);
  assert.match(html, /实收 0 次/, '应为 0 次');
  assert.match(html, /0 次踩到/, '必须明说一次也没踩到');
  assert.match(html, /账面回本没兑现/, '必须说账面数字未兑现');
  assert.equal(/[1-9]\d* 回合回本/.test(html), false, '未兑现时不该再出现回本回合数');
});

test('付费加盖：实收不足花费时不能说已回本', () => {
  const s = slice();
  const human = s.players.find(p => p.controller === 'human');
  const name = s.map.plots.find(p => p.id === human.properties[0]).name;
  s.log.push({ day: 5, text: `甲 向 乙 应付租金 1000（${name}）` });
  s.slice.history.push({ day: 4, playerId: human.id, money: 0, assets: 0, cardsPlayed: 0, lines: [`${human.name} 将 ${name} 升到 Lv.2（花费 15000）`] });
  const html = sliceResults(s);
  assert.match(html, /还不够本/, `实收 1000 < 花费 15000，不该说已回本：${html}`);
  assert.equal(/已回本/.test(html), false, '不该出现「已回本」');
});

test('只统计人类玩家自己升级的店（不把对手的算进来）', () => {
  const s = slice();
  const human = s.players.find(p => p.controller === 'human');
  const other = s.players.find(p => p.controller !== 'human');
  s.slice.history.push({ day: 4, playerId: other.id, money: 0, assets: 0, cardsPlayed: 0, lines: [`${other.name} 使用 翻修 → 东巷小店，升到 2 级`] });
  const html = sliceResults(s);
  assert.equal(/你升级过的店/.test(html), false, `对手升级不该让人类段落出现：${html}`);
});
