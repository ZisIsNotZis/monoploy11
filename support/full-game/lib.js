// #3278 instrumentation, injected as one expression with Runtime.evaluate; the body is
// async so the top-level `await import` is legal.
//
// Why a library import works: src/ui/render.js has no top-level side effect (src/main.js
// imports it as './ui/render.js?v=150'), so this binds the SAME module instance the page
// runs and lets the run judge hints with the product's own functions.
//
// What this does NOT do: it never presses a control and never owns game state. Screen kind
// is read off what the renderer PAINTED, because the page keeps its state in a module
// closure with no window handle (src/main.js:45 `let state = null`) and this run must not
// change product bytes to get one. The cost of that choice (a screen whose markup is
// ambiguous reads as 'unknown' and the run fails loudly) is recorded in RESULT-3278.md.
//
// Semantics matched to the product (checked against src/ui/render.js this turn):
//  - a prompt screen replaces the whole panel, but steps/diceValue APPEND to the previous
//    panel (render.js:698), so they are classified before every other attribute;
//  - pending.type 'target' has two faces: kind cell/street/plot paint nothing but
//    cancel-pick in the panel and targets on the board (render.js:707/711); kind player
//    paints data-target buttons (render.js:709);
//  - a hint mounts only on direction (.route-choice, render.js:923), supply (:675) and
//    build ('#choice button', :929-930); no other screen mounts one today;
//  - the product's toggle is `vis(above,below) = sidesShow(above,below) || sidesShow(below,above)`
//    with sidesShow(a,b) = (a>0||b>0) && a===0 (render.js show()), i.e. a hint is up iff
//    every item lies outside on the SAME side; its text then names the other side.
//    Equality is asserted against the same functions, so a page that prints a wrong
//    number cannot also be the page that judges it.
export const LIB = String.raw`(async () => {
  const R = await import('/src/ui/render.js?v=150');
  const px = n => +n.toFixed(1);
  const rect = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(px); };
  const breaksFixed = n => { const s = getComputedStyle(n);
    return s.transform !== 'none' || s.perspective !== 'none' || s.filter !== 'none'
      || /transform|perspective|filter/.test(s.willChange) || /layout|paint|strict|content/.test(s.contain); };
  // The visible band as a player meets it: the window plus every clipping ancestor, with
  // a fixed element leaving the ancestor chain (same rule as render.js:343-381).
  const clip = e => {
    if (!e) return null;
    let l = 0, t = 0, r = innerWidth, b = innerHeight; const chain = [];
    for (let n = e; n; n = n.parentElement) chain.push(n);
    for (const n of chain) { const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility !== 'visible' || +s.opacity === 0) return null; }
    for (let i = 0; i < chain.length; i++) {
      const n = chain[i], s = getComputedStyle(n);
      if (i > 0 && s.display !== 'inline' && s.display !== 'contents') {
        const x = n.getBoundingClientRect();
        const cx = x.left + n.clientLeft, cy = x.top + n.clientTop;
        if (s.overflowX !== 'visible') { l = Math.max(l, cx); r = Math.min(r, cx + n.clientWidth); }
        if (s.overflowY !== 'visible') { t = Math.max(t, cy); b = Math.min(b, cy + n.clientHeight); }
      }
      if (s.position === 'fixed') {
        const at = chain.findIndex((a, j) => j > i && breaksFixed(a));
        if (at < 0) break;
        i = at - 1;
      }
    }
    return l < r && t < b ? {l: px(l), t: px(t), r: px(r), b: px(b)} : null;
  };
  const fit = e => {
    if (!e) return null;
    const q = rect(e), c = clip(e);
    if (!c) return {rect: q, visible: 'none'};
    const ov = [Math.max(q[0], c.l), Math.max(q[1], c.t), Math.min(q[2], c.r), Math.min(q[3], c.b)];
    const full = ov[0] <= q[0] && ov[1] <= q[1] && ov[2] >= q[2] && ov[3] >= q[3];
    return {rect: q, band: c, visible: full ? 'full' : (ov[0] < ov[2] && ov[1] < ov[3] ? 'partial' : 'none')};
  };
  const why = e => {
    if (!e) return 'missing';
    if (e.disabled) return 'disabled';
    const q = rect(e), c = clip(e), x = (q[0] + q[2]) / 2, y = (q[1] + q[3]) / 2;
    if (!c) return 'clipped:none';
    if (!(x > c.l && x < c.r && y > c.t && y < c.b)) return 'clipped:centre-outside';
    if (!(x > 0 && x < innerWidth && y > 0 && y < innerHeight)) return 'off-viewport';
    const at = document.elementFromPoint(x, y);
    return at ? (e.contains(at) ? 'itself' : 'covered-by:' + (at.id || at.className || at.tagName)) : 'covered-by:nothing';
  };
  // Usable = enabled, centre inside every visible clip, centre on screen, and the centre's
  // topmost element is the control itself. 'partial' cannot pass as 可点到.
  const usable = e => why(e) === 'itself';
  const box = e => { if (!e) return null; const r = e.getBoundingClientRect();
    return {rect: rect(e), size: [px(r.width), px(r.height)], fit: fit(e)}; };
  const sc = e => e ? {top: px(e.scrollTop), height: e.scrollHeight, client: e.clientHeight} : null;
  const q = s => document.querySelector(s);
  const choice = q('#choice'), hand = q('#hand'), cards = q('#cards'), dice = q('#dice');
  const ATTR = ['dir','dice-choice','supply','discard','act','big','target','shop','merchant','research','magic','lottery','buy','sell','replay'];
  const dataKey = el => ATTR.find(a => el.hasAttribute('data-' + a)) ?? null;
  const btn = (b, i) => ({i, key: dataKey(b), value: dataKey(b) ? b.getAttribute('data-' + dataKey(b)) : null,
    text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80), disabled: !!b.disabled,
    usable: usable(b), why: why(b), fit: fit(b), rect: rect(b)});
  // What pressing a control would ANSWER, so the driver chooses by kind and never by
  // guessing at game internals. Keys mirror the actions table in src/main.js:265-280.
  const meaning = (el, kind) => {
    if (!el) return null;
    const k = dataKey(el), v = k ? el.getAttribute('data-' + k) : null;
    if (k === 'dir') return {what: 'direction', v};
    if (k === 'dice-choice') return {what: 'diceValue', v: +v};
    if (k === 'supply') return {what: 'supply', v};
    if (k === 'discard') return {what: 'discard', v: +v};
    if (k === 'big') return {what: 'chooseBig', v};
    if (k === 'magic') return {what: 'magic', v};
    if (k === 'lottery') return {what: 'lottery', v: +v};
    if (k === 'buy' || k === 'sell') return {what: 'stock-' + k, v};
    if (k === 'shop' || k === 'merchant' || k === 'research') return {what: 'shop', v: +v};
    if (k === 'target') return {what: 'target/player', v};
    if (k === 'act') return {what: v, v};
    return {what: 'other', v};
  };
  const screenKind = () => {
    if (!choice) return 'loading';
    if (q('#choice table.rank')) return 'results';
    if (choice.hidden) return 'action';
    const has = s => choice.querySelector(s) !== null;
    if (has('[data-dice-choice]') || has('.dice-choice')) return 'diceValue';
    if (has('.supply-options') || has('button[data-supply]')) return 'supply';
    if (has('button[data-act="build"]')) return 'build';
    if (has('button[data-dir]')) return 'direction';
    if (has('button[data-discard], .discard-card')) return 'discard';
    if (has('button[data-act="buy"]')) return 'buy';
    if (has('button[data-big]')) return 'chooseBig';
    if (has('button[data-target]')) return 'target/player';
    const bx = (choice.querySelector('h3')?.textContent ?? '').trim();
    if (has('button[data-act="cancel-pick"]')) return bx === '选择目标' ? 'target/board' : 'mapPick/street';
    if (has('.shop-card')) return 'shop';
    if (has('button[data-magic]')) return 'magic';
    if (has('button[data-lottery]')) return 'lottery';
    if (has('button[data-act="bank-confirm"]')) return 'bank';
    if (has('button[data-act="yes"], button[data-act="no"]')) return 'response';
    if (has('button[data-act="news"]')) return 'news';
    if (has('button[data-act="skip"]')) return 'other/skip';
    return 'unknown';
  };
  const HINT_SPEC = {
    direction: {sel: '.route-choice', label: '方向'},
    supply: {sel: '.supply-options button, button[data-supply=""]', label: '补给选项'},
    build: {sel: '#choice button', label: '选项'},
  };
  const sidesShow = (a, b) => (a > 0 || b > 0) && a === 0;
  // The product's own count, comparator and text writer -- nothing re-implemented that
  // could agree with a page printing a wrong number.
  const hintView = (kind, h) => {
    const spec = HINT_SPEC[kind];
    if (!spec || !choice) return {spec: null, observed: !!h,
      note: h ? 'PRODUCT-MOUNTED-ON-A-KIND-WITH-NO-SPEC' : 'not-a-hint-screen'};
    const items = [...choice.querySelectorAll(spec.sel)];
    if (!items.length) return {spec: spec.sel, label: spec.label, items: 0, observed: !!h,
      note: h ? 'PRODUCT-MOUNTED-WITH-NO-ITEMS' : 'no-items'};
    const b = R.visibleBounds(choice, undefined, document);
    if (!Number.isFinite(b.bottom)) return {spec: spec.sel, items: items.length, boundsFinite: false, observed: !!h};
    const sides = R.hiddenOptionSides({top: b.top, height: b.height}, items.map(x => x.getBoundingClientRect()));
    const expectShow = sidesShow(sides.above, sides.below) || sidesShow(sides.below, sides.above);
    const expectText = expectShow ? R.overflowHintTextSides(sides, spec.label) : '';
    const o = h ? {n: h.getAttribute('data-overflow-hint'), text: h.textContent.trim()} : null;
    // The rects are the claim: when the page and the geometry disagree, the reader needs
    // to see WHERE each option sat relative to the band, not just the two counts. One field
    // items count already said how many; carrying the boxes costs a few hundred bytes and
    // turns "1 of 11 frames disagreed" into a locatable, checkable fact.
    const boxes = items.map(x => { const r = x.getBoundingClientRect();
      const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      return {t: px(r.top), b: px(r.bottom), insidePoint: cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom,
        top: (x.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)}; });
    return {spec: spec.sel, label: spec.label, items: items.length, itemBoxes: boxes,
      band: [px(b.top), px(b.bottom)],
      sides, expectShow, expectText, observed: !!o, got: o,
      // agree = the page said exactly what its own geometry implies, including saying
      // nothing when nothing is hidden on one single side.
      agree: expectShow === !!o && (!o || o.text === expectText),
      // items out on BOTH sides: the page can name only one side, so at least one hidden
      // option is never announced. A blind spot, recorded; not counted as a lie.
      blindSpot: sides.above > 0 && sides.below > 0};
  };
  // Identity without touching the page: a stale hint and a freshly mounted one look
  // identical in a screenshot, but "the old subscription kept it" and "the new mount counted
  // wrong" are different bugs with different fixes. A WeakMap counter is invisible to the DOM.
  const hintSeq = new WeakMap();
  let hintN = 0;
  const hintKey = h => { if (!h) return null;
    if (!hintSeq.has(h)) hintSeq.set(h, ++hintN); return hintSeq.get(h); };
  const measure = () => {
    const kind = screenKind();
    const h = q('[data-overflow-hint]');
    const panel = choice && !choice.hidden ? [...choice.querySelectorAll('button')] : [];
    const panelButtons = panel.map(btn).map((b, i) => ({...b, where: 'panel', ...meaning(panel[i], kind)}));
    // Map targets carry no onclick of their own: the board paints only the allowed ids
    // (render.js plotAllowed / the reachable set), so any painted one answers the prompt.
    const mapButtons = [...document.querySelectorAll('[data-dir-cell],[data-pick-cell],[data-pick-plot]')]
      .map((e, i) => ({i, attr: ['dir-cell','pick-cell','pick-plot'].find(a => e.hasAttribute('data-' + a)),
        id: e.getAttribute('data-dir-cell') || e.getAttribute('data-pick-cell') || e.getAttribute('data-pick-plot'),
        usable: usable(e), why: why(e), fit: fit(e), rect: rect(e),
        what: e.hasAttribute('data-dir-cell') ? 'direction' : 'mapTarget'}));
    const rollEl = dice && !dice.hidden ? dice.querySelector('button[data-roll]') : null;
    const roll = rollEl ? {...btn(rollEl, 0), where: 'dice', what: 'roll'} : null;
    const cardBtns = cards && !cards.hidden
      ? [...cards.querySelectorAll('button[data-card]')].map((e, i) => ({...btn(e, i), where: 'cards', what: 'card', v: i})) : [];
    return {ok: true, kind,
      day: (document.querySelector('#system .pill')?.textContent ?? '').trim(),
      heading: (choice?.querySelector('h3')?.textContent ?? '').trim(),
      choiceHidden: choice ? choice.hidden : null,
      choice: choice ? {scroll: sc(choice), position: getComputedStyle(choice).position,
        maxHeight: getComputedStyle(choice).maxHeight, overflowY: getComputedStyle(choice).overflowY, ...box(choice),
        text: (choice.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 900)} : null,
      hand: hand ? {scroll: sc(hand), overflowY: getComputedStyle(hand).overflowY, ...box(hand)} : null,
      cardsPanel: cards ? {hidden: cards.hidden, scroll: sc(cards),
        overflowY: getComputedStyle(cards).overflowY, ...box(cards)} : null,
      scroll: {x: px(scrollX), y: px(scrollY), docH: document.documentElement.scrollHeight,
        winH: innerHeight, winW: innerWidth},
      panelButtons, mapButtons, roll, cards: cardBtns,
      // The human's turn is the only moment the roll button is enabled (render.js:948
      // canRoll = human turn, not over, no pending); the player card marks the same
      // actor with .cur (render.js:262). Both are read, so "waiting for a person" is
      // witnessed twice instead of inferred from a timer.
      turn: {rollUsable: !!(roll && roll.usable), rollWhy: roll ? roll.why : 'no-roll-button',
        humanCardsShown: cardBtns.length > 0,
        cur: [...document.querySelectorAll('#players .player')].filter(e => e.classList.contains('cur'))
          .map(e => (e.querySelector('b')?.textContent ?? '').trim())},
      // visible: whether a player could actually SEE this hint. #choice hides between screens
      // and resetOverflowHint only sweeps the panel and its direct parent, so a hint mounted
      // on #hand can outlive its screen; counting that as "the product mounted a hint here"
      // would blame the page for a hint nobody can see.
      hint: h ? {n: h.getAttribute('data-overflow-hint'), key: hintKey(h), text: h.textContent.trim(), fit: fit(h),
        visible: (() => { const f = fit(h); return !!(f && f.visible !== 'none'); })(),
        inChoice: !!(choice && choice.contains(h)), inHand: !!(hand && hand.contains(h))} : null,
      hintView: hintView(kind, h),
      table: q('#choice table.rank') ? [...q('#choice table.rank').querySelectorAll('tr')].map(r =>
        ({cells: [...r.querySelectorAll('th,td')].map(c => c.textContent.trim()), fit: fit(r)})) : null,
      resultsGap: kind === 'results' ? ((q('#choice h3')?.nextElementSibling)?.textContent ?? '').trim() : null,
      replay: kind === 'results' ? (() => { const b = q('#choice [data-replay]');
        return b ? {usable: usable(b), why: why(b), fit: fit(b), rect: rect(b)} : null; })() : null,
      // #3337：结算屏最后那句「下局试试」现在是算出来的一句话（src/ui/slice.js nextGameLine）。
      // 它自己也要被量：一句读不到的话等于没说，而它是这一屏唯一「下一局做什么」的入口。
      // #3337：fit() 只说明它落在可读带内，**看不出它是否被别的东西盖住**。
      // 实测（负对照）：把「下句和按钮一起钉底」的修法撤掉，按钮（sticky, z-index:2）
      // 仍会在 734–782 压住这句话（754–792），而 fit 依旧报 full —— 判定恒绿。
      // 所以这里额外要 usable()：中心点 elementFromPoint 命中的必须是它自己。
      // 那句建议读不到就等于没有，这一点不能用几何带位来充数。
      nextGame: kind === 'results' ? (() => { const e = q('#choice [data-next-game]');
        return e ? {text: e.textContent.trim(), fit: fit(e), rect: rect(e),
          usable: usable(e), why: why(e),
          visible: (() => { const f = fit(e); return !!(f && f.visible !== 'none'); })()} : null; })() : null,
      // Seat ownership is fixed by the entry screen: style=grow puts 街角店主 in seat 1 and
      // createSliceConfig makes index 0 the human (src/data/slice.js:50-53). No player card
      // carries a controller field, so that name is the only DOM-side witness; the driver
      // passes it to the results judge rather than pretending the DOM says 'human'.
      players: [...document.querySelectorAll('#players .player')].map(el => ({
        name: (el.querySelector('b')?.textContent ?? '').trim(),
        meta: (el.querySelector('.pmeta')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        current: el.classList.contains('cur')})),
    };
  };
  // A player told «直接点地图上高亮的路面» but who cannot see the road scrolls to it.
  // This does the same, one step at a time, and returns the amount moved so a receipt
  // never reports a scrolled-to control as simply reachable.
  const scrollIntoViewSoft = el => {
    let n = el.parentElement;
    while (n) { const s = getComputedStyle(n);
      if (/auto|scroll/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2) {
        const r = el.getBoundingClientRect(), x = n.getBoundingClientRect();
        const cy = x.top + n.clientTop + n.clientHeight / 2, by = r.top + r.height / 2;
        const want = Math.round(by - cy), before = n.scrollTop;
        n.scrollTop = Math.max(0, Math.min(n.scrollHeight - n.clientHeight, before + want));
        if (n.scrollTop !== before) return {moved: n.scrollTop - before, what: n.id || n.className};
      }
      n = n.parentElement; }
    const r = el.getBoundingClientRect(), beforeY = scrollY;
    const want = Math.round(r.top + r.height / 2 - innerHeight / 2);
    const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    scrollTo(scrollX, Math.max(0, Math.min(maxY, beforeY + want)));
    return {moved: scrollY - beforeY, what: 'page'};
  };
  const reveal = () => {
    const live = [];
    if (choice && !choice.hidden) for (const b of choice.querySelectorAll('button')) if (!b.disabled) live.push({el: b, where: 'panel'});
    if (cards && !cards.hidden) for (const b of cards.querySelectorAll('button[data-card]')) if (!b.disabled) live.push({el: b, where: 'cards'});
    if (dice && !dice.hidden) for (const b of dice.querySelectorAll('button[data-roll]')) if (!b.disabled) live.push({el: b, where: 'dice'});
    for (const e of document.querySelectorAll('[data-dir-cell],[data-pick-cell],[data-pick-plot]')) live.push({el: e, where: 'map'});
    const stuck = live.filter(c => why(c.el) !== 'itself');
    if (!stuck.length) return {moved: 0, why: 'nothing-live-unreachable', live: live.length};
    const c = stuck.find(x => why(x.el) === 'clipped:centre-outside') ?? stuck[0];
    const r = scrollIntoViewSoft(c.el);
    return {...r, where: c.where, reason: why(c.el), live: live.length, stuck: stuck.length,
      of: (c.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)};
  };
  // A hint is appended by the product's own show(); by the time the driver measures, the page
  // has usually settled. So the moment of INSERTION is observed separately: a MutationObserver
  // only watches, never writes, and records what the product wrote plus what the geometry said
  // in the same synchronous turn. That separates two different bugs that look identical in a
  // screenshot: "it was wrong when it appeared and got corrected a frame later" vs "it is
  // still wrong now". No product byte is touched to get this.
  const inserts = [];
  // #3278: OUT-H's insert key 3 was appended AND detached inside one synchronous block
  // (parent:null at callback time) on the same screen that then showed no hint. The
  // append/recalc settle can therefore oscillate: adding the hint changes the very
  // geometry it is about to re-measure. Watching removals separates "never mounted"
  // from "mounted then withdrawn by its own settle".
  const removals = [];
  const mo = new MutationObserver(recs => { for (const r of recs) for (const n of r.removedNodes)
    if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-overflow-hint') && removals.length < 40)
      removals.push({at: Math.round(performance.now()), n: n.getAttribute('data-overflow-hint'),
        text: (n.textContent || '').trim(), key: hintKey(n), kind: screenKind(),
        heading: (q('#choice h3')?.textContent ?? '').trim().slice(0, 60), detached: !n.isConnected});
  for (const r of recs) for (const n of r.addedNodes)
    if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-overflow-hint') && inserts.length < 40) {
      const v = hintView(screenKind(), n);
      const box = fit(n);
      inserts.push({at: Math.round(performance.now()), n: n.getAttribute('data-overflow-hint'),
        text: (n.textContent || '').trim(), key: hintKey(n), kind: screenKind(),
        heading: (q('#choice h3')?.textContent ?? '').trim().slice(0, 60),
        spec: v.spec, sides: v.sides, expectShow: v.expectShow, expectText: v.expectText,
        agreeAtInsert: typeof v.expectShow === 'boolean'
          ? v.expectShow === true && (n.textContent || '').trim() === v.expectText : null,
        parent: n.parentElement ? (n.parentElement.id || n.parentElement.className) : null,
        band: v.band, itemBoxes: v.itemBoxes, fit: box ? {rect: box.rect, visible: box.visible} : null});
    } });
  if (hand) mo.observe(hand, {childList: true, subtree: true});
  window.__s3278_probe = {measure, usable, why, fit, clip, kind: screenKind, hintSpec: HINT_SPEC, reveal,
    inserts: () => inserts.slice(), removals: () => removals.slice()};
  return {ok: true, renderApi: typeof R.visibleBounds === 'function' && typeof R.hiddenOptionSides === 'function'
    && typeof R.overflowHintTextSides === 'function', kind: screenKind()};
})()`;
