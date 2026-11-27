import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig, SLICE_STYLES } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { render } from '../src/ui/render.js';

// #3278：换屏时，上一屏的溢出提示必须跟着退场。
//
// 实测（390×844 真浏览器，锁 = #3278 的 35 项，OUT-C-stray/record-11-stray-hint）：
//   动作屏底部仍写着「↓ 还有 1 个方向在下面」，而此刻决策板 #choice 是隐藏的、屏上只有
//   「掷骰 · 1–6 步」+ 卡。提示挂在 #hand（最外层裁切祖先），所以 `#choice.hidden = true`
//   并不会隐藏它 —— 玩家被告知往下滚看方向，而屏幕上没有方向可选。
//   截图上那句话正好压在动作屏的最底部（390×844 全屏可见）。
//
// 为什么这条不是「提示说错了方向」而是「提示活过了它的屏」：
//   direction 屏挂的订阅在 #choice ��，recalc 只维护已存在的提示；
//   而 resetOverflowHint 的**【有】**契约就是「换屏就停订阅」。
//   旧代码只在画决策屏时（renderChoice 第一行）调用它，隐藏分支没有 ⇒ 换屏的另一半漏了。
//
// 牙齿：桩 DOM 复刻真机的层级（#choice 在 #hand 里、可见带由 #hand 决定），
// 先让 direction 屏真的挂出提示，再切到动作屏，断言 #hand/#choice 里都不再有 [data-overflow-hint]，
// 且之后滚动不再把它复活（订阅必须一起停）。

