// #3344：把「两条开局路线」从可选实验变成可玩对照 —— 先量两个数。
//
// 要回答的事只有两件，其余都不该在这一支里出现：
//   ① 争街开局（每条街 1 对 1）能不能当默认？判据是**三条起手的差距**，
//      不是它好不好玩（那要人类）。
//   ② 在那个开局里，「补齐自己那条街」和「押书屋」是不是两条都值得试、且失败方式不同？
//      判据：两条路线各自相对「不花钱」的差，以及**破产率**。
//
// 为什么这两件事必须一起量：#3342 把争街留在 ?cross=1 之后没再量过起手差距；
// 而 support/probe-3343/two-plans.mjs 已经量出「争街下只买小店」从默认开局的
// −7.5/−27.5/−30pp 变成 +10/持平/持平。也就是说争街确实把「补齐」还回来了，
// 但把平衡交回去的代价还没量。
//
// 口径：与 tools/balance-slice.mjs 完全相同 —— 被量的起手固定在 0 号位、
// 两种对手顺序、座位与现金都断言、每局决定数上限。不在这里发明第二种跑法。
//
// 用法：
//   node support/probe-3344/openings.mjs 60            # 每格 60 seed（×2 座位排列）
//   node support/probe-3344/openings.mjs 60 arms       # 另外量四种花钱档
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const WITH_ARMS = process.argv.includes('arms');
const STYLES = ['grow', 'take', 'cross'];
const OPENINGS = [
  { key: 'whole', label: '默认（每人整条街）', contested: false },
  { key: 'contested', label: '争街（每条街 1 对 1）', contested: true },
];
const DECISION_LIMIT = 5000;

function wilson(wins, n) {
  if (!n) return null;
  const z = 1.96, p = wins / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}
const pct = x => `${(100 * x).toFixed(1)}%`;
const pp = x => `${(100 * x).toFixed(1)}pp`;

const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

