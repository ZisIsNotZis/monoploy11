// #3335 探针 5：主管那一局的原样复现 —— seed 4 · 街角店主 · 翻修卡一直留着 · 第 16 天加盖提示。
// 人类这边「不用翻修卡」，其余都问 AI（其余决策同 aiAnswer），只在最后一天的 build 提示处冻结。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { buildCost } from '../../src/engine/economy.js';
import { buildOrderLine } from '../../src/ui/slice.js';
import { render } from '../../src/ui/render.js';

const stub = () => ({ onclick: null, textContent: '', innerHTML: '', style: { setProperty() {} },
  classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, remove() {},
  getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0, left: 0, right: 0 }) });
const mkEl = () => {
  const el = { _html: '', style: { setProperty() {} }, hidden: false, scrollTop: 0, scrollHeight: 0,
    clientHeight: 844, clientWidth: 390, classList: { add() {}, remove() {}, toggle() {} } };
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); } });
  el.querySelector = () => stub(); el.querySelectorAll = () => []; el.addEventListener = () => {};
  el.getBoundingClientRect = () => ({ top: 0, bottom: 0, height: 0, left: 0, right: 0 });
  return el;
};
const mkRoot = () => ({ system: mkEl(), players: mkEl(), board: mkEl(), log: mkEl(), insight: mkEl(),
  dice: mkEl(), cards: mkEl(), hand: mkEl(), choice: mkEl() });
const strip = s => s.replace(/<br\s*\/?>/g, ' | ').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const style = process.argv[2] ?? 'grow';
const seed = Number(process.argv[3] ?? 4);
const state = startSession(createSliceConfig({ human: true, seed, style }));
const out = { style, seed, hits: [] };

await runGame(state, {
  render() {}, async step() {},
  async ask(prompt) {
    const p = prompt.player;
    if (p?.controller === 'human') {
      // 不许用翻修卡：从动作选择里剔除 worker
      let a = aiAnswer(prompt, state);
      if (prompt.type === 'action' && a?.action === 'card' && p.cards[a.index] === 'worker') {
        const alt = p.cards.findIndex((c, i) => c !== 'worker' && i !== a.index);
        a = alt >= 0 ? { action: 'card', index: alt } : { action: 'roll', dice: 1 };
      }
      if (prompt.type === 'target' && prompt.cardId === 'worker') return null;
      if (prompt.type === 'build' && state.day >= state.config.dayLimit) {
        const id = prompt.plot.id;
        const root = mkRoot();
        state.pending = { type: 'build', cellId: id, cost: prompt.cost };
        render(root, state, new Proxy({}, { get: () => () => {} }));
        state.pending = null;
        out.hits.push({ day: state.day, plot: prompt.plot.name, level: state.properties[id].level,
          cost: Math.round(buildCost(state.properties[id].level + 1) * state.priceIndex),
          holdsWorker: p.cards.includes('worker'),
          line: buildOrderLine(state, id, prompt.cost, p),
          screen: strip(root.choice.innerHTML) });
        return false;
      }
      return a;
    }
    return aiAnswer(prompt, state);
  },
});
console.log(JSON.stringify(out, null, 1));
