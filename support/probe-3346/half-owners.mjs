// #3346b：第一屏写「买下另一半这条街就归你一个人」（main.js:470）。
// 但「买下」在引擎里是**两件不同的事**：
//   · 另一半归对手 → 收购卡（125% 溢价），是 take 那条路线的招牌动作；
//   · 另一半是无主空地 → 只能走到旁边按标价买，和收购卡无关。
// 所以「补齐一条街」值不值，取决于**发牌表把另一半交给了谁**。
// 这一支只印开局事实，不做推断（谁拥有、哪个是无主）。
//
// 用法：node support/probe-3346/half-owners.mjs
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession } from '../../src/engine/flow.js';
import { acquisitionPrice, buyPrice } from '../../src/engine/economy.js';

const state = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: true }));
const name = id => state.players.find(p => p.id === id)?.name ?? '无主';
const plots = state.map.plots.filter(p => !p.big);

console.log('争街发牌表：每家两条街各一间，另一半归谁\n');
for (const p of state.players) {
  console.log(`${p.name}（${p.style}，座位 ${p.id}）`);
  for (const id of p.properties) {
    const street = state.properties[id].street;
    const half = plots.find(q => q.street === street && q.id !== id);
    if (!half) continue;
    const owner = state.properties[half.id].ownerId;
    const how = !owner ? `无主空地 → 只能走到旁边按标价买 ${buyPrice(state, half.id)}`
      : owner === p.id ? '已经是你的'
      : `${name(owner)} 的 → 收购卡 ${acquisitionPrice(state, half.id)}`;
    console.log(`  ${street.padEnd(3)} 你有 ${id.padEnd(4)}，另一半 ${half.id.padEnd(4)}：${how}`);
  }
  console.log('');
}

const unowned = plots.filter(q => !state.properties[q.id].ownerId).map(q => `${q.street}${q.name.slice(-2)}`);
console.log(`全场无主小店 ${unowned.length} 块：${unowned.join('、')}`);
console.log('（另一半若是无主，第一屏「买下另一半这条街」= 走到旁边按标价买，不是收购）');
