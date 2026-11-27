// #3391：书屋只有一块 —— 三个人里最多一个人拿到。所以真正存在的决策不是
// 「押不押书屋」（押是严格更优），而是**「出多少现金去抢它，抢不到怎么办」**。
//
// 这一支把「押书屋」拆成条件结果：
//   抢到（终局书屋是我的）   胜率多少、终局资产多少
//   没抢到（钱花了但地不是我的）胜率多少 —— 这才是「会放弃什么」
// 并对照照常打里「别人拿了书屋」的局面，看差距是不是就是书屋本身。
//
// 若「没抢到」明显差于「照常打」，那这一局确实有代价、有风险，值得做成第一屏的一对照；
// 若「没抢到」和「照常打」一样，那抢书屋几乎没有下行风险 —— 它仍是单点最优，不是取舍。
//
// 用法：node support/probe-3346/race-conditional.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, buyPrice } from '../../src/engine/economy.js';

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
const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

async function play({ style, seed, order, arm }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0, attempts = 0, minCash = seat0.cash, cashAtDay4 = null;

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === seat0.id;
      minCash = Math.min(minCash, seat0.cash);
      if (state.day >= 4 && cashAtDay4 === null) cashAtDay4 = seat0.cash;

      if (arm === 'race' && prompt.type === 'buy' && mine && prompt.plot) {
        const id = prompt.plot.id ?? prompt.plot;
        if (id === BOOK) {
          attempts++;
          return seat0.cash >= buyPrice(state, id); // 抢：付得起就买
        }
        return aiAnswer(prompt, state);
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const ranked = [...state.players].sort((a, b) => assetsOf(state, b) - assetsOf(state, a));
  const owner = state.players.find(p => p.id === state.properties[BOOK]?.ownerId);
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    last: ranked[ranked.length - 1].id === seat0.id,
    gotBook: owner?.id === seat0.id,
    bookOwnerMe: owner?.team === seat0.team,
    bookUnbought: !owner,
    assets: assetsOf(state, seat0), minCash, cashAtDay4,
    rentEarned: seat0.sliceStats.rentEarned,
  };
}

const group = (rows, pred) => rows.filter(pred);
const line = (label, rows) => {
  const n = rows.length;
  if (!n) return `  ${label.padEnd(18)} —`;
  return `  ${label.padEnd(18)} n=${String(n).padStart(3)}  胜 ${pct(rows.filter(r => r.win).length, n).padEnd(7)}`
    + ` 破产 ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` 垫底 ${pct(rows.filter(r => r.last).length, n).padEnd(6)}`
    + ` 终局资产 ${String(Math.round(mean(rows, 'assets'))).padStart(6)}`
    + ` 最低现金 ${String(Math.round(mean(rows, 'minCash'))).padStart(6)}`;
};

console.log(`基线校验（n=${SEEDS * 2}/格，争街）`);
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, arm: 'ai' }));
  const p = 100 * rows.filter(r => r.win).length / rows.length;
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
}

for (const arm of ['ai', 'race']) {
  console.log(`\n===== ${arm === 'ai' ? '照常打（对照）' : '抢书屋（付得起就买）'} =====`);
  for (const style of STYLES) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, arm }));
    console.log(` ${style}  （共 ${rows.length} 局）`);
    console.log(line('全部', rows));
    if (arm === 'race') {
      console.log(line('抢到了', group(rows, r => r.gotBook)));
      console.log(line('没抢到（别人拿走）', group(rows, r => !r.gotBook && !r.bookUnbought)));
      console.log(line('没人买走', group(rows, r => r.bookUnbought)));
    } else {
      console.log(line('书屋在我手里', group(rows, r => r.bookOwnerMe)));
      console.log(line('书屋在别人手里', group(rows, r => !r.bookOwnerMe && !r.bookUnbought)));
      console.log(line('没人买走', group(rows, r => r.bookUnbought)));
    }
  }
}
