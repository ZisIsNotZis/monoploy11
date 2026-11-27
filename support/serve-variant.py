#!/usr/bin/env python3
# 对照用第二入口，只换端口，不碰 8000。用法：python .scratch/serve-variant.py [port]
# 路径归一：/./x、//x、x/ 这类畸形写法都收敛到正常路径，
# 因为地址栏贴错或浏览器把 ./x 解析到站点根时会打不出资源（曾经 404 掉对照注入）。
import os
import posixpath
import sys
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# 只在 __main__ 里用；import 时不该起服务（分层测试要 import 验判定）。
def _port():
    return int(sys.argv[1]) if len(sys.argv) > 1 else 8001

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INVALID = os.path.join(ROOT, '__invalid_path__')

# 只做「已知别名」映射，不是兜底：浏览器若把 ./af-variant-inject.js 解到根，
# 仍能拿到真正那份文件。表里没有的路径找不到就是 404。
ALIASES = {
    '/af-variant-inject.js': '/.scratch/af-variant-inject.js',
    '/af-variant.html': '/.scratch/af-variant.html',
    # 浏览器/粘贴常把前导点吃掉，只剩 /scratch/...
    '/scratch/af-variant-inject.js': '/.scratch/af-variant-inject.js',
    '/scratch/af-variant.html': '/.scratch/af-variant.html',
}

# 内部目录不得经 HTTP 发出。
#
# 8001 此前一直没有拦截，实测 /.git/config 会把 remote URL 一起发出去。
# 这里补上和 serve.py 对齐的三层，**但不拦 `.scratch`** ——
# 对照页只能从这里取，堵了 8001 就没有意义了。
# 也不拦 `__invalid_path__`：那是本服务器内部的 404 哨兵，不是真实目录。
BLOCKED_PREFIXES = ('/.git', '/.praxis2', '/.vscode', '/.idea', '/node_modules', '/__pycache__',
                    '/__invalid_path__')
BLOCKED_ROOTS = tuple(os.path.join(ROOT, p.lstrip('/')) for p in BLOCKED_PREFIXES)
BLOCKED_SEGMENTS = frozenset(p.lstrip('/') for p in BLOCKED_PREFIXES)


def _blocked_segments(norm):
    # Windows 大小写不敏感，且会吃掉段尾的点和空格：
    # /.GIT/x、/.git./x 全落到盘上同一个目录，8.3 短名（.git~1）同理。
    for seg in norm.split('/'):
        if seg.rstrip('. ').lower() in BLOCKED_SEGMENTS:
            return True
    return False


def _blocked_realpath(full):
    # 名字判完再用最终路径兜一道：realpath 会问内核要规范大小写、
    # 展开 8.3 短名与符号链接，名字层面的绕写在这里收口。
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


# #3319d：这条入口原来是一份**黑名单** —— 除了点名的几个目录，仓库里任何文件都能被取走。
# 先前的证据是 /.git/config 能读到；同样的形状对任何「将来才出现的」文件也成立：
# 一次误留的浏览器资料（Cookies / Login Data）、一份本地 notes、一个 .env，都会 200。
# 清空当前目录只能让这一次的检查变绿，管不住下一个文件。
#
# 所以改成**白名单**：只发出对照页真的会加载的东西。
#   · 两个夹具（URL 仍是 /.scratch/...，见 ALIASES / compare_fallback）
#   · 它们相对引用的 ../styles.css 与 ../src/**（对照页 import 的是同一份产品模块）
# 其余一律 404 —— 不管它在不在黑名单里、也不管它是不是今天才被创建。
SERVABLE_EXACT = frozenset({
    # 对照页与它的注入脚本（URL 仍是 /.scratch/...，见 ALIASES / compare_fallback）
    '/.scratch/af-variant.html',
    '/.scratch/af-variant-inject.js',
    '/.scratch/af-variant-inject.js'.replace('af-variant-inject', 'af-variant.html'),
    # 原版首页与它的样式：8001 的 `/` 一直是「打开原版」的入口，这一轮不拿走它。
    # 它只需要 styles.css 与 /src/**，两样都已在白名单里，所以发它不会把仓库打开。
    '/',
    '/index.html',
    '/styles.css',
})
SERVABLE_PREFIXES = ('/src/',)


def is_servable(norm):
    """这个路径该不该由 8001 发出去。白名单，不猜。"""
    if norm in SERVABLE_EXACT:
        return True
    return any(norm.startswith(pref) for pref in SERVABLE_PREFIXES)


