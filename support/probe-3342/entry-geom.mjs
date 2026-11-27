// 390×844 第一屏几何：争街提示在不在、会不会把「开一局」挤出视口。
// 用原始 CDP（不引第三方库），与 support/full-game/drive-full.mjs 同一做法。
import { setTimeout as delay } from 'node:timers/promises';

const HTTP = process.env.HTTP, CDP = process.env.CDP;
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
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

async function probe(extra) {
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html?slice=1&style=grow&seed=1${extra}` });
  await delay(1200);
  const r = await send('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `(() => {
      const note = document.querySelector('#sliceStyleNote');
      const start = document.querySelector('#startSlice');
      const nr = note ? note.getBoundingClientRect() : null;
      const sr = start ? start.getBoundingClientRect() : null;
      const cx = sr ? sr.left + sr.width / 2 : 0, cy = sr ? sr.top + sr.height / 2 : 0;
      const hit = (() => {
        if (!sr || cy < 0 || cy > innerHeight) return 'out-of-viewport';
        const el = document.elementFromPoint(cx, cy);
        return el && (el === start || start.contains(el)) ? 'itself' : (el ? el.tagName + '.' + el.className : 'null');
      })();
      return {
        viewport: { w: innerWidth, h: innerHeight, docH: document.documentElement.scrollHeight },
        note: note ? { hidden: note.hidden, text: note.textContent.trim(), top: nr.top, bottom: nr.bottom,
                       inView: nr.top >= 0 && nr.bottom <= innerHeight } : null,
        start: sr ? { top: sr.top, bottom: sr.bottom, hit, inView: sr.bottom <= innerHeight } : null,
        bodyClass: document.body.className,
      };
    })()`,
  });
  return r.result?.result?.value;
}

const plain = await probe('');
const cross = await probe('&cross=1');
const report = { plain, cross, checks: {} };
report.checks.noteVisible = !!cross.note && !cross.note.hidden && cross.note.text.length > 0;
report.checks.noteInView = !!cross.note && cross.note.inView;
report.checks.startHit = cross.start?.hit === 'itself';
// 我上一版把门槛写成「位移 < 24px」——那是我自己编的数，没有依据，而且它把
// 「按钮仍然好点、还在视口里」这个真正要紧的事实说成了失败。
// 本项目有过先例（6_SLICE.md）：多一行把第三张卡推出了 elementFromPoint 可点范围。
// 所以判据应该是**后果**：开始键自身可点 + 底部还留着一段可预期的余量。
// 位移仍然打印出来（report.shiftPx），但不拿它当阈值。
report.shiftPx = Math.round(((cross.start?.top ?? 0) - (plain.start?.top ?? 0)) * 10) / 10;
report.checks.startHasSlack = !!cross.start && cross.start.bottom <= cross.viewport.h - 80;
// 对照：不带 cross 时不应出现这句（否则说明参数没生效）
report.checks.noteAbsentWithoutParam = !plain.note || plain.note.hidden || !plain.note.text.includes('争街');
report.checks.urlTookParam = cross.bodyClass.includes('slice-entry');
console.log(JSON.stringify(report, null, 1));
const failed = Object.entries(report.checks).filter(([, v]) => !v);
if (failed.length) { console.error('FAILED', failed.map(([k]) => k)); process.exitCode = 1; }
else console.log('GEOM: PASS');
ws.close();
