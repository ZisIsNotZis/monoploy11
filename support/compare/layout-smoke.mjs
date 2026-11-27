// #3391t：首屏多了一排「规则」单选之后，整局驱动报 SLICE-NOT-STARTED。
// 先量，不猜：把 390×844 与 360×640 下开局按钮的位置、以及「中心点命中自己」都印出来。
// 判据不是「页面能开」，而是「玩家那一按能不能落到按钮上」（elementFromPoint 命中它自己）。
//
// 用法：node support/compare/layout-smoke.mjs
import { spawn } from 'node:child_process';
import { findChrome } from '../find-chrome.mjs';
import http from 'node:http';
import { existsSync } from 'node:fs';

const CDP = Number(process.env.CDP_PORT ?? 19681);
// #3391v：浏览器发现走项目共用的一处（support/compare/find-chrome.mjs），
// 不再写死本机私有路径 —— 那让干净检出里的人只会看到「找不到 chrome」。
// 规则与 support/full-game/run-full.py 的 find_chrome 一致：CHROME= 优先，再 PATH，再 puppeteer 缓存。
const CHROME = findChrome();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(path) {
  for (let i = 0; i < 80; i++) {
    try {
      return await new Promise((res, rej) => {
        const q = http.get(`http://127.0.0.1:${CDP}${path}`, x => {
          let b = ''; x.on('data', d => (b += d)); x.on('end', () => res(JSON.parse(b)));
        });
        q.on('error', rej);
      });
    } catch { await sleep(250); }
  }
  throw new Error(`CDP ${path} 不可达`);
}

const proc = spawn('python3', ['serve.py', '0'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] });
const port = await new Promise((res, rej) => {
  let buf = '';
  const timer = setTimeout(() => rej(new Error('serve.py 没宣告端口')), 15000);
  proc.stdout.on('data', d => {
    buf += d.toString();
    const m = buf.match(/LISTENING (\d+)/);
    if (m) { clearTimeout(timer); res(Number(m[1])); }
  });
});
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-first-run',
  '--disable-gpu', `--user-data-dir=/tmp/layout-profile-${CDP}`, 'about:blank'], { stdio: 'ignore' });

const problems = [];
try {
  const version = await getJson('/json/version');
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const n = ++id;
    pend.set(n, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  const target = (await getJson('/json/list')).find(t => t.type === 'page');
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.id, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');

  for (const [w, h] of [[390, 844], [360, 640], [1280, 800]]) {
    await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await S('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?slice=1&style=grow&seed=1` });
    await sleep(1800);
    const r = await S('Runtime.evaluate', { expression: `(() => {
      const box = e => { if (!e) return null; const b = e.getBoundingClientRect();
        return [Math.round(b.top), Math.round(b.bottom)]; };
      const cta = document.querySelector('#startSlice');
      const b = cta.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const rows = (id) => document.querySelectorAll('#' + id + ' input').length;
      return { vh: innerHeight, docH: document.documentElement.scrollHeight,
        openings: box(document.querySelector('#sliceOpening')), business: box(document.querySelector('#sliceBusiness')),
        styles: box(document.querySelector('#sliceStyles')), cta: box(cta),
        ctaCentre: [Math.round(cx), Math.round(cy)],
        hitSelf: !!(hit && (hit === cta || cta.contains(hit))),
        hitWhat: hit ? (hit.id || hit.className || hit.tagName) : null,
        radios: { open: rows('sliceOpening'), business: rows('sliceBusiness'), style: rows('sliceStyles') } };
    })()`, returnByValue: true });
    const v = r.result.value;
    console.log(`${w}x${h} ` + JSON.stringify(v));
    if (!v.hitSelf) problems.push(`${w}x${h}：开局按钮中心点 (${v.ctaCentre}) 命中的是 ${v.hitWhat}，不是按钮本身`
      + `（按钮 ${JSON.stringify(v.cta)}，视口高 ${v.vh}）`);
    if (v.cta && v.cta[1] > v.vh) problems.push(`${w}x${h}：开局按钮底边 ${v.cta[1]} 已在视口 ${v.vh} 之外`);
  }
  // 360×640 在**基线 fbb460e 上就已经**把「开一局」顶到 737–773（视口 640）——
  // 实测方法：把同一支探针放进 fbb460e 的工作树跑一遍。所以这里不把它算作本次回归，
  // 但也不允许再变大：一旦超过 773 就说明我这几排又长了。
  const KNOWN_360_BOTTOM = 773;
  const p360 = problems.filter(p => p.startsWith('360x640'));
  for (const p of p360) {
    const m = /底边 (\d+)/.exec(p);
    if (m && Number(m[1]) > KNOWN_360_BOTTOM) problems.push(`360×640 比基线更差：底边 ${m[1]} > ${KNOWN_360_BOTTOM}`);
  }
  const blocking = problems.filter(p => !p.startsWith('360x640'));
  if (blocking.length) { console.error('\nFAIL\n - ' + blocking.join('\n - ')); process.exitCode = 1; }
  else console.log('\nPASS：390×844 与 1280×800 下开局按钮在视口内且中心点命中自己；'
    + `360×640 溢出现象与基线一致（基线底边 ${KNOWN_360_BOTTOM}，见注释）。`);
} finally {
  chrome.kill('SIGKILL');
  proc.kill('SIGKILL');
}
