import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// README 打开的第一屏就链 [目标](docs/2_GOAL.md)、[街角生意](docs/6_SLICE.md)、
// [RESULT-3278](docs/evidence/RESULT-3278.md)。此前 2_GOAL 与 0_ROADMAP 都不在交付清单里，
// 于是「从干净检出读说明」的第一步就是死链 —— 而 check-delivery.py 只核产品字节与清单点名
// 的文件，不会发现文档链到了清单外面。这条测试补的是那个缺口：从 README 出发走完整个
// markdown 链接闭包，每一个目标要么在交付清单里，要么是明确标注的本地证据（.scratch/）。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DELIVERY = path.join(ROOT, 'support/full-game/DELIVERY.txt');
const README = path.join(ROOT, 'README.md');

function manifest() {
  const out = [];
  for (const raw of readFileSync(DELIVERY, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [kind, ...rest] = line.split(/\s+/);
    out.push({ kind, target: rest.join(' ') });
  }
  return out;
}

// 只认「会被人点开的相对链接」。http(s)、锚点都不是文件路径。
function linksIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (/^[a-z]+:/i.test(href) || href.startsWith('#')) continue;
    out.add(href.split('#')[0]);
  }
  return out;
}

function resolve(fromRel, href) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), href));
}

function makeGlobs(entries) {
  return entries.filter(e => e.target.includes('*')).map(e => new RegExp('^' + e.target
    .split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$'));
}

// 本地证据目录：`6_SLICE` 与 readiness 页刻意指向 `.scratch/`（原件不入库，清理前须手工归档）。
// 它不是交付集的一部分，所以闭包在这里停下，但**必须显式**：任何别的清单外路径都算漏水，
// 而不是「大概是本地文件」。
const localOnly = rel => rel.startsWith('.scratch/');

function walk(start, entries = manifest()) {
  const named = new Set(entries.filter(e => !e.target.includes('*')).map(e => e.target));
  const globs = makeGlobs(entries);
  const seen = new Set();
  const outside = new Set();
  const queue = [start];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!existsSync(path.join(ROOT, rel))) {
      outside.add(`${rel} (missing)`);
      continue;
    }
    if (!rel.endsWith('.md')) continue;
    for (const href of linksIn(readFileSync(path.join(ROOT, rel), 'utf8'))) {
      const target = resolve(rel, href);
      if (localOnly(target)) continue;
      if (!named.has(target) && !globs.some(g => g.test(target))) outside.add(`${rel} -> ${target}`);
      queue.push(target);
    }
  }
  return { seen, outside: [...outside].sort() };
}

test('从 README 出发的文档链接闭包全部落在交付清单内', () => {
  const { seen, outside } = walk('README.md');
  assert.deepEqual(outside, [],
    `这些文档链接指向交付清单之外（干净检出里是死链）：\n  ${outside.join('\n  ')}`);
  // 闭包至少要走完 README 那三条，否则测试会因为「什么也没读到」而假绿。
  for (const must of ['docs/2_GOAL.md', 'docs/6_SLICE.md', 'docs/evidence/RESULT-3278.md']) {
    assert.ok(seen.has(must), `README 的直接链接 ${must} 没有被走到，闭包遍历本身坏了`);
  }
});

// 牙：判定本身要能说「不」。喂一份把 2_GOAL 删掉的清单给同一个 walk，它必须点名那条链接。
// 上一版只在测试里重算了一遍「不在集合里」——那是复述实现，不是咬。
// 也不靠真删文件：文件缺失会让 existsSync 先判 missing，测到的就不是清单判据了。
test('清单里拿掉 2_GOAL 后，同一个遍历必须把它报成清单外', () => {
  const pruned = manifest().filter(e => e.target !== 'docs/2_GOAL.md');
  assert.ok(existsSync(path.join(ROOT, 'docs/2_GOAL.md')),
    '牙的前提：这份文档真实存在，所以只能被清单判掉，不能靠文件缺失蒙对');
  const { outside } = walk('README.md', pruned);
  assert.ok(outside.includes('README.md -> docs/2_GOAL.md'),
    `遍历没有点名缺项，报的是：${JSON.stringify(outside)}`);
});
