import test from 'node:test';
import assert from 'node:assert/strict';
import { mountOverflowHint, hiddenOptionSides, visibleBounds } from '../src/ui/render.js';

// #3278：提示**不许**在插入时挪动它刚刚量过的版面。
//
// 两个方向都实测到过，同一个根因（sticky 保留 flow，而 #hand 是底对齐的）：
//   OUT-G 插入时 {n:1, text:"↓ 还有 1 个方向在下面", sides:{0,0}, agreeAtInsert:false}
//          → 提示进了 DOM 之后，两个方向其实都已可见：屏上说假话。
//   OUT-H 插入 key3 parent:null（append 与 detach 在同一个同步块里），随后该屏 sides {0,1}、
//          没有提示：原本被裁的那条路线重新变成静默裁切。
// 插入前量会「说假话」，插入后会「把提示自己收掉」—— 每次量到的都是对方存在时的版面。
// 所以修法是让插入不参与布局（absolute overlay），不是事后重算：把 recalc 从 append 分支
// 放回去，S3 立刻红（提示被它自己收掉），S4 也红（听起来对、实际没有提示）。
//
// 本测试钉住「插入不改变任何 item box，因此在不在屏内只由插入前的版面决定」，
// 期望值永远由产品自己的 visibleBounds + hiddenOptionSides 现算。
// S5 是反向自核：同一套桩若把提示做回占用布局（sticky 的旧行为），S3 会重现 OUT-H 的静默裁切。
//   没有这条，S3 可能只是「桩根本挪不动任何东西」的空断言。

function mkEl({ id = '', rect = { left: 0, top: 0, right: 380, bottom: 0 }, overflow = 'auto', parent = null } = {}) {
  const el = {
    id, parentElement: parent, children: [], hidden: false, _rect: rect, _overflowY: overflow,
    _listeners: {}, innerHTML: '', scrollTop: 0, clientLeft: 0, clientTop: 0,
    scrollHeight: Math.round(rect.bottom - rect.top),
    get clientWidth() { return Math.round(this._rect.right - this._rect.left); },
    get clientHeight() { return Math.round(this._rect.bottom - this._rect.top); },
    getBoundingClientRect() { return this._rect; },
    setRect(r) { this._rect = r; this.scrollHeight = Math.round(r.bottom - r.top); },
    addEventListener(t, fn) { (this._listeners[t] ??= []).push(fn); },
    fire(t) { for (const fn of this._listeners[t] ?? []) fn({ type: t }); },
    appendChild(n) { this.children.push(n); n.parentElement = this; return n; },
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this);
      this._removed = true;
    },
    querySelectorAll(sel) {
      if (sel === '[data-overflow-hint]') return this.children.filter(c => c._isHint && !c._removed);
      if (sel === '.route-choice') return this.children.filter(c => c._isItem);
      return [];
    },
    querySelector(sel) {
      const all = this.querySelectorAll(sel);
      if (all[0]) return all[0];
      return { onclick: null, dataset: {}, getAttribute() { return null; }, setAttribute() {} };
    },
    setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
  };
  return el;
}

