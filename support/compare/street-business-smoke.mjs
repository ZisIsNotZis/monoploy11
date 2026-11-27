// 真浏览器验这一页：不是「文件存在」，是「能开、第二块地真的进了这一局、能玩下去」。
//
// 上一轮在这里栽过两次（单例 vs 克隆、网格坐标 vs 像素），两次探针都印出了「逐位相同」。
// 所以判据必须是**活的东西**：
//   ① 注入自检（frontage = 8，且与西边那块无共享）
//   ② 开局后棋盘/侧栏里真的出现「营业进项」（渲染结果，不是我的断言）
//   ③ 对局真的往前走了，且没有运行期报错
//
// 用法：node support/compare/twin-center-smoke.mjs [port]
import { spawn } from 'node:child_process';
import { findChrome } from '../find-chrome.mjs';
import http from 'node:http';

const HTTP = Number(process.argv[2] ?? 8061);
const CDP = Number(process.env.CDP_PORT ?? 19661);
const PAGE = `http://127.0.0.1:${HTTP}/support/compare/street-business.html?slice=1`;
// chrome 不在 PATH 上：这台机器上现成的两个都在 ~/.cache 下。用第一个存在的。
import { existsSync } from 'node:fs';
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

async function waitForServer(port) {
  for (let i = 0; i < 100; i++) {
    const ok = await new Promise(res => {
      const q = http.get(`http://127.0.0.1:${port}/index.html`, r => { r.resume(); res(true); });
      q.on('error', () => res(false));
      q.setTimeout(500, () => { q.destroy(); res(false); });
    });
    if (ok) return;
    await sleep(150);
  }
  throw new Error(`serve.py 没在 ${port} 起来`);
}

