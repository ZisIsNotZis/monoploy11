import test from 'node:test';
import assert from 'node:assert/strict';

// #741：旺季 / 停业 是「选一条街」的卡。点下去那一刻，屏幕必须告诉玩家
// 「这条街谁在收、用卡后每次踩到收多少」，因为两张卡方向相反：
// 在「对手 2 间、你 0 间」的街上开旺季是帮对手，停业才是压对手。
//
// 这里跑真实引擎（startSession + runGame + 真实 render），不是拼字符串。
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { render } from '../src/ui/render.js';
import { streetCardModel } from '../src/engine/insight.js';
import { reachableWithin } from '../src/engine/board-v2.js';

class Element {
  constructor() {
    this.html = ''; this.children = []; this.style = { setProperty() {} }; this.hidden = false;
    this.classList = { add() {}, remove() {}, toggle() {} }; this.clientWidth = 1000; this.clientHeight = 800;
    this.value = ''; this.scrollTop = 0; this.scrollHeight = 0;
  }
  set innerHTML(v) {
    this.html = v; this.children = [];
    for (const m of String(v).matchAll(/<(?:button|div|span|li)\b([^>]*)>/g)) {
      if (!m[1].includes('data-')) continue;
      const c = new Element(); c.dataset = {}; c.attrs = {};
      for (const a of m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        if (!a[1]) continue; c.attrs[a[1]] = a[2] ?? '';
        if (a[1].startsWith('data-')) c.dataset[a[1].slice(5).replace(/-([a-z])/g, (_, x) => x.toUpperCase())] = a[2] ?? '';
      }
      c.disabled = /\bdisabled\b/.test(m[1]); this.children.push(c);
    }
  }
  get innerHTML() { return this.html; }
  querySelectorAll(sel) {
    const m = sel.match(/\[([\w-]+)(?:="([^"]*)")?\]/);
    return m ? this.children.filter(c => m[1] in c.attrs && (m[2] === undefined || c.attrs[m[1]] === m[2])) : [];
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  addEventListener() {} appendChild() {} remove() {}
}

const strip = s => String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const numOf = s => Number(String(s).replace(/,/g, ''));
// 金额取数。注意：0 是合法金额（停业后对手租就是 0），
// 第一版只认 ≥4 位或带千分位的数，于是「→0」被判成「没写」——那是测试自己的缺陷。
const numsIn = s => [...String(s).matchAll(/(\d{1,3}(?:,\d{3})+|\d{4,}|(?<![\d,])0(?![\d,]))/g)].map(m => numOf(m[1]));

// 与 src/main.js 的 applyPromptToState 同构：只搭渲染需要的字段，不改状态机。
function applyPrompt(state, p) {
  state.pending = null; state.mapPick = null;
  if (!p) return;
  if (p.type === 'supply' || p.type === 'discard') { state.pending = { ...p, player: undefined }; return; }
  if (p.type === 'action') return;
  if (p.type === 'diceValue' || p.type === 'steps') { state.pending = { type: p.type, min: p.min, max: p.max }; return; }
  if (p.type === 'target') {
    if (p.kind === 'cell') {
      const cells = p.max ? [...reachableWithin(state.map, p.player.position, p.max)] : null;
      state.mapPick = { max: p.max, cells, cardId: p.cardId };
    } else if (p.kind === 'street' || p.kind === 'plot') {
      state.mapPick = { plot: true, value: p.kind, filter: p.plotFilter,
        playerId: p.player?.id, cardId: p.cardId, plotIds: p.plotIds };
    }
    state.pending = { type: 'target', kind: p.kind, cardId: p.cardId, label: p.label, players: p.players };
    return;
  }
  if (p.type === 'buy') { state.pending = { type: 'buy', cellId: p.plot.id, price: p.price, label: '小地产', level: p.level ?? 0, bigType: p.bigType ?? null }; return; }
  if (p.type === 'build') { state.pending = { type: 'build', cellId: p.plot.id, cost: p.cost, label: '小地产' }; return; }
  if (p.type === 'chooseBig') { state.pending = { type: 'chooseBig', cellId: p.plot.id }; return; }
  if (p.type === 'direction') { state.pending = { type: 'direction', options: p.options, remainingSteps: p.remainingSteps }; return; }
  if (p.type === 'bank') { state.pending = { type: 'bank' }; return; }
  if (p.type === 'stock') { state.pending = { type: 'stock' }; return; }
  if (p.type === 'lottery') { state.pending = { type: 'lottery' }; return; }
  if (p.type === 'shop' || p.type === 'merchant' || p.type === 'research') {
    state.shopOffer = p.offers; state.shopBought = p.bought; state.shopLimit = p.limit;
    state.pending = { type: p.type }; return;
  }
  if (p.type === 'response') { state.pending = { type: 'response', cardId: p.cardId, response: p.response, label: p.label }; return; }
  if (p.type === 'magic') { state.pending = { type: 'magic', options: p.options ?? [] }; return; }
}

// 跑一局，收集人类玩家的选街帧（真实引擎、固定种子、固定 AI 决策）。
async function collect(seed, style) {
  const state = startSession(createSliceConfig({ seed, style }));
  const root = { system: new Element(), players: new Element(), board: new Element(), log: new Element(),
    insight: new Element(), dice: new Element(), cards: new Element(), hand: new Element(), choice: new Element() };
  const actions = new Proxy({}, { get: () => () => {} });
  const frames = [];
  let decisions = 0;
  await runGame(state, {
    render() {}, async step() {}, async say() {},
    async ask(prompt) {
      if (++decisions > 5000) throw new Error('too many decisions');
      applyPrompt(state, prompt);
      render(root, state, actions);
      if (prompt.type === 'target' && prompt.kind === 'street') {
        const human = state.players.find(q => q.controller === 'human');
        frames.push({
          seed, style, day: state.day, cardId: prompt.cardId,
          isHuman: prompt.player?.controller === 'human',
          html: String(root.choice.innerHTML),
          text: strip(root.choice.innerHTML),
          model: streetCardModel(state, human, prompt.cardId),
        });
      }
      state.pending = null; state.mapPick = null;
      return aiAnswer(prompt, state);
    },
  });
  return frames;
}

// 12 局：3 种起手 × 4 个种子（与 .scratch/741-street-card/probe-street2.mjs 同口径）。
// 只用 4 局时样本里没有任何「已在停业/已在旺季」的街，S4 那条断言考不到东西 ——
// 宁可多跑几局，也不让一条断言因为没样本而空过。
const ALL = [];
for (const style of ['grow', 'take', 'cross']) {
  for (const seed of [5, 7, 11, 23]) ALL.push(...(await collect(seed, style)));
}
const HUMAN = ALL.filter(f => f.isHuman);
const CARD_NAME = { inflate: '旺季', close: '停业' };

// 取某条街在屏上「真的写了一行」的那一段。
//
// 注意：「还有 N 条，最高 西巷」也会出现街名，但那只是点名，没有数字。
// 用 `街名 + 你N间` 作定位，否则会把「点名」当「已列出」——这是我第一版测试的假阳性。
// 片段必须在本条街那一行结束处截止。
//
// 第一版切到「取消」为止 —— 结果本条街的片段里含有**后面几条街**的数字，
// 于是「用卡后的数没写」这种缺陷会被后面街的数字蒙过去（假绿）。
// 现在到下一条「X 你N间」/「还有」/「取消」就停。
function segOf(text, street) {
  const m = new RegExp(street + '\\s*你\\d+间').exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + street.length);
  const stop = /\s(?=\S+\s*你\d+间)|还有\s*\d+\s*条|取消/.exec(rest);
  return stop ? rest.slice(0, stop.index) : rest;
}

test('#741 选街卡的目标屏给出街级所有权分布（你 N 间 / 对手 M 间）', () => {
  assert.ok(HUMAN.length >= 6, '样本太少：' + HUMAN.length + ' 帧');
  const missing = HUMAN.filter(f => !/你\d+间\/对手\d+间/.test(f.text));
  assert.deepEqual(missing.map(f => f.style + '/' + f.seed + ' D' + f.day), [],
    '这些帧玩家看不出这条街归谁，而旺季/停业的方向正好相反');
});

test('#741 屏上的租必须等于 rentFor 独立复算（现在 / 用卡后）', () => {
  const bad = [];
  for (const f of HUMAN) {
    for (const r of f.model) {
      const seg = segOf(f.text, r.street);
      if (seg === null) continue;                      // 被截断的街只出现在「还有 N 条」里
      const vals = numsIn(seg);
      if (r.oppCount > 0) {
        if (!vals.includes(r.opponent)) bad.push(f.style + '/' + f.seed + ' D' + f.day + ' ' + r.street + ' 缺现在租 ' + r.opponent);
        if (!vals.includes(r.after.opponent)) bad.push(f.style + '/' + f.seed + ' D' + f.day + ' ' + r.street + ' 缺用卡后租 ' + r.after.opponent);
      }
      if (r.mineCount > 0) {
        if (!vals.includes(r.mine)) bad.push(f.style + '/' + f.seed + ' D' + f.day + ' ' + r.street + ' 缺己方租 ' + r.mine);
        if (!vals.includes(r.after.mine)) bad.push(f.style + '/' + f.seed + ' D' + f.day + ' ' + r.street + ' 缺己方用卡后 ' + r.after.mine);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 12), [], '屏上的租与 rentFor 复算不一致（编数或公式不同源）');
});

test('#741 不只是把地图上的单块租抄进框里', () => {
  // 反例识别：地图上每块地只写自己的 `租 X`（单块值）。
  // 若框内的钱全部能在「单块 rentFor」里找到，说明只是把同一个数换了位置。
  //
  // 这里必须用**单块**值当对照，不能用街级合计 ——
  // 街上只有 1 间时两者数值相等，用合计会在这种局上把正确实现误判成搬家，
  // 也会在 2 间时把「同一个数的两份」当成街级证据。
  const onlyMoved = [];
  for (const f of HUMAN) {
    const boxed = new Set(numsIn(f.text).filter(v => v >= 1000));
    const singleRents = new Set();
    for (const r of f.model) {
      if (!r.plotRents) continue;
      for (const v of r.plotRents) if (v) singleRents.add(v);
    }
    // 用卡后会变的那个值（对手翻倍 / 归零）不可能出现在地图片上：它就是要看的新量。
    const afterVals = new Set();
    for (const r of f.model) { if (r.oppCount > 0) afterVals.add(r.after.opponent); }
    const fresh = [...boxed].filter(v => !singleRents.has(v) || afterVals.has(v));
    if (!fresh.length) onlyMoved.push(f.style + '/' + f.seed + ' D' + f.day);
  }
  assert.deepEqual(onlyMoved, [], '这些帧的每个数字都已经是地图上的单块租金，只是换了位置');
});

test('#741 已在停业 / 已在旺季的街必须写明，不许把 0 当成「这条街没收钱」', async () => {
  // 说明：真实对局里「选街卡的那一刻，恰好有另一条街在停业/旺季」靠运气
  // （12 局 70 帧里可见列表上零例）。所以这条用**可复现夹具**：
  // 真 state、真 render、真 rentFor，只把一条街的 closed/inflate 写成引擎会写的值。
  // 这不是拼字符串 —— 断言的是真渲染出来的 #choice。
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = state.players.find(q => q.controller === 'human');
  const street = state.map.plots.find(p => !p.big && p.street !== '书屋').street;
  const target = state.map.plots.filter(p => p.street === street);
  for (const p of target) {
    state.properties[p.id].ownerId = human.id;
    state.properties[p.id].level = Math.max(1, state.properties[p.id].level);
  }
  const renderChoice = async (cardId) => {
    const root = { system: new Element(), players: new Element(), board: new Element(), log: new Element(),
      insight: new Element(), dice: new Element(), cards: new Element(), hand: new Element(), choice: new Element() };
    const actions = new Proxy({}, { get: () => () => {} });
    state.pending = { type: 'target', kind: 'street', cardId };
    state.mapPick = { plot: true, value: 'street', cardId, playerId: human.id };
    render(root, state, actions);
    return strip(root.choice.innerHTML);
  };
  // 停业中：引擎写 closed=2（game.js:486 在 slice 模式下的值）
  for (const p of target) state.properties[p.id].closed = 2;
  const closedText = await renderChoice('inflate');
  assert.match(closedText, /已停业/, '停业中的街没写「已停业」，玩家会把 0 读成「这条街本来就不收钱」');
  assert.match(closedText, new RegExp('已停业2天'), '停业剩余天数没写出来');
  // 旺季中：引擎写 inflate=3
  for (const p of target) { state.properties[p.id].closed = 0; state.properties[p.id].inflate = 3; }
  const inflateText = await renderChoice('close');
  assert.match(inflateText, /已在旺季/, '已在旺季的街没写「已在旺季」');
  assert.match(inflateText, /已在旺季2天|已在旺季3天/, '旺季剩余天数没写出来');
});

test('#741 字数：单条 ≤40 字、整框 ≤200 字（多字不等于看得懂）', () => {
  const longLines = [];
  const longFrames = [];
  for (const f of HUMAN) {
    const lines = [...f.html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => strip(m[1]));
    for (const l of lines) if (l.length > 40) longLines.push(f.style + '/' + f.seed + ' D' + f.day + ': ' + l.length + ' 字「' + l + '」');
    if (f.text.length > 200) longFrames.push(f.style + '/' + f.seed + ' D' + f.day + ': ' + f.text.length + ' 字');
  }
  assert.deepEqual(longLines.slice(0, 8), [], '单条超过 40 字');
  assert.deepEqual(longFrames.slice(0, 8), [], '整框超过 200 字');
});

test('#741 两种卡的语义不能反：旺季让对手多收，停业让对手收不到', () => {
  const inflate = HUMAN.filter(f => f.cardId === 'inflate');
  const close = HUMAN.filter(f => f.cardId === 'close');
  assert.ok(inflate.length > 0 && close.length > 0,
    '样本缺卡型：inflate ' + inflate.length + ' / close ' + close.length);
  for (const f of inflate) {
    for (const r of f.model) assert.equal(r.after.opponent, r.opponent * 2, '旺季后对手租应为两倍');
  }
  for (const f of close) {
    for (const r of f.model) assert.equal(r.after.opponent, 0, '停业后对手租应为 0');
  }
  // 屏幕上必须把这两种后果写出来，而不是只写街名
  for (const f of [...inflate, ...close]) {
    assert.ok(CARD_NAME[f.cardId], '卡名缺失');
    assert.match(f.text, /对手[\d,]+→[\d,]+/, CARD_NAME[f.cardId] + ' 帧没写对手会变成多少');
  }
});

// streetCardModel 必须是只读的 —— 算一遍不能改 state、不能消耗随机数。
test('#741 streetCardModel 不写 state、不读随机数', () => {
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const snap = () => JSON.stringify({ properties: state.properties, cash: state.players.map(p => p.cash), day: state.day });
  const before = snap();
  const human = state.players.find(q => q.controller === 'human');
  streetCardModel(state, human, 'inflate');
  streetCardModel(state, human, 'close');
  assert.equal(snap(), before, 'streetCardModel 改了状态（收租函数必须只读）');
});
