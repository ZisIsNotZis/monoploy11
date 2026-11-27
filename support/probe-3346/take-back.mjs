// #3391c：直接回答「书屋能不能变成谁有钱谁拿走」。
//
// 前面 race-conditional.mjs 量到现状：对手先买到书屋的局，我只有 take 3.4% / cross 5.0%。
// 那么「允许收购书屋」能不能把这批局的胜率拉回来？这才是用户那句话的可操作含义：
// 不是「我也能买」（无主时本来就能买），而是**对手已经拿走的，我能花钱抢回来**。
//
// 口径（同一批 seed、同一批对手，只换两条规则）：
//   closed  现状：书屋不可收购
//   open    允许收购书屋（只翻 SLICE_MAP 单例的 big 字段，包住一局就恢复；
//           前置断言租金的 rentFor 不变，因为 rentFor 读的是 state.properties.big）
// 意图（0 号位）：
//   ai      照常打
//   claw    只要书屋在对手手里、我付得起 125%，就用收购卡抢
//
// 关键读数：**「对手先拿到书屋」这个子集里的胜率**。若 open+claw 能把它从 3% 抬到
// 两位数，书屋就真的流通了；若仍是 3%，那「允许收购」只是多一种花钱方式，
// 改变不了「先到先得」。
//
// 用法：node support/probe-3346/take-back.mjs [60]
import { SLICE_STYLES, createSliceConfig, SLICE_MAP } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { acquisitionPrice, buyPrice, rentFor } from '../../src/engine/economy.js';

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
const bookPlot = SLICE_MAP.plots.find(p => p.id === BOOK);
const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

// 前置断言：翻 map.big 不改租金
{
  const s = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: true }));
  s.properties[BOOK] = { ...s.properties[BOOK], ownerId: s.players[0].id };
  const before = rentFor(s, BOOK);
  bookPlot.big = false; const after = rentFor(s, BOOK); bookPlot.big = true;
  if (before !== after) throw new Error(`翻 map.big 改到了租金：${before} → ${after}`);
  console.log('前置断言：翻 map.big 后 rentFor(书屋) 不变 ✅');
}

async function play({ style, seed, order, open, intent }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0, banKey = null, claims = 0, clawed = 0;
  let bookOwnedByOpponentAtAnyPoint = false;
  const turnKey = () => `${state.day}:${state.turn}`;
  const owner = () => state.properties[BOOK]?.ownerId;

  const drive = () => runGame(state, {
    render() {}, async step() {
      if (owner() && owner() !== seat0.id) bookOwnedByOpponentAtAnyPoint = true;
    },
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === seat0.id;
      const pr = state.properties[BOOK];
      const enemyBook = pr?.ownerId && pr.ownerId !== seat0.id;
      if (enemyBook) bookOwnedByOpponentAtAnyPoint = true;

      if (intent === 'claw' && open && mine) {
        // 只做一件事：书屋在对手手里就抢回来。
        if (enemyBook && prompt.type === 'action' && (seat0.sliceCardsUsed ?? 0) < 2 && banKey !== turnKey()) {
          const idx = seat0.cards.indexOf('buyland');
          if (idx >= 0 && seat0.cash >= acquisitionPrice(state, BOOK)) { claims++; return { action: 'card', index: idx }; }
        }
        if (enemyBook && prompt.type === 'target' && prompt.cardId === 'buyland') {
          const ids = prompt.plotIds ?? [];
          if (ids.includes(BOOK) && seat0.cash >= acquisitionPrice(state, BOOK)) {
            const wasEnemy = state.properties[BOOK].ownerId !== seat0.id;
            clawed += wasEnemy ? 1 : 0;
            return BOOK;
          }
          banKey = turnKey();
          return aiAnswer(prompt, state);
        }
      }
      // 无主时照常打（AI 自己决定买不买）
      if (prompt.type === 'buy' && mine && prompt.plot && (prompt.plot.id ?? prompt.plot) === BOOK) {
        return aiAnswer(prompt, state);
      }
      return aiAnswer(prompt, state);
    },
  });

  // 必须翻**这一局自己**那份地图：createGame 用 structuredClone 复制了 baseMap
  // （game.js:29），所以改 SLICE_MAP 单例对这一局毫无影响 —— 我上一版就错在这里，
  // 所以才印出 0.00 次抢回。
  const localBook = state.map.plots.find(p => p.id === BOOK);
  localBook.big = !open;
  try { await drive(); } finally { localBook.big = true; }
  if (!state.over) throw new Error('Engine returned before game ended');
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    holdsBook: owner() === seat0.id,
    opponentHadBook: bookOwnedByOpponentAtAnyPoint,
    clawed, claims,
    rentEarned: seat0.sliceStats.rentEarned,
  };
}

console.log(`\n基线校验（n=${SEEDS * 2}/格，争街，现状）`);
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, open: false, intent: 'ai' }));
  const p = 100 * rows.filter(r => r.win).length / rows.length;
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
}

for (const open of [false, true]) {
  console.log(`\n===== ${open ? '允许收购书屋' : '现状（书屋不可收购）'} · 抢回意图 =====`);
  for (const style of STYLES) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
      rows.push(await play({ style, seed, order, open, intent: 'claw' }));
    const n = rows.length;
    const behind = rows.filter(r => r.opponentHadBook && !r.holdsBook);
    console.log(`  ${style.padEnd(6)} 全部 ${pct(rows.filter(r => r.win).length, n).padEnd(7)}`
      + ` 抢回成交 ${mean(rows, 'clawed').toFixed(2)} 次/局`
      + ` | 对手拿过书屋的局 n=${String(behind.length).padStart(3)} 胜 ${pct(behind.filter(r => r.win).length, behind.length)}`);
  }
}