function mkEl({ id = '', rect = { top: 0, bottom: 0, height: 0 }, overflow = 'auto', parent = null, position = 'static' } = {}) {
  const el = {
    id, parentElement: parent, children: [], hidden: false, _rect: rect, _overflowY: overflow,
    _position: position, _listeners: {}, innerHTML: '', scrollTop: 0, scrollHeight: 0,
    clientWidth: 1000, clientHeight: Math.round(rect.bottom - rect.top), style: { setProperty() {} },
    classList: { toggle() {} }, dataset: {},
    getBoundingClientRect() { return this._rect; },
    setRect(r) { this._rect = r; this.clientHeight = Math.round(r.bottom - r.top); },
    addEventListener(t, fn) { (this._listeners[t] ??= []).push(fn); },
    fire(t) { for (const fn of this._listeners[t] ?? []) fn({ type: t }); },
    appendChild(n) { this.children.push(n); n.parentElement = this; return n; },
    remove() {
      if (!this.parentElement) { this._removed = true; return; }
      const a = this.parentElement.children, i = a.indexOf(this);
      if (i >= 0) a.splice(i, 1);
      this._removed = true;
    },
    // 渲染器写入 innerHTML 后要用 querySelectorAll 绑定 onclick；桩只认一两个选择器，
    // 够本测试（提示扫描走的是 '[data-overflow-hint]'）。
    querySelectorAll(sel) {
      if (sel === '[data-overflow-hint]') return this.children.filter(c => c._isHint);
      if (sel === '.route-choice') return this.children.filter(c => c._isItem);
      return this.children.filter(c => c._rendered === sel);
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

function phoneEnv(hintSink) {
  const prev = { gcs: globalThis.getComputedStyle, doc: globalThis.document };
  // 390×844 的实测层级：可见带 605..795（#hand 裁），#choice 在它里面且自身也在裁。
  const board = mkEl({ id: 'board', rect: { top: 0, bottom: 480, height: 480 } });
  const hand = mkEl({ id: 'hand', rect: { top: 495, bottom: 795, height: 300 }, overflow: 'auto' });
  const choice = mkEl({ id: 'choice', rect: { top: 605, bottom: 879, height: 274 }, parent: hand });
  hand.children.push(choice);
  // 岔路屏的四条方向：底边越过 795 ⇒ 真溢出，提示会挂出来。
  const items = [[692, 794], [796, 898], [900, 1002], [1004, 1106]].map(([a, b]) => {
    const it = mkEl({ rect: { top: a, bottom: b, height: b - a }, parent: choice });
    it._isItem = true; choice.children.push(it); return it;
  });
  globalThis.getComputedStyle = n => ({
    overflowY: n?._overflowY ?? '', overflow: n?._overflowY ?? '', position: n?._position ?? 'static',
    display: 'block', visibility: 'visible', opacity: '1', transform: 'none', filter: 'none', willChange: 'auto',
  });
  let made = 0;
  globalThis.document = {
    body: {}, documentElement: {},
    createElement() {
      made++;
      const h = { _isHint: true, attrs: {}, textContent: '', className: '', parentElement: null,
        setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
        getBoundingClientRect() { return { top: 0, bottom: 0, height: 0 }; },
        remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); this._removed = true; } };
      hintSink.push(h);
      return h;
    },
  };
  // render() 还会碰这些容器；给最小可用的桩，够它把一帧画完。
  const ui = {
    system: mkEl({ id: 'system' }), players: mkEl({ id: 'players' }), board,
    log: mkEl({ id: 'log', rect: { top: 800, bottom: 844, height: 44 } }),
    insight: mkEl({ id: 'insight' }), dice: mkEl({ id: 'dice', hidden: true }),
    cards: mkEl({ id: 'cards', hidden: true }), hand, choice,
  };
  const restore = () => {
    if (prev.gcs === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = prev.gcs;
    if (prev.doc === undefined) delete globalThis.document; else globalThis.document = prev.doc;
  };
  const live = () => [...hand.children, ...choice.children].filter(c => c._isHint && !c._removed);
  return { ui, hand, choice, items, restore, live, made: () => made };
}

const noop = new Proxy({}, { get: () => () => {} });

// Real fork: day-1 position 4,2 with two reachable neighbours (same fixture as
// test/slice-route-choice.test.js). Fake ids would crash direction() before the hint logic runs.
function directionState() {
  const s = startSession(createSliceConfig({ style: 'grow', seed: 1 }));
  const p = s.players[0];
  p.position = '4,2'; p.lastNode = '3,2'; p.facing = '5,2';
  s.pending = { type: 'direction', player: p, options: ['5,2', '4,3'], remainingSteps: 4 };
  return { s, p, options: s.pending.options };
}

test('#3278 S1（牙）：切到动作屏后，上一屏的溢出提示必须退场', () => {
  const sink = [];
  const env = phoneEnv(sink);
  try {
    const { s, p } = directionState();
    render(env.ui, s, noop);
    assert.equal(env.live().length, 1, '前提：岔路屏在真溢出时必须挂出提示（否则本测试没牙）');
    assert.match(env.live()[0].textContent, /在下面/, '前提：提示此刻指向下面');
    assert.equal(env.live()[0].parentElement, env.hand, '前提：提示挂在 #hand（隐藏 #choice 不会藏住它）');

    // 下一屏：没有 pending ⇒ 动作屏，render() 走隐藏分支。
    s.pending = null;
    s.phase = 'action';
    render(env.ui, s, noop);
    assert.equal(env.choice.hidden, true, '前提：动作屏隐藏决策板');
    assert.deepEqual(env.live(), [],
      '动作屏上还留着上一屏的提示：「' + (env.live()[0]?.textContent ?? '') + '」——它指向不存在的东西');

    // 订阅也要停：滚动不能把它复活。
    env.choice.fire('scroll');
    env.hand.fire('scroll');
    assert.deepEqual(env.live(), [], '提示被上一屏的 recalc 订阅复活了（resetOverflowHint 没停订阅）');
  } finally { env.restore(); }
});

test('#3278 S2（不回归）：同一屏重新画时提示照常维护，且换屏后新屏自己还能挂提示', () => {
  const sink = [];
  const env = phoneEnv(sink);
  try {
    const { s } = directionState();
    render(env.ui, s, noop);
    assert.equal(env.live().length, 1);
    // 同屏重画（不改 pending）：仍应只有一帧提示，不累加。
    render(env.ui, s, noop);
    assert.equal(env.live().length, 1, '同屏重画把提示累加了');

    // 切到动作屏（隐藏分支）再切回岔路屏：新屏必须能重新挂出提示。
    s.pending = null;
    s.phase = 'action';
    render(env.ui, s, noop);
    assert.deepEqual(env.live(), []);
    const again = directionState();
    render(env.ui, again.s, noop);
    assert.equal(env.live().length, 1, '换屏回来之后提示挂不出来了（订阅被停得太狠）');
  } finally { env.restore(); }
});
