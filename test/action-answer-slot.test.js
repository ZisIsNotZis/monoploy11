import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// #3278：气泡在播的时候，动作屏上的掷骰键必须**真的接住点击**。
//
// 实测（360×640 真浏览器，support/full-game/OUT-N-360-press/record-8-summary.json）：
//   18 次按压时页面上有活气泡（台词「很快出来。」= lines.js 的 jail 台词），全部是 roll 键，
//   且共享同一个屏幕指纹（第 12 天 / logLen 3447 / rollDisabled=false / choiceHidden=true）。
//   点击的物理落点是对的（hit=itself 60/60），键也是 enabled —— 但点击被丢掉。
//
// 根因（旧 src/main.js 的 ui.ask 顺序）：
//   flow.js 的 actionPhase 先 `ui.render(state)`（phase='action'、pending=null ⇒ canRoll 为真），
//   再 `await ui.ask(...)`；旧 ask 要 `await flushSpeech()`（每句 1.2–1.8s）之后才
//   `active = {…}`。这段窗口里 `answer(value)` 撞上 `if (!active) return;` ⇒ 静默丢弃。
//   气泡不是 ask 自己发的：main.js 的 `say(p, 'jail')` 是 fire-and-forget，
//   所以「下一回合动作屏已经画出来、上一句气泡还在播」是常态，不是罕见竞态。
//
// 这条测试守的是 ask 的**时序契约**（行为证据由 360/390 整局的 pressLog 出）：
//   人类分支必须在等待气泡之前就换上限本屏的答案槽并画屏；AI 分支保持「先等气泡」。
// 牙齿：把旧顺序的文本塞回去，violations() 必须报红。

const SOURCE = new URL('../src/main.js', import.meta.url);

// 从 `async ask(prompt) {` 起切出该函数体（靠两空格缩进的 `},` 收尾）。
function askBody(text) {
  const start = text.indexOf('async ask(prompt) {');
  assert.ok(start >= 0, 'ui.ask must still exist');
  const rest = text.slice(start);
  const end = rest.indexOf('\n  },');
  assert.ok(end > 0, 'ask body should end with a 2-space-indented closing brace');
  return rest.slice(0, end);
}

// 契约检查：返回问题列表（空 = 合规）。
function violations(body) {
  // 只看代码行：注释里引用的旧顺序不是实现。
  body = body.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const problems = [];
  const aiAt = body.indexOf("prompt.player?.controller === 'ai'");
  assert.ok(aiAt >= 0, "ask must branch on prompt.player?.controller === 'ai'");

  // AI 分支是一个完整 if 块：切掉它，剩下的就是人类这一屏的时序。
  const open = body.indexOf('{', aiAt);
  const close = body.indexOf('\n    }\n', open);
  assert.ok(open > aiAt && close > open, 'AI branch must be a closed block');
  const aiText = body.slice(aiAt, close);
  const human = body.slice(0, aiAt) + body.slice(close);

  const firstAwaitFlush = human.indexOf('await flushSpeech()');
  const slot = human.indexOf('active = {');
  const renderAt = human.indexOf('rerender()');
  const pendingAt = human.indexOf('applyPromptToState(prompt)');

  if (slot < 0) problems.push('human answer slot (`active = {…}`) is missing');
  if (firstAwaitFlush >= 0 && slot >= 0 && slot > firstAwaitFlush) {
    problems.push('human answer slot is mounted after the speech wait (clicks get dropped)');
  }
  if (firstAwaitFlush >= 0 && (renderAt < 0 || renderAt > firstAwaitFlush)) {
    problems.push('human prompt is rendered after the speech wait (screen lags the slot)');
  }
  if (firstAwaitFlush >= 0 && (pendingAt < 0 || pendingAt > firstAwaitFlush)) {
    problems.push('pending is applied after the speech wait (screen renders the previous phase)');
  }
  if (slot >= 0 && pendingAt >= 0 && slot > pendingAt) {
    problems.push('answer slot must be mounted before applyPromptToState()');
  }

  const aiAwait = aiText.indexOf('await flushSpeech()');
  const aiAnswerAt = aiText.indexOf('aiAnswer(');
  if (aiAwait < 0 || (aiAnswerAt >= 0 && aiAwait > aiAnswerAt)) {
    problems.push('AI branch must await flushSpeech() before aiAnswer()');
  }
  return problems;
}

test('ui.ask 在等气泡之前就装上人类答案槽并画屏；AI 分支仍先等气泡', async () => {
  const body = askBody(await readFile(SOURCE, 'utf8'));
  assert.deepEqual(violations(body), []);
});

test('牙：把旧顺序塞回去，契约检查必须报红', async () => {
  const body = askBody(await readFile(SOURCE, 'utf8'));
  // 旧顺序的等效文本：人类这一屏先等气泡，之后才装槽/画屏。
  const legacy = body
    .replace('      active = { prompt, resolve: settle };', '      await flushSpeech();\n      active = { prompt, resolve: settle };')
    .replace('      rerender();', '      rerender();');
  const slot = legacy.indexOf('active = {');
  const flush = legacy.indexOf('await flushSpeech()');
  assert.ok(flush >= 0 && slot > flush, 'the teeth only work if the legacy text really waits first');
  const found = violations(legacy);
  assert.ok(found.length >= 1, `legacy ordering must be rejected, got ${JSON.stringify(found)}`);
  assert.ok(found.includes('human answer slot is mounted after the speech wait (clicks get dropped)'));
});
