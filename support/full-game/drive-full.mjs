// #3278: play one full game to the results screen with real mouse input, at a viewport
// given by VIEWPORT_W/VIEWPORT_H (default 390x844 -- the size the PREREG and the receipts use).
//
// Discipline carried over from #3264's driver (same CDP boilerplate, same "prove it"):
//   * every press is a CDP Input.dispatchMouseEvent at the control's centre, and only
//     when that centre's elementFromPoint is the control itself (probe.usable);
//   * each screen's FIRST frame is measured before anything is pressed, so F2 ("a
//     continue path is reachable at mount") is answered by geometry, not by luck;
//   * the driver scrolls only to keep play alive, and every scroll is recorded with the
//     amount, so "reachable after scrolling" never gets reported as "reachable";
//   * the screen kind is read from the painted DOM (lib.js), never from game state, and
//     an unknown kind fails the run loudly instead of being pressed blind;
//   * the policy is fixed and written down (PREREG-3278.md) so the same run replays.
//
// Nothing here decides OUT or labels; the wrapper (run-full.py) owns those.
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {LIB} from './lib.js';
import {FIT} from './fit.js';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = process.env.OUT_DIR;
const LABEL = process.env.LABEL || 'run';
const CDP = Number(process.env.CDP_PORT || 19529);
const HTTP = Number(process.env.HTTP_PORT || 8041);
// #3319b: the entry is a parameter for the same reason the viewport is. The default pair
// (grow/seed 1) is kept so every earlier receipt stays reproducible; a run that needs to
// exercise the street picker asks for a starter that reaches it (cross/seed 2 does on day 1).
const ENTRY_STYLE = process.env.ENTRY_STYLE || 'grow';
// Number(): the env var arrives as a string, and '2' + 1 is '21' — which made the
// replay expectation ('seed + 1') unreachable while looking like a product defect.
const ENTRY_SEED = Number(process.env.ENTRY_SEED || 1);
// #3342：新增的入口参数（如 cross=1）必须**真的被打开**才算验过。
// 写死 URL 时，「新入口能玩」只能靠嘴说 —— 这一跑就是那样：整局 PASS，但它开的是老入口。
const ENTRY_EXTRA = process.env.ENTRY_EXTRA || '';
const ENTRY = `http://127.0.0.1:${HTTP}/index.html?slice=1&style=${ENTRY_STYLE}&seed=${ENTRY_SEED}${ENTRY_EXTRA}`;
// The human seat's name is whatever the chosen starter hands to participant #0.
const HUMAN = ({grow: '街角店主', take: '机会买家', cross: '穿街高手'})[ENTRY_STYLE];
if (!HUMAN) throw Error(`UNKNOWN-ENTRY-STYLE ${ENTRY_STYLE}`);
// The viewport is a parameter, not a constant: a narrower screen is the claim most likely
// to break (a control that only fits at 390 would fail at 360), so it must be runnable
// without editing this file. Defaults keep every existing receipt reproducible.
const VW = Number(process.env.VIEWPORT_W || 390);
const VH = Number(process.env.VIEWPORT_H || 844);
if (!(VW > 200 && VH > 300)) throw Error(`VIEWPORT-INSANE ${VW}x${VH}`);
// The first 390x844 attempt died at MAX_FRAMES=1200 with no evidence on disk. A cap is a
// legitimate stop, but a cap must also say WHICH screen was on top when it fired, so the
// numbers below exist to separate "the game stalled" from "the driver missed a step".
const MAX_FRAMES = 3000;
const GAME_MS = 420000;
const STALL_MS = 30000;            // same screen, no press, no day change for this long
const WAIT_MS = 120;

const save = (name, value, flag = 'wx') =>
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(value, null, 2) + '\n', {flag});
const line = (...a) => console.log(a.join(' '));

// ---- CDP plumbing -------------------------------------------------------------
let SOCKET = null;
const checked = (expr, label) => {
  try { new Function('HUMAN', `return ${expr}`); return expr; }
  catch (e) { throw Error(`EXPR-BAD ${label}: ${e.message}`); }
};

