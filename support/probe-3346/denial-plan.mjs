// #3391：前两支证明了两件事，合起来指向第三条可能的第二条路线：
//   plans-vs-control.mjs：押书屋在三条起手上都严格更优；「补齐一条街」是更差的做法。
//   frontage-audit.mjs  ：书屋每局被踩 29.07 次，小店平均 4.26 次（6.8×）。
//     ⇒ 收入差不在乘数，在**落点次数**。所以「比谁收得多」这条路永远赢不了书屋。
//
// 但赢不一定要收得更多 —— 也可以**让别人收不到**。切片的「停业」卡正是干这个的：
//   close：一整条街停租 2 天（game.js 把计时器置 2，rentFor 见 closed>0 直接返回 0）。
// 而书屋恰恰是全场唯一一块「一个人踩着就付一次」的地 —— 封它 2 天的价值 = 它 2 天的租金。
//
// 这一支量第三种打算：
//   ai      照常打（对照）
//   deny    封书屋：只要对手持有书屋、且手里有停业卡，就对「书屋」这条街开停业；
//           自己也照常买地（不买书屋）。失败方式与押书屋不同：不靠自己的租金，
//           靠压低对手；没钱也能打，但抽不到停业卡时会空转。
//
// 若 deny 能接近或超过照常打，那么「两条路线」就是
//   「自己当房东（押书屋）」 vs 「让房东收不到租（封书屋）」—— 一个有所有权的代价，
//   一个没有所有权、只靠时机。那才是有取舍的一局。
//
// 用法：node support/probe-3346/denial-plan.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor } from '../../src/engine/economy.js';

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
const BOOK_STREET = '书屋';
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
  let decisions = 0, closes = 0, closeOffers = 0, bookDeniedDays = 0;

  const bookOwner = () => state.players.find(p => p.id === state.properties[BOOK]?.ownerId);

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === seat0.id;

      if (arm === 'deny' && prompt.type === 'action' && mine && (seat0.sliceCardsUsed ?? 0) < 2) {
        const idx = seat0.cards.indexOf('close');
        const owner = bookOwner();
        const enemyBook = owner && owner.team !== seat0.team;
        const alreadyClosed = (state.properties[BOOK]?.closed ?? 0) > 0;
        if (idx >= 0 && enemyBook) closeOffers++;
        if (idx >= 0 && enemyBook && !alreadyClosed) {
          return { action: 'card', index: idx };
        }
      }
      if (arm === 'deny' && prompt.type === 'target' && prompt.cardId === 'close' && mine) {
        // 停业的对象是「街」。书屋这条街就是我们要封的那条。
        const streets = prompt.plotIds ?? [];
        const bookPlot = streets.find(id => state.properties[id]?.street === BOOK_STREET)
          ?? streets.find(id => state.map.plots.find(p => p.id === id)?.street === BOOK_STREET);
        if (bookPlot) {
          closes++;
          bookDeniedDays += 2; // close 把计时器置 2 天（game.js）
          return state.map.plots.find(p => p.id === bookPlot)?.street ?? bookPlot;
        }
        return aiAnswer(prompt, state);
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const ranked = [...state.players].sort((a, b) => assetsOf(state, b) - assetsOf(state, a));
  const owner = bookOwner();
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    last: ranked[ranked.length - 1].id === seat0.id,
    assets: assetsOf(state, seat0), closes, closeOffers, bookDeniedDays,
    rentEarned: seat0.sliceStats.rentEarned,
    enemyHeldBook: !!owner && owner.team !== seat0.team,
    bookRentAtEnd: rentFor(state, BOOK),
  };
}

console.log(`基线校验（n=${SEEDS * 2}/格，争街）`);
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, arm: 'ai' }));
  const p = 100 * rows.filter(r => r.win).length / rows.length;
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
}

console.log('\n===== 封书屋（对手持有书屋时开停业；自己不买书屋）=====');
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, arm: 'deny' }));
  const n = rows.length;
  console.log(`  ${style.padEnd(6)} 胜 ${pct(rows.filter(r => r.win).length, n).padEnd(7)}`
    + ` 破产 ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
    + ` 垫底 ${pct(rows.filter(r => r.last).length, n).padEnd(6)}`
    + ` 封书屋 ${mean(rows, 'closes').toFixed(2)} 次/局`
    + `（有机会 ${mean(rows, 'closeOffers').toFixed(2)}）`
    + ` 收租 ${String(Math.round(mean(rows, 'rentEarned'))).padStart(5)}`
    + ` 对手持书屋 ${pct(rows.filter(r => r.enemyHeldBook).length, n)}`);
}
