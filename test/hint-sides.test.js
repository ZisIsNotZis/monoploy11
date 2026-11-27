import test from 'node:test';
import assert from 'node:assert/strict';
import { mountOverflowHint, hiddenOptionSides, hiddenOptionCount, overflowHintTextSides } from '../src/ui/render.js';

// #878：提示只知道「下面」。
// 真浏览器实测（390×844 真入口 /?slice=1，四向岔口，每个位置等两帧 + 120ms 再读）：
//   .scratch/878-volume/hint-settle.json
//   上沿外 1 条、下沿外 0 条时，提示仍写「↓ 还有 1 个方向在下面」（方向说反，7 个位置）
//   或者直接 null —— 上面那项彻底没有任何提示（4 个位置）
// 根因：hiddenOptionCount 只数 r.bottom > bottom，没有任何一项看 r.top < top。

function mkEl({ rect, overflow = 'auto', parent = null, id = '' }) {
  return {
    id, parentElement: parent, children: [], _rect: rect, _overflowY: overflow, _listeners: {},
    clientHeight: Math.round(rect.bottom - rect.top),
    getBoundingClientRect() { return this._rect; },
    setRect(r) { this._rect = r; this.clientHeight = Math.round(r.bottom - r.top); },
    querySelectorAll(sel) {
      if (sel === '.route-choice') return this.children.filter(c => c._isItem);
      if (sel === '[data-overflow-hint]') return this.children.filter(c => c._isHint);
      return [];
    },
    appendChild(n) { this.children.push(n); n.parentElement = this; return n; },
    addEventListener(type, fn) { (this._listeners[type] ??= []).push(fn); },
    fire(type) { for (const fn of this._listeners[type] ?? []) fn({ type }); },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); },
    hasAttribute() { return false; },
    setAttribute() {}, getAttribute() { return null; },
  };
}

// 可见带 605–795（手机实测值），外层 #hand 底边 795、内层 #choice 底边 879。
function env({ handBottom = 795, choiceBottom = 879, choiceTop = 605, items = [] } = {}) {
  const hand = mkEl({ rect: { top: handBottom - 300, bottom: handBottom, height: 300 }, id: 'hand' });
  const choice = mkEl({ rect: { top: choiceTop, bottom: choiceBottom, height: choiceBottom - choiceTop }, parent: hand, id: 'choice' });
  hand.children.push(choice);
  for (const [a, b] of items) {
    const it = mkEl({ rect: { top: a, bottom: b, height: b - a }, parent: choice });
    it._isItem = true;
    choice.children.push(it);
  }
  return { hand, choice };
}

function withDom(t) {
  const prevGCS = globalThis.getComputedStyle;
  const prevDoc = globalThis.document;
  globalThis.getComputedStyle = node => ({ overflowY: node?._overflowY ?? '', overflow: node?._overflowY ?? '' });
  globalThis.document = {
    body: {}, documentElement: {},
    createElement() {
      return {
        _isHint: true, attrs: {}, textContent: '',
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k] ?? null; },
        getBoundingClientRect() { return { top: 0, bottom: 0, height: 0 }; },
        remove() { this._removed = true; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); },
      };
    },
  };
  t.after(() => {
    if (prevGCS === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = prevGCS;
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
  });
}

const countAbove = (items, top) => items.filter(r => r.top < top - 1 && r.bottom <= top + 1).length;

// ---------- 纯函数层 ----------

test('#878 S1：hiddenOptionSides 两侧都数（实测 hs190 cs0：右侧一项 [379,481] 在带外上方）', () => {
  // 上沿 605。第一项底边 481 < 605 ⇒ 在上沿外。其余在带内。
  const rects = [[379, 481], [483, 585], [587, 689], [691, 793]].map(([top, bottom]) => ({ top, bottom }));
  // 带 605–795：[379,481]、[483,585] 整条在上沿外；[587,689] 的**顶边** 587 也越过 605 ⇒ 共 3 条。
  // 这正是实测 hs190 那一帧的几何（当时屏上提示是 null，即 0 条 —— 见 hint-settle.json）。
  const sides = hiddenOptionSides({ top: 605, height: 190 }, rects);
  assert.deepEqual(sides, { above: 3, below: 0 },
    '上沿外 3 条应被数进 above；现状只数 below，会得 {above:0, below:0}');
});

