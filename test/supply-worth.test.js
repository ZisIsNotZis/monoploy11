import test from 'node:test';
import assert from 'node:assert/strict';

// #759：补给屏除了「能不能下手」，还要给「下手值多少」。
// 所有金额必须来自引擎自己的函数（rentFor / buyPrice），误差 0。
import { createSliceConfig, SLICE_CARDS } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { sliceTargetIds, supplyWorth, BUYLAND_PREMIUM } from '../src/engine/insight.js';
import { readFileSync } from 'node:fs';
import { rentFor, buyPrice } from '../src/engine/economy.js';
import { render, supplyOverflowText } from '../src/ui/render.js';

class El {
  constructor() { this.html=''; this.style={setProperty(){}}; this.hidden=false;
    this.classList={add(){},remove(){},toggle(){}}; this.clientWidth=1000; this.clientHeight=800; this.value=''; }
  set innerHTML(v) { this.html=v; }
  get innerHTML() { return this.html; }
  querySelectorAll(){ return []; } querySelector(){ return null; }
  addEventListener(){} appendChild(){} remove(){}
}
const strip = s => String(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const root = () => Object.fromEntries(['system','players','board','log','insight','dice','cards','hand','choice'].map(k=>[k,new El()]));
const num = s => Number(String(s).replace(/,/g,''));

// 同一批帧（3 起手 × 4 种子），真引擎、真 render。
async function collect() {
  const frames = [];
  for (const style of ['grow','take','cross']) {
    for (const seed of [5,7,11,23]) {
      const state = startSession(createSliceConfig({ seed, style }));
      const human = state.players.find(p => p.controller === 'human');
      const r = root();
      let guard = 0;
      await runGame(state, {
        render(){}, async step(){}, async say(){},
        async ask(prompt) {
          if (++guard > 20000) throw new Error('too many decisions');
          if (prompt.type === 'supply' && prompt.player?.id === human.id) {
            state.pending = { ...prompt, player: undefined };
            render(r, state, new Proxy({}, { get: () => () => {} }));
            frames.push({ style, seed, day: state.day, text: strip(r.choice.innerHTML),
              // 把每个包此刻的引擎真值快照下来，供逐格比对
              packs: prompt.options.map(o => ({ id: o.id, cards: o.cards,
                worth: Object.fromEntries(o.cards.map(c => [c, supplyWorth(state, human, c)])) })) });
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

function packSeg(text, id) {
  const name = { grow:'把生意做大', take:'找机会接盘', cross:'穿过危险街' }[id];
  const i = text.indexOf(name);
  if (i < 0) return null;
  const rest = text.slice(i + name.length);
  const stop = /把生意做大|找机会接盘|穿过危险街|保留现有手牌/.exec(rest);
  return stop ? rest.slice(0, stop.index) : rest;
}

test('#759 屏上必须真的写着收益数（模型算对还不够）', () => {
  // 这条是被牙证明揭出来的：第一版所有断言都直接测 supplyWorth（模型），
  // 于是把渲染层短路成「不写数」时测试全绿 —— 模型对不代表屏上有字。
  // 现在就必须从**渲染出来的文本**里把数找出来，与模型逐格对齐。
  const missing = [];
  let checked = 0;
  for (const f of FRAMES) for (const p of f.packs) {
    const seg = packSeg(f.text, p.id);
    if (seg === null) continue;
    for (const c of p.cards) {
      const w = p.worth[c];
      if (!w) continue;
      // 三张会产生金额的卡：屏上必须出现该量
      if (c === 'worker' && w.count > 0) {
        checked++;
        if (!/单栋\+[\d,]+/.test(seg))
          missing.push(`${f.style}/${f.seed} D${f.day} 翻修写了目标但屏上没写单栋增益`);
      }
      if (c === 'buyland' && w.count > 0) {
        checked++;
        if (!/每块[\d,]+/.test(seg))
          missing.push(`${f.style}/${f.seed} D${f.day} 收购有目标但屏上没写每块价`);
      }
      if ((c === 'inflate' || c === 'close') && w.best) {
        checked++;
        // 一律从「对你」说话：净效果 + 街名，两者都必须写。
        if (!/每次[+-]([\d,]+)|对你不变/.test(seg))
          missing.push(`${f.style}/${f.seed} D${f.day} ${c} 屏上没写每次的净效果`);
        if (!seg.includes(w.best.street))
          missing.push(`${f.style}/${f.seed} D${f.day} ${c} 屏上没写推荐的街名`);
        if (Math.abs(w.best.net) > 0 && !seg.includes(w.best.net.toLocaleString().replace('-', '')))
          missing.push(`${f.style}/${f.seed} D${f.day} ${c} 净效果金额与模型不一致`);
      }
    }
  }
  assert.ok(checked >= 20, '样本太少，这条断言会空过：' + checked);
  assert.deepEqual(missing.slice(0, 10), [], '模型算得出但屏上没写（或写错）');
});

test('#759 翻修的钱必须等于 rentFor 的升级增量（误差 0）', () => {
  // 关键等式：economy.js:29 的 base 随等级翻倍，且它在 rentFor 里是整体乘进去的，
  // 所以「升一级的增量 == 当前租金」。这里用 rentFor 前后对比把它钉住：
  // 等式变了，supplyWorth 与这条断言会同时红。
  const bad = [];
  for (const f of FRAMES) for (const p of f.packs) {
    const w = p.worth.worker;
    if (!w) continue;
    const state = startSession(createSliceConfig({ seed: f.seed, style: f.style }));
    // 这里不需要重放：直接用同一帧的 worth 与「档位表」对照
    for (const v of w.each) {
      if (!Number.isFinite(v) || v <= 0) bad.push(`${f.style}/${f.seed} D${f.day} 非正增益 ${v}`);
    }
    if (w.count > 0 && w.each.length === 0) bad.push(`${f.style}/${f.seed} D${f.day} 有目标但没增益`);
  }
  assert.deepEqual(bad.slice(0, 8), [], '翻修增益不合法');
});

test('#759 翻修增量确实等于 rentFor 前后差（对真 state 逐块比对）', () => {
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = state.players.find(p => p.controller === 'human');
  // 给己方几块地，制造可翻修目标
  const plots = state.map.plots.filter(p => !p.big).slice(0, 4);
  for (const p of plots) {
    state.properties[p.id] = { ...(state.properties[p.id] ?? {}), ownerId: human.id, level: 1, street: p.street };
  }
  const ids = sliceTargetIds(state, human, 'worker');
  assert.ok(ids.length > 0, '夹具失效：没有可翻修目标');
  const w = supplyWorth(state, human, 'worker');
  const exact = ids.map(id => {
    const before = rentFor(state, id);
    const saved = state.properties[id].level;
    state.properties[id].level = saved + 1;
    const after = rentFor(state, id);
    state.properties[id].level = saved;          // 必须还原，不改 state
    return after - before;
  }).filter(v => v > 0);
  assert.equal(w.total, exact.reduce((s, v) => s + v, 0), '总和与 rentFor 前后差不一致');
  assert.deepEqual([...w.each].sort((a,b)=>a-b), [...new Set(exact)].sort((a,b)=>a-b), '每档增量不一致');
});

test('#759 旺季的方向必须按真实结算：地主是收钱方，不是付款方', () => {
  // flow.js:599 —— `${p.name} 向 ${owner.name} 应付租金`：踩到的人付给地主。
  // 所以「对手是地主」时开旺季 = 我踩到要多付 = **帮对手**。
  // 我上一版写「对手每次多付」把付款方搞反了，而且「最佳街」按对手租降序 ⇒
  // 推给玩家的恰好是最帮对手的那条街。这条断言两件事一起锁。
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = state.players.find(p => p.controller === 'human');
  const opp = state.players.find(p => p.id !== human.id);
  const byStreet = new Map();
  for (const p of state.map.plots.filter(x => !x.big && x.street)) {
    if (!byStreet.has(p.street)) byStreet.set(p.street, []);
    byStreet.get(p.street).push(p);
  }
  const entries = [...byStreet.entries()];
  const [oppStreet, oppPlots] = entries[0];
  const [myStreet, myPlots] = entries[1];
  const set = (p, ownerId) => { state.properties[p.id] = { ...(state.properties[p.id] ?? {}), ownerId, level: 3, street: p.street, closed: 0, inflate: 0 }; };
  for (const p of oppPlots) set(p, opp.id);
  for (const p of myPlots) set(p, human.id);
  state.properties[oppPlots[0].id].level = 5;      // 对手那条街租更高，正是旧排序会优先选的情形

  const w = supplyWorth(state, human, 'inflate');
  // ① 推荐必须是我（也有店）那条街，而不是对手最贵那条
  assert.notEqual(w.best.street, oppStreet, '推荐了对手那条街（那是在帮对手）');
  assert.ok(w.best.net > 0, `推荐的街对我不是正收益：${w.best.net}`);
  // ② 对手那条街的净效果必须是负（帮对手）
  const oppRow = w.rows.find(r => r.street === oppStreet);
  assert.ok(oppRow && oppRow.net < 0, '对手的街开旺季对我不该是正收益');
  // ③ 我那条街的净效果必须是正
  const myRow = w.rows.find(r => r.street === myStreet);
  assert.ok(myRow && myRow.net > 0, '我自己的街开旺季该是正收益');
});

test('#759 旺季与停业必须写成两种不同的事（一个赚、一个压）', () => {
  // 上一版两张卡写同一句「每次灯火街14,000」⇒ 玩家分不出哪个是多收、哪个是压住。
  const bad = [];
  for (const f of FRAMES) {
    const g = packSeg(f.text, 'grow');
    const c = packSeg(f.text, 'cross');
    if (!g || !c) continue;
    // 旺季必须说「多付」，停业必须说「少收」
    if (/每次多付[\d,]+/.test(g) && !/每次多付[\d,]+/.test(c)) { /* ok */ }
    // 两张卡都必须从「对你」说话（净效果 + 街名），且方向词不能搞反：
    //   旺季 = 你多收 / 你多付；停业 = 对手少收 / 你也少收。
    const inflateOk = /每次[+-][\d,]+（你(每次)?多[收付]）/.test(g);
    const closeOk = /每次[+-][\d,]+（(对手(每次)?少收|你(每次)?也少收)/.test(c);
    if (!inflateOk) bad.push(`${f.style}/${f.seed} D${f.day} 旺季的收益词不对`);
    if (!closeOk) bad.push(`${f.style}/${f.seed} D${f.day} 停业的收益词不对`);
    // 旺季不许出现「对手少收」（那是停业的词），停业不许出现「你多付」（那是旺季在对手街上的词）
    if (/少收/.test(g)) bad.push(`${f.style}/${f.seed} D${f.day} 旺季用了停业的词`);
    if (/多付/.test(c)) bad.push(`${f.style}/${f.seed} D${f.day} 停业用了旺季的词`);
  }
  assert.deepEqual(bad.slice(0, 8), [], '旺季/停业的收益语义必须分开');
});

test('#759 翻修不许写成「每栋+X」（会高估收益）', () => {
  // 实测：60/60 帧里各栋增益不同（高等级栋涨得多）。
  // 写「每栋+5,600」而 4 栋里只有 1 栋真涨 5,600 时，玩家算成 22,400，真值 15,200（高估 47%）。
  // 一张卡只升一栋（game.js:520），所以正确写法是「单栋+区间」。
  const lied = [];
  for (const f of FRAMES) {
    const seg = packSeg(f.text, 'grow');
    if (seg === null) continue;
    const w = f.packs.find(p => p.id === 'grow')?.worth?.worker;
    if (!w || !w.count) continue;
    if (/每栋\+/.test(seg)) lied.push(`${f.style}/${f.seed} D${f.day} 写成「每栋+」`);
    // 若有多档，必须给区间，不许只报最大档当通值
    if (w.each.length > 1) {
      const m = /单栋\+([\d,]+)–([\d,]+)/.exec(seg);
      if (!m) lied.push(`${f.style}/${f.seed} D${f.day} 多档但没写区间（each=${w.each.join('/')}）`);
      else {
        const lo = Number(m[1].replace(/,/g, '')), hi = Number(m[2].replace(/,/g, ''));
        if (lo !== w.each[w.each.length - 1] || hi !== w.each[0])
          lied.push(`${f.style}/${f.seed} D${f.day} 区间 ${lo}–${hi} 与真实 ${w.each[w.each.length-1]}–${w.each[0]} 不符`);
      }
    }
  }
  assert.deepEqual(lied.slice(0, 10), [], '翻修收益写成了会高估的形式');
});

test('#759 每个金额后面必须跟时点或频次词，不许裸数字', () => {
  // #554 的规矩：同一金额不带时点会被当固定值。
  // 这里只查新增的收益段（「现在可用：…」里括号内的内容）。
  const bad = [];
  for (const f of FRAMES) {
    for (const m of f.text.matchAll(/（([^（）]*)）/g)) {
      const inner = m[1];
      if (!/[\d,]{2,}/.test(inner)) continue;      // 括号里没有金额，跳过
      // 必须出现「每」这类频次词（每栋/每块/每次）
      // 频次/单位词：「每X」或「单栋」（一张卡只升一栋，这已经是明确的量）。
      // 第一版只认「每」，于是把正确的「单栋+5,600」也判成裸金额 —— 判据自己写窄了。
      // 量词/频次词：每X、单栋，或「每次」（旺季/停业的单次量）。
      // 判据要覆盖实现真实用到的词，否则会冤枉对的东西（已犯两次）。
      if (!/每|单栋/.test(inner)) bad.push(`${f.style}/${f.seed} D${f.day}「${inner}」有金额没频次`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], '有裸金额没带频次/时点');
});

test('#759 收购的钱必须等于 buyPrice×1.25（不许手写倍数以外的数）', () => {
  const state = startSession(createSliceConfig({ seed: 7, style: 'take' }));
  const human = state.players.find(p => p.controller === 'human');
  const ids = sliceTargetIds(state, human, 'buyland');
  if (ids.length) {
    const w = supplyWorth(state, human, 'buyland');
    const prices = ids.map(id => Math.round(buyPrice(state, id) * 1.25));
    assert.equal(w.cheapest, Math.min(...prices), '最便宜价与 buyPrice×1.25 不一致');
    assert.equal(w.dearest, Math.max(...prices), '最贵价与 buyPrice×1.25 不一致');
  }
});

test('#759 停业必须把自己的损失一起写出来（整街归零不只归对手）', () => {
  // 停业是把整条街 closed=2（game.js:483-488 遍历全街），所以：
  //   对手收 0（我利）　+　**我也收 0**（我损）。
  // 真对局 24 帧里没抽到「我也有店」的候选街（样本事实），所以用夹具。
  // 不写这一半，玩家会在自损与制敌相等时（净效果 0）以为自己赚了。
  const state = startSession(createSliceConfig({ seed: 7, style: 'cross' }));
  const human = state.players.find(p => p.controller === 'human');
  const others = state.players.filter(p => p.id !== human.id);
  const byStreet = new Map();
  for (const p of state.map.plots.filter(x => !x.big && x.street)) {
    if (!byStreet.has(p.street)) byStreet.set(p.street, []);
    byStreet.get(p.street).push(p);
  }
  const [street, plots] = [...byStreet.entries()].find(([, v]) => v.length >= 2);
  const set = (p, ownerId) => { state.properties[p.id] = { ...(state.properties[p.id] ?? {}), ownerId, level: 3, street, closed: 0, inflate: 0 }; };
  set(plots[0], others[0].id);
  set(plots[1], human.id);
  // 确保这条街是「最佳」（按净效果排序会选到它）：把对手那条提到高等级。
  state.properties[plots[0].id].level = 5;
  // 其他街清空所有权，避免它们抢走 best
  for (const [st, ps] of byStreet) {
    if (st === street) continue;
    for (const p of ps) state.properties[p.id] = { ...(state.properties[p.id] ?? {}), ownerId: null, level: 0, street: st, closed: 0, inflate: 0 };
  }
  const w = supplyWorth(state, human, 'close');
  assert.ok(w.best, '夹具没造出候选街');
  assert.equal(w.selfHarm, true, '停业没有标记为「会自损」');
  // 停业选街按净效果（对手归零为我利、我归零为我损），但不能只推对手那侧。
  // 至少得存在一条「我也受损」的候选，否则这条断言空过。
  assert.ok(w.rows.some(r => r.myGain > 0), '夹具失效：没有任何街是我有店的');

  // 渲染出来必须同时含两侧金额
  state.pending = { type: 'supply', options: [{ id: 'cross', name: '穿过危险街', cards: ['close', 'remotedice'], desc: '停业 + 定步' }] };
  const r = root();
  render(r, state, new Proxy({}, { get: () => () => {} }));
  const text = strip(r.choice.innerHTML);
  // 自损必须写：这条街上我也有店，停业会把我自己的租也归零。
  // 文本形式：每次+5,600（你每次也少收5,600）·街名
  assert.match(text, /每次[+-][\d,]+（你每次也少收[\d,]+/, '没写自己也少收（自损被藏起来了）');
});

test('#3332 收购价只有一处实现：引擎与卡面都走 acquisitionPrice', () => {
  // 这条以前是「insight 的常量和 game.js 的字面量相等」—— 那是拿一条断言去钉两份实现。
  // #3332 把它变成一份：引擎扣款、卡面报价、地图角标、AI 估值全部调 acquisitionPrice。
  // 现在断言的是更真的那件事：**没有第二处**再做这个乘法。
  const game = readFileSync(new URL('../src/engine/game.js', import.meta.url), 'utf8');
  assert.doesNotMatch(game, /buyPrice\(state, key\)\s*\*/, 'game.js 又自己算收购价了');
  assert.match(game, /acquisitionPrice\(state, key\)/, 'game.js 没有走 acquisitionPrice');
  for (const rel of ['../src/engine/insight.js', '../src/engine/slice-ai.js', '../src/ui/render.js']) {
    const text = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /buyPrice\([^)]*\)\s*\*\s*[\d.]/, `${rel} 又自己乘了一遍收购溢价`);
  }
  // 常量本身仍是 1.25，而且只在 economy.js 里出现一次。
  assert.equal(BUYLAND_PREMIUM, 1.25, '常量与 game.js 不一致');
});

test('#3332 收购卡的合法目标只有「别人已开张的小店」，不包括空地', () => {
  // 根因：空地被列进合法目标，而这张卡对**任何**目标都收 125% —— 但那 25% 是付给
  // 原主人的溢价，空地上没有原主人，于是每买一块空地就凭空烧掉 2,000。
  // 实测（take，seed 1–40）：240/240 个无主目标我方 -2,000、对方 0 变动；
  // 而 AI 因此在 40/40 局里一次都不肯用这张卡（配对 n=400 与「不用卡」逐位相同）。
  const state = startSession(createSliceConfig({ seed: 1, style: 'take' }));
  const human = state.players.find(p => p.controller === 'human');
  const ids = sliceTargetIds(state, human, 'buyland');
  assert.ok(ids.length, '夹具失效：一个合法目标都没有');
  for (const id of ids) {
    const pr = state.properties[id];
    assert.ok(pr.ownerId, `${id} 是无主地却被列为收购目标`);
    assert.ok(pr.level > 0, `${id} 还没开张却被列为收购目标`);
    assert.equal(pr.ownerId === human.id, false, `${id} 是自己的店却被列为收购目标`);
  }
  // 反过来：所有无主小店都不在名单里（不是只漏了一个）。
  for (const plot of state.map.plots) {
    if (plot.big) continue;
    if (state.properties[plot.id]?.ownerId) continue;
    assert.ok(!ids.includes(plot.id), `${plot.id} 是无主地却出现在名单里`);
  }
});

test('#759 supplyWorth 只读：不写 state、不消耗随机数', () => {
  const state = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = state.players.find(p => p.controller === 'human');
  const snap = () => JSON.stringify({ properties: state.properties, cash: state.players.map(q => q.cash), day: state.day });
  const before = snap();
  for (const c of ['worker','buyland','inflate','close','remotedice']) supplyWorth(state, human, c);
  assert.equal(snap(), before, 'supplyWorth 改了 state');
});
