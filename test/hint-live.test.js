import test from 'node:test';
import assert from 'node:assert/strict';
import { mountOverflowHint, supplyOverflowText } from '../src/ui/render.js';

// #hint-live：溢出提示必须随**任意一层**裁切容器滚动重算，且不吃点击。
//
// 来源是实测，不是假设（390×844 真 Edge，.scratch/845-hole/four7.json）：
//   bothMax 帧 可见带 605-795，四个选项底边 481/585/689/793 ⇒ 底边越界 0 条，
//   而屏上仍挂着「还有 1 个方向在下面」。因为 recalc 只绑了 #hand（已到顶，
//   不再派发 scroll），真正在滚的是内层 #choice。
// 同一次实测里「向左」的 blockedBy 是 route-more ⇒ 提示自己挡住了它指的项。

function mkEl({ rect, overflow = 'auto', parent = null, id = '', position = 'static' }) {
  const el = {
    id, parentElement: parent, children: [], _rect: rect, _overflowY: overflow, _position: position,
    _listeners: {},
    clientHeight: Math.round(rect.bottom - rect.top),
    getBoundingClientRect() { return this._rect; },
    setRect(r) { this._rect = r; this.clientHeight = Math.round(r.bottom - r.top); },
    querySelectorAll(sel) {
      if (sel === '.route-choice') return this.children.filter(c => c._isItem);
      if (sel.includes('supply')) return this.children.filter(c => c._isItem);
      if (sel === '[data-overflow-hint]') return this.children.filter(c => c._isHint);
      return [];
    },
    appendChild(n) { this.children.push(n); n.parentElement = this; return n; },
    addEventListener(type, fn) { (this._listeners[type] ??= []).push(fn); },
    fire(type) { for (const fn of this._listeners[type] ?? []) fn({ type }); },
    remove() {
      if (!this.parentElement) return;
      const a = this.parentElement.children;
      const i = a.indexOf(this);
      if (i >= 0) a.splice(i, 1);
    },
    hasAttribute() { return false; },
    setAttribute() {}, getAttribute() { return null; },
  };
  return el;
}

// 复现手机实测的层级：#choice（内层，真的在滚）套在 #hand（外层，已到顶）里。
// 外层底边 795，内层底边 879 —— 玩家能看到的底边是 795。
function phoneEnv({ handBottom = 795, choiceBottom = 879, choiceTop = 605 } = {}) {
  const hand = mkEl({ rect: { top: handBottom - 300, bottom: handBottom, height: 300 }, id: 'hand' });
  const choice = mkEl({ rect: { top: choiceTop, bottom: choiceBottom, height: choiceBottom - choiceTop }, parent: hand, id: 'choice' });
  hand.children.push(choice);
  const items = [];
  const addItem = (top, bottom) => {
    const it = mkEl({ rect: { top, bottom, height: bottom - top }, parent: choice });
    it._isItem = true;
    choice.children.push(it);
    items.push(it);
    return it;
  };
  return { hand, choice, items, addItem };
}

function withDom(t, hintSink) {
  const prevGCS = globalThis.getComputedStyle;
  const prevDoc = globalThis.document;
  globalThis.getComputedStyle = node => ({ overflowY: node?._overflowY ?? '', overflow: node?._overflowY ?? '',
    position: node?._position ?? 'static' });
  globalThis.document = {
    body: {}, documentElement: {},
    createElement() {
      const h = {
        _isHint: true, attrs: {}, textContent: '',
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k] ?? null; },
        getBoundingClientRect() { return { top: 0, bottom: 0, height: 0 }; },
        remove() { this._removed = true; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); },
      };
      hintSink.push(h);
      return h;
    },
  };
  t.after(() => {
    if (prevGCS === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = prevGCS;
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
  });
}

// 测试自己数矩形，不调 hiddenOptionCount —— 两个数各自算出，不共用中间量。
const countBelow = (items, bottom) => items.filter(it => it.getBoundingClientRect().bottom > bottom + 1).length;
// 存活判定：withDom 的桩 remove() 不会清 parentElement，只能看容器 children（同 #hint-remount 口径）。
const liveChildren = (a, b) => [...a.children, ...b.children].filter(c => c._isHint);

