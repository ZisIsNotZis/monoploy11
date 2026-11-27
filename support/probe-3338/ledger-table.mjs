// #3338：街心书屋这一笔的「整局账」—— 两屏（买地屏、结算屏）都必须从这一份数里取。
//
// 上一版两屏各说一套：买地屏说「72 局里 56 局的整局租金还不够这一笔」（劝退），
// 结算屏说「下局去拿」。看起来矛盾，根因是口径不同：
//   · 买地屏把那 26,000 当**花掉的钱**，拿 RENT_POOL（全场租金池）去比；
//     可买地是资产换手：现金 → 同价的地，总资产一分不变（见下面 buyLedger）。
//   · 结算屏比的是「买了 vs 没买」的终局差（同 seed 配对 40 局 +19,805）。
// 一个问「这笔钱还能不能从租金里收回来」，一个问「这一步让终局更好还是更差」，
// 本身都不是错，但印成两句方向相反的话，玩家只会认为有一句在骗人。
//
// 所以这里量的是**同一局里可核的那几个数**，两屏共用：
//   买下时：总资产变多少（引擎 assetsOf 前后差）、买完剩多少现金、对手店里最贵的一次租
//   收盘时：这间书屋一共被踩到几次、其中对手踩了几次、真到账几笔、多少钱
//
// 口径与 RENT_POOL / LANDING_STATS 一致：grow/take/cross × seed 1–24 = 72 局，同一套 AI
// （人类座位也由 AI 出牌），三个起手都是真入口。表随 AI/棋盘/数值变化而失效，
// 由 test/market-ledger.test.js 守着（它逐值重算，不读这里的输出）。
//
// 复跑：node support/probe-3338/ledger-table.mjs 24
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 24);
const MARKET = 'market';
const PAID_ROW = /^(\S+) 实付租金 (\d+)（([^）]+)），(\S+) 收到 (\d+)/;

const rows = [];
for (const style of ['grow', 'take', 'cross']) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const state = startSession(createSliceConfig({ human: true, seed, style }));
    await runGame(state, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, state); } });
    const me = state.players.find(p => p.controller === 'human');
    const ownerId = state.properties[MARKET]?.ownerId ?? null;
    const owner = ownerId ? state.players.find(p => p.id === ownerId) : null;
    const name = state.map.plots.find(x => x.id === MARKET).name;

    // 「被踩到」= 有人停在书屋旁边（flow.js 的 landingPhase 每次都写这一行）。
    // 收租要 ownerId 且没停业，所以停业那几次照实计入「被踩到」、不计入「到账」。
    let stops = 0, stopsRival = 0, stopsMine = 0, closedStops = 0;
    let earnedRows = 0, earnedSum = 0, zeroRows = 0;
    for (const e of state.log ?? []) {
      const text = String(e.text);
      if (new RegExp(`停在 \\S+，旁边是 ${name}$`).test(text)) {
        stops += 1;
        if (ownerId && text.startsWith(`${owner.name} `)) stopsMine += 1;
        else stopsRival += 1;
      }
      if (/停业中，不计租/.test(text) && text.includes(name)) closedStops += 1;
      const m = PAID_ROW.exec(text);
      if (m && m[3] === name) {
        if (Number(m[5]) > 0) { earnedRows += 1; earnedSum += Number(m[5]); } else zeroRows += 1;
      }
    }
    rows.push({
      style, seed, owner: owner ? owner.name : null,
      ownerIsHuman: ownerId === me.id,
      level: state.properties[MARKET]?.level ?? 0,
      stops, stopsRival, stopsMine, closedStops, earnedRows, earnedSum, zeroRows,
      boughtDay: (state.log ?? []).find(e => /买下 街心书屋/.test(String(e.text)))?.day ?? null,
    });
  }
}

const byOwner = kind => rows.filter(r => kind === 'mine' ? r.ownerIsHuman
  : kind === 'rival' ? (r.owner && !r.ownerIsHuman) : !r.owner);
const hist = list => {
  const b = [0, 0, 0];
  for (const r of list) b[Math.min(2, r.stops)] += 1;
  return b;
};
const mean = (list, f) => list.length ? Math.round(list.reduce((a, r) => a + f(r), 0) / list.length) : null;

// 买下这一笔在引擎里到底动没动总资产：第 4 天、现金 44,000（真入口 grow/seed 1 的读数）。
const buyLedger = (() => {
  const state = startSession(createSliceConfig({ human: true, seed: 1, style: 'grow' }));
  const me = state.players.find(p => p.controller === 'human');
  state.day = 4; me.cash = 44_000;
  const plot = state.map.plots.find(x => x.big);
  const assets = assetsOf(state, me);
  const rivalRents = state.map.plots.filter(x => !x.big && state.properties[x.id]?.ownerId &&
    state.players.find(q => q.id === state.properties[x.id].ownerId)?.team !== me.team)
    .map(x => rentFor(state, x.id)).sort((a, b) => b - a);
  return { price: plot.price, assetsBeforeBuy: assets, cashBeforeBuy: me.cash,
    rivalRentEach: rivalRents[0] ?? 0, rivalRentAll: rivalRents };
})();

const out = {
  games: rows.length,
  seeds: `grow/take/cross × seed 1–${SEEDS}`,
  note: 'stops = 「旁边是 街心书屋」的落地行总数（含撞上停业）；earnedRows/earnedSum 只认实付行里收租方收到 >0 的。',
  ownership: { mine: byOwner('mine').length, rival: byOwner('rival').length, nobody: byOwner('nobody').length },
  whenMine: {
    games: byOwner('mine').length,
    stopsHistogram: hist(byOwner('mine')),
    rivalStopsHistogram: hist(byOwner('mine')),
    neverEarned: byOwner('mine').filter(r => r.earnedRows === 0).length,
    meanStops: mean(byOwner('mine'), r => r.stops),
    meanStopsRival: mean(byOwner('mine'), r => r.stopsRival),
    meanEarned: mean(byOwner('mine'), r => r.earnedSum),
    byLevel: Object.fromEntries([2, 3].map(lv => {
      const a = byOwner('mine').filter(r => r.level === lv);
      return [lv, { games: a.length, meanStopsRival: mean(a, r => r.stopsRival),
        meanEarned: mean(a, r => r.earnedSum), neverEarned: a.filter(r => r.earnedRows === 0).length }];
    })),
  },
  selfStopsWhenMine: {
    gamesWithSelfStop: byOwner('mine').filter(r => r.stopsMine > 0).length,
    totalSelfStops: byOwner('mine').reduce((a, r) => a + r.stopsMine, 0),
  },
  whenRival: {
    games: byOwner('rival').length,
    meanStops: mean(byOwner('rival'), r => r.stops),
    meanEarned: mean(byOwner('rival'), r => r.earnedSum),
    boughtDays: [...new Set(byOwner('rival').map(r => r.boughtDay).filter(Boolean))].sort((a, b) => a - b),
  },
  whenNobody: { games: byOwner('nobody').length },
  buyLedger,
  rows,
};
console.log(JSON.stringify(out, null, 1));
