// #3342：争街布局的几种排法，哪一种不把三条起手的差距拉爆？
//
// 上一版我随手把「第 i 条街的第 0 间 + 第 i+3 条街的第 1 间」分给 i 号玩家，
// 量到 grow 54.4 / take 20.0 / cross 25.6 —— 差距 34.4 个百分点，而 #3331 刚把它收到 13.7。
// 但那可能是**我的排法**不中立（有的起手第二间店离起点很远），不是「争街」这件事本身。
// 所以这里把几种排法都量一遍，看差距是布局的必然还是我挑的那一种的偶然。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 20);
const STYLES = ['grow', 'take', 'cross'];
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

// 六条街，按 makeMap 的顺序。每条街两间店 [A, B]。
const S = [
  ['3,1', '4,1'],   // 0 晨光街 北-左
  ['8,1', '9,1'],   // 1 晚风街 北-右
  ['3,9', '4,9'],   // 2 灯火街 南-左
  ['8,9', '9,9'],   // 3 月色街 南-右
  ['1,3', '1,4'],   // 4 西巷   西
  ['11,6', '11,7'], // 5 东巷   东
];
// 每种排法给出 3 个玩家各自的两间店。
const LAYOUTS = {
  // 现状：每人整条街（对照）
  whole: [[S[0][0], S[0][1]], [S[1][0], S[1][1]], [S[2][0], S[2][1]]],
  // 对角：每人拿「自家街第一间 + 正对面那条街第二间」。南北、早晚、东西各配一对。
  diagonal: [[S[0][0], S[3][1]], [S[1][0], S[2][1]], [S[2][0], S[1][1]]],
  // 邻接：每人拿「自家街第一间 + 相邻街第二间」，让两间店在地图上彼此靠近。
  neighbor: [[S[0][0], S[4][1]], [S[1][0], S[5][0]], [S[2][0], S[4][0]]],
  // 同街争两间：每人各拿三条街的「第一间」，另三条街的第二间全无主。
  // 于是每条街都是「一人 + 一间可买」，凑街只要买一间 —— 最直接的「补齐一条街」。
  half: [[S[0][0], S[1][0], S[2][0]], [S[3][0], S[4][0], S[5][0]]],
};

for (const [name, spec] of Object.entries(LAYOUTS)) {
  const cell = Object.fromEntries(STYLES.map(s => [s, { games: 0, wins: 0 }]));
  let rentSum = 0, paid = 0, games = 0, buys = 0, takeovers = 0;
  for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
    const config = createSliceConfig({ human: false, seed, style });
    const state = startSession(config);
    for (const pr of Object.values(state.properties)) pr.ownerId = null;
    for (const p of state.players) p.properties = [];
    state.players.forEach((p, i) => {
      const list = name === 'half' ? spec[i % spec.length] : spec[i];
      for (const id of list) { state.properties[id].ownerId = p.id; p.properties.push(id); }
    });
    games++;
    await runGame(state, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, state); } });
    const winner = state.players.find(p => p.team === state.winnerTeam);
    for (const p of state.players) {
      cell[p.style].games++; cell[p.style].wins += p === winner ? 1 : 0;
      rentSum += p.sliceStats.rentEarned; takeovers += p.sliceStats.takeovers;
    }
    for (const line of state.log) {
      if (/实付租金 [1-9]/.test(line.text)) paid++;
      if (/ 买下 /.test(line.text)) buys++;
    }
  }
  const rates = STYLES.map(s => pct(cell[s].wins, cell[s].games));
  console.log(JSON.stringify({
    布局: name, 每格局数: SEEDS * 2,
    起手胜率: Object.fromEntries(STYLES.map((s, i) => [s, rates[i]])),
    最大差距: Math.max(...rates) - Math.min(...rates),
    每家收租: Math.round(rentSum / (games * 3)),
    每局真付租: +(paid / games).toFixed(2),
    每局买地: +(buys / games).toFixed(2),
    每局收购: +(takeovers / games).toFixed(2),
    持店数: Object.fromEntries(SPEC_LENGTHS(name, spec)),
  }));
}
function SPEC_LENGTHS(name, spec) { return STYLES.map((s, i) => [s, (name === 'half' ? spec[i % spec.length] : spec[i]).length]); }
