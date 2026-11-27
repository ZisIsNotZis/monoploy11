// #3391v：三句起手文案从 slice.js 的 hook 字段搬进了 main.js 的 HOOKS。
//
// 为什么需要这支：搬完之后「slice.js 字节没变」是个强证据，但它证明的是**字节**，
// 不是**玩家看到什么**。而 main.js 写的是 `HOOKS[s.id] ?? s.hook` —— 只要 HOOKS
// 少了某个 id，屏上会静默回退到 slice.js 里那句旧文案，而其他判据全绿。
// 所以这里读屏上的字：新的必须在、旧的一条都不能在。
//
// 用法：node support/probe-3391/hook-render.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { findChrome } from '../find-chrome.mjs';

const CDP = Number(process.env.CDP_PORT ?? 19711);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = findChrome();

// 新文案（main.js 的 HOOKS）与旧文案（slice.js 的 hook）。两边都判。
const NEW_HOOKS = { grow: '翻修 + 旺季', take: '收购 + 定步', cross: '停业 + 定步' };
const OLD_HOOKS = ['把小店经营成别人绕不开的招牌', '看准别人养好的店', '封住危险街'];

function getJson(path) {
  return new Promise((res, rej) => {
    const q = http.get(`http://127.0.0.1:${CDP}${path}`, x => {
      let b = '';
      x.on('data', d => (b += d));
      x.on('end', () => res(JSON.parse(b)));
    });
    q.on('error', rej);
  });
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
    proc.on('exit', c => { clearTimeout(timer); rej(new Error(`serve.py 退出 ${c}`)); });
  });
  return { proc, port };
}

const problems = [];
const { proc: serve, port } = await startServer();
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--no-first-run',
  '--no-default-browser-check', '--disable-gpu', `--user-data-dir=/tmp/hook-render-${CDP}`,
  'about:blank'], { stdio: 'ignore' });

try {
  let version = null;
  for (let i = 0; i < 80 && !version; i++) {
    try { version = await getJson('/json/version'); } catch { await sleep(250); }
  }
  if (!version) throw new Error(`CDP ${CDP} 不可达`);
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
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await S('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?slice=1&style=grow&seed=1` });
  await sleep(1800);

  const screen = await S('Runtime.evaluate', {
    expression: `(() => {
      const cards = [...document.querySelectorAll('.style-choice')].map(el => ({
        id: el.querySelector('input[name=sliceStyle]')?.value,
        text: (el.textContent || '').replace(/\\s+/g, ' ').trim(),
      }));
      return { cards };
    })()`, returnByValue: true,
  });
  const cards = screen.result.value.cards;
  console.log('屏上的三张卡：');
  for (const c of cards) console.log(`  ${c.id}: ${c.text}`);

  if (cards.length !== 3) problems.push(`首屏起手卡应当 3 张，实得 ${cards.length}`);
  for (const [sid, want] of Object.entries(NEW_HOOKS)) {
    const card = cards.find(c => c.id === sid);
    if (!card) { problems.push(`缺少起手卡 ${sid}`); continue; }
    if (!card.text.includes(want)) {
      problems.push(`${sid} 的屏上文字没有新文案「${want}」—— 很可能是 HOOKS[${sid}] 缺失、`
        + `静默回退到了 slice.js 的旧 hook。实得：${card.text}`);
    }
  }
  for (const old of OLD_HOOKS) {
    if (cards.some(c => c.text.includes(old))) problems.push(`屏上出现了已收回的旧文案「${old}」`);
  }
} finally {
  chrome.kill('SIGKILL');
  serve.kill('SIGKILL');
}

if (problems.length) {
  console.error('\nFAIL\n - ' + problems.join('\n - '));
  process.exitCode = 1;
} else {
  console.log('\nPASS：三张起手卡都渲染出本轮的新文案，旧文案一条都没上屏。');
}
