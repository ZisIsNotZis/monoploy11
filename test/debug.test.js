import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebugSession } from '../src/debug/session.js';

const config = seed => ({
  seed, dayLimit: 4, startingCards: 0,
  participants: [
    { charId: 'sunxiaomei', team: 't1' },
    { charId: 'atubo', team: 't2' },
  ],
});

test('debug observations are detached and do not advance the game', async () => {
  const session = await createDebugSession(config(410));
  const original = session.observe();
  const observation = session.observe();
  observation.players[0].cash = -1;
  observation.prompt.player.cards.push('free');
  observation.board.nodes.length = 0;
  assert.deepEqual(session.observe(), original);
  assert.equal(original.prompt.type, 'action');
  assert.doesNotThrow(() => JSON.stringify(original));
});

test('answer resumes the real engine and stale answers cannot consume a later prompt', async () => {
  const session = await createDebugSession(config(411));
  const before = session.observe();
  const after = await session.answer({ action: 'roll', dice: 1 }, before.prompt.id);
  assert.ok(after.prompt.id > before.prompt.id);
  assert.equal(after.history[0].type, 'action');
  assert.ok(after.log.some(entry => entry.text.includes('掷出')));
  await assert.rejects(session.answer(true, before.prompt.id), /Stale prompt/);
  assert.deepEqual(session.observe(), after);
});

test('same seeded decisions reproduce a complete debug game', async () => {
  const a = await createDebugSession(config(412));
  const b = await createDebugSession(config(412));
  const finishedA = await a.auto(1000);
  const finishedB = await b.auto(1000);
  assert.equal(finishedA.over, true);
  assert.equal(finishedA.prompt, null);
  assert.deepEqual(finishedA, finishedB);
  await assert.rejects(a.answer(true), /Game has ended/);
  await assert.rejects(a.auto(10001), /auto count/);
});

test('concurrent answers cannot skip a pending decision', async () => {
  const session = await createDebugSession(config(413));
  const next = session.answer({ action: 'roll', dice: 1 });
  await assert.rejects(session.answer(true), /already advancing/);
  await next;
});
