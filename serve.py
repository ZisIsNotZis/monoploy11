#!/usr/bin/env python3
# 静态服务器：禁止缓存，避免浏览器拿着旧 JS 跑新页面。
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

ThreadingHTTPServer(('0.0.0.0', 8000), Handler).serve_forever()
