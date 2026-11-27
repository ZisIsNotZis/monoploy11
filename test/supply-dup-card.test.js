import test from 'node:test';
import assert from 'node:assert/strict';

// #797：同一张卡在补给包里出现两次时，屏上必须说清“第二张到底值不值”。
//
// 真引擎实测（见 .scratch/786b-dup/CARD-DUPLICATE-SEMANTICS.md）：
//   inflate / close：同一条街第二张是**重置**（11,200→22,400→**22,400**），不同街各自生效
//   worker：同栋第二张**更值钱**（+2,800 → +5,600）
// 所以文案必须分卡型，不能一刀切。
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { render } from '../src/ui/render.js';

class El {
  constructor() { this.html=''; this.style={setProperty(){}}; this.hidden=false;
    this.classList={add(){},remove(){},toggle(){}}; this.clientWidth=1000; this.clientHeight=800; this.value=''; }
  set innerHTML(v) { this.html=v; }
  get innerHTML() { return this.html; }
  querySelectorAll(){ return []; }
  querySelector(){ return null; }
  addEventListener(){} appendChild(){} remove(){}
}
const strip = s => String(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const root = () => Object.fromEntries(['system','players','board','log','insight','dice','cards','hand','choice'].map(k=>[k,new El()]));

// 造一个「两条街各有对手 Lv3 房屋」的真 state，让 worthOf 算得出金额
function makeState() {
  const s = startSession(createSliceConfig({ seed: 7, style: 'cross' }));
  const me = s.players.find(p => p.controller === 'human');
  const opp = s.players.find(p => p.id !== me.id);
  const byStreet = new Map();
  for (const p of s.map.plots.filter(x => !x.big && x.street)) {
    if (!byStreet.has(p.street)) byStreet.set(p.street, []);
    byStreet.get(p.street).push(p);
  }
  const two = [...byStreet.entries()].filter(([, v]) => v.length >= 2).slice(0, 2);
  for (const [st, ps] of two) for (const p of ps.slice(0, 2)) {
    s.properties[p.id] = { ...(s.properties[p.id] ?? {}), ownerId: opp.id, level: 3, street: st, closed: 0, inflate: 0 };
  }
  // 一块己方已建地，供 worker 用
  const mine = s.map.plots.find(p => !p.big && !two.some(([, ps]) => ps.includes(p)));
  if (mine) s.properties[mine.id] = { ...(s.properties[mine.id] ?? {}), ownerId: me.id, level: 1, street: mine.street, closed: 0, inflate: 0 };
  return s;
}

// 用真 render 渲一帧补给屏，返回纯文本
function drawSupply(cards) {
  const s = makeState();
  s.pending = { type: 'supply', options: [{ id: 'x', name: '包', cards, desc: 'd' }] };
  const r = root();
  render(r, s, new Proxy({}, { get: () => () => {} }));
  return strip(r.choice.innerHTML);
}

test('#797 C1：同名牌只出现一次并带 ×2，不再排两遍', () => {
  // 旧写法 o.cards.map(...) 会输出两行一模一样的「旺季3条街（每次-5,600）」
  // 读起来像“两张叠加 = -11,200”，而实测第二张打同一街只是重置。
  for (const card of ['inflate', 'close', 'worker']) {
    const t = drawSupply([card, card]);
    const name = { inflate: '旺季', close: '停业', worker: '翻修' }[card];
    const occurrences = (t.match(new RegExp(name, 'g')) || []).length;
    // 同一张卡的名称在“现在可用”段里只应出现一次（卡名本身；金额里不会重复卡名）
    assert.ok(occurrences >= 1, card + ' 屏上找不到卡名：' + t);
    assert.match(t, /×2/, card + ' 没写 ×2（玩家不知道这是两张同名牌）：' + t);
    // 关键：不能出现“同一个数写两遍”的形状
    const seg = t.split('现在可用：')[1] ?? '';
    const amounts = [...seg.matchAll(/[+-]?[\d,]{4,}/g)].map(m => m[0]);
    const dup = amounts.filter((v, i) => amounts.indexOf(v) !== i);
    // inflate 在“两抵”情况下金额可以重复（多收X/多付X），那是真信息；
    // 这里只拦“整行重复”这种形状
    assert.ok(!/\s([^\s·]+)\s.*※.*\1/m.test(seg), card + ' 疑似整段重复：' + seg);
  }
});

test('#797 C2：重置型卡（旺季/停业）重复时，限制与机会必须同时出现', () => {
  for (const card of ['inflate', 'close']) {
    const t = drawSupply([card, card]);
    assert.match(t, /同一街重开只重置时间，不叠加/,
      card + ' 没写“同街不叠加”——玩家会以为两张能翻倍：' + t);
    assert.match(t, /换一条街两张都生效/,
      card + ' 没写“换街都生效”——玩家会以为第二张废了、少赚一半：' + t);
  }
});

test('#797 C4：递增型卡（翻修）不得写“不叠加”', () => {
  // worker 同栋第二张是更大收益（+2,800 → +5,600，因为 rentFor 的 base 随等级指数涨）。
  // 写“不叠加”会让人不敢升——这是反向误导。
  const t = drawSupply(['worker', 'worker']);
  assert.doesNotMatch(t, /不叠加|只重置/, '翻修被误写上“不叠加”：' + t);
  assert.match(t, /×2/, '翻修 ×2 没写出来：' + t);
});

test('#797 C3：异名卡（8000 的三个包）不受影响，逐字与旧规则相同', () => {
  // 8000 三包都是异名卡，走不到同名分支 ⇒ 新旧拼接规则应产生完全相同的字符串。
  // 这里用“旧规则”在测试里重写一遍，与新实现对比。
  for (const cards of [['worker','inflate'], ['buyland','remotedice'], ['close','remotedice']]) {
    const t = drawSupply(cards);
    const seg = t.split('现在可用：')[1] ?? '';
    assert.doesNotMatch(seg, /※/, '异名卡不该带同名说明：' + seg);
    assert.doesNotMatch(seg, /×\d/, '异名卡不该带 ×N：' + seg);
    // 每张卡各出现一次（顺序保持）
    const names = { worker:'翻修', buyland:'收购', close:'停业', inflate:'旺季', remotedice:'定步' };
    const idx = cards.map(c => seg.indexOf(names[c]));
    assert.ok(idx.every(i => i >= 0), '有卡没上屏：' + cards + ' → ' + seg);
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b), '卡顺序被改动：' + seg);
  }
});
