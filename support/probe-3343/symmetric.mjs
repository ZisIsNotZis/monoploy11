// #3343：争街表的**对称性**，而不是座位。
//
// #3343 已经量出（seat-decompose.mjs，180 局/臂）：
//   交付版 STARTS_CONTESTED 里，0 号位两条街都是「免费补」（另一半无主，8,000 就拿），
//   1/2 号位两条街都是「打对手」（另一半被对手占着，要 125% 收购且对手在场）。
//   只旋转所有权：own+2 → 0 号位胜率 18.9%（base 44.4%）。差值得 25pp 全在这一张表里。
//   AI 侧（slice-ai.js landingScore）**根本不认得「补齐自家街」**，只给空地 +5 分 ——
//   所以这不是策略差，是**规则难度差**：同一个座位，一边掏钱，一边谈判。
//
// 这里造几张候选表，判据是「换座位（seat+k）后 0 号位胜率还剩多少摆动」，
// 而不是「0 号位胜率是多少」——后者对一个不中立的座位量具没有意义。
//
//   symA  每人「一条免费补 + 一条打对手」，三条免费补街交错成环。
//   symB  A 的旋转版但两间店都在自己免费补街的**第一间**（测试是否只看半条街）。
//   base  交付版，作对照。
//
// 免费补街环：p1→晨光, p2→晚风, p3→灯火（自家那间已在），另一半空。
//   于是「谁拥有哪条街」按 i 走，而「哪条街的另一半空着」也按 i 走 —— 两者同步，没有偏向。
import { createSliceConfig, SLICE_MAP } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const SEEDS = Number(process.argv[2] ?? 60);
const STYLES = ['grow', 'take', 'cross'];
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

const PAIRS = [['3,1', '4,1'], ['8,1', '9,1'], ['3,9', '4,9'], ['8,9', '9,9'], ['1,3', '1,4'], ['11,6', '11,7']];
const POSES = [['3,2', '4,2'], ['8,2', '7,2'], ['3,5', '4,5']];

const TABLES = {
  // 交付版：i 拿「街 i 的第 0 间」+「街 i+3 的第 1 间」⇒ p1 两条街的另一半都空着。
  base: [[0, 0, 3, 1], [1, 0, 2, 1], [2, 0, 1, 1]],
  // symA：i 拿「街 i 的第 0 间」+「街 i+3 的第 0 间」。
  //   街 i 的另一半 = 街 i 的第 1 间 → 归谁？归 (i-3) 号位拿到的「第 0+3 的第 0 间」……
  //   不，第二间是谁都不拿；每人的第二条街（i+3）第 0 间被拿，第 1 间空着。
  //   ⇒ 每人一条街（i）另一半被谁占？街 i 的第 1 间没人拿 ⇒ 空。两条街都空 —— 失败。
  //   所以对称表必须让「被占」和「空着」按 i 轮换。见 symA 的真实构造：
  //   i 拿街 i 的第 0 间，以及街 (i+1)%3 的第 1 间 —— 于是街 i 第 1 间归 i-1 号位（被占），
  //   街 (i+1)%3 第 0 间无人。每条街恰好：第 0 间归 i，第 1 间归 i-1，1 对 1，无空地。
  symA: [[0, 0, 1, 1], [1, 0, 2, 1], [2, 0, 0, 1]],
};

function applyTable(state, name) {
  const rows = TABLES[name];
  for (const pr of Object.values(state.properties)) pr.ownerId = null;
  state.players.forEach((p, i) => {
    p.properties = [];
    const [sa, ia, sb, ib] = rows[i];
    const ids = [PAIRS[sa][ia], PAIRS[sb][ib]];
    const [pos, facing] = POSES[i];
    p.position = pos; p.facing = facing; p.lastNode = null;
    for (const id of ids) { state.properties[id].ownerId = p.id; p.properties.push(id); }
  });
}

const SEAT_FIELDS = ['style', 'cards', 'cash', 'position', 'facing', 'properties'];
function rotateSeat(state, k) {
  const snap = state.players.map(p => {
    const o = {};
    for (const f of SEAT_FIELDS) o[f] = Array.isArray(p[f]) ? [...p[f]] : p[f];
    return o;
  });
  for (const pr of Object.values(state.properties)) pr.ownerId = null;
  state.players.forEach((p, i) => {
    const src = snap[(i + k) % 3];
    for (const f of SEAT_FIELDS) p[f] = Array.isArray(src[f]) ? [...src[f]] : src[f];
    p.lastNode = null;
    for (const id of p.properties) state.properties[id].ownerId = p.id;
  });
}

function halves(state, p) {
  const mine = new Set(p.properties);
  const streets = new Set([...mine].map(id => state.properties[id]?.street).filter(Boolean));
  return [...streets].map(street => {
    const others = state.map.plots.filter(pl => !pl.big && pl.street === street && !mine.has(pl.id));
    if (!others.length) return `${street}:独占`;
    return `${street}:${others.some(pl => state.properties[pl.id]?.ownerId) ? '打对手' : '免费补'}`;
  });
}

for (const name of ['base', 'symA']) {
  for (const arm of ['seat+0', 'seat+1', 'seat+2']) {
    const k = Number(arm.slice(-1));
    const byStyle = Object.fromEntries(STYLES.map(s => [s, { g: 0, w: 0, rent: 0 }]));
    let games = 0, seat0Wins = 0, firstRows = null;
    for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
      const st = startSession(createSliceConfig({ human: false, seed, style }));
      applyTable(st, name);
      if (k) rotateSeat(st, k);
      if (!firstRows && style === 'grow' && seed === 1) {
        firstRows = st.players.map(p => `${p.id}: ${halves(st, p).join(' ')}`);
      }
      await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
      const winner = st.players.find(p => p.team === st.winnerTeam);
      games++; seat0Wins += winner === st.players[0] ? 1 : 0;
      byStyle[style].g++; byStyle[style].w += winner === st.players[0] ? 1 : 0;
      byStyle[style].rent += st.players[0].sliceStats.rentEarned;
    }
    console.log(JSON.stringify({
      表: name, 臂: arm, '0号位胜率': pct(seat0Wins, games),
      '0号位按起手': STYLES.map(s => pct(byStyle[s].w, byStyle[s].g)),
      '0号位每局收租': Math.round(byStyle.grow.rent / games * 1),
    }));
    if (firstRows) for (const r of firstRows) console.log('  ' + r);
  }
}
