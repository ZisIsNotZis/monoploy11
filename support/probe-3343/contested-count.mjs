// #3343：争街的**密度**，而不是谁坐哪。
//
// 前两步已经把问题指到规则难度，而不是座位（见 support/probe-3343/seat-decompose.mjs
// 与 symmetric.mjs）。这一支只做一件最小的事：**不换座位、只换表**，
// 让「几条街是 1 对 1」从 0 走到 3，其余街保持整条归一个人。
//
// 判据：收租池（每家每局收租）与「每局真付租」随密度怎么走。
//   若密度 1 与 2 都还在默认附近，而 3 掉下去 ⇒ 2 是上限，争街要留在**少数街道**上。
//   若密度 1 就开始掉 ⇒ 争街本身在这个经济体里是负收益，「补齐一条街」不成立。
//
// 所有臂都用手写所有权，不动 initializeSlice、不动产品字节。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 40);
const STYLES = ['grow', 'take', 'cross'];
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

const PAIRS = [['3,1', '4,1'], ['8,1', '9,1'], ['3,9', '4,9'], ['8,9', '9,9'], ['1,3', '1,4'], ['11,6', '11,7']];
const POSES = [['3,2', '4,2'], ['8,2', '7,2'], ['3,5', '4,5']];

// spec[d][i] = 第 d 号位在第 i 条街上拿到哪个下标，或 null（不拿）。
// 街数 n 时，前 n 条街是争街（i 号位拿 [0]，i-1 号位拿 [1]），其余整条归 i。
function ownership(density, i) {
  const own = [];
  for (let s = 0; s < 6; s++) {
    if (s < density) {
      // 争街：每条街两间，分给 s 与 (s+1)%3 —— 每条街恰好两个人各一间。
      const who = [s % 3, (s + 1) % 3];
      if (who[0] === i) own.push(PAIRS[s][0]);
      else if (who[1] === i) own.push(PAIRS[s][1]);
    } else {
      // 整条街：给 i，但只有在 density<=3 时街号 s 才对应到人，避免超配
      if (s % 3 === i) { own.push(PAIRS[s][0]); own.push(PAIRS[s][1]); }
    }
  }
  return own;
}

for (const density of [0, 1, 2, 3]) {
  const byStyle = Object.fromEntries(STYLES.map(s => [s, { g: 0, w: 0, rent: 0, half: 0, buy: 0 }]));
  let games = 0, paid = 0, rentAll = 0, takeover = 0, assets = 0;
  let firstRows = null;
  for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
    const st = startSession(createSliceConfig({ human: false, seed, style }));
    for (const pr of Object.values(st.properties)) pr.ownerId = null;
    st.players.forEach((p, i) => {
      p.properties = [];
      const [pos, facing] = POSES[i];
      p.position = pos; p.facing = facing; p.lastNode = null;
      for (const id of ownership(density, i)) { st.properties[id].ownerId = p.id; p.properties.push(id); }
    });
    if (!firstRows) firstRows = st.players.map(p => `p${i(p)}: ${p.properties.join(' ')}`);
    games++;
    await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
    const winner = st.players.find(p => p.team === st.winnerTeam);
    for (const line of st.log) if (/实付租金 [1-9]/.test(line.text)) paid++;
    for (const p of st.players) {
      const c = byStyle[p.style];
      c.g++; c.w += p === winner ? 1 : 0;
      c.rent += p.sliceStats.rentEarned; rentAll += p.sliceStats.rentEarned;
      takeover += p.sliceStats.takeovers; assets += assetsOf(st, p);
    }
  }
  const rates = STYLES.map(s => pct(byStyle[s].w, byStyle[s].g));
  console.log(JSON.stringify({
    争街条数: density, 局数: games,
    起手胜率: Object.fromEntries(STYLES.map((s, i) => [s, rates[i]])),
    最大差距: +(Math.max(...rates) - Math.min(...rates)).toFixed(1),
    每家收租: Math.round(rentAll / (games * 3)),
    每局真付租: +(paid / games).toFixed(2),
    每局收购: +(takeover / games).toFixed(2),
    终局资产: Math.round(assets / (games * 3)),
  }));
  if (firstRows) for (const r of firstRows) console.log('  ' + r);
}

function i(p) { return p.id.slice(1); }
