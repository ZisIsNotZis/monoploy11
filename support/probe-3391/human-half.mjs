// #3391u：README/首屏那句话到底该怎么写 —— 用**真实入口的座位表**（human: true）核对。
//
// 为什么要单独一支：`support/probe-3346/half-owners.mjs` 用的是 `human: false`（三座位全是 AI），
// 它证明了「0 号位拿到的两条街另一半是无主空地」，但没有证明**人类坐的就是 0 号位**、
// 也没有证明这件事与所选起手无关。README 同一段先写「另一半可能是对手的」、后写
// 「开局 100% 是无主空地」，就是在这两个前提上没对齐（supervisor 在真机读出来的）。
//
// 判据（任一不成立就抛，不打印结论）：
//   ① 人类确实坐在 0 号位；
//   ② 人类手上每间店所在街的另一半，归属为「无主」；
//   ③ 这件事在三个起手、多个 seed 上都成立；
//   ④ 两个 AI 座位的另一半**互相**归对方（所以「收购」只在他们之间有意义）。
//
// 用法：node support/probe-3391/human-half.mjs
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession } from '../../src/engine/flow.js';

const SEEDS = [1, 2, 3, 4, 5];
let humanSeat = null;
const report = [];

for (const style of SLICE_STYLES) {
  for (const seed of SEEDS) {
    const state = startSession(createSliceConfig({ human: true, seed, style: style.id,
      sliceContestedStreets: true }));
    const seats = state.players.map((p, i) => ({ i, p }));
    const humans = seats.filter(({ p }) => p.controller === 'human');
    if (humans.length !== 1) throw new Error(`human seats !== 1 (${humans.length})`);
    const { i, p: human } = humans[0];
    if (humanSeat === null) humanSeat = i;
    if (i !== humanSeat) throw new Error(`human seat moved: ${humanSeat} -> ${i}`);
    if (i !== 0) throw new Error(`human is not seat 0 (seat ${i}) — README 说的「0 号位」就不成立`);

    const plots = state.map.plots.filter(q => !q.big);
    const rows = [];
    for (const id of human.properties) {
      const street = state.properties[id].street;
      const half = plots.find(q => q.street === street && q.id !== id);
      if (!half) throw new Error(`street ${street} has no second shop — 争街表假设每街两间`);
      const owner = state.properties[half.id].ownerId;
      rows.push({ street, mine: id, half: half.id, owner: owner ?? null });
      // ② 硬断言：人类这半边的对面必须是无人持有的空地。
      if (owner) {
        throw new Error(`HUMAN-HALF-OWNED style=${style.id} seed=${seed} `
          + `${street} 的另一半 ${half.id} 归 ${state.players.find(x => x.id === owner)?.name}`);
      }
    }
    // ④ 两个 AI 座位的另一半互相归对方。
    for (const { i: seat, p } of seats) {
      if (seat === humanSeat) continue;
      for (const id of p.properties) {
        const street = state.properties[id].street;
        const half = plots.find(q => q.street === street && q.id !== id);
        const owner = state.properties[half.id]?.ownerId;
        if (!owner) continue; // AI 的另一半若是空地，不算错，只记录
        if (owner === p.id) throw new Error(`AI ${p.name} 自己持有整条 ${street}`);
        const ownerSeat = state.players.find(x => x.id === owner);
        if (ownerSeat.controller === 'human') {
          throw new Error(`AI 的另一半归人类：${street} ${half.id} — README 说「只有 AI 之间」就错了`);
        }
      }
    }
    report.push({ style: style.id, seed, rows });
  }
}

// 只打印一件事：人类那两条街的名字与另一半。
const key = r => r.rows.map(x => `${x.street} 我 ${x.mine} / 另一半 ${x.half}=无主`).join('；');
const uniq = [...new Set(report.map(key))];
console.log(`人类座位：${humanSeat}（真实入口 human:true；三个起手 × ${SEEDS.length} seed 全部一致）\n`);
for (const line of uniq) console.log(`  ${line}`);
console.log(`\n判定：${report.length} 局里，人类这两条街的另一半**没有一次**归别人；`
  + `两个 AI 的另一半只在他们之间互转（或同样是无主）。`);
console.log('⇒ 首屏/README 可以说「你那条街的另一半开局是空地，走过去按标价买」，'
  + '但不能说它「可能是对手的」。');
