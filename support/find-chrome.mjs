// 找出本机可用的 Chrome/Chromium —— 五个对照脚本共用这一处，别各写一份。
//
// 为什么要有这个文件：这些脚本第一版把一条**写死的浏览器绝对路径**放进数组里
// （某位开发者的 `$HOME/.cache/<tool>/chrome`）。在写它的那台机器上能跑，在别人的
// 干净检出里只会得到「找不到 chrome」，而那条错误看着像脚本坏了。
// 私有宿主路径不该出现在交付集里。
//
// 顺序（与 support/full-game/run-full.py 的 find_chrome 保持一致，两处不各记一套规则）：
//   ① 显式的 CHROME=<path>：调用者说了算，哪怕它不存在也直接报错，不静默降级；
//   ② PATH 上的 chrome / chromium / chromium-browser / google-chrome；
//   ③ puppeteer 缓存（~/.cache/puppeteer/chrome*/*/chrome-linux64/chrome）。
//
// 找不到就抛，并说清「该怎么办」——不返回 null 让调用方在别处崩。
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const ON_PATH = ['chrome', 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];

function fromPath() {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const name of ON_PATH) {
    for (const dir of dirs) {
      const cand = path.join(dir, name);
      if (existsSync(cand)) return cand;
    }
  }
  return null;
}

function fromPuppeteerCache() {
  const root = path.join(homedir(), '.cache', 'puppeteer');
  if (!existsSync(root)) return null;
  const hits = [];
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chrome')) continue;
    const versions = path.join(root, entry);
    for (const v of readdirSync(versions)) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const cand = path.join(versions, v, rel);
        if (existsSync(cand)) hits.push(cand);
      }
    }
  }
  // 多版本时取字典序最后一个 —— 与 run-full.py 的 sorted()[-1] 同一规则，便于对照复跑。
  return hits.sort().pop() ?? null;
}

export function findChrome() {
  const explicit = process.env.CHROME;
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`CHROME 指向的文件不存在：${explicit}`);
    }
    return explicit;
  }
  const found = fromPath() ?? fromPuppeteerCache();
  if (!found) {
    throw new Error('找不到 chrome：设 CHROME=/path/to/chrome，或把它放进 PATH / puppeteer 缓存');
  }
  return found;
}
