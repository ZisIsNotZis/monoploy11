// Real Chrome touch replay on the ordinary slice entry. The game is finished through
// the UI only; nothing is injected into game state. Checks that the new recap is
// readable above the replay action, and that the advice does not cover it.
// node support/settlement-recap.mjs <port> <output dir> [width] [height]
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
const width = Number(process.argv[4] ?? 360), height = Number(process.argv[5] ?? 640);
const profile = mkdtempSync(join(tmpdir(), 'slice-recap-'));
const chrome = spawn(findChrome(), ['--headless=new', '--disable-background-networking', '--no-first-run',
  '--no-default-browser-check', '--mute-audio', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const closed = new Promise(resolve => chrome.once('close', resolve));
let ws, lastStep = 'launch';
const wait = async (label, fn, timeout = 25000) => {
  lastStep = label;
  const end = Date.now() + timeout;
  do { const value = await fn(); if (value) return value; await sleep(100); } while (Date.now() < end);
  throw Error(`Timed out at ${label}`);
};

try {
  const endpoint = await wait('browser readiness', async () => {
    if (chrome.exitCode !== null) throw Error(`Chrome exited ${chrome.exitCode}`);
    try {
      const cdp = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
      const res = await fetch(`http://127.0.0.1:${cdp}/json/list`, {signal: AbortSignal.timeout(500)});
      return (await res.json()).find(t => t.type === 'page')?.webSocketDebuggerUrl;
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
    const timer = setTimeout(() => { pending.delete(seq); bad(Error(method)); }, 20000);
    pending.set(seq, msg => {
      pending.delete(seq); clearTimeout(timer);
      if (msg.error) bad(Error(`${method}: ${msg.error.message}`)); else ok(msg.result);
    });
    ws.send(JSON.stringify({id:seq, method, params}));
  });
  const ev = async expression => {
    const r = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async name => {
    if (!out) return;
    mkdirSync(out, {recursive:true});
    const image = await send('Page.captureScreenshot', {format:'png', captureBeyondViewport:false});
    writeFileSync(join(out, `${name}.png`), Buffer.from(image.data, 'base64'));
  };
  const box = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled) return null;
    const r = el.getBoundingClientRect(), x = (r.left+r.right)/2, y = (r.top+r.bottom)/2;
    return el.contains(document.elementFromPoint(x,y)) ? {x,y,text:el.textContent.trim()} : null; })()`;
  const touch = async (type, points) => send('Input.dispatchTouchEvent', {type, touchPoints: points});
  const tap = async selector => {
    const {x,y,text} = await wait(`tap ${selector}`, () => ev(box(selector)));
    await touch('touchStart', [{x,y}]);
    await touch('touchEnd', []);
    console.log(`tap ${text.replace(/\s+/g, ' ')}`);
  };

  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:1, mobile:true});
  await send('Emulation.setTouchEmulationEnabled', {enabled:true});
  await send('Page.navigate', {url:`http://127.0.0.1:${port}/?slice=1&seed=47&style=take`});
  await wait('setup', () => ev(`document.querySelector('[name=sliceStyle]:checked')?.value === 'take' && document.fonts.status === 'loaded'`));
  if (!(await ev(box('#startSlice')))) {
    await ev(`document.querySelector('#startSlice').scrollIntoView({block:'center'})`);
  }
  await tap('#startSlice');
  await wait('playable', () => ev(`document.querySelector('.turn-heading')?.innerText.includes('轮到你了')`));

  // Finish the game through the same ordinary controls. This drives the real engine
  // through its public UI; it does not write game state. Branches are chosen by their
  // own printed consequences (avoid prison, avoid the largest immediate rent).
  await ev(`void (window.settlementReplay = (async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const live = q => [...document.querySelectorAll(q)].filter(e => !e.disabled && e.getClientRects().length);
    let rolled = '';
    for (let guard = 0; guard < 900; guard++) {
      if (live('[data-replay]').length) return 'settled';
      if (/轮到你了/.test(document.querySelector('.turn-heading')?.innerText ?? '')) {
        const day = +(document.querySelector('#system .pill').innerText.match(/[0-9]+/)?.[0]);
        const button = (q, text) => live(q).find(e => e.innerText.includes(text));
        const supply = day === 4 ? button('button[data-supply]', '穿过危险街') : live('button[data-supply]')[0];
        const card = day === 1 || day === 4 ? '定步' : day === 2 || day === 5 ? '停业' : day === 7 ? '翻修' : '';
        const choice = document.querySelector('#choice h3')?.innerText;
        const prep = card && live('#cards button[data-card]').find(e => e.querySelector('b')?.innerText === card);
        const fixed = choice === '定步' && live('[data-dice-choice="' + (day === 1 ? '1' : '6') + '"]')[0];
        const target = choice === '停业' ? button('[data-pick-plot]', '晚风街小店')
          : choice === '翻修' ? button('[data-pick-plot]', '街心书屋') : null;
        const buy = (day === 1 || day === 4) && live('#hand [data-act="buy"]')[0];
        const [discard] = live('button[data-discard]');
        const routes = live('#hand [data-dir]');
        const [skip] = live('#hand [data-act="skip"]');
        const [roll] = live('[data-roll="1"]');
        const rent = t => Math.max(0, ...[...t.matchAll(/付租 ([\\d,]+)/g)].map(m => +m[1].replaceAll(',', '')));
        const score = el => {
          const t = el.innerText.split('再往前')[0];
          return (/失去 2 回合/.test(t) ? 6000 : 0) + rent(t) - (/发薪/.test(t) ? 3000 : 0) - (/零工/.test(t) ? 1000 : 0);
        };
        const route = routes.find(e => e.innerText.startsWith(({2:'向右', 4:'向左', 5:'向左', 6:'向上', 7:'向下'})[day] ?? '—'));
        if (supply) supply.click();
        else if (discard) discard.click();
        else if (target) target.click();
        else if (fixed) fixed.click();
        else if (route) route.click();
        else if (routes.length) routes.sort((a,b) => score(a)-score(b))[0].click();
        else if (buy) buy.click();
        else if (skip) skip.click();
        else if (prep) prep.click();
        else if (roll && rolled !== document.querySelector('.turn-heading').innerText) {
          rolled = document.querySelector('.turn-heading').innerText;
          roll.click();
        }
      }
      await sleep(140);
    }
    throw Error('game did not settle');
  })().catch(error => { window.settlementReplayError = String(error); }))`);
  await wait('complete ordinary game', () => ev(`(() => {
    if (window.settlementReplayError) throw Error(window.settlementReplayError);
    return !!document.querySelector('[data-replay]');
  })()`), 160000);
  await wait('settlement captions clear', () => ev(`!document.querySelector('.money-float.map-float')`));
  await shot('01-result-top');

  const facts = await ev(`(() => {
    const choice = document.querySelector('#choice'), bar = document.querySelector('.next-bar');
    const recap = document.querySelector('.slice-recap'), advice = document.querySelector('[data-next-game]');
    const button = document.querySelector('[data-replay]');
    const r = el => { const b = el.getBoundingClientRect(); return {top:Math.round(b.top), bottom:Math.round(b.bottom), height:Math.round(b.height)}; };
    return { viewport:[innerWidth,innerHeight], choice:r(choice), bar:r(bar), recap:recap && r(recap),
      advice:r(advice), button:r(button), scroll:[choice.scrollTop, choice.scrollHeight, choice.clientHeight],
      recapText:recap?.innerText, rank:document.querySelector('.rank').innerText, adviceText:advice.innerText,
      recapVisible:!!recap && recap.getBoundingClientRect().top >= choice.getBoundingClientRect().top
        && recap.getBoundingClientRect().bottom <= choice.getBoundingClientRect().bottom };
  })()`);
  console.log(JSON.stringify(facts));
  if (process.env.BASELINE === '1') {
    assert.ok(!facts.recap, 'Baseline should not already show the recap');
  } else {
    assert.match(facts.recapText ?? '', /让晚风街停业.*没付租/s);
    assert.match(facts.recapText, /用定步走 6 步，花 26,000 买下街心书屋，此后从它实收 9,600/);
    assert.ok(facts.button.top >= facts.choice.top && facts.button.bottom <= height, JSON.stringify(facts));
    assert.ok(facts.recap.bottom <= facts.button.top, `recap runs under the sticky action: ${JSON.stringify(facts)}`);
    assert.ok(facts.recapVisible && facts.scroll[0] === 0, `recap is outside the first view: ${JSON.stringify(facts)}`);
    await ev(`document.querySelector('#choice').scrollTop = document.querySelector('#choice').scrollHeight`);
    assert.ok(await ev(box('[data-next-game]')), 'Advice remains visible after scrolling');
    await shot('02-advice-below');
  }
  await tap('[data-replay]');
  assert.equal(await ev(`document.querySelector('#operateRule').checked`), false);
  assert.deepEqual(exceptions, []);
  console.log(`PASS ${width}×${height}`);
} catch (error) {
  console.error(`Last step: ${lastStep}`);
  throw error;
} finally {
  ws?.close();
  chrome.kill();
  await closed;
  rmSync(profile, {recursive:true, force:true});
}
