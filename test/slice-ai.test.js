import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { buyPrice } from '../src/engine/economy.js';

const make = (seed = 1, style = 'grow') => startSession(createSliceConfig({ human: false, seed, style }));
function exposeValuableShop(state, player) {
  const id = state.players.find(p => p.team !== player.team).properties[0];
  state.properties[id].level = 3;
  // Both opponents can immediately reach this shop; acquisition has a purpose.
  for (const p of state.players) { p.position = '9,2'; p.facing = '8,2'; p.lastNode = null; }
  return id;
}

test('slice AI upgrades a useful allied house, and does not waste cards on maxed houses', () => {
  const state = make();
  const p = state.players[0];
  p.cards = ['worker'];
  state.properties[p.properties[0]].level = 2;
  assert.deepEqual(aiAnswer({ type: 'action', player: p }, state), { action: 'card', index: 0 });
  const id = aiAnswer({ type: 'target', player: p, cardId: 'worker', kind: 'plot' }, state);
  assert.equal(id, p.properties[0]);
  for (const id of p.properties) state.properties[id].level = 3;
  assert.deepEqual(aiAnswer({ type: 'action', player: p }, state), { action: 'roll', dice: 1 });
  p.sliceCardsUsed = 2;
  p.cards = ['remotedice'];
  assert.deepEqual(aiAnswer({ type: 'action', player: p }, state), { action: 'roll', dice: 1 });
});

test('slice targeting and supplies respect ownership, affordability and legal choices', () => {
  const state = make(5, 'take');
  const p = state.players[0];
  exposeValuableShop(state, p);
  let id = aiAnswer({ type: 'target', player: p, cardId: 'buyland', kind: 'plot' }, state);
  assert.ok(state.map.plots.some(plot => plot.id === id));
  assert.equal(state.map.plots.find(plot => plot.id === id).big, false);
  assert.notEqual(state.properties[id]?.ownerId, p.id);
  assert.equal(aiAnswer({ type: 'target', player: p, cardId: 'buyland', kind: 'plot', plotIds: [] }, state), null);
  p.cash = 0;
  assert.equal(aiAnswer({ type: 'target', player: p, cardId: 'buyland', kind: 'plot' }, state), null);
  const ownStreet = state.properties[p.properties[0]].street;
  assert.equal(aiAnswer({ type: 'target', player: p, cardId: 'inflate', kind: 'street' }, state), ownStreet);
  const closedStreet = aiAnswer({ type: 'target', player: p, cardId: 'close', kind: 'street' }, state);
  assert.notEqual(closedStreet, ownStreet);
  assert.equal(aiAnswer({ type: 'supply', player: p, options: [{ id: 'cross' }] }, state), 'cross');
  assert.ok(Number.isInteger(aiAnswer({ type: 'discard', player: p, cards: p.cards }, state)));
});

test('slice acquisition reserves include the takeover premium', () => {
  const state = make(5, 'take');
  const p = state.players[0];
  const id = exposeValuableShop(state, p);
  const price = Math.round(buyPrice(state, id) * 1.25);
  const prompt = { type: 'target', player: p, cardId: 'buyland', kind: 'plot', plotIds: [id] };
  p.cash = price + 9000 - 1;
  assert.equal(aiAnswer(prompt, state), null);
  p.cash = price + 9000;
  assert.equal(aiAnswer(prompt, state), id);
  state.day = state.config.dayLimit;
  assert.equal(aiAnswer(prompt, state), null);
});

test('slice acquisition AI holds its card when premium cannot earn back', () => {
  const state = make(5, 'take');
  const p = state.players[0];
  p.cards = ['buyland'];
  // Cheap does not imply useful: no enemies means there is no prospective toll.
  for (const other of state.players) if (other.id !== p.id) other.alive = false;
  assert.deepEqual(aiAnswer({ type: 'action', player: p }, state), { action: 'roll', dice: 1 });
});

test('slice AI uses public movement options without consuming RNG or changing state', () => {
  const state = make(7);
  const p = state.players[0];
  for (const key of Object.keys(state.rng)) if (typeof state.rng[key] === 'function') state.rng[key] = () => { throw new Error('AI must not draw or inspect future randomness'); };
  const before = JSON.stringify(state);
  const value = aiAnswer({ type: 'diceValue', player: p }, state);
  assert.ok(value >= 1 && value <= 6);
  const options = ['2,2', '4,2'];
  assert.ok(options.includes(aiAnswer({ type: 'direction', player: p, options, remainingSteps: 3 }, state)));
  assert.deepEqual(aiAnswer({ type: 'action', player: p }, state), aiAnswer({ type: 'action', player: p }, state));
  assert.equal(JSON.stringify(state), before);
});

test('all slice styles complete full 16-day games on multiple seeds without invalid-card loops', async () => {
  for (const style of ['grow', 'take', 'cross']) for (const seed of [1, 7, 41]) {
    const state = make(seed, style);
    let decisions = 0;
    await runGame(state, {
      render() {}, async step() {},
      async ask(prompt) {
        assert.ok(++decisions < 5000, `${style}/${seed}: stuck on ${prompt.type}`);
        return aiAnswer(prompt, state);
      },
    });
    assert.equal(state.over, true, `${style}/${seed}`);
    assert.ok(state.day <= 17);
    assert.ok(state.players.some(p => p.sliceStats.cardsPlayed > 0));
  }
});
