// 给一局游戏算一个「可比较的指纹」：日志全文、三家终局现金/资产、每个 prompt 的类型序列。
// 用途：证明 #3342 在**默认设置**下逐字未改老产品 —— 同一 seed 在两棵树上跑，指纹必须相同。
//
// 用法（在任意一棵树里跑）：
//   node support/probe-3342/replay-digest.mjs 4 1,2,3
// 输出每局一行 JSON。比较两份输出即可。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';
import { createHash } from 'node:crypto';

const SEEDS = Number(process.argv[2] ?? 4);
const STYLES = (process.argv[3] ?? 'grow,take,cross').split(',');

for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
  const state = startSession(createSliceConfig({ human: false, seed, style }));
  const prompts = [];
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) { prompts.push(prompt.type); return aiAnswer(prompt, state); },
  });
  const digest = createHash('sha256')
    .update(state.log.map(l => `D${l.day} ${l.text}`).join('\n'))
    .update('\n--prompts--\n' + prompts.join(','))
    .digest('hex').slice(0, 16);
  console.log(JSON.stringify({
    style, seed,
    endDay: state.day,
    winner: state.winnerTeam,
    assets: Object.fromEntries(state.players.map(p => [p.style, assetsOf(state, p)])),
    cash: Object.fromEntries(state.players.map(p => [p.style, p.cash])),
    logLines: state.log.length,
    digest,
  }));
}
