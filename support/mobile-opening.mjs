// Ordinary game, no state hooks. Node 22+ and local Chrome, served by a local static server.
// node support/mobile-opening.mjs <local server port> [screenshot directory]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { findChrome } from './find-chrome.mjs';

const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'Pass the local server port');
const out = process.argv[3];
const width = Number(process.env.VIEWPORT_W ?? 390), height = Number(process.env.VIEWPORT_H ?? 844);
const executable = findChrome();
const profile = mkdtempSync(join(tmpdir(), 'street-touch-'));
const chrome = spawn(executable, ['--headless=new', '--disable-background-networking', '--no-first-run',
  '--no-default-browser-check', '--mute-audio', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const closed = new Promise(resolve => chrome.once('close', resolve));
let ws, lastStep = 'launch';
const wait = async (label, fn) => {
  lastStep = label;
  const end = Date.now() + 20000;
  do { const value = await fn(); if (value) return value; await sleep(100); } while (Date.now() < end);
  throw Error(`Timed out at ${label}`);
};

try {
  const endpoint = await wait('browser readiness', async () => {
    if (chrome.exitCode !== null) throw Error(`Chrome exited ${chrome.exitCode}`);
    try {
      const cdp = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      const res = await fetch(`http://127.0.0.1:${cdp}/json/list`, {signal: AbortSignal.timeout(500)});
      return (await res.json()).find(t => t.type === 'page' && t.url === 'about:blank')?.webSocketDebuggerUrl;
    } catch { return null; }
  });
  ws = new WebSocket(endpoint);
  await new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(Error('CDP connection timeout')), 5000);
    ws.addEventListener('open', () => { clearTimeout(timer); ok(); }, {once:true});
    ws.addEventListener('error', () => { clearTimeout(timer); bad(Error('CDP connection failed')); }, {once:true});
  });
  const pending = new Map(), exceptions = [];
  let id = 0;
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    pending.get(msg.id)?.(msg);
    if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((ok, bad) => {
    const seq = ++id;
    const timer = setTimeout(() => { pending.delete(seq); bad(Error(method)); }, 10000);
    pending.set(seq, msg => {
      pending.delete(seq); clearTimeout(timer);
      if (msg.error) bad(Error(`${method}: ${msg.error.message}`)); else ok(msg.result);
    });
    ws.send(JSON.stringify({id:seq, method, params}));
  });
  const ev = async expression => {
    const r = await send('Runtime.evaluate', {expression, returnByValue:true});
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async name => {
    if (!out) return;
    await wait('transient map captions to clear', () => ev(`!document.querySelector('.money-float.map-float')`));
    mkdirSync(out, {recursive:true});
    const image = await send('Page.captureScreenshot', {format:'png', captureBeyondViewport:false});
    writeFileSync(join(out, `${name}.png`), Buffer.from(image.data, 'base64'));
  };
  const q = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const box = selector => `(() => { const el = ${q(selector)}; if (!el || el.disabled) return null;
    const r = el.getBoundingClientRect(), x = (r.left+r.right)/2, y = (r.top+r.bottom)/2;
    return el.contains(document.elementFromPoint(x,y)) ? {x,y,text:el.textContent.trim()} : null; })()`;
  const touch = async (type, touchPoints) => send('Input.dispatchTouchEvent', {type, touchPoints});
  const tap = async (selector, expected) => {
    const {x,y,text} = await wait(`tap ${selector}`, () => ev(box(selector)));
    if (expected) assert.match(text, expected);
    await touch('touchStart', [{x,y}]);
    await touch('touchEnd', []);
    console.log(`tap ${text.replace(/\s+/g, ' ')}`);
  };
  const roll = '#dice button[data-roll]';
  const day = n => ev(`${q('#system .pill')}?.textContent === '第 ${n} 天' && (${box(roll)})`);
  const log = () => ev(`${q('#log')}.textContent`);
  const notice = '#closed-shops';
  const teaRent = () => ev(`${q('[data-plot="4,1"] .plot-caption b')}?.textContent`);

  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:1, mobile:true});
  await send('Emulation.setTouchEmulationEnabled', {enabled:true});
  await send('Page.navigate', {url:`http://127.0.0.1:${port}/?slice=1&style=grow&seed=19`});
  await wait('entry initialized', () => ev(`${q('[name=sliceStyle]:checked')}?.value === 'grow' && document.fonts.status === 'loaded'`));
  assert.equal(await ev(`${q('#operateRule')}.checked`), false);
  if (!(await ev(box('#startSlice')))) {
    // A short viewport may need the normal setup swipe before the start button.
    const x = Math.round(width / 2);
    await touch('touchStart', [{x,y:height-80}]);
    for (let y = height-110; y > height/3; y -= 30) { await touch('touchMove', [{x,y}]); await sleep(18); }
    await touch('touchEnd', []);
    await sleep(350);
  }
  await tap('#startSlice');
  assert.match((await wait('D1 random action', () => day(1))).text, /掷骰 · 1–6 步/);
  assert.equal(await ev(`!!${q('[data-operate]')}`), false);
  assert.equal(await ev(`!!${q(notice)}`), false);
  await tap('#cards [data-card="2"]');
  await tap('[data-dice-choice="1"]');
  assert.equal((await wait('fixed action', () => day(1))).text, '出发 · 固定 1 步');
  assert.doesNotMatch(await log(), /定步生效/);
  await shot('01-before-fixed-move');
  await tap(roll);
  await wait('tea shop offer', () => ev(box('[data-act=buy]')));
  assert.match(await ev(`${q('#choice')}.textContent`), /售价 8,000.*补齐：晨光街/s);
  assert.match(await log(), /定步生效：本回合走 1 步/);
  await tap('[data-act=buy]');
  assert.match((await wait('D2 playable', () => day(2))).text, /掷骰 · 1–6 步/);
  assert.match(await log(), /D1 街角店主 买下 晨光街茶铺/);
  assert.match(await log(), /D1 机会买家 使用 停业 → 晨光街，停租 2 天/);
  const proof = await ev(`(() => {const e = ${q(notice)}, result = ${box(roll)};
    if (!e) return null;
    const rect = e.getBoundingClientRect();
    const fits = [...e.querySelectorAll('b,span')].every(t => {
      const range = document.createRange(); range.selectNodeContents(t);
      return [...range.getClientRects()].every(r => r.top >= rect.top && r.bottom <= rect.bottom &&
        r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && e.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2)));
    });
    return {text:e.textContent, fits, above:rect.bottom <= result.y,
      hand:[...document.querySelectorAll('#cards button:not(:disabled)')].map(b => {
        const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2));
      })}; })()`);
  assert.ok(proof?.fits && proof.above, JSON.stringify(proof));
  assert.match(proof.text, /晨光街停业 · 还剩 1 天.*你的小店、茶铺暂不收租/);
  assert.ok(proof.hand.length > 0 && proof.hand.every(Boolean), JSON.stringify(proof));
  assert.equal(await teaRent(), '停租');
  await shot('02-before-response');
  await tap(roll);
  await tap('#choice [data-dir="5,2"]', /^向右/);
  await tap('#choice [data-dir="8,2"]', /^向右/);
  await wait('D3 playable', () => day(3));
  assert.doesNotMatch(await ev(`${q(notice)}?.textContent ?? ''`), /晨光街/);
  assert.equal(await teaRent(), '租 2,800');
  await shot('03-reopened');
  assert.deepEqual(exceptions, []);
  console.log(`PASS ${width}×${height}: ${proof.text}; D3 去掉晨光街停业提示。`);
} catch (error) {
  console.error(`Last step: ${lastStep}`);
  throw error;
} finally {
  ws?.close();
  chrome.kill();
  await closed;
  rmSync(profile, {recursive:true, force:true});
}
