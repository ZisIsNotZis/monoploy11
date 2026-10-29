import test from 'node:test';
import assert from 'node:assert/strict';
import { startSession, runGame } from '../src/engine/flow.js';
import { current } from '../src/engine/game.js';

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

test('equal-poor card resolves on a valid target and leaves the hand', async () => {
  const s = startSession({ seed: 71 });
  const p = current(s);
  const q = s.players.find(x => x.id !== p.id);
  p.position = '2,2'; q.position = '2,2';
  p.cards = ['equalpoor'];
  let used = false;
  const ui = {
    render() {},
    async ask(x) {
      if (x.type === 'action') return used ? { action: 'roll', dice: 1 } : { action: 'card', index: 0 };
      if (x.type === 'target') return x.players?.[0]?.id ?? null;
      if (x.type === 'buy') return false;
      if (x.type === 'build') return false;
      if (x.type === 'chooseBig') return null;
      if (x.type === 'direction') return x.options[0];
      if (x.type === 'bank' || x.type === 'stock' || x.type === 'lottery' || x.type === 'shop' || x.type === 'merchant') return { action: 'leave' };
      if (x.type === 'magic') return { effect: 'money' };
      return null;
    },
  };
  const orig = ui.ask;
  ui.ask = async x => { if (x.type === 'action' && !used) { used = true; return { action: 'card', index: 0 }; } return orig(x); };
  await runGame(s, ui);
  assert.equal(s.over, true);
  assert.ok(!p.cards.includes('equalpoor'));
});