async function connect() {
  const until0 = async (sample, ms, pause = 80) => {
    const end = performance.now() + ms;
    do { const x = await sample(); if (x) return x; if (performance.now() < end) await delay(pause); } while (performance.now() < end);
    return null;
  };
  const page = await until0(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP}/json/list`, {signal: AbortSignal.timeout(400)});
      const list = (await r.json()).filter(t => t.type === 'page');
      return list.length === 1 && list[0].url === 'about:blank' ? list[0] : null;
    } catch { return null; }
  }, 20000);
  if (!page) throw Error('NO-OWNED-ABOUT-BLANK');
  // Only a loopback CDP endpoint is acceptable: this host may run other browsers.
  const wsUrl = new URL(page.webSocketDebuggerUrl);
  if (!(wsUrl.protocol === 'ws:' && wsUrl.hostname === '127.0.0.1' && wsUrl.port === String(CDP))) throw Error('WRONG-CDP-ORIGIN');
  const ws = new WebSocket(wsUrl); SOCKET = ws;
  const pending = new Map(); let seq = 0; const runtimeErrors = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data);
    if (m.id) pending.get(m.id)?.(m);
    if (m.method === 'Runtime.exceptionThrown') runtimeErrors.push(m.params.exceptionDetails?.text ?? 'exception');
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      runtimeErrors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200)); });
  await new Promise((ok, bad) => {
    const t = setTimeout(() => bad(Error('CDP open timeout')), 5000);
    ws.addEventListener('open', () => { clearTimeout(t); ok(); }, {once: true});
    ws.addEventListener('error', () => { clearTimeout(t); bad(Error('CDP open failed')); }, {once: true}); });
  const send = (method, params = {}, ms = 8000) => new Promise((ok, bad) => {
    const id = ++seq, t = setTimeout(() => { pending.delete(id); bad(Error(`CDP timeout: ${method}`)); }, ms);
    pending.set(id, m => { clearTimeout(t); pending.delete(id);
      m.error ? bad(Error(`${method}: ${JSON.stringify(m.error)}`)) : ok(m.result); });
    ws.send(JSON.stringify({id, method, params})); });
  const ev = (expression, label = 'expr') =>
    send('Runtime.evaluate', {expression: checked(expression, label), returnByValue: true, awaitPromise: true})
    .then(r => { if (r.exceptionDetails) throw Error(`probe(${label}): ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
      return r.result.value; });
  const press = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', {type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1}); };
  const png = async name => {
    const r = await send('Page.captureScreenshot', {format: 'png', fromSurface: true, captureBeyondViewport: false}, 10000);
    const data = Buffer.from(r.data, 'base64');
    if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('NOT-PNG');
    const w = data.readUInt32BE(16), h = data.readUInt32BE(20);
    // A screenshot that is not the requested viewport means the emulation did not apply,
    // and every geometry number in the receipt would describe the wrong screen.
    if (w !== VW || h !== VH) throw Error(`WRONG-PNG-SIZE ${w}x${h} want ${VW}x${VH}`);
    writeFileSync(`${OUT}/${name}.png`, data, {flag: 'wx'});
    return {bytes: data.length, size: [w, h], sha256: createHash('sha256').update(data).digest('hex')}; };
  return {send, ev, press, png, runtimeErrors, close: () => ws.close()};
}

// ---- what the page measures ---------------------------------------------------
const installLib = async ev => {
  const r = await ev(LIB, 'lib');
  if (!r?.ok || !r.renderApi) throw Error('LIB-NOT-INSTALLED: ' + JSON.stringify(r));
  return r;
};
const measure = ev => ev(`window.__s3278_probe.measure()`, 'measure');
// Press a control named by (where, index) from the last measurement. Returns the coordinates
// actually used and the measurement taken immediately before, so a receipt can be replayed.
const pressControl = async (page, c, tag) => {
  const {ev, press} = page;
  const sel = c.where === 'panel' ? ['#choice button', c.i] : c.where === 'dice' ? ['#dice [data-roll]', 0]
    : c.where === 'cards' ? ['#cards button[data-card]', c.i]
    : c.attr ? [`[data-${c.attr}]`, c.i] : null;
  if (!sel) throw Error(`NO-SELECTOR for ${JSON.stringify(c)}`);
  // `seen` is the receipt for a question the coordinates cannot answer: were the 20 presses
  // at one stale heading twenty real turns, or one screen pressed over and over? The day pill
  // and the log tail both advance on every accepted turn, so a run of presses that never
  // changes them is the same turn being re-read, not twenty turns that look alike.
  const probe = await ev(`(() => { const b = document.querySelectorAll(${JSON.stringify(sel[0])})[${sel[1]}];
    if (!b) return {missing: true};
    const r = b.getBoundingClientRect();
    const roll = document.querySelector('#dice [data-roll]');
    const choice = document.querySelector('#choice');
    return {x: r.left + r.width / 2, y: r.top + r.height / 2,
      phys: document.querySelectorAll(${JSON.stringify(sel[0])}).length,
      seen: {day: (document.querySelector('#system .pill')?.textContent ?? '').trim(),
        logTail: (document.querySelector('#log')?.textContent ?? '').trim().slice(-46),
        rollDisabled: roll ? !!roll.disabled : null,
        choiceHidden: choice ? !!choice.hidden : null,
        logLen: (document.querySelector('#log')?.textContent ?? '').length},
      // hit and bubble answer a question the coordinates cannot: did this tap land on the
      // button, or was something covering it at press time? A speech bubble is position:fixed
      // and its own click handler swallows the event (speech.js onSkip), so "an enabled button
      // that ignores twenty taps has two very different causes -- the tool pressing while the
      // screen was still settling, or the product dropping answers. Read-only; no timing change.
      hit: (() => { const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return t ? (b.contains(t) || t === b ? 'itself' : 'covered-by:' + (t.id || t.className || t.tagName)) : 'nothing'; })(),
      bubble: (() => { const s = document.querySelector('.speech-bubble');
        return s ? (s.querySelector('.speech-text')?.textContent ?? '').trim().slice(0, 40) : null; })()};
    })()`, 'press-target');
  if (probe.missing) throw Error(`TARGET-VANISHED ${sel[0]}[${sel[1]}] (${tag})`);
  if (!(probe.x > 0 && probe.x < VW && probe.y > 0 && probe.y < VH)) throw Error(`OFF-VIEWPORT ${tag}`);
  await press(probe.x, probe.y);
  // `after` is the receipt for the one question the press cannot answer by itself:
  // was the click TAKEN? The product's own rule is "a control is enabled iff an answer
  // can be accepted", so if the same control is still enabled ~150ms later, the click
  // was accepted and the screen has not been repainted yet (or the product dropped it).
  // Either way this is a fact about the screen, not a guess from the next frame.
  // answer() repaints synchronously inside the click handler, so a short wait is enough;
  // keeping it short also keeps the driver's pacing close to the runs it is compared with.
  await delay(80);
  const after = await ev(`(() => { const b = document.querySelectorAll(${JSON.stringify(sel[0])})[${sel[1]}];
    const roll = document.querySelector('#dice [data-roll]');
    const choice = document.querySelector('#choice');
    const cardsEl = document.querySelector('#cards');
    return {stillEnabled: b ? !b.disabled : null,
      rollDisabled: roll ? !!roll.disabled : null,
      logLen: (document.querySelector('#log')?.textContent ?? '').length,
      day: (document.querySelector('#system .pill')?.textContent ?? '').trim(),
      // #3319b：取消这类键的销账方式不是「变灰」，而是**这一屏没了**。
      // 所以除了 stillEnabled，还要记「面板是否已隐藏 + 手牌是否回来」，
      // F7 用这两项判断点击真被接住，而不是只看按键自己的 disabled 属性。
      panelHidden: choice ? !!choice.hidden : null,
      cardsVisible: cardsEl ? !cardsEl.hidden : null,
      bubble: (() => { const s = document.querySelector('.speech-bubble');
        return s ? (s.querySelector('.speech-text')?.textContent ?? '').trim().slice(0, 40) : null; })()};
    })()`, 'press-after').catch(() => null);
  return {tag, x: +probe.x.toFixed(1), y: +probe.y.toFixed(1), selector: sel[0], index: sel[1],
    siblings: probe.phys, seen: probe.seen, hit: probe.hit, bubble: probe.bubble, after};
};

