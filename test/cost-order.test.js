import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { render } from '../src/ui/render.js';
import { routePreview } from '../src/engine/insight.js';
import { reachableWithin } from '../src/engine/board-v2.js';

// #697：岔口「再往前可达」被截断到 4 条时，必须先保证代价（对手已建未停业）在前。
//
// 反例（改前）：grow/1 第4天 里
//   显示: 书屋（第4天开售）、西巷（可买8,000）、监狱（失去2回合）、东巷（可买8,000）
//   丢掉: 月色街（可买8,000）、晚风街（机会买家 · 租2,800）  ← 代价被挤掉
//
// 注意：**对手停业不是代价**（走过去不付钱），己方停业也不是收益（既不收也不付）。

class El {
  constructor() { this.html=''; this.children=[]; this.style={setProperty(){}}; this.hidden=false;
    this.classList={add(){},remove(){},toggle(){}}; this.clientWidth=1000; this.clientHeight=800; this.value=''; }
  set innerHTML(v) { this.html=v; this.children=[];
    for (const m of v.matchAll(/<(?:button|div|span)\b([^>]*)>/g)) {
      if (!m[1].includes('data-')) continue;
      const c=new El(); c.dataset={}; c.attrs={};
      for (const a of m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        if (!a[1]) continue; const val=a[2]??''; c.attrs[a[1]]=val;
        if (a[1].startsWith('data-')) c.dataset[a[1].slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=val;
      }
      c.disabled=/\bdisabled\b/.test(m[1]); this.children.push(c);
    } }
  get innerHTML() { return this.html; }
  querySelectorAll(s){ const m=s.match(/\[([\w-]+)(?:="([^"]*)")?\]/);
    return m?this.children.filter(c=>m[1] in c.attrs&&(m[2]===undefined||c.attrs[m[1]]===m[2])):[]; }
  querySelector(s){ return this.querySelectorAll(s)[0]??null; }
  addEventListener(){} appendChild(){} remove(){}
}
const strip = s => s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();

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
    }
    state.pending = { type: 'target', kind: p.kind, cardId: p.cardId, label: p.label, players: p.players }; return;
  }
  if (p.type === 'direction') { state.pending = { type:'direction', options:p.options, remainingSteps:p.remainingSteps }; return; }
  if (p.type === 'buy') { state.pending = { type:'buy', cellId:p.plot.id, price:p.price, label:'x', level:p.level??0, bigType:p.bigType??null }; return; }
  if (p.type === 'build') { state.pending = { type:'build', cellId:p.plot.id, cost:p.cost, label:'x' }; return; }
  if (p.type === 'chooseBig') { state.pending = { type:'chooseBig', cellId:p.plot.id }; return; }
  if (p.type === 'bank') { state.pending = { type:'bank' }; return; }
  if (p.type === 'stock') { state.pending = { type:'stock' }; return; }
  if (p.type === 'lottery') { state.pending = { type:'lottery' }; return; }
  if (p.type === 'shop'||p.type==='merchant'||p.type==='research') { state.shopOffer=p.offers; state.pending={type:p.type}; return; }
  if (p.type === 'response') { state.pending = { type:'response', cardId:p.cardId, response:p.response, label:p.label }; return; }
  if (p.type === 'magic') { state.pending = { type:'magic', options:p.options??[] }; return; }
}

const OPP = /（(机会买家|穿街高手|街角店主) · /;
const isCost = e => !/停业/.test(e) && OPP.test(e) && /租\s*[\d,]+/.test(e);

// 跑一局，收集每个方向帧的「真实显示」与「全量 outlook」
async function collect(style, seed) {
  const s = startSession(createSliceConfig({ seed, style }));
  const root = { system:new El(), players:new El(), board:new El(), log:new El(), insight:new El(),
    dice:new El(), cards:new El(), hand:new El(), choice:new El() };
  const rows = [];
  await runGame(s, {
    render(){}, async step(){}, async say(){},
    async ask(prompt) {
      applyPrompt(s, prompt);
      render(root, s, new Proxy({}, { get: () => () => {} }));
      if (prompt.type === 'direction' && prompt.player?.controller === 'human') {
        const me = prompt.player;
        const html = root.choice.innerHTML;
        const btns = [...html.matchAll(/<button class="route-choice"[^>]*>([\s\S]*?)<\/button>/g)].map(m => strip(m[1])
          // #719 D1：重文帧会在正文后追一句「下回合能往 X · 挨着 Y」。
          // 它属于“区分两条路”的补充信息，不是 outlook 条目；不剥掉会被当成
          // 最后一个代价条目的尾巴，把“代价是否可见”的数算错（实测误报 2 格）。
          // 只改解析，不改判据阈值。
          .replace(/\s*下回合能往[\s\S]*$/, ''));
        for (let k = 0; k < btns.length; k++) {
          // #710 新格式：「再往前：3 步后 A、B；5 步后 C」。
          // 判据语义不变：抽出所有条目，检查代价是否全在、是否排第一。
          const emM = /再往前：([\s\S]*)$/.exec(btns[k]);
          const shown = emM
            ? emM[1].split('；').map(g => g.replace(/\s*…还有\s*\d+\s*组\s*$/, '').replace(/^\s*\d+\s*步后\s*/, ''))
                .flatMap(g => g.split('、')).map(x => x.trim()).filter(Boolean)
            : [];
          const full = routePreview(s, me, me.position, prompt.options[k], prompt.remainingSteps ?? 0).outlook;
          rows.push({ shown, full, btnText: btns.join(' ') });
        }
      }
      s.pending = null; s.mapPick = null;
      return aiAnswer(prompt, s);
    },
  });
  return rows;
}

