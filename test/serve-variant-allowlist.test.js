import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync,
         unlinkSync } from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #3320：对照入口（8001）的隔离必须对**将来才出现的文件**也成立。
//
// 上一版把 `/src/` 整段前缀放行。那不是「白名单」，是「范围小一点的黑名单」：
// 之后任何落进 src/ 的文件都会自动变成可下载，没有人需要再为它做一次决定。
// 实测的现状：`/src/debug/session.js` 200（调试会话），`/src/sim.js` 200（测试模拟器），
// `/src/debug/` 与 `/src/data/maps/` 200 且是**目录列表**。
//
// 这个文件钉住三件事：
//   ① 逐文件白名单 == 两张页面真实 import 图（不靠手抄；产品加模块忘登记就红并指名）；
//   ② 现在不在白名单里的东西取不到（拿真实存在的 src/debug/session.js 当证据）；
//   ③ **现在还不存在的文件**也取不到 —— 在 src/ 里写一个假文件再取它。
//      第 ③ 条是这一轮的重点：只有它能把「前缀放行」和「逐文件放行」分开。
//      没有它，把 is_servable 改回 `norm.startswith('/src/')` 时前两条照样全绿。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VARIANT = path.join(ROOT, 'support', 'serve-variant.py');

function freePort() {
  const base = 19000 + (process.pid % 500) * 4;
  const tryOne = n => new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(null));
    srv.listen(n, '127.0.0.1', () => srv.close(() => resolve(n)));
  });
  return (async () => {
    for (let i = 0; i < 4; i++) {
      const p = await tryOne(base + i);
      if (p) return p;
    }
    throw new Error(`从 ${base} 起连续 4 个端口都不可用`);
  })();
}

function waitTcp(port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() > deadline) reject(new Error(`serve-variant.py 没有在 ${port} 监听`));
        else setTimeout(tick, 80);
      });
    };
    tick();
  });
}

