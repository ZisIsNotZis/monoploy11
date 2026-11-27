// #3342 先量再做：「停在自己的店旁」现在一分钱不收，改成「营业」会有多大、把平衡推到哪。
//
// 这个脚本不改引擎、不改产品字节 —— 它只在真实对局上记账，按候选公式**在牌桌上假如结算**。
//
// 上一版这里有个必须写下来的错：counterfactual 只把营业收入加给**人类座位**，另外两家不加，
// 于是「胜率」被我自己抬高了（first 版读到 grow 33.3%→66.7%）。三家都吃同一条规则，
// 所以必须三家都加，再比资产。这份文件是改正后的版本。
//
// 为什么量这个而不是拍脑袋
// ----------------------
// #3340 量过：45.2 回合/局，52.6% 的落点挨着某块地，其中 73% 挨的是**自己的地**，
// 而自己的地一分钱不收（flow.js 付租分支第一句 `if (owner?.team === p.team) … continue`）。
// 全游戏最频繁的一件事是零收益的 —— 这就是「没有第二种打法」的结构原因之一。
// 同一份还量到：加盖花 10,000、标价只 +4,000，所以「见加盖就加」是 −505 ~ −3,155。
// 投资的回报口子在 `收租`，而付租实测只有 4.31 次/局。
//
// 候选（都只读引擎原语 rentFor / 等级）：
//   A  rentFor × 0.5   跟着等级、同街加成、旺季一起变
//   B  基础租 × 0.5    只跟等级走（不受同街/旺季影响）
//   C  rentFor × 0.25
//   D  rentFor × 1.0   上界对照：一间店停一次就收一整份租
//
// 每局读 state.slice.history（三家都记），按**回合结束后**的盘面重算 rentFor。
// 这是近似：history 只有文字，没有当天盘面快照；等级与归属不会再变，但 closed/inflate
// 的倒计时可能已走掉一格，误差方向是**低估**（旺季已经过掉了）。这一点写在这里，
// 免得以后把「A = 20,150」当成精确值引用。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 40);
const STYLES = ['grow', 'take', 'cross'];
const RATES = { A: 0.5, B: 0.5, C: 0.25, D: 1.0 };
const baseRent = pr => (pr?.big ? 4_000 : 2_000 * Math.pow(2, Math.max(1, pr?.level ?? 1) - 1));
const ALGO = {
  A: (state, id) => Math.round(rentFor(state, id) * RATES.A),
  B: (_state, _id, pr) => Math.round(baseRent(pr) * RATES.B),
  C: (state, id) => Math.round(rentFor(state, id) * RATES.C),
  D: (state, id) => Math.round(rentFor(state, id) * RATES.D),
};

const row = () => ({ games: 0, ownStops: 0, rivalStops: 0, unownedStops: 0, A: 0, B: 0, C: 0, D: 0,
  rentEarned: 0, rentPaid: 0, salary: 0, money: 0, endAssets: 0 });
const all = row(), byStyle = Object.fromEntries(STYLES.map(s => [s, row()]));
const standings = Object.fromEntries(['current', 'A', 'B', 'C', 'D'].map(k =>
  [k, Object.fromEntries(STYLES.map(s => [s, { games: 0, seat0Wins: 0, distinguishable: 0 }]))]));
// 「两种打法会不会真的分开」：统计每局 营业收入榜 与 收租榜 的冠军是否不同。
let splitGames = 0, gamesSeen = 0;

