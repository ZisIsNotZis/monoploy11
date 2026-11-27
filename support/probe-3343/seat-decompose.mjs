// #3343 追座位偏差的**来源**，而不是它的数值。
//
// #3342 交出的读数：争街开局下 0 号位胜率 31.7% → 44.4%，grow 28.3% → 55.0%。
// 交付文档把它写成「先手在争街布局里更值钱」。但那个结论**没有被分开量过**：
// 在 initializeSlice 里，玩家下标同时决定三件事 ——
//   ① 行动顺序（state.order = players 顺序；state.turn 从 0 起，所以 0 号位每回合先动）
//   ② 起始位置/朝向（starts[i] 的 position、facing）
//   ③ 起始那两间店（starts[i] 的 ids）
// 于是「先手更值钱」「0 号位那两间更好」「0 号位起跑线更近」在 #3342 的读数里是同一件事。
//
// 这个脚本只旋转**一项**，其余固定：
//   base      交付原样
//   order+k   只旋转 state.order（谁先动变了；座位的店、位置、起手全不动）
//   own+k     只旋转「谁拥有哪两间」（顺序、位置不动）
//   pos+k     只旋转「起点/朝向」（顺序、所有权不动）
//   seat+k    把整个座位内容（起手、手牌、现金、店、位置）整体对调
//             —— 这才是「换一把椅子坐」；若它与 base 差不多，
//                说明这个布局对「谁坐 0 号位」大体中立。
//
// 判据：若 order+k 就把 0 号位胜率打回另一端，偏差是先手；
//       若 own+k 才打回去，偏差是 STARTS_CONTESTED 这张表本身不对称；
//       若只有 pos+k 打回去，偏差在起跑线。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const SEEDS = Number(process.argv[2] ?? 60);
const STYLES = ['grow', 'take', 'cross'];
const pct = (w, n) => +((100 * w) / Math.max(1, n)).toFixed(1);

// 座位内容 = 引擎初始化之后，这个人身上所有「属于这把椅子」的东西。
const SEAT_FIELDS = ['style', 'cards', 'cash', 'position', 'facing', 'properties'];

function rotateOrder(state, k) {
  const n = state.order.length;
  state.order = state.order.map((_, i) => state.order[(i + k) % n]);
}

function rotateOwnership(state, k) {
  const owned = state.players.map(p => [...p.properties]);
  for (const pr of Object.values(state.properties)) pr.ownerId = null;
  state.players.forEach((p, i) => {
    p.properties = [...owned[(i + k) % 3]];
    for (const id of p.properties) state.properties[id].ownerId = p.id;
  });
}

function rotatePosition(state, k) {
  const pose = state.players.map(p => ({ position: p.position, facing: p.facing }));
  state.players.forEach((p, i) => {
    const src = pose[(i + k) % 3];
    p.position = src.position; p.facing = src.facing; p.lastNode = null;
  });
}

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

function applyArm(state, arm) {
  if (arm === 'base') return;
  const k = Number(arm.slice(-1));
  if (!Number.isInteger(k) || k < 1 || k > 2) throw new Error(`bad arm ${arm}`);
  if (arm.startsWith('order+')) rotateOrder(state, k);
  else if (arm.startsWith('own+')) rotateOwnership(state, k);
  else if (arm.startsWith('pos+')) rotatePosition(state, k);
  else if (arm.startsWith('seat+')) rotateSeat(state, k);
  else throw new Error(`unknown arm ${arm}`);
}

// 结构读数：每条街的两间各归谁；以及每家「补齐自家街」是免费还是要收购。
function structure(state) {
  const byStreet = new Map();
  for (const pl of state.map.plots) {
    if (pl.big) continue;
    if (!byStreet.has(pl.street)) byStreet.set(pl.street, []);
    byStreet.get(pl.street).push(pl.id);
  }
  return [...byStreet].map(([street, ids]) =>
    `${street}:${ids.map(id => (state.players.find(p => p.id === state.properties[id].ownerId)?.id ?? '空').replace('p', '')).join('/')}`);
}

function halfStatus(state, p) {
  const mine = new Set(p.properties);
  const streets = new Set([...mine].map(id => state.properties[id]?.street).filter(Boolean));
  return [...streets].map(street => {
    const others = state.map.plots.filter(pl => !pl.big && pl.street === street && !mine.has(pl.id));
    if (!others.length) return `${street}=独占`;
    return `${street}=${others.some(pl => state.properties[pl.id]?.ownerId) ? '打对手' : '免费补'}`;
  });
}

const ARMS = ['base', 'order+1', 'order+2', 'own+1', 'own+2', 'pos+1', 'pos+2', 'seat+1', 'seat+2'];

for (const contested of [true, false]) {
  console.log(`\n=== 争街=${contested} ===`);
  for (const arm of ARMS) {
    const byStyle = Object.fromEntries(STYLES.map(s => [s, { g: 0, w: 0 }]));
    let games = 0, seat0Wins = 0, seat0Rent = 0;
    let firstRows = null, firstHalves = null;
    for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
      const st = startSession(createSliceConfig({ human: false, seed, style, sliceContestedStreets: contested }));
      applyArm(st, arm);
      if (!firstRows && style === 'grow' && seed === 1) {
        firstRows = structure(st);
        firstHalves = st.players.map(p => `${p.id}: ${halfStatus(st, p).join(' ')}`);
      }
      await runGame(st, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, st); } });
      const winner = st.players.find(p => p.team === st.winnerTeam);
      games++; seat0Wins += winner === st.players[0] ? 1 : 0;
      byStyle[style].g++; byStyle[style].w += winner === st.players[0] ? 1 : 0;
      seat0Rent += st.players[0].sliceStats.rentEarned;
    }
    console.log(JSON.stringify({
      臂: arm, 局数: games, '0号位胜率': pct(seat0Wins, games),
      '0号位按起手grow/take/cross': STYLES.map(s => pct(byStyle[s].w, byStyle[s].g)),
      '0号位每局收租': Math.round(seat0Rent / games),
    }));
    if (firstRows) {
      console.log('  街: ' + firstRows.join(' | '));
      for (const h of firstHalves) console.log('  ' + h);
    }
  }
}
