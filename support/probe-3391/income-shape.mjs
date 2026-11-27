// #3391u：进项该按「整条街」发，还是按「自己开着的店」发 —— 这是能不能有座位无关打法的关键。
//
// 已知（三支探针 + 复核 #3424 独立复现）：
//   ① 现行规则（整条街归我才结算）在争街表下**只发给 0 号位**：0 号位进项 13,241、
//      1 号椅 5,217、2 号椅 1,455（seat-or-behaviour.mjs，每格 2,700）。
//   ② 三把椅子轮换后，这条规则整体 **street − plain = 0.0pp**：它把胜率从 1/2 号椅挪给 0 号椅，
//      没有提高任何人的总量。
//   ③ 单给 0 号位等额现金（flat0）几乎一样（座位 0 上 street − flat0 = −4.9pp，区间不含 0）
//      ⇒ 它不是「奖励行为」，是「给一个座位发钱」。
//
// 根因是**条件**：能不能凑齐一条街取决于发牌几何 —— 0 号位那两条街的另一半是无主空地
// （走过去 8,000 买即可），两个 AI 的另一半互为对方（只能走负期望的收购卡）。
// 所以「按整条街发」把一条与座位强相关的条件拿来当收入来源，必然变成座位红利。
//
// 这一支换的是**条件**而不是系数：
//   complete —— 现行规则（整条街归我，每店每天 N）
//   owned    —— 只按「我开着的店」发：每间自己已建、未停业的小店每天 N × 等级。
//                与「别人有另一半」无关 ⇒ 几何上对三家对称。
// 两条规则都在**同一张发牌表**上量，并各跑三条路（照常 / 只抢书屋 / 只补小店），
// 这样「有没有第二种打法」与「座位换过来还站不站得住」能在同一张表上回答。
//
// 判据
//   ① 基线：争街 / 无进项 / 0 号位 复现 53.7 / 36.3 / 44.3；
//   ② 每个进项臂必须真的发钱（硬断言），否则是空臂；
//   ③ 三把椅子轮换的座位差与三起手差必须**一起**印；
//   ④ 键含 rot（同 seed 坐三张椅子是三个观测）。
//
// 用法：node support/probe-3391/income-shape.mjs [150]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';
import { assertUnique, pairedDiff, fmtCI } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 150);
if (SEEDS !== 150) throw new Error('基线是 150 seed（300 局/格）；换样本量就没有可比基线');
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const KNOWN = { grow: 53.7, take: 36.3, cross: 44.3 };
const PER_SHOP = 250;

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = rows => (rows.length ? rows.filter(r => r.win).length / rows.length : 0);
const pct = x => `${(100 * x).toFixed(1)}%`;
const ordersFor = id => {
  const others = STYLES.filter(s => s !== id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

// 「owned」规则：每间自己已建、未停业的小店每天 perShop × 等级。
// 结算点与 settleStreetBusiness 相同（每一天开始），所以把它挂在同一天。
// 这一支不改 src：在 ask 里按「今天还没发过」自己发一次，读的是**引擎真状态**
// （state.properties 的所有权/等级/停业），不是探针自己的账本。
function payOwnedShops(state, perShop) {
  for (const p of state.players) {
    if (!p.alive) continue;
    let total = 0;
    for (const id of p.properties) {
      const pr = state.properties[id];
      if (!pr || pr.ownerId !== p.id) continue;
      const plot = state.map.plots.find(x => x.id === id);
      if (!plot || plot.big) continue;          // 只算小店（书屋另有一套）
      if (!(pr.level > 0) || pr.closed > 0) continue;
      total += perShop * Math.max(1, pr.level);
    }
    if (!total) continue;
    p.cash += total;
    p.sliceStats.business = (p.sliceStats.business ?? 0) + total;
  }
}

async function play({ style, seed, order, rot, rule, arm }) {
  const arranged = [];
  let k = 0;
  for (let i = 0; i < 3; i++) arranged.push(i === rot ? style : order[k++]);
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = arranged.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (state.players.map(p => p.style).join(',') !== arranged.join(',')) throw new Error('SEATING MISMATCH');
  const me = state.players[rot];
  if (me.style !== style) throw new Error(`被量座位不是 ${style}`);

  // 引擎自带的「整条街」结算：只给 complete 臂打开。
  state.config.streetBusinessPerShop = rule === 'complete' ? PER_SHOP : 0;
  let lastPaidDay = null;
  let decisions = 0;
  let boughtSmall = 0, boughtBook = 0, builtSmall = 0, builtBook = 0;

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      // 「owned」臂：每个新的一天、第一次询问时结算一次（与 settleStreetBusiness 同频）。
      if (rule === 'owned' && prompt.player?.id === me.id && prompt.type === 'action') {
        if (lastPaidDay !== state.day) { lastPaidDay = state.day; payOwnedShops(state, PER_SHOP); }
      }
      const mine = prompt.player?.id === me.id;
      let ans = aiAnswer(prompt, state);
      if (mine) {
        const id = prompt.plot?.id ?? prompt.plot;
        const pl = state.map.plots.find(p => p.id === id);
        if (prompt.type === 'action' && ans?.action === 'card' && me.cards[ans.index] === 'buyland') {
          ans = { action: 'roll', dice: 1 };     // 两条路都不靠收购卡
        }
        if (prompt.type === 'buy') {
          if (arm === 'bookOnly' && pl && !pl.big) ans = false;
          if (arm === 'fillOnly' && pl?.big) ans = false;
        }
        if (prompt.type === 'build') {
          if (arm === 'bookOnly' && pl && !pl.big) ans = false;
          if (arm === 'fillOnly' && pl?.big) ans = false;
        }
        if (prompt.type === 'buy' && ans === true) { if (pl?.big) boughtBook++; else boughtSmall++; }
        if (prompt.type === 'build' && ans === true) { if (pl?.big) builtBook++; else builtSmall++; }
      }
      return ans;
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  if (arm === 'bookOnly' && (boughtSmall || builtSmall)) throw new Error('bookOnly 臂没生效（买了/盖了小店）');
  if (arm === 'fillOnly' && (boughtBook || builtBook)) throw new Error('fillOnly 臂没生效（动了书屋）');

  const winnerId = state.players.find(p => p.team === state.winnerTeam)?.id ?? null;
  const income = state.players.map(p => p.sliceStats?.business ?? 0);
  return {
    style: `${style}|${order.join('>')}|${rot}`, styleId: style, seed, order: order.join('>'), rot, rule, arm,
    win: me.id === winnerId ? 1 : 0,
    bankrupt: me.alive ? 0 : 1,
    assets: assetsOf(state, me),
    incomeMine: income[rot],
    incomeOthers: (income.reduce((a, b) => a + b, 0) - income[rot]) / 2,
  };
}

async function run(rule, arm) {
  const rows = [];
  for (const style of STYLES) for (const ord of ordersFor(style)) for (const rot of [0, 1, 2])
    for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order: ord, rot, rule, arm }));
  assertUnique(rows, `${rule}|${arm}`);
  return rows;
}

