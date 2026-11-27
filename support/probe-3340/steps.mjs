// #3340 探针 19：**同一个决定的干净配对** —— 定步选几步。
//
// 为什么单挑这个决定：
//   · 三条起手的手牌都含定步（slice.js 的 hand），所以人人都会遇到这一屏。
//   · 卡面写着「1–6 步各自落到哪，点开就列出来」，而**引擎自己的 AI 永远答 6**
//     （ai.js:99 `case 'steps': return 6;`）—— 也就是说这个「选」在实际对局里从没被真正选过。
//   · 前几轮量到：53% 的落点挨着地，其中 73% 是自己的地（不收租）；收租 7,660/局、付租 7,395/局，
//     租金几乎是零和。真正稳定的进项是现金格：工资 5,000 + 金钱格 6,383。
//
// 所以这一轮只改**这一屏的答案**，其余（出牌、买地、加盖、方向）全部交给同一套 AI：
//   base  照 AI（steps = 6）
//   value 按落点价值选点数：无主可买地 > 现金格 > 躲开对手收租 > 医院/监狱
// 若 value 臂有正读数，那「定步」就是一个真的第二打法，而且屏上只要把价值写出来就够。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';
import { reachableLandings, landingInfo } from '../../src/engine/insight.js';

const SEEDS = Number(process.argv[2] ?? 60);

function valueOf(state, p, nodeId) {
  const info = landingInfo(state, p, nodeId);
  let v = 0;
  if (info.label === '发薪处') v += 4000;          // 停在起点：+4,000（flow.js:299 是经过，停在这里另有 4,000）
  if (info.label === '零工') v += 2000;            // 金钱格 1,000–3,000，取中
  if (info.facility) v -= 8000;                     // 医院/监狱：丢两回合
  v -= info.risk * 0.6;                             // 要付给对手的租（按每次实收打折：不是每次都会收）
  // 无主、已开售的地：走过去能按标价买下（资产换手，租金纯上行）
  v += info.plots.filter(x => !x.owner && state.day >= x.availableFromDay).length * 1500;
  return v;
}

function bestSteps(state, p) {
  let best = { n: 6, v: -Infinity };
  for (let n = 1; n <= 6; n++) {
    const lands = reachableLandings(state, p, n);
    if (!lands.length) continue;
    // 同一格可能有多条路，取最好的那条
    const v = Math.max(...lands.map(id => valueOf(state, p, id)));
    if (v > best.v) best = { n, v };
  }
  return best;
}

async function play(style, seed, arm) {
  const state = startSession(createSliceConfig({ human: true, seed, style }));
  const f = { stepsAsked: 0, choseOther: 0, chosen: {} };
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (prompt.player?.controller !== 'human') return aiAnswer(prompt, state);
      const p = prompt.player;
      // slice 里定步走 diceChoiceFlow → prompt.type === 'diceValue'（min 1 / max 6），
      // 不是 'steps'（'steps' 只在完整模式的超级骰子上出现）。
      if (prompt.type === 'diceValue' || prompt.type === 'steps') {
        f.stepsAsked++;
        const b = bestSteps(state, p);
        if (arm === 'value' && b.n !== 6) { f.choseOther++; f.chosen[b.n] = (f.chosen[b.n] ?? 0) + 1; return b.n; }
        return 6;                                    // AI 口径
      }
      return aiAnswer(prompt, state);
    },
  });
  const p = state.players.find(q => q.controller === 'human');
  return { assets: assetsOf(state, p), win: p.team === state.winnerTeam, ...f,
    cash: p.cash, rentEarned: p.sliceStats.rentEarned, rentPaid: p.sliceStats.rentPaid };
}

const cmp = (rows, arm) => {
  const d = rows.map(r => r[arm].assets - r.base.assets);
  const onlyArm = rows.filter(r => r[arm].win && !r.base.win).length;
  const onlyBase = rows.filter(r => !r[arm].win && r.base.win).length;
  return {
    n: rows.length,
    stepsAskedMean: +(rows.reduce((s, r) => s + r[arm].stepsAsked, 0) / rows.length).toFixed(1),
    gamesWhereChoiceDiffered: rows.filter(r => r[arm].choseOther > 0).length,
    won: rows.filter(r => r[arm].win).length, baseWon: rows.filter(r => r.base.win).length,
    dAssetsMean: Math.round(d.reduce((a, b) => a + b, 0) / d.length),
    better: d.filter(x => x > 0).length, worse: d.filter(x => x < 0).length,
    cashMean: Math.round(rows.reduce((s, r) => s + r[arm].cash, 0) / rows.length),
    baseCashMean: Math.round(rows.reduce((s, r) => s + r.base.cash, 0) / rows.length),
    rentEarnedMean: Math.round(rows.reduce((s, r) => s + r[arm].rentEarned, 0) / rows.length),
    baseRentEarnedMean: Math.round(rows.reduce((s, r) => s + r.base.rentEarned, 0) / rows.length),
    mcnemar: { onlyArm, onlyBase, chi2: +(((Math.abs(onlyArm - onlyBase) - 1) ** 2) / Math.max(1, onlyArm + onlyBase)).toFixed(2) },
  };
};

const out = {};
for (const style of ['grow', 'take', 'cross']) {
  const rows = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const base = await play(style, seed, 'none');
    const value = await play(style, seed, 'value');
    rows.push({ seed, base, value });
  }
  out[style] = { baseWin: rows.filter(r => r.base.win).length, value: cmp(rows, 'value') };
}
console.log(JSON.stringify(out, null, 1));
