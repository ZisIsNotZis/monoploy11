// #3346：两支探针给出互相打架的数，先停下把它们分开 —— 不许在打架的数上做决定。
//
//   support/probe-3346/knobs.mjs  60 seed：grow  none 50.0% / fill 51.7%  → +1.7pp
//   support/probe-3346/grid.mjs   30 seed：grow  none ?  / fill ?        → +30.0pp
// 同一个 fill 定义（只买「己方已有店的那条街」的空地，排除书屋）、同样的 seed 起点、
// 同样的对手座位。差 28pp 不可能是抽样（60 局一格的 SE 约 6.5pp）。
//
// 这一支把「任何」与「不花」也一起印出来做三角验证：
//   none ≤ any 是必然的（any 能选 none 的任何一步，只是限制更少）。
//   如果 none > any，说明量具的作答路径本身串了。
// 同时印出 fill 臂**实际买了几块**（0 块就说明那道闸门根本没放行，读数没有意义）。
//
// 用法：node support/probe-3346/ab-fill.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;

async function play({ style, seed, order, spend }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  const wanted = [style, ...order];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (state.players.map(p => p.style).join(',') !== wanted.join(',')) throw new Error('SEATING MISMATCH');
  const seat0 = state.players[0];
  let decisions = 0, buyPrompts = 0, smallBuys = 0;
  await runGame(state, {
    render() {},
    async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      if (prompt.type === 'buy' && prompt.player?.id === seat0.id && prompt.plot) {
        buyPrompts++;
        if (spend === 'none') return false;
        if (spend === 'fill') {
          const mineOnStreet = state.map.plots.some(x => x.id !== prompt.plot.id && !x.big
            && x.street === prompt.plot.street && state.properties[x.id]?.ownerId === seat0.id);
          if (prompt.plot.big || !mineOnStreet) return false;
        }
        const ok = aiAnswer(prompt, state);
        if (ok && !prompt.plot.big) smallBuys++;
        return ok;
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return { win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive, buyPrompts, smallBuys, assets: assetsOf(state, seat0),
    rentEarned: seat0.sliceStats.rentEarned };
}

const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length;

for (const style of ['grow', 'take', 'cross']) {
  const orders = (() => {
    const others = SLICE_STYLES.filter(s => s.id !== style).map(s => s.id);
    return [[others[0], others[1]], [others[1], others[0]]];
  })();
  const out = {};
  for (const spend of ['none', 'fill', 'any']) {
    const rows = [];
    for (const order of orders) for (let seed = 1; seed <= SEEDS; seed++) {
      rows.push(await play({ style, seed, order, spend: spend === 'any' ? null : spend }));
    }
    out[spend] = rows;
    console.log(`${style.padEnd(6)} ${spend.padEnd(4)} 胜率 ${pct(rows.filter(r => r.win).length / rows.length).padEnd(7)}`
      + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
      + ` 买地提示 ${mean(rows, 'buyPrompts').toFixed(1)}/局 实买小店 ${mean(rows, 'smallBuys').toFixed(2)} 块`
      + ` 收租 ${Math.round(mean(rows, 'rentEarned'))}`);
  }
  const w = k => out[k].filter(r => r.win).length / out[k].length;
  console.log(`       三角：none ≤ any ? ${w('none') <= w('any') + 1e-9 ? '是' : '**否 —— 量具串了**'}`
    + `（none ${pct(w('none'))} / any ${pct(w('any'))}）`);
  console.log(`       fill − none = ${((w('fill') - w('none')) * 100).toFixed(1)}pp`
    + `　any − none = ${((w('any') - w('none')) * 100).toFixed(1)}pp\n`);
}