// The fixed policy (PREREG-3278.md §做法). The policy sees only lib.js's field names, and
// returns null when it has nothing to say -- the caller then waits rather than pressing.
const MIN_STEPS = 3;
const choose = (m, st) => {
  const ok = el => el && el.usable;
  if (m.kind === 'action') {
    // The roll button is enabled exactly when it is this player's own action turn
    // (render.js:943 canRoll = phase action && no pending && controller !== 'ai'), and
    // hand cards are enabled only under that same condition (:951). So "whose turn" needs
    // no witness of its own, and 'nothing usable' is the AI's turn: wait, don't press.
    const card = (m.cards ?? []).find(c => c.usable);
    if (card) return {...card, where: 'cards'};
    return m.roll && m.roll.usable ? {...m.roll, where: 'dice'} : null;
  }
  if (m.kind === 'unknown') return null;            // fail loudly, never press blind
  if (m.kind === 'results') return null;
  if (m.kind === 'direction') {
    const a = m.panelButtons.filter(b => b.what === 'direction' && ok(b));
    const b = m.mapButtons.filter(x => x.what === 'direction' && ok(x));
    return (a[0] ? {...a[0], where: 'panel'} : (b[0] ? {...b[0], where: 'map'} : null));
  }
  if (m.kind === 'diceValue') {
    const list = m.panelButtons.filter(b => b.what === 'diceValue' && ok(b)).sort((x, y) => x.v - y.v);
    const want = list.find(b => b.v >= MIN_STEPS && b.v <= 6) ?? list[0] ?? null;
    return want ? {...want, where: 'panel'} : null;
  }
  if (m.kind === 'supply' || m.kind === 'discard' || m.kind === 'chooseBig' || m.kind === 'magic'
      || m.kind === 'shop') {
    const list = m.panelButtons.filter(b => ok(b) && b.what !== 'act' && b.what !== 'other');
    return list[0] ? {...list[0], where: 'panel'} : null;
  }
  if (m.kind === 'buy') {
    // Buy the first time, decline afterwards: both buttons must be read and pressed.
    const buy = m.panelButtons.find(b => b.what === 'buy' && ok(b));
    const skip = m.panelButtons.find(b => b.what === 'skip' && ok(b));
    // st.buys counts only presses that really happened, so a run that never got to 买下
    // cannot be reported as having bought (the first run did exactly that).
    if (st.buys === 0 && buy) { st.buys++; return {...buy, where: 'panel'}; }
    if (st.buys === 0 && !st.buyFirstUnusable) st.buyFirstUnusable = {
      heading: m.heading, buy: m.panelButtons.find(b => b.what === 'buy') ?? null,
      buyUsable: !!buy, skipUsable: !!skip, scroll: m.choice?.scroll ?? null};
    if (!skip) return null;
    st.buys++;
    return {...skip, where: 'panel'};
  }
  if (m.kind === 'build') {
    const c = m.panelButtons.find(b => b.what === 'build' && ok(b));
    const s = m.panelButtons.find(b => b.what === 'skip' && ok(b));
    return c ? {...c, where: 'panel'} : (s ? {...s, where: 'panel'} : null);
  }
  if (m.kind === 'target/player') {
    const list = m.panelButtons.filter(b => b.what === 'target/player' && ok(b));
    return list[0] ? {...list[0], where: 'panel'} : null;
  }
  if (m.kind === 'mapPick/street') {
    // #3319b：选街屏的「取消」必须真的点得到、真的关屏。
    // 每个选街屏只先取消一次（st.streetCancels 计数），之后照常选街。
    // 取消只回到动作屏：手牌与骰子都还在，不改变游戏进程。
    // 判据 F7 只认两件结果事实：按下时中心命中自己、按下后屏关且手牌回来。
    const cancel = m.panelButtons.find(b => b.what === 'cancel-pick');
    st.streetCancels = st.streetCancels ?? 0;
    if (cancel && st.streetCancels < 1) {
      st.streetCancels += 1;
      return {...cancel, where: 'panel', tag: 'street:cancel-pick'};
    }
    const list = m.mapButtons.filter(x => ok(x));
    return list[0] ? {...list[0], where: 'map'} : null;
  }
  if (m.kind === 'target/board') {
    const list = m.mapButtons.filter(x => ok(x));
    return list[0] ? {...list[0], where: 'map'} : null;
  }
  if (m.kind === 'lottery') {
    const g = m.panelButtons.find(b => b.what === 'lottery' && ok(b));
    const leave = m.panelButtons.find(b => b.what === 'leave' && ok(b));
    return g ? {...g, where: 'panel'} : (leave ? {...leave, where: 'panel'} : null);
  }
  if (m.kind === 'bank') {
    const c = m.panelButtons.find(b => b.what === 'bank-confirm' && ok(b));
    const l = m.panelButtons.find(b => b.what === 'leave' && ok(b));
    return c ? {...c, where: 'panel'} : (l ? {...l, where: 'panel'} : null);
  }
  if (m.kind === 'response') {
    const no = m.panelButtons.find(b => b.what === 'no' && ok(b));
    const yes = m.panelButtons.find(b => b.what === 'yes' && ok(b));
    return no ? {...no, where: 'panel'} : (yes ? {...yes, where: 'panel'} : null);
  }
  // news / other/skip: continue by degree, no choice at all.
  const cont = m.panelButtons.find(b => ok(b) && (b.what === 'news' || b.what === 'skip' || b.what === 'leave'));
  return cont ? {...cont, where: 'panel'} : null;
};

