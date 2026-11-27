import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #3331 的复盘：这一轮报错的三个数，错的都不是「算错了」，而是**公布的数与产生它的东西
// 之间没有链路**：
//   · 42.0 / 39.0 / 42.7 是真跑出来的，但跑它的脚本在 `.scratch/`，量的是固定对手顺序；
//     没有一份入库的东西能回答「这张表量的是哪版字节、按什么协议」。
//   · RESULT-3331 里那段 `E  product  ran exactly slice-entry-3330 …` 是照着设计意图
//     手写的示例，从没与 verify-receipt.py 的真实输出对过，于是它一直指向上一把锁。
//   · README 的「三条起手实测胜率接近」与「它们一样能赢」在数字被收回之后还留着，
//     因为**没有任何判据**把入口文案与证据绑在一起。
//
// 所以这里不检查「数对不对」（那要跑 900 局），而是检查**公布的东西能追到源头**：
//   ① 入库的胜率表（balance-3331-300.json）必须是当前 `src/data/slice.js` 字节跑出来的；
//   ② README / 6_SLICE 里公布的百分比必须与那份表逐位相同；
//   ③ RESULT-3331 里每个 `E  product` 示例行必须等于 verify-receipt.py 现在的真实输出；
//   ④ 被收回的那三个数（42.0 / 39.0 / 42.7）不许再作为「现状」出现在玩家入口，
//      而引用它的报告必须在同一文件里出现「收回 / 不成立」。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EVIDENCE = path.join(ROOT, 'docs', 'evidence');
const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = rel => createHash('sha256')
  .update(readFileSync(path.join(ROOT, rel))).digest('hex');

const ARTIFACT = 'docs/evidence/balance-3331-300.json';
const artifact = () => JSON.parse(read(ARTIFACT));

test('入库的胜率表是当前产品字节跑出来的，不是哪一版留在文件里的', () => {
  const a = artifact();
  assert.ok(a.product && a.product['src/data/slice.js'],
    `${ARTIFACT} 没有记录量的是哪版 src/data/slice.js —— 那就是 #3330 那张表的病`);
  assert.equal(a.product['src/data/slice.js'], sha256('src/data/slice.js'),
    '胜率表量的是别的字节：产品改过之后必须重跑 `node tools/balance-slice.mjs --seeds 150 --json`，'
    + '不能留着一张旧表继续为现在的树背书');
  assert.equal(a.failures.length, 0, `表里记着失败局：${JSON.stringify(a.failures.slice(0, 3))}`);
  assert.equal(a.config.gamesPerStyle, 300, '公布的口径是每格 300 局，表的配置要与之相同');
});

test('报表自身自洽：胜率 = 胜局 / 局数，且现金真是产品里的那个数', async () => {
  const a = artifact();
  const { SLICE_STYLES } = await import('../src/data/slice.js');
  for (const b of a.byStyle) {
    assert.equal(b.games, a.config.gamesPerStyle, `${b.id} 的局数与口径不符`);
    assert.equal(b.wins / b.games, b.winRate, `${b.id} 的 winRate 与 wins/games 对不上`);
    const style = SLICE_STYLES.find(s => s.id === b.id);
    assert.equal(b.cash, style.cash, `${b.id} 表里写 ${b.cash}，产品里是 ${style.cash}`);
  }
});

test('README 描述的起手牌就是产品里的那三张', async () => {
  // 这条不是洁癖：我在这一轮写 README 时凭记忆把 grow 写成「翻修+旺季」（漏了定步），
  // 而它就在一张正确胜率表的上面 —— 同一段文案里可以一半是核过的数、一半是回忆。
  // 卡表是产品数据，文案要么从它生成，要么被它咬住。
  const { SLICE_STYLES, SLICE_CARDS } = await import('../src/data/slice.js');
  const entry = read('README.md');
  for (const s of SLICE_STYLES) {
    const names = s.hand.map(k => SLICE_CARDS[k].name).join('+');
    assert.ok(entry.includes(`${s.name} ${names}`),
      `README 没有把 ${s.name} 的起手牌写成 ${names}（产品数据）`);
  }
});

