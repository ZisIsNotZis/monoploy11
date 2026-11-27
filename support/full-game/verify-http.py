#!/usr/bin/env python3
"""Sealed-box byte check for the #3278 clean tree.

The claim under test: "the server hands a browser exactly the bytes the lock names". The
tree was copied FROM the lock, so comparing the tree to the lock would only re-read my own
copy. This starts a second serve.py over the same tree, fetches the load-bearing files
over HTTP, and compares the RESPONSE BODIES with the lock's hashes -- what actually
crosses the wire, not what sits on disk.
"""
import errno
import hashlib
import socket
import subprocess
import sys
from pathlib import Path
from urllib.request import build_opener, ProxyHandler

HERE = Path(__file__).resolve().parent
# #3330：新锁（起手开工现金那一轮）。旧锁 3278 保留在库里作为历史。
LOCK = HERE.parent.parent / 'docs/evidence/slice-entry-3331.sha256'
CHECK = ['index.html', 'styles.css', 'src/main.js', 'src/ui/render.js', 'serve.py']


def port_free(port):
    """Local copy: this file used to import it from a .scratch scratchpad, which made the
    "replay from a clean checkout" claim false because that file was never committed."""
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(('127.0.0.1', port)) == errno.ECONNREFUSED


def lock_of(rel):
    for line in LOCK.read_text().splitlines():
        if line.strip():
            digest, name = line.split('  ', 1)
            if name == rel:
                return digest
    raise SystemExit(f'lock does not name {rel}')


def main(tree, port):
    if not port_free(port):
        raise SystemExit(f'verify port {port} busy')
    serve = subprocess.Popen([sys.executable, '-B', str(Path(tree) / 'serve.py'), str(port)],
                             cwd=str(tree), stdout=subprocess.PIPE, text=True)
    try:
        line = serve.stdout.readline().strip()
        if line != f'LISTENING {port}':
            raise SystemExit(f'verify server did not announce: {line!r}')
        # No proxy env: loopback is the endpoint under test, not an origin to route through.
        opened = build_opener(ProxyHandler({}))
        # SEALED means exactly two things, and both are asserted here: the body is the
        # lock's body, and the response forbids reuse (PREREG F5 names no-store). A run
        # whose headers were missing is NOT-SEALED even though the bytes matched -- the
        # earlier version printed SEALED after only checking bytes, which was a receipt
        # claiming more than it had looked at.
        ok = True
        for rel in CHECK:
            with opened.open(f'http://127.0.0.1:{port}/{rel}', timeout=10) as r:
                body = r.read()
                got = hashlib.sha256(body).hexdigest()
                want = lock_of(rel)
                cache = r.headers.get('Cache-Control') or ''
                same = got == want
                no_store = 'no-store' in cache.lower()
                ok = ok and same and no_store
                print(f'{rel}: "{"SAME" if same else "DIFFERS"}" got={got[:12]} want={want[:12]} '
                      f'no-store={"yes" if no_store else "NO"} cache={cache!r} bytes={len(body)}')
        print('SEALED bytes+no-store' if ok else 'NOT-SEALED')
        return 0 if ok else 1
    finally:
        serve.terminate()
        try:
            serve.wait(timeout=15)
        except subprocess.TimeoutExpired:
            serve.kill()
            serve.wait(timeout=10)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], int(sys.argv[2])))
