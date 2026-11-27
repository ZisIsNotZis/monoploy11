// #3343 续2：把「买地」拆到底 —— 小店 与 书屋 是两种完全不同的东西。
//
// which-plan.mjs 撞出两件必须分开量的事：
//   ① 它的 same 支与 hold 支读数**逐位相同**，同街买入次数一直是 0。
//      原因不是我的过滤器写错，是开局表本身：STARTS_WHOLE_STREET 让每家从 t=0 就
//      占满自己那条街的两间，**「补齐一条街」无处可补**。
//   ② plan-or-ledger.mjs 里 take/cross 的 +24～25pp 可能根本不是小店贡献的。
//
// 所以这一支把花钱拆成四档，同 seed 配对，只改 0 号位的 buy 应答：
//   any   引擎原样 / none 一律不买 / small 只买小店 / big 只买大地产（书屋）
// 判据：
//   若 big ≈ any ≫ small ≈ none ⇒ 「买地」的胜负手是**书屋**，小店是负值；
//   那两条「讲得通的计划」就不该建在小店上（不管它们听起来多像一条街的计划）。
//
// 附带核对同街乘数：ownsStreet 用 pr.street 过滤，而 createGame 的 initialProperties
// 没有 street 字段（只有 buyPlot 会写）。如果属实，开局自带的两间店**从来不吃同街加成**，
// 「凑齐一条街」这个卖点在引擎里等于不存在 —— 这比胜率更硬，必须单独验。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor, ownsStreet } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const CONTESTED = process.argv[3] === 'cross';
const LAYOUT = CONTESTED ? '争街 (?cross=1)' : '默认（每人整条街）';
const STYLES = ['grow', 'take', 'cross'];
const ARMS = ['any', 'none', 'small', 'big'];

const out = {};
for (const arm of ARMS) for (const style of STYLES) {
  const row = out[`${arm}/${style}`] = { games: 0, wins: 0, bankrupt: 0,
    buys: 0, smallBuys: 0, bigBuys: 0, spend: 0, rentEarned: 0, cash: 0, assets: 0, minCash: 0, netPlots: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const state = startSession(createSliceConfig({ human: false, seed, style, sliceContestedStreets: CONTESTED }));
    const seat0 = state.players[0];
    const plots0 = new Set(seat0.properties);
    let buys = 0, smallBuys = 0, bigBuys = 0, spend = 0, minCash = seat0.cash;
    await runGame(state, {
      render() { minCash = Math.min(minCash, seat0.cash); },
      async step() {},
      async ask(prompt) {
        if (prompt.type === 'buy' && prompt.player?.id === seat0.id) {
          minCash = Math.min(minCash, seat0.cash);
          const plot = prompt.plot;
          if (!plot) return aiAnswer(prompt, state);
          if (arm === 'none') return false;
          if (arm === 'small' && plot.big) return false;
          if (arm === 'big' && !plot.big) return false;
          const ok = aiAnswer(prompt, state);
          if (ok) { buys++; spend += prompt.price; if (plot.big) bigBuys++; else smallBuys++; }
          return ok;
        }
        return aiAnswer(prompt, state);
      },
    });
    if (!state.over) continue;
    row.games++;
    if (state.winnerTeam === seat0.team) row.wins++;
    if (!seat0.alive) row.bankrupt++;
    row.buys += buys; row.smallBuys += smallBuys; row.bigBuys += bigBuys; row.spend += spend;
    row.rentEarned += seat0.sliceStats.rentEarned;
    row.cash += seat0.cash; row.assets += assetsOf(state, seat0); row.minCash += minCash;
    row.netPlots += seat0.properties.length - plots0.size;
  }
  const n = row.games || 1;
  row.winRate = +(100 * row.wins / n).toFixed(1);
  row.bankruptRate = +(100 * row.bankrupt / n).toFixed(1);
  for (const k of ['buys', 'smallBuys', 'bigBuys', 'spend', 'rentEarned', 'cash', 'assets', 'minCash', 'netPlots']) row[k] = Math.round(row[k] / n);
}

console.log('=== 四种花钱档 · ' + LAYOUT + '（同 seed 配对，每格 ' + SEEDS + ' 局）===');
for (const style of STYLES) {
  console.log('\n起手 ' + style);
  for (const arm of ARMS) {
    const r = out[`${arm}/${style}`];
    console.log('  ' + arm.padEnd(5), JSON.stringify({
      胜率: r.winRate + '%', 破产: r.bankruptRate + '%', 买: r.buys, 小店: r.smallBuys, 书屋: r.bigBuys,
      花: r.spend, 收租: r.rentEarned, 现金: r.cash, 资产: r.assets, 最低现金: r.minCash, 净增店: r.netPlots,
    }));
  }
  const a = out[`any/${style}`], n = out[`none/${style}`], s = out[`small/${style}`], b = out[`big/${style}`];
  console.log('  差(pp): none−any', +(n.winRate - a.winRate).toFixed(1),
    ' small−any', +(s.winRate - a.winRate).toFixed(1),
    ' big−any', +(b.winRate - a.winRate).toFixed(1));
}

// 同街乘数：开局自带的店有没有 street 字段？
{
  const state = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: CONTESTED }));
  const seat0 = state.players[0];
  const own = seat0.properties.find(id => !state.properties[id].big);
  const pr = state.properties[own];
  const plot = state.map.plots.find(p => p.id === own);
  const team = seat0.team;
  const countsByStreetField = {};
  for (const id of seat0.properties) {
    const s = state.properties[id].street ?? '(无 street 字段)';
    countsByStreetField[s] = (countsByStreetField[s] ?? 0) + 1;
  }
  const r = rentFor(state, own);
  // 手工补上 street 后再问一次，看乘数会不会出现（开局记录里本就带 street，所以这一步是负对照）。
  state.properties[own] = { ...pr, street: plot.street };
  const rFixed = rentFor(state, own);
  state.properties[own] = pr;
  console.log('\n=== 开局自带店的 street 字段 ===');
  console.log(JSON.stringify({
    店: plot.name, 地图上的街: plot.street,
    记录里的street: pr.street ?? null,
    本队各店归属: countsByStreetField,
    ownsStreet按street统计: ownsStreet(state, team, plot.street),
    租金_现状: r, 租金_补上street后: rFixed, 倍数: +(rFixed / r).toFixed(2),
  }));
}
