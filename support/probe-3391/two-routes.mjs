// #3391u（决定性的一支）：在对称发牌表上，是否真的存在两条路。
//
// 上一支（symmetric-deal.mjs）量到：
//   · 现状争街表下，营业进项 250 是**座位红利**：0 号位 +17.3pp，另两个座位 −9.2 / −8.1pp；
//   · 「free」对称表（每家一条街的另一半都是**无主空地**）下，同一规则的三个座位读数
//     变成 +2.2 / −2.4 / +0.2pp —— 不再是座位红利；
//   · free + 250 的三起手胜率 46.7 / 37.0 / 46.7（差距 9.7pp），比现状 53.7/36.3/44.3（17.3pp）窄。
//
// 但「差距窄」不等于「有两种打算」。这一支直接问那句话：把一家限制成只走一条路，
// 它还赢不赢得了？两条路必须**都不至于输穿**，否则其中一条只是陷阱。
//
// 臂（都只限制 0 号位，对手照常打）：
//   control  —— 照常打（AI 原样）
//   bookOnly —— 只抢街心书屋：不买任何小店、不给小店加盖
//   fillOnly —— 只补齐自己的街：不买街心书屋（小店可以加盖）
//
// 每张表 × 每臂都按**座位**再拆一次：这是 supervisor 那句「两个座位换过来也站得住」的判据。
// 具体做法：被量座位轮流坐在 0 号位、1 号位、2 号位（把三家的位置轮换），
// 而不是「只量 0 号位然后相信它代表全部」。#3391t 就是栽在没有轮换。
//
// 判据
//   ① 基线：争街 / 无进项 / 照常打 复现 53.7 / 36.3 / 44.3；
//   ② 每臂必须真的按设计行事（硬断言：bookOnly 一局里 0 个非书屋地产归它；fillOnly 0 次书屋归它）；
//   ③ 轮换后同一臂在三个座位上的胜率要一起印 —— 只印 0 号位的表不要引用。
//
// 用法：node support/probe-3391/two-routes.mjs [150]
import { SLICE_STYLES, SLICE_MAP, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';
import { assertUnique, pairedDiff, fmtCI } from './stats.mjs';

const SEEDS = Number(process.argv[2] ?? 150);
if (SEEDS !== 150) throw new Error('基线是 150 seed（300 局/格）；换样本量就没有可比基线');
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const KNOWN_CONTESTED = { grow: 53.7, take: 36.3, cross: 44.3 };
const PER_SHOP = 250;

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = x => `${(100 * x).toFixed(1)}%`;
const rate = rows => (rows.length ? rows.filter(r => r.win).length / rows.length : 0);

// makeMap 街道顺序（与 slice.js 的 makeMap 一致）
const STREETS = ['晨光街', '晚风街', '灯火街', '月色街', '西巷', '东巷'];
const plotsOf = s => SLICE_MAP.plots.filter(p => !p.big && p.street === s).map(p => p.id);
const DEAL_FREE = [0, 1, 2].map(i => [plotsOf(STREETS[i])[0], plotsOf(STREETS[(i + 3) % 6])[1]]);

function applyDeal(state, table) {
  if (table === 'contested') return;
  if (table !== 'free') throw new Error(`unknown table ${table}`);
  for (const pl of state.map.plots) state.properties[pl.id].ownerId = null;
  for (const p of state.players) p.properties = [];
  DEAL_FREE.forEach((ids, i) => {
    const p = state.players[i];
    for (const id of ids) { state.properties[id].ownerId = p.id; p.properties.push(id); }
  });
}

// 让被量的座位轮流坐到 0/1/2 号位：把座位表整体轮换 rot 位。
function rotate(seated, rot) {
  const out = seated.slice();
  for (let i = 0; i < rot; i++) out.unshift(out.pop());
  return out;
}

async function play({ style, seed, order, table, arm, rot, perShop }) {
  const seated = [style, ...order];
  // 被量座位（seated[0]）放到 rot 号椅子；其余按原顺序填满剩下的椅子。
  const others = seated.slice(1);
  const arranged = [];
  let k = 0;
  for (let i = 0; i < 3; i++) arranged.push(i === rot ? seated[0] : others[k++]);
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: table === 'contested' });
  config.participants = arranged.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (state.players.map(p => p.style).join(',') !== arranged.join(',')) {
    throw new Error(`SEATING MISMATCH ${state.players.map(p => p.style).join(',')} != ${arranged.join(',')}`);
  }
  // 发牌表按**座位**写（DEAL_FREE[i] 是 i 号椅子），轮换后自然跟着椅子走。
  applyDeal(state, table);
  state.config.streetBusinessPerShop = perShop;
  const me = state.players[rot];
  if (me.style !== style) throw new Error(`被量座位不是 ${style}`);

  // 起手自带的两间小店是发牌给的，绕不过去（initializeSlice 给的）。所以「只抢书屋」
  // 只能定义成「不再买更多小店、不给小店加盖」—— 断言要量的是**行为**，不是终局持有。
  let decisions = 0;
  let boughtSmall = 0, boughtBook = 0, builtSmall = 0, builtBook = 0, tookOver = 0, armTouched = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === me.id;
      let ans = aiAnswer(prompt, state);
      if (mine) {
        const id = prompt.plot?.id ?? prompt.plot;
        const pl = state.map.plots.find(p => p.id === id);
        // 出牌：两条路都不靠收购（那是第三张牌的活），所以把这局手上的 buyland 按住不用。
        // 注意 action 的答案形状是 {action:'card', index}，index 是**手牌下标**。
        if (prompt.type === 'action' && ans?.action === 'card' && me.cards[ans.index] === 'buyland') {
          ans = { action: 'roll', dice: 1 };
        }
        if (arm !== 'control') {
          // #3391v（复核 #3425）：记「这条臂有没有真的改写答案」。只在 AI 本来要买/加盖
          // 书屋时才改写 ⇒ 那些没有这类提议的局里这一臂**不在场**，与 control 逐字节相同。
          // 不记这个数，就会把「−38.8pp 摊到 100% 的局」印成 −15.9pp。
          const before = JSON.stringify(ans);
          if (prompt.type === 'buy') {
            if (arm === 'bookOnly' && pl && !pl.big) ans = false;   // 只抢书屋：不再买小店
            if (arm === 'fillOnly' && pl?.big) ans = false;          // 不抢书屋：小店照买（这就是「补齐」）
          }
          if (prompt.type === 'build') {
            if (arm === 'bookOnly' && pl && !pl.big) ans = false;    // 不给小店加盖
            if (arm === 'fillOnly' && pl?.big) ans = false;          // 不给书屋加盖
          }
          if (JSON.stringify(ans) !== before) armTouched++;
        }
      }
      // 计数：这局这个座位到底做了什么 —— 这就是断言的依据。
      if (mine && prompt.type === 'buy' && ans === true) {
        const pl = state.map.plots.find(p => p.id === (prompt.plot?.id ?? prompt.plot));
        if (pl?.big) boughtBook++; else boughtSmall++;
      }
      if (mine && prompt.type === 'build' && ans === true) {
        const pl = state.map.plots.find(p => p.id === (prompt.plot?.id ?? prompt.plot));
        if (pl?.big) builtBook++; else builtSmall++;
      }
      return ans;
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');

  // ② 硬断言：这局这个座位的行为是不是真的按设计走的。
  const small = state.map.plots.filter(pl => !pl.big).filter(pl => state.properties[pl.id].ownerId === me.id);
  const book = state.properties.market?.ownerId === me.id;
  if (arm === 'bookOnly' && (boughtSmall || builtSmall)) {
    throw new Error(`bookOnly 臂里 ${style} 还买了 ${boughtSmall} 间小店、加盖 ${builtSmall} 次 — 臂没生效`);
  }
  if (arm === 'fillOnly' && (boughtBook || builtBook)) {
    throw new Error(`fillOnly 臂里 ${style} 买了 ${boughtBook} 次书屋、给它加盖 ${builtBook} 次 — 臂没生效`);
  }

  const winnerId = state.players.find(p => p.team === state.winnerTeam)?.id ?? null;
  return {
    // 键里必须带轮换位：同 (style,seed) 会坐在 3 张椅子上，那 3 条是三个不同的观测，
    // 但同 (style,seed,rot,arm) 只许一条 —— 这才是 assertUnique 该咬的重跑。
    style: `${style}|${order.join('>')}|${rot}`, styleId: style, seed, order: order.join('>'),
    table, arm, rot, perShop, armTouched,
    // 空臂 = 这条臂整局一次都没改写答案 ⇒ 它其实等于 control，不能与生效局混在一起算。
    vacuous: arm !== 'control' && armTouched === 0 ? 1 : 0,
    win: me.id === winnerId ? 1 : 0,
    bankrupt: me.alive ? 0 : 1,
    assets: assetsOf(state, me),
    income: me.sliceStats?.business ?? 0,
    small: small.length, book: book ? 1 : 0,
  };
}

