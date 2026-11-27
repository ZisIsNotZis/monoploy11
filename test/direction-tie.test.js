import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { render } from '../src/ui/render.js';
import { buildAdj } from '../src/engine/board-v2.js';
import { readFileSync } from 'node:fs';
import { nextTurnWords, nextTurnStreetNames } from '../src/engine/insight.js';

// #719 D1：玩家在岔口点之前，两个方向不能显示同一句话。
//
// 真实读数（345 个 direction 帧，grow/take/build × seed 5/7/11）：
//   改前：15 帧有两选项正文逐字相同（发生率 4.3%）
//   改后：0 帧
// 典型（改前）grow/seed=5 第1天 从 7,2 出发 剩余 1 步：
//   向左 → 6,2「街心书屋：第 4 天开售」
//   向下 → 7,3「街心书屋：第 4 天开售」

class El {
  constructor() { this.html = ''; this.children = []; this.style = { setProperty() {} }; this.hidden = false;
    this.classList = { add() {}, remove() {}, toggle() {} }; this.clientWidth = 1000; this.clientHeight = 800; this.value = ''; }
  set innerHTML(v) { this.html = v; this.children = [];
    for (const m of v.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const c = new El(); c.attrs = {};
      c.text = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      for (const a of m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) { if (!a[1]) continue; c.attrs[a[1]] = a[2] ?? ''; }
      this.children.push(c);
    } }
  get innerHTML() { return this.html; }
  querySelectorAll(q) {
    if (/^\.[\w-]+$/.test(q)) return this.children.filter(c => String(c.attrs.class ?? '').split(/\s+/).includes(q.slice(1)));
    const m = q.match(/\[([\w-]+)(?:="([^"]*)")?\]/);
    return m ? this.children.filter(c => m[1] in c.attrs && (m[2] === undefined || c.attrs[m[1]] === m[2])) : [];
  }
  querySelector(q) { return this.querySelectorAll(q)[0] ?? null; }
  appendChild(n) { this.children.push(n); return n; }
  remove() {} addEventListener() {}
  getBoundingClientRect() { return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }; }
}
const makeRoot = () => Object.fromEntries(
  ['system','players','board','log','insight','dice','cards','hand','choice'].map(k => [k, new El()]));

const dirWord = (state, from, to) => {
  const a = state.map.nodes.find(n => n.id === from), b = state.map.nodes.find(n => n.id === to);
  return b.x > a.x ? '向右' : b.x < a.x ? '向左' : b.y > a.y ? '向下' : '向上';
};

// 跑真局，在每个 direction 帧上取「玩家实际看到的每个选项文本」与方向词。
async function eachDirectionFrame(cb) {
  let frames = 0;
  for (const style of ['grow', 'take', 'build']) {
    for (const seed of [5, 7, 11]) {
      const s = startSession(createSliceConfig({ seed, style }));
      await runGame(s, {
        render() {}, async step() {}, async say() {},
        async ask(prompt) {
          if (prompt.type === 'direction') {
            frames++;
            const r = makeRoot();
            const from = prompt.player.position;
            s.pending = { type: 'direction', options: prompt.options, remainingSteps: prompt.remainingSteps };
            s.phase = 'move';
            render(r, s, new Proxy({}, { get: () => () => {} }));
            s.pending = null;
            const opts = r.choice.querySelectorAll('.route-choice').map(b => ({
              to: b.attrs['data-dir'],
              dir: dirWord(s, from, b.attrs['data-dir']),
              // 去掉方向词后的正文：两个方向词不同不是区分，正文不同才是
              // 去掉方向词后的正文：两个方向词不同不是区分，正文不同才是。
              // 还要去掉 .route-inline-more 这条**提示**（styles.css 里 display:none，
              // 只在 (320..420 宽 且 ≤500 高) 且 .route-choice 有 :focus-visible 时才 inline）。
              // 它拼在 <b> 内、选项 0 上，永不属于正文；不剥掉的话选项 0 恒比选项 1 多一段，
              // D1 会变成恒绿（真重文被这层提示挡住），这正是 #3264 抓到的量具缺陷。
              body: b.text.replace(/^(向右|向左|向上|向下)\s*/, '')
                .replace(/共 2 个方向 · 可逐项查看\s*/, '').trim(),
              raw: b.text,
            }));
            cb({ style, seed, day: s.day, from, remaining: prompt.remainingSteps, opts });
          }
          return aiAnswer(prompt, s);
        },
      });
    }
  }
  return frames;
}

