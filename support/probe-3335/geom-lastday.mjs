// #3335：本局最后一天那一屏，在 390×844 上还放不放得下两个提交键。
//
// 不是「看起来更短」——量的是：面板 scrollH == clientH（不滚）、「加盖」「放弃」两个键
// 的中心 elementFromPoint 命中自己。这两条与 #3264/#3334 是同一套判定。
//
// 另带一条负对照：把一句明显更长的分叉句塞进同一屏（模拟旧文案再加长），
// 量具必须报红（不滚或键点不到）。否则「通过」只说明我没量到东西。
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
// #3391v: shared chrome discovery (support/find-chrome.mjs); no host-private path.
const CHROME = findChrome();
const UD = `/tmp/chrome-3335-${process.pid}`;

// 静态服务器随仓库走（同一个文件，不依赖任何本机草稿目录）。
const server = spawn('node', ['support/probe-3335/serve.mjs', '.', String(PORT)], { stdio: 'ignore' });
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
  const btns = [...choice.querySelectorAll('[data-act="build"], [data-act="skip"]')];
  const hit = e => {
    const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (!(x > 0 && x < vw && y > 0 && y < vh)) return { hit: false, why: 'center outside viewport' };
    const at = document.elementFromPoint(x, y);
    return { hit: !!(at && e.contains(at)), at: at?.outerHTML?.slice(0, 60) ?? null, x: px(x), y: px(y) };
  };
  const fork = choice.querySelector('[data-fork]');
  return {
    vw, vh, panel: rect(choice), heading: choice.querySelector('h3')?.textContent ?? '',
    forkRect: fork ? rect(fork) : null,
    forkText: fork ? fork.textContent : null,
    forkLen: fork ? fork.textContent.length : 0,
    scrollH: choice.scrollHeight, clientH: choice.clientHeight, scrollTop: choice.scrollTop,
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

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

const report = { cases: [], control: null };
const load = async url => {
  await send('Page.navigate', { url });
  for (let i = 0; i < 60; i++) {
    const ready = await ev('!!window.__ready').catch(() => false);
    if (ready) break;
    await delay(150);
  }
  await ev('document.fonts ? document.fonts.ready.then(() => true) : true');
  await delay(400);
};

for (const style of ['grow', 'take', 'cross']) {
  await load(`http://127.0.0.1:${PORT}/support/probe-3335/fixture.html?style=${style}&seed=1`);
  const ready = await ev('window.__ready');
  const m = await ev(MEASURE);
  report.cases.push({ style, ready, ...m });
}

// 负对照：把分叉句换成一句明显更长的（同一屏、同一样式），量具必须报红。
await load(`http://127.0.0.1:${PORT}/support/probe-3335/fixture.html?style=grow&seed=1`);
await ev(`(() => { const f = document.querySelector('#choice [data-fork]');
  f.textContent = f.textContent + '再补一句用来撑高的长句子，让这一屏真的越过视口底部，看看量具会不会红。'.repeat(4);
  return true; })()`);
await delay(300);
report.control = await ev(MEASURE);
report.controlVerdict = {
  scrolls: report.control.scrollH > report.control.clientH,
  anyButtonMissed: report.control.buttons.some(b => !b.hit),
};

report.verdict = report.cases.map(c => ({
  style: c.style,
  noScroll: c.scrollH === c.clientH,
  bothHit: c.buttons.length === 2 && c.buttons.every(b => b.hit && !b.disabled),
  forkLen: c.forkLen,
}));
report.controlCaught = report.controlVerdict.scrolls || report.controlVerdict.anyButtonMissed;
writeFileSync(`${OUT}/geom-lastday.json`, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ verdict: report.verdict, controlCaught: report.controlCaught,
  controlVerdict: report.controlVerdict, forkText: report.cases.map(c => c.forkText) }, null, 1));

chrome.kill(); server.kill();
