// #3346b：第一屏对争街写「买下另一半这条街就归你一个人」（main.js:470），
// 对「机会买家」写「看准别人养好的店，带着现金入场」（slice.js hooks）。
// 两句话把「补齐一条街」和「收购」绑在一起。这一支只数事实：
//   0 号位（= 真实入口里人类的座位）那两条街，另一半最终是**怎么**到手的？
//     · 走到旁边按标价买（引擎本来就这么奖励）
//     · 收购卡（125% 溢价）
//     · 一直没到手
// 以及：开局那一刻，另一半是空地还是别人的店（决定「收购」这条路从第几天才存在）。
//
// 用法：node support/probe-3346/how-streets-complete.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { buyPrice } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];

async function play(style, seed) {
  const others = SLICE_STYLES.filter(s => s.id !== style).map(s => s.id);
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...others].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  const smallPlots = state.map.plots.filter(p => !p.big);

  // 我的两条街 + 各自的另一半
  const myStreets = [...new Set(seat0.properties.map(id => state.properties[id].street))];
  // 另一半 = 同街、非我持有的那块小店。（plots 对象上没有 ownerId，归属在 state.properties。）
  const halves = myStreets.map(street => smallPlots.find(q => q.street === street && !seat0.properties.includes(q.id))).filter(Boolean);
  const startOwner = halves.map(h => {
    const owner = state.properties[h.id].ownerId;
    return !owner ? '空地' : owner === seat0.id ? '自己' : '对手';
  });

  // 记录谁在什么时候拿到另一半：比较每回合结束时 seat0 的 properties 变化。
  // 收购会走 game.js buyland 分支并计入 p.sliceStats.takeovers，所以两者可分开。
  let decisions = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      return aiAnswer(prompt, state);
    },
  });
  const finishedBy = halves.map(h => state.properties[h.id].ownerId === seat0.id ? '到手' : '没到手');
  return { startOwner, finishedBy, takeovers: seat0.sliceStats.takeovers ?? 0,
    completedStreets: myStreets.filter(street => smallPlots
      .filter(q => q.street === street).every(q => state.properties[q.id].ownerId === seat0.id)).length,
    cost: halves.map(h => buyPrice(state, h.id)) };
}

const tally = (rows, key) => {
  const m = new Map();
  for (const r of rows) for (const v of r[key]) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([k, v]) => `${k} ${(100 * v / (rows.length * rows[0][key].length)).toFixed(1)}%`).join('  ');
};
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length;

console.log(`争街，0 号位（人类座位），每局 2 条街 ⇒ 每格 ${SEEDS * 2} 条「另一半」样本\n`);
for (const style of STYLES) {
  const rows = [];
  for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play(style, seed));
  const totalHalves = rows.length * 2;
  const got = rows.reduce((a, r) => a + r.finishedBy.filter(x => x === '到手').length, 0);
  console.log(`${style.padEnd(6)}`);
  console.log(`  开局另一半：      ${tally(rows, 'startOwner')}`);
  console.log(`  终局另一半：      ${tally(rows, 'finishedBy')}   ⇒ 补齐率 ${(100 * got / totalHalves).toFixed(1)}%`);
  console.log(`  一局补齐几条街：  ${mean(rows, 'completedStreets').toFixed(2)}/2   收购卡成交 ${mean(rows, 'takeovers').toFixed(2)} 次/局`);
}