test('截断时不得把代价（对手已建未停业）挤到显示外', async () => {
  let checked = 0, bad = 0;
  const examples = [];
  for (const [style, seed] of [['grow',1],['grow',7],['keep',42]]) {
    for (const r of await collect(style, seed)) {
      if (!r.shown.length) continue;
      const costTotal = r.full.filter(isCost).length;
      if (costTotal === 0 || costTotal > 4) continue;  // 代价>4 时本单明确豁免（要另报）
      checked++;
      const costShown = r.shown.filter(isCost).length;
      if (costShown < costTotal) {
        bad++;
        examples.push({ key: `${style}/${seed}`, shown: r.shown, full: r.full });
      }
    }
  }
  assert.ok(checked > 0, '应至少有一格代价总数 ≤4 且发生截断的情况（否则本断言无效）');
  assert.equal(bad, 0, `有 ${bad} 格把代价挤到显示外：${examples.slice(0,3).map(e => e.shown.join('/')).join(' | ')}`);
});

test('有代价时，代价必须出现在显示里（新排序：depth 优先）', async () => {
  // #710 把排序从「全局 tier 降序」改为「depth 升序 → 同 depth 内 tier 降序」
  // （根 #710 明确指定），所以「5 步后的代价」会排在「1 步后的风险」之后。
  // 这是有意的：玩家先要知道下一步撞什么。
  // 但保证不能丢：每个代价都得在屏上（前一条测试已盖），且在它所在的 depth 组内排第一。
  // 根 #719 把主判据定为**覆盖率**（≥≥），并允许单方向代价 >4 时用「还有 N 条」概括
  // （并点名其中金额最高的一条）。所以断言不是“逐条可见”，而是：
  //   ① 被概括的数量必须在文案里说出（不静默丢失）
  //   ② 覆盖率 ≥ 95%
  let checked = 0, shownTotal = 0, allTotal = 0, silentDrop = 0;
  for (const [style, seed] of [['grow',7],['grow',1],['take',5],['keep',42]]) {
    for (const r of await collect(style, seed)) {
      const costAll = r.full.filter(isCost);
      if (!costAll.length) continue;
      checked++;
      allTotal += costAll.length;
      const vis = costAll.filter(c => r.shown.includes(c)).length;
      shownTotal += vis;
      // 被概括的数量，必须与文案里的“还有 N 条”一致
      const hidden = costAll.length - vis;
      if (hidden > 0) {
        const m = /还有\s*(\d+)\s*条/.exec(r.btnText || '');
        if (!m || Number(m[1]) !== hidden) silentDrop++;
      }
    }
  }
  assert.ok(checked > 0, '应至少有一格含代价');
  const cov = shownTotal / allTotal;
  assert.ok(cov >= 0.95, `覆盖率 ${(100*cov).toFixed(1)}% < 95%（${shownTotal}/${allTotal}）`);
  assert.equal(silentDrop, 0, `有 ${silentDrop} 格把代价静默丢失（没有“还有 N 条”或数字不对）`);
});

test('对手停业不算代价：不得被排到可买地之前（停业=不付租）', async () => {
  // 这是我自己先写错的一层：最初把对手停业当层 0，己方停业当层 2。
  // 现在规则：对手停业=0（安全，最后）、己方停业=1（与机会同级）。
  const rows = await collect('keep', 42);
  let bad = 0;
  for (const r of rows) {
    const oppClosedIdx = r.shown.findIndex(e => /（(机会买家|穿街高手|街角店主) · 停业/.test(e));
    const buyIdx = r.shown.findIndex(e => /可买\s*[\d,]+/.test(e));
    if (oppClosedIdx >= 0 && buyIdx >= 0 && oppClosedIdx < buyIdx) bad++;
  }
  assert.equal(bad, 0, `有 ${bad} 格把对手停业排在了可买地之前（停业不付租，不该优先）`);
});
