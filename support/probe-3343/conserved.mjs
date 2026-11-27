// #3343：守恒版开局表 —— 每人恰好 2 间，只改「这 2 间怎么摆」。
//
// ⚠ 上一版这里有个**我自己的**错，写下来免得重犯：
//   freeBoth 写成 PAIRS[(i + 3) % 3][1]，而 (i+3)%3 === i —— 对 6 条街的表取 mod 3，
//   于是 freeBoth 与 whole 是**同一张表**。输出的两行逐位相同不是「发现」，
//   是我的下标写错了。修法是 % 6。
//
// 守恒：6 条街 × 2 间 = 12 间；三家各 2 间 = 6 间归玩家，其余 6 间按表要么无主要么对手占。
// 只改三件事：
//   ① 两间是否同街（同街 = 开局就吃满 ×1.4，即 #3342 说的「计划在 t=0 就做完了」）
//   ② 每条街的另一半是谁：自己独占 / 对手（须 125% 收购）/ 空（8,000 买）
//   ③ 三家拿到的是不是同一类（对称）
//
// 判据：seat+k 三臂的**均值与极差**。单臂在 20-40pp 上摆（symmetric.mjs 量到），
// 所以一个表只有在三臂极差小时才算中立；否则均值本身就是座位噪声的函数。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 40);
const STYLES = ['grow', 'take', 'cross'];
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

const PAIRS = [['3,1', '4,1'], ['8,1', '9,1'], ['3,9', '4,9'], ['8,9', '9,9'], ['1,3', '1,4'], ['11,6', '11,7']];
const POSES = [['3,2', '4,2'], ['8,2', '7,2'], ['3,5', '4,5']];

const ARMS = {
  // 默认：每人整条街两间（开局 ×1.4 已满），与 initializeSlice 的 WHOLE_STREET 同构。
  whole: i => [PAIRS[i][0], PAIRS[i][1]],
  // 两间分在两条街，且两间的另一半都空着（谁先到谁 8,000 买）。
  freeBoth: i => [PAIRS[i][0], PAIRS[(i + 3) % 6][1]],
  // 对称争街：一条街 1 对 1（自己一间 + 对手一间），另一条街自己一间 + 另一半空着。
  mix: i => [PAIRS[i][0], PAIRS[(i + 1) % 3][1]],
  mixFar: i => [PAIRS[i][0], PAIRS[(i + 2) % 3][1]],
  // 每人都「两条街都 1 对 1」（无空地可补）——symA 那一类，作上界对照。
  allRival: i => [PAIRS[i][0], PAIRS[(i + 1) % 3][1]],
};

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

// 表只给「第 i 号位拥有哪 2 间」。对手占的那一半必须由另一个玩家持有 ——
// 所以在装载后检查：每条街的第 1 间若被 i 号位以外的人持有，就算「打对手」。
function layout(state, name) {
  const fn = ARMS[name];
  for (const pr of Object.values(state.properties)) pr.ownerId = null;
  state.players.forEach((p, i) => {
    p.properties = [];
    const [pos, facing] = POSES[i];
    p.position = pos; p.facing = facing; p.lastNode = null;
    for (const id of fn(i)) { state.properties[id].ownerId = p.id; p.properties.push(id); }
  });
}

function kind(state, p) {
  const mine = new Set(p.properties);
  const streets = new Set([...mine].map(id => state.properties[id]?.street).filter(Boolean));
  return [...streets].sort().map(street => {
    const others = state.map.plots.filter(pl => !pl.big && pl.street === street && !mine.has(pl.id));
    if (!others.length) return `${street}=独占`;
    return `${street}=${others.some(pl => state.properties[pl.id]?.ownerId) ? '打对手' : '免费补'}`;
  }).join(' ');
}

for (const name of Object.keys(ARMS)) {
  let firstRows = null;
  const arms = [];
  for (const k of [0, 1, 2]) {
    let games = 0, seat0Wins = 0, paid = 0, rentAll = 0, takeover = 0, assets = 0, shops = 0;
    for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
      const st = startSession(createSliceConfig({ human: false, seed, style }));
      layout(st, name);
      if (k) rotateSeat(st, k);
      if (!firstRows && style === 'grow' && seed === 1) firstRows = st.players.map(p => `${p.id}: ${kind(st, p)}`);
      games++;
      await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
      const winner = st.players.find(p => p.team === st.winnerTeam);
      seat0Wins += winner === st.players[0] ? 1 : 0;
      for (const line of st.log) if (/实付租金 [1-9]/.test(line.text)) paid++;
      for (const p of st.players) {
        rentAll += p.sliceStats.rentEarned; takeover += p.sliceStats.takeovers;
        assets += assetsOf(st, p); shops += p.properties.length;
      }
    }
    arms.push({ k, seat0: pct(seat0Wins, games), rent: Math.round(rentAll / (games * 3)), paid: +(paid / games).toFixed(2), shops: +(shops / (games * 3)).toFixed(2) });
  }
  console.log(JSON.stringify({
    表: name,
    '三臂0号位': arms.map(a => `${a.seat0}@k${a.k}`),
    '均值': +(arms.reduce((s, a) => s + a.seat0, 0) / 3).toFixed(1),
    '极差': +(Math.max(...arms.map(a => a.seat0)) - Math.min(...arms.map(a => a.seat0))).toFixed(1),
    '每家收租': arms.map(a => a.rent),
    '每局真付租': arms.map(a => a.paid),
    '每家店数': arms.map(a => a.shops),
  }));
  for (const r of firstRows ?? []) console.log('  ' + r);
}
