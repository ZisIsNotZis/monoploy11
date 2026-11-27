import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #3341：supervisor 的原话是「发布入口写的是 .scratch 下的探针，干净检出没有那个路径」。
//
// 真实被咬的四处：
//   README.md                  用 `.scratch/3340/` 下的 mislead-fixed 量具复算   量具其实早在 support/probe-3340/
//   RESULT-3338 / RESULT-3339  用 `.scratch/3338/` 下的 screens 量具复现         未入库；本片搬进 support/probe-3338/
//   RESULT-3340                同第一行
//   variant-entry-and-risk.md  开头写「全部读数都能用 tools/verify-grow-panel.mjs 复现」——
//                             那个文件**在本仓历史上从未存在过**（`git log --all` 为空），整篇开头的承诺从第一天起就是空的。
//
// ## 这条判据的第一个版本自己也是错的（被 clean-checkout 咬出来的）
// 我最初用 `git ls-files` 判断「文件在不在仓库里」。它在我的工作树里跑绿，
// 而 `clean-checkout.py` 建出的树**没有 .git** —— 于是判据在它最该工作的那个环境里
// 直接抛 `fatal: not a git repository`，整棵干净检出被判 SUITE FAILED。
// 那正是这条判据要防的病（「只在我机器上成立」），只不过这次犯病的是判据自己。
//
// 现在「干净检出有什么」由**交付清单本身**定义：DELIVERY.txt 的 lock/doc/tool 行，
// 加上 clean-checkout.py 会一起搬过去的 test/。那正是读者拿到的文件集。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LIST = path.join(ROOT, 'support', 'full-game', 'DELIVERY.txt');

function manifestEntries() {
  return readFileSync(LIST, 'utf8').split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const [kind, ...rest] = l.split(/\s+/); return { kind, target: rest.join(' ') }; });
}

const shippedDocs = () => manifestEntries()
  .filter(e => e.kind === 'doc' && e.target.endsWith('.md'))
  .map(e => e.target);

// 「干净检出里有没有这个文件」= 它在交付清单里，或它是 clean-checkout.py 一并搬的 test/ 文件。
function cleanCheckoutFiles() {
  const files = new Set(manifestEntries().filter(e => !e.target.includes('*')).map(e => e.target));
  const walk = dir => {
    const abs = path.join(ROOT, dir);
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs)) {
      const rel = `${dir}/${name}`;
      if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
      else files.add(rel);
    }
  };
  walk('test');
  return files;
}

// `node <file>` / `python3 -B <file>`。带 `-e`/`-` 的不是文件，跳过。
const CMD = /\b(?:node|python3)\s+(?:-[A-Za-z]\s+)*(?<file>(?:\.\.?\/)?[\w./-]+\.(?:mjs|js|py))/g;

const resolveRef = (docRel, ref) => {
  const clean = ref.replace(/^\.\//, '');
  if (clean.startsWith('../')) return path.normalize(path.join(path.dirname(docRel), clean)).split(path.sep).join('/');
  return clean;
};

test('交付集文档里的命令，指向的文件必须在干净检出里', () => {
  const docs = shippedDocs();
  assert.ok(docs.length >= 5, `交付集里的文档太少（${docs.length}），这条判据会空过`);
  assert.ok(docs.includes('README.md'), 'README.md 必须仍在交付集里 —— 它是玩家的入口');

  const files = cleanCheckoutFiles();
  assert.ok(files.has('README.md') && files.has('src/engine/insight.js'),
    '交付清单读出来的文件集不对（连 README 或 insight.js 都没有），下面每条断言都会空过');

  const problems = [];
  let seen = 0;
  for (const rel of docs) {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) continue;              // 缺文件归 check-delivery.py 管，这里不重复报
    for (const m of readFileSync(abs, 'utf8').matchAll(CMD)) {
      const file = m.groups.file;
      if (file.includes('${') || file.endsWith('.pyc')) continue;
      seen++;
      const want = resolveRef(rel, file);
      if (!files.has(want)) problems.push(`${rel}: \`${m[0]}\` → ${want} 不在交付集里`);
    }
  }
  assert.ok(seen > 0, '文档里应当至少出现一条命令（否则这条判据空过）');
  assert.deepEqual(problems, [],
    `读者会照着敲、但干净检出上跑不了：\n${problems.join('\n')}`);
});

test('负对照：当年那三行确实会被这条判据咬住', () => {
  // 不跑产品：只证明正则对真实发生过的写法会响，避免「改好了」其实只是判据太松。
  const old = [
    '复算：`node .scratch/3340/mislead-fixed.mjs 40`、`node --test test/landing-own-shop.test.js`。',
    '| 真局文本 | `node .scratch/3338/screens.mjs grow 9` | 印出改后的两屏原文 |',
    '```bash\nnode tools/verify-grow-panel.mjs\n```',
  ];
  for (const line of old) {
    assert.ok([...line.matchAll(CMD)].length > 0, `判据咬不到这行，说明它太松了：${line}`);
  }
  // 反向防误伤：合法命令与历史散文都不能被咬。
  assert.equal([...'复算：`node support/probe-3340/mislead-fixed.mjs 40`'.matchAll(CMD)].length, 1);
  assert.equal([...'历史：这个入口原先住 `.scratch/serve-variant.py`。'.matchAll(CMD)].length, 0,
    '散文里的历史路径被误咬 —— 那会逼人删掉沿革');
  assert.equal([...'打开 `http://127.0.0.1:8001/.scratch/af-variant.html`'.matchAll(CMD)].length, 0, 'URL 被误咬');
});

test('.scratch 不是可运行的入口：没有任何交付文档把 .scratch 下的文件写成命令', () => {
  // 上一条只问「文件在不在交付集里」。.scratch 里可能真有同名文件（我的工作树里就有），
  // 但读者没有，所以再钉一句：命令里根本不许出现 .scratch。
  const problems = [];
  for (const rel of shippedDocs()) {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) continue;
    for (const m of readFileSync(abs, 'utf8').matchAll(CMD)) {
      if (m.groups.file.includes('.scratch/')) problems.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(problems, [], `.scratch 不入库，不许写成命令：\n${problems.join('\n')}`);
});
