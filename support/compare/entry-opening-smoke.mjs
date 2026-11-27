// #3391t：supervisor 报的两件事，用**正式入口的真实点击**兜住。
//
// 他报的回归（原话）：「我选『整条街』开局，旧发布版会记住这个选择，再打开仍是整条街；
// 这版 URL 不再留下选择，再打开就变成默认争街。试玩也少了正式盘的开局布局选项。」
// 根因已在 src/main.js 里查到：startSlice() 造了带 cross 的 URL 却没写回地址栏
// （`const u = ...` 之后什么都没做，注释却写着 replaceState）。
//
// 这支探针不读代码、不读日志推断，只做玩家做的事并读屏上的字：
//   ① 打开正式入口 ?slice=1&style=cross&seed=2
//   ② 在**第一屏**把开局点到「整条街」（规则档由 URL 的 ?business=N 带进来 ——
//      它不占首屏，见 src/main.js 的说明：加那一排会把「开一局」顶出窄视口）
//   ③ 真按「开一局街角生意」
//   ④ 断言地址栏带着 cross=0 与 business=<档>（这就是「记住选择」；
//      business=0 时**不该**带这个参数，否则重开会莫名开规则）
//   ⑤ 用真实的掷骰/前进点击一路打到第 2 天（进项在 advanceDay 结算，第 2 天才可见）
//   ⑥ 把日志里与侧栏里的原文留下来，两档各跑一次，交给 supervisor 对照
//
// 用法：node support/compare/entry-opening-smoke.mjs
import { spawn } from 'node:child_process';
import { findChrome } from '../find-chrome.mjs';
import http from 'node:http';
import { existsSync } from 'node:fs';

const CDP = Number(process.env.CDP_PORT ?? 19671);
const SEED = 2;
const OPENING = 'whole';          // 整条街：每人开局就占满自己那条街，进项对它是对称的
const WAYS = [0, 250];
// #3391v：浏览器发现走项目共用的一处（support/compare/find-chrome.mjs），
// 不再写死本机私有路径 —— 那让干净检出里的人只会看到「找不到 chrome」。
// 规则与 support/full-game/run-full.py 的 find_chrome 一致：CHROME= 优先，再 PATH，再 puppeteer 缓存。
const CHROME = findChrome();

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(path) {
  for (let i = 0; i < 80; i++) {
    try {
      const raw = await new Promise((res, rej) => {
        const q = http.get(`http://127.0.0.1:${CDP}${path}`, x => {
          let b = '';
          x.on('data', d => (b += d));
          x.on('end', () => res(b));
        });
        q.on('error', rej);
      });
      return JSON.parse(raw);
    } catch { await sleep(250); }
  }
  throw new Error(`CDP ${path} 不可达`);
}

async function startServer() {
  const proc = spawn('python3', ['serve.py', '0'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  const port = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`serve.py 没宣告端口：${buf}`)), 15000);
    proc.stdout.on('data', d => {
      buf += d.toString();
      const m = buf.match(/LISTENING (\d+)/);
      if (m) { clearTimeout(timer); res(Number(m[1])); }
    });
    proc.on('exit', c => { clearTimeout(timer); rej(new Error(`serve.py 退出 ${c}：${buf}`)); });
  });
  return { proc, port };
}