// ① 基线
console.log('基线校验（争街 / 无进项 / 照常 / 0 号位，对照 balance-3391-300.json）');
const base = await run('none', 'control');
let bad = false;
for (const s of STYLES) {
  const got = 100 * rate(base.filter(r => r.styleId === s && r.rot === 0));
  const ok = Math.abs(got - KNOWN[s]) < 0.05;
  console.log(`  ${s.padEnd(6)} ${got.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${KNOWN[s]}%`}`);
  if (!ok) bad = true;
}
if (bad) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }

const rows = { 'none|control': base };
for (const rule of ['complete', 'owned']) for (const arm of ['control', 'bookOnly', 'fillOnly'])
  rows[`${rule}|${arm}`] = await run(rule, arm);

// ② 每个进项臂必须真的发钱
for (const rule of ['complete', 'owned']) {
  const paid = rows[`${rule}|control`].reduce((s, r) => s + r.incomeMine + 2 * r.incomeOthers, 0);
  if (!paid) throw new Error(`${rule} 臂一分钱进项都没发 —— 空臂，不能当读数`);
}
const n = base.length;
console.log(`\n每格 n=${n}（150 seed × 2 座位排列 × 3 个座位轮换 × 3 起手）。每店每天 ${PER_SHOP}。`);

console.log('\n=== ① 规则 × 路：三起手胜率 / 起手差距 / 座位差 / 破产 ===');
console.log('规则/路              grow   take  cross  起手差距  座位差    合计    破产');
for (const key of Object.keys(rows)) {
  const rs = rows[key];
  if (!rs) continue;
  const w = STYLES.map(s => 100 * rate(rs.filter(r => r.styleId === s)));
  const seats = [0, 1, 2].map(rot => 100 * rate(rs.filter(r => r.rot === rot)));
  console.log(`${key.padEnd(20)} ${w.map(x => x.toFixed(1)).join('  ')}`
    + `  ${(Math.max(...w) - Math.min(...w)).toFixed(1).padStart(6)}pp`
    + `  ${(Math.max(...seats) - Math.min(...seats)).toFixed(1).padStart(5)}pp`
    + ` ${pct(rate(rs)).padStart(7)} ${pct(mean(rs.map(r => r.bankrupt))).padStart(6)}`);
}

console.log('\n=== ② 进项发给谁（按座位，每局均值） ===');
for (const rule of ['complete', 'owned']) {
  const rs = rows[`${rule}|control`];
  console.log(`  ${rule.padEnd(10)} ` + [0, 1, 2].map(rot =>
    `椅子${rot}:${Math.round(mean(rs.filter(r => r.rot === rot).map(r => r.incomeMine)))}`).join('  '));
}

console.log('\n=== ③ 每条路相对照常（同 seed 同座位配对，同一规则内） ===');
for (const rule of ['complete', 'owned']) {
  const ctl = rows[`${rule}|control`];
  for (const arm of ['bookOnly', 'fillOnly']) {
    const a = rows[`${rule}|${arm}`];
    console.log(`  ${`${rule}/${arm}`.padEnd(20)} ${fmtCI(pairedDiff(a, ctl))}`);
    // 分座位：一条路若只在 0 号椅上行，就不是「换座位还站得住」的路。
    for (const rot of [0, 1, 2]) {
      const x = a.filter(r => r.rot === rot), y = ctl.filter(r => r.rot === rot);
      console.log(`    椅子${rot}  ${fmtCI(pairedDiff(x, y))}`);
    }
  }
}

console.log('\n=== ④ 进项规则整体（相对无进项，同 seed 同座位） ===');
for (const rule of ['complete', 'owned']) {
  console.log(`  ${rule.padEnd(10)} ${fmtCI(pairedDiff(rows[`${rule}|control`], base))}`);
  for (const rot of [0, 1, 2]) {
    const x = rows[`${rule}|control`].filter(r => r.rot === rot);
    const y = base.filter(r => r.rot === rot);
    console.log(`    椅子${rot}  ${fmtCI(pairedDiff(x, y))}`);
  }
}
