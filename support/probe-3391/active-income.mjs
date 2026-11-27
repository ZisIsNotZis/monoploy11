// #3391y：玩家「主动经营」这条路缺的不是动作，是一条不依赖骰子的收入线。
//
// 已经量清楚的（都在这一片里，可复跑）：
//   · 加盖是主动的、代价看得懂的（10,000，租金 2,000→4,000→8,000），但**负期望**
//     （禁升在 grow 上 +10.3pp，n=300）。原因：它只翻倍「单次租金」，
//     不改变「被踩到的次数」；小店整局约被踩 2.66 次。
//   · 「整条街营业进项」(#3391s) 想补这条线，但量下来是**座位补贴**
//     （只对人类那张椅子 3.97×，三把椅子平均 0.0pp，#3391u）。
//
// 这一支试的口径变了：**按「自己持有且已开张的小店数」每日结算**，而不是按「整条街」。
// 为什么换：座位补贴的根因是「谁凑得齐一条街」由发牌几何决定
// （人类两条街的另一半是无主空地，两个 AI 互为对方 —— 见 human-half.mjs）。
// 「自己持有并开张的小店数」不依赖那条街归谁，只依赖玩家自己买了几块、开了几块。
//
// 判据（三条一起看，缺一条就不成立）：
//   ① 座位差：三把椅子轮换后，进项是否还偏向某一个座位；
//   ② 是否提高总量：与「白给同样多的钱」对照，是否只是钱变多；
//   ③ 是否产出第二条路：只经营（不抢书屋）能不能赢到不像陷阱。
//
// 用法：node support/probe-3391/active-income.mjs [seeds] [perShop]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';
import { assertObsUnique, paired, fmtCI } from './_stats-rot.mjs';

const SEEDS = Number(process.argv[2] ?? 60);
const PER_SHOP = Number(process.argv[3] ?? 250);
const STYLES = ['grow', 'take', 'cross'];
const BOOK = 'market';
const DECISION_LIMIT = 5000;

const rate = rows => (rows.length ? rows.filter(r => r.win).length / rows.length : 0);
const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = (rows, f) => (rows.length ? rows.reduce((a, r) => a + f(r), 0) / rows.length : 0);

// 被量座位轮流坐到 0/1/2 号椅子 —— 这是 #3391t 教的：只量 0 号位会把座位红利读成规则效果。
function arrange(style, order, rot) {
  const others = order.slice();
  const out = [];
  let k = 0;
  for (let i = 0; i < 3; i++) out.push(i === rot ? style : others[k++]);
  return out;
}

async function play({ style, seed, order, rot, arm, perShop }) {
  const seated = arrange(style, order, rot);
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  config.participants = seated.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const me = state.players[rot];
  if (me.style !== style) throw new Error(`SEAT MISMATCH ${me.style} != ${style}`);

  let decisions = 0, income = 0;

  // 收入线：每个**自己持有且已开张**的小店，每天结算 perShop。
  // 不动引擎：在 advanceDay 之后由探针自己发钱 —— 这样产品字节保持 0 改动，
  // 而「规则会长什么样」是能亲手量的。真要做成产品，这段会进 flow.js。
  const tick = () => {
    if (arm !== 'income' && arm !== 'incomeNoBook') return;
    const shops = me.properties.filter(id => {
      const pr = state.properties[id];
      const plot = state.map.plots.find(p => p.id === id);
      return pr && !plot?.big && pr.level > 0 && pr.closed === 0;
    }).length;
    const gain = shops * perShop;
    if (gain) { me.cash += gain; income += gain; }
  };

  let lastDay = state.day;
  await runGame(state, {
    render() {
      if (state.day !== lastDay) { lastDay = state.day; tick(); }
    },
    async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      const mine = prompt.player?.id === me.id;
      let ans = aiAnswer(prompt, state);
      if (!mine) return ans;
      const id = prompt.plot?.id ?? prompt.plot;
      const plot = state.map.plots.find(p => p.id === id);
      if (arm === 'bookOnly' || arm === 'incomeNoBook') {
        if (prompt.type === 'buy' && plot && plot.id !== BOOK) return false;
        if (prompt.type === 'build' && plot && plot.id !== BOOK) return false;
      }
      return ans;
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  const winner = state.players.find(p => p.team === state.winnerTeam);
  return {
    win: winner?.id === me.id ? 1 : 0,
    bankrupt: me.alive ? 0 : 1,
    assets: assetsOf(state, me),
    income,
    ownsBook: state.properties[BOOK].ownerId === me.id ? 1 : 0,
    // 配对键必须带 rot：同 (style,seed) 会坐 3 张椅子，那是三个观测，不是重跑。
    key: `${style}|${order.join('>')}|${rot}|${seed}`,
  };
}

const orders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

async function runArm(arm) {
  const rows = [];
  for (const style of STYLES) {
    for (const order of orders(style)) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        for (let rot = 0; rot < 3; rot++) {
          rows.push({ ...(await play({ style, seed, order, rot, arm, perShop: PER_SHOP })), styleId: style, rot, arm });
        }
      }
    }
  }
  assertObsUnique(rows, arm);
  return rows;
}

