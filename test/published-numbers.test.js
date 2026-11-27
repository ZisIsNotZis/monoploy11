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

// #3332：产品字节变了（收购卡只收别人已开张的小店），所以入库的是新量出来的那份表。
// 旧表 balance-3331-300.json 留着当历史：它记的是改前的字节，删掉就无法回答「改了什么」。
// 两张表的胜率数字碰巧一样 —— 这正是这次要证明的事：修的是「目标合法性」，不是数值。
const ARTIFACT = 'docs/evidence/balance-3332-300.json';
const PREVIOUS_ARTIFACT = 'docs/evidence/balance-3331-300.json';
const artifact = () => JSON.parse(read(ARTIFACT));

test('上一张表仍然能读出它量的是改前的字节（历史不能被新表顶掉）', () => {
  // #3331 的病是「表没有字节链路」。#3332 换了产品字节，于是必须有两张表：
  // 一张证明改前是什么，一张证明改后是什么。只留新的那张，读者就无法核对「修了什么」。
  const old = JSON.parse(read(PREVIOUS_ARTIFACT));
  const now = artifact();
  assert.notEqual(old.product['src/data/slice.js'], now.product['src/data/slice.js'],
    '两张表量的是同一版字节 —— 那旧表就没在记录历史');
  // 余额不变本身就是本轮的结论：改的是合法性，不是力度。
  for (const b of now.byStyle) {
    const prev = old.byStyle.find(x => x.id === b.id);
    assert.ok(prev, `旧表缺 ${b.id}`);
    assert.equal(b.winRatePct, prev.winRatePct,
      `${b.id} 的胜率变了（${prev.winRatePct} → ${b.winRatePct}）：`
      + '本轮只改「收购只能收别人的店」，不应改变三条起手的强弱');
  }
});

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

test('入口对「分得开 / 分不开」的说法与区间逐对相符', () => {
  // 上一版的错：工具把「不是两两全重叠」印成「有三格区间不重叠」，我直接把那句抄进了 README。
  // 真实的成对关系是：grow↔take 分得开，grow↔cross 重叠 0.1pp，take↔cross 重叠 8pp。
  // 所以这条不检查我的措辞，而是自己算：入口声称分得开的那对必须真的不相交，
  // 声称重叠的那对必须真的相交。我改一个字而没说真话，它就会红。
  const a = artifact();
  const ci = Object.fromEntries(a.byStyle.map(b => [b.id, b.ci95]));
  const overlaps = (x, y) => Math.max(ci[x].lo, ci[y].lo) <= Math.min(ci[x].hi, ci[y].hi);
  const entry = read('README.md');

  // 名字 → id 的对应也从产品数据取，不手写。
  const byId = Object.fromEntries(a.byStyle.map(b => [b.id, b.name]));
  // 连接词要全认：第一版只认「A与B」，而我把文案写成「A对B」就绕过了整条判据
  // （负对照跑出来的，不是读出来的）。名字之间的任何分隔都归这条管。
  const pairs = [['grow', 'take'], ['grow', 'cross'], ['take', 'cross']];
  for (const [x, y] of pairs) {
    const phrase = new RegExp(`${byId[x]}\\s*(?:与|对|↔|vs|VS)\\s*${byId[y]}`);
    const hit = phrase.exec(entry);
    if (!hit) continue; // 没点名就不归这条管
    // 窗口必须止于本句：用 80 字符的滑动窗口会跨到下一句（下一句谈的是另一对，
    // 常见的词是「重叠」），于是「A 分得开」+「B 重叠」会被读成「A 重叠」。
    // 这是判据自己越界，不是文案错 —— 负对照跑出来的第二次。
    const rest = entry.slice(hit.index);
    const tail = rest.slice(0, rest.search(/[。；\n]/) + 1 || rest.length);
    const saysSeparable = /分得开|不相交/.test(tail);
    const saysOverlap = /重叠|分不开/.test(tail);
    const label = `${byId[x]}↔${byId[y]}`;
    assert.ok(saysSeparable || saysOverlap, `README 点名了 ${label} 就该说清它们分不分得开`);
    if (saysSeparable) assert.equal(overlaps(x, y), false,
      `README 说 ${label} 分得开，但它们的 95% 区间是重叠的`);
    if (saysOverlap) assert.equal(overlaps(x, y), true,
      `README 说 ${label} 重叠，但它们的 95% 区间其实不相交`);
  }

  // 没点名的对不许被一句话扫成「全部分开」或「全部重叠」。
  assert.equal(/区(?:间)?[^\\n]{0,12}(?:都|全|两两)[^\\n]{0,6}不重叠/.test(entry), false,
    'README 用一句话概括了所有区间 —— 先逐对算过再写（上一版就在这里错过）');
});

test('量具的输出只陈述逐对区间，不给一句会失真的总结', () => {
  // 错的源头在工具，不在文案：它只检查「是否两两全重叠」，不成立就印成
  // 「有三格 95% 区间不重叠」—— 而真实情况是只有一对分开。我把那句直接抄进了入口。
  // 这条钉住工具的**输出形式**：必须逐对列出，且不得再出现「全部 / 两两不重叠」。
  // 只看**会打印出去的字符串**：源码注释里会照着旧错句记录它（那是应该保留的历史），
  // 禁的是再把它当结论印给读者。
  const src = read('tools/balance-slice.mjs');
  const printed = [...src.matchAll(/console\.log\(([^)]*)\)/g)].map(m => m[1]).join('\n');
  assert.equal(/三格 95% 区间(?:两两|都)?不重叠/.test(printed), false,
    '量具又在用一句话概括区间关系了');
  assert.equal(/console\.log\([^)]*三格 95% 区间[^)]*两两重叠/.test(src), false,
    '量具还在印「三格两两重叠」这句反向概括');
  assert.match(src, /95% 区间逐对/, '量具应当逐对列出区间关系');
  assert.match(src, /重叠宽/, '重叠的对要给出宽度，否则「重叠」读不出有多大');
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

  // 玩家入口（README）：这三个数不该作为**胜率**出现。
  //
  // 需要注意的巧合：42.7 又是一个真实存在的数——改前的**差距**（42.7 个百分点）。
  // 第一版判据用裸子串，于是它把「差距 42.7 个百分点」也当成了漏网的胜率。
  // 那不是判据太严，是文案把一个已收回的胜率与另一个真数写成了同一个形式；
  // 所以两边都改：判据只咬「当胜率写」（带 % 或三者连写），文案把两个数分开说清。
  const entry = read('README.md');
  const asWinRate = WITHDRAWN.map(n => new RegExp(`${n}\\s*%`)).filter(re => re.test(entry))
    .map(re => re.source);
  assert.deepEqual(asWinRate, [],
    'README 把已收回的胜率当胜率写了（带 %）：玩家入口不放历史胜率');
  assert.equal(/42\.0[^\n]{0,20}39\.0[^\n]{0,20}42\.7/.test(entry), false,
    'README 把已收回的三个数当成一组数写在一起了');

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
