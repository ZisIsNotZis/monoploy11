// #3337 探针 11：300 seed 配对，逐条候选建议的胜负差 + McNemar 不一致对。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, acquisitionPrice } from '../../src/engine/economy.js';
import { sliceTargetIds } from '../../src/engine/insight.js';

const SEEDS = Number(process.argv[2] ?? 300);
const MAIN = { grow: 'worker', take: 'buyland', cross: 'close' };

async function play(style, seed, forcePack) {
  const state = startSession(createSliceConfig({ human: true, seed, style }));
  const me = () => state.players.find(p => p.controller === 'human');
  let packDone = !forcePack;
  const f = { pack: null, plays: 0 };
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (prompt.player?.controller !== 'human') return aiAnswer(prompt, state);
      const p = prompt.player;
      if (!packDone && prompt.type === 'supply') {
        packDone = true;
        if ((prompt.options ?? []).some(o => o.id === forcePack)) { f.pack = forcePack; return forcePack; }
      }
      if (forcePack && prompt.type === 'action') {
        const i = p.cards.indexOf(MAIN[forcePack]);
        if (i >= 0) {
          const targets = sliceTargetIds(state, p, MAIN[forcePack]);
          if (targets.length) {
            f.plays++;
            if (MAIN[forcePack] === 'buyland') f._pick = targets.slice().sort((a, b) => acquisitionPrice(state, a) - acquisitionPrice(state, b))[0];
            return { action: 'card', index: i };
          }
        }
      }
      if (prompt.type === 'target' && f._pick) { const k = f._pick; f._pick = null; return k; }
      return aiAnswer(prompt, state);
    },
  });
  const p = me();
  return { assets: assetsOf(state, p), win: p.team === state.winnerTeam, pack: f.pack, plays: f.plays };
}

const CAND = { grow: ['grow', 'cross', 'take'], take: ['take', 'grow', 'cross'], cross: ['cross', 'grow', 'take'] };
const out = {};
for (const style of ['grow', 'take', 'cross']) {
  const rows = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const base = await play(style, seed, null);
    const arms = {};
    for (const pack of CAND[style]) arms[pack] = await play(style, seed, pack);
    rows.push({ seed, base, arms });
  }
  out[style] = { baseWin: rows.filter(r => r.base.win).length, games: rows.length, arms: {} };
  for (const pack of CAND[style]) {
    const live = rows.filter(r => r.arms[pack].pack === pack);
    const d = live.map(r => r.arms[pack].assets - r.base.assets);
    const armWin = live.filter(r => r.arms[pack].win).length, baseWin = live.filter(r => r.base.win).length;
    const onlyArm = live.filter(r => r.arms[pack].win && !r.base.win).length;   // b
    const onlyBase = live.filter(r => !r.arms[pack].win && r.base.win).length;  // c
    const mean = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
    out[style].arms[pack] = {
      n: live.length, baseWin, armWin,
      mcnemar: { onlyArm, onlyBase, chi2: +(((Math.abs(onlyArm - onlyBase) - 1) ** 2) / Math.max(1, onlyArm + onlyBase)).toFixed(2) },
      dAssets: { mean: mean(d), better: d.filter(x => x > 0).length, worse: d.filter(x => x < 0).length },
      plays: +(live.reduce((s, r) => s + r.arms[pack].plays, 0) / Math.max(1, live.length)).toFixed(2),
    };
  }
}
console.log(JSON.stringify(out, null, 1));