test('#hint-live P1：滚内层裁切者后，提示数字必须跟着几何走（外层已到顶不派发 scroll）', (t) => {
  const hints = [];
  withDom(t, hints);

  const env = phoneEnv();
  for (const [a, b] of [[692, 794], [796, 898], [900, 1002], [1004, 1106]]) env.addItem(a, b);
  const mounted = mountOverflowHint(env.choice);
  assert.ok(mounted, '真溢出，应该出提示');
  assert.equal(mounted.n, 3, '初始应报 3（底边 898/1002/1106 越过 795）');

  // 滚内层 #choice 到底：实测 bothMax 帧坐标，底边最大 793 < 795 ⇒ 底边越界 0 条。
  const after = [[379, 481], [483, 585], [587, 689], [691, 793]];
  env.items.forEach((it, i) => it.setRect({ top: after[i][0], bottom: after[i][1], height: after[i][1] - after[i][0] }));
  const handBound = (env.hand._listeners.scroll?.length ?? 0) > 0;
  env.choice.fire('scroll');

  // #878 订正：这组坐标是 **实测的 bothMax 帧**，四项底边 481/585/689/793 全部 <= 795，
  //   但前三项顶边也全 < 605（可见带上沿）⇒ 它们被滚到了**上沿外**，不是「几何上 0 条」。
  //   旧断言用 countBelow 把这个事实当成「0 条、提示应当消失」，那是单侧口径，本单改掉。
  //   本条的意图（内层滚动⟹提示跟着几何走）不变：证据从「提示消失」换成「方向翻转」。
  const below = countBelow(env.items, 795);
  const above = env.items.filter(it => it.getBoundingClientRect().top < 605 - 1).length;
  assert.equal(below, 0, '前提：滚完后底边越界确实 0 条');
  assert.equal(above, 3, '前提：三项被推出可见带上沿（实测 bothMax 帧）');
  const hint = hints.at(-1);
  assert.equal(hint._removed, undefined,
    '上沿外还有 3 项，提示不能整个消失（否则上面那三项没有任何提示）');
  assert.match(hint.textContent, /在上面/,
    '内层滚动后提示没跟着几何走：滚动发生在 #choice，recalc 必须绑到每一层裁切者。实际：' + hint.textContent);
  assert.doesNotMatch(hint.textContent, /在下面/, '已无下方项却仍写下面：' + hint.textContent);
  assert.equal(handBound, true, '外层仍应保留监听（不回归）');
});

test('#hint-live P1b：内层滚一半时提示报的是几何真值，不是旧值', (t) => {
  const hints = [];
  withDom(t, hints);
  const env = phoneEnv();
  for (const [a, b] of [[692, 794], [796, 898], [900, 1002], [1004, 1106]]) env.addItem(a, b);
  const mounted = mountOverflowHint(env.choice);
  assert.equal(mounted.n, 3);

  // 实测 handMax 帧：底部 781-883 越 795 ⇒ 1 条
  const mid = [[469, 571], [573, 675], [677, 779], [781, 883]];
  env.items.forEach((it, i) => it.setRect({ top: mid[i][0], bottom: mid[i][1], height: mid[i][1] - mid[i][0] }));
  env.choice.fire('scroll');

  // #878 订正：实测 handMax 帧里，底边越界 1 条，同时前两项顶边 469/573 也 < 605 ⇒ 上沿外 2 条。
  //   旧断言只拿 countBelow 当全部，那是单侧口径。现在两侧都要报，且数字与方向都要对。
  const below = countBelow(env.items, 795);
  const above = env.items.filter(it => it.getBoundingClientRect().top < 605 - 1).length;
  assert.equal(below, 1, '前提：这一帧底边越界正好 1 条');
  assert.equal(above, 2, '前提：这一帧上沿外 2 条');
  const hint = hints.at(-1);
  assert.equal(hint.getAttribute('data-overflow-hint'), String(above + below),
    '提示总数应为 ' + (above + below) + '，实际 ' + hint.getAttribute('data-overflow-hint'));
  assert.match(hint.textContent, /2 个方向在上面/, '缺上面 2：' + hint.textContent);
  assert.match(hint.textContent, /1 个方向在下面/, '缺下面 1：' + hint.textContent);
});

