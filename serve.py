#!/usr/bin/env python3
# 静态服务器：禁止缓存，避免浏览器拿着旧 JS 跑新页面。
# 路径归一：/./x、//x、x/ 这类畸形写法都收敛到正常路径，
# 因为地址栏贴错或浏览器把 ./x 解析到站点根时会打不出资源（曾经 404 掉对照注入）。
# 尾斜杠：/x.html/ 直接回 200 会让浏览器把最后一段当目录，
# 相对子资源（./af-variant-inject.js、../styles.css）全部解析错位 ——
# 页面看似打开、实际没有注入。所以「尾斜杠 + 指向真实文件」一律 301 到规范路径；
# 指向目录的尾斜杠保持原语义。
# 原版入口只做归一，不做别名：对照页永远只能从 8001 的 /.scratch/ 取。
import os
import posixpath
import sys
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
INVALID = os.path.join(ROOT, '__invalid_path__')

# 静态根是仓库根，所以「仓库内部物」默认全在 URL 空间里。按目录收口：
#   /.scratch   对照页只该从 8001 取；8000 发出它 == grow 对照结论作废
#   /.git       remote 地址与全部对象
#   /.praxis2   agent 的 trajectory.jsonl / memory.json / 进程日志
# 其余点目录同样是编辑配置或缓存，本就不该经 HTTP 发。
# 拦的是「归一之后」的路径，且带段名与 realpath 两道，见下。
BLOCKED_PREFIXES = ('/.scratch', '/.git', '/.praxis2', '/.vscode', '/.idea', '/node_modules',
                    '/__pycache__', '/__invalid_path__')
BLOCKED_ROOTS = tuple(os.path.join(ROOT, p.lstrip('/')) for p in BLOCKED_PREFIXES)
BLOCKED_SEGMENTS = frozenset(p.lstrip('/') for p in BLOCKED_PREFIXES)


def _blocked_segments(norm):
    # Windows 文件系统大小写不敏感，且会吃掉路径段末尾的点和空格：
    # /.SCRATCH/x、/.Scratch/x、/.scratch./x 全都落到盘上同一个 .scratch 目录。
    # 8.3 短名（.scrat~1）同理。所以逐段判，段名先 rstrip('. ') 再比小写。
    for seg in norm.split('/'):
        if seg.rstrip('. ').lower() in BLOCKED_SEGMENTS:
            return True
    return False


def _blocked_realpath(full):
    # 名字判完再用最终路径兜一道：realpath 会问内核要规范大小写、
    # 展开 8.3 短名和符号链接，名字层面的绕写在这里收口。
    if full == INVALID:
        return False
    try:
        real = os.path.realpath(full)
    except OSError:
        return False
    for root in BLOCKED_ROOTS:
        blocked = os.path.realpath(root)
        if real == blocked or real.startswith(blocked + os.sep):
            return True
    return False


def is_blocked(norm):
    for pref in BLOCKED_PREFIXES:
        if norm == pref or norm.startswith(pref + '/'):
            return True
    return _blocked_segments(norm)


def normalize_url_path(raw):
    # 只收敛写法，不做别名、不做兜底：找不到仍是 404。
    # 手工切 query/fragment，不用 urlsplit：urlsplit('//x') 会把 x 当成 netloc、
    # path 变空，函数就退化成 '/'。虽然 parse_request 已先把前导 // 折掉，
    # 但归一函数不该依赖调用方的预处理。
    path = raw.split('#', 1)[0].split('?', 1)[0]
    path = urllib.parse.unquote(path).replace('\\', '/')
    path = posixpath.normpath('/' + path.lstrip('/'))
    if path == '.':
        path = '/'
    return path


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        norm = normalize_url_path(path)
        if is_blocked(norm):
            return INVALID  # 交给 SimpleHTTPRequestHandler 走正常 404
        # 归一后仍带 .. 一律拒；再用绝对路径前缀兜一道，确保不出根目录。
        if '..' in norm.split('/'):
            return INVALID
        full = os.path.abspath(os.path.join(ROOT, norm.lstrip('/')))
        if full != ROOT and not full.startswith(ROOT + os.sep):
            return INVALID
        if _blocked_realpath(full):
            return INVALID  # 大小写 / 8.3 短名 / 尾点尾空格绕出来的同一条路径
        return full

    def _redirect_trailing_slash(self):
        # 返回 True 表示已经回过 301，调用方别再走正常响应。
        parts = urllib.parse.urlsplit(self.path)
        req_path = parts.path or '/'
        if not req_path.endswith('/'):
            return False
        bare = req_path.rstrip('/')
        if not bare:
            return False  # 根路径 '/' 不动
        target = normalize_url_path(bare)
        if is_blocked(target):
            return False  # 被拦前缀不做 301，否则 Location 会把 404 变可见跳转
        if not os.path.isfile(os.path.join(ROOT, target.lstrip('/'))):
            return False  # 目录或不存在：交给正常流程，保持目录/404 语义
        self.send_response(301)
        self.send_header('Location', target + (('?' + parts.query) if parts.query else ''))
        self.send_header('Content-Length', '0')
        self.end_headers()
        return True

    def _deny_blocked(self):
        # 返回 True 表示已回过 404。
        norm = normalize_url_path(self.path)
        # INVALID 是内部保留名，不该在 URL 空间里可取（否则它存在时能被直接下载）。
        if norm == '/__invalid_path__':
            self.send_error(404, 'File not found')
            return True
        # translate_path 把被拦路径换成 INVALID 哨兵路径，靠的是「那个文件名不存在」
        # 才落到 404 —— 只要有人在仓库根写个同名文件，被拦路径就会变成它的 200。
        # 实测过：建了 __invalid_path__ 之后 /.scratch/af-variant.html 返回 200 且内容是
        # 那个文件。所以这里在 handler 层直接拒，不依赖文件系统状态。
        if is_blocked(norm):
            self.send_error(404, 'File not found')
            return True
        return False

    def do_GET(self):
        if self._deny_blocked():
            return
        if self._redirect_trailing_slash():
            return
        super().do_GET()

    def do_HEAD(self):
        if self._deny_blocked():
            return
        if self._redirect_trailing_slash():
            return
        super().do_HEAD()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