for (const style of STYLES) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const state = startSession(createSliceConfig({ human: false, seed, style }));
    await runGame(state, { render() {}, async step() {}, async ask(p, s = state) { return aiAnswer(p, s); } });

    const taken = Object.fromEntries(state.players.map(p => [p.id, { A: 0, B: 0, C: 0, D: 0, own: 0, rival: 0 }]));
    for (const turn of state.slice.history) {
      const player = state.players.find(p => p.id === turn.playerId);
      if (!player) continue;
      for (const line of turn.lines) {
        const m = / 停在 .*?，旁边是 (.+)$/.exec(line);
        if (!m) continue;
        for (const name of m[1].split('、')) {
          const plot = state.map.plots.find(p => p.name === name);
          if (!plot) continue;
          const pr = state.properties[plot.id];
          const owner = state.players.find(p => p.id === pr?.ownerId);
          const bucket = owner?.id === player.id ? 'own' : owner ? 'rival' : 'unowned';
          const target = bucket === 'own' ? taken[player.id] : null;
          if (target) {
            target.own += 1;
            for (const k of Object.keys(ALGO)) target[k] += ALGO[k](state, plot.id, pr);
          } else if (bucket === 'rival') taken[player.id].rival += 1;
        }
      }
    }

    for (const p of state.players) {
      const t = taken[p.id];
      for (const r of [all, byStyle[p.style]]) {
        r.games++; r.ownStops += t.own; r.rivalStops += t.rival;
        for (const k of Object.keys(ALGO)) r[k] += t[k];
        r.rentEarned += p.sliceStats.rentEarned; r.rentPaid += p.sliceStats.rentPaid;
        r.endAssets += assetsOf(state, p);
      }
    }
    for (const line of state.log) {
      const s = /经过起点 \+(\d+)/.exec(line.text); if (s) all.salary += +s[1];
      const k = /在零工获得 (\d+)/.exec(line.text); if (k) all.money += +k[1];
    }

    // 排名：现行 vs 四条候选，三家都加自己那份。
    const base = Object.fromEntries(state.players.map(p => [p.id, assetsOf(state, p)]));
    for (const key of ['current', 'A', 'B', 'C', 'D']) {
      const board = state.players.map(p => ({ p, v: base[p.id] + (key === 'current' ? 0 : taken[p.id][key]) }));
      board.sort((x, y) => y.v - x.v);
      const win = board[0];
      const cell = standings[key][style];
      cell.games++;
      if (state.players[0] === win.p) cell.seat0Wins++;
      const byTrade = [...state.players].sort((x, y) => taken[y.id].A - taken[x.id].A)[0];
      const byRent = [...state.players].sort((x, y) => y.sliceStats.rentEarned - x.sliceStats.rentEarned)[0];
      if (byTrade !== byRent) cell.distinguishable++;
      if (key === 'A') { gamesSeen++; if (byTrade !== byRent) splitGames++; }
    }
  }
}

const per = (r, k) => +(r[k] / Math.max(1, r.games)).toFixed(1);
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);
const show = r => ({
  局数: r.games,
  自家停留_每人每局: per(r, 'ownStops'),
  对手店停留_每人每局: per(r, 'rivalStops'),
  营业A_每人每局: per(r, 'A'), 营业B: per(r, 'B'), 营业C: per(r, 'C'), 营业D: per(r, 'D'),
  收租_每人每局: per(r, 'rentEarned'),
  付租_每人每局: per(r, 'rentPaid'),
  终局资产_每人: Math.round(r.endAssets / Math.max(1, r.games)),
});
console.log(JSON.stringify({
  说明: '三家都按同一条候选规则加自己那份营业收入，再比终局资产；seat0 = 0 号位。',
  全场: show(all),
  收入结构_全场每局: { 工资: Math.round(all.salary / all.games), 零工: Math.round(all.money / all.games) },
  按起手: Object.fromEntries(STYLES.map(s => [s, show(byStyle[s])])),
  '0号位胜率': Object.fromEntries(Object.entries(standings).map(([k, v]) =>
    [k, Object.fromEntries(Object.entries(v).map(([s, c]) => [s, pct(c.seat0Wins, c.games)]))])),
  两种打法分开的局: `${pct(splitGames, gamesSeen)}%（营业冠军 ≠ 收租冠军）`,
}, null, 1));
