import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/engine/game.js';
import { buyPlot } from '../src/engine/flow.js';
import { pay, rentFor, assetsOf } from '../src/engine/economy.js';
import { mapRentMultiplier, tickMap } from '../src/engine/map-runtime.js';

test('doctor inherits a bankrupt player’s properties with consistent ownership and valuation', () => {
  const s = createGame({ seed: 401, startingCards: 0 });
  const [debtor, doctor] = s.players;
  Object.assign(doctor, { isBoss: true, bossId: 'doctor', bossTier: 3 });
  const plot = s.map.plots.find(p => !p.big);
  buyPlot(s, debtor, plot.id, plot);
  s.properties[plot.id].level = 2;
  debtor.cards = ['missile'];
  debtor.cash = 100;
  debtor.deposit = 50;
  const valueBefore = assetsOf(s, doctor);

  assert.equal(pay(s, debtor, null, 200, '租金'), false);
  assert.equal(debtor.alive, false);
  assert.deepEqual(debtor.properties, []);
  assert.deepEqual(debtor.cards, []);
  assert.equal(s.properties[plot.id].ownerId, doctor.id);
  assert.equal(doctor.properties.filter(id => id === plot.id).length, 1);
  assert.deepEqual(doctor.cards, ['missile']);
  assert.ok(rentFor(s, plot.id) > 0);
  assert.ok(assetsOf(s, doctor) > valueBefore);
});

test('bankruptcy without a doctor returns properties to neutral ownership', () => {
  const s = createGame({ seed: 402, startingCards: 0 });
  const debtor = s.players[0];
  const plot = s.map.plots.find(p => !p.big);
  buyPlot(s, debtor, plot.id, plot);
  debtor.cash = 100;
  debtor.deposit = 0;
  assert.equal(pay(s, debtor, null, 200, '税'), false);
  assert.equal(s.properties[plot.id].ownerId, null);
  assert.equal(rentFor(s, plot.id), 0);
});

test('repeated mountain rent previews leave the board and future randomness unchanged', () => {
  const s = createGame({ seed: 403, mapId: 'mountain', startingCards: 0 });
  const control = createGame({ seed: 403, mapId: 'mountain', startingCards: 0 });
  const plot = s.map.plots.find(p => !p.big);
  buyPlot(s, s.players[0], plot.id, plot);
  s.properties[plot.id].level = 2;
  const placements = structuredClone(s.placements);
  const log = structuredClone(s.log);
  const expected = rentFor(s, plot.id);
  for (let i = 0; i < 20; i++) {
    assert.equal(mapRentMultiplier(s, { id: plot.id }), 1);
    assert.equal(rentFor(s, plot.id), expected);
  }
  assert.deepEqual(s.placements, placements);
  assert.deepEqual(s.log, log);
  assert.equal(s.rng.float(), control.rng.float());
});

test('mountain dogs still spawn during the explicit daily map tick', () => {
  const s = createGame({ seed: 404, mapId: 'mountain', startingCards: 0 });
  const before = Object.keys(s.placements).length;
  tickMap(s);
  assert.equal(Object.keys(s.placements).length, before + 1);
});
