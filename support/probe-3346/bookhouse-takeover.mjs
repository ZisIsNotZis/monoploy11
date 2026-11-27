// #3391：首屏对「机会买家」写「看准别人养好的店，带着现金入场」（src/data/slice.js），
// 而引擎里 takeoverEligible 明确把大建筑排除（economy.js:88 `if (plot.big) return false`）。
// 也就是说：**这句话今天在规则上不成立** —— 你永远不能收购书屋，只能自己到场买。
//
// race-conditional.mjs 已经量到：整局胜负由「第 4 天谁拿到书屋」决定（持有者胜率 80–100%、
// 破产 0%；没拿到的 take 3.4% / cross 5.0%）。在这种结构下，唯一有意义的「第二种打算」
// 不是「买别的」，而是**「等他买，我再从他手里买走」**。
// 所以这一支 A/B 只改一个开关（不改价目、不改乘数、不改发牌）：
//   closed  现状：书屋不可收购
//   open    允许收购书屋：合法目标包含大建筑；价格 = buyPrice × 125%（走同一个 acquisitionPrice）
//
// 两臂各跑两个意图：
//   ai    照常打（看现状下「等」能不能发生）
//   grab  有钱就买书屋（不管谁持有：无主就买，对手持有就收购）
//
// 判据：若 open+grab 能让「没先买到的人」也赢（即 take/cross 不再因没抢到就 3–5%），
// 且不破坏「持有者优势」，那它就把一次掷硬币变成了**先后手**，这就是用户要的两种打算。
//
// 用法：node support/probe-3346/bookhouse-takeover.mjs [60]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, acquisitionPrice, buyPrice, rentFor, takeoverEligible } from '../../src/engine/economy.js';
import { sliceTargetIds } from '../../src/engine/insight.js';

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

