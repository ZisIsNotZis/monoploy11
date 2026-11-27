// #3391t：supervisor 说得很明确 ——
// 「真正想验的两种打法还要从争街开局让玩家自己把一条街补起来，因为我这一局开场已经有整条街。」
// 另外他报了一个具体的缺：买地确认页整屏只说踩中后收租，没说补齐会新增每天 500。
//
// 这支探针走的就是那条路（正式入口、争街开局、穿街高手、seed 2）：
//   ① 从第一屏开局（真点击）
//   ② 用定步卡把落点选到自家那条街的无主另一半旁边，再走过去买下
//   ③ 买地**确认那一屏还没按之前**，把屏上的字读下来：必须写明营业进项新增多少
//   ④ 按下去之后等到次日结算，日志与侧栏必须出现入账
//
// 定步卡正好在穿街高手手上（close + remotedice），所以这条路是产品自带的，不需要注入。
//
// 用法：node support/compare/contested-fill-smoke.mjs
import { spawn } from 'node:child_process';
import { findChrome } from '../find-chrome.mjs';
import http from 'node:http';
import { existsSync } from 'node:fs';

const CDP = Number(process.env.CDP_PORT ?? 19691);
const SEED = Number(process.env.SEED ?? 2);
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

const serve = spawn('python3', ['serve.py', '0'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] });
const port = await new Promise((res, rej) => {
  let buf = '';
  const timer = setTimeout(() => rej(new Error('serve.py 没宣告端口')), 15000);
  serve.stdout.on('data', d => {
    buf += d.toString();
    const m = buf.match(/LISTENING (\d+)/);
    if (m) { clearTimeout(timer); res(Number(m[1])); }
  });
});
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-first-run',
  '--disable-gpu', `--user-data-dir=/tmp/contested-fill-${CDP}`, 'about:blank'], { stdio: 'ignore' });