# 默认 8000；给个可选端口参数，方便验证脚本另开一套而不扰正在跑的 8000。
# 只影响监听端口，不影响上面任何放行/拒绝规则。
# 包在 __main__ 里：测试要直接 import 本文件验 is_blocked / _blocked_realpath
# 这两层判定（HTTP 级断言分不清哪层在生效），import 时不能把服务跑起来。
# 作为脚本启动的行为完全不变。
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


# #1807：绑定时必须独占端口。
# HTTPServer.allow_reuse_address 默认 1 ⇒ 绑定带 SO_REUSEADDR。POSIX 上它只复用 TIME_WAIT，
# 但 **Windows 上它允许抢占已被监听的端口**（实测：两个 serve.py 同绑一个端口都成功、杀掉先绑者后
# 端口仍在应答）。后果不是「起不来」而是「两台服务器静默共用一根线」：
#   测试里 freePort() 是「探测空闲→spawn」两步，窗口期撞上就用同一端口；
#   后起的那份 python 没有报错，而它的 waitTcp + get('/index.html') 连到的可能是**别人的** serve.py
#   （同一仓库根，内容完全一样，HTTP 侧无法区分）⇒ 前置校验假绿；
#   等对方跑完 after() 杀掉进程，本份的剩余断言就全部 ECONNREFUSED。
# 关掉它之后，第二个绑定直接 OSError 10048 退出，「端口冲突」重新是**响的**，
# freePort() 原有的换端口重试才真正生效。
# 代价实测为零：Windows 上 TIME_WAIT 后的同端口重启两种设置都能成功。
# 写法上不能改成子类调用：test/blocked-internal-dirs.test.js 直接用正则
# /ThreadingHTTPServer\(\('([^']+)'/ 从本文件读绑定地址来验「只绑回环」
# （挡住有人把它改成 0.0.0.0）。把调用改名会让那条断言失去输入而变红 ——
# 本单第一版就这么咬到我自己一次（三道全红：“绑定地址变成 ”）。
# 所以只改类属性，保留调用字面量。
# #1807 第二处：端口可以由 OS 分配（传 0），分配结果从 stdout 宣告。
# 为什么必须这样：测试侧的 freePort() 是「探测空闲 → spawn」两步，两步之间有窗口。
# 绑 0 让「选端口」与「绑定」成为同一个原子动作，窗口根本不存在。
# 实测（.scratch/1807-port-race/probe_port0.py）：连续 8 个 bind(0) 拿到 8 个不同端口。
# 默认不带参数时仍然是 8000，带固定端口时行为完全不变（8000/8001 的启动不受影响）。
# 宣告格式固定为一行 `LISTENING <port>`，测试从 stdout 读，不靠猜。
if __name__ == '__main__':
    # 放在 __main__ 里：测试会 import 本文件验 is_blocked / _blocked_realpath，
    # 不该因为 import 就改动全局类的属性。
    ThreadingHTTPServer.allow_reuse_address = False
    httpd = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    real = httpd.server_address[1]
    sys.stdout.write(f'LISTENING {real}\n')
    sys.stdout.flush()
    httpd.serve_forever()
