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
test('real page entry can start a slice and play upgrade → high season through production handlers',async t=>{
  const elements=Object.fromEntries(['sideGrip','system','players','board','log','insight','dice','cards','hand','choice','count','setupRows','sliceStyles','startSlice','start','setup','seed'].map(id=>[id,new Element()]));
  elements.count.value='4';elements.seed.value='7';
  const previous={document:globalThis.document,window:globalThis.window,location:globalThis.location,localStorage:globalThis.localStorage,setTimeout:globalThis.setTimeout};
  t.after(()=>{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  globalThis.document={documentElement:new Element(),body:new Element(),querySelector:s=>s.startsWith('#')?elements[s.slice(1)]??null:s.includes('sliceStyle')?{value:'grow'}:null,querySelectorAll:()=>[],createElement:()=>new Element()};
  globalThis.window={innerWidth:1400,innerHeight:900,addEventListener(){},removeEventListener(){}};
  globalThis.location={search:'',href:'http://localhost:8000/'};
  globalThis.localStorage={getItem(){return null;}};
  globalThis.setTimeout=fn=>{queueMicrotask(fn);return 1;};
  await import('../src/main.js');
  assert.equal(typeof elements.startSlice.onclick,'function');
  elements.startSlice.onclick();await settle();
  assert.equal(elements.setup.hidden,true);assert.match(elements.insight.innerHTML,/轮到你了/);
  const initial=elements.cards.querySelector('[data-card="0"]');assert.ok(initial&&!initial.disabled);initial.onclick();await settle();
  const shop=elements.board.querySelector('[data-pick-plot="3,1"]');assert.ok(shop);shop.onclick();await settle();
  assert.match(elements.board.innerHTML,/租 5,600/);assert.match(elements.log.innerHTML,/翻修.*晨光街小店.*2 级/);
  elements.cards.querySelector('[data-card="0"]').onclick();await settle();
  elements.board.querySelector('[data-pick-plot="3,1"]').onclick();await settle();
  assert.match(elements.board.innerHTML,/租 11,200/);assert.match(elements.log.innerHTML,/旺季.*晨光街/);
  assert.ok(elements.cards.querySelectorAll('[data-card]').every(b=>b.disabled));
  assert.match(elements.dice.innerHTML,/还能用 0 张卡/);
});
