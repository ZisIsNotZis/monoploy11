// #3391u：候选配置的完整读数 —— 对称发牌（free）+ 按自己开着的店结算的进项（owned）。
//
// 这两件事是分开量出来的，各自解决一个已被复核确认的缺陷：
//   ① 发牌（deal-sweep.mjs / symmetric-deal.mjs）：争街表下 0 号位两条街的另一半是
//      **无主空地**（走过去 8,000 买即可），两个 AI 的另一半**互为对方**（只能走负期望的收购卡）。
//      于是「凑齐一条街」只对 0 号椅成立 —— 这就是「座位红利」的几何来源。
//      free 表让三家各自都有一间「隔壁是空地」的店 ⇒ 三家都能按标价补齐，与座位无关。
//   ② 进项（income-shape.mjs）：现行规则按「整条街归我」结算 ⇒ 只有 0 号椅凑得齐 ⇒
//      三把椅子进项 13,196 / 5,177 / 1,317，规则整体 0.0pp（纯搬运）。
//      owned 规则按「自己开着的店」结算 ⇒ 20,781 / 20,034 / 19,969，三家对称。
//
// 这一支把两者合起来，并回答 supervisor 那句话（「两个座位换过来也站得住的打法」）：
// 在 free + owned 下，把一家限制成「只抢书屋」或「只补齐自己那条街」，
// 三条路在**三把椅子上都印一次**；只要某条路只在 0 号椅上成立，它就不算答案。
//
// 判据
//   ① 基线复现 53.7 / 36.3 / 44.3（争街 / 无进项 / 0 号位）；
//   ② free 表真的生效（逐局断言持有表）；owned 臂真的发钱；
//   ③ 键含 rot。
//
// 用法：node support/probe-3391/free-owned.mjs [150]
import { SLICE_STYLES, SLICE_MAP, createSliceConfig } from '../../src/data/slice.js';
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

const STREETS = ['晨光街', '晚风街', '灯火街', '月色街', '西巷', '东巷'];
const plotsOf = s => SLICE_MAP.plots.filter(p => !p.big && p.street === s).map(p => p.id);
if (STREETS.some(s => plotsOf(s).length !== 2)) throw new Error('街道不都是两间 —— 前提不成立');
const DEAL_FREE = [0, 1, 2].map(i => [plotsOf(STREETS[i])[0], plotsOf(STREETS[(i + 3) % 6])[1]]);

function applyFree(state) {
  for (const pl of state.map.plots) state.properties[pl.id].ownerId = null;
  for (const p of state.players) p.properties = [];
  DEAL_FREE.forEach((ids, i) => {
    const p = state.players[i];
    for (const id of ids) { state.properties[id].ownerId = p.id; p.properties.push(id); }
  });
}

// owned 规则：每间自己已建、未停业的小店每天 perShop × 等级（与 settleStreetBusiness 同频）。
function payOwnedShops(state, perShop) {
  for (const p of state.players) {
    if (!p.alive) continue;
    let total = 0;
    for (const id of p.properties) {
      const pr = state.properties[id];
      if (!pr || pr.ownerId !== p.id) continue;
      const plot = state.map.plots.find(x => x.id === id);
      if (!plot || plot.big) continue;
      if (!(pr.level > 0) || pr.closed > 0) continue;
      total += perShop * Math.max(1, pr.level);
    }
    if (!total) continue;
    p.cash += total;
    p.sliceStats.business = (p.sliceStats.business ?? 0) + total;
  }
}

async function play({ style, seed, order, rot, table, income, arm }) {
  const arranged = [];
  let k = 0;
  for (let i = 0; i < 3; i++) arranged.push(i === rot ? style : order[k++]);
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: table !== 'free' });
  config.participants = arranged.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (state.players.map(p => p.style).join(',') !== arranged.join(',')) throw new Error('SEATING MISMATCH');
  if (table === 'free') {
    applyFree(state);
    DEAL_FREE.forEach((ids, i) => {
      const got = state.map.plots.filter(pl => !pl.big && state.properties[pl.id].ownerId === state.players[i].id)
        .map(pl => pl.id).sort();
      if (got.join() !== [...ids].sort().join()) throw new Error(`free: 座位 ${i} 持有表不符`);
    });
  }
  const me = state.players[rot];
  if (me.style !== style) throw new Error(`被量座位不是 ${style}`);
  state.config.streetBusinessPerShop = 0;   // 只用下面的 owned 结算

  let lastPaidDay = null;
  let decisions = 0;
  let boughtSmall = 0, boughtBook = 0, builtSmall = 0, builtBook = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      if (income === 'owned' && prompt.player?.id === me.id && prompt.type === 'action'
        && lastPaidDay !== state.day) {
        lastPaidDay = state.day;
        payOwnedShops(state, PER_SHOP);
      }
      const mine = prompt.player?.id === me.id;
      let ans = aiAnswer(prompt, state);
      if (mine) {
        const id = prompt.plot?.id ?? prompt.plot;
        const pl = state.map.plots.find(p => p.id === id);
        if (prompt.type === 'action' && ans?.action === 'card' && me.cards[ans.index] === 'buyland') {
          ans = { action: 'roll', dice: 1 };
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
  if (arm === 'bookOnly' && (boughtSmall || builtSmall)) throw new Error('bookOnly 臂没生效');
  if (arm === 'fillOnly' && (boughtBook || builtBook)) throw new Error('fillOnly 臂没生效');

  const winnerId = state.players.find(p => p.team === state.winnerTeam)?.id ?? null;
  const incomeBySeat = state.players.map(p => p.sliceStats?.business ?? 0);
  return {
    style: `${style}|${order.join('>')}|${rot}`, styleId: style, seed, order: order.join('>'), rot,
    table, income, arm,
    win: me.id === winnerId ? 1 : 0,
    bankrupt: me.alive ? 0 : 1,
    assets: assetsOf(state, me),
    incomeMine: incomeBySeat[rot],
    small: state.map.plots.filter(pl => !pl.big && state.properties[pl.id].ownerId === me.id).length,
  };
}

async function run(cfg) {
  const rows = [];
  for (const style of STYLES) for (const ord of ordersFor(style)) for (const rot of [0, 1, 2])
    for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order: ord, rot, ...cfg }));
  assertUnique(rows, JSON.stringify(cfg));
  return rows;
}