// ── 机制开关：只改 SLICE_MAP 单例上的 `big` 字段，改完立刻恢复 ─────────────
// 为什么这样模拟：引擎有**两处**按 plot.big 拒绝收购（economy.js takeoverEligible、
// game.js buyland 分支），而租金判定读的是 state.properties[key].big（rentFor），
// 不是 map.plot.big。所以只翻 map 上这一个字段，就能打开收购而不动租金。
// 这不是产品改动：探针结束时恢复原值，并对 rentFor 不变下断言。
// ⚠ #3391 修正：不能翻 SLICE_MAP 单例 —— createGame 用 structuredClone 复制了 baseMap
// （game.js:29），所以改单例对这一局毫无影响。我第一版就是这么写的，于是印出了
// 「开放收购 · 照样打」与现状**逐位相同**，还把它当成了结论。现在翻本局的地图。
function withBookAcquirable(state, fn) {
  const plot = state.map.plots.find(p => p.id === BOOK);
  const before = plot.big;
  plot.big = false;
  try { return fn(); } finally { plot.big = before; }
}
const pct = (x, n) => `${(100 * (n ? x / n : 0)).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / (xs.length || 1);
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

// 先把「翻 map.big 不会改变租金」这件事钉住，再开始量。
function assertRentUnaffected() {
  const state = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: true }));
  state.properties[BOOK] = { ...state.properties[BOOK], ownerId: state.players[0].id };
  const before = rentFor(state, BOOK);
  const after = withBookAcquirable(state, () => rentFor(state, BOOK));
  if (before !== after) throw new Error(`翻 map.big 改到了租金：${before} → ${after}`);
  // 还要钉住「翻的确实是这一局那份地图」：否则上面那句断言在错对象上照样会绿。
  const local = state.map.plots.find(p => p.id === BOOK);
  withBookAcquirable(state, () => { if (local.big !== false) throw new Error('翻的不是本局地图'); });
  if (local.big !== true) throw new Error('恢复本局地图的 big 字段失败');
}

async function play({ style, seed, order, allowBookTakeover, intent }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = [style, ...order].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  if (seat0.cash !== SLICE_STYLES.find(s => s.id === style).cash) throw new Error(`CASH MISMATCH ${style}`);
  let decisions = 0, bookDeals = 0, banKey = null;
  const turnKey = () => `${state.day}:${state.turn}`;
  const bookOwner = () => state.players.find(p => p.id === state.properties[BOOK]?.ownerId);

  const drive = () => runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === seat0.id;
      const pr = state.properties[BOOK];
      const bookIsEnemy = pr?.ownerId && pr.ownerId !== seat0.id;
      const bookIsFree = !pr?.ownerId;
      const bookBuy = buyPrice(state, BOOK);
      const bookTake = acquisitionPrice(state, BOOK);

      // ── grab 意图 ────────────────────────────────────────────────
      if (intent === 'grab' && mine) {
        // 1) 无主：走过去按标价买
        if (prompt.type === 'buy' && prompt.plot) {
          const id = prompt.plot.id ?? prompt.plot;
          if (id === BOOK && bookIsFree) { bookDeals++; return seat0.cash >= bookBuy; }
          return aiAnswer(prompt, state);
        }
        // 2) 对手持有：用收购卡抢（只有 allowBookTakeover 时才可能成功）
        if (allowBookTakeover && bookIsEnemy && prompt.type === 'action'
            && (seat0.sliceCardsUsed ?? 0) < 2 && banKey !== turnKey()) {
          const idx = seat0.cards.indexOf('buyland');
          if (idx >= 0 && seat0.cash >= bookTake) {
            // 合法与否以引擎为准：这里只发起，结算交给 game.js
            return { action: 'card', index: idx };
          }
        }
        if (allowBookTakeover && bookIsEnemy && prompt.type === 'target' && prompt.cardId === 'buyland') {
          const ids = prompt.plotIds ?? [];
          if (ids.includes(BOOK) && seat0.cash >= bookTake) { bookDeals++; return BOOK; }
          banKey = turnKey();
          return aiAnswer(prompt, state);
        }
      }

      return aiAnswer(prompt, state);
    },
  });
  // 开关只包住这一局：结束后 map.big 恢复，下一局看到的是产品原样。
  await (allowBookTakeover ? withBookAcquirable(state, drive) : drive());
  if (!state.over) throw new Error('Engine returned before game ended');
  const ranked = [...state.players].sort((a, b) => assetsOf(state, b) - assetsOf(state, a));
  const owner = bookOwner();
  return {
    win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive,
    last: ranked[ranked.length - 1].id === seat0.id,
    gotBook: owner?.id === seat0.id,
    bookDeals, assets: assetsOf(state, seat0),
    rentEarned: seat0.sliceStats.rentEarned,
  };
}

assertRentUnaffected();
console.log('前置断言：翻 map.big 后 rentFor(书屋) 不变 ✅');

// 基线：现状（不允许收购书屋）+ 照常打，必须先复现
console.log(`基线校验（n=${SEEDS * 2}/格，争街，现状）`);
for (const style of STYLES) {
  const rows = [];
  for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
    rows.push(await play({ style, seed, order, allowBookTakeover: false, intent: 'ai' }));
  const p = 100 * rows.filter(r => r.win).length / rows.length;
  const ok = Math.abs(p - BASELINE[style]) < 0.05;
  console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
  if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
}

const CELLS = [
  { allowBookTakeover: false, intent: 'ai', label: '现状 · 照常打' },
  { allowBookTakeover: true, intent: 'ai', label: '开放收购 · 照常打（看 AI 会不会用）' },
  { allowBookTakeover: true, intent: 'grab', label: '开放收购 · 有钱就抢（无主买、对手持有就收）' },
];
for (const cell of CELLS) {
  console.log(`\n===== ${cell.label} =====`);
  for (const style of STYLES) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++)
      rows.push(await play({ style, seed, order, ...cell }));
    const n = rows.length;
    console.log(`  ${style.padEnd(6)} 胜 ${pct(rows.filter(r => r.win).length, n).padEnd(7)}`
      + ` 破产 ${pct(rows.filter(r => r.bankrupt).length, n).padEnd(6)}`
      + ` 垫底 ${pct(rows.filter(r => r.last).length, n).padEnd(6)}`
      + ` 拿到书屋 ${pct(rows.filter(r => r.gotBook).length, n).padEnd(6)}`
      + ` 成交 ${mean(rows, 'bookDeals').toFixed(2)} 次/局`
      + ` 收租 ${String(Math.round(mean(rows, 'rentEarned'))).padStart(5)}`);
  }
}
console.log('\n注意：allowBookTakeover 目前**只在这个探针里放开**（不贴 engine 的调用点），');
console.log('      所以「开放收购」这一格测的是机制本身。要产品化必须改 economy.js:88');
console.log('      与 takeoverEligible/test，并重制锁与回执 —— 那是用户级取舍。');
