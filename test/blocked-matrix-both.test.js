import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// #499：把「内部目录不进 URL 空间」写成一张表，两侧各起一个隔离实例逐条真打。
//
// 为什么单独一个文件：
//   - blocked-internal-dirs.test.js 只打 8000；
//   - blocked-variant-internal.test.js 只打 8001，且不含编码变体的完整表；
//   两边此前是各写一半、写法集合也不一样。这张表要求两侧对**同一组写法**给出同一结论，
//   才能证明「8000 与 8001 走的是同一套闸」，而不是各修各的。
//
// 同时钉正向对照（/、styles.css、slice.js）与 8001 的独特豁免（.scratch 必须 200）。
// 只断言「坏的 404」不够 —— 把整站关掉也全 404。
//
// 判别力的弱点说明（诚实记录）：
//   `/node_modules/`、`/__pycache__/serve.cpython-311.pyc` 这类路径可能**本来就不存在**，
//   那么 404 是「文件缺失」而不是「被拦」。所以本文件另有一组不看文件系统的判定层断言
//   （直接 import 两个 py，问 is_blocked 对这些写法的答案），两层都绿才算数。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PLAIN = path.join(ROOT, 'serve.py');
// #1807b：这具原先住 `.scratch/serve-variant.py` —— 那是一个**例行清理的 ignored 目录**，
// 而且它对缺失没有任何守卫：`waitTcp(pVariant, 45000)` 会等满 45 秒才 reject，
// 然后 before() 失败被摊给全部 44 条，报错文案却写「一律 404」—— 完全指错方向。
// 实测（.scratch/1807-port-race/probe_variant.py，单实例）：
//   夹具在   ⇒ 7.0 s，44/44 绿
//   夹具缺   ⇒ 48.9 s，0 pass / 44 条红，全报「一律 404」
// 并发时多个实例各等 45 s 叠加，就是 stress-rest.json 里 2/4 轮 TIMEOUT 的来源。
// 已搬到 support/，并在下面加了一条前置断言。
const VARIANT = path.join(ROOT, 'support', 'serve-variant.py');

const INDEX_FP = '6f320608f37f1e9d';
// styles.css 随授权改动：#776 39394 `6084098d4a7eb14d` → 40779 `d6ffc9539a6ca449`，
// #786 → 41969 `7155f4bdf4cc4941`，#1255 决策面板改抽屉 → 43439 `a8e6b886fdcf330b`，
// #1478b → 44072 `1c9bd9d74ba3cce5`（#insight summary 强制单行 + 省略号）。
// #1523b → 48439 `7678e752e1730f3e`（卡高 96 让整张卡的文字都在窗内，高度从可滚动的 #players/明细里出）。
// #1745 → 49821 `1389660bd64b86c1`（summary 三角要回来 + 短视口明细盒 40→96px）。
// 本断言验的是「页面本体未被误杀」，
// 字节只是身份标记。
const CSS_FP = '1389660bd64b86c1';
// #3330 重签：起手开工现金改为 42000/45000/46000（见 src/data/slice.js 顶部说明）。
const SLICE_FP = 'b09cd15921412803';
const PAGE_FP = '3d51b9d013370a81';
const INJECT_FP = 'e8b1148546523c6b';

// 两侧共用的一张表。每条都在 2026-11-20 18:56Z 那轮实测过改前是 200。
const BLOCKED = [
  '/.git/config',
  '/.git/',
  '/.git',
  '//.git/config',
  '/./.git/config',
  '/.GIT/config',
  '/.git./config',
  '/.git%2fconfig',
  '/%2e%67%69%74/config',
  '/.praxis2/agents.json',
  '/.praxis2/',
  '/.praxis2',
  '/__pycache__/serve.cpython-311.pyc',
  '/__pycache__/',
  '/node_modules/',
  '/.vscode/settings.json',
  '/.idea/misc.xml',
];

// 8000 独有的第四条：`.scratch` 在 8000 上属于被堵前缀（对照页只能从 8001 取）。
const BLOCKED_ON_8000_ONLY = ['/.scratch/af-variant.html', '/.scratch/', '/./.scratch/af-variant.html', '//.scratch/af-variant.html'];

