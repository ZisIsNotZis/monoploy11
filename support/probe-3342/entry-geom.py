#!/usr/bin/env python3
"""#3342 第一屏：争街提示有没有把「开一局」挤出视口。

为什么必须量：`#sliceStyleNote` 是**新加的一行字**。这个项目里已经有过一次
「多一行 ⇒ 第三张卡被推出 elementFromPoint 可点范围」的实测（6_SLICE.md 记录：
bottom 830 → 862）。第一屏是玩家唯一必须先按下按钮才能继续的地方，
把它挤出视口就是把新增说明写成了新的阻断。

判据（390×844）：
  ① 提示可见（非 hidden、有文本）
  ② 提示自身在视口内
  ③ **`#startSlice` 可点**：中心点在视口内，且 elementFromPoint 命中它自己
  ④ 与不带 cross=1 的同一屏相比，`#startSlice` 的 top 位移 < 24px
"""
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE / 'entry-geom'


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def main():
    OUT.mkdir(exist_ok=True)
    http_port = free_port()
    cdp_port = free_port()
    server = subprocess.Popen([sys.executable, '-B', str(ROOT / 'serve.py'), str(http_port)],
                              cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(100):
            line = server.stdout.readline()
            if 'LISTENING' in line:
                break
        else:
            raise SystemExit('server never printed LISTENING')

        # 浏览器是宿主依赖，不是仓库文件：复用 support/full-game/run-full.py 的 find_chrome()。
        # 我上一版自己写了一版 PATH 查找，于是「没有 chrome」——而同一台机器上整局量具刚刚跑通过。
        # 文件名是 run-full.py（带连字符），不能直接 import；按路径装载。
        import importlib.util
        spec = importlib.util.spec_from_file_location('run_full', ROOT / 'support' / 'full-game' / 'run-full.py')
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        browser = str(mod.find_chrome())
        if not Path(browser).is_file():
            raise SystemExit(f'no chrome found (CHROME_BIN={os.environ.get("CHROME_BIN")!r})')

        profile = OUT / 'profile'
        chrome = subprocess.Popen([browser, '--headless=new', f'--remote-debugging-port={cdp_port}',
                                   f'--user-data-dir={profile}', '--no-first-run', '--no-default-browser-check',
                                   '--window-size=390,844', 'about:blank'],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            import urllib.request
            for _ in range(100):
                try:
                    urllib.request.urlopen(f'http://127.0.0.1:{cdp_port}/json/version', timeout=1).read()
                    break
                except Exception:
                    time.sleep(0.1)
            script = Path(__file__).with_name('entry-geom.mjs')
            env = dict(os.environ, HTTP=str(http_port), CDP=str(cdp_port))
            r = subprocess.run(['node', str(script)], cwd=str(ROOT), env=env,
                               capture_output=True, text=True, timeout=180)
            print(r.stdout)
            if r.returncode != 0:
                print(r.stderr[-2000:], file=sys.stderr)
            return r.returncode
        finally:
            chrome.terminate()
            chrome.wait(timeout=20)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == '__main__':
    raise SystemExit(main())