test('#719 D1：345 个真实岔路帧里，没有两个选项正文逐字相同', async () => {
  const tied = [];
  const frames = await eachDirectionFrame(({ style, seed, day, from, remaining, opts }) => {
    const seen = new Map();
    for (const o of opts) {
      if (seen.has(o.body)) tied.push({ style, seed, day, from, remaining, a: seen.get(o.body), b: o });
      else seen.set(o.body, o);
    }
  });
  assert.ok(frames >= 300, `帧数异常：${frames}`);
  assert.deepEqual(tied.map(t => `${t.style}/${t.seed} D${t.day} @${t.from}: ${t.a.dir} vs ${t.b.dir} 「${t.a.body}」`), [],
    '这些帧里玩家点之前分不出两条路');
});

test('#719 C2：只在真重文时补，不重文的帧文本逐字不变', () => {
  const HINT = /下回合能往|挨着/;
  const frame = (style, seed, pos, lastNode, options, remainingSteps) => {
    const s = startSession(createSliceConfig({ seed, style }));
    const p = s.players.find(x => x.controller === 'human');
    p.position = pos; p.lastNode = lastNode;
    const r = makeRoot();
    s.pending = { type: 'direction', options, remainingSteps };
    s.phase = 'move';
    render(r, s, new Proxy({}, { get: () => () => {} }));
    return r.choice.querySelectorAll('.route-choice').map(b => b.text);
  };

  // ① 真重文帧（grow/seed=5 第1天 从 7,2 出发 剩余 1 步）：两条正文都是「街心书屋：第 4 天开售」
  const tied = frame('grow', 5, '7,2', '7,1', ['6,2', '7,3'], 1);
  // 与 eachDirectionFrame 同一套剥离规则：方向词、「共 2 个方向 · 可逐项查看」提示、tieHint。
  // 这里刻意**保留** tieHint 之外什么都不留，所以 ① 比较的是玩家真正读到的正文。
  const body = t => t.replace(/^(向右|向左|向上|向下)\s*/, '')
    .replace(/共 2 个方向 · 可逐项查看\s*/, '')
    .replace(/\s*(下回合能往|挨着).*$/, '').trim();
  assert.equal(body(tied[0]), body(tied[1]), `这个用例本该重文：${JSON.stringify(tied)}`);
  assert.equal(tied.filter(t => HINT.test(t)).length, 2, `重文帧两条都该补几何事实：${JSON.stringify(tied)}`);

  // ② 不重文的帧：同一对方向但剩余步数不同 ⇒ outlook 不同 ⇒ 不该加提示
  const free = frame('grow', 5, '7,2', '7,1', ['6,2', '7,3'], 3);
  assert.notEqual(body(free[0]), body(free[1]), `这个用例本该不重文：${JSON.stringify(free)}`);
  assert.equal(free.filter(t => HINT.test(t)).length, 0, `不重文却挂了提示：${JSON.stringify(free)}`);
});