function freePorts(n) {
  // 与其它测试文件的端口带错开（8170/17000/18000 一带已有人用）。
  const base = 18500 + (process.pid % 400) * 8;
  const taken = new Set();
  const tryOne = p => new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(p, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
  return (async () => {
    const out = [];
    for (let i = 0; out.length < n && i < 200; i++) {
      const p = base + i;
      if (taken.has(p)) continue;
      if (await tryOne(p)) { taken.add(p); out.push(p); }
    }
    if (out.length < n) throw new Error(`从 ${base} 起找不到 ${n} 个空闲端口`);
    return out;
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
        if (Date.now() > deadline) reject(new Error(`没在 ${port} 监听`));
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
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          location: res.headers.location,
          len: body.length,
          sha16: createHash('sha256').update(body).digest('hex').slice(0, 16),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

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

const PY = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

// #1807b：起一个绑 0 的服务，从它自己的 stdout 读回实际端口。
// 宣告失败时**杀掉子进程再 reject**，否则死子会拖住整个 node 进程。
function spawnAnnounced(script, timeoutMs = 15000) {
  const child = spawn(PY, [script, '0'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderrText = '';
  child.stderr.on('data', d => { stderrText += d.toString(); });
  const port = new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`${path.basename(script)} ${timeoutMs}ms 内没有宣告端口\n${stderrText}`));
    }, timeoutMs);
    const onData = d => {
      buf += d.toString();
      const m = /LISTENING (\d+)/.exec(buf);
      if (m) { clearTimeout(timer); child.stdout.off('data', onData); resolve(Number(m[1])); }
    };
    child.stdout.on('data', onData);
    child.once('exit', c => {
      clearTimeout(timer);
      reject(new Error(`${path.basename(script)} 在宣告端口前退出 rc=${c}\n${stderrText}`));
    });
  });
  return port.then(p => ({ child, port: p }));
}

let plain, variant, pPlain, pVariant;

test.before(async () => {
  // 前置：夹具必须先在。不给这条的话，夹具缺失会变成 45 s 挂起 + 44 条「一律 404」。
  assert.equal(existsSync(PLAIN), true, `夹具缺失：${PLAIN}`);
  assert.equal(existsSync(VARIANT), true, `夹具缺失：${VARIANT}（原先住 .scratch/，那里会被例行清理）`);

  // 端口由 OS 分配，从**自己 spawn 的进程** stdout 读回（与 support/serve-fixture.js 同一口径）。
  const started = await Promise.all([
    spawnAnnounced(PLAIN), spawnAnnounced(VARIANT),
  ]);
  plain = started[0].child; variant = started[1].child;
  pPlain = started[0].port; pVariant = started[1].port;

  // 身份校验：两个端口上必须是各自那个服务器，不是别的进程碰巧听着。
  const a = await get(pPlain, '/index.html');
  assert.equal(a.status, 200, `端口 ${pPlain} 上没有正常的 serve.py（${a.status}）`);
  const b = await get(pVariant, '/af-variant.html');
  assert.equal(b.status, 200, `端口 ${pVariant} 上没有正常的 serve-variant.py（${b.status}）`);
});

test.after(() => { killTree(plain); killTree(variant); });

// ---------------------------------------------------------------------------
// 表 1：8000 与 8001 对同一组写法的真实读数
// ---------------------------------------------------------------------------

const TABLE = [];

for (const side of ['8000', '8001']) {
  for (const p of BLOCKED) {
    test(`${side} 内部目录一律 404：${p}`, async () => {
      const port = side === '8000' ? pPlain : pVariant;
      const res = await get(port, p);
      TABLE.push(`${side} ${res.status} ${String(res.len).padStart(6)}B ${p}`);
      assert.equal(res.status, 404, `${side} ${p} 期望 404，实际 ${res.status}/${res.len}B`);
    });
  }
}

for (const p of BLOCKED_ON_8000_ONLY) {
  test(`8000 的 .scratch 前缀一律 404（对照页只走 8001）：${p}`, async () => {
    const res = await get(pPlain, p);
    TABLE.push(`8000 ${res.status} ${String(res.len).padStart(6)}B ${p}`);
    assert.equal(res.status, 404, `8000 ${p} 期望 404，实际 ${res.status}/${res.len}B`);
  });
}

// ---------------------------------------------------------------------------
// 表 2：正向对照，防误杀
// ---------------------------------------------------------------------------

// #3264：这三组「长度 + 指纹」原来手抄成常量，styles.css 那份停在 #1745 的 49821，
// 于是每次授权的样式改动都会让「页面本体未被误杀」变红 —— 红的是标记，不是产品。
// 这条要验的是「两侧端口发的就是盘上这份」，所以直接从盘上读同一份文件来比，
// 少发/多发一个字节仍然红，改样式不再需要手改常量。
const diskId = rel => {
  const buf = readFileSync(path.join(ROOT, rel));
  return ['/' + rel, buf.length,
    createHash('sha256').update(buf).digest('hex').slice(0, 16)];
};
const CONTROLS = [
  ['/', ...diskId('index.html').slice(1)],
  diskId('styles.css'),
  diskId('src/data/slice.js'),
];