test('#hint-live P2：提示不吃点击（pointer-events:none），否则它挡住自己指的那一项', (t) => {
  const hints = [];
  withDom(t, hints);
  const env = phoneEnv();
  for (const [a, b] of [[692, 794], [796, 898], [900, 1002], [1004, 1106]]) env.addItem(a, b);
  assert.ok(mountOverflowHint(env.choice));
  const style = hints.at(-1).getAttribute('style');
  assert.match(String(style), /pointer-events\s*:\s*none/,
    '提示是 position:sticky 浮在列表底边，不加 pointer-events:none 会盖住它正指的那一项'
    + '（.scratch/845-hole/four5.json 里「向左」的 blockedBy 就是 route-more）');
});

// 反向自核：不溢出的帧不许出提示（防止修法把提示变成常驻噪声）。
// #878 订正：这条的夹具原本是 [500,600] [600,700]，而 phoneEnv 可见带上沿是 605 ⇒
//   第一项（底边 600）**本来就在带外上方**。它当时能绿，只因为旧代码从不数上沿。
//   那正好是本单要修的缺陷所在，所以夹具是错的，不是断言错：换成真的全在带内的几何。
//   「第一项在带外上方」这个情形已由 test/hint-sides.test.js S5 专门覆盖。
test('#hint-live C：不溢出时不出提示', (t) => {
  const hints = [];
  withDom(t, hints);
  const env = phoneEnv();
  for (const [a, b] of [[610, 700], [710, 790]]) env.addItem(a, b);
  assert.equal(mountOverflowHint(env.choice), null);
});

// #3264 加强（不是替换 C）：C 只说「不溢出的挂载帧返回 null」。但正式件曾经比这更糟——
// 挂载帧一旦 n=0，**这一屏在本轮就再也不会有提示**（recalc 只维护已存在的对象）。
// 那条「null 就永不再有」的行为不再是允许的实现，所以这里把断言改强：
// 挂载返 null 之后，只要几何把某一项推到可见带以下（玩家滚回顶部/窄屏 resize 的同一种转移），
// 提示必须**创建**出来，且写对方向。
test('#hint-live C2：挂载帧不溢出（返 null）之后，0→正 的转移必须创建提示', (t) => {
  const hints = [];
  withDom(t, hints);
  const env = phoneEnv();
  const first = env.addItem(610, 700);
  env.addItem(710, 790);
  // 挂载帧：两项都在 605..795 内 ⇒ 契约仍是 null，且屏上一个提示都没有。
  assert.equal(mountOverflowHint(env.choice), null, '挂载帧全在带内时契约仍是 null');
  assert.equal([...env.choice.children, ...env.hand.children].filter(c => c._isHint).length, 0,
    '挂载帧不该在屏上留下提示');

  // 之后的帧：第二项被推到可见带下沿以外（真机里是 29px 滚动/换行造成的同一类转移）。
  first.setRect({ top: 800, bottom: 890, height: 90 });
  env.hand.fire('scroll');

  // 存活判定按 hint-remount.test.js 的口径：看它是否还在容器 children 里。
  // withDom 的桩 remove() 不会清 parentElement，用它判存活会把已摘除的算成活的（那是量具错，不是产品红）。
  const liveIn = () => [...env.choice.children, ...env.hand.children].filter(c => c._isHint);
  const live = liveIn();
  assert.equal(live.length, 1,
    '0→正 的转移必须创建提示；这正是正式件曾经永久缺席的那一屏（实测岔路屏 4 次运行 4 次 null）');
  assert.equal(live[0].getAttribute('data-overflow-hint'), '1', '越界条数应为 1');
  assert.match(live[0].textContent, /还有 1 个方向在下面/, '方向必须写明下面：' + live[0].textContent);

  // 再回到全部可见：提示应被收掉（不与 C 的契约冲突，且不累积）。
  first.setRect({ top: 610, bottom: 700, height: 90 });
  env.hand.fire('scroll');
  assert.equal(liveIn().length, 0, '回到全可见后提示应被收掉');
});