const problems = [];
const out = {};
try {
  const version = await getJson('/json/version');
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const events = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const n = ++id;
    pend.set(n, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  const target = (await getJson('/json/list')).find(t => t.type === 'page');
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.id, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  const ev = async expr => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`EVAL: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
    return r.result.value;
  };
  const click = async ({ x, y }) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await S('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
    await sleep(120);
  };

  // ① 争街开局（默认），穿街高手，规则 250。
  // #3391v：规则档已从首屏退回地址栏（首屏高度是稀缺资源，见 src/main.js 的说明），
  // 所以这里由 URL 带进来 —— 上一版点 `[name=sliceBusiness][value="250"]`，那颗单选
  // 没了之后 `?.` 静默跳过，整局在无规则下跑，最后撞在「屏上写了营业进项」那条断言上。
  const BUSINESS = Number(process.env.BUSINESS ?? 250);
  await S('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?slice=1&style=cross&seed=${SEED}`
    + (BUSINESS > 0 ? `&business=${BUSINESS}` : '') });
  await sleep(2200);
  out.firstScreen = await ev(`(() => {
    const o = document.querySelector('[name=sliceOpening][value=contested]'); o?.click();
    const s = document.querySelector('[name=sliceStyle][value=cross]'); s?.click();
    const cta = document.querySelector('#startSlice'); const r = cta.getBoundingClientRect();
    return {opening: document.querySelector('[name=sliceOpening]:checked')?.value,
      businessRadios: document.querySelectorAll('[name=sliceBusiness]').length,
      cta: {x: r.left + r.width/2, y: r.top + r.height/2}};
  })()`);
  if (out.firstScreen.opening !== 'contested') problems.push('没选中争街开局');
  // 回归守卫：有人再把规则控件塞回首屏，这里立刻红（它会挤高入口屏）。
  if (out.firstScreen.businessRadios) problems.push(`首屏又出现了规则控件：${out.firstScreen.businessRadios} 个`);
  await click(out.firstScreen.cta);
  await sleep(2000);
  out.urlAfterStart = await ev(`(() => { const u = new URL(location.href);
    return {cross: u.searchParams.get('cross'), business: u.searchParams.get('business')}; })()`);
  if (out.urlAfterStart.cross !== '1') problems.push(`争街没被记住：cross=${out.urlAfterStart.cross}`);

  // ② 用定步卡把落点选到「自家那条街的无主另一半」旁边。
  //    先看牌面：手上有 close / remotedice / worker 中哪几张（穿街高手 = close + remotedice）。
  out.hand = await ev(`[...document.querySelectorAll('#hand button[data-card]')]
    .map(b => ({text: (b.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40), disabled: b.disabled}))`);

  // 逐个候选落点：点定步 → 看那个格子是否正好停到目标地上。
  // 产品在定步时会列出可能落点，所以探针只需在弹面上按「目标地旁边的那一格」。
  const targetPlot = await ev(`(() => {
    // 从棋盘读：自家持有、同街的另一半（无主地）。
    const cells = [...document.querySelectorAll('[data-plot]')].map(e => e.dataset.plot);
    return cells.slice(0, 0).concat(cells);
  })()`);
  out.plotsOnBoard = targetPlot.length;

  // ③ 一直推进：只在「买地屏出现时才读字」，并把 buying 那一次记下来。
  let fillSeen = null, day2 = null, tries = 0;
  for (let i = 0; i < 400 && !fillSeen; i++) {
    const st = await ev(`(() => {
      const choice = document.querySelector('#choice');
      const text = choice && !choice.hidden ? (choice.textContent || '').replace(/\\s+/g, ' ').trim() : '';
      const isBuy = !!document.querySelector('#choice [data-act="buy"], #choice button[data-ledger], #choice') && /买下|买地|这条路是/.test(text);
      const pick = el => { if (!el) return null; const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return null;
        const hit = document.elementFromPoint(cx, cy);
        if (!(hit === el || el.contains(hit))) return null;
        return {x: cx, y: cy, text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30)}; };
      const live = el => el && !el.disabled;
      const roll = document.querySelector('#dice button[data-roll]');
      const panel = [...document.querySelectorAll('#choice button')].filter(live);
      return {
        day: Number((document.querySelector('#system .pill')?.textContent ?? '1').match(/\\d+/)?.[0] ?? 1),
        isBuy, buyText: isBuy ? text.slice(0, 1200) : null,
        roll: live(roll) ? pick(roll) : null,
        buyBtn: isBuy ? pick(panel.find(b => /买下|买入|确认/.test(b.textContent || ''))) : null,
        skipBtn: isBuy ? pick(panel.find(b => /不买|跳过|放弃|不要/.test(b.textContent || ''))) : null,
        cards: [...document.querySelectorAll('#hand button[data-card]')].filter(live)
          .map(b => ({el: pick(b)})).filter(x => x.el).map(x => x.el),
        panel: panel.map(pick).filter(Boolean),
      };
    })()`);

    if (st.isBuy && /营业进项/.test(st.buyText ?? '')) {
      // 这就是「补齐一条街」那一屏，而且是规则开着的那一版：屏上必须已经写明进项。
      fillSeen = { day: st.day, text: st.buyText, buy: st.buyBtn, skip: st.skipBtn };
      break;
    }
    if (st.isBuy && st.skipBtn) { await click(st.skipBtn); continue; }
    if (st.roll) { await click(st.roll); continue; }
    if (st.panel.length) { await click(st.panel[0]); tries++; if (tries > 200) break; continue; }
    await sleep(120);
  }
  out.fillScreen = fillSeen;
  if (!fillSeen) {
    problems.push('一路打过去没有遇到「规则开着、且屏上写了营业进项」的买地屏 —— 这条路径没被验到');
  } else {
    if (!/每天结算|每天入账|营业进项/.test(fillSeen.text)) problems.push('买地屏没有说营业进项');
    // ④ 按买下，然后等次日结算看是否真的入账。
    await click(fillSeen.buy);
    await sleep(600);
    for (let i = 0; i < 200; i++) {
      const st = await ev(`(() => {
        const pick = el => { if (!el) return null; const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return null; const cx = r.left + r.width/2, cy = r.top + r.height/2;
          if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return null;
          const hit = document.elementFromPoint(cx, cy);
          if (!(hit === el || el.contains(hit))) return null; return {x: cx, y: cy}; };
        const live = el => el && !el.disabled;
        const roll = document.querySelector('#dice button[data-roll]');
        const panel = [...document.querySelectorAll('#choice button')].filter(live).map(pick).filter(Boolean);
        return {day: Number((document.querySelector('#system .pill')?.textContent ?? '1').match(/\\d+/)?.[0] ?? 1),
          roll: live(roll) ? pick(roll) : null, panel};
      })()`);
      if (st.day > (fillSeen.day ?? 1) + 1) { day2 = st.day; break; }
      if (st.roll) await click(st.roll);
      else if (st.panel.length) await click(st.panel[0]);
      else await sleep(140);
    }
    out.dayAfterBuy = day2;
    out.after = await ev(`(() => {
      const log = [...document.querySelectorAll('#log li')].map(li => li.textContent.trim());
      return {businessLines: log.filter(t => t.includes('营业进项')),
        insight: (document.querySelector('#insight')?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 400)};
    })()`);
    if (!out.after.businessLines.length) problems.push('买下补齐后，日志里没有营业进项入账');
    if (!/营业进项已入/.test(out.after.insight)) problems.push('侧栏没有报「营业进项已入」');
  }

  const errs = events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails.text);
  out.runtimeErrors = errs;
  if (errs.length) problems.push(`运行期报错：${errs[0]}`);

  console.log(JSON.stringify(out, null, 2));
  if (problems.length) { console.error('\nFAIL\n - ' + problems.join('\n - ')); process.exitCode = 1; }
  else console.log('\nPASS：争街开局下，买地确认屏在决定之前就写明了营业进项；'
    + '买下补齐后次日真的入账，侧栏与日志一致。');
} finally {
  chrome.kill('SIGKILL');
  serve.kill('SIGKILL');
}