// ---- the game loop ------------------------------------------------------------
// One iteration = one first-frame measurement + at most one press. Every screen's FIRST
// frame is recorded before pressing, so "was the continue path reachable at mount" is
// answered for every screen the run meets. When nothing is usable the iteration waits and
// re-measures (an AI turn or an animation), which is what a player does.
async function main() {
  const page = await connect();
  const {send, ev, png, runtimeErrors} = page;
  await send('Page.enable'); await send('Runtime.enable');
  // Mobile metrics at the requested size, independent of the window chrome the wrapper
  // passed on the command line.
  await send('Emulation.setDeviceMetricsOverride', {width: VW, height: VH, deviceScaleFactor: 1, mobile: true});
  line(`viewport ${VW}x${VH}`);
  const nav = await send('Page.navigate', {url: ENTRY});
  if (nav.errorText) throw Error(`NAV: ${nav.errorText}`);

  const setup = await (async () => {
    const end = performance.now() + 20000;
    do {
      const x = await ev(`(() => { if (!document.body.classList.contains('slice-entry')) return null;
        const cta = document.querySelector('#startSlice');
        if (!cta || typeof cta.onclick !== 'function') return null;
        const r = cta.getBoundingClientRect();
        return {shown: !document.querySelector('#setup').hidden,
          style: document.querySelector('[name=sliceStyle]:checked')?.value ?? null,
          x: r.left + r.width / 2, y: r.top + r.height / 2}; })()`);
      if (x) return x;
      await delay(100);
    } while (performance.now() < end);
    return null;
  })();
  if (!setup) throw Error('SLICE-ENTRY-NEVER-READY');
  save('record-0-setup', setup);
  // #3319b: the URL's style= must have preselected the requested starter. This used to
  // compare against the literal 'grow'; with the entry parameterised it must compare
  // against what was asked for, or the check would pass for the wrong reason (or, as it
  // did, refuse a legitimate run).
  if (setup.style !== ENTRY_STYLE) throw Error(`STYLE-NOT-SELECTED: want ${ENTRY_STYLE}, got ${setup.style}`);
  await page.press(setup.x, setup.y);
  const started = await (async () => {
    const end = performance.now() + 8000;
    do { if (await ev(`document.querySelector('#setup').hidden && document.body.classList.contains('slice-mode')`)) return true;
      await delay(100); } while (performance.now() < end);
    return false;
  })();
  if (!started) throw Error('SLICE-NOT-STARTED');
  const lib = await installLib(ev);

  const kinds = {};                 // kind -> {frames, firstFrameUsable, ...}
  const frames = [];                // per-screen first-frame receipts (bounded)
  // A hint that disagrees with the painted geometry is a real finding, so it must outlive the
  // process: OUT-D reported "1 of 11 direction frames" and the frames array died in memory,
  // leaving no way to tell a product bug from a measuring edge. Keep the whole witness.
  const mismatches = [];
  const hintTrace = [];            // every hint-bearing frame, bounded: the life story of one hint
  const presses = [];
  const scrolls = [];
  const st = {buys: 0};
  const t0 = performance.now();
  let last = null, results = null, f = 0;
  // Everything the run knows lives out here, so a failure can still hand the next reader
  // the screen that stopped it -- "the game stalled" and "the driver missed a step" are
  // different bugs and only this evidence tells them apart.
  const evidence = {lastMeasure: null, lastPress: null, lastChangeAt: performance.now(),
    lastSig: null, waits: 0, reveals: []};
  let failure = null;
  try {
  for (; f < MAX_FRAMES; f++) {
    if (performance.now() - t0 > GAME_MS) throw Error(`GAME-OVERTIME after ${f} frames`);
    const m = await measure(ev);
    evidence.lastMeasure = m;
    const sig = `${m.kind}|${m.heading}|${m.day}`;
    const sigBefore = evidence.lastSig;
    if (sig !== evidence.lastSig) { evidence.lastSig = sig; evidence.lastChangeAt = performance.now(); }
    else if (performance.now() - evidence.lastChangeAt > STALL_MS)
      throw Error(`STALLED ${STALL_MS}ms on ${sig}`);
    const isFirst = !last || last.kind !== m.kind || last.heading !== m.heading;
    const rec = kinds[m.kind] ??= {frames: 0, headings: [], firstUsable: null, everUsable: false,
      firstScroll: null, hintFrames: 0, hintAgree: 0, blindSpots: 0, unmountedClaims: 0};
    rec.frames++;
    if (!rec.headings.includes(m.heading)) rec.headings.push(m.heading);
    // F2: the first frame of this screen must already offer a usable continue path.
    const usablePanel = (m.panelButtons ?? []).filter(b => b.usable).length;
    const usableMap = (m.mapButtons ?? []).filter(b => b.usable).length;
    const usableCard = (m.cards ?? []).filter(c => c.usable).length;
    const usableRoll = m.roll && m.roll.usable ? 1 : 0;
    rec.everUsable = rec.everUsable || usablePanel + usableMap + usableCard + usableRoll > 0;
    if (isFirst) {
      rec.firstUsable = {panel: usablePanel, map: usableMap, cards: usableCard, roll: usableRoll};
      rec.firstScroll = m.scroll;
      if (frames.length < 400) frames.push({kind: m.kind, heading: m.heading,
        firstUsable: rec.firstUsable, hint: m.hint, hintView: m.hintView,
        choice: m.choice?.scroll ?? null, choiceFit: m.choice?.fit ?? null,
        panelButtons: (m.panelButtons ?? []).map(b => ({what: b.what, v: b.v, text: b.text,
          usable: b.usable, why: b.why, fit: b.fit?.visible})),
        mapButtons: (m.mapButtons ?? []).map(b => ({what: b.what, id: b.id, usable: b.usable,
          why: b.why, fit: b.fit?.visible})),
        roll: m.roll ? {usable: m.roll.usable, why: m.roll.why, fit: m.roll.fit?.visible} : null,
        cards: (m.cards ?? []).map(c => ({text: c.text, usable: c.usable, why: c.why})),
        turn: m.turn, scroll: m.scroll, players: m.players});
    }
    // F3 is judged on every frame that carries a hint, not only the first (the product
    // re-mounts and rewrites it as things scroll).
    if (m.hintView && m.hintView.spec) {
      rec.hintFrames++;
      if (m.hintView.agree) rec.hintAgree++;
      if (m.hintView.blindSpot) rec.blindSpots++;
      if (hintTrace.length < 240) hintTrace.push({frame: f, kind: m.kind, heading: m.heading,
        key: m.hint?.key ?? null, text: m.hint?.text ?? null, sides: m.hintView.sides,
        expectShow: m.hintView.expectShow, expectText: m.hintView.expectText, agree: m.hintView.agree,
        band: m.hintView.band, itemBoxes: m.hintView.itemBoxes ?? null,
        choiceTop: m.choice?.scroll?.top ?? null, handTop: m.hand?.scroll?.top ?? null,
        pageY: m.scroll?.y ?? null, visible: m.hint?.visible ?? null});
      if (m.hintView.observed && !m.hintView.agree && mismatches.length < 60) mismatches.push({
        frame: f, kind: m.kind, heading: m.heading, day: m.day, isFirst,
        sig, sigBefore, hint: m.hint, hintView: m.hintView,
        choice: m.choice ? {scroll: m.choice.scroll, fit: m.choice.fit, indent: m.choice.indent ?? null} : null,
        lastPress: evidence.lastPress, players: m.players, turn: m.turn});
    } else if (m.hintView?.observed && m.hintView.note?.startsWith('PRODUCT-MOUNTED')) {
      // Only a hint a player can SEE can mislead them. #choice hides between screens and a
      // hint mounted on #hand can outlive its screen (lib.js records inChoice/inHand/visible).
      if (m.hint?.visible) {
        rec.unmountedClaims++;
        // CATCH_STRAY=1 stops at the FIRST visible stray hint and keeps that frame, so
        // "a hint nobody's screen owns is on screen" has a picture plus an element reading
        // behind it before render.js is touched.
        if (process.env.CATCH_STRAY === '1') {
          const stray = {label: LABEL, frame: f, kind: m.kind, heading: m.heading, day: m.day,
            hint: m.hint, hintView: m.hintView, choiceHidden: m.choiceHidden,
            choice: m.choice ? {scroll: m.choice.scroll, rect: m.choice.rect, text: (m.choice.text ?? '').slice(0, 300)} : null,
            hand: m.hand, panelButtons: (m.panelButtons ?? []).length, lastPress: evidence.lastPress};
          save('record-11-stray-hint', stray);
          stray.png = await png('record-11-stray-hint');
          save('record-11-stray-hint', stray, 'w');
          line(`STRAY-HINT kind=${m.kind} heading=${JSON.stringify(m.heading)} n=${m.hint.n} text=${JSON.stringify(m.hint.text)} inChoice=${m.hint.inChoice} inHand=${m.hint.inHand} band=${JSON.stringify(m.hint.fit?.band ?? null)}`);
          page.close();
          process.exit(0);
        }
      }
      else rec.staleHints = (rec.staleHints ?? 0) + 1;
    }
    if (m.kind === 'results') {
      // F4 read at scrollTop 0 BEFORE any driver scrolling; the judge also re-reads it.
      await ev(`(() => { const c = document.querySelector('#choice'); if (c) c.scrollTop = 0;
        window.scrollTo(0, 0); return true; })()`);
      await delay(120);
      const m2 = await measure(ev);
      results = {frame: f, measure: m, judge: await ev(`(async () => { const HUMAN = ${JSON.stringify(HUMAN)};
        return await ${FIT}; })()`, 'fit'), measureAtTop: m2,
        // Read now: 再开一局 navigates away and takes the page's observer records with it.
        hintInserts: await ev(`window.__s3278_probe.inserts()`, 'hint-inserts').catch(e => 'probe:' + String(e.message ?? e).slice(0, 120))};
      save('record-9-results', results);
      const shot = await png('record-9-results');
      results.png = shot;
      // PREREG F4's last clause, which the first run never executed: press 再开一局 and
      // prove where it lands. The judge above already read whether it was usable AT MOUNT;
      // if it was not, a player scrolls, so this scrolls the same way and keeps the amount.
      const probeReplay = () => ev(`(() => { const b = document.querySelector('#choice [data-replay]');
        if (!b) return {missing: true};
        const r = b.getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + r.height / 2,
          usable: window.__s3278_probe.usable(b), why: window.__s3278_probe.why(b)}; })()`, 'replay-target');
      let rp = await probeReplay();
      let replayScroll = 0;
      if (!rp.missing && !rp.usable) {
        const rv = await ev(`window.__s3278_probe.reveal()`, 'reveal');
        replayScroll = Math.abs(rv?.moved ?? 0);
        rp = await probeReplay();
      }
      if (rp.missing) throw Error('REPLAY-MISSING');
      if (!rp.usable) throw Error(`REPLAY-UNREACHABLE ${rp.why}`);
      // Read the starter from THIS document, before the press: the press navigates, and a
      // probe after it would read the new document's URL and call every style "kept".
      // style=grow puts 街角店主 in seat 1 (src/data/slice.js:48-53), so the URL parameter
      // that opened this game is the honest witness of what was played.
      const playedStyle = await ev(`(() => {
        const m = /[?&]style=(grow|take|cross)(&|$)/.exec(location.search);
        return m ? m[1] : null; })()`, 'replay-played-style');
      await page.press(rp.x, rp.y);
      // The press navigates (src/main.js:259 replay() rewrites location), so the probe is
      // gone: this waits on the plain DOM the entry screen paints.
      // What the landing must be, judged on the NEW document: setup visible, the CTA present,
      // the three style radios, seed 2 and URL seed=2. seed!==2 is also the guard that stops
      // the old document (seed 1) from answering before navigation completes.
      const landed = await (async () => {
        const end = performance.now() + 15000;
        do {
          try {
            const x = await ev(`(() => { const setup = document.querySelector('#setup');
              if (!setup || setup.hidden) return null;
              if (!document.querySelector('#startSlice')) return null;
              const seed = document.querySelector('#seed')?.valueAsNumber ?? null;
              if (seed !== ${ENTRY_SEED + 1}) return null;
              const picks = [...document.querySelectorAll('[name=sliceStyle]:checked')].map(r => r.value);
              return {seed, picks, url: location.search, styles: document.querySelectorAll('#sliceStyles input').length,
                // body.slice-entry is what the entry screen sets to collapse the page to
                // the slice intro (src/main.js:466). Reading it here is what lets the F5
                // checks tell "came back to the slice" from "fell back to full setup".
                sliceEntry: document.body.classList.contains('slice-entry'),
                cta: (() => { const c = document.querySelector('#startSlice');
                  if (!c) return null; const r = c.getBoundingClientRect();
                  return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()};
            })()`, 'replay-landed');
            if (x) return x;
          } catch (e) { /* navigation in flight: the old document is gone */ }
          await delay(200);
        } while (performance.now() < end);
        return null;
      })();
      // The probe died with the old document, so it is reinstalled: "pressable at mount" is
      // answered by the same geometry rule as the rest of the run, not by eyeballing a png.
      let ctaUsable = null;
      if (landed) {
        try {
          await installLib(ev);
          ctaUsable = await ev(`(() => { const c = document.querySelector('#startSlice');
            if (!c) return 'missing'; const P = window.__s3278_probe;
            return P.usable(c) ? 'itself' : P.why(c); })()`, 'replay-cta');
        } catch (e) { ctaUsable = 'probe:' + String(e.message ?? e).slice(0, 120); }
      }
      results.replay = {at: rp, scroll: replayScroll, landed, ctaUsable,
        // #3319b: replay is 'seed + 1' relative to whatever this run started on, so the
        // expectation is derived, not the literal 2 that was hardcoded for grow/1.
        checks: {setupShown: !!landed, seedIsNext: landed?.seed === ENTRY_SEED + 1,
          urlSeedIsNext: new RegExp('[?&]seed=' + (ENTRY_SEED + 1) + '(&|$)').test(landed?.url ?? ''), ctaUsable: ctaUsable === 'itself',
          stylesOffered: (landed?.styles ?? 0) === 3,
          // Graded from now on: replay must come back to the slice entry WITH the starter
          // it was played with. Old records have no `sliceEntry` evidence and read as SKIP
          // in report-full.py, not as a pass (same three-state rule as F2/F6).
          sliceEntry: landed?.sliceEntry === true,
          styleKept: playedStyle ? (landed?.picks ?? []).includes(playedStyle) : null},
        observed: {playedStyle,
          sliceEntryAfterReplay: landed?.sliceEntry ?? null,
          stylePreselected: landed?.picks ?? null}};
      save('record-10-replay', results.replay);
      const shotReplay = await png('record-10-replay');
      results.replay.png = shotReplay;
      save('record-9-results', results, 'w');
      break;
    }
    const target = choose(m, st);
    if (!target) {
      if (m.kind === 'unknown') throw Error(`UNKNOWN-SCREEN heading=${JSON.stringify(m.heading)} text=${JSON.stringify((m.choice?.text ?? '').slice(0, 200))}`);
      // Nothing usable yet. Before waiting, do what a player does when the panel is
      // scrollable and the next control is below the fold: scroll to it, and keep the
      // amount so "reachable" is never upgraded to "reachable at mount".
      evidence.waits++;
      const rv = await ev(`window.__s3278_probe.reveal()`, 'reveal');
      if (rv && rv.moved && !evidence.reveals.some(r => r.kind === m.kind && r.heading === m.heading && r.moved === rv.moved && r.down === evidence.reveals.length)) {
        evidence.reveals.push({kind: m.kind, heading: m.heading, at: f, ...rv});
        const m3 = await measure(ev);
        const t2 = choose(m3, st);
        if (t2) {
          evidence.reveals[evidence.reveals.length - 1].thenUsable = true;
          const ev2 = await pressControl(page, t2, `${m3.kind}:${t2.what ?? '?'}:after-scroll`);
          presses.push({...ev2, frame: f, kind: m3.kind, heading: m3.heading, afterScroll: rv.moved,
            before: {scroll: m3.scroll, choice: m3.choice?.scroll ?? null}});
          evidence.lastPress = presses[presses.length - 1];
          last = null;
          await delay(60);
          continue;
        }
      }
      await delay(WAIT_MS);          // AI turn, animation, or a screen with nothing yet
      last = m;
      continue;
    }
    // The press itself: coordinates re-read at press time, and the receipt records what
    // the screen looked like immediately before, so a stuck point can be re-examined.
    let ev1;
    try {
      ev1 = await pressControl(page, target, `${m.kind}:${target.what ?? '?'}`);
    } catch (e) {
      // A target that vanished or moved off-viewport is a stuck point, not a licence to
      // press blind: record it and let the next iteration re-measure.
      scrolls.push({kind: m.kind, heading: m.heading, stuck: e.message, at: f});
      last = m;
      continue;
    }
    presses.push({...ev1, frame: f, kind: m.kind, heading: m.heading,
      before: {scroll: m.scroll, choice: m.choice?.scroll ?? null}});
    evidence.lastPress = presses[presses.length - 1];
    last = null;                     // force the next iteration to re-measure as "first"
    await delay(60);
  }
  } catch (e) { failure = e; }
  if (!results && !failure) failure = Error(`NO-RESULTS after ${f} frames`);
  if (failure) {
    // The receipt a failing run owes the next reader: which screen was up, what the last
    // accepted input was, and how long the screen has been unchanged.
    save('record-8-failure', {label: LABEL, error: String(failure.message ?? failure), frames: f,
      ms: Math.round(performance.now() - t0), staleMs: Math.round(performance.now() - evidence.lastChangeAt),
      waits: evidence.waits, lastPress: evidence.lastPress, reveals: evidence.reveals.slice(0, 40),
      stuckSignature: evidence.lastSig, runtimeErrors: runtimeErrors.slice(0, 20),
      lastMeasure: evidence.lastMeasure, kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) =>
        [k, {...v, headings: v.headings.slice(0, 6)}]))}, 'wx');
    try { await png('record-8-failure'); } catch {}
    const lm = evidence.lastMeasure ?? {};
    line(`FAILED after ${f} frames on kind=${lm.kind} heading=${JSON.stringify(lm.heading)} day=${JSON.stringify(lm.day)} stale=${Math.round(performance.now() - evidence.lastChangeAt)}ms`);
    line(`  usable: panel=${(lm.panelButtons ?? []).filter(b => b.usable).length}/${(lm.panelButtons ?? []).length} map=${(lm.mapButtons ?? []).filter(b => b.usable).length}/${(lm.mapButtons ?? []).length} cards=${(lm.cards ?? []).filter(c => c.usable).length} roll=${lm.roll ? lm.roll.usable : 'none'}`);
    throw failure;
  }
  const errs = runtimeErrors.slice(0, 20);
  // Read, do not recompute: the observer inside the page recorded these as the hints appeared.
  // Taken at results time (drive: results.hintInserts) because 再开一局 replaces the document.
  const hintInserts = results.hintInserts ?? null;

  const summary = {label: LABEL, human: HUMAN, entry: ENTRY, frames: f, ms: Math.round(performance.now() - t0),
    kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, {...v, headings: v.headings.slice(0, 6)}])),
    presses: presses.length, pressLog: presses.slice(0, 60), stuck: scrolls.filter(s => s.stuck).slice(0, 20),
    runtimeErrors: errs, runtimeErrorCount: runtimeErrors.length,
    png: results.png,
    judge: results.judge,
    // Live policy evidence: how many buy screens really got 买下 pressed, and -- if that
    // never happened -- what the first buy screen actually offered at mount.
    buys: st.buys, buyFirstUnusable: st.buyFirstUnusable ?? null,
    // Persist the disagreement itself: which frame, on which screen, with what the product
    // said versus what the operator could see. That is the difference between a defect and
    // a measurement boundary, and it cannot be re-derived after the browser closes.
    mismatchCount: mismatches.length, mismatches, hintTrace,
    // Watched at insertion time by a read-only observer in lib.js: this is the page's own
    // decision statement, captured in the synchronous turn it was made in.
    hintInserts,
    firstFrames: frames.slice(0, 400),
    replay: results.replay ?? null};
  save('record-8-summary', summary);
  line(`FRAMES ${f} in ${summary.ms}ms · presses ${presses.length} · kinds ${Object.keys(kinds).join(',')}`);
  for (const [k, v] of Object.entries(kinds)) line(`  ${k}: frames=${v.frames} firstUsable=${JSON.stringify(v.firstUsable)} hintFrames=${v.hintFrames} hintAgree=${v.hintAgree} blind=${v.blindSpots} unmounted=${v.unmountedClaims}`);
  line(`JUDGE ${JSON.stringify(results.judge.checks)}`);
  line(`GAP "${results.judge.gapLine}" claimed=${results.judge.raw.claimed} expect=${results.judge.raw.expect}`);
  if (errs.length) throw Error('RUNTIME-ERRORS: ' + errs.join(' | '));
  page.close();
}

// `SELFTEST=1 node drive-full.mjs` compiles the browser-side expressions and exits, so a
// syntax error costs seconds instead of a whole Chrome run (wrapper calls this first).
if (process.env.SELFTEST) {
  checked(LIB, 'LIB');
  checked(FIT, 'FIT');
  line('SELFTEST OK: LIB and FIT parse as expressions');
  process.exit(0);
}

main().then(() => process.exit(0), e => {
  line('DRIVER-FAIL: ' + (e?.stack ?? e));
  try { SOCKET?.close(); } catch {}
  process.exit(1);
});