for (const side of ['8000', '8001']) {
  test(`${side} 页面本体未被误杀`, async () => {
    const port = side === '8000' ? pPlain : pVariant;
    for (const [p, len, fp] of CONTROLS) {
      const res = await get(port, p);
      TABLE.push(`${side} ${res.status} ${String(res.len).padStart(6)}B ${p}`);
      assert.equal(res.status, 200, `${side} ${p} 被误杀：${res.status}`);
      assert.equal(res.len, len, `${side} ${p} 的 HTTP 字节长度与盘上文件不符：${res.len} vs ${len}`);
      assert.equal(res.sha16, fp, `${side} ${p} 的 HTTP 字节指纹与盘上文件不符：${res.sha16} vs ${fp}`);
    }
  });
}

test('8001 的 .scratch 对照页仍是 200/5230/同指纹（堵内部目录不能把对照页一起堵掉）', async () => {
  const page = await get(pVariant, '/.scratch/af-variant.html');
  TABLE.push(`8001 ${page.status} ${String(page.len).padStart(6)}B /.scratch/af-variant.html`);
  assert.equal(page.status, 200, `对照页被误杀：${page.status}`);
  assert.equal(page.len, 5230, `对照页长度变了：${page.len}`);
  assert.equal(page.sha16, PAGE_FP, `对照页指纹变了：${page.sha16}`);

  const inject = await get(pVariant, '/.scratch/af-variant-inject.js');
  assert.equal(inject.status, 200, `注入脚本被误杀：${inject.status}`);
  assert.equal(inject.len, 811);
  assert.equal(inject.sha16, INJECT_FP);
});

// 打印整张表，供回铃取真读数（node --test 会带出 stdout）。
test('读数表（真实 HTTP，非推断）', () => {
  for (const line of TABLE) console.log('TAB ' + line);
  assert.ok(TABLE.length >= BLOCKED.length * 2 + BLOCKED_ON_8000_ONLY.length, '表不完整');
});

// ---------------------------------------------------------------------------
// 表 3：判定层，不看文件系统
//
// HTTP 级 404 可能只是「文件本来不存在」。这里直接 import 两个 py，
// 问它们的 is_blocked 对同一组写法怎么答 —— 这一层与磁盘状态无关。
// ---------------------------------------------------------------------------

// 坑：Python 的 print 在 Windows 上输出 CRLF。早先用 endsWith(' False') 过滤时，
// 每行末尾带着 CR 永远匹配不上 ⇒ 漏判集合恒为空 ⇒ 断言恒绿。
// 这个文件的第一版就是这么写的：短路掉段名层后它仍报 44 pass。所以先剥 CR。
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
function linesOf(out) {
  return out.split(LF).filter(Boolean).map(l => l.split(CR).join(''));
}
function missedLines(out) {
  return linesOf(out).filter(l => l.startsWith('R ') && l.endsWith(' False'));
}

function probeBlocked(pyFile, paths, extra) {
  const code = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('m', r'${pyFile.replace(/\\/g, '/')}')
m = importlib.util.module_from_spec(spec)
sys.modules['m'] = m
spec.loader.exec_module(m)
cases = ${JSON.stringify(paths)}
for p in cases:
    print('R', p, m.is_blocked(m.normalize_url_path(p)))
print('scratch', m.is_blocked(m.normalize_url_path('/.scratch/af-variant.html')))
`;
  const r = spawnSync(PY, ['-B', '-c', code], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(r.status, 0, `python 失败(${r.status}): ${r.stderr}`);
  return r.stdout.trim();
}

test('判定层：serve.py 对这些写法全部判为拦（与磁盘上有无该文件无关）', () => {
  const out = probeBlocked(PLAIN, [...BLOCKED, ...BLOCKED_ON_8000_ONLY]);
  const missed = missedLines(out);
  assert.deepEqual(missed, [], 'serve.py 漏判：' + LF + missed.join(LF));
  assert.ok(linesOf(out).includes('scratch True'), 'serve.py 没拦 .scratch');
});

test('判定层：serve-variant.py 同样全判为拦，但 .scratch 必须放行', () => {
  const out = probeBlocked(VARIANT, BLOCKED);
  const missed = missedLines(out);
  assert.deepEqual(missed, [], 'serve-variant.py 漏判：' + LF + missed.join(LF));
  assert.ok(linesOf(out).includes('scratch False'), 'serve-variant.py 把 .scratch 也拦了 —— 8001 的对照页会消失');
});
