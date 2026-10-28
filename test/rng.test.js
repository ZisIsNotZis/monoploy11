import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/engine/rng.js';

test('same seed, same sequence', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.float(), b.float());
});

test('different seeds diverge', () => {
  assert.notEqual(makeRng(1).float(), makeRng(2).float());
});

test('int stays in range', () => {
  const r = makeRng(7);
  for (let i = 0; i < 1000; i++) {
    const n = r.int(6);
    assert.ok(n >= 0 && n < 6);
  }
});