test('#3264 P1：「共 2 个方向 · 可逐项查看」在 390×844 上不可见，且不是正文', () => {
  // 这条守的是 C2/D1 剥离规则的**前提**，不只是文案。render.js 把这段 cue 拼在选项 0 的 <b> 里，
  // 所以它一直出现在抓取的 DOM 文本中（OUT-10/OUT-11 的 record-2-summary.json 里能看到）。
  // 它之所以不算正文，是因为 styles.css 默认 display:none，且唯一把它变 inline 的规则
  // 要求 (320..420 宽 且 高度 ≤500) 且 .route-choice 处于 :focus-visible。
  // 若有人让它在常见手机上可见，玩家会读到一句「共 2 个方向」的空话，
  // 而 C2/D1 的剥离规则会让测试仍然绿 —— 那就是静默跑偏。这条先红。
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  // ① 默认必须是隐藏的（剥了空白再比，免得排版差异骗过判定）。
  const bare = css.split('.route-inline-more').length - 1;
  assert.ok(bare > 0, 'styles.css 里找不到 .route-inline-more 规则');
  assert.ok(css.includes('.route-inline-more { display: none; }'),
    '.route-inline-more 不再默认 display:none —— 那段 cue 会进入玩家正文');

  // ② 唯一让它可见的规则必须仍关在「高度 ≤ 500px」的媒体查询里。
  const shown = [];
  for (const m of css.matchAll(/@media([^{]*)\{([\s\S]*?)\n\}/g)) {
    const [, query, body] = m;
    if (body.includes('.route-inline-more') && body.includes('display: inline')) {
      shown.push({ query: query.trim(), body });
    }
  }
  assert.ok(shown.length > 0, '没找到让 .route-inline-more 可见的规则（文案会永远不可达）');
  for (const s of shown) {
    // 用纯字符串取数：这个查询串里既有空格，又经过一层转义，正则两样都吃过亏。
    const at = s.query.indexOf('max-height:');
    assert.ok(at >= 0, '让它可见的媒体查询没有 max-height 上限：' + s.query);
    const rest = s.query.slice(at + 'max-height:'.length).trimStart();
    const digits = rest.slice(0, rest.indexOf('px'));
    const px = Number(digits.trim());
    assert.ok(Number.isFinite(px) && px <= 500,
      `让它可见的媒体查询上限 ${digits}px 太高，390×844 这类常见手机会读到空话：` + s.query);
  }
});

test('#719 C1：补上的差异是几何事实，与 buildAdj 现算一致', () => {
  const s = startSession(createSliceConfig({ seed: 5, style: 'grow' }));
  s.day = 1;
  const adj = buildAdj(s.map);
  for (const id of ['10,4', '10,6', '6,2', '7,3', '7,2']) {
    const from = s.map.nodes.find(n => n.id === id);
    const expect = (adj[id] ?? []).map(e => {
      const to = s.map.nodes.find(n => n.id === e.to);
      return to.x > from.x ? '右' : to.x < from.x ? '左' : to.y > from.y ? '下' : '上';
    });
    assert.equal(nextTurnWords(s, id), expect.join('/'), id);
  }
  // 街道名：10,4 不挨地，10,6 挨 11,6 那条街
  assert.equal(nextTurnStreetNames(s, '10,4'), '');
  assert.notEqual(nextTurnStreetNames(s, '10,6'), '');
});

test('#719 C3：任选项正文不超过 260 字（单方向）', async () => {
  const over = [];
  await eachDirectionFrame(({ style, seed, day, opts }) => {
    for (const o of opts) if (o.raw.length > 260) over.push(`${style}/${seed} D${day} ${o.dir} ${o.raw.length} 字`);
  });
  assert.deepEqual(over, []);
});

// ---- #719 溢出提示：数字必须来自实测几何，不能凭 options.length 编 ----
//
// 真浏览器读数（1280×800，真实 10,5 三方向帧）：
//   #choice clientH=369 scrollH=460 ⇒ 1 个选项被 #choice 裁；
//   但父 #hand overflow:auto 的底边 790 比 #choice 底边 882 更早裁 ⇒ 实际 2 个不可见。
// 所以边界必须取「所有裁切祖先 + 视口」的最小值。上一版取 #choice 自己的 882，
// 说出「还有 1 个」（少数一个），且提示自己也落在 #hand 的裁切线之外 ⇒ 完全看不见。

// 可造布局的假 element：容器 + 子项矩形都由测试给定。
function fakeScroller({ rect, clientHeight, overflow = 'auto', parent = null, id = '' }) {
  const el = {
    id, parentElement: parent, children: [],
    clientHeight,
    _rect: rect,
    getBoundingClientRect() { return this._rect; },
    _overflowY: overflow,
    querySelectorAll(sel) {
      if (sel === '.route-choice') return this.children;
      if (sel === '[data-overflow-hint]') return this.children.filter(c => c._hint);
      return [];
    },
    appendChild(n) { this.children.push(n); if (n._hint) { n.parentElement = this; } return n; },
    remove() {
      if (!this.parentElement) return;
      const a = this.parentElement.children;
      const i = a.indexOf(this); if (i >= 0) a.splice(i, 1);
    },
    hasAttribute() { return false; },
  };
  return el;
}

function fakeOverflowEnv({ outerBottom, innerBottom, itemHeights, innerTop = 100 }) {
  // #hand（外层裁切者）与 #choice（内层）分开造，复现实测的「内层底边更靠下」
  const hand = fakeScroller({ rect: { top: outerBottom - 300, bottom: outerBottom, height: 300 }, clientHeight: 300, id: 'hand' });
  const choice = fakeScroller({ rect: { top: innerTop, bottom: innerBottom, height: innerBottom - innerTop }, clientHeight: innerBottom - innerTop, parent: hand, id: 'choice' });
  hand.children.push(choice);
  let y = innerTop;
  for (const h of itemHeights) {
    const item = { _rect: { top: y, bottom: y + h, height: h }, getBoundingClientRect() { return this._rect; } };
    choice.children.push(item);
    y += h;
  }
  return { hand, choice };
}

test('#719 C4：mountOverflowHint 的数字按「所有裁切祖先的最小可见底边」算', (t) => {
  // 上一版这条只测了 hiddenOptionCount / visibleBounds 两个函数，
  // 而错的是**调用点**（mountOverflowHint 里用 #choice 自己的 bottom 当边界）。
  // 把调用点短路回错的那版时，测试仍然全绿 ⇒ 这条没有牙。
  // 现在直接走 mountOverflowHint（真实现），再断言它写进 DOM 的那个数字。
  const prevGCS = globalThis.getComputedStyle;
  globalThis.getComputedStyle = node => ({ overflowY: node?._overflowY ?? '', overflow: node?._overflowY ?? '' });
  const prevDoc = globalThis.document;
  const hints = [];
  globalThis.document = {
    body: {}, documentElement: {},
    createElement() {
      const h = { _hint: true, attrs: {}, textContent: '', style: { cssText: '' },
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return this.attrs[k] ?? null; },
        getBoundingClientRect() { return { top: 0, bottom: 30, height: 30 }; },
        remove() {} };
      hints.push(h);
      return h;
    },
  };
  t.after(() => {
    if (prevGCS === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = prevGCS;
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
  });

  // 真浏览器实测形状（10,5 三方向，1280×800）：
  //   选项 576..711 / 711..815 / 815..919；#choice 底边 879；#hand 底边 790
  //   真可见底边 790 ⇒ 第 2、3 项越界 ⇒ 应写 2
  const env = fakeOverflowEnv2({
    handBottom: 790, choiceBottom: 879, choiceTop: 495,
    items: [[576, 711], [711, 815], [815, 919]],
  });
  const out = mountOverflowHint(env.choice);
  assert.ok(out, '真溢出，应该出提示');
  assert.equal(out.n, 2, `提示应写 2（用 #hand 的 790 算），却写 ${out.n}（那是用 #choice 的 879 少数一条）`);
  const hint = hints.at(-1);
  assert.equal(hint.getAttribute('data-overflow-hint'), '2');
  assert.equal(hint.textContent, '↓ 还有 2 个方向在下面');
  // 反证：若错用 #choice 的 879 当边界只得 1
  assert.equal(hiddenOptionCount({ top: 495, height: 879 - 495 }, env.choice.children.map(c => c.getBoundingClientRect())), 1,
    '反证本身要成立：用错边界会少数一条');
});

test('#719 C4b：不溢出时 mountOverflowHint 不出提示', (t) => {
  const prevGCS = globalThis.getComputedStyle;
  globalThis.getComputedStyle = node => ({ overflowY: node?._overflowY ?? '', overflow: node?._overflowY ?? '' });
  const prevDoc = globalThis.document;
  globalThis.document = { body: {}, documentElement: {}, createElement() { throw new Error('不应该建提示'); } };
  t.after(() => {
    if (prevGCS === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = prevGCS;
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
  });
  // #878 订正：这里 handBottom=900 ⇒ #hand 自身顶边是 600，所以**可见带上沿是 600**（取各裁切祖先最大顶边），
  //   不是 choiceTop=500。原夹具 items=[[500,600],[600,700]] 两项其实都在带上沿之外，
  //   #878 之前它一直绿只因为旧代码从不数上沿。这里换成真正完整在带内的几何。
  //   「全列都在带上沿外」这一情形由 test/hint-sides.test.js S5 专门覆盖。
  const env = fakeOverflowEnv2({ handBottom: 900, choiceBottom: 900, choiceTop: 500, items: [[620, 720], [730, 830]] });
  assert.equal(mountOverflowHint(env.choice), null);
});


function fakeOverflowEnv2({ handBottom, choiceBottom, choiceTop, items }) {
  const mk = (rect, overflow, parent) => ({
    _rect: rect, _overflowY: overflow, parentElement: parent ?? null, children: [],
    clientHeight: Math.round(rect.bottom - rect.top),
    getBoundingClientRect() { return this._rect; },
    querySelectorAll(sel) {
      if (sel === '.route-choice') return this.children;
      if (sel === '[data-overflow-hint]') return this.children.filter(c => c._hint);
      return [];
    },
    appendChild(n) { this.children.push(n); n.parentElement = this; return n; },
    remove() {
      if (!this.parentElement) return;
      const a = this.parentElement.children, i = a.indexOf(this);
      if (i >= 0) a.splice(i, 1);
    },
    hasAttribute() { return false; },
    setAttribute() {}, getAttribute() { return null; },
  });
  const hand = mk({ top: handBottom - 300, bottom: handBottom, height: 300 }, 'auto', null);
  const choice = mk({ top: choiceTop, bottom: choiceBottom, height: choiceBottom - choiceTop }, 'auto', hand);
  hand.children.push(choice);
  for (const [top, bottom] of items) {
    choice.children.push({ _rect: { top, bottom, height: bottom - top }, getBoundingClientRect() { return this._rect; } });
  }
  return { hand, choice };
}

// render.js 的这几个 helper 是本单新加的，直接从源码导入即可
import { visibleBounds, hiddenOptionCount, overflowHintText, mountOverflowHint } from '../src/ui/render.js';
function require_render_exports() { return { visibleBounds, hiddenOptionCount, overflowHintText }; }