const control = await runArm('control');
const income = await runArm('income');
const noBook = await runArm('bookOnly');
const incomeNoBook = await runArm('incomeNoBook');

const arms = [
  ['照常打', control],
  [`经营进项 ${PER_SHOP}`, income],
  ['只押书屋（不经营）', noBook],
  [`只经营（进项 + 不抢书屋）`, incomeNoBook],
];

console.log(`每臂 n=${SEEDS * 2 * 3}（${SEEDS} seed × 2 排列 × 3 椅子轮换），争街，进项每店每天 ${PER_SHOP}。\n`);
console.log('臂                            grow    take   cross   合计    差距    破产            进项/局   持有书屋');
for (const [label, rows] of arms) {
  const w = STYLES.map(s => rate(rows.filter(r => r.styleId === s)));
  const spread = Math.max(...w) - Math.min(...w);
  console.log(`${label.padEnd(28)} ${w.map(x => pct(x)).join('  ')}  ${pct(rate(rows))}  ${(spread * 100).toFixed(1)}pp`
    + `  ${STYLES.map(s => pct(rate(rows.filter(r => r.styleId === s && r.bankrupt === 1)))).join('/').padEnd(16)}`
    + ` ${Math.round(mean(rows, r => r.income)).toString().padStart(6)}`
    + `   ${STYLES.map(s => pct(rate(rows.filter(r => r.styleId === s && r.ownsBook === 1)))).join('/')}`);
}

console.log('\n=== ① 座位差（同一臂在 3 把椅子上的胜率）===');
for (const [label, rows] of [arms[0], arms[1]]) {
  const per = [0, 1, 2].map(rot => rate(rows.filter(r => r.rot === rot)));
  console.log(`  ${label.padEnd(28)} ${per.map(x => pct(x)).join('  ')}   最大差 ${((Math.max(...per) - Math.min(...per)) * 100).toFixed(1)}pp`);
}

console.log('\n=== ② 是否只是「钱变多」：同 seed 配对 ===');
console.log(`  经营进项 − 照常打   ${fmtCI(paired(income, control))}`);
console.log(`  只经营   − 照常打   ${fmtCI(paired(incomeNoBook, control))}`);
console.log(`  只押书屋 − 照常打   ${fmtCI(paired(noBook, control))}`);

console.log('\n=== ③ 只经营这条路值不值得试（按起手）===');
for (const s of STYLES) {
  const a = incomeNoBook.filter(r => r.styleId === s);
  const b = control.filter(r => r.styleId === s);
  console.log(`  ${s.padEnd(6)} 只经营 ${pct(rate(a))} vs 照常 ${pct(rate(b))}  ${fmtCI(paired(a, b))}`);
}
