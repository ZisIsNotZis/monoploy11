import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 8001（对照入口）也必须有闸。
//
// 背景：8000 早就用三层拦截堵住了 `.git` / `.praxis2` 等内部目录，
// 但 8001 的 serve-variant.py 一字未动，于是它成了唯一没闸的入口 ——
// 实测 `/.git/config` 200/302B，内容里带着
// `url = ssh://git@github.com/ZisIsNotZis/monoploy11.git`。
//
// 同时必须钉住反面：**`.scratch` 在 8001 上要继续可达**。
// 那是对照页的唯一入口，堵了 8001 就失去存在意义。
// 这两条一起写，才能防止「为了安全把对照页一起堵掉」这种修法。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// #1807b：夹具从 `.scratch/`（例行清理的 ignored 目录）搬到 support/。
const VARIANT = path.join(ROOT, 'support', 'serve-variant.py');

const PAGE_FP = '3d51b9d013370a81';
// #3344：首页多了 #sliceOpening 一块容器，指纹 6f320608… → b09ba9e3…。
// 它咬的是「8001 发的是原版首页」，不是「首页不许改」（见 test/trailing-slash-variant.test.js）。
const INDEX_FP = 'b09ba9e3403ab60d';
const INJECT_FP = 'e8b1148546523c6b';

// 与 trailing-slash-variant.test.js 同款：按 pid 派生端口 + 真实绑定探测，
// 避开 listen(0) 在全量并发下两份测试拿到同一个号。那边用 +2，这里用 +1。
function freePort() {
  const base = 17000 + (process.pid % 600) * 4 + 1;
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

function waitTcp(port, timeoutMs = 45000, stderrBuf = null) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() > deadline) {
          const seen = stderrBuf && stderrBuf.text ? `\nserve-variant.py stderr:\n${stderrBuf.text}` : '';
          reject(new Error(`serve-variant.py 在 ${timeoutMs}ms 内没在 ${port} 监听${seen}`));
        } else setTimeout(tick, 80);
      });
    };
    tick();
  });
}

function get(port, rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          len: body.length,
          sha16: createHash('sha256').update(body).digest('hex').slice(0, 16),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let server;
let port;

// 用进程树杀：python 直接起，但在 Windows 上保险。
function killTree(child) {
  if (!child || child.pid == null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 15000 });
    } else {
      child.kill('SIGKILL');
    }
  } catch {}
}

