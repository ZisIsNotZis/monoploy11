import test from 'node:test';
import assert from 'node:assert/strict';

// 真人报告：带 ?slice=1 的入口直接进了「街角店主」，没机会选起手。
// 三条起手强度差很大，必须由玩家自己选。这组测试用 ui-entry 同款 DOM 适配器
// 执行真实 src/main.js，验证第一屏行为。
class Element {
  constructor() { this.html = ''; this.children = []; this.style = { setProperty() {} }; this.classList = { add() {}, toggle() {} }; this.clientWidth = 1000; this.clientHeight = 800; this.value = ''; this.hidden = false; this.textContent = ''; }
  set innerHTML(value) {
    this.html = value; this.children = [];
    for (const match of value.matchAll(/<(?:button|div|span)\b([^>]*)>/g)) {
      if (!match[1].includes('data-')) continue;
      const child = new Element(); child.dataset = {}; child.attrs = {};
      for (const a of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) { child.attrs[a[1]] = a[2]; if (a[1].startsWith('data-')) child.dataset[a[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = a[2]; }
      child.disabled = /\bdisabled\b/.test(match[1]); this.children.push(child);
    }
  }
  get innerHTML() { return this.html; }
  querySelectorAll(selector) { const m = selector.match(/\[([\w-]+)(?:="([^"]*)")?\]/); return m ? this.children.filter(c => m[1] in c.attrs && (m[2] === undefined || c.attrs[m[1]] === m[2])) : []; }
  querySelector(s) { return this.querySelectorAll(s)[0] ?? null; }
  addEventListener() {} appendChild() {} remove() {}
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

async function boot(search) {
  const ids = ['sideGrip', 'system', 'players', 'board', 'log', 'insight', 'dice', 'cards', 'hand', 'choice', 'count', 'setupRows', 'sliceStyles', 'sliceStyleNote', 'startSlice', 'start', 'setup', 'seed'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  elements.count.value = '4'; elements.seed.value = '7';
  const previous = { document: globalThis.document, window: globalThis.window, location: globalThis.location, localStorage: globalThis.localStorage, setTimeout: globalThis.setTimeout };
  let picked = null;
  globalThis.document = {
    documentElement: new Element(), body: new Element(),
    querySelector: s => s.startsWith('#') ? elements[s.slice(1)] ?? null : s.includes('sliceStyle') ? picked : null,
    querySelectorAll: () => [], createElement: () => new Element(),
  };
  globalThis.window = { innerWidth: 1400, innerHeight: 900, addEventListener() {}, removeEventListener() {} };
  globalThis.location = { search, href: `http://localhost:8000/${search}` };
  globalThis.localStorage = { getItem() { return null; } };
  globalThis.setTimeout = fn => { queueMicrotask(fn); return 1; };
  boot.count = (boot.count ?? 0) + 1;
  await import(`../src/main.js?entry=${boot.count}-${encodeURIComponent(search)}`);
  return { elements, restore: () => Object.assign(globalThis, previous), setPicked: v => { picked = v; } };
}

test('?slice=1 停在第 1 屏、不自动开局、默认不预选起手', async () => {
  const { elements, restore } = await boot('?slice=1&seed=7');
  try {
    assert.equal(elements.setup.hidden, false, 'setup must stay visible');
    assert.equal(elements.board.innerHTML, '', 'no game should have started');
    assert.match(elements.sliceStyles.innerHTML, /街角店主/);
    assert.match(elements.sliceStyles.innerHTML, /机会买家/);
    assert.match(elements.sliceStyles.innerHTML, /穿街高手/);
    assert.equal(/checked/.test(elements.sliceStyles.innerHTML), false, 'no style preselected');
  } finally { restore(); }
});

test('不选起手就点开局：留在第 1 屏并给出提示', async () => {
  const { elements, restore } = await boot('?slice=1&seed=7');
  try {
    elements.startSlice.onclick();
    await settle();
    assert.equal(elements.setup.hidden, false, 'must not start without a pick');
    assert.equal(elements.board.innerHTML, '', 'no game should have started');
    assert.equal(elements.sliceStyleNote.hidden, false);
    assert.match(elements.sliceStyleNote.textContent, /先选一手起手/);
  } finally { restore(); }
});

// 旧行为回归守卫：带 slice 参数曾直接 startSlice() 并隐藏 setup。
test('旧问题：带 slice 参数时 setup 不得被自动隐藏', async () => {
  const { elements, restore } = await boot('?slice=1&seed=7');
  try { assert.notEqual(elements.setup.hidden, true); } finally { restore(); }
});
