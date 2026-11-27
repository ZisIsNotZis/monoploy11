// #3319 A/B: paint the picker twice in the same live page — once with the shipped
// renderer (new), once with the previous wording/order restored in-place (old) — and
// compare geometry. This answers "did my change push 取消 out of reach?" with the same
// page, same CSS, same viewport.
const CDP = Number(process.env.CDP_PORT), HTTP = Number(process.env.HTTP_PORT);
const r = await fetch(`http://127.0.0.1:${CDP}/json/list`);
const page = (await r.json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map(); let seq = 0;
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) pending.get(m.id)?.(m); });
await new Promise(ok => ws.addEventListener('open', ok, {once: true}));
const send = (method, params = {}) => new Promise((ok, bad) => {
  const id = ++seq; pending.set(id, m => { pending.delete(id); m.error ? bad(Error(JSON.stringify(m.error))) : ok(m.result); });
  ws.send(JSON.stringify({id, method, params})); });
const ev = async expr => {
  const res = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
  if (res.exceptionDetails) throw Error(JSON.stringify(res.exceptionDetails).slice(0, 800));
  return res.result.value;
};
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: false});
await send('Page.navigate', {url: `http://127.0.0.1:${HTTP}/index.html?slice=1&style=grow&seed=1`});
await new Promise(ok => setTimeout(ok, 2500));

const out = await ev(`(async () => {
  const radio = document.querySelector('[name="sliceStyle"][value="grow"]');
  if (radio) radio.checked = true;
  document.querySelector('#startSlice').click();
  await new Promise(r => setTimeout(r, 1200));
  const {createSliceConfig} = await import('/src/data/slice.js');
  const {startSession} = await import('/src/engine/flow.js');
  const {render} = await import('/src/ui/render.js?v=150');
  const root = {system: document.querySelector('#system'), players: document.querySelector('#players'),
    board: document.querySelector('#board'), log: document.querySelector('#log'),
    insight: document.querySelector('#insight'), dice: document.querySelector('#dice'),
    cards: document.querySelector('#cards'), hand: document.querySelector('#hand'),
    choice: document.querySelector('#choice')};
  const actions = new Proxy({}, {get: () => () => {}});
  const box = e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(n => +n.toFixed(1)); };
  const usable = e => { if (!e) return 'missing'; const b = e.getBoundingClientRect();
    const t = document.elementFromPoint((b.left+b.right)/2, (b.top+b.bottom)/2);
    return t ? (e.contains(t) || t === e ? 'itself' : 'covered-by:' + (t.id || t.className)) : 'nothing'; };

  const paint = async (state, mode) => {
    render(root, state, actions);
    if (mode === 'old') {
      // Restore the pre-#3319 wording and order *after* the renderer painted, so the
      // geometry question is asked of the same DOM the player would have had.
      const choice = document.querySelector('#choice');
      const hint = choice.querySelector('p.hint');
      if (hint) hint.textContent = '点这条街的地产即可 · 数字是现在每次踩到的租 → 用卡后';
      const ul = choice.querySelector('ul.street-card');
      if (ul) {
        const lis = [...ul.querySelectorAll('li')].map(li => ({li, text: li.textContent}));
        // old key: |opponent change| desc, and "还有 N 条，最高 <租最高的街>"
        lis.sort((a,b) => {
          const n = t => { const m = /对手([\\\\d,]+)→([\\\\d,]+)/.exec(t); return m ? Math.abs(+m[2].replace(/,/g,'') - +m[1].replace(/,/g,'')) : 0; };
          return n(b.text) - n(a.text);
        });
        for (const {li} of lis) ul.appendChild(li);
        const more = ul.querySelector('li:last-child');
        if (more && /还有/.test(more.textContent)) more.textContent = '还有 2 条，最高 晚风街';
      }
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const choice = document.querySelector('#choice');
    const cancel = choice.querySelector('[data-act="cancel-pick"]');
    return {mode,
      choiceText: choice.textContent.replace(/\\s+/g,' ').trim(),
      rows: [...choice.querySelectorAll('li')].map(li => ({t: li.textContent, b: box(li), h: +li.getBoundingClientRect().height.toFixed(1)})),
      choiceBox: box(choice), choiceScroll: [choice.scrollHeight, choice.clientHeight],
      handBox: box(document.querySelector('#hand')),
      cancel: cancel ? {box: box(cancel), usable: usable(cancel)} : null,
      hintLines: (() => { const h = choice.querySelector('p.hint'); return h ? +(h.getBoundingClientRect().height / 19.2).toFixed(2) : null; })()};
  };

  // Same D4 state the receipt recorded (two own shops already in 旺季 ⇒ net 0 available).
  const mk = () => {
    const state = startSession(createSliceConfig({seed: 1, style: 'grow'}));
    const human = state.players.find(p => p.controller === 'human');
    for (const id of ['3,1','4,1']) { state.properties[id].level = 2; state.properties[id].inflate = 2; }
    state.day = 4;
    state.pending = {type: 'target', kind: 'street', cardId: 'inflate'};
    state.mapPick = {plot: true, value: 'street', cardId: 'inflate', playerId: human.id};
    return state;
  };
  const A = await paint(mk(), 'new');
  const B = await paint(mk(), 'old');
  // A second state without an already-inflated own street, to see a positive best.
  const mk2 = () => { const s = mk(); for (const id of ['3,1','4,1']) s.properties[id].inflate = 0; return s; };
  const C = await paint(mk2(), 'new');
  return {new: A, old: B, newClean: C};
})()`);
console.log(JSON.stringify(out, null, 1));
ws.close();
