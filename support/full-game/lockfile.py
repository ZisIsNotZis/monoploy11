"""Where the tools learn WHICH product lock is current -- one place, not three.

Why this exists (#3336)
-----------------------
`run-full.py`, `check-delivery.py` and `verify-http.py` each carried their own literal
`slice-entry-333N.sha256`. Advancing the product meant editing three constants, and one
of them was missed: `receipt-3335-final/verify-http.txt` says

    SEALED bytes+no-store

while `verify-http.py:22` was still pinned to 3334. So on that receipt the "the bytes
that crossed the wire are the lock's bytes" step compared the NEW tree against the OLD
lock -- and its five-file CHECK list did not include `src/ui/slice.js`, the only file
3335 changed. Two independent reasons that step could not have noticed the change it was
supposed to cover. The E item of `verify-receipt.py` was unaffected (it recomputes the
tree digest from the lock), so the receipt was not false everywhere -- just the one claim
that was quoted most often.

The lesson is the one already written into `insight.js` and `slice-ai.js`: a second copy
of "which things are legal/current" drifts, and the drift is invisible until something
asks. So the pointer lives in a file (`docs/evidence/current-lock.txt`), the tools read
it, and `test/current-lock.test.js` fails if any tool starts naming a lock again.

The pointer file is one line of text, deliberately: a reader with a clean checkout can
`cat` it and know which lock the delivered product bytes are supposed to match.
"""
import hashlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
POINTER = ROOT / 'docs' / 'evidence' / 'current-lock.txt'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def current_lock(root=ROOT, pointer=POINTER):
    """Resolve the pointer file to an absolute lock path.

    A missing/empty pointer, or one naming a file that is not there, is a hard error:
    silently falling back to "some lock" is exactly the failure this module removes.
    """
    root = Path(root)
    pointer = Path(pointer)
    if not pointer.is_file():
        raise SystemExit(f'no current-lock pointer at {pointer} -- every tool that '
                         f'seals or plays the product reads it')
    lines = [ln.strip() for ln in pointer.read_text().splitlines()
             if ln.strip() and not ln.strip().startswith('#')]
    if len(lines) != 1:
        raise SystemExit(f'{pointer} must hold exactly one lock path, found {len(lines)}')
    lock = root / lines[0]
    if not lock.is_file():
        raise SystemExit(f'{pointer} names {lines[0]}, which is not in this checkout')
    return lock


def entries(lock):
    """[(rel, sha256)] in lock-file order; a malformed line refuses rather than skips."""
    out = []
    for n, line in enumerate(Path(lock).read_text().splitlines(), 1):
        if not line.strip():
            continue
        if line.count('  ') < 1:
            raise SystemExit(f'{lock}:{n} is not "<sha256>  <path>": {line!r}')
        digest, rel = line.split('  ', 1)
        out.append((rel, digest))
    return out