// 对手的两种座位排列（与 balance-slice.mjs 同一协议）。
const ordersFor = id => {
  const others = STYLES.filter(s => s !== id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

async function run(table, arm, perShop) {
  const rows = [];
  for (const style of STYLES) for (const ord of ordersFor(style))
    for (const rot of [0, 1, 2])
      for (let seed = 1; seed <= SEEDS; seed++)
        rows.push(await play({ style, seed, order: ord, table, arm, rot, perShop }));
  assertUnique(rows, `${table}|${arm}|${perShop}`);
  return rows;
}

// ① 基线（争街 / 无进项 / 照常打 / 只坐 0 号位，与入库表同口径）
console.log('基线校验（争街 / 无进项 / 照常打 / 0 号位）');
let bad = false;
for (const s of STYLES) {
  const rs = [];
  for (const ord of ordersFor(s))
    for (let seed = 1; seed <= SEEDS; seed++)
      rs.push(await play({ style: s, seed, order: ord, table: 'contested', arm: 'control', rot: 0, perShop: 0 }));
  const got = 100 * rate(rs);
  const ok = Math.abs(got - KNOWN_CONTESTED[s]) < 0.05;
  console.log(`  ${s.padEnd(6)} ${got.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${KNOWN_CONTESTED[s]}%`}`);
  if (!ok) bad = true;
}
if (bad) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }

const rows = {};
for (const table of ['contested', 'free']) for (const arm of ['control', 'bookOnly', 'fillOnly'])
  rows[`${table}|${arm}`] = await run(table, arm, PER_SHOP);

const n = rows['contested|control'].length;
console.log(`\n每格 n=${n}（150 seed × 2 座位排列 × 3 个座位轮换）。营业进项每店每天 ${PER_SHOP}。`);

console.log('\n=== ① 两条路在同一张表上都不至于输穿吗（按座位轮换后） ===');
console.log('表/臂              grow    take   cross   合计    破产');
for (const table of ['contested', 'free']) for (const arm of ['control', 'bookOnly', 'fillOnly']) {
  const rs = rows[`${table}|${arm}`];
  const w = STYLES.map(s => 100 * rate(rs.filter(r => r.styleId === s)));
  console.log(`${`${table}/${arm}`.padEnd(18)} ${w.map(x => x.toFixed(1)).join('   ')}  ${pct(rate(rs)).padStart(6)}  ${pct(mean(rs.map(r => r.bankrupt)))}`);
}

console.log('\n=== ② 「座位换过来还站得住」：同一臂在三个座位上的胜率 ===');
console.log('表/臂              座位0   座位1   座位2   最大差');
for (const table of ['contested', 'free']) for (const arm of ['control', 'bookOnly', 'fillOnly']) {
  const rs = rows[`${table}|${arm}`];
  const per = [0, 1, 2].map(rot => 100 * rate(rs.filter(r => r.rot === rot)));
  console.log(`${`${table}/${arm}`.padEnd(18)} ${per.map(x => x.toFixed(1)).join('   ')}   ${(Math.max(...per) - Math.min(...per)).toFixed(1)}pp`);
}

console.log('\n=== ③ 每条路相对照常打（同 seed 同座位配对） ===');
// #3391v（复核 #3425）：一条臂只在「AI 本来要买/加盖书屋」时才改写答案。没有这类提议的局里
// 它与 control 逐字节相同、配对差恒为 0 —— 那会把「只补齐」的代价从 −39pp 稀释成 −16pp。
// 所以这里给**两栏**：全部局（对外旧口径，保留以便对照历史）与仅生效局（这条臂真在场）。
console.log('表/臂              空臂率   全部局                    仅生效局');
for (const table of ['contested', 'free']) {
  const ctl = rows[`${table}|control`];
  for (const arm of ['bookOnly', 'fillOnly']) {
    const rs = rows[`${table}|${arm}`];
    const live = rs.filter(r => r.armTouched > 0);
    const vac = rs.length ? 100 * rs.filter(r => r.vacuous).length / rs.length : 0;
    const all = fmtCI(pairedDiff(rs, ctl));
    const only = live.length ? fmtCI(pairedDiff(live, ctl.filter(r => live.some(x => x.style === r.style && x.seed === r.seed)))) : '（没有生效局）';
    console.log(`  ${`${table}/${arm}`.padEnd(16)} ${vac.toFixed(1).padStart(5)}%  ${all.padEnd(24)} ${only}`);
    // 逐起手只在「仅生效局」上印 —— 全部局的逐起手同样被空臂稀释。
    for (const s of STYLES) {
      const a = live.filter(r => r.styleId === s);
      const ids = new Set(a.map(r => `${r.style}|${r.seed}`));
      const b = ctl.filter(r => ids.has(`${r.style}|${r.seed}`));
      if (!a.length) { console.log(`    ${s.padEnd(6)} （没有生效局）`); continue; }
      console.log(`    ${s.padEnd(6)} 仅生效 ${fmtCI(pairedDiff(a, b))}`);
    }
  }
}

console.log('\n=== ④ 失败方式分得开吗（均值） ===');
console.log('表/臂              破产   终局资产   进项   小店数  书屋');
for (const table of ['contested', 'free']) for (const arm of ['control', 'bookOnly', 'fillOnly']) {
  const rs = rows[`${table}|${arm}`];
  console.log(`${`${table}/${arm}`.padEnd(18)} ${pct(mean(rs.map(r => r.bankrupt)))} ${Math.round(mean(rs.map(r => r.assets))).toString().padStart(8)}`
    + ` ${Math.round(mean(rs.map(r => r.income))).toString().padStart(6)} ${mean(rs.map(r => r.small)).toFixed(2).padStart(6)} ${pct(mean(rs.map(r => r.book)))}`);
}
