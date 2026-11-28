// #3456b：给判据找一局**真实结算**出「同一天两笔」的对局，供测试直接用真引擎复跑。
//
// 上一版判据（test/season-window-capacity.test.js 第 2 条）是手写了两行日志字符串，
// 于是改坏结算它照样绿 —— supervisor 指出的正是这一点。
// 这里只找「哪一局、哪一天、哪块地」，测试拿到坐标后自己跑真引擎、自己数日志行。
import { createSliceConfig, SLICE_STYLES } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const SEEDS = Number(process.argv[2] ?? 60);
const DECISION_LIMIT = 20000;

for (const style of SLICE_STYLES.map(s => s.id)) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = startSession(createSliceConfig({ human: false, seed, style, sliceContestedStreets: true }));
    let decisions = 0;
    await runGame(s, {
      render() {}, async step() {},
      async ask(prompt) {
        if (++decisions > DECISION_LIMIT) throw new Error('decision limit');
        return aiAnswer(prompt, s);
      },
    });
    const perDay = new Map();
    for (const rep of s.slice?.history ?? []) {
      for (const line of rep.lines ?? []) {
        const m = /^(\S+) 实付租金 (\d+)（(.+?)）/.exec(line);
        if (!m) continue;
        const plot = s.map.plots.find(p => p.name === m[3]);
        if (!plot) continue;
        const k = `${rep.day}|${plot.id}`;
        const cur = perDay.get(k) ?? { day: rep.day, plotId: plot.id, payers: [], amounts: [] };
        cur.payers.push(m[1]); cur.amounts.push(Number(m[2]));
        perDay.set(k, cur);
      }
    }
    for (const v of perDay.values()) {
      if (v.payers.length < 2) continue;
      console.log(JSON.stringify({ style, seed, day: v.day, plotId: v.plotId, payers: v.payers, amounts: v.amounts }));
      process.exit(0);
    }
  }
}
console.log('NOT FOUND');
