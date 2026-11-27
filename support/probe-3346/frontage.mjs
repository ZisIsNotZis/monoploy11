// #3346：最后一块没量过的结构旋钮 —— **收租面（相邻格数）**。
//
// 到这一步已经排除掉的解释（都有证据，不要重测）：
//   · 调价钱：小店降到 2,500，补街−不花 仍 ≤ +6.7pp，起手差距反而 26.7pp（price.mjs）
//   · 调书屋：涨价会把它从局里抹掉；降租也不改变「只有它值得买」（bookhouse.mjs）
//   · 调收购溢价：降到 1.00 时收购真发生了（3.08 次/局），但 take 胜率 **跌到 21.7%**、
//     破产 21.7%（premium-sweep 第二轮）⇒ 收购是负期望，不是被 AI 低估
//   · 换 AI 偏好：只改 p.style 就能造出 30pp 差距（style-only.mjs）
//
// 剩下的唯一结构差：**一块地整局能被踩到几次**。
//   43 个格 × 16 天 × 3 人 ≈ 48 次落点 ⇒ 每个格平均 1.1 次。
//   普通小店贴 1 个格 → 整局约收 1.1 次租（租金 2,800 ⇒ 约 3,000）
//   书屋贴 8 个格 → 整局约收 8.8 次租
// 这一支把这个数直接改掉：把小店挪到「贴着更多路格」的位置，看补街能不能站住。
// 只动探针里 clone 出来的地图（SLICE_MAP.plots[].cells / nodes[].adjacentPlots），
// 跑完还原并断言逐位相同。
//
// 走的一端：**给每条街的两个小店各加一个相邻格**（把 plot 的 cells 从 1 格扩成 2 格）。
// 为什么用「扩 cells」而不是搬家：搬家会改地块 id 与测试断言的地名，
// 扩 cells 只改「谁贴着谁」，是最小的一处改动。
//
// 用法：node support/probe-3346/frontage.mjs [30]
import { SLICE_MAP, SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 30);
const DECISION_LIMIT = 5000;
const STYLES = ['grow', 'take', 'cross'];
const BASELINES = {
  60: { grow: 48.3, take: 41.7, cross: 48.3 },
};
const BASELINE = BASELINES[SEEDS * 2];
if (!BASELINE) throw new Error(`没有 n=${SEEDS * 2} 的基线`);

const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = (xs, k) => xs.reduce((a, r) => a + (r[k] ?? 0), 0) / xs.length;
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

const pristine = JSON.stringify({ plots: SLICE_MAP.plots, nodes: SLICE_MAP.nodes });

// 给每个小店多贴一个相邻路格：找一条还没贴着它的路格，把它加进该路格的 adjacentPlots。
function widenShops() {
  const nodeIds = SLICE_MAP.nodes.map(n => n.id);
  let added = 0;
  for (const plot of SLICE_MAP.plots) {
    if (plot.big) continue;
    const front = SLICE_MAP.nodes.filter(n => n.adjacentPlots?.includes(plot.id)).map(n => n.id);
    if (front.length >= 2) continue;
    const [ax, ay] = front[0].split(',').map(Number);
    // 找与现有相邻格横向/纵向相邻、且还没贴这块地的路格。
    const cand = SLICE_MAP.nodes.find(n => {
      if (n.adjacentPlots?.includes(plot.id)) return false;
      const [bx, by] = n.id.split(',').map(Number);
      return Math.abs(bx - ax) + Math.abs(by - ay) === 1;
    });
    if (!cand) continue;
    (cand.adjacentPlots ??= []).push(plot.id);
    added++;
  }
  if (!added) throw new Error('一格都没能加宽 —— 探针逻辑写错了');
  return added;
}
function restore() {
  const s = JSON.parse(pristine);
  SLICE_MAP.plots.forEach((p, i) => Object.assign(p, s.plots[i]));
  SLICE_MAP.nodes.forEach((n, i) => { n.adjacentPlots = s.nodes[i].adjacentPlots; });
  if (JSON.stringify({ plots: SLICE_MAP.plots, nodes: SLICE_MAP.nodes }) !== pristine) throw new Error('还原失败');
}

