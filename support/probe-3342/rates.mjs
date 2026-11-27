// #3342：营业比例的**真局**读数。不是 counterfactual —— 引擎真的按 config.sliceTradeRate 付钱，
// 所以这里读到的现金、资产、胜率都是结算后的结果。
//
// 为什么不用「假如结算」那种量法：我第一版就是这么做的，并且只把营业收入加给人类座位，
// 于是「胜率」凭空翻了倍（grow 33.3%→66.7%）。三家都吃同一条规则，必须三家都真的结算。
//
// 每个比例扫同一批种子与座位排列，输出：
//   ① 每家每局实际收到的营业 ② 收入结构（工资/营业/收租/付租）③ 三个起手的胜率
//   ④ 加盖的净收益（花 10,000、标价 +4,000）在营业规则下是否还亏
//   ⑤ 「营业冠军 ≠ 收租冠军」的局数 —— 两条路是不是真的分开
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buildCost, buyPrice } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 40);
// 每个臂写成 `<模式>:<数值>`，模式是 trade / tradeup / patrol。
// 上一版用 "0.5+up" 这类后缀：既出过 `Number('0.5up')` = NaN 的静默失效，
// 又在加巡视时把 'up' 里的 p 当成巡视标记。分开写，解析只有一条规则。
const ARMS = (process.argv[3] ?? 'trade:0,trade:0.5').split(',').map(s => {
  const [mode, value] = s.split(':');
  const needsUpgrade = mode === 'tradeup';
  const daily = false;
  const patrol = mode === 'patrol' || mode === 'patrolflat';
  const flat = mode === 'patrolflat';
  const rate = Number(value);
  // 我上一版写成 `Number(s.replace('+',''))`，"0.5+up" → "0.5up" → NaN，
  // 而 NaN 比例让 tradeIncome 返回 NaN，`trade > 0` 恒假 ⇒ 那三个臂**静默变成 rate 0**，
  // 却照样打印出跟 0 一模一样的读数。量具读不出「我没生效」是最坏的一种静默。
  if (!Number.isFinite(rate)) throw new Error(`arm ${s}: rate 不是有限数（解析成了 ${rate}）`);
  return { rate, needsUpgrade, daily, patrol, flat, label: `${mode}:${rate}` };
});
const STYLES = ['grow', 'take', 'cross'];
const ORDERS = id => {
  const others = STYLES.filter(s => s !== id);
  return [[others[0], others[1]], [others[1], others[0]]];
};
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

for (const arm of ARMS) {
  const { rate, needsUpgrade, daily, patrol, flat, label } = arm;
  const cells = Object.fromEntries(STYLES.map(s => [s, {
    games: 0, wins: 0, trade: 0, rentEarned: 0, rentPaid: 0, endAssets: 0, bankrupt: 0,
  }]));
  const totals = { trade: 0, rentEarned: 0, rentPaid: 0, salary: 0, money: 0, games: 0, buildSpend: 0, buildValue: 0 };
  let splitGames = 0, splitSeen = 0;

  for (const style of STYLES) for (const order of ORDERS(style)) for (let seed = 1; seed <= SEEDS; seed++) {
    const wanted = [style, ...order];
    const config = createSliceConfig({ human: false, seed, style });
    // 量具的第五个坑（写在这里，因为它差点以「巡视让资产到千万」交付）：
    // 巡视臂把 `rate` 同时写进了 `sliceTradeRate`，而书屋那一支用的是
    // `rentFor × sliceTradeRate` ⇒ 500 × 4,000 = 每回合两百万。
    // 读数看着像「巡视让经济爆炸」，其实是我把两个不同量纲的数接在了一起。
    // 巡视只写 slicePatrolPerLevel；比例只写 sliceTradeRate。
    config.sliceTrade = mode;
    if (!patrol) config.sliceTradeRate = rate;
    config.sliceTradeNeedsUpgrade = needsUpgrade;
    config.sliceTradeDaily = daily;
    if (patrol) config.slicePatrolPerLevel = rate;
    if (flat) config.slicePatrolFlat = true;
    if (mode === 'trade') config.sliceTrade = 'shop';
    config.participants = wanted.map((sid, i) => ({ ...config.participants.find(p => p.style === sid), team: `t${i + 1}`, controller: 'ai' }));
    const state = startSession(config);
    if (state.players.map(p => p.style).join(',') !== wanted.join(',')) throw new Error('seating mismatch');

    // 加盖的净收益：记下每次真加盖花了多少、此后这间店的标价涨了多少。
    const before = [];
    await runGame(state, {
      render() {}, async step() {},
      async ask(prompt) {
        if (prompt.type === 'build' && prompt.player) {
          const pr = state.properties[prompt.plot.id];
          before.push({ id: prompt.plot.id, cost: prompt.cost, price: buyPrice(state, prompt.plot.id), level: pr?.level });
        }
        return aiAnswer(prompt, state);
      },
    });
    for (const rec of before) {
      // 只有真的按下去才算 —— 比较等级是不是涨了。
      if ((state.properties[rec.id]?.level ?? 0) > rec.level) {
        totals.buildSpend += rec.cost;
        totals.buildValue += buyPrice(state, rec.id) - rec.price;
      }
    }

    totals.games++;
    for (const line of state.log) {
      const s = /经过起点 \+(\d+)/.exec(line.text); if (s) totals.salary += +s[1];
      const k = /在零工获得 (\d+)/.exec(line.text); if (k) totals.money += +k[1];
    }
    const winner = state.players.find(p => p.team === state.winnerTeam);
    const byTrade = [...state.players].sort((a, b) => (b.sliceStats.tradeEarned ?? 0) - (a.sliceStats.tradeEarned ?? 0))[0];
    const byRent = [...state.players].sort((a, b) => b.sliceStats.rentEarned - a.sliceStats.rentEarned)[0];
    splitSeen++; if (byTrade !== byRent) splitGames++;

    for (const p of state.players) {
      const c = cells[p.style];
      c.games++; c.wins += p === winner ? 1 : 0;
      c.trade += p.sliceStats.tradeEarned ?? 0;
      c.rentEarned += p.sliceStats.rentEarned; c.rentPaid += p.sliceStats.rentPaid;
      c.endAssets += assetsOf(state, p);
      c.bankrupt += p.alive ? 0 : 1;
      totals.trade += p.sliceStats.tradeEarned ?? 0;
      totals.rentEarned += p.sliceStats.rentEarned; totals.rentPaid += p.sliceStats.rentPaid;
    }
  }

  const per = (v, n) => Math.round(v / Math.max(1, n));
  console.log(JSON.stringify({
    arm: label,
    rate,
    每格局数: SEEDS * 2,
    起手胜率: Object.fromEntries(STYLES.map(s => [s, pct(cells[s].wins, cells[s].games)])),
    终局资产_每家: Object.fromEntries(STYLES.map(s => [s, per(cells[s].endAssets, cells[s].games)])),
    破产率: Object.fromEntries(STYLES.map(s => [s, pct(cells[s].bankrupt, cells[s].games)])),
    每家每局: {
      营业: per(totals.trade, totals.games * 3),
      收租: per(totals.rentEarned, totals.games * 3),
      付租: per(totals.rentPaid, totals.games * 3),
      工资: per(totals.salary, totals.games * 3),
      零工: per(totals.money, totals.games * 3),
    },
    加盖: {
      次数: totals.buildSpend ? undefined : 0,
      花费合计: totals.buildSpend,
      标价合计涨: totals.buildValue,
      净额: totals.buildValue - totals.buildSpend,
    },
    两条路分开: `${pct(splitGames, splitSeen)}%`,
  }));
}
