"""从真实入口走一遍对照页：起 8001，打开对照页，再顺着页面真实的引用递归取子资源。

不是列白名单再逐条请求 —— 那样只是把服务器自己的名单抄一遍。这里从页面 HTML 解析
src/href，再顺着每份 JS 的 import 递归走，少一个文件就红。

为什么必须递归：`main.js` import 29 个模块。只看 HTML 的 4 个引用，
「页面能取到」和「页面能跑」是两句话 —— 真正的白屏是模块取不到。

用法：python3 -B support/compare-entry-smoke.py
"""
import http.client
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VARIANT = os.path.join(HERE, 'serve-variant.py')

IMPORT_RE = re.compile(r"""(?:from|import)\s*["'](\.[^"']+)["']""")
REF_RE = re.compile(r"""(?:src|href)\s*=\s*["']([^"']+)["']""")

# import 图是 29 个模块 + 首页 + 样式 + 注入脚本 + 对照页本体的子资源。
# 少于这个数就说明递归没真的走进去 —— 那个 PASS 不能当作「页面能跑」的证据。
MIN_RESOURCES = 30


def get(port, path):
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
    try:
        conn.request('GET', path)
        r = conn.getresponse()
        return r.status, r.read()
    finally:
        conn.close()


def url_of(base_url, ref):
    """按 base_url 解析一个相对引用（base_url 可以带 query）。"""
    base_no_query = base_url.split('?')[0]
    if ref.startswith('/'):
        joined = ref
    else:
        joined = os.path.join(os.path.dirname(base_no_query), ref)
    return os.path.normpath(joined).replace('\\', '/')


def main():
    py = os.environ.get('PYTHON') or ('python' if os.name == 'nt' else 'python3')
    proc = subprocess.Popen([py, '-B', VARIANT, '0'], cwd=ROOT,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        port = None
        deadline = time.time() + 20
        while time.time() < deadline:
            line = proc.stdout.readline()
            m = re.search(r'LISTENING (\d+)', line or '')
            if m:
                port = int(m.group(1))
                break
        if port is None:
            raise SystemExit('serve-variant.py 没有宣告端口')

        status, body = get(port, '/af-variant.html')
        if status != 200:
            raise SystemExit(f'对照页 /af-variant.html = {status}')
        html = body.decode('utf-8', 'replace')

        queue = []
        for ref in REF_RE.findall(html):
            if ref.startswith(('http://', 'https://', 'data:', '#', 'mailto:')):
                continue
            queue.append((url_of('/af-variant.html', ref), 'af-variant.html'))

        problems = []
        seen = {}
        while queue:
            url, src = queue.pop()
            if url in seen:
                continue
            st, payload = get(port, url)
            seen[url] = st
            if st != 200:
                problems.append(f'{url} = {st}  （被 {src} 引用）')
                continue
            # 判后缀必须去掉 query 再看：`/src/main.js?v=150` 是缓存串，
            # 不是另一个文件。第一版在这里直接 `url.endswith('.js')`，于是递归
            # 一次都没开始、只取到 4 个资源，却打了一行 PASS。
            if url.split('?')[0].endswith('.js'):
                text = payload.decode('utf-8', 'replace')
                for spec in IMPORT_RE.findall(text):
                    queue.append((url_of(url, spec.split('?')[0]), url))

        if len(seen) < MIN_RESOURCES:
            problems.append(
                f'只取到 {len(seen)} 个资源（<{MIN_RESOURCES}）：import 递归没发生，'
                '这条 PASS 不能当作页面能跑的证据')

        print(f'port={port}  入口实际取到 {len(seen)} 个资源：')
        for u in sorted(seen):
            print(f'    {seen[u]}  {u}')

        if problems:
            print('SMOKE: FAIL')
            for p in problems:
                print('  -', p)
            return 1
        print('SMOKE: PASS')
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == '__main__':
    sys.exit(main())
