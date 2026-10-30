import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, current, useCard } from '../src/engine/game.js';

test('direction cards set per-turn direction modes', () => {
  const s = createGame({ seed: 1201, startingCards: 0 });
  const p = current(s); p.cards = ['dirchoose', 'dirclockwise', 'dircounter'];
  s.phase = 'action';
  useCard(s, 0, null); assert.equal(p.dirMode, 'choose'); assert.equal(p.dirModeOwner, p.id);
  useCard(s, 0, null); assert.equal(p.dirMode, 'cw');
  useCard(s, 0, null); assert.equal(p.dirMode, 'ccw');
});

test('random direction card targets an opponent and sets its mode', () => {
  const s = createGame({ seed: 1202, startingCards: 0 });
  const p = current(s); const q = s.players.find(x => x.id !== p.id);
  q.position = p.position;
  p.cards = ['dirrandom']; s.phase = 'action';
  useCard(s, 0, q.id);
  assert.equal(q.dirMode, 'random');
  assert.equal(q.dirModeOwner, q.id);
});

test('remote and super dice descriptions use the new 1–6 / 0–12 rule', async () => {
  const { CARD_DESC } = await import('../src/data/card-desc.js');
  assert.match(CARD_DESC.remotedice, /1–6/);
  assert.match(CARD_DESC.remotedice, /骰子数/);
  assert.match(CARD_DESC.superdice, /0–12/);
});
