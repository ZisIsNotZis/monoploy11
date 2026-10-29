import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_MANOR } from '../src/data/maps/grid-manor.js';
import { validateMap } from '../src/engine/board-v2.js';
import { createGame, current, drawLottery, useCard } from '../src/engine/game.js';
import { buyPlot, buildPlot } from '../src/engine/flow.js';
import { rentFor } from '../src/engine/economy.js';

test('grid map validates', () => assert.deepEqual(validateMap(GRID_MANOR), []));

test('all ground starts empty and buying creates empty land', () => {
  const s = createGame({ seed: 61 });
  assert.equal(Object.keys(s.properties).length, 0);
  const p = current(s);
  const plot = s.map.plots.find(x => !x.big);
  buyPlot(s, p, plot.id, plot);
  assert.equal(s.properties[plot.id].level, 0);
  assert.equal(rentFor(s, plot.id), 0);
  buildPlot(s, p, plot.id);
  assert.equal(s.properties[plot.id].level, 1);
  assert.ok(rentFor(s, plot.id) > 0);
});

test('big plots do not add to small-house street multiplier', () => {
  const s = createGame({ seed: 62 });
  const owner = current(s);
  const street = s.map.plots.filter(x => x.street === 'A');
  const small = street.filter(x => !x.big);
  const big = street.find(x => x.big);
  for (const plot of small) { s.properties[plot.id] = { ownerId: owner.id, level: 1, street: 'A', big: false }; owner.properties.push(plot.id); }
  const before = rentFor(s, small[0].id);
  s.properties[big.id] = { ownerId: owner.id, level: 1, street: 'A', big: true, bigType: 'commercial' };
  owner.properties.push(big.id);
  assert.equal(rentFor(s, small[0].id), before);
});

test('lottery keeps tickets and sold numbers until someone wins', () => {
  const s = createGame({ seed: 63 });
  s.day = 10;
  s.rng.int = () => 0; // winning number 1
  s.lottery.tickets.push({ playerId: current(s).id, number: 2 });
  s.lottery.sold.push(2);
  drawLottery(s);
  assert.equal(s.lottery.tickets.length, 1);
  assert.deepEqual(s.lottery.sold, [2]);
});

test('missile sends the target to hospital', () => {
  const s = createGame({ seed: 64 });
  const p = current(s);
  const q = s.players.find(x => x.id !== p.id);
  q.position = p.position;
  p.cards = ['missile'];
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.equal(q.hospital, 2);
  assert.ok(!p.cards.includes('missile'));
});
