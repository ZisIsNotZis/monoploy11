import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 为什么要单独测「分层」：blocked-prefix.test.js 只看 HTTP 状态码，
// 而拦截是两层（段名判定 + realpath 判定）叠在一起。实测过：
// 只关掉段名判定（return False），realpath 独自兜住，22 条 HTTP 断言照样全绿。
// 也就是说 HTTP 层测试咬不住「某一层被删了」。这里直接把两层单独拉出来验，
// 哪层被摘掉哪层就红。
//
// serve.py 末尾包了 __main__ 守卫，import 时不会起服务，所以可以安全 import。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// 只有 ASCII：python -c 里写非 ASCII 字面量会 SyntaxError（已踩过）。
const PROBE = `
import json, os, sys
sys.path.insert(0, os.getcwd())
import serve

root = serve.ROOT
out = {}

# 第一层：字面前缀（BLOCKED_PREFIXES）
out['literal_hit'] = serve.is_blocked('/.scratch/af-variant.html')
out['literal_prefixes'] = list(serve.BLOCKED_PREFIXES)

# 第二层上半：段名判定（Windows 大小写不敏感 / 段尾点与空格 / 8.3 短名）
out['seg_lower'] = serve._blocked_segments('/.scratch/x')
out['seg_upper'] = serve._blocked_segments('/.SCRATCH/x')
out['seg_mixed'] = serve._blocked_segments('/.Scratch/x')
out['seg_trailing_dot'] = serve._blocked_segments('/.scratch./x')
out['seg_trailing_space'] = serve._blocked_segments('/.scratch /x')
out['seg_nested'] = serve._blocked_segments('/src/.scratch/x')

# 第二层下半：realpath 判定（大小写/短名/链接都由内核给规范路径）
# #3264：这一层靠的是**文件系统大小写不敏感**（NTFS 上 .SCRATCH 会解析进 .scratch）。
# 在大小写敏感的 fs（ext4 本机）上 realpath 不归并，于是 real_upper 必为 False ——
# 那是平台前提不成立，不是拦截漏了。所以先把前提下测出来，断言里按前提判。
# 但「大小写不敏感」还不够：这条真正需要的是 realpath **回报磁盘上的规范大小写**。
# ntpath.realpath（Windows）走 GetFinalPathNameByHandleW 会归并；Linux 的 posixpath.realpath
# 只做 lstat 拼接，原样保留调用方给的大小写 —— 即使文件系统本身不区分大小写
# （本机 /mnt/d 是 WSL DrvFs：.SCRATCH 存在，但 realpath 回 .SCRATCH）。
# 所以测的是 realpath 归不归并，不是 fs 认不认大小写。
up = os.path.join(root, '.SCRATCH')
out['fs_case_insensitive'] = os.path.isdir(up)
out['realpath_canonicalizes_case'] = os.path.basename(os.path.realpath(up)) == '.scratch'
out['real_upper'] = serve._blocked_realpath(os.path.join(root, '.SCRATCH', 'af-variant.html'))
out['real_mixed_dir'] = serve._blocked_realpath(os.path.join(root, '.Scratch'))
out['real_normal_file'] = serve._blocked_realpath(os.path.join(root, 'index.html'))
out['real_normal_dir'] = serve._blocked_realpath(os.path.join(root, 'src'))
out['real_invalid_sentinel'] = serve._blocked_realpath(serve.INVALID)

print(json.dumps(out))
`;

let probeOut;
let probeErr;
let probeStatus;

test.before(() => {
  const file = path.join(os.tmpdir(), `blocked-layers-${process.pid}.py`);
  writeFileSync(file, PROBE, 'utf8');
  try {
    const res = // -B：不写 .pyc。探针要 import serve，默认会在仓库根生成 __pycache__，
  // 实测那个 .pyc 曾被静态服务当作普通文件发出去（7509B）。
  spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-B', file], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
    });
    probeStatus = res.status;
    probeErr = res.stderr || '';
    probeOut = res.stdout || '';
  } finally {
    rmSync(file, { force: true });
  }
});

const probe = () => {
  assert.equal(probeStatus, 0, `python 探针没跑成：\n${probeErr}`);
  const line = probeOut.trim().split('\n').pop();
  return JSON.parse(line);
};

test('字面层名单：八个内部名字，小写形式', () => {
  const p = probe();
  // 字面层只认小写，所以它自己顶不住大小写变体（靠下面的段名层）。
  // 但它必须覆盖全部内部目录，否则多根拦截只靠 realpath 一层。
  assert.deepEqual(p.literal_prefixes, ['/.scratch', '/.git', '/.praxis2', '/.vscode', '/.idea', '/node_modules', '/__pycache__', '/__invalid_path__']);
  assert.equal(p.literal_hit, true);
});

test('段名判定单独咬住大小写 / 段尾点 / 段尾空格 / 中间段', () => {
  const p = probe();
  assert.equal(p.seg_lower, true, '/.scratch/x 段名层该判拦住');
  assert.equal(p.seg_upper, true, '/.SCRATCH/x 段名层漏了（Windows 大小写不敏感）');
  assert.equal(p.seg_mixed, true, '/.Scratch/x 段名层漏了');
  assert.equal(p.seg_trailing_dot, true, '/.scratch./x 段名层漏了（段尾点被文件系统吃掉）');
  assert.equal(p.seg_trailing_space, true, '/.scratch /x 段名层漏了（段尾空格被吃掉）');
  assert.equal(p.seg_nested, true, '/src/.scratch/x 中间段没判到');
});

test('realpath 判定单独咬住大小写，且不误杀正常路径', () => {
  const p = probe();
  if (p.realpath_canonicalizes_case) {
    assert.equal(p.real_upper, true, '.SCRATCH/... 经 realpath 后应命中被拦目录');
    assert.equal(p.real_mixed_dir, true, '.Scratch 目录本身应命中');
  } else {
    // 前提不成立时如实说清，不用「跳过」假装绿：这条只在大小写不敏感的 fs 上有意义。
    assert.equal(p.real_upper, false, '大小写敏感 fs 上真实路径不该被归并（前提读数的自检）');
    assert.equal(p.real_mixed_dir, false, '大小写敏感 fs 上真实路径不该被归并（前提读数的自检）');
    console.log('realpath 大小写断言在本机不适用：本机 realpath 不归并大小写'
      + `（fs_case_insensitive=${p.fs_case_insensitive}, realpath_canonicalizes_case=false）`
      + '—— 该层只能在 ntpath.realpath 那类平台上取证');
  }
  assert.equal(p.real_normal_file, false, 'index.html 被 realpath 层误杀');
  assert.equal(p.real_normal_dir, false, 'src/ 被 realpath 层误杀');
  assert.equal(p.real_invalid_sentinel, false, 'INVALID 哨兵路径不该再走 realpath 判定');
});

// 退一步的保险：import serve 不能把服务拉起来。
// 之前 serve.py 末尾是无守卫的 serve_forever()，import 会永久阻塞。
test('import serve 不会起服务（__main__ 守卫在）', () => {
  const p = probe();
  assert.ok(p, '探针应已返回，说明 import 没被 serve_forever 卡住');
});
