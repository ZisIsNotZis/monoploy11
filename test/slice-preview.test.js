import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { reachableLandings, landingInfo, landingText } from '../src/engine/insight.js';

const make = () => startSession(createSliceConfig());

test('facility previews preserve the danger and explain final position without advancing state', () => {
  const s = make(), p = s.players[0];
  const before = JSON.stringify(s);
  for (const key of Object.keys(s.rng)) if (typeof s.rng[key] === 'function') s.rng[key] = () => { throw Error('Preview consumed RNG'); };
  const hospital = landingInfo(s, p, '0,5');
  assert.equal(hospital.id, '0,5');
  assert.equal(hospital.facility, 'hospital');
  assert.equal(hospital.effectDestination, '1,5');
  assert.equal(hospital.turnsLost, 2);
  assert.match(landingText(s, p, '0,5'), /失去 2 回合.*医院入口/);
  const jail = landingInfo(s, p, '12,5');
  assert.equal(jail.effectDestination, '11,5');
  assert.match(landingText(s, p, '12,5'), /失去 2 回合.*监狱入口/);
  reachableLandings(s, p, 6);
  assert.equal(JSON.stringify(s), before);
});

test('previews around both facility sidepaths match the real loop including bounce-through and final relocation', async () => {
  const starts = [
    { position: '2,5', lastNode: '2,4', facing: '1,5' },
    { position: '3,5', lastNode: '4,5', facing: '2,5' },
    { position: '10,5', lastNode: '9,5', facing: '11,5' },
    { position: '9,5', lastNode: '8,5', facing: '10,5' },
  ];
  for (const start of starts) for (let steps = 1; steps <= 6; steps++) {
    const reference = make(), rp = reference.players[0];
    Object.assign(rp, start);
    const expected = new Set(reachableLandings(reference, rp, steps).map(id => {
      const info = landingInfo(reference, rp, id);
      return `${info.effectDestination}|${info.facility ?? ''}|${info.turnsLost}`;
    }));
    const actual = new Set(), scripts = [[]];
    while (scripts.length) {
      const script = scripts.shift(), s = make(), p = s.players[0];
      Object.assign(p, start, { forcedDice: steps, cash: 1000000 });
      let at = 0;
      const stop = {};
      try {
        await runGame(s, { render() {}, async step() {}, async ask(prompt) {
          if (prompt.type === 'action') {
            if (prompt.player !== p) throw stop;
            return { action: 'roll', dice: 1 };
          }
          if (prompt.type === 'direction' && prompt.remainingSteps > 0) {
            if (at >= script.length) throw { branch: prompt.options };
            return script[at++];
          }
          if (prompt.type === 'direction') return prompt.options[0];
          return false;
        } });
      } catch (error) {
        if (error.branch) {
          for (const id of error.branch) scripts.push([...script, id]);
          continue;
        }
        if (error !== stop) throw error;
      }
      actual.add(`${p.position}|${p.hospital ? 'hospital' : p.jail ? 'jail' : ''}|${p.hospital || p.jail || 0}`);
    }
    assert.deepEqual(actual, expected, `${start.position}, ${steps} steps`);
  }
});