test.before(async () => {
  port = await freePort();
  const stderr = { text: '' };
  server = spawn(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [VARIANT, String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  server.stderr.on('data', d => { stderr.text += d.toString(); process.stderr.write(d); });
  const spawnError = new Promise((_, reject) => server.once('error', e => reject(new Error(`起不来 serve-variant.py：${e.message}`))));
  await Promise.race([waitTcp(port, 45000, stderr), spawnError]);
  // 身份校验：对照入口必须能直接给出页面本体。
  const hello = await get(port, '/af-variant.html');
  assert.equal(hello.status, 200, `端口 ${port} 上没有正常的 serve-variant.py（${hello.status}）`);
});

test.after(() => killTree(server));


// 内部目录：这些一律不得发出。
const BLOCKED = [
  '/.git/config',
  '/.git/HEAD',
  '/.git/',
  '/.praxis2/',
  '/.praxis2/memory.json',
  '/.praxis2/agents.json',
  '/.GIT/config',
  '/.Praxis2/memory.json',
  '/.git./config',
  '/.vscode/settings.json',
  '/.idea/misc.xml',
  '/node_modules/',
  '/__pycache__/',
  '/__pycache__/serve.cpython-314.pyc',
  '/__pycache__/serve.cpython-311.pyc',
  '/./.git/config',
  '//.git/config',
  '/.git',
  // 编码变体：%2f 是斜杠、%2e 是点。归一函数会 unquote，所以这两种也必须拦。
  '/.git%2fconfig',
  '/%2e%67%69%74/config',
  '/__invalid_path__',
];

for (const p of BLOCKED) {
  test(`8001 内部目录不发放：${p}`, async () => {
    const res = await get(port, p);
    assert.equal(res.status, 404, `${p} 期望 404，实际 ${res.status}`);
  });
}

// 这条比“404 了”更强：确认 remote 地址一个字都不在响应体里。
// 只看状态码的话，将来有人把 404 换成 403 但把内容带进 body 也照样绿。
test('8001 的 .git/config 不泄 remote 地址（不只看状态码）', async () => {
  const res = await get(port, '/.git/config');
  assert.equal(res.status, 404);
  const body = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/.git/config' }, r => {
      const c = []; r.on('data', d => c.push(d)); r.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(/git@github|ssh:\/\/|\[remote/.test(body), false, '.git/config 的内容出现在了响应体里');
});

// 反面：`.scratch` 必须继续可达，否则 8001 失去意义。
test('8001 的 .scratch 仍可达（不能为了安全把对照页一起堵掉）', async () => {
  const page = await get(port, '/.scratch/af-variant.html');
  assert.equal(page.status, 200, `/.scratch/af-variant.html 期望 200，实际 ${page.status}`);
  assert.equal(page.len, 5230, `对照页长度变了：${page.len}`);
  assert.equal(page.sha16, PAGE_FP, `对照页指纹变了：${page.sha16}`);

  const inject = await get(port, '/.scratch/af-variant-inject.js');
  assert.equal(inject.status, 200, `注入脚本期望 200，实际 ${inject.status}`);
  assert.equal(inject.len, 811);
  assert.equal(inject.sha16, INJECT_FP);
});

// #3319d：白名单之后 8001 仍然发原版首页（它是玩家入口，不拿走），
// 但「发首页」不再等于「整个仓库都可取」—— 首页只需要 styles.css 与 /src/**。
test('8001 根路径仍发原版首页（白名单没误杀玩家入口）', async () => {
  const res = await get(port, '/');
  assert.equal(res.status, 200);
  // #3344：首页多了 #sliceOpening 一块容器，长度 5108 → 5165。
  assert.equal(res.len, 5165);
  assert.equal(res.sha16, INDEX_FP);
});

test('8001 别名入口仍 200 且是对照页', async () => {
  for (const p of ['/af-variant.html', '/scratch/af-variant.html']) {
    const res = await get(port, p);
    assert.equal(res.status, 200, `${p} 期望 200，实际 ${res.status}`);
    assert.equal(res.sha16, PAGE_FP, `${p} 指纹不对`);
  }
});

// HEAD 走同一套判定，别只验 GET（否则 do_HEAD 被复制粘贴绕过也发现不了）。
test('8001 的 HEAD 对内部目录同样 404，对 .scratch 同样 200', async () => {
  assert.equal((await get(port, '/.git/config', 'HEAD')).status, 404, 'HEAD /.git/config 期望 404');
  assert.equal((await get(port, '/.praxis2/', 'HEAD')).status, 404, 'HEAD /.praxis2/ 期望 404');
  assert.equal((await get(port, '/.scratch/af-variant.html', 'HEAD')).status, 200, 'HEAD 对照页被误杀');
  assert.equal((await get(port, '/', 'HEAD')).status, 200, 'HEAD / 被误杀（原版入口）');
});

// 被拦前缀的尾斜杠不该发 301（否则 404 变成一次可见跳转）。
test('8001 被拦前缀的尾斜杠不发 301', async () => {
  for (const p of ['/.git/', '/.praxis2/']) {
    const res = await get(port, p);
    assert.notEqual(res.status, 301, `${p} 不该发 301`);
    assert.equal(res.status, 404, `${p} 期望 404，实际 ${res.status}`);
  }
});

// 对照入口原有的 301 行为不能被这次改动弄坏。
test('8001 既有 301 语义不变：别名尾斜杠仍落到 .scratch 下的真实路径', async () => {
  const res = await get(port, '/af-variant.html/');
  assert.equal(res.status, 301, `期望 301，实际 ${res.status}`);
  assert.equal(res.headers.location, '/.scratch/af-variant.html');
});

// ---------------------------------------------------------------------------
// 分层：直接 import serve-variant.py 验两层判定各自成立。
//
// 为什么需要：只做 HTTP 断言时，把整个 is_blocked 短路成 `return False`，
// 上面 22 条照样全绿 —— 因为 _blocked_realpath 那一层自己就把 .git 兜住了。
// 也就是说 HTTP 层咬不住「某一层被删了」。实测过：短路后 22 tests / 22 pass。
// 所以这里分别验段名层与 realpath 层。
//
// 用 python -B 避免在仓库根生成 __pycache__（那里的 .pyc 能被 HTTP 取到）。
// ---------------------------------------------------------------------------

function runPy(code) {
  // #3264：这一处漏了 non-Windows 的回退档（同文件 :105 有），在这台没有 `python` 的机器上
  // 变成 spawn 失败 status=null，而不是「判定层缺了」。与同文件其它 spawn 同口径。
  const r = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-B', '-c', code], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  if (r.status !== 0) throw new Error(`python 失败(${r.status}): ${r.stderr}`);
  return r.stdout.trim();
}

const IMPORT_PRELUDE = `
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location('sv', r'${VARIANT.replace(/\\/g, '/')}')
m = importlib.util.module_from_spec(spec)
sys.modules['sv'] = m
spec.loader.exec_module(m)
`;

test('分层：段名层单独咬住大小写 / 段尾点 / 段尾空格 / 中间段', () => {
  const out = runPy(IMPORT_PRELUDE + `
cases = ['/.git/x', '/.GIT/x', '/.git./x', '/.praxis2/x', '/a/.praxis2/b', '/__pycache__/x', '/.vscode/x']
ok = [p for p in cases if m._blocked_segments(p)]
print('BLOCKED', len(ok), 'of', len(cases))
for p in cases:
    if not m._blocked_segments(p):
        print('MISSED', p)
# .scratch 绝不能被段名层拦（否则对照页没了）
print('scratch-allowed', not m._blocked_segments('/.scratch/af-variant.html'))
`);
  assert.match(out, /BLOCKED 7 of 7/, `段名层漏判：
${out}`);
  assert.match(out, /scratch-allowed True/, '.scratch 被段名层误拦 —— 对照页会消失');
});

test('分层：realpath 层单独咬住规范路径（不靠名字）', () => {
  const out = runPy(IMPORT_PRELUDE + `
import os
root = os.path.abspath(os.path.join(os.path.dirname(r'${VARIANT.replace(/\\/g, '/')}'), '..'))
git_full = os.path.join(root, '.git', 'config')
print('realpath-blocked', m._blocked_realpath(git_full))
scratch_full = os.path.join(root, '.scratch', 'af-variant.html')
print('realpath-allows-scratch', not m._blocked_realpath(scratch_full))
print('realpath-allows-index', not m._blocked_realpath(os.path.join(root, 'index.html')))
`);
  assert.match(out, /realpath-blocked True/, `realpath 层漏判：
${out}`);
  assert.match(out, /realpath-allows-scratch True/, '.scratch 被 realpath 层误拦');
  assert.match(out, /realpath-allows-index True/, 'index.html 被 realpath 层误拦');
});

test('分层：import 不会把服务跑起来（__main__ 守卫在）', () => {
  // 上两条 import 成功且进程正常退出，本身就证明没起服务。
  // 再直接验名单内容，防止有人把 .scratch 加进 BLOCKED_PREFIXES。
  const out = runPy(IMPORT_PRELUDE + `
print('PREFIXES', ','.join(sorted(m.BLOCKED_PREFIXES)))
print('scratch-in-prefixes', any(p.startswith('/.scratch') for p in m.BLOCKED_PREFIXES))
`);
  assert.match(out, /scratch-in-prefixes False/, '.scratch 被加进了拦截名单 —— 对照页会 404');
  for (const p of ['/.git', '/.praxis2', '/__pycache__']) {
    assert.ok(out.includes(p), `拦截名单里缺 ${p}`);
  }
});

// 8000 侧早就有这两条断言，8001 一直没验。既然两边现在走同一套闸，
// 就该把这两个前提也钉在同一侧：绑定范围与写方法。
test('8001 只绑回环地址，不对局域网开放', () => {
  const src = readFileSync(VARIANT, 'utf8');
  const m = /ThreadingHTTPServer\(\('([^']+)'/.exec(src);
  assert.ok(m, '在 serve-variant.py 里找不到 ThreadingHTTPServer 的绑定地址');
  assert.ok(m[1].startsWith('127.0.0.1'), `绑定地址变成 ${m[1]}，不再只限本机`);
});

test('8001 的写方法一律 501，且不落盘', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'TRACE']) {
    const res = await get(port, '/', method);
    assert.equal(res.status, 501, `${method} / 期望 501，实际 ${res.status}`);
  }
});

