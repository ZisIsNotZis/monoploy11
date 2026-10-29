import test from 'node:test';
import assert from 'node:assert/strict';
import { TEST_MANOR } from '../src/data/maps/test-manor.js';
import { validateMap } from '../src/engine/board.js';
import { createGame, roll, buyProperty, buildProperty, chooseDirection, endTurn, current, skipPending, doMagic, doNews, doLottery, doMerchant, doShop, leaveStock, doBank, leavePending } from '../src/engine/game.js';
import { rentFor } from '../src/engine/economy.js';
import { TUNING } from '../src/data/tuning.js';

test('test map validates', () => assert.deepEqual(validateMap(TEST_MANOR), []));

test('game starts with 4 hotseat players on day 1', () => {
  const s = createGame({ seed: 3 });
  assert.equal(s.day, 1);
  assert.equal(s.players.length, 4);
  assert.ok(s.players.every(p => p.cash === TUNING.startingCash));
});

test('same seed and actions replay', () => {
  const a = createGame({ seed: 42 });
  const b = createGame({ seed: 42 });
  for (let i = 0; i < 20; i++) {
    if (a.phase === 'over') break;
    for (const s of [a, b]) {
      if (s.pending?.type === 'direction') chooseDirection(s, s.pending.options[0]);
      else if (s.pending?.type === 'buy') skipPending(s);
      else if (s.pending?.type === 'build') skipPending(s);
      else if (s.pending) leavePending(s);
      else if (s.phase === 'action') roll(s, 1);
    }
  }
  assert.deepEqual(a.players.map(p => [p.cash, p.position]), b.players.map(p => [p.cash, p.position]));
});

test('street chain rent reaches million scale at 5 max properties', () => {
  const s = createGame({ seed: 5 });
  const owner = s.players[0];
  // A1..A5
  for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) {
    s.properties[id] = { ownerId: owner.id, level: 5, street: 'A', big: false };
    owner.properties.push(id);
  }
  const rent = rentFor(s, 'r5');
  assert.ok(rent >= 1_000_000, `rent was ${rent}`);
});

test('a full hotseat game terminates without crashing', () => {
  const s = createGame({ seed: 9, config: {} });
  s.config.dayLimit = 30;
  let guard = 0;
  while (s.phase !== 'over' && guard++ < 500) {
    const p = current(s);
    if (s.pending?.type === 'buy') {
      if (p.cash > s.pending.price * 3) buyProperty(s); else skipPending(s);
    } else if (s.pending?.type === 'build') {
      if (p.cash > s.pending.cost * 3) buildProperty(s); else skipPending(s);
    } else if (s.pending?.type === 'direction') {
      chooseDirection(s, s.pending.options[0]);
    } else if (s.pending?.type === 'magic') doMagic(s, 'money');
    else if (s.pending?.type === 'news') doNews(s);
    else if (s.pending?.type === 'lottery') doLottery(s);
    else if (s.pending?.type === 'shop') doShop(s, s.shopOffer[0]);
    else if (s.pending?.type === 'merchant') doMerchant(s, s.shopOffer[0]);
    else if (s.pending?.type === 'bank') doBank(s, 'deposit', 1000);
    else if (s.pending?.type === 'stock') leaveStock(s);
    else if (s.pending) leavePending(s);
    else if (s.phase === 'action') roll(s, 1);
    else break;
  }
  assert.equal(s.phase, 'over');
  assert.ok(s.winnerTeam);
});
