import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, groundPhase } from '../src/engine/flow.js';
import { applyCard } from '../src/engine/game.js';
import { pay, buyPrice } from '../src/engine/economy.js';

test('slice rent is immediately usable to invest without a bank', () => {
  const s = startSession(createSliceConfig());
  const [payer, owner] = s.players;
  const target = payer.properties[0];
  const price = Math.round(buyPrice(s, target) * 1.25);
  owner.cash = price - 1;
  assert.equal(applyCard(s, owner, 'buyland', target), false);
  assert.equal(pay(s, payer, owner, 1, '租金'), true);
  assert.equal(owner.cash, price);
  assert.equal(owner.deposit, 0);
  assert.equal(applyCard(s, owner, 'buyland', target), true);
});

test('slice rent summaries show actual funds transferred on bankruptcy', async () => {
  const s = startSession(createSliceConfig());
  const [payer, owner] = s.players;
  const target = owner.properties[0];
  payer.position = s.map.nodes.find(n => n.adjacentPlots.includes(target)).id;
  payer.cash = 1;
  payer.deposit = 0;
  const ownerCash = owner.cash;
  await groundPhase(s, payer, { async ask() { return false; } });
  assert.equal(payer.alive, false);
  assert.equal(owner.cash, ownerCash + 1);
  assert.equal(owner.deposit, 0);
  assert.equal(payer.sliceStats.rentPaid, 1);
  assert.equal(owner.sliceStats.rentEarned, 1);
  assert.equal(s.stats.rents, 1);
  assert.ok(s.log.some(entry => entry.text.includes('应付租金 2800')));
  assert.ok(s.log.some(entry => entry.text.includes('实付租金 1')));
});

test('legacy mode keeps rental income in deposits', () => {
  const s = startSession({ seed: 490, startingCards: 0 });
  const [payer, owner] = s.players;
  const cash = owner.cash;
  const deposit = owner.deposit;
  pay(s, payer, owner, 1000, '租金');
  assert.equal(owner.cash, cash);
  assert.equal(owner.deposit, deposit + 1000);
});
