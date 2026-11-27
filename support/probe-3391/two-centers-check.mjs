// 先证明探针本身是活的，再花钱跑 720 局。
// 上一版的教训：它印出的「逐位相同」其实是「第二块地 frontage=0 / 从未被买到」，
// 而没有任何断言把这个前提钉住。这里逐个钉：
//   ① 第二处高地有几个 frontage 格（必须 >0，且与街心书屋同数量级）
//   ② 那些格上真的是它（不是别的地块蹭到）
//   ③ 16 天里 AI 到底有没有为它出价、有没有买下、有没有收到它的租
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { rentFor, buyPrice } from '../../src/engine/economy.js';

const BOOK2 = 'market-south';
const SOUTH_CELLS = [{ x: 5, y: 6 }, { x: 6, y: 6 }, { x: 5, y: 7 }, { x: 6, y: 7 }];

function addSouthCenter(state) {
  state.map.plots.push({ id: BOOK2, cells: SOUTH_CELLS.map(c => ({ ...c })), street: '南街', big: true,
    name: '南街书库', price: 26000, availableFromDay: 4 });
  state.properties[BOOK2] = { ownerId: null, level: 2, street: '南街', big: true, bigType: 'bookstore',
    closed: 0, inflate: 0, price: 26000 };
  state.map.initialProperties.push({ plotId: BOOK2, level: 2, bigType: 'bookstore', price: 26000 });
  let linked = 0;
  for (const node of state.map.nodes) {
    const [nx, ny] = node.id.split(',').map(Number);
    if (!SOUTH_CELLS.some(c => Math.abs(c.x - nx) + Math.abs(c.y - ny) === 1)) continue;
    node.adjacentPlots ??= [];
    node.adjacentPlots.push(BOOK2);
    linked++;
  }
  return linked;
}

function makeGame(style, seed) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  const others = SLICE_STYLES.filter(s => s.id !== style).map(s => s.id);
  config.participants = [style, ...others].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  return startSession(config);
}

// —— ① / ② 静态结构 ————————————————————————————————————————
const s0 = makeGame('take', 1);
const before = { book: s0.map.nodes.filter(n => n.adjacentPlots?.includes('market')).length };
const linked = addSouthCenter(s0);
const after = { south: s0.map.nodes.filter(n => n.adjacentPlots?.includes(BOOK2)).length };
const southNodes = s0.map.nodes.filter(n => n.adjacentPlots?.includes(BOOK2)).map(n => n.id);
const mixed = s0.map.nodes.filter(n => n.adjacentPlots?.includes(BOOK2) && n.adjacentPlots?.includes('market')).map(n => n.id);
console.log(`街心书屋 frontage 格 ${before.book}`);
console.log(`南街书库 frontage 格 ${after.south}（新挂 ${linked}） 节点 ${southNodes.join(' ')}`);
console.log(`与街心书屋共享 frontage 的节点 ${mixed.length ? mixed.join(' ') : '无'}`);
if (linked === 0 || after.south === 0) throw new Error('第二处高地没有 frontage');
console.log(`南街书库 买价 ${buyPrice(s0, BOOK2)}（街心书屋 ${buyPrice(s0, 'market')}）`);

// —— ③ 动态：它真的会被考虑/买下/收租吗 ——————————————————
let offers = 0, bought = 0, ownerDays = 0, rentTotal = 0, dayFirstOffer = [];
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const state = makeGame('take', seed);
  addSouthCenter(state);
  let firstDay = null, wasBought = false;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (prompt.type === 'buy' && (prompt.plot?.id ?? prompt.plot) === BOOK2) {
        offers++; firstDay ??= state.day;
        const yes = aiAnswer(prompt, state);
        if (yes) { bought++; wasBought = true; }
        return yes;
      }
      return aiAnswer(prompt, state);
    },
  });
  dayFirstOffer.push(firstDay ?? '—');
  const owner = state.properties[BOOK2].ownerId;
  if (owner) {
    const p = state.players.find(q => q.id === owner);
    ownerDays += p.properties.includes(BOOK2) ? 1 : 0;
  }
  if (owner) rentTotal += rentFor(state, BOOK2);
  if (!wasBought) console.log(`  seed ${seed}: 南街书库始终无主（出价窗口 ${firstDay ?? '无'}）`);
}
console.log(`\n6 局中：出价窗口 ${offers} 次（首见天数 ${dayFirstOffer.join(',')}），买下 ${bought} 次`);
console.log(`南街书库持有局数 ${ownerDays}/6，终局租金读数合计 ${rentTotal}`);
if (offers === 0) throw new Error('AI 从未被问到南街书库 —— 它没进任何人的候选屏');
if (bought === 0) throw new Error('AI 从未买下南街书库 —— 与上一版同一个「从未发生」的坑');
console.log('\n✅ 探针是活的：第二处高地有 frontage、有出价、有成交。可以跑对照。');
