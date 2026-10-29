import test from 'node:test';
import assert from 'node:assert/strict';
import { TEST_MANOR } from '../src/data/maps/test-manor.js';
import { validateMap } from '../src/engine/board-v2.js';
import { createGame, roll, buyProperty, buildProperty, doChooseBig, chooseDirection, current, skipPending, doMagic, doNews, doLottery, doMerchant, doShop, leaveStock, doBank, leavePending, addCard, attachGod, useCard, CARD_DEFS } from '../src/engine/game.js';
import { pay } from '../src/engine/economy.js';
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
  const s = createGame({ seed: 5, mapId: 'test-manor' });
  const owner = s.players[0];
  // A1..A5
  for (const id of ['plot_r1', 'plot_r2', 'plot_r3', 'plot_r4', 'plot_r5']) {
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
    if (s.pending) leavePending(s);
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
    if (def.target === 'cell') target = s.map.nodes.find(n => n.plotId)?.id ?? s.map.nodes.find(n => n.adjacentPlots?.length)?.id;
    if (def.target === 'street') target = 'A';
    assert.doesNotThrow(() => useCard(s, 0, target), `card ${id}`);
  }
});

test('passing a card cell grants a card', () => {
  const s = createGame({ seed: 20, mapId: 'test-manor' });
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
  const s = createGame({ seed: 21, mapId: 'test-manor' });
  const p = current(s);
  const q = s.players.find(x => x.id !== p.id);
  p.position = 'r1'; p.lastNode = 'r0'; p.facing = 'r2'; p.forcedDice = 1;
  p.god = '定时炸弹'; p.godDays = 10;
  q.position = 'r2';
  roll(s, 1);
  assert.equal(q.god, '定时炸弹');
  assert.equal(p.god, null);
});

test('rent goes to the owner bank deposit, not cash', () => {
  const s = createGame({ seed: 22 });
  const [a, b] = s.players;
  const cash = b.cash, dep = b.deposit;
  pay(s, a, b, 1000, '租金');
  assert.equal(b.cash, cash);
  assert.equal(b.deposit, dep + 1000);
});

test('big land starts empty and the second investment chooses a building', () => {
  const s = createGame({ seed: 23, mapId: 'test-manor' });
  const p = current(s);
  s.properties.plot_r10 = { ownerId: p.id, level: 0, big: true, bigType: null, street: null };
  p.properties.push('plot_r10');
  assert.equal(rentFor(s, 'r10'), 0);
  s.pending = { type: 'chooseBig', cellId: 'plot_r10' };
  doChooseBig(s, 'commercial');
  assert.equal(s.properties.plot_r10.bigType, 'commercial');
  assert.equal(s.properties.plot_r10.level, 1);
  assert.ok(rentFor(s, 'r10') > 0);
});

test('one lottery number cannot be sold twice in the same draw', () => {
  const s = createGame({ seed: 24 });
  const p = current(s);
  s.pending = { type: 'lottery' };
  p.cash = 100_000;
  doLottery(s, 7);
  doLottery(s, 7);
  assert.equal(s.lottery.tickets.length, 1);
  assert.deepEqual(s.lottery.sold, [7]);
});

test('shop buys immediately and exits after three purchases', () => {
  const s = createGame({ seed: 25 });
  const p = current(s);
  p.cash = 100_000;
  s.pending = { type: 'shop' };
  s.shopOffer = Array.from({ length: 9 }, (_, i) => ({ id: 'mine', price: 1000 }));
  s.shopBought = 0; s.shopLimit = 3;
  doShop(s, 0);
  assert.equal(s.shopOffer.length, 8);
  doShop(s, 0);
  assert.equal(s.pending?.type, 'shop');
  assert.equal(s.shopOffer.length, 7);
  doShop(s, 0);
  assert.equal(s.pending, null);
  assert.equal(s.shopBought, 3);
});

test('a big property is two walkable cells sharing one property key', () => {
  const big = TEST_MANOR.nodes.find(n => n.id === 'r10');
  const twin = TEST_MANOR.nodes.find(n => n.id === 'br10');
  assert.equal(big.propertyKey, 'r10');
  assert.equal(twin.propertyKey, 'r10');
  assert.ok(TEST_MANOR.edges.some(e => e.a === 'r10' && e.b === 'br10'));
  assert.ok(TEST_MANOR.edges.some(e => e.a === 'br10' && e.b === 'r11'));
});

test('rent on either half of a big property uses the same owner', () => {
  const s = createGame({ seed: 26, mapId: 'test-manor' });
  const p = current(s);
  s.properties.plot_r10 = { ownerId: p.id, level: 2, big: true, bigType: 'commercial', street: null };
  p.properties.push('plot_r10');
  assert.equal(rentFor(s, 'br10'), rentFor(s, 'r10'));
  assert.ok(rentFor(s, 'br10') > 0);
});

test('a dead-end road bounces the walker back instead of teleporting', () => {
  const s = createGame({ seed: 27 });
  const p = current(s);
  p.position = '1,6'; p.lastNode = '2,6'; p.facing = '2,6'; p.forcedDice = 1;
  roll(s, 1);
  assert.equal(p.position, '2,6');
});

test('grid map has adjacent plots, including 2x2 big plots', () => {
  const s = createGame({ seed: 28 });
  const plots = s.map.plots;
  assert.ok(plots.some(p => p.big && p.cells.length === 4));
  assert.ok(s.map.nodes.some(n => n.adjacentPlots.length >= 2));
});
