#!/usr/bin/env python3
"""Sealed-box byte check for the lock-built clean tree.

The claim under test: "the server hands a browser exactly the bytes the lock names". The
tree was copied FROM the lock, so comparing the tree to the lock would only re-read my own
copy. This starts a second serve.py over the same tree, fetches the files over HTTP, and
compares the RESPONSE BODIES with the lock's hashes -- what actually crosses the wire,
not what sits on disk.

#3336: two things here were weaker than the sentence above said.
  1. The lock was a literal `slice-entry-333N.sha256` in this file. Advancing the product
     advanced `run-full.py` and not this one, so `receipt-3335-final/verify-http.txt`
     printed SEALED after comparing the 3335 tree against the **3334** lock.
  2. `CHECK` was five hand-picked files. 3334->3335 changed exactly one file,
     `src/ui/slice.js`, and it was not among them -- so even with the right lock the
     sample could not have seen that change. A sample cannot seal a tree; only the whole
     file set can. All lock entries are fetched now (they are local requests).
Both are fixed by reading `docs/evidence/current-lock.txt` through `lockfile.py` and by
sealing the full lock instead of a sample. `test/current-lock.test.js` keeps a literal
lock name from coming back.
"""
import errno
import hashlib
import socket
import subprocess
import sys
from pathlib import Path
from urllib.request import build_opener, ProxyHandler

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import lockfile  # noqa: E402  (path set above)

LOCK = lockfile.current_lock()


def port_free(port):
    """Local copy: this file used to import it from a .scratch scratchpad, which made the
    "replay from a clean checkout" claim false because that file was never committed."""
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(('127.0.0.1', port)) == errno.ECONNREFUSED


def main(tree, port, json_out=None):
    if not port_free(port):
        raise SystemExit(f'verify port {port} busy')
    wanted = lockfile.entries(LOCK)
    serve = subprocess.Popen([sys.executable, '-B', str(Path(tree) / 'serve.py'), str(port)],
                             cwd=str(tree), stdout=subprocess.PIPE, text=True)
    try:
        line = serve.stdout.readline().strip()
        if line != f'LISTENING {port}':
            raise SystemExit(f'verify server did not announce: {line!r}')
        # No proxy env: loopback is the endpoint under test, not an origin to route through.
        opened = build_opener(ProxyHandler({}))
        # SEALED means exactly two things, and both are asserted here: every body is the
        # lock's body, and the response forbids reuse (PREREG F5 names no-store). A run
        # whose headers were missing is NOT-SEALED even though the bytes matched -- the
        # earlier version printed SEALED after only checking bytes, which was a receipt
        # claiming more than it had looked at.
        ok = True
        print(f'lock {LOCK.name} ({len(wanted)} files)')
        bad = 0
        # 每个文件都印一行，不只印坏的：读者要能看见「比的到底是哪些字节」，
        # 而 3335 那次正是在这一步漏掉了唯一改过的 src/ui/slice.js。
        rows = []
        served = {}
        for rel, want in wanted:
            try:
                with opened.open(f'http://127.0.0.1:{port}/{rel}', timeout=10) as r:
                    body = r.read()
                    cache = r.headers.get('Cache-Control') or ''
            except Exception as ex:  # noqa: BLE001 - a fetch failure is a failed seal
                ok = False
                bad += 1
                rows.append(f'{rel}: ERROR {ex}')
                continue
            got = hashlib.sha256(body).hexdigest()
            served[rel] = {'sha256': got, 'bytes': len(body), 'no_store': 'no-store' in cache.lower()}
            same = got == want
            no_store = 'no-store' in cache.lower()
            rows.append(f'{rel}: "{"SAME" if same else "DIFFERS"}" got={got[:12]} '
                        f'want={want[:12]} no-store={"yes" if no_store else "NO"} '
                        f'cache={cache!r} bytes={len(body)}')
            if not (same and no_store):
                ok = False
                bad += 1
        for row in rows:
            print(row)
        print((f'SEALED bytes+no-store over all {len(wanted)} lock files')
              if ok else f'NOT-SEALED ({bad} of {len(wanted)} files failed)')
        # #3336: the human-readable log truncates hashes to 12 chars, which is fine to read
        # and useless to re-check. A machine-readable record carries the full digests so a
        # reader with the receipt (not the run directory) can compare every one against the
        # lock. The receipt carries this file; verify-receipt.py item F re-does the compare.
        if json_out:
            import json
            Path(json_out).write_text(json.dumps({
                'lock': str(LOCK.relative_to(lockfile.ROOT)),
                'lock_sha256': lockfile.sha(LOCK),
                'files': len(wanted),
                'sealed': bool(ok),
                'served': served,
            }, indent=1) + '\n')
        return 0 if ok else 1
    finally:
        serve.terminate()
        try:
            serve.wait(timeout=15)
        except subprocess.TimeoutExpired:
            serve.kill()
            serve.wait(timeout=10)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], int(sys.argv[2]),
                  sys.argv[3] if len(sys.argv) > 3 else None))
