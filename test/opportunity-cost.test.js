import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { render } from '../src/ui/render.js';

// #1144：加盖那一刻的「这一笔花掉什么」vs「不花它换到什么」。
//
// 为什么需要：#1143 让三处都诚实了，但加盖框上只有「同规则 72 局」的背景句 ——
// 玩家知道这一笔占全场租金 64.3%，却不知道不花它能把钱换成什么。
// 缺的那一半正好是决定的那一半。
//
// 钉四件事：
//   1. 有替代地时，两边都在同一帧：升级前后的每次租金 + 「不花它够买什么、收多少」；
//   2. 本局侧必须自带口径标签，且明说它不是上面的 72 局常数（判据第 1 条，会真触发）；
//   3. 没有替代地时不沉默、不印 0 —— 要写「此刻没有可买的无主地」；
//   4. 不许预测/推荐口气，也不许把 72 局常数冒充本局。

function root() {
  const mk = () => ({ innerHTML: '', hidden: false, scrollTop: 0, scrollHeight: 0,
    querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
    style: {}, getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }) });
  return new Proxy({}, { get: (t, k) => (t[k] ??= mk()) });
}
const noop = new Proxy({}, { get: () => () => {} });
const slice = (seed = 7, style = 'grow') => startSession(createSliceConfig({ seed, style }));

function renderBuild(state, cellId, cost) {
  const r = root();
  const saved = state.pending;
  state.pending = { type: 'build', cellId, cost, label: '小地产' };
  render(r, state, noop);
  state.pending = saved;
  return r.choice.innerHTML;
}
const opOf = html => /data-opportunity[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1];

test('#1144 加盖框并排给出本局代价与机会成本，且两句口径各自标明', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 1;
  p.cash = 40_000;
  const html = renderBuild(s, id, 10_000);

  const op = opOf(html);
  assert.ok(op, `加盖框没有本局机会成本句：${html}`);

  // 1) 两边都在：升级前后的每次租金，以及「不花它」能买到什么。
  assert.match(op, /每次被踩到 \d[\d,]*→\d[\d,]*/, `没给升级前后的每次租金：${op}`);
  assert.match(op, /不花它[^。]*够买/, `没给机会成本那一侧：${op}`);
  assert.match(op, /它每次被踩到收 \d[\d,]*/, `替代地没给每次收多少：${op}`);

  // 2) 口径：本局侧必须自称本局，且必须点明与 72 局常数不同。
  assert.ok(op.includes('本局账本'), `本局句缺口径标签：${op}`);
  assert.ok(op.includes('不是上面的 72 局常数'), `没标出与常数句的区别：${op}`);
  // 反向：本局句里不许出现常数主语（会被读成常数）。
  assert.equal(/同规则 72 局/.test(op), false, `本局句里混进了常数主语：${op}`);

  // 3) 口气：只给数，不给建议。
  assert.equal(/预计|大概会|应该会|值得/.test(op), false, `出现了预测/推荐口气：${op}`);

  // 4) 常数句仍在（没有为了放新句而删旧句），且排在后面（先决定、后背景）。
  const fk = /data-forward-k[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1];
  assert.ok(fk && fk.includes('同规则 72 局'), `常数句被弄丢了：${html}`);
  assert.ok(html.indexOf('data-opportunity') < html.indexOf('data-forward-k'),
    '本局句排到了常数句后面（玩家会先读 72 局背景）');
});

test('#1144 没有可买无主地时照实说，不沉默也不印 0', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 1;
  // 把所有无主小店判给对手，制造「无可买」的局面（不改棋盘，只改归属）。
  for (const plot of s.map.plots) {
    if (plot.big) continue;
    const pr = s.properties[plot.id] ??= {};
    if (!pr.ownerId) pr.ownerId = s.players[1].id;
  }
  const html = renderBuild(s, id, 10_000);
  const op = opOf(html);
  assert.ok(op, `无替代地时句子整个消失了（沉默不是回答）：${html}`);
  assert.ok(op.includes('此刻没有可买的无主地'), `没说清为什么没有机会成本：${op}`);
  assert.ok(op.includes('本局账本'), `降级分支丢了口径标签：${op}`);
  assert.equal(/够买/.test(op), false, `没有替代地却写了「够买」：${op}`);
});

test('#1144 停业街不重复说话，交给已签的停业句', () => {
  const s = slice();
  const [p] = s.players;
  const id = p.properties[0];
  s.properties[id].level = 1;
  s.properties[id].closed = 2;
  const html = renderBuild(s, id, 10_000);
  assert.equal(/data-opportunity/.test(html), false, `停业街还额外说了一段本局账：${html}`);
  assert.ok(/停业/.test(html), '停业这件事整个没人说了');
});
