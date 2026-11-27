import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { render } from '../src/ui/render.js';

// #3278：屏幕上「看起来可点」必须等于「点下去会被接住」。
//
// 实测（360×640 真浏览器，support/full-game/OUT-S-360-ask/record-8-summary.json）：
//   pressLog[40..59] 是同一张动作屏上的 20 次 roll 按压，`day` 与 `logLen` 全程不变
//   （第 12 天 / 3535），每次 `hit=itself`（落点就是键本身）、`rollDisabled=false`，
//   而页面上有活气泡（「很快出来。」）。第一刀（ui.ask 先装槽再等气泡）只接住了**第一次**：
//   一旦 answer() 把槽清空，从点击到引擎前进之间还隔着 settle 里的 flushSpeech()
//   （一句气泡 1.2–1.8s），这张屏却再没人重画 ⇒ roll/手牌继续 enabled，点击撞上
//   `if (!active) return;` 被静默吞掉。玩家很自然会再点一次，于是同一次回合被点了 20 遍。
//
// 这条守两件事：
//   A. 行为：render 收到 answerable:false 时，动作屏的掷骰键与手牌必须 disabled；
//      省略 opts（旧的三参数调用）保持原样 —— 纯渲染测试和 tools 里的渲染不该被牵连。
//   B. 契约：main.js 的 rerender 把「答案槽开着吗」传给 render，
//      answer() 在清空槽之后、resolve 之前对 action 屏重画一次。
// 牙齿：把 canRoll 退回旧表达式、或从 answer() 里删掉那次重画，必须红。

const element = () => ({
  innerHTML: '', hidden: false, clientWidth: 1000, clientHeight: 800,
  style: { setProperty() {} }, classList: { toggle() {} }, dataset: {},
  getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0, left: 0, width: 0 }),
  addEventListener() {},
  querySelector: () => ({ onclick: null, dataset: {}, style: {}, addEventListener() {} }),
  querySelectorAll: () => [],
});
const root = () => Object.fromEntries(
  ['system', 'players', 'board', 'log', 'insight', 'dice', 'cards', 'hand', 'choice']
    .map(k => [k, element()]));

// 一张真实的人类动作回合：style=grow 的驾驶位（controller='human'）、phase='action'、没有 pending。
function actionTurn() {
  const s = startSession(createSliceConfig({ style: 'grow', seed: 1 }));
  s.phase = 'action';
  s.pending = null;
  s.mapPick = null;
  return s;
}

const rollAttrs = el => [...el.innerHTML.matchAll(/<button data-roll="\d+"([^>]*)>/g)].map(m => m[1]);
const cardAttrs = el => [...el.innerHTML.matchAll(/<button class="slice-card" data-card="\d+"([^>]*)>/g)].map(m => m[1]);
const allDisabled = list => list.length > 0 && list.every(a => a.includes('disabled'));

test('A 闸门：answerable:false 时动作屏的掷骰键与手牌必须 disabled；三参数调用保持旧行为', () => {
  const s = actionTurn();

  const r1 = root();
  render(r1, s, {});
  const r1roll = rollAttrs(r1.dice);
  assert.ok(r1roll.length >= 1, '前提：动作屏必须画出一个掷骰键');
  assert.equal(allDisabled(r1roll), false, '前提：三参数调用下掷骰键可用，否则本测试没有比较对象');

  const r2 = root();
  render(r2, s, {}, { answerable: true });
  assert.deepEqual(rollAttrs(r2.dice), r1roll, 'answerable:true 必须与省略 opts 画出同一张键');

  const r3 = root();
  render(r3, s, {}, { answerable: false });
  assert.ok(allDisabled(rollAttrs(r3.dice)),
    '槽已清空（引擎还没前进）时掷骰键仍画成可点 —— 玩家会点它，而 answer() 会静默丢掉');
  const cards = cardAttrs(r3.cards);
  assert.ok(cards.length > 0, '前提：这一回合手上要有牌，否则手牌那一半没被覆盖');
  assert.ok(allDisabled(cards), '槽已清空时手牌仍画成可点 —— 同样是「画得出、点不着」');
});

test('A 牙：canRoll 必须真的问 opts.answerable', async () => {
  const text = await readFile(new URL('../src/ui/render.js', import.meta.url), 'utf8');
  const at = text.indexOf('function renderHand(root, state, p, actions');
  assert.ok(at >= 0, 'renderHand must exist');
  const body = text.slice(at, text.indexOf('\n}', at));
  const canRollLine = body.split('\n').find(l => l.includes('const canRoll ='));
  assert.ok(canRollLine, 'renderHand must compute canRoll');
  assert.match(canRollLine, /opts\.answerable/,
    'canRoll 没有问「答案槽开着吗」⇒ 又回到「画得出、点不着」');
  const callAt = text.indexOf('renderHand(root, state, p, actions');
  const callLine = text.slice(callAt, text.indexOf('\n', callAt));
  assert.match(callLine, /opts\)/, 'render 必须把 opts 交给 renderHand（否则闸门只写了一个形参）');
});

test('B 契约：rerender 传 answerable=!!active；answer() 清槽后、resolve 前对 action 屏重画一次', async () => {
  const text = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(text, /render\(root, state, actions, \{answerable: !!active\}\)/,
    'rerender 必须把答案槽状态交给 render');

  const at = text.indexOf('function answer(value) {');
  assert.ok(at >= 0, 'answer() must exist');
  const body = text.slice(at, text.indexOf('\n}', at));
  const code = body.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const clear = code.indexOf('active = null;');
  const repaint = code.indexOf('rerender();');
  const resolve = code.indexOf('resolve(value);');
  assert.ok(clear >= 0 && resolve >= 0, 'answer() must clear the slot and resolve');
  assert.ok(repaint >= 0, 'answer() 清槽后必须重画 —— 否则这张屏还画着 enabled 的 roll/手牌');
  assert.ok(repaint > clear, '重画必须在清槽之后（先改状态再画，否则画出来的还是旧的）');
  assert.ok(repaint < resolve, '重画必须在 resolve 之前：resolve 之后引擎可能已经换了屏');
  assert.match(code, /prompt\?\.type === 'action'/,
    '重画只对动作屏做（其它屏会在引擎换屏前先被翻成动作屏）');
});
