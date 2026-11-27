import test from 'node:test';
import assert from 'node:assert/strict';
import { mountOverflowHint } from '../src/ui/render.js';

// #878：提示被移除后必须能回来。
// 背景：recalc() 里原本 `if (cur <= 0) hint.remove()`，而 recalc 只改属性与文字、从不重挂。
// ⇒ 玩家把列表滚到「全部完整入带」那一刻，提示被删；再滚回去时它**再也不会出现**，
//   连「↓ 还有 N 个在下面」也没了，玩家失去全部方向感。
// 本单新增的 above 分支让「某侧越界」更容易成立，也就更容易踩到这条路径。
//
// 难以用真浏览器凑出「全部恰好完整入带」的位置（实测桌面 25 个位置、手机 28 个位置都没凑到），
// 所以用单元夹具直接给定几何。

function mkEl({ rect, overflow = 'auto', parent = null, id = '' }) {
  return {
    id, parentElement: parent, children: [], _rect: rect, _overflowY: overflow, _listeners: {},
    clientHeight: Math.round(rect.bottom - rect.top),
    getBoundingClientRect() { return this._rect; },
    setRect(r) { this._rect = r; },
    querySelectorAll(sel) {
      if (sel === '.route-choice') return this.children.filter(c => c._isItem);
      if (sel === '[data-overflow-hint]') return this.children.filter(c => c._isHint);
      return [];
    },
    appendChild(n) { this.children.push(n); n.parentElement = this; return n; },
    addEventListener(t, fn) { (this._listeners[t] ??= []).push(fn); },
    fire(t) { for (const fn of this._listeners[t] ?? []) fn({ type: t }); },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); },
    hasAttribute() { return false; },
    setAttribute() {}, getAttribute() { return null; },
  };
}

function env(t) {
  const created = [];
  const prevGCS = globalThis.getComputedStyle;
  const prevDoc = globalThis.document;
  globalThis.getComputedStyle = n => ({ overflowY: n?._overflowY ?? '', overflow: n?._overflowY ?? '' });
  globalThis.document = {
    body: {}, documentElement: {},
    createElement() {
      const h = { _isHint: true, attrs: {}, textContent: '', className: '',
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k] ?? null; },
        getBoundingClientRect() { return { top: 0, bottom: 0, height: 0 }; },
        remove() { this._removed = true; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); } };
      created.push(h);
      return h;
    },
  };
  t.after(() => {
    if (prevGCS === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = prevGCS;
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
  });
  // 带 605–795（手机实测值）
  const hand = mkEl({ rect: { top: 495, bottom: 795, height: 300 }, id: 'hand' });
  const choice = mkEl({ rect: { top: 605, bottom: 879, height: 274 }, parent: hand, id: 'choice' });
  hand.children.push(choice);
  const OFFS = [[692, 794], [796, 898], [900, 1002], [1004, 1106]];
  const items = OFFS.map(([a, b]) => {
    const it = mkEl({ rect: { top: a, bottom: b, height: b - a }, parent: choice });
    it._isItem = true; choice.children.push(it); return it;
  });
  // 「现在活着的提示」= 真的在某个容器 children 里；不能用 _removed（stub 置位不清位）
  const liveHint = () => [...choice.children, ...hand.children].find(c => c._isHint);
  return { hand, choice, items, created, liveHint, OFFS };
}

test('#878 R1（牙）：全部入带 → 提示收掉；滚回去 → 提示必须重新出现', (t) => {
  const e = env(t);
  const mounted = mountOverflowHint(e.choice);
  assert.ok(mounted, '初始应出提示');
  assert.match(e.liveHint().textContent, /3 个方向在下面/);

  // ① 全部完整入带 ⇒ 提示应被收掉（既有行为，不许回退）
  e.items.forEach((it, i) => it.setRect({ top: 610 + i * 46, bottom: 650 + i * 46, height: 40 }));
  e.choice.fire('scroll');
  assert.equal(e.liveHint(), undefined, '全部在带内时提示应被收掉');

  // ② 再滚回原位置 ⇒ 提示必须回来
  e.items.forEach((it, i) => {
    const [a, b] = e.OFFS[i];
    it.setRect({ top: a, bottom: b, height: b - a });
  });
  e.choice.fire('scroll');
  const back = e.liveHint();
  assert.ok(back, '滚回去后提示没有回来：recalc 只改文字不重挂 ⇒ 玩家从此没有任何方向提示');
  assert.match(back.textContent, /3 个方向在下面/, '回来的提示文字不对：' + back.textContent);
});

test('#878 R2：重新出现时复用同一个元素，不逐次新建（防逐帧累加）', (t) => {
  const e = env(t);
  assert.ok(mountOverflowHint(e.choice));
  assert.equal(e.created.length, 1);
  for (let round = 0; round < 3; round++) {
    e.items.forEach((it, i) => it.setRect({ top: 610 + i * 46, bottom: 650 + i * 46, height: 40 }));
    e.choice.fire('scroll');
    e.items.forEach((it, i) => {
      const [a, b] = e.OFFS[i];
      it.setRect({ top: a, bottom: b, height: b - a });
    });
    e.choice.fire('scroll');
  }
  assert.equal(e.created.length, 1, 'createElement 被调了 ' + e.created.length + ' 次：提示在累加');
  assert.equal(e.choice.children.filter(c => c._isHint).length + e.hand.children.filter(c => c._isHint).length, 1,
    'DOM 里出现了多份提示');
});
