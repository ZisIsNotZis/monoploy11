// #3338：把两屏的真句子打出来（真引擎状态 + 真 render）。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { buildCost, assetsOf } from '../../src/engine/economy.js';
import { render } from '../../src/ui/render.js';
import { nextGameLine, sliceResults } from '../../src/ui/slice.js';

const mkEl = () => {
  const el = { _html: '', style: { setProperty() {} }, hidden: false, scrollTop: 0, scrollHeight: 0, clientWidth: 360, clientHeight: 700,
    classList: { add() {}, remove() {}, toggle() {} } };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = v; } });
  el.querySelector = () => null; el.querySelectorAll = () => []; el.addEventListener = () => {};
  for (const k of ['dataset','setAttribute','appendChild','getBoundingClientRect']) el[k] = () => ({});
  return el;
};
const mkRoot = () => ({ system: mkEl(), players: mkEl(), board: mkEl(), log: mkEl(), insight: mkEl(),
  dice: mkEl(), cards: mkEl(), hand: mkEl(), choice: mkEl() });
const strip = s => String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const style = process.argv[2] ?? 'grow';
const seed = Number(process.argv[3] ?? 9);
const doBuy = process.argv[4] !== 'nobuy';
const state = startSession(createSliceConfig({ human: true, seed, style }));
const me = state.players.find(p => p.controller === 'human');
const out = { buy: [], settle: null };
await runGame(state, { render() {}, async step() {}, async ask(prompt) {
  const p = prompt.player;
  if (p?.controller === 'human' && prompt.type === 'buy' && prompt.plot?.big && state.day <= 6) {
    const root = mkRoot();
    state.pending = { type: 'buy', cellId: prompt.plot.id, price: prompt.price, label: '大空地', level: prompt.level, bigType: prompt.bigType };
    state.phase = 'action';
    render(root, state, new Proxy({}, { get: () => () => {} }));
    out.buy.push({ day: state.day, cash: p.cash, price: prompt.price, text: strip(root.choice.innerHTML) });
    if (doBuy && p.cash >= prompt.price) return true;
  }
  return aiAnswer(prompt, state);
} });
const h = me;
out.settle = { alive: h.alive, day: state.day, win: h.team === state.winnerTeam, assets: assetsOf(state, h), cash: h.cash,
  market: state.properties.market, line: nextGameLine(state) };
console.log(JSON.stringify(out, null, 1));