test('#878 S2：hiddenOptionCount 的对外语义不变（只返回 below）', () => {
  const rects = [{ top: 700, bottom: 800 }, { top: 810, bottom: 900 }];
  assert.equal(hiddenOptionCount({ top: 605, height: 190 }, rects), 2,
    '既有调用点仍拿数字；改为对象会破 test/direction-tie.test.js:232');
});

test('#878 S3：above=0 时提示文本与旧版逐字相同', () => {
  assert.equal(overflowHintTextSides({ above: 0, below: 2 }), '↓ 还有 2 个方向在下面');
});

test('#878 S4：两侧都有时各报一条', () => {
  const s = overflowHintTextSides({ above: 1, below: 1 });
  assert.match(s, /1 个方向在上面/, '缺「上面」半句：' + s);
  assert.match(s, /1 个方向在下面/, '缺「下面」半句：' + s);
});

// ---------- 走真实现 ----------

test('#878 S5（牙 1：方向必须对）：上沿外有项时，提示不能写「在下面」', (t) => {
  withDom(t);
  const e = env({ items: [[379, 481], [483, 585], [587, 689], [691, 793]] });
  const mounted = mountOverflowHint(e.choice);
  assert.ok(mounted, '有项出带，应该出提示（现状 here below=0 ⇒ 返回 null，这条会红）');
  const hint = e.choice.children.find(c => c._isHint) ?? e.hand.children.find(c => c._isHint);
  assert.ok(hint, '没挂上提示');
  assert.match(hint.textContent, /在上面/, '上沿外有项，提示却说不是上面：' + hint.textContent);
  assert.doesNotMatch(hint.textContent, /↓.*在下面/, '上沿外有项却仍写「↓ …在下面」：' + hint.textContent);
});

test('#878 S6（牙 2：两侧各报一条）', (t) => {
  withDom(t);
  // 带 605–795：第 1 项在上沿外，最后一项在下沿外。
  const e = env({ items: [[379, 481], [483, 585], [600, 700], [800, 900]] });
  const mounted = mountOverflowHint(e.choice);
  assert.ok(mounted);
  const hint = [...e.hand.children, ...e.choice.children].find(c => c._isHint);
  assert.match(hint.textContent, /个方向在上面/, '缺上面：' + hint.textContent);
  assert.match(hint.textContent, /1 个方向在下面/, '缺下面：' + hint.textContent);
});

test('#878 S7（牙 3：不许误报）：全部在带内时不出提示', (t) => {
  withDom(t);
  const e = env({ items: [[610, 700], [710, 790]] });
  assert.equal(mountOverflowHint(e.choice), null);
});

test('#878 S8（牙 4）：方向从「下面」翻成「上面」时，recalc 必须改字（总数同为 1）', (t) => {
  withDom(t);
  // 初值：1 项在下。随后滚动，几何翻转成 1 项在上。
  const e = env({ items: [[610, 700], [800, 900]] });
  assert.ok(mountOverflowHint(e.choice));
  const hint = [...e.choice.children, ...e.hand.children].find(c => c._isHint);
  assert.match(hint.textContent, /1 个方向在下面/);
  // 模拟滚动：滚动容器的**矩形不动**（外层底边仍 795），只有子项上移 190。
  // 上一版我把 #choice 的矩形也改了，等于同时改了可见带，那是错的尺子。
  const items = e.choice.children.filter(c => c._isItem);
  items[0].setRect({ top: 420, bottom: 510, height: 90 });
  items[1].setRect({ top: 610, bottom: 700, height: 90 });
  e.choice.fire('scroll');
  assert.match(hint.textContent, /在上面/, '方向翻转后提示被总数相等掩盖了：' + hint.textContent);
  assert.doesNotMatch(hint.textContent, /在下面/, '已无下方项却仍写下面：' + hint.textContent);
});
