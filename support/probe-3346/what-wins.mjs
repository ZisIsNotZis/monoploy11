// #3346：书屋为什么是唯一值得花钱的地方 —— 先把它赢在哪一格拆开。
//
// 已知（#3344，争街开局 60 seed/格，0 号位固定）：
//   grow  none 50.0%  big 80.0%   (+30)
//   take  none  6.7%  big 40.0%   (+33)
//   cross none 10.0%  big 45.0%   (+35)
// 同一批 arms 里「补齐自己那条街」只有 -3.3/-26.7/-26.7，开新街 0/-31.7/-25.0。
// 也就是说：这个切片里**唯一值得花的钱**是书屋。
//
// 但 +30pp 是什么带来的？书屋同时是三样东西：
//   ① 8 个相邻格的收租面（小店只有 1 个格）
//   ② 每次被踩额外送 1 张卡（flow.js:662，bigType==='bookstore'）
//   ③ 26,000 的一次性大额支出（现金压力 / 破产风险）
// 只用胜率分不开它们。所以这里不猜，读**引擎自己写的行**：
//   「实付租金 N（街心书屋）」→ 书屋实际收了多少租（按付款方拆）
//   「X 的书店卖出 1 本书，获得 1 张卡」→ 书屋实际送出多少张卡
//   「选择「X」：…」→ 每人拿到多少张补给
// 三者都来自 slice.history，不是我另算一遍的。
//
// 第一版这里犯过一个错，记下来：`实付租金 N（街心书屋）` **不写谁付的**，而 history
// 混着三个人的回合；把这一句全加起来得到的是「全场在书屋流动的钱」，于是「不花钱」
// 那一臂也印出 书屋租 3,483 —— 那是对手从 seat0 身上收走的钱，是支出不是收入。
// 现在付款方取 history[].playerId（引擎写的），收款方按「谁买下书屋」那一行跟踪。
//
// 口径与 openings.mjs 相同：争街开局、0 号位固定、两种对手座位排列、现金与座位断言。
// 用法：node support/probe-3346/what-wins.mjs 60
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const STYLES = ['grow', 'take', 'cross'];
const ARMS = ['any', 'none', 'fill', 'big'];
const DECISION_LIMIT = 5000;

const wilson = (wins, n) => {
  const z = 1.96, p = wins / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length;
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

function readLogs(state, seat0) {
  const entries = state.slice?.history ?? [];
  let marketOwnerName = null;
  let received = 0, paid = 0, receivedEvents = 0, paidEvents = 0;
  let marketCards = 0, opponentMarketCards = 0, supplyPacks = 0;
  for (const entry of entries) {
    for (const text of entry.lines ?? []) {
      const buy = /^(.+?) 买下 街心书屋/.exec(text);
      if (buy) marketOwnerName = buy[1];
      const m = /实付租金 (\d+)（(.+?)）/.exec(text);
      if (m && m[2] === '街心书屋') {
        if (entry.playerId === seat0.id) { paid += Number(m[1]); paidEvents++; }
        else if (marketOwnerName === seat0.name) { received += Number(m[1]); receivedEvents++; }
      }
      const card = /^(.+?) 的书店卖出 1 本书/.exec(text);
      if (card) { if (card[1] === seat0.name) marketCards++; else opponentMarketCards++; }
      if (/选择「/.test(text)) supplyPacks++;
    }
  }
  return { received, paid, receivedEvents, paidEvents, marketCards, opponentMarketCards, supplyPacks };
}

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
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0;
  await runGame(state, {
    render() {},
    async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      if (prompt.type === 'buy' && prompt.player?.id === seat0.id && prompt.plot) {
        if (spend === 'none') return false;
        if (spend === 'fill') {
          // 只买「我已经有店的那条街」上的空地 —— 与 openings.mjs 同名同义。
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
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    rentEarned: seat0.sliceStats.rentEarned,
    ...readLogs(state, seat0),
    ownsMarket: seat0.properties.includes('market'),
    assets: assetsOf(state, seat0),
    cash: seat0.cash,
    cardsHeld: seat0.cards.length,
  };
}

for (const style of STYLES) {
  console.log(`\n=== 起手 ${style} · 争街开局 · 每格 ${SEEDS * 2} 局 ===`);
  for (const arm of ARMS) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) {
      rows.push(await play({ style, seed, order, spend: arm }));
    }
    const wins = rows.filter(r => r.win).length;
    const [lo, hi] = wilson(wins, rows.length);
    console.log(`  ${arm.padEnd(5)} 胜率 ${pct(wins / rows.length)} [${pct(lo)}, ${pct(hi)}]`
      + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length)}`
      + ` 书屋到手 ${pct(rows.filter(r => r.ownsMarket).length / rows.length)}`
      + ` 收书屋租 ${Math.round(mean(rows, 'received'))}(${mean(rows, 'receivedEvents').toFixed(2)}次)`
      + ` 付书屋租 ${Math.round(mean(rows, 'paid'))}`
      + ` 书屋送卡 ${mean(rows, 'marketCards').toFixed(2)}`
      + ` 对手书屋送卡 ${mean(rows, 'opponentMarketCards').toFixed(2)}`
      + ` 全租 ${Math.round(mean(rows, 'rentEarned'))}`);
  }
}
