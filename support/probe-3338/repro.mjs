// #3338 复现：supervisor 的 grow/seed 9 —— 满级书屋、本局一次没被踩到，结算却让他「放在你的路线上」。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { nextGameLine } from '../../src/ui/slice.js';

const style = process.argv[2] ?? 'grow';
const seed = Number(process.argv[3] ?? 9);
const state = startSession(createSliceConfig({ human: true, seed, style }));
const me = () => state.players.find(p => p.controller === 'human');
await runGame(state, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, state); } });
const h = me();
const adj = (state.log ?? []).filter(e => /旁边是 街心书屋/.test(e.text));
const mine = adj.filter(e => e.text.startsWith(h.name + ' '));
const theirs = adj.filter(e => !e.text.startsWith(h.name + ' '));
console.log(JSON.stringify({
  style, seed, alive: h.alive, day: state.day,
  marketLevel: state.properties.market?.level, marketOwner: state.players.find(p => p.id === state.properties.market?.ownerId)?.name,
  stopsAdjacentMine: mine.length, stopsAdjacentOthers: theirs.length,
  line: nextGameLine(state),
}, null, 1));
