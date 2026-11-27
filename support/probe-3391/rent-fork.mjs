// #3391h：要让「两种打法」成立，得先量出**在哪一点它们才等价**。
//
// 之前的结论是「押书屋严格更优」（plans-vs-control：三条起手 +10.0/+5.0/+4.2pp），
// 随机指派实验（randomize-book.mjs）另外证到：同样 26,000 财富，做成书屋比留成现金多 +28.3pp。
// 所以不是「文案没说清」，是**书屋的租金回报太高**。
//
// 为什么这次调**租金**而不是调**价格**：
//   slice 里 `assetsOf` 只按 `buyPrice` 记地产。改价格 ⇒ 直接改终局资产 ⇒ 改胜负判据本身。
//   我在 support/probe-3346/bookhouse-price.mjs 里踩过这个坑（连「什么都不买」那臂的胜率都跟着动，
//   因为对手仍在买它，对手的资产被凭空抬高）。那条读数作废，别引用。
//   租金不在记分公式里，所以调租金只动「持有它的收益」，不动记分口径 —— 干净。
//
// 唯一的大地块就是街心书屋，所以 `TUNING.bigRentMultiplier` 只作用于它（小店走另一条公式）。
// 每臂单独设一次，进程内逐臂切换，读数是同一批 seed。
//
// 两个臂是**策略**，不是规则：
//   skip  0 号位从不买书屋，其余照 AI（= 把钱留在现金/小店上）
//   buy   0 号位在第一次能付得起时买下（= 押注）
// 同一批 seed 下两臂的差，就是「这个押注在给定租金倍率下值多少」。
// 等价点（差值穿过 0）就是取舍出现的倍率。
//
// 用法：node support/probe-3391/rent-fork.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buyPrice, rentFor } from '../../src/engine/economy.js';
import { TUNING } from '../../src/data/tuning.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
  120: { grow: 49.2, take: 38.3, cross: 45.0 },
};
const BASELINE = BASELINES[SEEDS * 2];
if (!BASELINE) throw new Error(`没有 n=${SEEDS * 2} 的基线`);
const BOOK = 'market';
const DEFAULT_MULT = TUNING.bigRentMultiplier;

const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

async function play({ style, seed, order, mode }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  let decisions = 0, bought = false, buyDay = null, minCash = seat0.cash;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      minCash = Math.min(minCash, seat0.cash);
      const mine = prompt.player?.id === seat0.id;
      if (prompt.type === 'buy' && mine && mode === 'buy') {
        const id = prompt.plot?.id ?? prompt.plot;
        if (id === BOOK && !bought && seat0.cash >= buyPrice(state, BOOK)) {
          bought = true; buyDay = state.day;
          return true;
        }
        if (id === BOOK) return false;   // 「押注」臂只押这一块，其余照 AI
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    bought, buyDay, minCash,
    ownsBook: state.properties[BOOK].ownerId === seat0.id,
    rents: seat0.sliceStats.rentEarned,
    assets: assetsOf(state, seat0),
  };
}

async function arm(mode) {
  const rows = [];
  for (const style of STYLES) for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, mode }));
  return rows;
}

// 基线断言（默认倍率、skip 臂 = 什么都不额外做）
let saved = DEFAULT_MULT;
TUNING.bigRentMultiplier = saved;
const baseRows = await arm('skip');
{
  const perStyle = {};
  for (const style of STYLES) {
    const rs = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
      rs.push(await play({ style, seed, order, mode: 'skip' }));
    const p = 100 * rs.filter(r => r.win).length / rs.length;
    perStyle[style] = p;
    const ok = Math.abs(p - BASELINE[style]) < 0.05;
    console.log(`  基线 ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
    if (!ok) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }
  }
}

const MULTS = [1.6, 1.2, 0.9, 0.6, 0.35];
console.log(`\n每臂 n=${SEEDS * 6}（${SEEDS} seed × 3 起手 × 2 座位排列）`);
console.log('倍率  臂   胜率    破产   收租   最低现金  押注率  买下日');
const table = {};
for (const m of MULTS) {
  TUNING.bigRentMultiplier = m;
  table[m] = {};
  for (const mode of ['skip', 'buy']) {
    const rows = await arm(mode);
    const n = rows.length;
    const mean = k => Math.round(rows.reduce((a, r) => a + (r[k] ?? 0), 0) / n);
    const w = rows.filter(r => r.win).length / n;
    table[m][mode] = { w, n };
    console.log(`${m.toFixed(2)}  ${mode.padEnd(4)} ${pct(w * n, n).padEnd(7)} ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
      + ` ${String(mean('rents')).padStart(5)}  ${String(mean('minCash')).padStart(7)}`
      + `  ${pct(rows.filter(r => r.bought).length, n).padEnd(6)}`
      + ` ${rows.filter(r => r.buyDay).length ? (rows.filter(r => r.buyDay).reduce((a, r) => a + r.buyDay, 0) / rows.filter(r => r.buyDay).length).toFixed(1) : '—'}`);
  }
  const d = table[m].buy.w - table[m].skip.w;
  console.log(`      ⇒ 押注 − 不押 = ${(100 * d).toFixed(1)}pp`);
}

console.log('\n=== 取舍在哪一点出现（押注 − 不押 穿过 0）===');
let prev = null;
for (const m of MULTS) {
  const d = table[m].buy.w - table[m].skip.w;
  if (prev && prev.d > 0 && d <= 0) {
    const t = prev.m + (m - prev.m) * (prev.d / (prev.d - d));
    console.log(`  倍率 ≈ ${t.toFixed(2)}（现默认 ${DEFAULT_MULT}）时两种打法等价 ⇒ 这附近才是真取舍`);
  }
  prev = { m, d };
}
TUNING.bigRentMultiplier = saved;
