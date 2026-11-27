import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { landingText, reachableLandings, routePreview } from '../src/engine/insight.js';
import { render } from '../src/ui/render.js';

const make = () => startSession(createSliceConfig({ seed: 7, style: 'grow' }));
const element = () => ({ innerHTML: '', hidden: false, clientWidth: 1000, clientHeight: 800, style: {}, classList: { toggle() {} }, querySelector() { return { onclick: null }; }, querySelectorAll() { return []; } });
const root = () => Object.fromEntries(['system', 'players', 'board', 'log', 'insight', 'dice', 'cards', 'hand', 'choice'].map(k => [k, element()]));

// 真实局面：1 号位从 3,2 走到 4,2；还没用完步数时岔路提示就在 4,2 上弹出（flow.chooseStep）。
const atFork = () => {
  const s = make();
  const p = s.players[0];
  p.position = '4,2';
  p.lastNode = '3,2';
  p.facing = '5,2';
  return { s, p, options: ['5,2', '4,3'] };
};

// 真人报告：第 1 天岔路两条选项只显示同一句「书屋开售」，光凭它分不出路线。
test('旧逻辑（只拼落点说明）在这个岔路确实两路同文——这就是要修的真问题', () => {
  const { s, p, options } = atFork();
  const oldSpan = (id, remaining) => {
    const clone = { ...p, position: id, lastNode: p.position, facing: null };
    const nodes = remaining > 0 ? reachableLandings(s, clone, Math.max(0, remaining - 1)) : [id];
    return [...new Set(nodes.map(n => landingText(s, p, n)))].join('；');
  };
  for (const remaining of [1, 2, 3]) {
    const texts = options.map(id => oldSpan(id, remaining));
    assert.equal(texts[0], texts[1], `remaining=${remaining}`);
  }
});

test('day-1 fork at 4,2 now gives the two routes distinguishable text', () => {
  const { s, p, options } = atFork();
  assert.equal(s.day, 1);
  for (let remaining = 1; remaining <= 6; remaining++) {
    const label = id => {
      const x = routePreview(s, p, p.position, id, remaining);
      return `${x.text}|||${x.outlook.join('、')}`;
    };
    assert.notEqual(label(options[0]), label(options[1]), `remaining=${remaining}`);
  }
});

test('route choice panel renders both directions with distinct text', () => {
  const { s, p, options } = atFork();
  const r = root();
  s.pending = { type: 'direction', player: p, options, remainingSteps: 1 };
  render(r, s, {});
  const buttons = [...r.choice.innerHTML.matchAll(/<button class="route-choice"[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1]);
  assert.equal(buttons.length, 2, r.choice.innerHTML);
  assert.notEqual(buttons[0], buttons[1], r.choice.innerHTML);
  assert.match(r.choice.innerHTML, /向右/);
  assert.match(r.choice.innerHTML, /向下/);
  // #710 文案从「再往前可达：」改为「再往前：N 步后 …」（带步数分组）。
  assert.match(r.choice.innerHTML, /再往前：/);
});
