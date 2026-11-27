#!/usr/bin/env python3
"""#3278: simulate the clean checkout the user actually asked for.

Why this is separate from run-full.py: run-full.py proves a game plays from the lock-built
tree, but it reads that tree from THIS worktree, where `test/`, `tools/` and `.scratch/`
all exist. So a pass there still leaves one doubt -- "would this work for someone who only
got the delivered files?" This answers exactly that and nothing more:

  1. copy ONLY what DELIVERY.txt names into a directory that does not exist yet;
  2. assert the copy holds nothing the manifest does not name (no `tools/`, no staged
     `.scratch/`: those fixtures are committed in support/compare/ and mapped by URL);
  3. run the harness's own gates there: probe-lib, check-delivery, then a full game.

Anything that reaches back into the worktree (an absolute path, a missing import) fails
here rather than in a teammate's hands. The temp dir is removed on success and kept on
failure so the failure can be inspected.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LIST = HERE / 'DELIVERY.txt'
# An attempt that fails must not block the next one: the dest is named per attempt, and
# CLEAN_KEEP=1 preserves a failed checkout for inspection. This script writes per attempt
# under a throwaway directory -- never into the project tree.
#
# #3320: the root is now `CLEAN_TMPDIR`, not a hardcoded /tmp. On this host /tmp is a tmpfs
# that other projects filled to 100% (7.7G of unrelated venvs and archives), so the copy
# died with `No space left on device` and the checkout looked broken when it was only
# homeless. Space on /tmp is not a property of this delivery. The default is unchanged
# (still /tmp), so existing callers and docs behave exactly as before.
NAME = os.environ.get('CLEAN_NAME') or 'cleancheck-3278'
DEST = Path(os.environ.get('CLEAN_TMPDIR') or '/tmp') / NAME
KEEP = os.environ.get('CLEAN_KEEP') == '1'


def read_list():
    out = []
    for raw in LIST.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        kind, _, target = line.partition(' ')
        out.append((kind, target.strip()))
    return out


def copy_in(entries):
    DEST.mkdir(parents=True)
    copied = 0
    for kind, target in entries:
        if kind == 'test' or '*' in target:
            continue                    # `test` entries are expanded by copy_tests below
        src = ROOT / target
        if not src.is_file():
            raise SystemExit(f'manifest names a missing file: {target}')
        dst = DEST / target
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())
        copied += 1
    # Everything the manifest calls `test` (globs included) is copied as named, so a
    # missing fixture shows up as a manifest bug here, not as a mystery suite failure.
    n = 0
    for kind, target in entries:
        if kind != 'test':
            continue
        for path in sorted(ROOT.glob(target)):
            if not path.is_file():
                continue
            dst = DEST / path.relative_to(ROOT)
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(path.read_bytes())
            n += 1
    for extra in ('package.json',):
        if (ROOT / extra).is_file():
            (DEST / extra).parent.mkdir(parents=True, exist_ok=True)
            (DEST / extra).write_bytes((ROOT / extra).read_bytes())
    # The compare-experiment suite (blocked-*, trailing-slash-variant, variant-supply)
    # asks for LITERAL `/.scratch/af-variant.html` URLs, and serve-variant.py deliberately
    # keeps `.scratch` open on 8001 -- that openness is a security assertion we must not
    # weaken. This script USED to satisfy both by copying support/compare/* into .scratch/.
    # That made "verifiable from what you got" depend on a staging step nobody's checkout
    # does: a plain `git clone` + `node --test` was red on 44 blocked-* tests that looked
    # like a broken server. The resolution now lives in serve-variant.py (URL -> committed
    # file), so nothing is staged and a plain checkout passes. Kept as 0 so the printed
    # summary still says how many fixtures were placed by hand: none.
    staged = 0
    return copied, n, staged


def end(code):
    """Remove the checkout unless the caller asked to keep a failure for inspection.

    Keeping it by default is what made the second attempt refuse itself.
    """
    if KEEP:
        print(f'kept for inspection (CLEAN_KEEP=1): {DEST}')
    else:
        shutil.rmtree(DEST, ignore_errors=True)
        print(f'checkout removed: {DEST}')
    return code


def run(argv, cwd, timeout=900):
    r = subprocess.run(argv, cwd=str(cwd), capture_output=True, text=True, timeout=timeout,
                       env=dict(os.environ, PATH=os.environ.get('PATH', '')))
    return r


def main():
    if DEST.exists():
        raise SystemExit(f'REFUSED: {DEST} exists; remove it yourself')
    entries = read_list()
    copied, tests, staged = copy_in(entries)
    print(f'copied {copied} named files + {tests} test files + {staged} compare fixtures -> {DEST}')

    # A leak is a file that the delivery does not name. Nothing is staged any more, so
    # `.scratch/` must not appear here even as a path: the compare fixtures live in
    # `support/compare/` (named by the manifest) and the server maps their old URLs.
    # Judging by the list rather than by a hard-coded "no tools/" rule is what keeps this
    # honest: naming tools/play.mjs in the manifest is a deliberate decision, and a blanket
    # rule would report the delivery as its own leak.
    expected = set()
    for kind, target in entries:
        if '*' in target:
            expected |= {str(p.relative_to(ROOT)) for p in ROOT.glob(target) if p.is_file()}
        else:
            expected.add(target)
    if (ROOT / 'package.json').is_file():
        expected.add('package.json')
    leaked = sorted(str(p.relative_to(DEST)) for p in DEST.rglob('*')
                    if p.is_file() and str(p.relative_to(DEST)) not in expected)
    if leaked:
        print(f'files present that the delivery does not name: {leaked}')
        return end(1)
    print(f'checkout holds only delivered files ({len(expected)} named, none extra)')

    # 1. the suite, from the checkout, without the worktree on sys.path or node's path.
    # pipefail: piping to tail must not swallow the suite's exit code. Without it a red
    # suite printed its failures and still returned 0 -- a receipt claiming more than it saw.
    r = run(['bash', '-lc', 'set -o pipefail; node --test test/*.test.js 2>&1 | tail -14'], DEST)
    suite_red = [l for l in r.stdout.splitlines() if l.startswith('# fail') or ' not ok ' in l]
    print('suite failures reported:', len(suite_red))
    print(r.stdout.strip()[-1200:])
    if r.returncode != 0:
        print(f'SUITE FAILED (checkout at {DEST})')
        return end(1)

    # 2. the delivery manifest, checked against the copied bytes.
    r = run([sys.executable, 'support/full-game/check-delivery.py'], DEST)
    print(r.stdout.strip()[-800:])
    if r.returncode != 0:
        print(f'MANIFEST FAILED (checkout at {DEST})')
        return end(1)

    # 3. a whole game, from this checkout only.
    r = run([sys.executable, 'support/full-game/run-full.py'], DEST,
            timeout=900)
    print(r.stdout.strip()[-2500:])
    if r.returncode != 0:
        print(f'GAME FAILED (checkout at {DEST})')
        return end(1)
    print(f'CLEAN CHECKOUT: PASS ({DEST})')
    return end(0)


# A crash mid-run (before end()) used to leave DEST behind, and the next attempt then
# refused itself. Cleaning on any exit path is what makes repeated attempts safe.
# Only Exception is caught: SystemExit is the normal exit path and already went through
# end(), so catching BaseException made a PASS print "kept after error".
if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        if DEST.exists() and not KEEP:
            shutil.rmtree(DEST, ignore_errors=True)
            print(f'checkout removed after error: {DEST}')
        else:
            print(f'checkout kept after error (CLEAN_KEEP=1): {DEST}')
        raise
