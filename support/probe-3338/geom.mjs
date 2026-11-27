// #3338：买地屏多了三行账之后，390×844 上「买下」「放弃」还点得到吗？
//
// 不是「看起来还行」——量的是：面板不滚（scrollH == clientH）、两个键的中心
// elementFromPoint 命中自己、三行账都在可读带内（在 #choice 的可见矩形里）。
// 与 #3264/#3334/#3335 同一套判定，不另写一套。
//
// 带负对照：把三行账各复制一遍（模拟上一版那种更长的面板），量具必须报红。
// 否则「通过」只说明我没量到东西。
//
// 复跑（干净检出即可，不依赖 .scratch）：
//   node support/probe-3338/geom.mjs
// 输出：support/probe-3338/OUT-geom/geom-buy.json + 截图
import { writeFileSync, mkdirSync } from 'node:fs';
import { findChrome } from '../find-chrome.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const freePort = () => new Promise((ok, bad) => {
  const s = createServer();
  s.unref();
  s.on('error', bad);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
});
const PORT = await freePort(), CDP = await freePort();
const OUT = new URL('.', import.meta.url).pathname + (process.env.OUT_NAME || 'OUT-geom');
mkdirSync(OUT, { recursive: true });
// 与 #3264/#3334/#3335 回执同一颗 Linux Chrome。
// #3391v: shared chrome discovery (support/find-chrome.mjs); no host-private path.
const CHROME = findChrome();
const UD = `/tmp/chrome-3338-${process.pid}`;

// 静态服务器随仓库走（support/probe-3338/serve.mjs，与 3334/3335 同一份实现）。
const server = spawn('node', ['support/probe-3338/serve.mjs', '.', String(PORT)], { stdio: 'ignore' });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=390,844',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${UD}`,
  '--disable-features=Translate,HeadlessModeReporter', 'about:blank',
], { stdio: 'ignore' });

const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const px = n => +n.toFixed(1);
  const rect = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(px); };
  const choice = document.querySelector('#choice');
  const btns = [...choice.querySelectorAll('[data-act="buy"], [data-act="skip"]')];
  const hit = e => {
    const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (!(x > 0 && x < vw && y > 0 && y < vh)) return { hit: false, why: 'center outside viewport' };
    const at = document.elementFromPoint(x, y);
    return { hit: !!(at && e.contains(at)), at: at?.outerHTML?.slice(0, 60) ?? null, x: px(x), y: px(y) };
  };
  const panelRect = choice.getBoundingClientRect();
  const rows = [...choice.querySelectorAll('[data-ledger]')].map(e => {
    const r = e.getBoundingClientRect();
    return { text: e.textContent, rect: rect(e),
      insidePanel: r.top >= panelRect.top - 0.5 && r.bottom <= panelRect.bottom + 0.5,
      onScreen: r.top >= 0 && r.bottom <= vh };
  });
  return {
    vw, vh, panel: rect(choice), heading: choice.querySelector('h3')?.textContent ?? '',
    scrollH: choice.scrollHeight, clientH: choice.clientHeight,
    rows,
    buttons: btns.map(b => ({ tag: b.dataset.act, text: b.textContent.trim(), rect: rect(b), ...hit(b), disabled: b.disabled })),
  };
})()`;

const json = async path => (await fetch(`http://127.0.0.1:${CDP}${path}`, { signal: AbortSignal.timeout(500) })).json();
let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try { const list = (await json('/json/list')).filter(t => t.type === 'page'); page = list.find(t => t.url === 'about:blank') ?? list[0] ?? null; }
  catch { await delay(200); }
}
if (!page) throw Error('no CDP page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map(); let seq = 0;
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) pending.get(m.id)?.(m); });
await new Promise((ok, bad) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', bad, { once: true }); });
const send = (method, params = {}, ms = 15000) => new Promise((ok, bad) => {
  const id = ++seq; const t = setTimeout(() => bad(Error(`timeout ${method}`)), ms);
  pending.set(id, m => { clearTimeout(t); m.error ? bad(Error(JSON.stringify(m.error))) : ok(m.result); });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const load = async url => {
  await send('Page.navigate', { url });
  for (let i = 0; i < 80; i++) {
    if (await ev('!!window.__ready').catch(() => false)) break;
    await delay(150);
  }
  await ev('document.fonts ? document.fonts.ready.then(() => true) : true');
  await delay(400);
};

const report = { cases: [], control: null };
for (const [style, plot] of [['grow', 'big'], ['take', 'big'], ['cross', 'big'], ['grow', 'small']]) {
  await load(`http://127.0.0.1:${PORT}/support/probe-3338/fixture.html?style=${style}&seed=1&plot=${plot}`);
  const ready = await ev('window.__ready');
  const m = await ev(MEASURE);
  report.cases.push({ style, plot, ready, ...m });
  await shot(`buy-${style}-${plot}`);
}

// 负对照：把三行账各复制两遍（面板明显变长），量具必须报红。
await load(`http://127.0.0.1:${PORT}/support/probe-3338/fixture.html?style=grow&seed=1&plot=big`);
await ev(`(() => {
  const choice = document.querySelector('#choice');
  for (const row of [...choice.querySelectorAll('[data-ledger]')]) {
    for (let k = 0; k < 2; k++) choice.insertBefore(row.cloneNode(true), choice.querySelector('[data-act="buy"]'));
  }
  return true; })()`);
await delay(300);
report.control = await ev(MEASURE);

report.verdict = report.cases.map(c => ({
  style: c.style, plot: c.plot,
  rows: c.rows.length,
  noScroll: c.scrollH <= c.clientH,
  rowsInside: c.rows.every(r => r.insidePanel && r.onScreen),
  bothHit: c.buttons.length === 2 && c.buttons.every(b => b.hit && !b.disabled),
}));
const controlCaught = report.control.scrollH > report.control.clientH
  || report.control.buttons.some(b => !b.hit)
  || report.control.rows.some(r => !r.insidePanel || !r.onScreen);
report.controlCaught = controlCaught;
writeFileSync(`${OUT}/geom-buy.json`, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ verdict: report.verdict, controlCaught,
  controlVerdict: { scrolls: report.control.scrollH > report.control.clientH,
    anyButtonMissed: report.control.buttons.some(b => !b.hit),
    anyRowOut: report.control.rows.some(r => !r.insidePanel || !r.onScreen) } }, null, 1));

ws.close(); chrome.kill(); server.kill();
