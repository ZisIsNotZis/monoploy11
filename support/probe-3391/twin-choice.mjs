// #3391p：**两张牌到底是不是一个选择？**（复核 #3412 提出，我逐条复现后收进本目录）
//
// 前面 twin-centers.mjs 只验了「两块静态等价」（各 8 临街格、同价同日、同租金），
// 然后就把测到的差异说成「选哪一块的差别」。这三支说明那句话是错的：
//
// A) 落点次数：静态格数相等 ≠ 收益相等。实际被踩次数由拓扑（路怎么走）决定。
// B) 报价顺序：flow.js 的 groundPhase 按 adjacentPlots **数组顺序**逐个 ask('buy')，
//    而 ai.js 对买地的回答只是现金阈值 ⇒ 共享格上先报价的那块先被买走。
//    把东块 unshift 到前面，归属就翻过来 ⇒ 提供的是**顺序偏置**，不是取舍。
// C) 共享格：站在 (7,3) 若两块分属两人，落点者**各付一次**（200,000 → 192,000，两位房东各 +4000）。
//    上一版我写「站在那儿能同时看到两个报价」—— 那不是设计意图，是给两位房东各送一次钱。
//
// 用法：node support/probe-3391/twin-choice.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame, groundPhase } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const WEST = 'market';
const EAST = 'market-east';
const EAST_CELLS = [{ x: 8, y: 3 }, { x: 9, y: 3 }, { x: 8, y: 4 }, { x: 9, y: 4 }];
const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const DECISION_LIMIT = 5000;

function makeGame(style, seed, order) {
  const cfg = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  cfg.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  return startSession(cfg);
}

/** 装上东街书屋。eastFirst 决定共享格上**先报价**的是哪一块 —— 这是 A/B 的唯一变量。 */
function addEast(state, { eastFirst = false } = {}) {
  state.map.plots.push({ id: EAST, cells: EAST_CELLS.map(c => ({ ...c })), big: true, street: '东书屋',
    name: '东街书屋', price: 26000, availableFromDay: 4 });
  state.properties[EAST] = { ownerId: null, level: 2, street: '东书屋', big: true,
    bigType: 'bookstore', closed: 0, inflate: 0, price: 26000 };
  // 漏掉这一行会让东块的标价走默认 42,000（我踩过：于是「东比西少 7%」是假的）。
  state.map.initialProperties.push({ plotId: EAST, level: 2, bigType: 'bookstore', price: 26000 });
  let linked = 0;
  for (const node of state.map.nodes) {
    const [nx, ny] = node.id.split(',').map(Number);
    if (!EAST_CELLS.some(c => Math.abs(c.x - nx) + Math.abs(c.y - ny) === 1)) continue;
    node.adjacentPlots ??= [];
    if (eastFirst) node.adjacentPlots.unshift(EAST);
    else node.adjacentPlots.push(EAST);
    linked++;
  }
  if (linked === 0) throw new Error('东街书屋没有 frontage —— 坐标单位写错了');
  return state;
}

// ---------- C) 共享格的结算：站在那儿到底付几次 ----------
{
  const cfg = createSliceConfig({ human: false, seed: 1, style: 'take', sliceContestedStreets: true });
  cfg.participants = ['take', 'grow', 'cross'].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = addEast(startSession(cfg));
  const [payer, ownerW, ownerE] = state.players;
  for (const p of state.players) { for (const id of p.properties) state.properties[id].ownerId = null; p.properties = []; }
  state.properties[WEST].ownerId = ownerW.id; ownerW.properties.push(WEST);
  state.properties[EAST].ownerId = ownerE.id; ownerE.properties.push(EAST);
  state.players.forEach(p => { p.cash = 200000; p.deposit = 0; });
  payer.position = '7,3'; payer.jail = 0; payer.hospital = 0; payer.alive = true;

  const shared = state.map.nodes.find(n => n.id === '7,3');
  if (!shared?.adjacentPlots?.includes(WEST) || !shared.adjacentPlots?.includes(EAST))
    throw new Error('(7,3) 不是共享格 —— 几何变了，这一支的前提没了');

  const before = payer.cash;
  const wBefore = ownerW.cash, eBefore = ownerE.cash;
  await groundPhase(state, payer, { render() {}, async ask() { return false; }, async say() {} });
  const paid = before - payer.cash;
  const toW = ownerW.cash - wBefore, toE = ownerE.cash - eBefore;
  const rW = rentFor({ ...state, properties: { ...state.properties, [WEST]: { ...state.properties[WEST], closed: 0 } } }, WEST);
  console.log(`共享格 (7,3)：两块分属两人时，一次落点付出 ${paid}（街心 ${toW} + 东街 ${toE}，单块租金 ${rW}）`);
  if (paid !== 2 * rW) throw new Error(`共享格结算不是「各付一次」：付出 ${paid}，单块 ${rW}`);
  console.log('  ⇒ 共享临街格 = 给两位房东**各付一次**。它不是「同时看到两个报价」的设计意图，');
  console.log('     而是几何副作用：两块的临街格集合相交。');
}

