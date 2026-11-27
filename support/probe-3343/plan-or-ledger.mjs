// #3343 修正：把「回本」拆成两本账 —— 资产账 与 现金账。
//
// 我上一稿写的「买地回本要 8.4 局 ⇒ 它不是计划，是记账」混淆了三件事：
//   ① 资产账：slice 的 assetsOf 用 buyPrice 记账，买下 8,000 的店，现金 -8,000、
//      资产 +8,000，**当场资产不变**。所以买地不会让终局资产变低，8.4 局
//      说的从来不是「资产要 8.4 局才回来」，而是「租金现金流要 8.4 局才补回这 8,000 现金」。
//   ② 现金账：押进去的钱会在这一局剩下的时间里变成流动性约束 —— 买不下一块、盖不起一级。
//   ③ 计划账：一间新店的**增量收益**（自己的租金 + 若与己方已有店同街则抬高整条街的乘数）
//      是否值得那 8,000 的流动性。
//
// 判据（可复跑、离线）：
//   同 seed 配对，只改人类座位（seat 0）一个策略开关：
//     control  = 引擎原样（会买）
//     nobuy    = seat 0 对每一张 buy 提议都答「放弃」，其余不动
//   若 nobuy 与 control 胜率差 ≈ 0 ⇒ 「买地」既不帮忙也不伤人，是装饰（我原来的结论）。
//   若 control 明显更高 ⇒ 买地是计划，8.4 局那句只描述了现金流，不该升级成「不可能回本」。
//   若 nobuy 更高 ⇒ 买地在拖后腿（现金账压过收益账），那时才该谈改经济。
//
// 同时记录 seat 0 的：买了几个、花掉多少、局中最低现金、季末现金/资产。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 40);
const STYLES = ['grow', 'take', 'cross'];
const ARMS = ['control', 'nobuy'];

const out = {};
for (const arm of ARMS) for (const style of STYLES) {
  const row = out[`${arm}/${style}`] = { games: 0, wins: 0, seat0Assets: 0, seat0Cash: 0,
    seat0Rent: 0, seat0Plots: 0, seat0Buys: 0, seat0BuySpend: 0, seat0MinCash: 0, seat0Bankrupt: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const state = startSession(createSliceConfig({ human: false, seed, style }));
    const seat0 = state.players[0];
    const plots0 = new Set(seat0.properties);
    let spend = 0, buys = 0, minCash = seat0.cash;
    await runGame(state, {
      render() { minCash = Math.min(minCash, seat0.cash); },
      async step() {},
      async ask(prompt) {
        if (prompt.type === 'buy' && prompt.player?.id === seat0.id) {
          if (arm === 'nobuy') return false;
          minCash = Math.min(minCash, seat0.cash);
          const ok = aiAnswer(prompt, state);
          if (ok) { spend += prompt.price; buys += 1; }
          return ok;
        }
        if (prompt.type === 'build' && prompt.player?.id === seat0.id) {
          minCash = Math.min(minCash, seat0.cash);
        }
        return aiAnswer(prompt, state);
      },
    });
    if (!state.over) continue;
    row.games++;
    if (state.winnerTeam === seat0.team) row.wins++;
    row.seat0Assets += assetsOf(state, seat0);
    row.seat0Cash += seat0.cash;
    row.seat0Rent += seat0.sliceStats.rentEarned;
    row.seat0Plots += seat0.properties.length - plots0.size;
    row.seat0Buys += buys;
    row.seat0BuySpend += spend;
    row.seat0MinCash += minCash;
    if (!seat0.alive) row.seat0Bankrupt++;
  }
  for (const k of ['seat0Assets', 'seat0Cash', 'seat0Rent', 'seat0Plots', 'seat0BuySpend', 'seat0MinCash']) row[k] = Math.round(row[k] / row.games);
  row.winRate = +(100 * row.wins / row.games).toFixed(1);
  row.seat0Buys = +(row.seat0Buys / row.games).toFixed(2);
}

// 资产账的算术核对：买 8,000 的店，现金 -8,000、资产 0 —— 用引擎自己的 assetsOf 验一次。
{
  const state = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow' }));
  const seat0 = state.players[0];
  const free = state.map.plots.find(p => !p.big && !state.properties[p.id].ownerId);
  const before = assetsOf(state, seat0), cashBefore = seat0.cash;
  const price = 8000;
  seat0.cash -= price;
  state.properties[free.id] = { ...state.properties[free.id], ownerId: seat0.id, level: state.properties[free.id].level || 1 };
  seat0.properties.push(free.id);
  console.log('=== 资产账核对 ===');
  console.log(JSON.stringify({ 店: free.name, 现金变化: seat0.cash - cashBefore, 资产变化: assetsOf(state, seat0) - before,
    说明: '资产变化 0 表示买地当场不改资产；8.4 局只描述租金现金流补回这笔现金' }));
}

console.log('\n=== 配对：seat 0 买 vs 不买 ===');
for (const style of STYLES) {
  const c = out[`control/${style}`], n = out[`nobuy/${style}`];
  console.log(JSON.stringify({
    起手: style,
    买: `${c.winRate}%`, 不买: `${n.winRate}%`, 差pp: +(c.winRate - n.winRate).toFixed(1),
    买_次数: c.seat0Buys, 买_净增店数: c.seat0Plots, 买_花费: c.seat0BuySpend, 买_收租: c.seat0Rent, 买_季末现金: c.seat0Cash,
    不买_季末现金: n.seat0Cash, 不买_收租: n.seat0Rent,
    买_局中最低现金: c.seat0MinCash, 不买_局中最低现金: n.seat0MinCash,
    破产: `${c.seat0Bankrupt}/${n.seat0Bankrupt}`,
  }));
}
console.log('\n原始分组：');
for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify(v));