// #3264d：把 `#choice` 提成 position:fixed 之后，屏上那句话成了假话。
// 实测（.scratch/3264-mobile-commit/OUT-9-walk/record-supply.json）：补给屏固定板
// [0,424.5,390,844]、不滚（419/419），4 个选项 533.5..619 / 631..698 / 710..795.6 / 799.6..834
// 全部 fit.visible=full、hit=true，屏上却写「↑ 还有 2 个补给选项在上面」。
// 根因：visibleBounds 沿 parentElement 取所有裁切祖先的交集，把固定板 424.5..844 与
// #hand 的 648..837 取交 ⇒ 可见带被算成 648..837 ⇒ opt0/opt1 的 top 落在带外 ⇒ above=2。
// 但 fixed 元素**脱离**祖先裁切，内容就画在 424.5..844 上。量具必须与 MEASURE_CORE 同口径。
test('#hint-live D：固定板脱离祖先裁切，不得因祖先裁切线误报「上面还有」', (t) => {
  const hints = [];
  withDom(t, hints);
  // 层级同真机：#choice（position:fixed，自己 overflow:auto）在 #hand 里。
  const hand = mkEl({ rect: { top: 648, bottom: 837, height: 189 }, id: 'hand' });
  const choice = mkEl({ rect: { top: 424.5, bottom: 844, height: 419.5 }, parent: hand,
    id: 'choice', position: 'fixed' });
  hand.children.push(choice);
  const add = (top, bottom) => {
    const it = mkEl({ rect: { top, bottom, height: bottom - top }, parent: choice });
    it._isItem = true;
    choice.children.push(it);
    return it;
  };
  // 四个补给选项的真实视口矩形（固定板上，全部落在 424.5..844 之内）。
  for (const [a, b] of [[533.5, 619], [631, 698], [710, 795.6], [799.6, 834]]) add(a, b);

  const mounted = mountOverflowHint(choice, '.supply-options button, button[data-supply=""]', supplyOverflowText);
  const live = [...choice.children, ...hand.children].filter(c => c._isHint);
  if (mounted) {
    assert.equal(mounted.n, 0,
      '四项都在固定板可见范围内 ⇒ 越界数必须是 0；实测真机给的是 2（屏上说假话）。' +
      ' mount=' + JSON.stringify({ n: mounted.n, host: mounted.host?.id }));
  }
  assert.equal(live.length, 0,
    '固定板装得下四项时不该留下任何提示；实测 OUT-9-walk 挂着「↑ 还有 2 个补给选项在上面」');

  // 反向：固定板上真的放不下时，提示仍必须出现且方向正确 —— 修法不能把提示弄哑。
  // 单独一层环境，避免复用上面四个选项的矩形而把计数算错（那会变成 below=3 的假红）。
  const hand2 = mkEl({ rect: { top: 600, bottom: 837, height: 237 }, id: 'hand' });
  const choice2 = mkEl({ rect: { top: 424.5, bottom: 844, height: 419.5 }, parent: hand2,
    id: 'choice', position: 'fixed' });
  hand2.children.push(choice2);
  const mkOpt = (top, bottom) => {
    const it = mkEl({ rect: { top, bottom, height: bottom - top }, parent: choice2 });
    it._isItem = true;
    choice2.children.push(it);
    return it;
  };
  mkOpt(533.5, 619);
  mkOpt(631, 698);
  const cut = mkOpt(850, 920);            // 固定板 424.5..844 ⇒ 这一项在下面
  const after = mountOverflowHint(choice2, '.supply-options button, button[data-supply=""]', supplyOverflowText);
  const live2 = liveChildren(choice2, hand2);
  assert.equal(live2.length, 1, '固定板切掉一项时必须出提示');
  assert.equal(live2[0].getAttribute('data-overflow-hint'), '1');
  assert.match(live2[0].textContent, /还有 1 个补给选项在下面/, '方向必须写下面：' + live2[0].textContent);
  assert.ok(cut && after);
});
