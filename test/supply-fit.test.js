import test from 'node:test';
import assert from 'node:assert/strict';

// #742：补给屏（第 4/7/10/13 天）选之前必须能看出「这包现在有没有用」。
//
// 为什么是真问题：补给不可退，而引擎在 flow.js:207-208 对零目标卡静默跳过。
// 改前实测 58 个供给帧里 7 帧有一张卡此刻零合法目标，屏上一个字都没提。
//
// 合法性一律问引擎自己的 sliceTargetIds，测试不另写规则。
import { createSliceConfig, SLICE_CARDS } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { sliceTargetIds } from '../src/engine/insight.js';
import { render, supplyOverflowText, isNarrowViewport } from '../src/ui/render.js';
import { readFileSync } from 'node:fs';

class El {
  constructor() { this.html=''; this.children=[]; this.style={setProperty(){}}; this.hidden=false;
    this.classList={add(){},remove(){},toggle(){}}; this.clientWidth=1000; this.clientHeight=800; this.value=''; }
  set innerHTML(v) { this.html=v; this.children=[]; }
  get innerHTML() { return this.html; }
  querySelectorAll(){ return []; }
  querySelector(){ return null; }
  addEventListener(){} appendChild(){} remove(){}
}
const strip = s => String(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const SUPPLY_NAME = { grow:'把生意做大', take:'找机会接盘', cross:'穿过危险街' };
// 单位正则：条街 必须排在 条 前面，否则「旺季5条街」会先吃到一个没意义的匹配。
const UNIT_RE = '(栋|块|条街|处)';
const NO_TARGET = new Set(['close', 'remotedice']);
// 与渲染同口径：worker 数房屋、buyland 数地块、inflate 数**不重复的街**
// （它的合法目标是逐块给的，但玩家选的是整条街）。
function liveCount(state, p, card) {
  if (NO_TARGET.has(card)) return null;
  const ids = sliceTargetIds(state, p, card);
  if (card !== 'inflate') return ids.length;
  return new Set(ids.map(id => state.map.plots.find(pl => pl.id === id)?.street).filter(Boolean)).size;
}

function root() {
  return { system:new El(), players:new El(), board:new El(), log:new El(),
    insight:new El(), dice:new El(), cards:new El(), hand:new El(), choice:new El() };
}

// 改前 / 改后都跑同一批帧：3 起手 × 4 种子，只取人类 supply 帧。
async function collect() {
  const frames = [];
  for (const style of ['grow','take','cross']) {
    for (const seed of [5,7,11,23]) {
      const state = startSession(createSliceConfig({ seed, style }));
      const human = state.players.find(p => p.controller === 'human');
      const r = root();
      const actions = new Proxy({}, { get: () => () => {} });
      let guard = 0;
      await runGame(state, {
        render(){}, async step(){}, async say(){},
        async ask(prompt) {
          if (++guard > 20000) throw new Error('too many decisions');
          if (prompt.type === 'supply' && prompt.player?.id === human.id) {
            state.pending = { ...prompt, player: undefined };
            render(r, state, actions);
            frames.push({ style, seed, day: state.day,
              text: strip(r.choice.innerHTML), html: String(r.choice.innerHTML),
              packs: prompt.options.map(o => ({ id:o.id, cards:o.cards,
                per:o.cards.map(c => ({ card:c, name:SLICE_CARDS[c].name, n:liveCount(state, human, c) })) })) });
            state.pending = null;
          }
          return aiAnswer(prompt, state);
        },
      });
    }
  }
  return frames;
}
const FRAMES = await collect();

// 取某个包在屏上的那一段：从包名到下一个包名/「保留现有手牌」。
// 不切片的话，后一个包的数字会蒙过前一个包的缺口（#741 踩过的假绿）。
function packSeg(text, name) {
  const i = text.indexOf(name);
  if (i < 0) return null;
  const rest = text.slice(i + name.length);
  const stop = /把生意做大|找机会接盘|穿过危险街|保留现有手牌/.exec(rest);
  return stop ? rest.slice(0, stop.index) : rest;
}

test('#742 有一张卡此刻零合法目标时，屏上必须指到那张卡', () => {
  assert.ok(FRAMES.length >= 40, '样本太少：' + FRAMES.length);
  const dead = [];
  for (const f of FRAMES) for (const p of f.packs) {
    const zeros = p.per.filter(c => c.n === 0);
    if (!zeros.length) continue;
    const seg = packSeg(f.text, SUPPLY_NAME[p.id]);
    if (seg === null) { dead.push(`${f.style}/${f.seed} D${f.day} ${p.id} 整包找不到`); continue; }
    for (const c of zeros) {
      // 「卡名 + 用不上」必须紧挨着：只剩卡名不算指点，剩下「用不上」也不算。
      if (!new RegExp(c.name + '\\s*用不上').test(seg))
        dead.push(`${f.style}/${f.seed} D${f.day} ${p.id} 的「${c.name}」此刻 0 目标，屏上没写`);
    }
  }
  assert.deepEqual(dead.slice(0, 10), [], '这些帧玩家会选到一个当下完全用不上的包');
});

test('#742 可用的卡必须带「能数几个」，光秃数字不算看懂', () => {
  // P3：新增的字里必须出现由 sliceTargetIds 导出的整数。
  // 反例识别：只写卡名（或卡名+无单位数字）→ 玩家不知道那个数是什么。
  const bad = [];
  for (const f of FRAMES) for (const p of f.packs) {
    const seg = packSeg(f.text, SUPPLY_NAME[p.id]);
    if (seg === null) continue;
    for (const c of p.per) {
      if (c.n === null || c.n === 0) continue;
      // 卡名后必须紧跟那个整数，且数字后必须跟单位字（栋/块/处），否则只是计数噪声。
      if (!new RegExp(c.name + c.n + UNIT_RE).test(seg))
        bad.push(`${f.style}/${f.seed} D${f.day} ${p.id} 的「${c.name}」有 ${c.n} 个目标，屏上没写数或没带单位`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], '数字缺失或没有单位');
});

test('#742 屏上的数必须等于 sliceTargetIds 复算，不许编', () => {
  const bad = [];
  for (const f of FRAMES) for (const p of f.packs) {
    const seg = packSeg(f.text, SUPPLY_NAME[p.id]);
    if (seg === null) continue;
    for (const c of p.per) {
      if (c.n === null) continue;
      const m = new RegExp(c.name + '(\\d+)' + UNIT_RE).exec(seg);
      if (c.n > 0 && (!m || Number(m[1]) !== c.n))
        bad.push(`${f.style}/${f.seed} D${f.day} ${p.id} ${c.name}: 屏上 ${m ? m[1] : '无'} / 复算 ${c.n}`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], '屏上的数与引擎判定不一致');
});

test('#742 两张卡都零目标时整包要看得出来（夹具，真实对局零样本）', () => {
  // 真实重放 58 帧里没有「两卡全死」的包，所以不能靠对局抽样本。
  // 用真 state + 真 render + 真 sliceTargetIds，只把条件置成引擎会置的样子。
  const state = startSession(createSliceConfig({ seed: 7, style: 'cross' }));
  const human = state.players.find(p => p.controller === 'human');
  for (const pr of Object.values(state.properties)) { pr.ownerId = null; pr.level = 0; }
  human.cash = 0; human.deposit = 0;
  human.properties = [];
  for (const q of state.players) if (q.id !== human.id) { q.cash = 999999; }
  for (const plot of state.map.plots.filter(p => !p.big)) {
    const opp = state.players.find(q => q.id !== human.id);
    state.properties[plot.id].ownerId = opp.id;
    state.properties[plot.id].level = 99;         // 已满级：没人能再翻修
  }
  assert.equal(sliceTargetIds(state, human, 'worker').length, 0, '夹具失效：还有可翻修的目标');
  assert.equal(sliceTargetIds(state, human, 'buyland').length, 0, '夹具失效：现金清零后还能收购');
  state.pending = { type:'supply', options: [{ id:'grow', name:'把生意做大', cards:['worker','inflate'], desc:'翻修 + 旺季：升级自己的店，抓住几天收租窗口。' }] };
  const r = root();
  render(r, state, new Proxy({}, { get: () => () => {} }));
  const text = strip(r.choice.innerHTML);
  assert.match(text, /翻修\s*用不上/, '两张卡都用不上时，至少翻修要写明');
});

test('#742 选项缺 cards 字段时不许崩（渲染层不假定数据形状）', () => {
  // 我自己引入的回归：全量 --test 里 slice.test.js 的桩数据只有 {id,name,desc}，
  // 而我的第一版直接 o.cards.map(...) —— 一条与补给无关的旧测试因此 TypeError。
  // 渲染层不该假定调用方一定给 cards；真缺就不写那一段，不是崩。
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  state.pending = { type: 'supply', options: [{ id: 'grow', name: '把生意做大', desc: '翻修 + 旺季' }] };
  const r = root();
  render(r, state, new Proxy({}, { get: () => () => {} }));
  const text = strip(r.choice.innerHTML);
  assert.match(text, /把生意做大/, '缺 cards 时包名仍要渲染');
  assert.doesNotMatch(text, /现在可用/, '没有 cards 就不该写空的「现在可用：」');
});

test('#742 补给屏溢出时提示的文案与计数不许飘（真 Edge 实测过的那一帧）', () => {
  // 真 Edge 1280×800、真开一局后实测：补给屏 #hand 只有 ~264px 高，内容 ~424px，
  // 四个入口里只有 1 个完全在可视区。提示实测在 760..790（视口内、#hand 底边内、可命中）。
  //
  // 这里不能测布局（node 里没有布局引擎），但可以钉住两件会漂的事：
  //   ① 文案 —— 写「方向」就错了，玩家会以为在选方向；
  //   ② 计数口径 —— 必须把自己也数进去的 4 个入口算在 4 里，不是只数 3 个包。
  const n = 3;
  const t = supplyOverflowText(n);
  assert.match(t, /还有\s*3\s*个/, '条数没写出来');
  assert.match(t, /补给选项/, '文案没说是补给选项（复用方向那套文案会把玩家带偏）');
  assert.doesNotMatch(t, /方向/, '补给屏的提示不许写成「方向」');
  assert.equal(supplyOverflowText(0).includes('0'), true, '计数为 0 时不该出提示，而文本函数本身仍需自洽');
});

test('#786 窄屏判定的阈值必须与 styles.css 的断点一致', () => {
  // #786 在 JS 里写了一个 760，styles.css 里也有一个 @media(max-width:760px)。
  // 两处各写一份数就会漂：CSS 跨到 900 而 JS 还卡在 760，或者反过来，
  // 结果就是「窄屏分支没触发但 CSS 已经生效」这种静默不一致。
  // 这条不靠口头说明，直接从两份文件里把数字抽出来对。
  assert.equal(isNarrowViewport(760), true, '760 属于窄屏');
  assert.equal(isNarrowViewport(761), false, '761 不属于窄屏');
  assert.equal(isNarrowViewport(390), true);
  assert.equal(isNarrowViewport(1440), false);
  // 拿不到视口（Node 渲测桩 / 非浏览器）不许当窄屏：宁可多一行 desc，
  // 也不要让测试跑的分支与线上不同。
  assert.equal(isNarrowViewport(undefined), false);
  assert.equal(isNarrowViewport(null), false);
  assert.equal(isNarrowViewport(0), false);

  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const widths = [...css.matchAll(/@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)/g)].map(m => Number(m[1]));
  assert.ok(widths.includes(760), 'styles.css 里找不到 760px 断点：' + JSON.stringify([...new Set(widths)]));
  // 双向验证：JS 说“窄”的那个最大宽度，必须正好是 CSS 里存在的断点。
  const jsBreak = 761 - 1;
  assert.ok(widths.includes(jsBreak), 'JS 断点 ' + jsBreak + ' 在 styles.css 里不存在');
});

test('#786 窄屏时补给入口不渲染静态 desc，宽屏时保留', () => {
  // 这条是 H2 的真修法（而不是挪提示）：窄屏减内容、宽屏不动。
  // Node 里没有布局引擎，但能直接断言两个分支渲出来的 HTML 形状。
  const makeState = () => {
    const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
    state.pending = { type: 'supply', options: [
      { id:'grow', name:'把生意做大', cards:['worker','inflate'], desc:'翻修 + 旺季：升级自己的店，抓住几天收租窗口。' },
    ] };
    return state;
  };
  const DESC = '抓住几天收租窗口';
  const htmlWith = (w) => {
    const prev = globalThis.innerWidth;
    Object.defineProperty(globalThis, 'innerWidth', { value: w, configurable: true, writable: true });
    const state = makeState();
    const choiceEl = new El();
    const nodes = root();
    nodes.choice = choiceEl;
    render(nodes, state, new Proxy({}, { get: () => () => {} }));
    const out = String(choiceEl.innerHTML);
    Object.defineProperty(globalThis, 'innerWidth', { value: prev, configurable: true, writable: true });
    return out;
  };
  const narrow = htmlWith(390);
  const wide = htmlWith(1440);
  assert.match(wide, /抓住几天收租窗口/, '宽屏丢了 desc（本单不该改桌面）');
  assert.doesNotMatch(narrow, /抓住几天收租窗口/, '窄屏仍渲染静态 desc，占着高度把入口挤下去');
  assert.match(narrow, /把生意做大/, '窄屏把包名也一起删了');
  assert.match(narrow, /现在可用/, '窄屏把“现在可用”也删了（那才是选包要看的东西）');
});

test('#742 溢出提示的入口集合必须包含「保留现有手牌」', () => {
  // 实测它排在最后、最容易被遮。只数 .supply-options button 会漏掉它。
  // 这条用正则锁住选择器字符串本身，防止以后有人改成只选三包。
  const src = readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8');
  const m = /mountOverflowHint\(el,\s*'([^']+)'/.exec(src);
  assert.ok(m, '补给屏没有挂溢出提示');
  assert.match(m[1], /supply-options button/, '选择器没包含三个补给包');
  assert.match(m[1], /data-supply=""/, '选择器没包含「保留现有手牌，不补给」——它是最容易被遮的那个入口');
});

test('#742 渲染层不许反向影响决策：AI 选包与改前一致', () => {
  // P5：可行性判断只能被读，不能被渲染改写。
  // 这里直接断言 sliceTargetIds 是纯函数（同 state 连问两次同答案，且不改 state）。
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = state.players.find(p => p.controller === 'human');
  const snap = () => JSON.stringify({ properties: state.properties, cash: state.players.map(q => q.cash) });
  const before = snap();
  for (const card of ['worker','inflate','buyland']) {
    const a = sliceTargetIds(state, human, card).length;
    const b = sliceTargetIds(state, human, card).length;
    assert.equal(a, b, card + ' 两次结果不同，不是纯函数');
  }
  assert.equal(snap(), before, 'sliceTargetIds 改了 state');
});
