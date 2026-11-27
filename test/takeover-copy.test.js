import test from 'node:test';
import assert from 'node:assert/strict';

// #3333：用户在我 #3332 交的那一屏上读到的原话是：
//   灯火街茶铺 10,000（从穿街高手）每局约 +2,078，另压对手 800
// 而同一局模型自己的 perGame 是 1,278 —— 2,078 里已经含那 800，句尾又印了一次。
// 这段测试渲染**玩家真正看到的那一屏**（真实 render.js），咬住三件事：
//   ① 屏上不出现「A + 另压 B」这种读成「两份收益」的写法；
//   ② 我这块的数与模型 perGame 一致；
//   ③ 对手那笔写明是「每次」还是「每局」，不能含糊成一个裸数字。

import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { render } from '../src/ui/render.js';
import { takeoverModel } from '../src/engine/insight.js';
import { money } from '../src/ui/slice.js';

class Element {
  constructor() {
    this.html = ''; this.children = []; this.style = { setProperty() {} }; this.hidden = false;
    this.classList = { add() {}, remove() {}, toggle() {} }; this.clientWidth = 1000; this.clientHeight = 800;
    this.value = ''; this.scrollTop = 0; this.scrollHeight = 0;
  }
  set innerHTML(v) {
    this.html = v; this.children = [];
    for (const m of String(v).matchAll(/<(?:button|div|span|li)\b([^>]*)>/g)) {
      if (!m[1].includes('data-')) continue;
      const c = new Element(); c.dataset = {}; c.attrs = {};
      for (const a of m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        if (!a[1]) continue; c.attrs[a[1]] = a[2] ?? '';
        if (a[1].startsWith('data-')) c.dataset[a[1].slice(5).replace(/-([a-z])/g, (_, x) => x.toUpperCase())] = a[2] ?? '';
      }
      c.disabled = /\bdisabled\b/.test(m[1]); this.children.push(c);
    }
  }
  get innerHTML() { return this.html; }
  querySelectorAll(sel) {
    const m = sel.match(/\[([\w-]+)(?:="([^"]*)")?\]/);
    return m ? this.children.filter(c => m[1] in c.attrs && (m[2] === undefined || c.attrs[m[1]] === m[2])) : [];
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  addEventListener() {} appendChild() {} remove() {}
}
const strip = s => String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// 渲染收购选目标那一屏：直接搭出 main.js 在该提示下会设的 mapPick 形状。
function pickerHtml(state, player) {
  const ids = ['3,1', '4,1', '3,9', '4,9', '11,6', '11,7'];
  state.mapPick = {
    plot: true, value: 'plot', playerId: player.id, cardId: 'buyland',
    plotIds: ids, takeover: takeoverModel(state, player),
  };
  state.pending = { type: 'target', kind: 'plot', cardId: 'buyland' };
  const root = { system: new Element(), players: new Element(), board: new Element(), log: new Element(),
    insight: new Element(), dice: new Element(), cards: new Element(), hand: new Element(), choice: new Element() };
  render(root, state, new Proxy({}, { get: () => () => {} }));
  return { html: String(root.choice.innerHTML), text: strip(root.choice.innerHTML), board: String(root.board.innerHTML) };
}

const fresh = () => startSession(createSliceConfig({ human: false, seed: 1, style: 'take' }));

test('#3333 收购屏不把「我多赚」和「他少收」拼成一份收益（用户当场读错的那句）', () => {
  const state = fresh();
  const me = state.players[0];
  const model = takeoverModel(state, me);
  const { html, text } = pickerHtml(state, me);

  // ① 旧写法：`每局约 +2,078，另压对手 800` —— 逗号+「另」让它读成两份额外收益。
  assert.ok(!/另压对手/.test(text), `屏上又出现「另压对手」把对手那笔写成额外收益：${text.slice(0, 300)}`);
  // 旧的「每局约 +N」里 N 已含对手那笔；修好后不再有这种把两笔合成一个数的写法。
  assert.ok(!/每局约 \+\d[\d,]*，另/.test(text), '屏上又把两笔拼成「每局约 +N，另…」');

  // ② 我这块的数必须是模型的 perGame（不是 perGame+siblingPerGame）
  const top = model.rows[0];
  assert.ok(text.includes(money(top.perGame)),
    `屏上找不到我这块的每局 ${money(top.perGame)}（模型 perGame）：${text.slice(0, 300)}`);
  assert.ok(!text.includes(money(top.perGame + top.siblingPerGame)),
    `屏上出现了 perGame+siblingPerGame=${money(top.perGame + top.siblingPerGame)}，那是把对手那笔并进「我收多少」`);

  // ③ 对手那笔必须带单位词，不能只是一个裸金额
  if (top.siblingPerGame > 0) {
    assert.ok(/他少收约/.test(text), `对手那笔没有写明是谁少收：${text.slice(0, 300)}`);
    assert.ok(text.includes(money(top.siblingPerGame)),
      `屏上找不到对手每局少收 ${money(top.siblingPerGame)}`);
  }
  // 地图角标同样是「我这块」，不能印含对手那笔的和
  const board = strip(pickerHtml(state, me).board);
  assert.ok(board.includes(money(top.perGame)), '地图角标没有印我这块的每局租金');
});

test('#3333 「每局」这个词只挂在每局量上，单次量不许冒充每局', () => {
  const state = fresh();
  const me = state.players[0];
  const model = takeoverModel(state, me);
  const { text } = pickerHtml(state, me);
  // 对手那笔单次量（siblingLoss）在屏上不该以免单位的数字出现；
  // 它出现时必须跟着「每局」换算后的数，或被明确标成「每次」。
  for (const r of model.rows) {
    if (!(r.siblingLoss > 0)) continue;
    // siblingPerGame 已换算；如果屏上印的是 siblingLoss（单次量）而没有「每次」字样，就是单位错。
    if (r.siblingPerGame !== r.siblingLoss) {
      assert.ok(!new RegExp(`他少收约?\\s*${money(r.siblingLoss).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)
        || /每次/.test(text),
        `${r.name}: 屏上把单次量 ${r.siblingLoss} 当成了「他少收约」，没有换算成每局也没写「每次」`);
    }
  }
});