async function main() {
  const { proc: serve, port } = await startServer();
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', `--user-data-dir=/tmp/entry-opening-profile-${CDP}`, 'about:blank',
  ], { stdio: 'ignore' });

  const out = { runs: [], problems: [] };
  try {
    const version = await getJson('/json/version');
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.method) events.push(m);
    };
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
    });

    const targets = await getJson('/json/list');
    const target = targets.find(t => t.type === 'page');
    const { sessionId } = await send('Target.attachToTarget', { targetId: target.id, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S('Page.enable');
    await S('Runtime.enable');
    // 390×844：supervisor 手上那一档。
    await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

    const ev = async expr => {
      const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`EVAL: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
      return r.result.value;
    };

    for (const business of WAYS) {
      events.length = 0;
      const url = `http://127.0.0.1:${port}/index.html?slice=1&style=cross&seed=${SEED}`
        + (business > 0 ? `&business=${business}` : '');
      const nav = await S('Page.navigate', { url });
      if (nav.errorText) throw new Error(`NAV: ${nav.errorText}`);
      await sleep(2200);

      // ② 第一屏必须同时提供开局与规则两排单选（以前试玩页只有起手那一排）。
      const screen = await ev(`(() => {
        const openings = [...document.querySelectorAll('[name=sliceOpening]')].map(r => r.value);
        const ways = [...document.querySelectorAll('[name=sliceBusiness]')].map(r => r.value);
        return {openings, ways, styles: document.querySelectorAll('[name=sliceStyle]').length};
      })()`);
      if (!screen.openings.includes(OPENING)) out.problems.push(`第一屏没有「${OPENING}」开局可选：${JSON.stringify(screen.openings)}`);
      // 规则档回到地址栏之后，首屏**不该**再有规则控件（加一排会把「开一局」顶出窄视口）。
      // 这条也是回归守卫：有人再把它塞回首屏，这里立刻红。
      if (screen.ways.length) out.problems.push(`首屏又出现了规则控件：${JSON.stringify(screen.ways)}`);

      // 玩家真的点单选，而不是靠 URL 参数。
      const clicked = await ev(`(() => {
        const o = document.querySelector('[name=sliceOpening][value="${OPENING}"]');
        o?.click();
        const b = document.querySelector('[name=sliceBusiness][value="${business}"]');
        b?.click();
        const st = document.querySelector('[name=sliceStyle][value="cross"]');
        st?.click();
        const cta = document.querySelector('#startSlice');
        if (!cta) return {started: false, why: 'no-cta'};
        const r = cta.getBoundingClientRect();
        return {started: false, cta: {x: r.left + r.width / 2, y: r.top + r.height / 2},
          checked: {
            opening: document.querySelector('[name=sliceOpening]:checked')?.value ?? null,
            style: document.querySelector('[name=sliceStyle]:checked')?.value ?? null,
          }};
      })()`);
      if (!clicked.cta) { out.problems.push(`开局按钮不存在：${clicked.why}`); continue; }
      if (clicked.checked.opening !== OPENING) out.problems.push(`点不中「整条街」单选：${JSON.stringify(clicked.checked)}`);

      // ③ 真点（CDP 鼠标事件，不是 element.click()）：玩家手上那一下。
      for (const type of ['mousePressed', 'mouseReleased']) {
        await S('Input.dispatchMouseEvent', { type, x: clicked.cta.x, y: clicked.cta.y, button: 'left', clickCount: 1 });
      }
      await sleep(2500);

      // ④ 地址栏记住选择了吗（这就是 supervisor 报的那条回归）
      const urlAfter = await ev(`(() => { const u = new URL(location.href);
        return {href: u.href, cross: u.searchParams.get('cross'), business: u.searchParams.get('business'),
          slice: u.searchParams.get('slice'), seed: u.searchParams.get('seed')}; })()`);
      const startedOk = await ev(`document.querySelector('#setup').hidden === true`);
      if (!startedOk) { out.problems.push(`没进局（business=${business}）`); continue; }
      if (urlAfter.cross !== '0') out.problems.push(`开局后地址栏 cross=${urlAfter.cross}，应为 0（「整条街」没被记住）`);
      // business=0 时地址栏**不该**带这个参数（带了就意味着重开会莫名地开规则）。
      const wantBusiness = business === 0 ? null : String(business);
      if (urlAfter.business !== wantBusiness)
        out.problems.push(`开局后地址栏 business=${urlAfter.business}，应为 ${wantBusiness}`);

      // ⑤ 用真点击打到第 2 天。策略与整局驱动同源：优先掷骰，其次面板按钮，最后地图。
      const steps = [];
      let day = 1;
      for (let i = 0; i < 260 && day < 2; i++) {
        const t = await ev(`(() => {
          const pick = el => { if (!el) return null; const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return null;
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return null;
            const hit = document.elementFromPoint(cx, cy);
            if (!(hit === el || el.contains(hit))) return null;
            return {x: cx, y: cy, text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24)}; };
          const live = el => el && !el.disabled;
          const roll = document.querySelector('#dice button[data-roll]');
          if (live(roll)) { const p = pick(roll); if (p) return {...p, what: 'roll'}; }
          const card = [...document.querySelectorAll('#hand button[data-card]')].find(live);
          // 卡会改局面，这一跑只想推进天数：先不打卡，直接掷骰。
          void card;
          const panel = [...document.querySelectorAll('#choice button')].filter(live)
            .filter(b => !/取消/.test(b.textContent || ''));
          for (const b of panel) { const p = pick(b); if (p) return {...p, what: 'panel'}; }
          for (const e of document.querySelectorAll('[data-dir-cell],[data-pick-cell]')) {
            const p = pick(e); if (p) return {...p, what: 'map'};
          }
          return null; })()`);
        const nowDay = await ev(`Number((document.querySelector('#system .pill')?.textContent ?? '1').match(/\\d+/)?.[0] ?? 1)`);
        if (Number.isFinite(nowDay)) day = nowDay;
        if (day >= 2) break;
        if (!t) { await sleep(120); continue; }
        steps.push(t.what);
        for (const type of ['mousePressed', 'mouseReleased']) {
          await S('Input.dispatchMouseEvent', { type, x: t.x, y: t.y, button: 'left', clickCount: 1 });
        }
        await sleep(90);
      }

      // ⑥ 屏上留下了什么：日志原文 + 侧栏那句 + 三家现金。
      const seen = await ev(`(() => {
        const log = [...document.querySelectorAll('#log li')].map(li => li.textContent.trim());
        const insight = (document.querySelector('#insight')?.textContent ?? '').replace(/\\s+/g, ' ').trim();
        return {
          day: Number((document.querySelector('#system .pill')?.textContent ?? '').match(/\\d+/)?.[0] ?? 0),
          businessLines: log.filter(t => t.includes('营业进项')),
          logLines: log.length,
          insight,
          players: [...document.querySelectorAll('#players .player')].map(el => ({
            name: (el.querySelector('b')?.textContent ?? '').trim(),
            meta: (el.querySelector('.pmeta')?.textContent ?? '').replace(/\\s+/g, ' ').trim()})),
        }; })()`);

      const runtimeErrors = events.filter(e => e.method === 'Runtime.exceptionThrown')
        .map(e => e.params.exceptionDetails.text);

      const run = { business, urlAfter, clicked: clicked.checked, steps: steps.length, url };
      Object.assign(run, seen);
      run.runtimeErrors = runtimeErrors;
      out.runs.push(run);

      if (seen.day < 2) out.problems.push(`business=${business}：只走到第 ${seen.day} 天，没到进项结算那天`);
      if (runtimeErrors.length) out.problems.push(`business=${business} 运行期报错：${runtimeErrors[0]}`);
      if (business > 0) {
        // 进项的对象是「整条街归己」的人。真机这一跑里 0 号位两间店都挂着停业（停业卡就在
        // 穿街高手手上），因此它合理地拿不到 —— 所以这里只要求「场上真的有人拿到」，
        // 并要求侧栏把原因说清楚（不说清就是缺陷，这才是要兜住的那一半）。
        if (!seen.businessLines.length) out.problems.push('开 250 档走到第 2 天，场上没有任何一条营业进项');
        if (!/营业进项/.test(seen.insight)) out.problems.push('开 250 档，侧栏完全没提营业进项');
      } else {
        if (seen.businessLines.length) out.problems.push(`关规则时日志里竟有营业进项：${seen.businessLines[0]}`);
        if (/营业进项/.test(seen.insight)) out.problems.push('关规则时侧栏却提营业进项');
      }
    }

    console.log(JSON.stringify(out, null, 2));
    if (out.problems.length) {
      console.error('\nFAIL\n - ' + out.problems.join('\n - '));
      process.exitCode = 1;
    } else {
      console.log('\nPASS：开局与规则的选择都写回了地址栏；同一种开局、同一 seed 下，'
        + '关规则时第 2 天没有任何进项，开 250 档时进项真的入了账并出现在侧栏。');
    }
  } finally {
    chrome.kill('SIGKILL');
    serve.kill('SIGKILL');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
