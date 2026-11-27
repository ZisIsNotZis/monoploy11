import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #3322：授权判的是「真正打开的那个规范文件」，不是两份字面路径是不是都落在仓里。
//
// 为什么需要单独一个文件：上一轮的判据是
//   ① URL 在逐文件白名单里；② abspath 在仓内；③ 最后一段不是符号链接；④ 是个文件。
// 这四条全都可以同时成立，而实际打开的字节却不是白名单里那个文件 —— 只要**父目录**
// 是个符号链接。`support/compare -> src` 时，`/.scratch/af-variant.html` 的名字仍在册、
// 真路径仍在仓内、最后一段是普通文件，于是旧代码会发出 `src/` 下的东西。
// 仓内互指那一轮只换了最后一段（fixture 本身做成链），正好绕开了这个形状。
//
// 这一轮把「解析结果必须等于 真根 + 同一个相对路径」作为收口，于是父目录这一层也断了。
// 而要把这条和其他几条分开，只能拿**仓内**的目标当诱饵：指向仓外的链已经被
// `_inside_root` 拦下，指向仓内别处的链才是唯一能区分两种判据的形状。
//
// 另一个形状是「解析失败」。以前 translate_path 把失败换成 INVALID 哨兵，
// 落不落到 404 取决于**仓库根恰好没有** `__invalid_path__` 这个文件；
// 有人在根目录写一个，白名单里但盘上不存在的 URL 就会 200 发出那个文件的内容。
// 现在 send_head 直接问解析结果，失败就是 404，不看盘上有谁。
//
// 两条都用**临时假根**：不改真仓库的目录结构，也不需要占位文件碰巧存在或不存在。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VARIANT = path.join(ROOT, 'support', 'serve-variant.py');

function py(code) {
  const r = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    ['-B', '-c', code], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (r.status !== 0) throw new Error(`python 失败(${r.status}): ${r.stderr}`);
  return r.stdout.trim();
}

// 把模块的根换成假根。ROOT / INVALID / COMPARE_DIR / SCRATCH_DIR / BLOCKED_ROOTS
// 都是模块级常量，注入之后所有判定函数都按假根算 —— 这正是要的：
// 判据必须是「相对于根」的函数，而不是把真仓库的名字写死在里面。
const PRELUDE = fakeRoot => `
import importlib.util, sys, os
spec = importlib.util.spec_from_file_location('sv', r'${VARIANT.replace(/\\/g, '/')}')
m = importlib.util.module_from_spec(spec)
sys.modules['sv'] = m
spec.loader.exec_module(m)
root = r'${fakeRoot.replace(/\\/g, '/')}'
m.ROOT = root
m.INVALID = os.path.join(root, '__invalid_path__')
m.SCRATCH_DIR = os.path.join(root, '.scratch')
m.COMPARE_DIR = os.path.join(root, 'support', 'compare')
m.BLOCKED_ROOTS = tuple(os.path.join(root, p.lstrip('/')) for p in m.BLOCKED_PREFIXES)
m.SERVABLE_EXACT = frozenset({'/', '/index.html', '/src/main.js', '/.scratch/af-variant.html'})
`;

/** 建一个最小假根：首页、一个产品模块、两个夹具位置、以及哨兵文件。 */
function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sv-identity-'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'support', 'compare'), { recursive: true });
  mkdirSync(path.join(root, '.scratch'), { recursive: true });
  writeFileSync(path.join(root, 'index.html'), 'HOME');
  writeFileSync(path.join(root, 'src', 'main.js'), 'export const MAIN = 1;\n');
  writeFileSync(path.join(root, 'support', 'compare', 'af-variant.html'), 'FIXTURE');
  // 哨兵：内容可辨认，一旦被发出去就看得见。
  writeFileSync(path.join(root, '__invalid_path__'), 'SENTINEL-PWNED');
  return root;
}

