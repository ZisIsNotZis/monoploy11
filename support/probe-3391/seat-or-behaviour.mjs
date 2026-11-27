// #3391u：营业进项到底在奖励「行为」还是「座位」—— 这是复核 #3424 逼出来的那一格。
//
// 复核的原话（并已被 supervisor 独立复现）：
//   「进项规则座位 0 胜率 63.9%，单给同一座位现金 62.8%，只差 1.1 个百分点，
//     两种都明显高于原规则 46.1%。对玩家这不能当成第二套玩法。」
//
// 这句话推翻的是 RESULT-3391t §一.1 的末句「规则确实在奖励一个行为」。
// 那一轮的对照臂 `flat` 是「**三家**每天各白拿 800」—— 它同时抬高了对手，
// 于是一个「只给一方」的效应会被自己抵消掉。对照臂的**受益集合**必须与处理臂相同，
// 否则那个对照不叫对照。这就是本文件存在的唯一理由。
//
// 三个臂（同一批 seed / 座位排列 / 轮换位）：
//   plain  —— 正式规则（无进项）
//   street —— 进项：整条街归我就每天结算，每店每天 250（首屏可选档，三家一视同仁）
//   flat0  —— **只给受试座位**每天 800 现金，无任何所有权条件（对照组）
// flat0 就是那个「只给一方」的对照 —— 复核已经用它把 17.8pp 缩到 −1.1pp。
// 本文件把它做成可复跑的一支，并把三个座位都轮换一遍。
//
// 判据（任何一条不满足就不印结论）：
//   ① 基线：争街 / plain / 0 号位 复现 53.7 / 36.3 / 44.3；
//   ② flat0 的注入额必须与 street 臂「实际发出的进项」同量级（比值印出来，不硬凑）；
//   ③ 同一 (style,seed,rot,arm) 只许一条；
//   ④ street0 与 flat0 必须**同时**印 —— 只印其中一个就无法回答「是不是钱变多了」。
//
// 用法：node support/probe-3391/seat-or-behaviour.mjs [150]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
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
const FLAT_PER_DAY = 800;

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = x => `${(100 * x).toFixed(1)}%`;
const rate = rows => (rows.length ? rows.filter(r => r.win).length / rows.length : 0);
const ordersFor = id => {
  const others = STYLES.filter(s => s !== id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

async function play({ style, seed, order, rot, arm }) {
  const arranged = [];
  let k = 0;
  for (let i = 0; i < 3; i++) arranged.push(i === rot ? style : order[k++]);
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = arranged.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  if (state.players.map(p => p.style).join(',') !== arranged.join(',')) {
    throw new Error(`SEATING MISMATCH ${state.players.map(p => p.style).join(',')} != ${arranged.join(',')}`);
  }
  const me = state.players[rot];
  if (me.style !== style) throw new Error(`被量座位不是 ${style}`);

  state.config.streetBusinessPerShop = arm === 'street' ? PER_SHOP : 0;
  if (arm === 'street0') throw new Error('street0 臂已取消，见文件头的臂清单');

  let decisions = 0;
  let paidToOthers = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      // flat0：每个「新的一天第一次 ask」给受试座位发一笔与进项同频的现金。
      // 频率对齐是必须的 —— 与 income-control 同一个做法，否则又被时间差解释。
      if (arm === 'flat0' && prompt.player?.id === me.id && prompt.type === 'action') {
        const today = state.day;
        if (me.__flatDay !== today) { me.__flatDay = today; me.cash += FLAT_PER_DAY; }
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');

  // 账本：进项按座位拆（street0 臂要用它把对手那份扣掉，才能给出「只给一人」的读数）。
  const income = state.players.map(p => p.sliceStats?.business ?? 0);
  const winnerId = state.players.find(p => p.team === state.winnerTeam)?.id ?? null;
  return {
    style: `${style}|${order.join('>')}|${rot}`, styleId: style, seed, order: order.join('>'), rot, arm,
    win: me.id === winnerId ? 1 : 0,
    bankrupt: me.alive ? 0 : 1,
    assets: assetsOf(state, me),
    incomeMine: income[rot],
    incomeOthers: (income.reduce((a, b) => a + b, 0) - income[rot]) / 2,
    paidToOthers,
  };
}

async function run(arm) {
  const rows = [];
  for (const style of STYLES) for (const ord of ordersFor(style)) for (const rot of [0, 1, 2])
    for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order: ord, rot, arm }));
  assertUnique(rows, arm);
  return rows;
}

