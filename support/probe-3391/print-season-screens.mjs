// #3456：把旺季/平常两种现场、剩余 1–3 天的每一句真实打印出来。
// 只调产品自己的 buildForwardLine，不改任何东西。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession } from '../../src/engine/flow.js';
import { buildForwardLine, buildForwardK } from '../../src/ui/slice.js';
import { seasonTerms, seasonLength } from '../../src/engine/payback.js';

const s = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: true }));
const [p] = s.players;
const id = s.map.plots.find(x => x.name === '月色街茶铺').id;
for (const plot of s.map.plots) {
  if (plot.id === id) continue;
  if (!plot.big) s.properties[plot.id].ownerId = null;
  s.properties[plot.id].inflate = 0; s.properties[plot.id].closed = 0;
}
s.properties[id].ownerId = p.id;
s.properties[id].level = 1;
s.properties[id].closed = 0;
if (!p.properties.includes(id)) p.properties.push(id);
s.day = 6;
s.priceIndex = 1;

console.log(`季节长度（读产品自己的卡面）：${seasonLength(s)} 天\n`);
for (const daysLeft of [0, 1, 2, 3]) {
  s.properties[id].inflate = daysLeft;
  const terms = seasonTerms(s, id, 1);
  const info = buildForwardK(s, id, 10000);
  console.log(`=== inflate=${daysLeft}（${daysLeft ? '旺季' : '平常'}）maxPerDay=${terms.maxPerDay} ===`);
  console.log(buildForwardLine(s, id, 10000));
  console.log('');
}