test('前置：假根里 /.scratch/af-variant.html 正常解析到 support/compare 那份（否则下面的否定是空转）', () => {
  const root = makeRoot();
  try {
    const out = py(PRELUDE(root) + `
print(m.resolve_servable_file('/.scratch/af-variant.html'))
`);
    assert.equal(out, path.join(root, 'support', 'compare', 'af-variant.html'),
      '前置不成立：这条 URL 在假根里本来就解不出来，后面的「拒」不算数');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('#3322 父目录被换成仓内符号链接时，白名单里的名字不再发出别的文件', () => {
  const root = makeRoot();
  try {
    // 诱饵目录在**仓内**（所以 `_inside_root` 拦不住），里面放一个同名文件。
    // 这样「只查在不在仓内」的判据会放行，只有「解析结果必须是同一个相对路径」会拒。
    const decoy = path.join(root, 'decoy');
    mkdirSync(decoy);
    writeFileSync(path.join(decoy, 'af-variant.html'), 'DECOY-BYTES');

    const compare = path.join(root, 'support', 'compare');
    // 换个名字，避免在 Windows 上删目录时先删链接目标；这里整目录一起换成链接。
    rmSync(compare, { recursive: true, force: true });
    symlinkSync(decoy, compare, 'dir');

    const literal = path.join(compare, 'af-variant.html');
    const out = py(PRELUDE(root) + `
import json, os
print(json.dumps({
  'literal_is_file': os.path.isfile(r'${literal.replace(/\\/g, '/')}'),
  'literal_is_link': os.path.islink(r'${literal.replace(/\\/g, '/')}'),
  'inside_root': m._inside_root(r'${literal.replace(/\\/g, '/')}'),
  'resolved': m.resolve_servable_file('/.scratch/af-variant.html'),
  'sha_target': open(r'${path.join(decoy, 'af-variant.html').replace(/\\/g, '/')}').read(),
}))
`);
    const p = JSON.parse(out);
    // 逐条确认「旧判据全都放行」—— 否则这条测试可能只是被别的检查顺带拦住了。
    assert.equal(p.literal_is_file, true, '诱饵文件不在盘上，这条检查没有意义');
    assert.equal(p.literal_is_link, false, '最后一段本身是链：那样考的是上一轮的判据，不是这一条');
    assert.equal(p.inside_root, true, '诱饵跑到仓外了：那样 `_inside_root` 就能拦住，区分不了判据');
    assert.equal(p.resolved, null,
      `父目录是仓内符号链接时仍解析到 ${p.resolved} —— 实际发出的字节会是 ${JSON.stringify(p.sha_target)}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('#3322 解析失败就是 404，且不读占位文件（哨兵内容不会被发出去）', () => {
  const root = makeRoot();
  try {
    // 让这条 URL 在盘上真的解不出来：两个候选位置都没有那份夹具。
    rmSync(path.join(root, 'support', 'compare', 'af-variant.html'));
    // 哨兵文件留在根上 —— 旧实现正是靠「它不存在」才落到 404。

    const out = py(PRELUDE(root) + `
class Fake(m.Handler):
    def __init__(self, url):
        self.path = url
        self.codes = []
    def send_error(self, code, msg=None):
        self.codes.append(code)
    def send_response(self, code, message=None):
        self.codes.append(code)

h = Fake('/.scratch/af-variant.html')
ret = h.send_head()
print('RET_NONE', ret is None)
print('CODES', h.codes)
print('RESOLVED', m.resolve_servable_file('/.scratch/af-variant.html'))
print('SENTINEL_EXISTS', __import__('os').path.isfile(m.INVALID))
`);
    assert.match(out, /SENTINEL_EXISTS True/, '前置不成立：哨兵文件不在，这条检查退化成普通 404');
    assert.match(out, /RESOLVED None/, '解析失败却给出了一个路径');
    assert.match(out, /RET_NONE True/, 'send_head 返回了 not None：父类会继续去开文件');
    assert.match(out, /CODES \[404\]/, `期望 send_head 直接 404，实际 ${out}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('#3322 正向：假根里四个白名单入口都还发得出去（收口没把自己堵死）', () => {
  const root = makeRoot();
  try {
    const out = py(PRELUDE(root) + `
import json
print(json.dumps({p: (m.resolve_servable_file(p) is not None)
  for p in ['/', '/index.html', '/src/main.js', '/.scratch/af-variant.html']}))
`);
    assert.deepEqual(JSON.parse(out),
      { '/': true, '/index.html': true, '/src/main.js': true, '/.scratch/af-variant.html': true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
