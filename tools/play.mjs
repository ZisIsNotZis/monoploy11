#!/usr/bin/env node
// JSONL protocol: one JSON command in, one JSON result out. No browser required.
import { createInterface } from 'node:readline';
import { createDebugSession } from '../src/debug/session.js';

const args = process.argv.slice(2);
const value = (key, fallback) => {
  const index = args.indexOf(`--${key}`);
  return index < 0 ? fallback : args[index + 1];
};
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);

try {
  let config = { seed: Number(value('seed', 1)) };
  if (!Number.isFinite(config.seed)) throw new Error('--seed must be a finite number.');
  if (args.includes('--slice')) {
    const { createSliceConfig } = await import('../src/data/slice.js');
    config = createSliceConfig(config);
  }
  const session = await createDebugSession(config);
  emit({ ok: true, observation: session.observe() });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    try {
      const command = JSON.parse(line);
      let observation;
      if (command.op === 'observe') observation = session.observe();
      else if (command.op === 'answer') observation = await session.answer(command.value, command.promptId);
      else if (command.op === 'auto') observation = await session.auto(command.count ?? 1);
      else throw new Error('Unknown op; use observe, answer, or auto.');
      emit({ ok: true, observation });
    } catch (error) {
      emit({ ok: false, error: error.message });
    }
  }
} catch (error) {
  emit({ ok: false, error: error.message });
  process.exitCode = 1;
}
