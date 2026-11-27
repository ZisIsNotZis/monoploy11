// #3342：加盖现在还亏吗？
//
// #3340 量过：花 10,000 加盖，标价只 +4,000 ⇒ 记分上净亏，配对臂读 −505 ~ −3,155。
// 加巡视规则后，加盖的回报不再只走「标价」，而是直接抬高每次巡视到的金额。
// 所以要看的是**终局资产**，不是标价：现金也是资产。
//
// 做法：同一批种子、同一套 AI，只换一条策略 —— 「见加盖就加」vs「只按默认」。
// 两臂的规则完全相同（都开巡视），差别只在人类/AI 的 build 回答。
//
// 只跑 0 号位做人类座位没有意义（三家都吃规则），所以两臂都让三家跑同一套 AI，
// 唯一变量是 `build` 的答案。这是配对臂：同 seed 同开局。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 40);
const LEVELS = (process.argv[3] ?? '1000').split(',').map(Number);
const STYLES = ['grow', 'take', 'cross'];

function play({ seed, style, alwaysBuild, patrol, perLevel }) {
  const config = createSliceConfig({ human: false, seed, style });
  if (patrol) { config.slicePatrol = true; config.slicePatrolPerLevel = perLevel; }
  const state = startSession(config);
  let builds = 0, buildSpend = 0;
  return runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (prompt.type === 'build' && alwaysBuild) {
        if (prompt.player.cash >= prompt.cost) { builds++; buildSpend += prompt.cost; return true; }
        return false;
      }
      return aiAnswer(prompt, state);
    },
  }).then(() => ({ state, builds, buildSpend }));
}

for (const level of LEVELS) for (const patrol of [false, true]) {
  const out = { patrol, perLevel: patrol ? level : 0, arms: {} };
  for (const alwaysBuild of [false, true]) {
    const key = alwaysBuild ? '见加盖就加' : '默认';
    const agg = { games: 0, assets: 0, builds: 0, spend: 0, trade: 0, rent: 0 };
    const byStyle = Object.fromEntries(STYLES.map(s => [s, { games: 0, wins: 0 }]));
    for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
      const { state, builds, buildSpend } = await play({ seed, style, alwaysBuild, patrol, perLevel: level });
      agg.games++; agg.builds += builds; agg.spend += buildSpend;
      const winner = state.players.find(p => p.team === state.winnerTeam);
      byStyle[style].games++;
      if (winner?.style === style) byStyle[style].wins++;
      for (const p of state.players) {
        agg.assets += assetsOf(state, p);
        agg.trade += p.sliceStats.tradeEarned ?? 0;
        agg.rent += p.sliceStats.rentEarned;
      }
    }
    const per = (v, n) => Math.round(v / Math.max(1, n));
    out.arms[key] = {
      每家终局资产: per(agg.assets, agg.games * 3),
      每家营业: per(agg.trade, agg.games * 3),
      每家收租: per(agg.rent, agg.games * 3),
      加盖次数: per(agg.builds, agg.games),
      加盖花费: per(agg.spend, agg.games),
      起手胜率: Object.fromEntries(STYLES.map(s => [s, +((100 * byStyle[s].wins) / byStyle[s].games).toFixed(1)])),
    };
  }
  const d = out.arms['见加盖就加']['每家终局资产'] - out.arms['默认']['每家终局资产'];
  out['加盖净收益_每家'] = d;
  console.log(JSON.stringify(out));
}
