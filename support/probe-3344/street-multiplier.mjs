// #3344：让「补齐一条街」变成第二条真路线 —— 先量唯一的那个旋钮。
//
// 已量到的事实链（不要重测）：
//   · 每条街只有 2 间店（src/data/slice.js makeMap）。
//   · 同街乘数 = 1 + 0.4 × (本街己方店数 − 1) ⇒ 一间街最多 ×1.4（独占）或 ×1.8（两间都你的）。
//   · 争街开局下，只买**己方街空地**（补齐）相对不花钱 = +1.7/+3.3/+5pp；
//     只押书屋 = +30/+33/+35pp。量级差 6–10 倍（openings.mjs arms，60 seed/格）。
//
// 所以问题不是「补齐有没有用」，而是「它最多只值一间店的 40%，而书屋是一条独立的大地产」。
// 这一支扫 TUNING.streetMultiplier（探针里直接改这个导出对象的属性，不碰产品字节），
// 看两件事：
//   ① 补齐的边际值能不能升到与书屋同一量级；
//   ② 三条起手的差距会不会被这个旋钮拉爆（#3342 栽在这里过）。
//
// 为什么这是唯一该先试的旋钮：它只放大「已经有店的那条街」，不改任何价格、不改开局表、
// 不新增规则；而且引擎里本来就只有一个系数（economy.js rentFor 的 chain）。
// 是否只作用于 slice 属于产品化细节，量完再决定。
//
// 用法：node support/probe-3344/street-multiplier.mjs 40
import { TUNING } from '../../src/data/tuning.js';
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { rentFor, assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 40);
const STYLES = ['grow', 'take', 'cross'];
const MULTIPLIERS = [0.4, 0.7, 1.0];
const ARMS = ['none', 'fill', 'big'];
const DECISION_LIMIT = 5000;
const pct = x => `${(100 * x).toFixed(1)}%`;
const pp = x => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}pp`;

const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

async function play({ style, seed, order, contested, spend }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: contested });
  const wanted = [style, ...order];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (state.players.map(p => p.style).join(',') !== wanted.join(',')) throw new Error('SEATING MISMATCH');
  const seat0 = state.players[0];
  let decisions = 0, smallBuys = 0, bigBuys = 0, minCash = seat0.cash;
  await runGame(state, {
    render() { minCash = Math.min(minCash, seat0.cash); },
    async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      minCash = Math.min(minCash, seat0.cash);
      if (spend !== 'none' && prompt.type === 'buy' && prompt.player?.id === seat0.id && prompt.plot) {
        const isMarket = prompt.plot.id === 'market';
        if (spend === 'fill') {
          if (isMarket) return false;
          const mineOnStreet = state.map.plots.some(x => x.id !== prompt.plot.id && !x.big
            && x.street === prompt.plot.street && state.properties[x.id]?.ownerId === seat0.id);
          if (!mineOnStreet) return false;
        }
        if (spend === 'big' && !isMarket) return false;
        const ok = aiAnswer(prompt, state);
        if (ok) { if (isMarket) bigBuys++; else smallBuys++; }
        return ok;
      }
      if (spend === 'none' && prompt.type === 'buy' && prompt.player?.id === seat0.id) return false;
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const winner = state.players.find(p => p.team === state.winnerTeam);
  return { win: winner === seat0, bankrupt: !seat0.alive, smallBuys, bigBuys,
    rentEarned: seat0.sliceStats.rentEarned, assets: assetsOf(state, seat0), minCash };
}

const rate = (xs, k) => xs.filter(r => r[k]).length / xs.length;
const mean = (xs, k) => Math.round(xs.reduce((a, r) => a + r[k], 0) / xs.length);

const original = TUNING.streetMultiplier;
try {
  for (const m of MULTIPLIERS) {
    TUNING.streetMultiplier = m;
    console.log(`\n===== 同街乘数 ${m}（一间街 ×${(1).toFixed(2)}…两间 ×${(1 + m).toFixed(2)}）=====`);
    // 先把「补齐」到底能多收多少印出来：一句可核对的话，不靠胜率去猜。
    {
      const s = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: true }));
      const me = s.players[0];
      const target = s.map.plots.find(pl => !pl.big && !s.properties[pl.id].ownerId
        && s.map.plots.some(x => x.id !== pl.id && !x.big && x.street === pl.street
          && s.properties[x.id]?.ownerId === me.id));
      const mine = s.map.plots.find(x => x.id !== target.id && !x.big && x.street === target.street
        && s.properties[x.id]?.ownerId === me.id);
      const before = rentFor(s, mine.id);
      const saved = { ...s.properties[target.id] };
      s.properties[target.id] = { ...saved, ownerId: me.id };
      const after = rentFor(s, mine.id);
      s.properties[target.id] = saved;
      console.log(`  ${target.street}：补齐前这间 ${before} → 补齐后 ${after}（同一间店，多收 ${after - before}）`);
    }
    for (const style of STYLES) {
      const cell = {};
      for (const arm of ARMS) {
        const rows = [];
        for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) {
          rows.push(await play({ style, seed, order, contested: true, spend: arm }));
        }
        cell[arm] = rows;
        console.log(`  ${style.padEnd(6)} ${arm.padEnd(4)} 胜率 ${pct(rate(rows, 'win')).padEnd(7)}`
          + ` 破产 ${pct(rate(rows, 'bankrupt')).padEnd(6)} 补街 ${(rows.reduce((a, r) => a + r.smallBuys, 0) / rows.length).toFixed(2)}`
          + ` 书屋 ${(rows.reduce((a, r) => a + r.bigBuys, 0) / rows.length).toFixed(2)}`
          + ` 收租 ${mean(rows, 'rentEarned')} 最低现金 ${mean(rows, 'minCash').toLocaleString()}`);
      }
      console.log(`         补齐 相对 不花 = ${pp(rate(cell.fill, 'win') - rate(cell.none, 'win'))}`
        + `　书屋 相对 不花 = ${pp(rate(cell.big, 'win') - rate(cell.none, 'win'))}`);
    }
  }
} finally {
  TUNING.streetMultiplier = original;
}