test('README 与 6_SLICE 公布的百分比来自那份表', () => {
  const a = artifact();
  const pct = Object.fromEntries(a.byStyle.map(b => [b.id, b.winRatePct]));
  const gap = ((Math.max(...a.byStyle.map(b => b.winRate))
    - Math.min(...a.byStyle.map(b => b.winRate))) * 100).toFixed(1);

  const entry = read('README.md');
  for (const id of Object.keys(pct)) {
    assert.ok(entry.includes(pct[id]),
      `README 没有写出 ${id} 的实测胜率 ${pct[id]} —— 入口文案与证据脱节是有过前科的`);
  }
  assert.ok(entry.includes(`${gap} 个百分点`), `README 没有写出最大差距 ${gap} 个百分点`);
  assert.ok(entry.includes('RESULT-3331'),
    'README 引用了胜率就必须给出能让读者核对的那份报告');

  const slice = read('docs/6_SLICE.md');
  for (const id of Object.keys(pct)) {
    assert.ok(slice.includes(pct[id]), `docs/6_SLICE.md 的规则节没有写出 ${id} 的 ${pct[id]}`);
  }
  assert.ok(slice.includes('RESULT-3331'), 'docs/6_SLICE.md 引用了胜率就必须点到当前证据');
});

test('RESULT-3331 里的 E 项示例行就是 verify-receipt.py 现在的输出', () => {
  const doc = read('docs/evidence/RESULT-3331.md');
  const quoted = [...doc.matchAll(/^E {2}product {2}(.+)$/gm)].map(m => m[1].trim());
  assert.ok(quoted.length > 0, '报告里没有 E 项示例 —— 读者就看不到回执是怎么自证的');

  const r = spawnSync(PY, ['-B', 'support/full-game/verify-receipt.py',
    'docs/evidence/receipt-3331-final'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, `verify-receipt.py 没跑过：${r.stdout}${r.stderr}`);
  const real = [...r.stdout.matchAll(/^E {2}product {2}(.+)$/gm)].map(m => m[1].trim());
  assert.equal(real.length, 1, 'verify-receipt.py 没有打印 E 项');
  for (const line of quoted) {
    assert.equal(line, real[0],
      '报告里的 E 示例与真实输出不一致 —— 示例也会过期，而且过期的示例最像证据');
  }
});

test('被收回的数字不许当成现状，引用它的报告必须在同一处说明收回', () => {
  const WITHDRAWN = ['42.0', '39.0', '42.7'];
  const current = artifact().byStyle.map(b => b.winRatePct);
  for (const n of WITHDRAWN) {
    assert.equal(current.includes(`${n}%`), false, `${n}% 重新出现在入库的胜率表里`);
  }

  // 玩家入口（README）：一概不该出现 —— 它不带历史上下文，读者只会把它当成现在的数。
  const entry = read('README.md');
  assert.deepEqual(WITHDRAWN.filter(n => entry.includes(n)), [],
    'README 还在用已收回的 42.0 / 39.0 / 42.7 —— 玩家入口不是放历史数字的地方');

  // 规则文档（6_SLICE）：可以引用（「已收回 X，现在是 Y」比删掉更有用），
  // 但**同一行**必须写明收回，否则就是又把它当现状写了一遍。
  // 注：报告的表格不适用这一条 —— 那里天生逐行列数，收回写在小节标题或文首横幅里。
  for (const [i, line] of read('docs/6_SLICE.md').split(/\r?\n/).entries()) {
    const hits = WITHDRAWN.filter(n => line.includes(n));
    if (!hits.length) continue;
    assert.match(line, /收回|不成立/,
      `docs/6_SLICE.md:${i + 1} 把已收回的 ${hits.join(' / ')} 写成了现状（同一行没有说明收回）`);
  }

  // 报告里可以引用（那是历史与复盘），但同一份文件必须写明收回。
  for (const rel of ['docs/evidence/RESULT-3330.md', 'docs/evidence/RESULT-3331.md']) {
    const text = read(rel);
    assert.ok(text.includes('42.0'), `${rel} 应当保留被收回的那三个数，否则读者查不到改了什么`);
    assert.match(text, /收回|不成立/,
      `${rel} 引用了已收回的数字，却没有在同一份文件里说明它被收回`);
  }
  assert.ok(read('docs/evidence/RESULT-3330.md').includes('RESULT-3331'),
    '被更正的报告必须链到更正它的那份，否则下一个人还会照着旧表做事');
});