// ① 基线
console.log('基线校验（争街 / 无进项 / 照常 / 0 号位，对照 balance-3391-300.json）');
const base = await run({ table: 'contested', income: 'none', arm: 'control' });
let bad = false;
for (const s of STYLES) {
  const got = 100 * rate(base.filter(r => r.styleId === s && r.rot === 0));
  const ok = Math.abs(got - KNOWN[s]) < 0.05;
  console.log(`  ${s.padEnd(6)} ${got.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${KNOWN[s]}%`}`);
  if (!ok) bad = true;
}
if (bad) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }

const rows = { 'contested/none/control': base };
for (const arm of ['control', 'bookOnly', 'fillOnly'])
  rows[`free/owned/${arm}`] = await run({ table: 'free', income: 'owned', arm });
rows['free/none/control'] = await run({ table: 'free', income: 'none', arm: 'control' });

// ② owned 臂真的发钱
const paid = rows['free/owned/control'].reduce((s, r) => s + r.incomeMine, 0);
if (!paid) throw new Error('owned 臂一分钱都没发 —— 空臂，不能当读数');
for (const arm of ['control', 'bookOnly', 'fillOnly'])
  if (!rows[`free/owned/${arm}`].some(r => r.incomeMine > 0)) throw new Error(`free/owned/${arm} 没发钱`);

const n = base.length;
console.log(`\n每格 n=${n}（150 seed × 2 座位排列 × 3 座位轮换 × 3 起手）。owned 每店每天 ${PER_SHOP}。`);

console.log('\n=== ① 配置 × 路：胜率 / 起手差距 / 座位差 / 破产 ===');
console.log('配置/路                   grow   take  cross  起手差距  座位差    合计    破产');
for (const key of Object.keys(rows)) {
  const rs = rows[key];
  const w = STYLES.map(s => 100 * rate(rs.filter(r => r.styleId === s)));
  const seats = [0, 1, 2].map(rot => 100 * rate(rs.filter(r => r.rot === rot)));
  console.log(`${key.padEnd(24)} ${w.map(x => x.toFixed(1)).join('  ')}`
    + `  ${(Math.max(...w) - Math.min(...w)).toFixed(1).padStart(6)}pp`
    + `  ${(Math.max(...seats) - Math.min(...seats)).toFixed(1).padStart(5)}pp`
    + ` ${pct(rate(rs)).padStart(7)} ${pct(mean(rs.map(r => r.bankrupt))).padStart(6)}`);
}

console.log('\n=== ② 进项按座位（每局均值）—— 对称性 ===');
for (const key of ['free/owned/control', 'free/owned/bookOnly', 'free/owned/fillOnly']) {
  const rs = rows[key];
  console.log(`  ${key.padEnd(22)} ` + [0, 1, 2].map(rot =>
    `椅子${rot}:${Math.round(mean(rs.filter(r => r.rot === rot).map(r => r.incomeMine)))}`).join('  '));
}

console.log('\n=== ③ 两条路 vs 照常（同 seed 同座位配对）：在每把椅子上都成立吗 ===');
for (const arm of ['bookOnly', 'fillOnly']) {
  const a = rows[`free/owned/${arm}`], c = rows['free/owned/control'];
  console.log(`  ${arm.padEnd(10)} 合计 ${fmtCI(pairedDiff(a, c))}`);
  for (const rot of [0, 1, 2]) {
    const x = a.filter(r => r.rot === rot), y = c.filter(r => r.rot === rot);
    console.log(`    椅子${rot}  ${fmtCI(pairedDiff(x, y))}`);
  }
}

console.log('\n=== ④ owned 进项本身（free 表上，相对无进项） ===');
console.log(`  合计      ${fmtCI(pairedDiff(rows['free/owned/control'], rows['free/none/control']))}`);
for (const rot of [0, 1, 2]) {
  const x = rows['free/owned/control'].filter(r => r.rot === rot);
  const y = rows['free/none/control'].filter(r => r.rot === rot);
  console.log(`    椅子${rot}  ${fmtCI(pairedDiff(x, y))}`);
}
