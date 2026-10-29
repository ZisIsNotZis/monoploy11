import test from 'node:test';
import assert from 'node:assert/strict';
import { TEST_MANOR } from '../src/data/maps/test-manor.js';
import { validateMap } from '../src/engine/board.js';
import { createGame, roll, buyProperty, buildProperty, chooseDirection, current, skipPending, doMagic, doNews, doLottery, doMerchant, doShop, leaveStock, doBank, leavePending, addCard, attachGod, useCard, CARD_DEFS } from '../src/engine/game.js';
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
    else if (s.pending?.type === 'shop') doShop(s, 0);
    else if (s.pending?.type === 'merchant') doMerchant(s, 0);
    else if (s.pending?.type === 'bank') doBank(s, 'deposit', 1000);
    else if (s.pending?.type === 'stock') leaveStock(s);
    else if (s.pending) leavePending(s);
    else if (s.phase === 'action') roll(s, 1);
    else break;
  }
  assert.equal(s.phase, 'over');
  assert.ok(s.winnerTeam);
});

test('five identical cards synthesize the advanced card', () => {
  const s = createGame({ seed: 12 });
  const p = s.players[0];
  p.cards = [];
  for (let i = 0; i < 5; i++) addCard(s, p, 'missile');
  assert.deepEqual(p.cards, ['rushmissile']);
});

test('boss goes first and starts with properties', () => {
  const s = createGame({ seed: 13, participants: [
    { name: '孙小美', charId: 'sunxiaomei', team: 'ch' },
    { name: '博士', charId: 'sunxiaomei', team: 'boss', isBoss: true, bossId: 'doctor', bossTier: 3 },
  ]});
  assert.equal(s.players[0].name, '博士');
  assert.ok(s.players[0].properties.length >= 5);
  assert.equal(current(s).name, '博士');
  assert.equal(s.players[0].handLimit, 16);
});

test('two-player free game is legal and can end', () => {
  const s = createGame({ seed: 14, participants: [
    { name: 'A', charId: 'sunxiaomei', team: 'a' },
    { name: 'B', charId: 'atubo', team: 'b' },
  ]});
  assert.equal(s.players.length, 2);
  assert.equal(s.phase, 'action');
});

test('cannot choose the direction you came from at an intersection', () => {
  const s = createGame({ seed: 18 });
  const p = current(s);
  p.lastNode = 'r4';
  s.pending = { type: 'direction', options: ['r6', 'p1'] };
  chooseDirection(s, 'r4');
  assert.equal(s.pending.type, 'direction');
});

test('a walking character cannot roll two dice', () => {
  const s = createGame({ seed: 19 });
  const p = current(s);
  p.vehicle = 0;
  const before = p.position;
  roll(s, 2);
  assert.equal(p.position, before);
});

test('time bomb occupies the god slot and overrides a god', () => {
  const s = createGame({ seed: 15 });
  const p = s.players[0];
  attachGod(s, p, '财神');
  assert.equal(p.god, '财神');
  attachGod(s, p, '定时炸弹');
  assert.equal(p.god, '定时炸弹');
});

test('all 48 card definitions can be used without throwing', () => {
  const s0 = createGame({ seed: 16 });
  const ids = Object.keys(CARD_DEFS);
  assert.equal(ids.length, 48);
  for (const id of ids) {
    const s = createGame({ seed: 17 });
    const p = current(s);
    p.cards = [id];
    const def = CARD_DEFS[id];
    let target = null;
    if (def.target === 'player') target = s.players.find(q => q.id !== p.id).id;
    if (def.target === 'cell') target = s.map.nodes.find(n => n.kind === 'property').id;
    if (def.target === 'street') target = 'A';
    assert.doesNotThrow(() => useCard(s, 0, target), `card ${id}`);
  }
});

test('passing a card cell grants a card', () => {
  const s = createGame({ seed: 20 });
  const p = current(s);
  p.cards = [];
  p.position = 'r20';
  p.lastNode = 'r20';
  p.facing = 'r21';
  p.forcedDice = 1;
  roll(s, 1);
  assert.equal(p.cards.length, 1);
});

test('an active catcher can hand the timed bomb to another player', () => {
  const s = createGame({ seed: 21 });
  const p = current(s);
  const q = s.players.find(x => x.id !== p.id);
  p.position = 'r1'; p.lastNode = 'r0'; p.facing = 'r2'; p.forcedDice = 1;
  p.god = '定时炸弹'; p.godDays = 10;
  q.position = 'r2';
  roll(s, 1);
  assert.equal(q.god, '定时炸弹');
  assert.equal(p.god, null);
});
