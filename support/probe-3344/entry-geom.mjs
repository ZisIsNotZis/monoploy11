// #3344 第一屏几何：多出来的「开局」选择条会不会把「开一局」挤出视口。
//
// 为什么必须在这两种画幅上各量一次：本项目已经有过一次「多一行 ⇒ 第三张卡被推出
// elementFromPoint 可点范围」（6_SLICE.md：bottom 830 → 862），而 360×640 那一档
// 本来就要先整页滚一次才能点到按钮（RESULT-3278 §5.1）。再加 2 块牌是往同一处加压。
//
// 判据是**后果**，不是我编的位移阈值（entry-geom.mjs 上一版栽在这上面）：
//   ① #startSlice 仍在视口内、且中心点 elementFromPoint 命中它自己；
//   ② 两块开局牌与三张起手都可见（hidden=false、有文本、在视口内）；
//   ③ 选中「争街」与选中「整条街」时，按钮几何相同（选择不该改变布局高度）。
// 位移只打印，不当阈值。
import { setTimeout as delay } from 'node:timers/promises';

const HTTP = process.env.HTTP, CDP = process.env.CDP;
const VIEWPORTS = [[390, 844], [360, 640]];

const target = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = e => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise(res => {
  const n = ++id;
  pending.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params }));
});
await send('Page.enable');
await send('Runtime.enable');

async function measure(width, height, extra) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html?slice=1&style=grow&seed=1${extra}` });
  await delay(1200);
  const r = await send('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `(() => {
      const box = el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const hit = (cy < 0 || cy > innerHeight) ? 'out-of-viewport'
          : (() => { const h = document.elementFromPoint(cx, cy); return h && (h === el || el.contains(h)) ? 'itself' : (h ? h.tagName + '.' + h.className : 'null'); })();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), hit,
                 inView: r.top >= 0 && r.bottom <= innerHeight,
                 text: (el.textContent || '').trim().slice(0, 60) };
      };
      const picked = document.querySelector('[name="sliceOpening"]:checked')?.value ?? null;
      return {
        viewport: { w: innerWidth, h: innerHeight, docH: document.documentElement.scrollHeight },
        openings: [...document.querySelectorAll('.opening-choice')].map(box),
        picked,
        styles: [...document.querySelectorAll('.style-choice')].map(box),
        start: box(document.querySelector('#startSlice')),
      };
    })()`,
  });
  return r.result?.result?.value;
}

// 基线：把新加的这块牌整块藏起来，再量一次。这样能回答「我有没有把按钮推到一个
// 它原本不在的地方」——而不是我单方面定一个「必须在视口里」的标准然后判自己不过。
// 360×640 那一档本项目早就记录过要先整页滚一次（RESULT-3278 §5.1），
// 所以真正的判据是「不比原来差」。
async function measureBaseline(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html?slice=1&style=grow&seed=1` });
  await delay(1200);
  const r = await send('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `(() => {
      for (const sel of ['#sliceOpening', '.opening-label']) {
        const el = document.querySelector(sel);
        if (el) el.style.display = 'none';
      }
      const el = document.querySelector('#startSlice');
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = (cy < 0 || cy > innerHeight) ? 'out-of-viewport'
        : (() => { const h = document.elementFromPoint(cx, cy); return h && (h === el || el.contains(h)) ? 'itself' : (h ? h.tagName : 'null'); })();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), hit,
               inView: r.top >= 0 && r.bottom <= innerHeight };
    })()`,
  });
  return r.result?.result?.value;
}

const report = { viewports: [], checks: {} };
for (const [w, h] of VIEWPORTS) {
  const contested = await measure(w, h, '');
  const whole = await measure(w, h, '&cross=0');
  const baseline = await measureBaseline(w, h);
  report.viewports.push({ size: `${w}x${h}`, contested, whole, baseline });
  const tag = `${w}x${h}`;
  // 后果判据：不比基线差（若基线本来就点不到，就不拿「必须点得到」去判）。
  report.checks[`${tag} no worse than baseline`] = baseline.hit === 'out-of-viewport'
    ? true : contested.start?.hit === baseline.hit;
  report.checks[`${tag} baseline was reachable, still reachable`] = baseline.hit !== 'itself'
    || contested.start?.hit === 'itself';
  report.checks[`${tag} two opening cards visible`] = contested.openings?.length === 2
    && contested.openings.every(o => o && o.text.length > 6);
  report.checks[`${tag} opening cards in viewport`] = contested.openings?.every(o => o.inView) === true;
  report.checks[`${tag} three starters visible`] = contested.styles?.length === 3
    && contested.styles.every(s => s && s.text.length > 6);
  report.checks[`${tag} contested is the default pick`] = contested.picked === 'contested';
  report.checks[`${tag} ?cross=0 picks the old table`] = whole.picked === 'whole';
  report.checks[`${tag} picking does not move the button`] = contested.start?.top === whole.start?.top;
  // 「一点都不比原来低」这条我一开始写成了逐像素比较 —— 那等于禁止在这个屏上
  // 新增任何东西，而我确实新增了一块选择。真正要保的不是位移，而是后果：
  // 开始键仍在视口内且自己是命中目标（上面两条已咬），且三张起手没被挤出去（下一条）。
  // 位移量照实打印，不当阈值（#3342 的 entry-geom 也栽在同一处）。
  report.checks[`${tag} starters not pushed out`] = contested.styles?.every(s => s.inView) === true;
  report.checks[`${tag} no new page scroll needed for the button`] =
    contested.start?.bottom <= contested.viewport.h;
}
console.log(JSON.stringify(report, null, 1));
const failed = Object.entries(report.checks).filter(([, v]) => !v);
if (failed.length) { console.error('FAILED', failed.map(([k]) => k)); process.exitCode = 1; }
else console.log('GEOM-3344: PASS');
ws.close();