// ① 基线
// 注意：入库的那张表只量 0 号位；本文件三把椅子都轮换，所以基线闸只能对 0 号位那一格用。
console.log('基线校验（争街 / 无进项 / 照常打 / 0 号位，对照 balance-3391-300.json）');
const base = await run('plain');
let bad = false;
for (const s of STYLES) {
  const got = 100 * rate(base.filter(r => r.styleId === s && r.rot === 0));
  const ok = Math.abs(got - KNOWN_CONTESTED[s]) < 0.05;
  console.log(`  ${s.padEnd(6)} 0 号位 ${got.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${KNOWN_CONTESTED[s]}%`}`);
  if (!ok) bad = true;
}
if (bad) { console.error('基线没复现 —— 不印后面。'); process.exit(2); }

const street = await run('street');
const flat0 = await run('flat0');
const rows = { plain: base, street, flat0 };
const n = base.length;
console.log(`\n每格 n=${n}（150 seed × 2 座位排列 × 3 个座位轮换 × 3 起手）。`);

// ② 注入额对照：flat0 与 street 发出去的钱必须同量级（不硬凑，只印比值）
const incStreet = mean(street.map(r => r.incomeMine + 2 * r.incomeOthers));
const incFlat0 = mean(flat0.map(() => 0)) + FLAT_PER_DAY * 15;  // 15 个结算点（第 1 天不发）
console.log(`注入额：street 每局发 ${Math.round(incStreet)}（三家合计）`
  + `；flat0 给受试座位每局 ${incFlat0}（= ${FLAT_PER_DAY} × 15 天）`);

console.log('\n=== ① 三个臂：胜率（按起手 / 按座位） ===');
console.log('臂        grow   take  cross   合计    座位0   座位1   座位2');
for (const arm of ['plain', 'street', 'flat0']) {
  const rs = rows[arm];
  const w = STYLES.map(s => (100 * rate(rs.filter(r => r.styleId === s))).toFixed(1));
  const per = [0, 1, 2].map(rot => (100 * rate(rs.filter(r => r.rot === rot))).toFixed(1));
  console.log(`${arm.padEnd(9)} ${w.join('  ')}  ${pct(rate(rs)).padStart(6)}  ${per.join('   ')}`);
}

console.log('\n=== ② 决定性问题：street 是否优于「等额只给这个座位的现金」（同 seed 配对） ===');
const d = pairedDiff(street, flat0);
console.log(`  street − flat0            ${fmtCI(d)}`);
const d0 = pairedDiff(street.filter(r => r.rot === 0), flat0.filter(r => r.rot === 0));
console.log(`  仅座位 0 上 street − flat0  ${fmtCI(d0)}`);
// #3391v（复核 #3425）：这一行原来是**无条件**打印的，而上面那条读数实测不含 0
// （−4.9pp [−7.1,−2.6]）—— 照括号读会读反。而且 flat0 这面对照臂本身也不干净：
// street 在 0 号椅上**同时给每个对手发钱**（3,336/局），flat0 只给受试座位、对手 0，
// 又是「受益集合不匹配」，只是方向反过来（少给对手）。对齐后（flat0p，每对手 3,436）
// street − flat0p 仅 0 号椅 = −0.9pp [−3.5,1.7]，**跨 0**。
// 所以这一支只用来支撑前半句「不是奖励行为」，不再支撑「不如白给」，也不再手写结论。
console.log('  ⚠ flat0 不给对手发钱，street 给；受益集合不同 ⇒ 上面两条不能当「不如白给」的证据。');
console.log('    对齐对手那份（复核 #3425 的 flat0p）后跨 0（−0.9pp [−3.5,1.7]）：二者分不开。');
console.log('\n  对照：street − plain      ' + fmtCI(pairedDiff(street, base)));
console.log('        flat0  − plain      ' + fmtCI(pairedDiff(flat0, base)));

// ③ 第一次写这一节时我印了「受试座位 / 两位对手平均」的比值 —— 它按构造恒等于 1.00×
// （三个轮换位平均后，任何一家的进项就是全场的平均）。那个 1.00× 是**自造的整齐**，
// 会让人读成「三家分得很均」，与事实相反。所以只印**按座位拆的绝对值**。
console.log('\n=== ③ 钱发给了谁（street 臂，每局每座位的进项均值） ===');
for (const rot of [0, 1, 2]) {
  const rs = street.filter(r => r.rot === rot);
  console.log(`  坐在 ${rot} 号椅: 受试座位进项 ${Math.round(mean(rs.map(r => r.incomeMine)))}`
    + `，两位对手平均 ${Math.round(mean(rs.map(r => r.incomeOthers)))}`);
}
console.log('  无进项（plain）时三个座位各自的胜率：'
  + [0, 1, 2].map(rot => pct(rate(base.filter(r => r.rot === rot)))).join(' / '));
console.log('  开进项（street）后：'
  + [0, 1, 2].map(rot => pct(rate(street.filter(r => r.rot === rot)))).join(' / '));