// ---------- A) 两块各自被踩多少次 ----------
async function countLandings(seeds) {
  const hits = { west: 0, east: 0, both: 0, union: 0, all: 0 };
  let games = 0;
  const styles = SLICE_STYLES.map(s => s.id);
  for (const style of styles) {
    const others = styles.filter(s => s !== style);
    for (const perm of [[others[0], others[1]], [others[1], others[0]]]) {
      for (let seed = 1; seed <= seeds; seed++) {
        const state = addEast(makeGame(style, seed, perm));
        let decisions = 0;
        await runGame(state, {
          render() {},
          async step(s, actor, nodeId) {
            const node = s.map.nodes.find(n => n.id === nodeId);
            const adj = node?.adjacentPlots ?? [];
            const w = adj.includes(WEST), e = adj.includes(EAST);
            if (w) hits.west++;
            if (e) hits.east++;
            if (w && e) hits.both++;
            if (w || e) hits.union++;
            hits.all++;
          },
          async ask(p) { if (++decisions > DECISION_LIMIT) throw new Error('limit'); return aiAnswer(p, state); },
        });
        games++;
      }
    }
  }
  return { hits, games };
}

const { hits, games } = await countLandings(SEEDS);
const per = n => (n / games).toFixed(2);
const ratio = hits.east / hits.west;
console.log(`\n落点次数（${games} 局）：西 ${per(hits.west)} 次/局，东 ${per(hits.east)} 次/局，`
  + `同时踩到两块 ${per(hits.both)} 次/局`);
console.log(`  东 / 西 = ${ratio.toFixed(3)}× ⇒ ${Math.abs(ratio - 1) < 0.05
  ? '两块在被踩次数上也等价'
  : '两块在被踩次数上**不等价**'}`);
if (Math.abs(ratio - 1) >= 0.05) throw new Error('两块不等价 —— 页面上「选哪一块」的说法需要重写');

// ---------- B) 只改共享格的报价顺序，归属会不会翻 ----------
console.log('\n只改共享格上「谁先报价」（不动价格、不动地图、不动 AI）：');
const flip = {};
for (const eastFirst of [false, true]) {
  const t = { west: 0, east: 0, both: 0, none: 0 };
  const styles = SLICE_STYLES.map(s => s.id);
  for (const style of styles) {
    const others = styles.filter(s => s !== style);
    for (const perm of [[others[0], others[1]], [others[1], others[0]]]) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const state = addEast(makeGame(style, seed, perm), { eastFirst });
        let decisions = 0;
        await runGame(state, {
          render() {}, async step() {},
          async ask(p) { if (++decisions > DECISION_LIMIT) throw new Error('limit'); return aiAnswer(p, state); },
        });
        const w = !!state.properties[WEST].ownerId, e = !!state.properties[EAST].ownerId;
        if (w && e) t.both++; else if (w) t.west++; else if (e) t.east++; else t.none++;
      }
    }
  }
  const n = 3 * 2 * SEEDS;
  flip[eastFirst ? 'east' : 'west'] = t;
  console.log(`  ${eastFirst ? '东先报价' : '西先报价'}：只有西 ${pct(t.west, n)} 只有东 ${pct(t.east, n)}`
    + ` 两块都有 ${pct(t.both, n)} 都没有 ${pct(t.none, n)}`);
}

const w = flip.west, e = flip.east;
const shifted = Math.abs(e.east - w.east) > 0.1;
console.log(`\n⇒ 把东块排到数组前面，只归属东块的局 ${pct(w.east, 3 * 2 * SEEDS)} → ${pct(e.east, 3 * 2 * SEEDS)}`
  + `${shifted ? '：**归属跟着数组顺序走**。' : '：顺序影响不显著。'}`);
if (!shifted) console.log('  （这一版没复现「顺序偏置」—— 别照抄，先查探针。）');
else console.log('  ⇒ 「第 4 天选哪一块」不是玩家的选择，是 adjacentPlots 的顺序。');