# 尾斜杠：/x.html/ 直接回 200 会让浏览器把最后一段当目录，
# 相对子资源（./af-variant-inject.js、../styles.css）全部解析错位 ——
# 页面看似打开、实际没有注入。所以「尾斜杠 + 指向真实文件」一律 301 到规范路径；
# 指向目录的尾斜杠保持原语义。


def normalize_url_path(raw):
    # 手工切 query/fragment，不用 urlsplit：urlsplit('//x') 会把 x 当成 netloc、
    # path 变空，函数就退化成 '/'。虽然 parse_request 已先把前导 // 折掉，
    # 但归一函数不该依赖调用方的预处理。
    path = raw.split('#', 1)[0].split('?', 1)[0]
    path = urllib.parse.unquote(path).replace('\\', '/')
    path = posixpath.normpath('/' + path.lstrip('/'))
    if path == '.':
        path = '/'
    return ALIASES.get(path, path)


# 夹具已提交在 `support/compare/`，但 URL 与若干测试必须继续是 `/.scratch/...`
# （8001 对 `.scratch` 有意开放）。以前这个恒等式只在「开发机上有 .scratch 副本」时成立：
# 干净检出里 `node --test` 会因此整片红（44 条 blocked-* 全挂，第一句是
# 「端口上没有正常的 serve-variant.py」），而失败现场看起来像产品坏了。
# 现在 URL 由服务器负责翻译：`.scratch/<名字>` 在磁盘上没有时，从提交过的
# `support/compare/<名字>` 取。反过来不成立（不拿 .scratch 覆盖 committed 副本）。
COMPARE_DIR = os.path.join(ROOT, 'support', 'compare')
SCRATCH_DIR = os.path.join(ROOT, '.scratch')


def compare_fallback(norm):
    """`/.scratch/x` -> support/compare/x 当且仅当 .scratch/x 不存在时。"""
    if not norm.startswith('/.scratch/'):
        return None
    name = norm[len('/.scratch/'):]
    if not name or '/' in name:
        return None
    if os.path.isfile(os.path.join(SCRATCH_DIR, name)):
        return None
    cand = os.path.join(COMPARE_DIR, name)
    return cand if os.path.isfile(cand) else None


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        norm = normalize_url_path(path)
        if is_blocked(norm):
            return INVALID  # 交给 SimpleHTTPRequestHandler 走正常 404
        if not is_servable(norm):
            return INVALID   # 白名单之外：一律 404（不依赖它是否在黑名单里）
        fallback = compare_fallback(norm)
        if fallback:
            return fallback
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
        if is_blocked(target) or not is_servable(target):
            return False  # 被拦/不在白名单的路径不做 301，否则 Location 会把 404 变可见跳转
        if not (os.path.isfile(os.path.join(ROOT, target.lstrip('/')))
                or compare_fallback(target)):
            return False  # 目录或不存在：交给正常流程，保持目录/404 语义
        self.send_response(301)
        self.send_header('Location', target + (('?' + parts.query) if parts.query else ''))
        self.send_header('Content-Length', '0')
        self.end_headers()
        return True

    def _deny_blocked(self):
        # 返回 True 表示已回过 404。
        # translate_path 把被拦路径换成 INVALID 哨兵，靠的是「那个文件名不存在」
        # 才落到 404 —— 只要有人在仓库根写个同名文件，被拦路径就会变成它的 200。
        # 所以这里在 handler 层直接拒，不依赖文件系统状态。
        norm = normalize_url_path(self.path)
        # 白名单也在这里再判一次（不是只靠 translate_path 换 INVALID 哨兵）：
        # 哨兵靠「那个名字在盘上不存在」才落到 404，而白名单之外的名字将来可能有文件。
        if is_blocked(norm) or not is_servable(norm):
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


# 包在 __main__ 里：测试要 import 本文件验 is_blocked / _blocked_realpath 这两层
# （HTTP 级断言分不清哪层在生效），import 时不能把服务跑起来。
# #1807b：与 serve.py 同一修法。
#  · 传 0 ⇒ 由 OS 分配，绑好后向 stdout 宣告 `LISTENING <port>`（测试从自己 spawn 的进程读回）；
#  · allow_reuse_address=False ⇒ Windows 上第二个绑定会真切报错而不是静默共享同一端口。
# 旧行为（带固定端口、只打印 `serving cwd on N`）保留：下面那行 print 没删。
if __name__ == '__main__':
    PORT = _port()
    ThreadingHTTPServer.allow_reuse_address = False
    httpd = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    real = httpd.server_address[1]
    print(f'serving cwd on {real}', flush=True)
    print(f'LISTENING {real}', flush=True)
    httpd.serve_forever()
