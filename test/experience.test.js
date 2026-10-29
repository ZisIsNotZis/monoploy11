import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIENCE, AI_INFO_PROMPTS, aiPauseMs, CSS_TIMINGS } from '../src/data/experience.js';
import { pickLine, speak } from '../src/ui/voice.js';

test('experience timing table is the single source of durations', () => {
  assert.equal(EXPERIENCE.stepMs, 300);
  assert.equal(EXPERIENCE.ai.actionMs, 350);
  assert.equal(EXPERIENCE.ai.infoMs, 500);
  assert.equal(EXPERIENCE.floatMs, 2400);
  assert.equal(EXPERIENCE.newsMs, 2400);
  assert.equal(EXPERIENCE.speech.afterAudioMs, 300);
  assert.equal(EXPERIENCE.speech.noAudioMs, 1800);
  assert.equal(EXPERIENCE.speech.mutedMs, 1200);
  assert.equal(CSS_TIMINGS['--step-dur'], '300ms');
  assert.equal(CSS_TIMINGS['--float-dur'], '2400ms');
});

test('AI read-info prompts wait 500ms, action prompts 350ms', () => {
  for (const type of ['buy', 'build', 'chooseBig', 'shop', 'merchant', 'research', 'magic', 'bank', 'lottery', 'target', 'direction']) {
    assert.ok(AI_INFO_PROMPTS.has(type), `${type} should be read-info`);
    assert.equal(aiPauseMs(type), 500);
  }
  assert.equal(aiPauseMs('action'), 350);
  assert.equal(aiPauseMs('response'), 350);
  assert.equal(aiPauseMs('stock'), 350);
});

test('voice line is the full line with the player name, never single characters', () => {
  const p = { name: '阿土伯', charId: 'atubo' };
  for (const event of ['gain', 'lose', 'buy', 'god', 'jail', 'hospital']) {
    const line = pickLine(p, event);
    assert.ok(line.includes('阿土伯'), `${event} line should include name`);
    assert.ok(!line.includes('{name}'), `${event} line should be resolved`);
    assert.ok(line.length > 4, `${event} line should be a sentence`);
  }
});

test('speak resolves a Promise even without a browser audio environment', async () => {
  const result = await speak({ name: '阿土伯', charId: 'atubo' }, 'gain', '阿土伯：钱到手了。');
  assert.deepEqual(result, { audio: false, text: '阿土伯：钱到手了。' });
});
