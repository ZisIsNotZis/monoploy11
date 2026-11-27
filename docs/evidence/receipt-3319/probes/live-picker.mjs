// #3319: mount the REAL picker panel in the REAL page at 390x844 and measure it.
// The page's own renderer paints it; only the game state is supplied (the page keeps
// state in a closure with no window handle). Nothing here is a product change.
import {writeFileSync} from 'node:fs';
const CDP = Number(process.env.CDP_PORT);
const HTTP = Number(process.env.HTTP_PORT);
const OUTD = process.env.OUT_DIR;
const VW = 390, VH = 844;
const save = (n, v) => writeFileSync(`${OUTD}/${n}.json`, JSON.stringify(v, null, 2) + '\n', {flag: 'wx'});

const r = await fetch(`http://127.0.0.1:${CDP}/json/list`);
const page = (await r.json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map(); let seq = 0; const errors = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)?.(m);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text ?? 'exception'); });
await new Promise((ok, bad) => { ws.addEventListener('open', ok, {once: true}); ws.addEventListener('error', bad, {once: true}); });
const send = (method, params = {}) => new Promise((ok, bad) => {
  const id = ++seq; pending.set(id, m => { pending.delete(id); m.error ? bad(Error(JSON.stringify(m.error))) : ok(m.result); });
  ws.send(JSON.stringify({id, method, params})); });
const ev = async expr => {
  const res = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
  if (res.exceptionDetails) throw Error(JSON.stringify(res.exceptionDetails).slice(0, 600));
  return res.result.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {width: VW, height: VH, deviceScaleFactor: 1, mobile: false});
await send('Page.navigate', {url: `http://127.0.0.1:${HTTP}/index.html?slice=1&style=grow&seed=1`});
await new Promise(ok => setTimeout(ok, 2500));

// 1. Start the real game through the real entry button, then reach a 旺季 supply pick.
const started = await ev(`(async () => {
  const radio = document.querySelector('[name="sliceStyle"][value="grow"]');
  if (radio) radio.checked = true;
  document.querySelector('#startSlice').click();
  await new Promise(r => setTimeout(r, 1200));
  return {sliceMode: document.body.classList.contains('slice-mode'),
    hasBoard: !!document.querySelector('#board svg, #board > *')};
})()`);

// 2. Build a state that is at the picker, using the SHIPPED modules, and paint it with
//    the SHIPPED renderer into the SHIPPED page. This is the same paint path a player sees;
//    what is supplied by hand is only "which day/board", exactly like a saved game.
const measured = await ev(`(async () => {
  const {createSliceConfig} = await import('/src/data/slice.js');
  const {startSession} = await import('/src/engine/flow.js');
  const {render} = await import('/src/ui/render.js?v=150');
  const state = startSession(createSliceConfig({seed: 1, style: 'grow'}));
  const human = state.players.find(p => p.controller === 'human');
  // Put the human into the D4 situation the receipt recorded: two own shops in 旺季,
  // two opponent streets with rent, one mixed street.
  const day4 = {mine: [['3,1','4,1']], opp: [['8,1','9,1'],['3,9','4,9']]};
  for (const [ids] of [day4.mine]) for (const id of ids) { state.properties[id].level = 2; state.properties[id].inflate = 2; }
  state.day = 4;
  state.pending = {type: 'target', kind: 'street', cardId: 'inflate'};
  state.mapPick = {plot: true, value: 'street', cardId: 'inflate', playerId: human.id};
  const root = {system: document.querySelector('#system'), players: document.querySelector('#players'),
    board: document.querySelector('#board'), log: document.querySelector('#log'),
    insight: document.querySelector('#insight'), dice: document.querySelector('#dice'),
    cards: document.querySelector('#cards'), hand: document.querySelector('#hand'),
    choice: document.querySelector('#choice')};
  const noop = () => {};
  const actions = new Proxy({}, {get: () => noop});
  render(root, state, actions);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const choice = document.querySelector('#choice');
  const hand = document.querySelector('#hand');
  const box = e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(n => +n.toFixed(1)); };
  const items = [...choice.querySelectorAll('li')].map(li => ({text: li.textContent, rect: box(li),
    h: +li.getBoundingClientRect().height.toFixed(1), scrollH: li.scrollHeight, clientH: li.clientHeight}));
  const cancel = choice.querySelector('[data-act="cancel-pick"]');
  const hint = choice.querySelector('p.hint');
  return {sliceMode: document.body.classList.contains('slice-mode'),
    choiceText: choice.textContent.replace(/\\s+/g, ' ').trim(),
    hintText: hint ? hint.textContent.replace(/\\s+/g, ' ').trim() : null,
    hintRect: hint ? box(hint) : null,
    items, cancelBox: cancel ? box(cancel) : null,
    cancelUsable: (() => { if (!cancel) return null; const b = cancel.getBoundingClientRect();
      const t = document.elementFromPoint((b.left + b.right)/2, (b.top + b.bottom)/2);
      return t ? (cancel.contains(t) || t === cancel ? 'itself' : 'covered-by:' + (t.id || t.className)) : 'nothing'; })(),
    choiceBox: box(choice), choiceScroll: [choice.scrollHeight, choice.clientHeight],
    handBox: box(hand), docH: document.documentElement.scrollHeight, winH: innerHeight,
    styleWidth: hand.getBoundingClientRect().width};
})()`);

save('picker-live', {started, measured, runtimeErrors: errors});
console.log(JSON.stringify({started, hintText: measured?.hintText, items: measured?.items?.map(i => i.text),
  cancelUsable: measured?.cancelUsable, docH: measured?.docH, winH: measured?.winH,
  errors}, null, 1));
ws.close();
