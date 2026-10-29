import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_LIST, MAPS } from '../src/data/maps/index.js';
import { validateMap } from '../src/engine/board-v2.js';
import { createGame, current } from '../src/engine/game.js';
import { tickMap, mapRentMultiplier, mapShopMultiplier, mapExtraSteps } from '../src/engine/map-runtime.js';
import { rentFor } from '../src/engine/economy.js';

test('product map list has 12 maps and all validate', () => {
  assert.equal(MAP_LIST.length, 12);
  assert.equal(new Set(MAP_LIST.map(m => m.id)).size, 12);
  for (const map of MAP_LIST) assert.deepEqual(validateMap(map), [], map.id);
});

test('every product map can create a game and has a runtime', () => {
  for (const map of MAP_LIST) {
    const s = createGame({ seed: 901, mapId: map.id, startingCards: 0 });
    assert.equal(s.mapId, map.id);
    assert.ok(s.map.runtime);
    assert.equal(s.map.runtime.mapId, map.id);
  }
});

test('grand hotel keeps 12 entrances and four 6-entrance corners', () => {
  const map = MAPS['grand-hotel'];
  const center = map.plots.find(p => p.id === 'plot_b5');
  assert.equal(map.nodes.filter(n => n.adjacentPlots?.includes(center.id)).length, 12);
  for (const id of ['plot_b1', 'plot_b2', 'plot_b3', 'plot_b4']) {
    assert.equal(map.nodes.filter(n => n.adjacentPlots?.includes(id)).length, 6, id);
  }
});

test('map mechanics alter rent, shop and movement without map-id branches', () => {
  const night = createGame({ seed: 902, mapId: 'night', startingCards: 0 });
  night.day = 1;
  assert.ok(mapRentMultiplier(night, { id: 'plot_b1' }) > 1);
  assert.ok(mapShopMultiplier(night) < 1);
  const music = createGame({ seed: 903, mapId: 'music', startingCards: 0 });
  music.day = 4;
  tickMap(music);
  assert.equal(mapExtraSteps(music), 1);
  const snow = createGame({ seed: 904, mapId: 'snow', startingCards: 0 });
  snow.day = 6;
  tickMap(snow);
  assert.ok(snow.map.runtime.closed.size > 0);
});

test('angel increases hand limit and volcano closes a rentable plot', () => {
  const angel = createGame({ seed: 905, mapId: 'angel', startingCards: 0 });
  assert.equal(angel.players[0].handLimit, 9);
  const volcano = createGame({ seed: 906, mapId: 'volcano', startingCards: 0 });
  const p = current(volcano);
  const id = 'plot_b1';
  volcano.properties[id] = { ownerId: p.id, level: 1, street: 'A', big: true, bigType: 'commercial', closed: 0, inflate: 0, price: 45_000 };
  p.properties.push(id);
  assert.ok(rentFor(volcano, id) > 0);
  volcano.day = 12;
  tickMap(volcano);
  const buried = Object.values(volcano.properties).filter(x => x.closed > 0).length;
  assert.ok(buried > 0);
  assert.equal(rentFor(volcano, id), 0);
});

test('all 12 maps can finish an AI game on a fixed seed', async () => {
  const { startSession, runGame } = await import('../src/engine/flow.js');
  const { aiAnswer } = await import('../src/engine/ai.js');
  for (const map of MAP_LIST) {
    const s = startSession({
      seed: 930, mapId: map.id, dayLimit: 12,
      participants: [
        { charId: 'sunxiaomei', team: 't1', controller: 'ai' },
        { charId: 'atubo', team: 't2', controller: 'ai' },
      ],
    });
    await runGame(s, { render() {}, async ask(p) { return aiAnswer(p, s); }, async step() {} });
    assert.equal(s.over, true, map.id);
  }
});
