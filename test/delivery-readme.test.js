import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 主管的观察：README 仍把 `.scratch` 对照页和旧 `tools` 当公开入口，第一次来的玩家
// 走不到这次已复验的入口。根因不是 README 写得差，而是**没有任何东西把 README 和
// 交付清单绑在一起**：`.scratch/af-variant.html` 在本树里真实存在（所以写上去看着没错），
// 却只在交付集里以对照夹具的形式存在；`tools/play.mjs` 一度连交付集都没有，
// 命令在干净检出里直接 MODULE_NOT_FOUND。
//
// 这条测试把两个问题都变成红的：README 提到一个仓库路径，它就必须能被交付清单解释
// （lock/doc/tool 点名，或 test 通配），否则玩家照着做会遇到「文件不存在」。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DELIVERY = path.join(ROOT, 'support/full-game/DELIVERY.txt');
const README = path.join(ROOT, 'README.md');

function manifest() {
  const entries = [];
  for (const raw of readFileSync(DELIVERY, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [kind, ...rest] = line.split(/\s+/);
    entries.push({ kind, target: rest.join(' ') });
  }
  return entries;
}

// 只检查**玩家照着敲的命令**：bash 代码块里的脚本路径。理由：目录引用（docs/）、
// 历史提及（「原先住 .scratch/serve-variant.py」）、以及明确标注「不在交付集」的旧
// verify 脚本都不是入口，把它们算进来会让这条测试失声——它该咬的是「敲下去会
// command not found / MODULE_NOT_FOUND」这一种。
function commandPaths(markdown) {
  const out = new Set();
  for (const block of markdown.matchAll(/```bash\n([\s\S]*?)```/g)) {
    for (const raw of block[1].split(/\r?\n/)) {
      const line = raw.split('#')[0].trim();
      if (!line) continue;
      for (const token of line.split(/\s+/)) {
        // 只留看上去是仓库内文件的操作数（带扩展名的相对路径）。
        if (!/\.(?:py|mjs|js|html|css)$/.test(token)) continue;
        if (token.startsWith('/') || token.includes('://')) continue;
        // ${PORT} 之类的占位符跳过；URL 里嵌的路径不是文件系统路径。
        if (token.includes('$')) continue;
        out.add(token);
      }
    }
  }
  return out;
}

// 清单里的通配（今天只有 `test test/*.test.js`）要真的按通配解释，而不是只认
// 「basename 恰好是 *」。旧写法把 `*.test.js` 当成字面文件名，于是「README 提到
// 一个确实随检出走的测试文件」会被判成未解释——错的不是 README，是解释器。
// 反过来也必须收紧：`src/*.js` 不能把 `src/data/mao.js` 算进去（* 不跨目录）。
const globToReg = g => new RegExp('^' + g
  .split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');

function covered(target, entries) {
  return entries.some(({ target: t }) => t === target ||
    (t.includes('*') && globToReg(t).test(target)));
}

test('README 里敲的每个脚本都能被交付清单解释', () => {
  const entries = manifest();
  const missing = [...commandPaths(readFileSync(README, 'utf8'))]
    .filter(p => !covered(p, entries));
  assert.deepEqual(missing, [],
    `README 让人敲的脚本不在交付集里（干净检出会 command not found）：${missing.join(', ')}`);
});

test('README 点名的脚本在仓库里真实存在且能被执行', () => {
  const entries = manifest();
  for (const { kind, target } of entries) {
    if (kind === 'tool') assert.ok(existsSync(path.join(ROOT, target)), `${target} 被清单点名但不存在`);
  }
  // 解释器：干净检出里只有 python3，没有 `python`。/ 这里必须扫**代码块里的命令行**，
  // 不能只扫反引号内文本——第一版就是只扫反引号，所以把入口命令改回 `python serve.py`
  // 仍然全绿（牙没响，绿不是被咬过的绿）。
  const text = readFileSync(README, 'utf8');
  const commands = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]).join('\n');
  assert.ok(!/(?:^|[\s`])python (?!-)/m.test(commands),
    'README 的 bash 代码块不应使用 `python …`（干净检出里只有 python3）');
});

// 牙：解释器本身要有正反两面。旧 covered() 在这两组里会各自答错一次——
// 它把 `test/foo.test.js` 当成未解释（因为只认 basename==='*'），
// 而若改成「任意通配前缀匹配」，`src/*.js` 又会把子目录文件算进去。
test('清单通配按目录解释，不跨目录，也不只认 * 字面', () => {
  const entries = [{ kind: 'test', target: 'test/*.test.js' }, { kind: 'lock', target: 'src/*.js' }];
  assert.equal(covered('test/a.test.js', entries), true, '同目录带扩展名的通配应当命中');
  assert.equal(covered('test/sub/a.test.js', entries), false, '通配不应跨目录');
  assert.equal(covered('src/data/maps/index.js', entries), false, 'src/*.js 不能命子目录文件');
  assert.equal(covered('src/main.js', entries), true, 'src/*.js 应命中同级文件');
  assert.equal(covered('src/mainxjs', entries), false, '点号必须字面匹配，不能当任意字符');
});

test('README 的对照页描述与交付集一致', () => {
  const entries = manifest();
  const text = readFileSync(README, 'utf8');
  // 对照页在交付集里是 support/compare 的夹具，由 clean-checkout.py 放到 .scratch/。
  // 因此 README 提到它时必须同时点名 serve-variant.py 与 support/compare。
  if (text.includes('af-variant.html')) {
    assert.ok(covered('support/serve-variant.py', entries), 'README 提对照页，却没在清单里点名对照服务');
    assert.ok(entries.some(e => e.target.startsWith('support/compare/')),
      'README 提对照页，却没在清单里点名对照夹具');
  }
});