// `.scratch` 在 8001 上是有意开放的（对照页唯一入口），但它不是空目录 ——
// 里面会积累测试副产品。本轮实测到一个真泄漏：跑完 --headless 验证后，
// `.scratch/edge-*/Default/Login Data`、`Network/Cookies`、`Web Data` 可以直接被 8001 取走
// （200 / 55296 / 32768 / 241664B，文件头 `SQLite f`）—— 3.0GB 的 10 个 Edge profile 里
// 有 60 个凭据类文件。那不是“有意开放的对照入口”，是浏览器登录库与 cookie 库。
//
// 所以这条测试钉两件事：
//   1. `.scratch` 下不该出现浏览器 profile 目录（跑完验证工具就必须清）
//   2. 即使有，也不该是被发放的东西 —— 但这条只能靠 (1) 保证，
//      因为 8001 的静态根是仓库根，`.scratch` 不能整个拦掉。
test('`.scratch` 下不能残留浏览器 profile（否则登录库/Cookies 会被 8001 发出去）', () => {
  const SCRATCH = path.join(ROOT, '.scratch');
  const offenders = [];
  const CRED = new Set(['Login Data', 'Login Data For Account', 'Cookies', 'Web Data']);
  // 文件也查：本轮实测到 `.scratch/edge-dump-variant.html`（0 字节，--dump-dom 的落盘）。
  // 它是**文件**不是目录，旧版只查目录名，于是它 200 被 8001 发出去而守卫全绿。
  // 目录名与文件名都得咬。
  // #3264：`^edge-` 这个名子规则同时咬了**控制脚本**（.scratch/2405-first-cue/edge-2413.mjs 这类
  // Node 驱动，内容是一行 import），它们不是浏览器登录库。名子巧合不等于泄漏，
  // 而把真泄漏埋在噪声里更糟：21 条里只有 4 条是真的（我自己的 probe/p/Default）。
  // 现在的咬法按**内容形态**判：
  //   a) 凭据文件名（CRED，原样保留）；
  //   b) `edge-*` 的**目录**（浏览器 profile 根）；
  //   c) `edge-*` 的**非源码文件**（--dump-dom / 报告落盘，实测 0 字节 html 也发得出去）。
  // 源码后缀的白名单窄到 mjs/js/py/ts/json —— json 也算源码（报告），要藏也得显式改这里。
  const SRC = new Set(['.mjs', '.js', '.py', '.ts', '.json']);
  const walk = dir => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (/^edge-/i.test(e.name)) offenders.push(path.relative(ROOT, full));
        walk(full);
      } else if (CRED.has(e.name) || (/^edge-/i.test(e.name) && !SRC.has(path.extname(e.name)))) {
        offenders.push(path.relative(ROOT, full));
      }
    }
  };
  walk(SCRATCH);
  // #3319d：这条以前是**唯一**的防线 —— 它要求 `.scratch` 里从不留东西，
  // 因为 8001 的静态根是仓库根，只要留了就发得出去。白名单接管之后，问题变了：
  // 「留了也发不出去」。所以这里不再要求磁盘干净（那靠人记得清，靠不住），
  // 而是把这条守卫的真问题**用同一个名字去问 8001**：这些残留能不能被取走。
  // 保留 offenders 的列表只作为语境（它可能非空，且**不算失败**）。
  const leaky = offenders.filter(rel => {
    // 名字 → 8001 会不会发。走服务器自己的判定，不在这里重写一份路径规则。
    const url = '/' + rel.split(path.sep).join('/');
    const m = runPy(IMPORT_PRELUDE + `
print('servable', m.is_servable(m.normalize_url_path(${JSON.stringify(url)})))
`);
    return /servable True/.test(m);
  });
  assert.deepEqual(leaky, [], '这些残留会被 8001 发出去（白名单没盖住）: ' + leaky.join(' | '));
});