// 390×844 的实测层级：可见带由 #hand 决定，#choice 在它里面。
// 「插入会挪版面」这件事在这里被如实建模：提示进 #hand 之后，内容整体上移 40px ——
// 正好是实测里那个 1.9px 越界项被抬回带内的同一个方向（差别只在幅度，判据不看幅度）。
function phoneEnv({ settleShift = 40, inFlow = false } = {}) {
  const prev = { gcs: globalThis.getComputedStyle, doc: globalThis.document };
  const hand = mkEl({ id: 'hand', rect: { left: 10, top: 455, right: 380, bottom: 837 }, overflow: 'auto' });
  const choice = mkEl({ id: 'choice', rect: { left: 10, top: 640, right: 380, bottom: 839 }, parent: hand });
  hand.children.push(choice);
  const items = [[682.7, 768.2], [770.2, 838.9]].map(([t, b]) => {
    const it = mkEl({ rect: { left: 10, top: t, right: 380, bottom: b }, parent: choice });
    it._isItem = true; choice.children.push(it); return it;
  });
  // 占布局的提示（旧 sticky 行为）一旦进了 DOM，版面就在同一同步块里换了一种样子。
  // 修好之后提示是 absolute overlay，这个位移**不该**发生；S5 用 inFlow 打开它做反向自核。
  const appendChild = hand.appendChild.bind(hand);
  hand.appendChild = n => {
    appendChild(n);
    if (n._isHint && settleShift && inFlow) {
      hand.setRect({ ...hand._rect, top: hand._rect.top - settleShift });
      choice.setRect({ ...choice._rect, top: choice._rect.top - settleShift, bottom: choice._rect.bottom - settleShift });
      for (const it of items) it.setRect({ ...it._rect, top: it._rect.top - settleShift, bottom: it._rect.bottom - settleShift });
    }
    return n;
  };
  globalThis.getComputedStyle = n => ({ overflowY: n?._overflowY ?? '', overflow: n?._overflowY ?? '',
    position: 'static', display: 'block', visibility: 'visible', opacity: '1',
    transform: 'none', filter: 'none', willChange: 'auto', contain: 'none' });
  globalThis.document = { body: {}, documentElement: {},
    createElement() {
      return { _isHint: true, attrs: {}, textContent: '', className: '', parentElement: null,
        setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
        getBoundingClientRect() { return { top: 0, bottom: 0, height: 0 }; },
        remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this);
          this._removed = true; } };
    } };
  const restore = () => {
    if (prev.gcs === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = prev.gcs;
    if (prev.doc === undefined) delete globalThis.document; else globalThis.document = prev.doc;
  };
  const live = () => [...hand.children, ...choice.children].filter(c => c._isHint && !c._removed);
  // The page's own expectation, computed from the layout AS IT IS NOW.
  const expectNow = () => {
    const b = visibleBounds(choice, undefined, globalThis.document);
    const sides = hiddenOptionSides({ top: b.top, height: b.height }, items.map(x => x.getBoundingClientRect()));
    return { sides, show: sides.above + sides.below > 0 };
  };
  return { hand, choice, items, restore, live, expectNow };
}

test('#3278 S3（牙）：提示插入后不许改变版面，屏上的话必须与插入前的版面一致', () => {
  const env = phoneEnv();          // inFlow=false：提示是 overlay，桩不允许它挪动任何东西
  try {
    const before = env.expectNow();
    const mounted = mountOverflowHint(env.choice);
    assert.equal(env.expectNow().show, before.show,
      '插入提示不许改变可见性判定：这正是 OUT-H key3 的形态（插入后版面“变了”，提示被自己收掉）');
    if (!before.show) {
      // 插入前就已经不越界：屏上什么都不许说。
      assert.deepEqual(env.live(), [], '没有越界项时不许挂提示');
      assert.equal(mounted, null, '不溢出时返回值契约是 null');
    } else {
      assert.equal(env.live().length, 1, '插入前就越界时，提示必须留着');
      assert.equal(env.live()[0].getAttribute('data-overflow-hint'),
        String(before.sides.above + before.sides.below), '数字必须与插入前数出来的一致');
    }
  } finally { env.restore(); }
});

test('#3278 S5（反向自核）：若提示重新占用布局，S3 的形态会重现 OUT-H 的静默裁切', () => {
  // inFlow=true 模拟旧的 sticky 行为：插入会把可见带从上方撑高 40px。
  // 这条不重要“能绿”—— 它证明 S3 的桩真的能重现被测缺陷，否则 S3 可能只是空断言。
  const env = phoneEnv({ inFlow: true });
  try {
    const before = env.expectNow();
    mountOverflowHint(env.choice);
    const after = env.expectNow();
    assert.equal(before.show, true, '前提：插入前确实越界（否则重现不了 OUT-H）');
    assert.equal(after.show, false, '占用布局的提示会把越界项抬回带内——正是缺陷的形状（OUT-H key3）');
    // 不再断言提示被收掉：收掉它需要「插入后再量一次」，而这正是刚被撤掉的那条路径。
    // 本测只负责证明这个桩能把“插入改变可见性”重现出来（40px 位移确实生效）。
  } finally { env.restore(); }
});

test('#3278 S4（不回归）：插入后仍有越界项时，提示照常出现且数字正确', () => {
  // 与既有 4 条断言的场景同构：插入前就真的越界，且插入不改变版面。
  const env = phoneEnv({ settleShift: 0 });
  try {
    const mounted = mountOverflowHint(env.choice);
    const now = env.expectNow();
    assert.equal(now.show, true, '前提：这个桩确实越界（否则本测试没牙）');
    assert.equal(env.live().length, 1, '越界时必须挂提示');
    assert.equal(env.live()[0].getAttribute('data-overflow-hint'), String(now.sides.above + now.sides.below));
    assert.match(env.live()[0].textContent, /在下面/);
    assert.ok(mounted, '真溢出时返回值契约不变（{n, el, host, recalc}）');
  } finally { env.restore(); }
});
