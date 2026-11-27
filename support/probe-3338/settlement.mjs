// #3338：结算屏那句「下局试试」在 390×844 上读得到吗？而且它跟买地屏说的是同一份账吗？
//
// 两件事分开判：
//  ① 几何：这句话在可读带内（fit === 'full'），且中心点 elementFromPoint 命中它自己。
//     只看 fit 不够 —— #3337 已经证明过按钮能盖住一句话而 fit 仍报 full（句 754–792 / 按钮 734–782）。
//  ② 同源：把买地屏的三行与本屏这一句都取出来，两者提到的常数（局数、均值）必须来自
//     同一个 MARKET_LEDGER。这一条不是比字，是把两屏的字符串与同一份表对齐。
//
// 带负对照：把这句话换成一个更长的句子（模拟旧版把两条建议都塞进去），几何必须报红。
//
// 复跑：node support/probe-3338/settlement.mjs
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
const OUT = new URL('.', import.meta.url).pathname + (process.env.OUT_NAME || 'OUT-settle');
mkdirSync(OUT, { recursive: true });
// #3391v: shared chrome discovery (support/find-chrome.mjs); no host-private path.
const CHROME = findChrome();
const UD = `/tmp/chrome-3338s-${process.pid}`;

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
  const choice = document.querySelector('#choice');
  const line = choice.querySelector('[data-next-game]');
  const replay = choice.querySelector('[data-replay]');
  const hit = e => {
    if (!e) return { hit: false, why: 'missing' };
    const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (!(x > 0 && x < vw && y > 0 && y < vh)) return { hit: false, why: 'center outside viewport' };
    const at = document.elementFromPoint(x, y);
    return { hit: !!(at && (e === at || e.contains(at) || at.contains(e))), x: px(x), y: px(y),
      at: at?.tagName + (at?.dataset ? ':' + Object.keys(at.dataset).join(',') : '') };
  };
  const panel = choice.getBoundingClientRect();
  const lr = line ? line.getBoundingClientRect() : null;
  return {
    vw, vh, heading: choice.querySelector('h3')?.textContent ?? '',
    text: line ? line.textContent : null,
    len: line ? line.textContent.length : 0,
    rect: lr ? [lr.left, lr.top, lr.right, lr.bottom].map(px) : null,
    fullyInside: !!lr && lr.top >= 0 && lr.bottom <= vh && lr.left >= 0 && lr.right <= vw,
    insidePanel: !!lr && lr.top >= panel.top - 0.5 && lr.bottom <= panel.bottom + 0.5,
    lineHit: hit(line), replayHit: hit(replay),
    scrollH: choice.scrollHeight, clientH: choice.clientHeight,
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
  for (let i = 0; i < 100; i++) {
    if (await ev('!!window.__ready').catch(() => false)) break;
    await delay(150);
  }
  await ev('document.fonts ? document.fonts.ready.then(() => true) : true');
  await delay(400);
};

const report = { cases: [], control: null, controlCaught: null };
// 三种结算形状：对手拿走书屋 / 我拿到且满级 / 全程没人买。
for (const setup of ['rival', 'mineMax', 'nobody']) {
  await load(`http://127.0.0.1:${PORT}/support/probe-3338/settle.html?style=grow&seed=1&setup=${setup}`);
  const ready = await ev('window.__ready');
  report.cases.push({ setup, ready, ...(await ev(MEASURE)) });
  await shot(`settle-${setup}`);
}

// 同源核对：买地屏那三行里的常数，必须与结算屏这一句里的常数来自同一份表。
await load(`http://127.0.0.1:${PORT}/support/probe-3338/fixture.html?style=grow&seed=1&plot=big`);
const buyLedger = await ev(`[...document.querySelectorAll('#choice [data-ledger]')].map(e => e.textContent)`);
await load(`http://127.0.0.1:${PORT}/support/probe-3338/settle.html?style=grow&seed=1&setup=rival`);
const settleLine = await ev(`document.querySelector('#choice [data-next-game]')?.textContent ?? ''`);
const table = await ev(`(async () => (await import('/src/engine/market-ledger.js')).MARKET_LEDGER)()`);
const nums = s => (String(s).match(/[\d,]{1,}/g) ?? []).map(x => Number(x.replace(/,/g, '')));
const tableValues = new Set();
(function walk(v) { if (typeof v === 'number') tableValues.add(v);
  else if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(table);
const buyHasTable = nums(buyLedger.join(' ')).filter(v => tableValues.has(v));
const settleHasTable = nums(settleLine).filter(v => tableValues.has(v));
report.sameLedger = {
  buyText: buyLedger, settleLine,
  buyTableValues: buyHasTable, settleTableValues: settleHasTable,
  // 两屏都要提到表里的局数与均值 —— 这才叫「同一份账」，不只是「都提到 72」。
  bothCiteGames: buyHasTable.includes(table.whenMine.games) && settleHasTable.includes(table.whenMine.games),
  bothCiteMean: buyHasTable.includes(table.whenMine.earnedMean) && settleHasTable.includes(table.whenMine.earnedMean),
};

// 负对照：把这句话拉长到旧版那种两三句的体量，几何必须报红。
await load(`http://127.0.0.1:${PORT}/support/probe-3338/settle.html?style=grow&seed=1&setup=rival`);
await ev(`(() => { const e = document.querySelector('#choice [data-next-game]');
  e.textContent = e.textContent + '再补一句用来撑高的长句子，让这一屏真的越过面板底部，看看量具会不会红。'.repeat(5);
  return true; })()`);
await delay(300);
report.control = await ev(MEASURE);
report.controlCaught = report.control.scrollH > report.control.clientH
  || !report.control.fullyInside || !report.control.lineHit.hit;

report.verdict = report.cases.map(c => ({
  setup: c.setup,
  readable: c.fullyInside && c.insidePanel && c.lineHit.hit,
  replayUsable: c.replayHit.hit,
  noScroll: c.scrollH <= c.clientH,
  len: c.len,
}));
writeFileSync(`${OUT}/settle.json`, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ verdict: report.verdict, controlCaught: report.controlCaught,
  sameLedger: { bothCiteGames: report.sameLedger.bothCiteGames, bothCiteMean: report.sameLedger.bothCiteMean,
    settleTableValues: report.sameLedger.settleTableValues, buyTableValues: report.sameLedger.buyTableValues },
  sample: report.sameLedger.settleLine }, null, 1));
ws.close(); chrome.kill(); server.kill();