// #3319d：8001 的边界必须是**白名单**，不能是「点名的几个目录不许」。
// 黑名单只能管住今天想得到的路径：/.git/config 曾经能读，一次误留的浏览器资料
// 或明天新增的任何文件同样会 200。这三条验的是「未来文件也拦得住」这件事本身。
test('白名单：只发对照页真的会加载的东西，别的名字一律不发', () => {
  const out = runPy(IMPORT_PRELUDE + `
served = ['/.scratch/af-variant.html', '/.scratch/af-variant-inject.js', '/styles.css',
          '/src/main.js', '/src/ui/render.js', '/src/data/slice.js']
# served: / and /index.html are the plain entry; they need only styles.css + /src/**,
# both allowed above. Everything else in the repo is refused, including future names.
blocked = ['/.scratch/anything-else', '/.scratch/sub/dir/file', '/README.md',
           '/support/serve-variant.py', '/tools/play.mjs', '/docs/evidence/x.json',
           '/.scratch/newfile.txt', '/brand-new-file.txt', '/package.json']
missed = [p for p in served if not m.is_servable(m.normalize_url_path(p))]
leaked = [p for p in blocked if m.is_servable(m.normalize_url_path(p))]
print('SERVED-MISSED', missed)
print('LEAKED', leaked)
`);
  assert.match(out, /SERVED-MISSED \[\]/, `对照页真的会加载的资源被白名单挡了：\n${out}`);
  assert.match(out, /LEAKED \[\]/, `白名单之外的文件仍会被发出：\n${out}`);
});

test('白名单对「今天还不存在的文件」同样成立（不是按文件名碰运气）', () => {
  // 这条故意问的是两个**必然还不存在**的名字：规则的形状若退化成黑名单，
  // 它们就会变成 is_servable True，而这与文件是否存在无关 —— 正是要的那种独立性。
  const out = runPy(IMPORT_PRELUDE + `
print('future', m.is_servable('/.scratch/zz-future-cookies'),
      m.is_servable('/zz-future-notes.txt'),
      m.is_servable('/.scratch/zz-future-cookies/Default/Cookies'))
`);
  assert.match(out, /future False False False/, `将来新增的文件会被发出：\n${out}`);
});
