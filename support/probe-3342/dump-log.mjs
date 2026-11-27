import { writeFileSync } from 'node:fs';
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const [, , out, seedArg = '5', style = 'cross'] = process.argv;
const state = startSession(createSliceConfig({ human: false, seed: Number(seedArg), style }));
await runGame(state, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, state); } });
writeFileSync(out, state.log.map(l => `D${l.day} ${l.text}`).join('\n'));
console.log(out, state.log.length, 'lines');
