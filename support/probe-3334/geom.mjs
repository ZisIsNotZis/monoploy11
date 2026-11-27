// #3334：390×844 上，加盖屏多了一行之后，两个提交键还在不在可点范围。
// 真 Edge + 真 CDP 鼠标输入（不是模拟点击）。沿用 #3264 的几何判定，不另写一套。
import { writeFileSync, mkdirSync } from 'node:fs';
import { findChrome } from '../find-chrome.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// 在交付集里跑（copy 出干净目录后）：node support/probe-3334/geom.mjs
// 依赖同目录的 serve.mjs 与仓库根的 index.html/src/。固定端口 + 固定 Chrome 路径，
// 失败时会直接抛（不静默降级）。不要同时跑两份。
// 端口从系统要空闲的，不写死：写死意味着上一箋清理失败的 Chrome 会让下一次
// 「版面永不稳定」——一句话把「端口被占」说成「量具坏了」。实测踩过一次。
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
// 用仓库里已验证的那颗 Linux Chrome（#3264 的 390×844 回执就是它跑的），
// 不用 Windows Edge 的 exe —— headless 下它不在这条 CDP 路径上起页面。
// #3391v: shared chrome discovery (support/find-chrome.mjs); no host-private path.
const CHROME = findChrome();
const URL_BASE = `http://127.0.0.1:${PORT}/index.html?slice=1&style=grow&seed=1`;
const UD = `/tmp/edge-3334-${process.pid}`;

// #3335：静态服务器必须来自**已提交的** support/probe-3334/serve.mjs。
// 改前这里指向 .scratch/3334/serve.mjs —— 那是我的本机草稿目录（未跟踪、不在交付集里），
// 干净副本上照 RESULT 跑这一行会 ENOENT。读者要能只靠仓库跑出同一张回执。
const server = spawn('node', ['support/probe-3334/serve.mjs', '.', String(PORT)], { stdio: 'ignore' });
const edge = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=390,844',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${UD}`,
  '--disable-features=Translate,HeadlessModeReporter', 'about:blank',
], { stdio: 'ignore' });

