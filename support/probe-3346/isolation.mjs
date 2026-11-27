// #3346：先证明**量具本身**是干净的，再解释任何差值。
//
// 我自己的两支探针给出了互相打架的数：
//   knobs.mjs（60 seed，先跑平衡再跑 arms）grow 补街−不花 = +1.7pp
//   grid.mjs （30 seed，同样顺序）         grow 补街−不花 = +30.0pp
// 差 28pp。抽样解释不了它（60 局一格 SE≈6.5pp）。剩下的可能是：
//   (a) 真的抽样（30 局那格噪声极大）——可以靠重复测同一格来判断；
//   (b) 同一进程里前一局留下的状态影响了后一局（模块级单例、AI 记忆、地图被改过没还原）。
//
// 判据：**同一臂在同一进程里跑两遍，逐局结果必须逐位相同**。
// 若 A → B → A 的第三段与第一段不同，则跨局有污染，之前所有跨臂比较都不可信。
//
// 用法：node support/probe-3346/isolation.mjs [30]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const SEEDS = Number(process.argv[2] ?? 30);
const DECISION_LIMIT = 5000;

async function play({ style, seed, order, spend }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  const wanted = [style, ...order];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  let decisions = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      if (prompt.type === 'buy' && prompt.player?.id === seat0.id && prompt.plot) {
        if (spend === 'none') return false;
        if (spend === 'fill') {
          const mineOnStreet = state.map.plots.some(x => x.id !== prompt.plot.id && !x.big
            && x.street === prompt.plot.street && state.properties[x.id]?.ownerId === seat0.id);
          if (prompt.plot.big || !mineOnStreet) return false;
        }
        if (spend === 'big' && !prompt.plot.big) return false;
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  // 逐局指纹：胜者 + 资产 + 收租。只要有一项变，就说明这一局不是可复现的。
  const w = state.players.find(p => p.team === state.winnerTeam);
  return `${state.winnerTeam}/${w?.style ?? 'none'}/${seat0.sliceStats.rentEarned}/${Math.round(seat0.cash)}`;
}

const order = ['take', 'cross'];   // grow 的两种对手座位排列之一种，固定下来
const block = async (label, spend) => {
  const out = [];
  for (let seed = 1; seed <= SEEDS; seed++) out.push(await play({ style: 'grow', seed, order, spend }));
  console.log(`${label.padEnd(22)} 指纹前 3 局：${out.slice(0, 3).join(' | ')}`);
  return out.join(',');
};

console.log('# 同一臂在同一进程里跑两遍；中间插入另一臂（模拟 arms 循环的顺序）\n');
const a1 = await block('A1 none', 'none');
const b1 = await block('B  fill（中间插入）', 'fill');
const a2 = await block('A2 none（再来一遍）', 'none');
const b2 = await block('B   fill（再来一遍）', 'fill');

console.log(`\nnone 两遍逐位相同：${a1 === a2 ? '是 ✅' : '**否 —— 跨局污染**'}`);
console.log(`fill 两遍逐位相同：${b1 === b2 ? '是 ✅' : '**否 —— 跨局污染**'}`);
if (a1 !== a2 || b1 !== b2) {
  const x = a1.split(','), y = a2.split(',');
  const diff = x.map((v, i) => (v === y[i] ? null : `seed ${i + 1}: ${v} → ${y[i]}`)).filter(Boolean);
  console.log('不同的局：\n  ' + diff.slice(0, 10).join('\n  '));
  process.exitCode = 1;
}
