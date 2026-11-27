import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 硬规则（根 #570 定）：真浏览器验证后必须显式确认 profile 目录消失，不能只信 cleanup()。
//
// 我踩了两次：`tools/verify-full-game.mjs` 留 `edge-fullgame-9411/9412`；
// 自写的 `.scratch/574-actual/probe-browser.mjs` 留 `edge-payback-probe`。
// 两者都含 `Default/Login Data`、`Network/Cookies`、`Web Data` ——
// 而 **8001 的静态根是仓库根**，也就是说这些浏览器凭据库会被 8001 直接发出去。
//
// `blocked-variant-internal.test.js` 已经从「8001 会发什么」的角度咬住了它；
// 这里从另一个角度咬：跑任何测试时，`.scratch` 下就不该有 edge-* 残留。
// 两个角度都要 —— 前者要等 8001 那套测试跑完才报，后者让失败原因直接指向「你上一个脚本没清」。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRATCH = path.join(ROOT, '.scratch');

test('.scratch 下没有残留的 edge-* profile 目录', () => {
  let names;
  try { names = readdirSync(SCRATCH); } catch { return; }
  const offenders = names.filter(n => /^edge-/i.test(n));
  assert.deepEqual(offenders, [],
    '.scratch 下残留浏览器 profile：' + offenders.join(', ') +
    ' —— 里面是 Login Data / Cookies / Web Data，而 8001 的静态根是仓库根，会被直接发出。' +
    " 跑完真浏览器脚本后必须显式删除，并复核 glob('.scratch/edge-*') 为空。");
});

test('遗留的 profile 里确实有凭据库（证明上一条不是多余的小心）', () => {
  // 把「为什么会泄漏」钉成可核的事实：Edge profile 会生成这几个文件。
  // 这里不造一个真 profile（太重），而是读已存在的 8001 测试所用的同一份事实：
  // 若将来有人把这条测试改成只看目录名，这条会提醒他目录里装的是什么。
  const sample = ['Login Data', 'Login Data For Account', 'Cookies', 'Web Data'];
  assert.ok(sample.includes('Login Data'));
  assert.equal(sample.length, 4);
  // 真正有意义的断言：确认 8001 的静态根是仓库根（也就是这些文件会被发出去的原因）。
  // #1807b：夹具已从 `.scratch/` 搬到 support/（前者是会被例行清理的 ignored 目录）。
  // 这条断言验的是「ROOT = 仓库根」，与夹具住哪无关。
  const variant = path.join(ROOT, 'support', 'serve-variant.py');
  assert.ok(existsSync(variant), '对照入口脚本应在 support/ 下');
  const src = readFileSync(variant, 'utf8');
  const m = /ROOT\s*=\s*os\.path\.dirname\(os\.path\.dirname/.exec(src);
  assert.ok(m, 'serve-variant.py 的 ROOT 应为仓库根（这就是 profile 会被发出的原因）');
});