function get(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------- ① import 图
//
// 顺着真实源码里的 import/export-from 走一遍，得到「两张页面会去取的模块 URL」。
// 与服务器里的 SERVABLE_MODULES 逐条比对。
// 这不是在替服务器做判断，而是把服务器写下的那份名单**对回产品**：
// 名单少一条 ⇒ 页面少一个文件（白屏）；名单多一条 ⇒ 多一个可下载的东西。
//
// 关键细节（第一版在这里错过一次）：相对 import 相对的是**这份模块的 URL**，不是它的盘上路径。
// 注入脚本的 URL 是 `/.scratch/af-variant-inject.js`，盘上却在 `support/compare/`。
// 所以 `../src/data/slice.js` 从 URL 出发解到 `/src/data/slice.js`（正是白名单里的那条），
// 从盘上路径出发却会解成 `/support/src/data/slice.js`（一条谁都不会请求的假 URL）。
// 按盘上路径走会要求白名单多登记一个不存在的东西 —— 那是一条由量具自己的错误造出来的要求。
//
// 所以 walk 同时带 URL 与盘上路径：URL 用来算子模块该在哪，盘上路径用来读文件内容。
function importGraphUrls() {
  const seen = new Map();   // url -> disk path
  const walk = (url, disk) => {
    if (seen.has(url) || !existsSync(disk)) return;
    seen.set(url, disk);
    const src = readFileSync(disk, 'utf8');
    const re = /(?:from\s*|import\s*\(\s*|import\s+)['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1].split('?')[0];
      const nextUrl = path.posix.normalize(path.posix.join(path.posix.dirname(url), spec));
      const nextDisk = path.join(ROOT, nextUrl.replace(/^\//, ''));
      walk(nextUrl, nextDisk);
    }
  };
  // 两个入口：产品首页的 module，以及对照页的注入脚本（它 import 同一份 slice.js）。
  walk('/src/main.js', path.join(ROOT, 'src', 'main.js'));
  walk('/.scratch/af-variant-inject.js', path.join(ROOT, 'support', 'compare', 'af-variant-inject.js'));
  return [...seen.keys()].sort();
}

function pyEval(code) {
  const r = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    ['-B', '-c', code], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (r.status !== 0) throw new Error(`python 失败(${r.status}): ${r.stderr}`);
  return r.stdout.trim();
}

const IMPORT_PRELUDE = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('sv', r'${VARIANT.replace(/\\/g, '/')}')
m = importlib.util.module_from_spec(spec)
sys.modules['sv'] = m
spec.loader.exec_module(m)
`;

test('白名单与真实 import 图逐条一致（少一条=页面缺文件，多一条=多一个可下载的东西）', () => {
  const graph = importGraphUrls();
  const listed = pyEval(IMPORT_PRELUDE + `
print('\\n'.join(sorted(m.SERVABLE_MODULES)))
`).split('\n').filter(Boolean);

  // 两条互补的断言，指向两种不同的坏事：
  //   · SERVABLE_MODULES 是图里 /src/ 那部分的**完全**清单 —— 多一条是多的下载面，
  //     少一条是页面会缺文件（白屏）。
  //   · 图里**每一条** URL 都真的能被发出去 —— 包括两个入口自己（/src/main.js、
  //     /.scratch/af-variant-inject.js，后者的 URL 在 SERVABLE_EXACT 里）。
  //     第一版只比了 SERVABLE_MODULES，于是把入口也算成「白名单漏登」而红了一次；
  //     那是我自己的量具报错，不是产品报错。
  const graphSrc = graph.filter(u => u.startsWith('/src/'));
  const missing = graphSrc.filter(u => !listed.includes(u));
  const extra = listed.filter(u => !graphSrc.includes(u));
  assert.deepEqual(missing, [], `产品 import 了但 SERVABLE_MODULES 没登记（页面会缺文件）：${missing.join(', ')}`);
  assert.deepEqual(extra, [], `SERVABLE_MODULES 登记了但没有任何 import 会取（多出来的可下载面）：${extra.join(', ')}`);

  const unservable = pyEval(IMPORT_PRELUDE + `
import json
print(json.dumps([u for u in ${JSON.stringify(graph)} if not m.is_servable(u)]))
`);
  assert.deepEqual(JSON.parse(unservable), [], `import 图里有 URL 发不出去（页面会 404）：${unservable}`);
});

test('白名单里没有目录前缀，只有具体文件', () => {
  const listed = pyEval(IMPORT_PRELUDE + `
print('\\n'.join(sorted(m.SERVABLE_MODULES)))
`).split('\n').filter(Boolean);
  for (const u of listed) assert.match(u, /\.[a-z]+$/, `${u} 不是具体文件`);
  const hasPrefixes = pyEval(IMPORT_PRELUDE + `
print(hasattr(m, 'SERVABLE_PREFIXES'))
`);
  assert.equal(hasPrefixes, 'False', 'SERVABLE_PREFIXES 又回来了：前缀放行等于让将来的文件自动可下载');
});

// ---------------------------------------------------------------- ③ 将来的文件
//
// 在 src/ 下写一个磁盘上**真实存在、但不在白名单里**的文件，然后请求它。
// 这是唯一能把「逐文件白名单」和「/src/ 前缀放行」分开的检查。
const CANARY_REL = 'src/__canary_not_allowlisted__.js';
const CANARY = path.join(ROOT, CANARY_REL);
const CANARY_URL = '/src/__canary_not_allowlisted__.js';

let server, port;

test.before(async () => {
  // 写入探针文件：如果隔离是按目录的，它现在就是可下载的。
  mkdirSync(path.dirname(CANARY), { recursive: true });
  writeFileSync(CANARY, 'export const CANARY = "this file must never be served";\n');
  port = await freePort();
  server = spawn(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    [VARIANT, String(port)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  await waitTcp(port);
  const hello = await get(port, '/af-variant.html');
  assert.equal(hello.status, 200, '对照页本身必须仍然打得开');
});

test.after(() => {
  try { server?.kill('SIGKILL'); } catch {}
  try { rmSync(CANARY, { force: true }); } catch {}
});

test('先确认探针文件真的在盘上（否则下一条会把「文件不存在」当成隔离通过）', () => {
  assert.equal(existsSync(CANARY), true, '探针文件没写成功，这条检查就没有意义');
});

test('#3320 将来才出现的文件也不发放：src/ 下新写的文件取不到', async () => {
  const res = await get(port, CANARY_URL);
  assert.equal(res.status, 404, `${CANARY_URL} 期望 404，实际 ${res.status}（前缀放行还没改掉？）`);
  assert.equal(res.body.includes('must never be served'), false, '探针文件的内容被发出去了');
});

test('#3320 现在的调试会话与测试模拟器也取不到', async () => {
  for (const p of ['/src/debug/session.js', '/src/sim.js']) {
    assert.equal(existsSync(path.join(ROOT, p.slice(1))), true, `${p} 在盘上不存在，这条断言无效`);
    const res = await get(port, p);
    assert.equal(res.status, 404, `${p} 期望 404，实际 ${res.status}`);
  }
});

test('#3320 目录 URL 一律 404（列表本身就把「以后该不该发」的答案说了）', async () => {
  for (const p of ['/src/', '/src/debug/', '/src/data/maps/', '/src/engine/', '/src/ui/', '/support/']) {
    const res = await get(port, p);
    assert.equal(res.status, 404, `${p} 期望 404，实际 ${res.status}`);
    assert.equal(res.body.includes('Directory listing'), false, `${p} 返回了目录列表`);
  }
});

// 上面那条 HTTP 断言**目前咬不住 list_directory 本身** —— 必须先承认这件事。
// 实测：把 list_directory 整个删掉，上面 8 条照样全绿。原因不是它没用，而是
// `/src/debug/` 这类路径在 is_servable 就被拒了，根本走不到列目录那个分支（白名单掩盖了它）。
// 于是「删掉防护」与「保留防护」在 HTTP 层长得一模一样 —— 那就不是一条判据。
//
// 所以要单独考这个函数：直接问它「请求一个目录时你发什么」。
// 它必须是「不发」—— 父类的约定是返回 None 由调用方收口成 404，而不是返回一个列表。
test('#3320 list_directory 直接考：请求目录时什么都不发（HTTP 层被白名单掩盖，咬不住它）', () => {
  const out = pyEval(IMPORT_PRELUDE + `
class Fake( m.Handler ):
    def __init__( self ):
        self.codes = []
    def send_error( self, code, msg=None ):
        self.codes.append( code )

h = Fake()
ret = h.list_directory( r'${ROOT.replace(/\\/g, '/')}' )
print( 'RET_NONE', ret is None )
print( 'CODES', h.codes )
`);
  assert.match(out, /RET_NONE True/, 'list_directory 没有返回 None：父类会把返回值当列表发出去');
  assert.match(out, /CODES \[404\]/, 'list_directory 没有回 404');
});

test('#3320 对照页与它真正需要的资源仍然 200（隔离没把入口一起堵掉）', async () => {
  const must = ['/', '/index.html', '/styles.css', '/af-variant.html',
    '/.scratch/af-variant.html', '/.scratch/af-variant-inject.js',
    '/src/main.js', '/src/data/slice.js', '/src/ui/render.js'];
  for (const p of must) {
    const res = await get(port, p);
    assert.equal(res.status, 200, `${p} 期望 200，实际 ${res.status}`);
    assert.ok(res.body.length > 0, `${p} 返回了空 body`);
  }
});

test('#3320 带 ?v= 的模块 URL 仍解析到同一个文件（缓存串不参与白名单判定）', async () => {
  const res = await get(port, '/src/ui/render.js?v=150');
  assert.equal(res.status, 200, `带 query 的模块 URL 期望 200，实际 ${res.status}`);
});

// ---------------------------------------------------------------------------
// #3320b：落盘目标本身也要判，不能只看 URL。
//
// 上一版 translate_path 只问「URL 在不在白名单」，然后把两个分支各自算出的路径直接返回：
//   `/.scratch/x` 走 compare_fallback 时**提前 return**，绕过了 `..`、仓内前缀、
//   `_blocked_realpath` 三道；其余路径也只做了 abspath 前缀检查。
// 结果：「URL 白名单」与「实际发出去的字节」不是同一个集合 ——
// 一个符号链接就能让白名单里的 URL 发出白名单外的内容。
// ---------------------------------------------------------------------------

// 直接考判定函数，不靠 HTTP：HTTP 层只能告诉你「这个 URL 现在 404」，
// 而这里要问的是「落盘目标是不是那个被允许的文件」。
//
// 注意第一版写错过：用 realpath 建「允许集合」，再把请求的 realpath 拿去比 ——
// 链到 /etc/passwd 时两边算出来是同一个值，于是「匹配」，永远为真。
// 所以现在用 abspath 建集合，另用「链本身拒 + realpath 出仓拒」两道阻。
test('#3320b 落盘目标：合格的 URL 解到仓内那个真实文件', () => {
  const out = pyEval(IMPORT_PRELUDE + `
import json
r = { p: m.resolve_servable_file(p) for p in ['/index.html', '/', '/src/main.js', '/.scratch/af-variant.html'] }
print(json.dumps({k: (v is not None) for k, v in r.items()}))
`);
  assert.deepEqual(JSON.parse(out),
    { '/index.html': true, '/': true, '/src/main.js': true, '/.scratch/af-variant.html': true });
});

test('#3320b 落盘目标：不在白名单 / 目录 / 仓外一律 None', () => {
  const out = pyEval(IMPORT_PRELUDE + `
import json
forbidden = ['/src/debug/session.js', '/src/sim.js', '/src/debug/', '/support/', '/docs/',
             '/../etc/passwd', '/src/../README.md', '/no-such-file.html']
print(json.dumps({ p: (m.resolve_servable_file(m.normalize_url_path(p)) is None) for p in forbidden }))
`);
  const got = JSON.parse(out);
  const leaked = Object.entries(got).filter(([, refused]) => !refused).map(([p]) => p);
  assert.deepEqual(leaked, [], `这些应当拒却放行了：${leaked.join(', ')}`);
});

// 两个符号链接测试都**自己建文件**，不依赖 `.scratch/` 里的副本。
//
// 上一版去链 `.scratch/af-variant.html`，在本机上行得通，因为那个目录里恰好有同名副本；
// 但在干净检出里 `.scratch/` 根本不存在（它是 ignored 的），于是两条都红在 ENOENT ——
// 实测导出的提交跑出 564/566。那是测试在依赖一台机器的残留，不是产品行为。
//
// 现在先建 `support/compare/af-variant.html`（`.scratch/` 没有副本时，`/.scratch/...`
// 会经 compare_fallback 解到这个文件），把它换成符号链接，验完再恢复。
//
// 必须先确认它**确实是**被服务的那个文件，否则测试会像第一版那样空转。
function withSymlinkedFixture(targetPath, body) {
  const fixture = path.join(ROOT, 'support', 'compare', 'af-variant.html');
  const backup = readFileSync(fixture);
  const shadow = path.join(ROOT, '.scratch', 'af-variant.html');
  const shadowBackup = existsSync(shadow) ? readFileSync(shadow) : null;
  try {
    if (shadowBackup) unlinkSync(shadow);   // 不能让 .scratch 的副本遮蔽被测路径
    unlinkSync(fixture);
    symlinkSync(targetPath, fixture);
    return body();
  } finally {
    try { unlinkSync(fixture); } catch {}
    writeFileSync(fixture, backup);
    if (shadowBackup) writeFileSync(shadow, shadowBackup);
  }
}

test('#3320b 符号链接：白名单里的名字指向仓外文件时必须不发', () => {
  withSymlinkedFixture('/etc/passwd', () => {
    const out = pyEval(IMPORT_PRELUDE + `
import json
print(json.dumps({ p: (m.resolve_servable_file(p) is None) for p in ['/.scratch/af-variant.html', '/af-variant.html'] }))
`);
    assert.deepEqual(JSON.parse(out),
      { '/.scratch/af-variant.html': true, '/af-variant.html': true },
      '符号链接指向仓外文件时仍然被发了');
  });
});

test('#3320b 符号链接：仓内互指也不行（否则链名 = 白名单外的内容）', () => {
  withSymlinkedFixture(path.join(ROOT, 'README.md'), () => {
    const out = pyEval(IMPORT_PRELUDE + `
import json
print(json.dumps(m.resolve_servable_file('/.scratch/af-variant.html') is None))
`);
    assert.equal(out.trim(), 'true', '仓内符号链接被放行了');
  });
});