const MEASURE = `
(() => {
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
  const op = choice.querySelector('[data-opportunity]');
  const fk = choice.querySelector('[data-forward-k]');
  return {
    vw, vh,
    panel: rect(choice),
    heading: choice.querySelector('h3')?.textContent ?? '',
    forkRect: fork ? rect(fork) : null,
    forkText: fork ? fork.textContent : null,
    opRect: op ? rect(op) : null,
    fkRect: fk ? rect(fk) : null,
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
const press = async (x, y) => {
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
};
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const data = Buffer.from(r.data, 'base64');
  const w = data.readUInt32BE(16), h = data.readUInt32BE(20);
  writeFileSync(`${OUT}/${name}.png`, data);
  return { size: [w, h], sha256: createHash('sha256').update(data).digest('hex').slice(0, 16) };
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: URL_BASE });
// 不能只等固定时间：实测同一屏的「开一局」按钮 y 从 540 跳到 335（字体/样式还没落完），
// 那一下点击就落空，后面整条链都空转。改成等「版面稳定」再点。
const settle = async (expr, ms = 8000) => {
  const end = Date.now() + ms;
  let last = null, same = 0;
  while (Date.now() < end) {
    const v = await ev(expr).catch(() => null);
    if (v && v.ready) {
      if (last && v.y === last) { if (++same >= 3) return v; } else same = 0;
      last = v.y;
    }
    await delay(150);
  }
  throw Error('layout never settled: ' + expr.slice(0, 60));
};
// 光有按钮不算就绪：「开一局」是静态 HTML，三种起手的选择是 main.js 填进 #sliceStyles 的。
// 不等它就会出现「按钮在 335（没有选择）→ 点下去什么都没发生」。实测就是这么空转的。
const START_READY = `(() => {
  const b = document.querySelector('#startSlice');
  const n = document.querySelectorAll('#sliceStyles input[name="sliceStyle"]').length;
  if (!b || b.offsetParent === null || n < 3) return {ready:false};
  if (!document.fonts || document.fonts.status !== 'loaded') return {ready:false};
  const q = b.getBoundingClientRect();
  return {ready: q.height > 20 && q.top > 0 && q.bottom < innerHeight, y: q.top}; })()`;
await settle(START_READY);

const report = { url: URL_BASE, steps: [] };
// 起手第一屏：选 grow 并开局（真实点击）
const startInfo = await ev(`(() => {
  const r = document.querySelector('[name="sliceStyle"][value="grow"]'); if (r) r.checked = true;
  const b = document.querySelector('#startSlice'); const q = b.getBoundingClientRect();
  return { x: q.left + q.width / 2, y: q.top + q.height / 2, top: q.top, bottom: q.bottom, h: innerHeight }; })()`);
report.steps.push({ step: 'entry', startButton: startInfo });
await press(startInfo.x, startInfo.y);
await delay(1200);

// 走到第一个 build 提示：点掷骰（1 点），然后等提示。
const diceInfo = await ev(`(() => {
  const b = document.querySelector('#dice [data-roll="1"]') || document.querySelector('[data-roll]');
  if (!b) return null; const q = b.getBoundingClientRect();
  return { x: q.left + q.width / 2, y: q.top + q.height / 2, top: q.top, bottom: q.bottom }; })()`);
if (!diceInfo) { report.steps.push({ step: 'dice', found: false, system: await ev(`document.querySelector('#system')?.textContent ?? ''`), body: await ev(`document.body.className`) }); }
else {
  report.steps.push({ step: 'dice', found: true, ...diceInfo });
  await press(diceInfo.x, diceInfo.y);
  await settle(`(() => { const c = document.querySelector('#choice'); const b = c && c.querySelector('[data-act="build"]');
    if (!b) return {ready:false}; const q = b.getBoundingClientRect(); return {ready: q.height > 20 && q.top > 0, y: q.top}; })()`);
  await delay(300);
}

const before = await ev(MEASURE);
report.steps.push({ step: 'build-panel', measure: before });
report.shotBefore = await shot('A-build-panel');

// 真点「放弃」：证明这一屏的键在命中范围内，而且点了真的推进。
const skip = before.buttons.find(b => b.tag === 'skip');
report.skipReady = skip;
if (skip?.hit) {
  await press(skip.x, skip.y);
  await delay(1200);
  const after = await ev(`(() => ({ heading: document.querySelector('#choice h3')?.textContent ?? '', hidden: document.querySelector('#choice')?.hidden ?? null,
    system: (document.querySelector('#system')?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 120) }))()`);
  report.steps.push({ step: 'after-skip', after });
  report.shotAfter = await shot('B-after-skip');
}

// 再走一遍，这次真点「加盖」：证明提交键接得住，且现金真的少了 10,000。
report.pressBuild = { attempted: true };
{
  await send('Page.navigate', { url: URL_BASE });
  await settle(START_READY);
  const s2 = await ev(`(() => { const r = document.querySelector('[name="sliceStyle"][value="grow"]'); if (r) r.checked = true;
    const b = document.querySelector('#startSlice'); const q = b.getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
  await press(s2.x, s2.y);
  const ready2 = await settle(`(() => { const b = document.querySelector('#dice [data-roll="1"]');
    if (!b) return {ready:false}; const q = b.getBoundingClientRect(); return {ready: q.height > 10 && q.top > 0, y: q.top}; })()`);
  const d2 = await ev(`(() => { const b = document.querySelector('#dice [data-roll="1"]'); const q = b.getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; })()`);
  await press(d2.x, d2.y);
  await settle(`(() => { const c = document.querySelector('#choice'); const b = c && c.querySelector('[data-act="build"]');
    if (!b) return {ready:false}; const q = b.getBoundingClientRect(); return {ready: q.height > 20 && q.top > 0, y: q.top}; })()`);
  const cashBefore = await ev(`document.querySelector('#players .pmeta')?.textContent ?? ''`);
  const b2 = await ev(`(() => { const b = document.querySelector('#choice [data-act="build"]'); const q = b.getBoundingClientRect();
    const x = q.left + q.width / 2, y = q.top + q.height / 2;
    const at = document.elementFromPoint(x, y);
    return { x, y, hit: !!(at && b.contains(at)), rect: [q.left, q.top, q.right, q.bottom] }; })()`);
  const clicked = b2.hit ? (await press(b2.x, b2.y), true) : false;
  await delay(1500);
  const after = await ev(`(() => ({ choiceHidden: document.querySelector('#choice')?.hidden ?? null,
    cash: document.querySelector('#players .pmeta')?.textContent ?? '',
    log: (document.querySelector('#log')?.textContent ?? '').slice(-200) }))()`);
  report.pressBuild = { hit: b2.hit, rect: b2.rect, clicked, cashBefore, after };
  report.shotCommitted = await shot('C-after-build');
}
ws.close();
edge.kill();
server.kill();
// 清理要可核：真等到进程退出、端口不再监听，别让下一个跑的人接到一个「永不稳定」的版面。
const waitGone = async (proc, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (proc.exitCode !== null || proc.signalCode) return true; await delay(100); }
  return false;
};
const edgeGone = await waitGone(edge), serverGone = await waitGone(server);
const portsOpen = async p => {
  const net = await import('node:net');
  return new Promise(ok => {
    const s = net.connect({ port: p, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); ok(true); });
    s.on('error', () => ok(false));
    s.setTimeout(500, () => { s.destroy(); ok(false); });
  });
};
report.cleanup = { edgeGone, serverGone, httpStillOpen: await portsOpen(PORT), cdpStillOpen: await portsOpen(CDP) };
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
if (!edgeGone || !serverGone || report.cleanup.httpStillOpen || report.cleanup.cdpStillOpen) {
  console.error('CLEANUP INCOMPLETE', JSON.stringify(report.cleanup));
  process.exitCode = 1;
}
