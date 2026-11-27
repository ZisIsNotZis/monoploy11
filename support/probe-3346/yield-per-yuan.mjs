// #3346：把「书屋为什么赢」算成一张可核对的账，而不是一句印象。
//
// 关键结构事实（前面几片量出来的，这里只用它做算术）：
//   · 胜负 = 终局总资产 = 现金 + 存款 + 每块地按 buyPrice 记的价（economy.js assetsOf）。
//   · 所以**任何一次买地都是资产中性的**：现金换地产，分数当场不变。
//     真正改变分数的只有两件事：① 之后收到的租金 ② 付出去的租金/破产。
//   · 于是「买什么」只有一个判据：**每块钱买到的收租机会**。
//
// 这一支把那个判据印出来：一块地平均每局能撞上多少次（暴露面），一次收多少，
// 除以它的价钱。全部用产品自己的函数（rentFor / buyPrice / 地图相邻关系）现算，
// 不写死任何数。
//
// 用法：node support/probe-3346/yield-per-yuan.mjs
import { SLICE_MAP, createSliceConfig } from '../../src/data/slice.js';
import { startSession } from '../../src/engine/flow.js';
import { rentFor, buyPrice } from '../../src/engine/economy.js';

const state = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: true }));
const nodes = state.map.nodes.length;

// 暴露面：有多少个格子停在这里就会付租。引擎里就是 adjacentPlots。
const frontage = id => state.map.nodes.filter(n => n.adjacentPlots?.includes(id)).length;

// 店主视角的租金：把这块地临时归 0 号位，并假设同街己方地也归它（这是买下之后的样子）。
function rentAsOwner(id, alsoOwnStreet) {
  const plot = state.map.plots.find(p => p.id === id);
  const mine = state.players[0];
  const saved = { ...state.properties[id] };
  const savedOthers = [];
  try {
    state.properties[id] = { ...saved, ownerId: mine.id, level: Math.max(1, saved.level ?? 1) };
    for (const other of state.map.plots) {
      if (other.id === id || other.big || other.street !== plot.street) continue;
      const pr = state.properties[other.id];
      if (!pr) continue;
      savedOthers.push([other.id, { ...pr }]);
      state.properties[other.id] = { ...pr, ownerId: mine.id, level: Math.max(1, pr.level ?? 1) };
    }
    return rentFor(state, id);
  } finally {
    state.properties[id] = saved;
    for (const [oid, pr] of savedOthers) state.properties[oid] = pr;
  }
}

const rows = [];
for (const plot of state.map.plots) {
  const price = buyPrice(state, plot.id);
  const alone = rentAsOwner(plot.id, false);
  const withStreet = plot.big ? alone : rentAsOwner(plot.id, true);
  // 期望租金/「对手每走一步」= 一次收租 × 停在这里的概率。
  const expected = withStreet * frontage(plot.id) / nodes;
  rows.push({ plot, price, rent: withStreet, alone, frontage: frontage(plot.id), expected,
    perYuan: expected / price });
}

rows.sort((a, b) => b.perYuan - a.perYuan);
console.log('按「每 1,000 块钱买到的期望租金」排序（期望租金 = 一次租金 × 停在相邻格的概率）\n');
console.log('地块'.padEnd(14), '格数', '一次租金', '价钱'.padStart(7), '期望/步', '每千元', '同街独占时');
for (const r of rows) {
  console.log(
    `${r.plot.name}（${r.plot.street}）`.padEnd(14),
    String(r.frontage).padStart(4),
    String(r.rent).padStart(8),
    String(r.price).padStart(7),
    r.expected.toFixed(1).padStart(8),
    (r.perYuan * 1000).toFixed(3).padStart(7),
    r.plot.big ? '—' : String(r.alone).padStart(8),
  );
}

const market = rows.find(r => r.plot.big);
const shops = rows.filter(r => !r.plot.big);
const bestShop = shops.reduce((a, b) => (b.perYuan > a.perYuan ? b : a));
console.log(`\n书屋 每千元 ${(market.perYuan * 1000).toFixed(3)}；最好的小店 ${bestShop.plot.name} 每千元 ${(bestShop.perYuan * 1000).toFixed(3)}`);
console.log(`→ 书屋的每块钱产出是最好的小店的 ${(market.perYuan / bestShop.perYuan).toFixed(1)} 倍`);
console.log(`→ 小店要先被抬到 ${(market.perYuan / bestShop.perYuan).toFixed(1)} 倍租金，才和书屋一样值得买`);