async function play({ style, seed, order, spend }) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  const wanted = [style, ...order];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const seat0 = state.players[0];
  let decisions = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      if (prompt.type === 'buy' && prompt.player?.id === seat0.id && prompt.plot) {
        if (spend === 'none') return false;
        if (spend === 'fill') {
          const mineOnStreet = state.map.plots.some(x => x.id !== prompt.plot.id && !x.big
            && x.street === prompt.plot.street && state.properties[x.id]?.ownerId === seat0.id);
          if (prompt.plot.big || !mineOnStreet) return false;
        }
        if (spend === 'big' && !prompt.plot.big) return false;
      }
      return aiAnswer(prompt, state);
    },
  });
  if (!state.over) throw new Error('Engine returned before game ended');
  return { win: state.players.find(p => p.team === state.winnerTeam) === seat0,
    bankrupt: !seat0.alive, assets: assetsOf(state, seat0),
    rentEarned: seat0.sliceStats.rentEarned, plots: seat0.properties.length };
}

const frontageOf = id => SLICE_MAP.nodes.filter(n => n.adjacentPlots?.includes(id)).length;

try {
  // ① 基线（原图）
  console.log(`基线校验（n=${SEEDS * 2}/格，原图）`);
  for (const style of STYLES) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, spend: null }));
    const p = 100 * rows.filter(r => r.win).length / rows.length;
    const ok = Math.abs(p - BASELINE[style]) < 0.05;
    console.log(`  ${style.padEnd(6)} ${p.toFixed(1)}% ${ok ? '✅' : `❌ 期望 ${BASELINE[style]}%`}`);
    if (!ok) { console.error('基线没复现 —— 后面的格不印。'); process.exit(2); }
  }

  // ② 加宽小店
  const added = widenShops();
  console.log(`\n加宽：${added} 个小店各多贴 1 个路格`);
  const sample = SLICE_MAP.plots.filter(p => !p.big).slice(0, 3);
  for (const p of sample) console.log(`  ${p.name} 相邻格 ${frontageOf(p.id)}（书屋 ${frontageOf('market')}）`);

  console.log(`\n===== 小店 2 个收租面 · n=${SEEDS * 2}/格 =====`);
  const rates = [];
  for (const style of STYLES) {
    const rows = [];
    for (const order of opponentOrders(style)) for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order, spend: null }));
    const w = rows.filter(r => r.win).length / rows.length;
    rates.push(w);
    console.log(`  平衡 ${style.padEnd(6)} ${pct(w).padEnd(7)}`
      + ` 破产 ${pct(rows.filter(r => r.bankrupt).length / rows.length).padEnd(6)}`
      + ` 收租 ${String(Math.round(mean(rows, 'rentEarned'))).padStart(6)}`
      + ` 地 ${mean(rows, 'plots').toFixed(2)}`);
  }
  console.log(`  起手差距 ${((Math.max(...rates) - Math.min(...rates)) * 100).toFixed(1)}pp`);

  for (const style of STYLES) {
    const arms = {};
    for (const spend of ['none', 'fill', 'big']) {
      const rows = [];
      for (let seed = 1; seed <= SEEDS; seed++) rows.push(await play({ style, seed, order: opponentOrders(style)[0], spend }));
      arms[spend] = rows;
    }
    const wr = k => arms[k].filter(r => r.win).length / arms[k].length;
    const bk = k => arms[k].filter(r => r.bankrupt).length / arms[k].length;
    const sgn = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`;
    console.log(`    ${style.padEnd(6)} 补街−不花 ${sgn(wr('fill') - wr('none')).padEnd(8)}`
      + ` 书屋−不花 ${sgn(wr('big') - wr('none')).padEnd(8)}`
      + ` 不花/补街/书屋 ${pct(wr('none'))}/${pct(wr('fill'))}/${pct(wr('big'))}`
      + ` 破产 ${pct(bk('none'))}/${pct(bk('fill'))}/${pct(bk('big'))}`);
  }
} finally {
  restore();
}