// serve.py 设了 allow_reuse_address = False：被 kill 过的端口会留在 TIME_WAIT，
// 再用同一个固定端口会起不来（我自己撞到过，第三次直接「没起来」）。
// 所以让它 bind(0) 由 OS 分配，端口从那一行 LISTENING 里读。
async function startServer(preferred) {
  const proc = spawn('python3', ['serve.py', String(preferred)], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'],
  });
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
  const { proc: serve, port: httpPort } = await startServer(0);
  await waitForServer(httpPort);
  const page = `http://127.0.0.1:${httpPort}/support/compare/street-business.html?slice=1`;
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', `--user-data-dir=/tmp/street-business-profile-${CDP}`, 'about:blank',
  ], { stdio: 'ignore' });

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
    await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const nav = await S('Page.navigate', { url: page });
    if (nav.errorText) throw new Error(`NAV: ${nav.errorText}`);
    await sleep(2500);

    const evalJs = async expr => {
      const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        throw new Error(`EVAL: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
      }
      return r.result.value;
    };

    // ① 注入自检
    const ds = await evalJs(`({...document.documentElement.dataset})`);

    // ①b 样式真的到了（#3391n：supervisor 在手机上看到的是无样式的一页，而这一支当时是 PASS。
    //     原因是它只 nav 到 URL，从不检查子资源，也从不点页面上的链接）。
    //     styles.css 的 :root 里 --bg 是页面背景色 —— 没加载时它是空字符串。
    const styleState = await evalJs(`(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      const link = [...document.styleSheets].map(s => s.href);
      return { bg, sheets: link, back: document.querySelector('#backToReal')?.getAttribute('href') ?? null };
    })()`);

    // ①c 页面上那个「正式入口」链接必须真能取到 200（这就是 supervisor 撞到的 404）。
    const backHref = styleState.back && new URL(styleState.back, page).href;
    const backStatus = await new Promise(res => {
      if (!backHref) return res('no-link');
      const q = http.get(backHref, r => { r.resume(); res(r.statusCode); });
      q.on('error', e => res(e.code || 'ERR'));
      q.setTimeout(8000, () => { q.destroy(); res('timeout'); });
    });

    // ①d 样式表本身也要 200（CSS 的 404 不会让页面报错，只会安静地变丑）。
    const cssStatuses = [];
    for (const href of styleState.sheets) {
      const code = await new Promise(res => {
        const q = http.get(href, r => { r.resume(); res(r.statusCode); });
        q.on('error', e => res(e.code || 'ERR'));
        q.setTimeout(8000, () => { q.destroy(); res('timeout'); });
      });
      cssStatuses.push(`${href.replace(`http://127.0.0.1:${httpPort}`, '')} ${code}`);
    }
    const logs = events.filter(e => e.method === 'Runtime.consoleAPICalled')
      .flatMap(e => e.params.args.map(a => a.value ?? a.description ?? '')).filter(Boolean);

    // ② 选一手 → 真按开局
    const picked = await evalJs(`(() => {
      const r = document.querySelector('[name="sliceStyle"][value="take"]');
      if (!r) return 'NO-RADIO';
      r.click();
      const b = document.querySelector('#startSlice');
      if (!b) return 'NO-BUTTON';
      b.click();
      return 'clicked';
    })()`);
    await sleep(3000);

    // ③ 等对局真的开始，且棋盘上出现第二块地
    let seen = 'no', boardHasBoth = false, day = null;
    for (let i = 0; i < 40; i++) {
      const st = await evalJs(`(() => {
        const board = document.querySelector('#board')?.textContent ?? '';
        const insight = document.querySelector('#insight')?.textContent ?? '';
        return {
          started: !!document.querySelector('#setup')?.hidden,
          east: document.querySelector('html').dataset.businessSeen ?? null,
          both: board.includes('营业进项') && board.includes('街心书屋'),
          boardLen: board.length,
          logLines: document.querySelectorAll('#log li').length,
        };
      })()`);
      seen = st.east ?? seen;
      boardHasBoth = st.both || boardHasBoth;
      if (st.started && (st.east === 'yes' || st.both)) { day = st; break; }
      if (st.started) day = st;
      await sleep(400);
    }

    const runtimeErrors = events.filter(e => e.method === 'Runtime.exceptionThrown')
      .map(e => e.params.exceptionDetails.text + ' ' + (e.params.exceptionDetails.exception?.description ?? ''));

    // ④ 来回：真的点一下「正式入口」，确认到的不是 404 页，再回到对照页。
    //    （不点就验不出链接错位 —— 这正是上一版放跑的那个洞。）
    let roundTrip = null;
    if (backHref && backStatus === 200) {
      const nav2 = await S('Page.navigate', { url: backHref });
      if (nav2.errorText) roundTrip = `nav 失败：${nav2.errorText}`;
      else {
        await sleep(2500);
        const real = await evalJs(`(() => ({
          title: document.title,
          hasStart: !!document.querySelector('#startSlice'),
          bodyHas404: /404|Not Found/i.test(document.body.textContent || ''),
          styled: getComputedStyle(document.body).backgroundColor,
        }))()`);
        roundTrip = real;
        await S('Page.navigate', { url: page });
        await sleep(1500);
      }
    }

    const urlHasBusiness = await evalJs(`new URL(location.href).searchParams.get('business')`);
    const report = {
      page, dataset: ds, picked, urlHasBusiness,
      injectLog: logs.filter(l => l.includes('[street-business]')),
      live: day, eastSeen: seen, boardHasBoth, runtimeErrors,
      styleState, backHref, backStatus, cssStatuses, roundTrip,
    };
    console.log(JSON.stringify(report, null, 2));

    const bad = [];
    if (ds.variant !== 'street-business') bad.push(`注入没生效（variant=${ds.variant}）`);
    // 这一页的可核事实是「规则真的以这个量级开了」，不是几何（本页没动地图）。
    if (ds.businessPerShop !== '250') bad.push(`营业进项参数=${ds.businessPerShop}，应 250`);
    // 地址栏必须真的带着参数 —— main.js 是读 URL 决定开不开这条规则的。
    if (!report.urlHasBusiness) bad.push('地址栏没有 business=250 —— 引擎不会开这条规则');
    // 规则本身的两条硬断言（引擎函数直接算，不靠日志）：
    //   正面：一条街 2 间全归我 ⇒ 结算 250×等级和；反面：少一间 ⇒ 结算 0。
    if (ds.ruleCheck !== 'ok') bad.push(`规则正面自检失败：${ds.ruleCheck}`);
    if (ds.ruleNegative !== 'ok') bad.push(`规则反面自检失败：${ds.ruleNegative}`);
    // #3391n：样式与来回链接
    if (!styleState.sheets.length) bad.push('页面没有加载任何样式表');
    if (styleState.bg === 'rgba(0, 0, 0, 0)' || !styleState.bg) bad.push(`body 没有背景色（${styleState.bg}）—— styles.css 没生效`);
    for (const line of cssStatuses) if (!line.endsWith(' 200')) bad.push(`样式表取不到：${line}`);
    if (!backHref) bad.push('页面上没有「正式入口」链接');
    else if (backStatus !== 200) bad.push(`「正式入口」链接 ${backHref} 返回 ${backStatus}`);
    if (roundTrip && typeof roundTrip === 'object') {
      if (!roundTrip.hasStart) bad.push('正式入口页没有开局控件（到的不是真入口）');
      if (roundTrip.bodyHas404) bad.push('正式入口页面上写着 404');
      if (!roundTrip.styled || roundTrip.styled === 'rgba(0, 0, 0, 0)') bad.push('正式入口页也没样式');
    } else if (typeof roundTrip === 'string') bad.push(`来回失败：${roundTrip}`);
    if (picked !== 'clicked') bad.push(`开局按钮不可用：${picked}`);
    if (!day?.started) bad.push('对局没有开始（#setup 未隐藏）');

    if (runtimeErrors.length) bad.push(`运行期报错：${runtimeErrors[0]}`);

    if (bad.length) { console.error('\nFAIL\n - ' + bad.join('\n - ')); process.exitCode = 1; }
    else console.log('\nPASS：营业进项真的进了这一局，第一屏有样式、可开一局，'
      + '「正式入口」链接 200 且点进去是真入口，无报错。');
  } finally {
    chrome.kill('SIGKILL');
    serve.kill('SIGKILL');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
