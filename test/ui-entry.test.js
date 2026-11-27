import test from 'node:test';
import assert from 'node:assert/strict';

// A small DOM adapter executes the real browser entry/actions in Node.
// It verifies wiring and resulting markup, not CSS geometry or browser behavior.
class Element {
  constructor(){this.html='';this.children=[];this.style={setProperty(){}};this.classList={add(){},toggle(){}};this.clientWidth=1000;this.clientHeight=800;this.value='';}
  set innerHTML(value){this.html=value;this.children=[];for(const match of value.matchAll(/<(?:button|div|span)\b([^>]*)>/g)) {
    if(!match[1].includes('data-'))continue;
    const child=new Element();child.dataset={};child.attrs={};
    for(const a of match[1].matchAll(/([\w-]+)="([^"]*)"/g)){child.attrs[a[1]]=a[2];if(a[1].startsWith('data-'))child.dataset[a[1].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=a[2];}
    child.disabled=/\bdisabled\b/.test(match[1]);this.children.push(child);
  }}
  get innerHTML(){return this.html;}
  querySelectorAll(selector){const m=selector.match(/\[([\w-]+)(?:="([^"]*)")?\]/);return m?this.children.filter(c=>m[1] in c.attrs&&(m[2]===undefined||c.attrs[m[1]]===m[2])):[];}
  querySelector(s){return this.querySelectorAll(s)[0]??null;}
  addEventListener(){} appendChild(){} remove(){}
}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
// #3344：第一屏多了一个**真的会改变引擎行为**的选择（发牌表），所以这条判据的装配
// 也得跟着能选它。默认＝争街，`opening='whole'` 时把那一格单选拨到旧表。
// 适配器只认很少的选择器（与以前一样）：`#id`、`[name="sliceStyle"]:checked`、
// `[name="sliceOpening"]:checked`。多一个选择器就多一片会和真 DOM 不同的地方，
// 所以不引入更通用的实现。
async function boot(t, opening = 'contested') {
  const ids=['sideGrip','system','players','board','log','insight','dice','cards','hand','choice','count','setupRows','sliceStyles','startSlice','start','setup','seed'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  elements.count.value='4';elements.seed.value='7';
  const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location,localStorage:globalThis.localStorage,setTimeout:globalThis.setTimeout};
  t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  globalThis.document={documentElement:new Element(),body:new Element(),
    querySelector:s=>s.startsWith('#')?elements[s.slice(1)]??null
      :s.includes('sliceStyle')?{value:'grow'}
      :s.includes('sliceOpening')?{value:opening}
      :null,
    querySelectorAll:()=>[],createElement:()=>new Element()};
  globalThis.window={innerWidth:1400,innerHeight:900,addEventListener(){},removeEventListener(){}};
  globalThis.location={search:'',href:'http://localhost:8000/'};
  globalThis.localStorage={getItem(){return null;}};
  globalThis.setTimeout=fn=>{queueMicrotask(fn);return 1;};
  // 每次装配都用唯一的查询串重新 import：main.js 是模块单例，
  // 不换 URL 就会命中缓存，第二次装配时 ctx.onclick 仍然是 undefined。
  // 这不是「测试技巧」，而是这条判据真的在跑**同一份真实入口两次**的前提。
  boot.count = (boot.count ?? 0) + 1;
  await import(`../src/main.js?entry=${boot.count}-${opening}`);
  assert.equal(typeof elements.startSlice.onclick,'function');
  return { elements };
}
// 这条判据原本只覆盖旧发牌：它按「晨光街两间都是你的（×1.4）」断言租金 2,800→5,600，
// 那正是整条街发牌的结果。争街成为默认后同一个动作的租金是 2,000→4,000，判据立刻红了 ——
// 红得对：它断言的是「玩家看到的产品」，而产品变了。
//
// 现在它把两条都咬住，并且从**第一屏的单选**驱动，而不是直接往 startSession 里塞参数：
//   默认          ⇒ 争街（晨光街只有一间，租金 2,000；升级后 4,000；旺季 8,000）
//   选「整条街」  ⇒ 旧表（x1.4 已满：2,800 / 5,600 / 11,200）
// 这样「默认是哪一个」和「选了它会怎样」都在判据里，不靠注释。
test('real page entry can start a slice and play upgrade → high season through production handlers', async t => {
  const { elements } = await boot(t);
  elements.startSlice.onclick(); await settle();
  assert.equal(elements.setup.hidden, true); assert.match(elements.insight.innerHTML, /轮到你了/);
  const c = elements.cards.querySelector('[data-card="0"]'); assert.ok(c && !c.disabled); c.onclick(); await settle();
  const shop = elements.board.querySelector('[data-pick-plot="3,1"]'); assert.ok(shop); shop.onclick(); await settle();
  // 争街默认：晨光街只有一间是你的，所以没有同街加成 —— 4,000 而不是 5,600。
  assert.match(elements.board.innerHTML, /租 4,000/);
  assert.match(elements.log.innerHTML, /翻修.*晨光街小店.*2 级/);
  elements.cards.querySelector('[data-card="0"]').onclick(); await settle();
  elements.board.querySelector('[data-pick-plot="3,1"]').onclick(); await settle();
  assert.match(elements.board.innerHTML, /租 8,000/); assert.match(elements.log.innerHTML, /旺季.*晨光街/);
  assert.ok(elements.cards.querySelectorAll('[data-card]').every(b => b.disabled));
  assert.match(elements.dice.innerHTML, /还能用 0 张卡/);
});

// #3344b 的两件事（重开时 URL 带上本局那张盘 / 第一屏从 URL 把单选拨过去）
// 不用这个 DOM 适配器测：replay 挂在 actions 上、页面跳转在这里只能靠桩，
// 写出来的会是一条永远静默跳过的假判据。它们由**真浏览器回执**咬：
// support/full-game/drive-full.mjs 的 replay 步骤现在会把落地后的 URL 与
// 第一屏实际选中的 opening 一起记进 record-10-replay.json，
// 再由 verify-receipt 的 F 项核。

// 同一串动作，在「整条街」发牌下必须回到 ×1.4 的那组数 —— 证明两块牌真的换的是引擎行为，
// 不只是屏上的一句话。两局唯一的差别就是第一屏那一格单选。
test('#3344 选「整条街」时，同一串动作回到 x1.4 已满的租金（2,800 → 5,600 → 11,200）', async t => {
  const { elements } = await boot(t, 'whole');
  elements.startSlice.onclick(); await settle();
  const c = elements.cards.querySelector('[data-card="0"]'); assert.ok(c && !c.disabled); c.onclick(); await settle();
  elements.board.querySelector('[data-pick-plot="3,1"]').onclick(); await settle();
  assert.match(elements.board.innerHTML, /租 5,600/);
  elements.cards.querySelector('[data-card="0"]').onclick(); await settle();
  elements.board.querySelector('[data-pick-plot="3,1"]').onclick(); await settle();
  assert.match(elements.board.innerHTML, /租 11,200/);
});