// 一局。`spend` 决定 0 号位对 buy 提议怎么答；null = 引擎原样（照 AI）。
async function play({ style, seed, order, contested, spend }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: contested });
  const wanted = [style, ...order];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (state.players.map(p => p.style).join(',') !== wanted.join(',')) {
    throw new Error(`SEATING MISMATCH 想要 ${wanted.join(',')} 实得 ${state.players.map(p => p.style).join(',')}`);
  }
  const seat0 = state.players[0];
  if (style && SLICE_STYLES.find(s => s.id === style)?.cash != null
      && seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) {
    throw new Error(`CASH MISMATCH ${style}`);
  }
  const startPlots = new Set(seat0.properties);
  let decisions = 0, minCash = seat0.cash, buys = 0, smallBuys = 0, bigBuys = 0;
  await runGame(state, {
    render() { minCash = Math.min(minCash, seat0.cash); },
    async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      minCash = Math.min(minCash, seat0.cash);
      if (prompt.type === 'buy' && prompt.player?.id === seat0.id && prompt.plot) {
        // 购买计数必须在**两支都数**。第一版只在 spend 分支里数，于是「照 AI」那一臂
        // 一律印出买地 0.00 —— 那不是「没买」，是没在数（#3343 同款错误：量具沉默当成读数）。
        if (spend === 'none') return false;
        if (spend === 'small' && prompt.plot.big) return false;
        if (spend === 'big' && !prompt.plot.big) return false;
        // #3344 关键区分：「买小店」不是一个计划，「补齐我这条街」才是。
        // #3343 的 small 臂把两者混在一起 —— 它会买下任何一块空着的小店，
        // 包括一条我完全没有店的街上的。于是「小店弱」这个读数没法用来判断
        // 「补齐一条街值不值得」，判据要按**同街已有一间**分开。
        if (spend === 'fill' || spend === 'new') {
          if (prompt.plot.big) return false;
          const street = prompt.plot.street;
          const mineOnStreet = state.map.plots.some(x => x.id !== prompt.plot.id && !x.big
            && x.street === street && state.properties[x.id]?.ownerId === seat0.id);
          if (spend === 'fill' && !mineOnStreet) return false;
          if (spend === 'new' && mineOnStreet) return false;
        }
        const ok = aiAnswer(prompt, state);
        if (ok) { buys++; if (prompt.plot.big) bigBuys++; else smallBuys++; }
        return ok;
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const winner = state.players.find(p => p.team === state.winnerTeam);
  let paidEvents = 0;
  for (const line of state.log) if (/实付租金 [1-9]/.test(line.text)) paidEvents++;
  return {
    win: winner === seat0, bankrupt: !seat0.alive, rentEarned: seat0.sliceStats.rentEarned,
    assets: assetsOf(state, seat0),
    buys, smallBuys, bigBuys, minCash, paidEvents,
    netPlots: seat0.properties.length - startPlots.length,
  };
}

const mean = (xs, k) => xs.length ? Math.round(xs.reduce((a, r) => a + r[k], 0) / xs.length) : 0;
const rate = (xs, k) => xs.length ? xs.filter(r => r[k]).length / xs.length : 0;

if (!WITH_ARMS) {
  // ① 两种开局的起手差距。每格 = SEEDS × 2 种对手顺序。
  for (const opening of OPENINGS) {
    const rows = {};
    for (const style of STYLES) rows[style] = [];
    for (const style of STYLES) for (const order of opponentOrders(style)) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        rows[style].push(await play({ style, seed, order, contested: opening.contested, spend: null }));
      }
    }
    const rates = STYLES.map(s => rate(rows[s], 'win'));
    const spread = Math.max(...rates) - Math.min(...rates);
    console.log(`\n=== ${opening.label} · 每格 ${SEEDS * 2} 局 ===`);
    for (const [i, style] of STYLES.entries()) {
      const r = rows[style], ci = wilson(Math.round(rates[i] * r.length), r.length);
      console.log(`  ${style.padEnd(6)} 胜率 ${pct(rates[i]).padEnd(7)} 95% [${pct(ci.lo)}, ${pct(ci.hi)}]`
        + `  破产 ${pct(rate(r, 'bankrupt')).padEnd(6)} 收租 ${mean(r, 'rentEarned')}`
        + `  付租次数 ${(r.reduce((a, x) => a + x.paidEvents, 0) / r.length).toFixed(2)}`
        + `  买地 ${(r.reduce((a, x) => a + x.buys, 0) / r.length).toFixed(2)}`);
    }
    console.log(`  最大差距 ${pp(spread)}`);
    // 逐对说，不概括成一句（#3331 的教训：窄重叠被一句「都分得开」抹掉过）。
    for (let i = 0; i < STYLES.length; i++) for (let j = i + 1; j < STYLES.length; j++) {
      const n1 = rows[STYLES[i]].length, n2 = rows[STYLES[j]].length;
      const a = wilson(Math.round(rates[i] * n1), n1), b = wilson(Math.round(rates[j] * n2), n2);
      const disjoint = Math.max(a.lo, b.lo) > Math.min(a.hi, b.hi);
      console.log(`  ${STYLES[i]}↔${STYLES[j]} ${disjoint ? '分得开' : '区间重叠'}`);
    }
  }
} else {
  // ② 争街开局下，钱花在哪。arms 与 support/probe-3343/two-plans.mjs 同名同义。
  // fill = 只买**我已经有店的那条街**上的空地（补齐）；new = 只买异街空地（开新的）。
  const ARMS = ['any', 'none', 'fill', 'new', 'big'];
  for (const opening of OPENINGS) {
    console.log(`\n=== 花钱档 · ${opening.label} · 每格 ${SEEDS} 局（seed 1–${SEEDS}，0 号位固定）===`);
    for (const style of STYLES) {
      const base = {};
      for (const arm of ARMS) {
        const rows = [];
        for (let seed = 1; seed <= SEEDS; seed++) {
          rows.push(await play({ style, seed, order: opponentOrders(style)[0], contested: opening.contested,
            spend: arm === 'any' ? null : arm }));
        }
        base[arm] = rows;
        console.log(`  ${style.padEnd(6)} ${arm.padEnd(5)} 胜率 ${pct(rate(rows, 'win')).padEnd(7)}`
          + ` 破产 ${pct(rate(rows, 'bankrupt')).padEnd(6)} 小店 ${(rows.reduce((a, r) => a + r.smallBuys, 0) / rows.length).toFixed(2)}`
          + ` 书屋 ${(rows.reduce((a, r) => a + r.bigBuys, 0) / rows.length).toFixed(2)}`
          + ` 收租 ${mean(rows, 'rentEarned')} 最低现金 ${mean(rows, 'minCash')}`);
      }
      for (const arm of ['none', 'fill', 'new', 'big']) {
        const d = rate(base[arm], 'win') - rate(base.any, 'win');
        console.log(`         ${arm} − any = ${d >= 0 ? '+' : ''}${pp(d)}`);
      }
    }
  }
}
