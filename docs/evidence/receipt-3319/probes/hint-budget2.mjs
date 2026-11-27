// #3319: measure COMPLETE header strings (prefix included) so the budget is real.
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
const CASES = [
  // shipped baseline (control, must stay 1 line)
  '点这条街的地产即可 · 数字是现在每次踩到的租 → 用卡后',
  // A: best > 0
  '数字是现在每次踩到的租 → 用卡后；对你最值 +11,200 · 晨光街',
  // B: best == 0 but some streets cost me
  '数字是现在每次踩到的租 → 用卡后；晨光街 不动账，其余帮对手',
  '数字是现在每次踩到的租 → 用卡后；最好 晨光街 不动账',
  '数字是现在每次踩到的租 → 用卡后；都在帮对手（最好 晨光街）',
  // C: all zero
  '数字是现在每次踩到的租 → 用卡后；全都不动账',
  // D: everything negative
  '数字是现在每次踩到的租 → 用卡后；都在亏，最好 晨光街 -5,600',
  '数字是现在每次踩到的租 → 用卡后；最好也亏 -5,600（晨光街）',
];
for (const [w, h] of [[390, 844], [1280, 800]]) {
  await send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: `http://127.0.0.1:${HTTP}/index.html?slice=1&style=grow&seed=1`});
  await new Promise(ok => setTimeout(ok, 2200));
  const out = await ev(`(async () => {
    const radio = document.querySelector('[name="sliceStyle"][value="grow"]');
    if (radio) radio.checked = true;
    document.querySelector('#startSlice').click();
    await new Promise(r => setTimeout(r, 1000));
    const {createSliceConfig} = await import('/src/data/slice.js');
    const {startSession} = await import('/src/engine/flow.js');
    const {render} = await import('/src/ui/render.js?v=150');
    const root = {system: document.querySelector('#system'), players: document.querySelector('#players'),
      board: document.querySelector('#board'), log: document.querySelector('#log'),
      insight: document.querySelector('#insight'), dice: document.querySelector('#dice'),
      cards: document.querySelector('#cards'), hand: document.querySelector('#hand'),
      choice: document.querySelector('#choice')};
    const actions = new Proxy({}, {get: () => () => {}});
    const usable = e => { if (!e) return 'missing'; const b = e.getBoundingClientRect();
      const t = document.elementFromPoint((b.left+b.right)/2, (b.top+b.bottom)/2);
      return t ? (e.contains(t) || t === e ? 'itself' : 'covered-by:' + (t.id || t.className)) : 'nothing'; };
    const state = startSession(createSliceConfig({seed: 1, style: 'grow'}));
    const human = state.players.find(p => p.controller === 'human');
    for (const id of ['3,1','4,1']) { state.properties[id].level = 2; state.properties[id].inflate = 2; }
    state.day = 4;
    state.pending = {type: 'target', kind: 'street', cardId: 'inflate'};
    state.mapPick = {plot: true, value: 'street', cardId: 'inflate', playerId: human.id};
    render(root, state, actions);
    const choice = document.querySelector('#choice');
    const hint = choice.querySelector('p.hint');
    const cancel = choice.querySelector('[data-act="cancel-pick"]');
    const res = [];
    for (const text of ${JSON.stringify(CASES)}) {
      hint.textContent = text;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const hb = hint.getBoundingClientRect();
      res.push({text, lines: +(hb.height / 19.2).toFixed(2), w: +hb.width.toFixed(1),
        cancel: usable(cancel), scroll: [choice.scrollHeight, choice.clientHeight]});
    }
    return {res, vw: innerWidth, vh: innerHeight};
  })()`);
  console.log('VIEWPORT ' + w + 'x' + h);
  for (const x of out.res) console.log(`  lines=${x.lines.toFixed(2)} cancel=${x.cancel.padEnd(18)} ${x.text}`);
}
ws.close();
