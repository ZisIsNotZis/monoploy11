import test from 'node:test';
import assert from 'node:assert/strict';
import { startSession, runGame } from '../src/engine/flow.js';

function autoUI() {
  return {
    render() {},
    async ask(p) {
      if (p.type === 'action') return { action: 'roll', dice: 1 };
      if (p.type === 'buy') return true;
      if (p.type === 'build') return true;
      if (p.type === 'chooseBig') return 'commercial';
      if (p.type === 'direction') return p.options[0];
      if (p.type === 'bank') return { action: 'leave' };
      if (p.type === 'stock') return { action: 'leave' };
      if (p.type === 'lottery') return { action: 'leave' };
      if (p.type === 'shop' || p.type === 'merchant') return { action: 'leave' };
      if (p.type === 'magic') return { effect: 'money' };
      if (p.type === 'target') return null;
      return null;
    },
  };
}

test('async loop completes a game without leaving a turn pending', async () => {
  const s = startSession({ seed: 51, config: { dayLimit: 25 } });
  await runGame(s, autoUI());
  assert.equal(s.over, true);
  assert.ok(s.day >= 1);
  assert.equal(s.pending, null);
});
