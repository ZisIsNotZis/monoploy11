#!/usr/bin/env python3
"""#3344：跑第一屏几何量具（两种画幅，抢端口，起 headless chrome）。

与 support/probe-3342/entry-geom.py 同构 —— 那里已经把「浏览器是宿主依赖而不是仓库文件」
这件事处理对了一次（复用 run-full.py 的 find_chrome），这里不重写一遍。
差别只有两处：画幅是 390×844 与 360×640 各一次，且脚本换成 3344 的那支。
"""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def main():
    http_port, cdp_port = free_port(), free_port()
    server = subprocess.Popen([sys.executable, '-B', str(ROOT / 'serve.py'), str(http_port)],
                              cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(100):
            line = server.stdout.readline()
            if 'LISTENING' in line:
                break
        else:
            raise SystemExit('server never printed LISTENING')

        import importlib.util
        spec = importlib.util.spec_from_file_location('run_full', ROOT / 'support' / 'full-game' / 'run-full.py')
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        browser = str(mod.find_chrome())
        if not Path(browser).is_file():
            raise SystemExit(f'no chrome found (CHROME_BIN={os.environ.get("CHROME_BIN")!r})')

        # 临时浏览器配置目录必须跟着这次运行走、跑完就删。
        # supervisor 的原话：「我看到临时浏览器配置目录就在探针附近」—— 它确实在，
        # 因为我第一版把它写成 HERE/'chrome-profile'（探针旁边、跑完还留着）。
        # #3320 的教训写着「别把一次性现场写进项目树」，这里又把同一条犯了。
        profile = Path(tempfile.mkdtemp(prefix='geom-3344-'))
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
            env = dict(os.environ, HTTP=str(http_port), CDP=str(cdp_port))
            r = subprocess.run(['node', str(HERE / 'entry-geom.mjs')], cwd=str(ROOT), env=env,
                               capture_output=True, text=True, timeout=240)
            print(r.stdout)
            if r.returncode != 0:
                print(r.stderr[-2000:], file=sys.stderr)
            return r.returncode
        finally:
            chrome.terminate()
            try:
                chrome.wait(timeout=10)
            except subprocess.TimeoutExpired:
                chrome.kill()
            # 配置目录跟着进程走：没删掉就会留下一堆一次性现场（这正是 supervisor 看到的那个）。
            shutil.rmtree(profile, ignore_errors=True)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == '__main__':
    sys.exit(main())
