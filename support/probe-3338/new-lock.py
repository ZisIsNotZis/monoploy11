#!/usr/bin/env python3
"""#3338: write the product byte lock for this change.

The format is the same one `support/full-game/lockfile.py` reads: "<sha256>  <path>", one
product file per line, in the order the previous lock used, plus any file the previous lock
did not yet name. That last clause is what makes this script necessary rather than
`sha256sum > file`: 3338 adds `src/engine/market-ledger.js`, and a lock that silently
omitted it would leave the new numbers unsealed (the failure mode #3336 already paid for).

It refuses to guess:
  * the previous lock's file list must exist and must all still be on disk;
  * `src/` must contain no product file the new lock does not name (the same coverage rule
    `check-delivery.py` applies, checked here so a forgotten file fails before the receipt).

Run: python3 support/probe-3338/new-lock.py docs/evidence/slice-entry-3337.sha256 \
                                          docs/evidence/slice-entry-3338.sha256
"""
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__.strip().splitlines()[-1])
    prev, out = (ROOT / sys.argv[1]), (ROOT / sys.argv[2])
    if not prev.is_file():
        raise SystemExit(f'previous lock not found: {prev}')
    paths = []
    for raw in prev.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        digest, _, rel = line.partition('  ')
        if len(digest) != 64 or not rel:
            raise SystemExit(f'{prev.name}: not "<sha256>  <path>": {line!r}')
        if not (ROOT / rel).is_file():
            raise SystemExit(f'{prev.name} names a file that is gone: {rel}')
        paths.append(rel)

    # New product files (src/ only, plus the three root product files) must be named too.
    on_disk = ['index.html', 'serve.py', 'styles.css']
    on_disk += [str(p.relative_to(ROOT)).replace('\\', '/') for p in (ROOT / 'src').rglob('*')
                if p.is_file() and '__pycache__' not in p.parts]
    missing = sorted(set(on_disk) - set(paths))
    extra = sorted(set(paths) - set(on_disk))
    if extra:
        raise SystemExit(f'previous lock names non-product files: {extra}')
    paths.extend(missing)

    lines = [f'{sha(ROOT / rel)}  {rel}' for rel in paths]
    out.write_text('\n'.join(lines) + '\n')
    print(f'{out.relative_to(ROOT)}: {len(lines)} files (added: {missing or "none"})')
    changed = [rel for rel in paths if sha(ROOT / rel) != _prev_digest(prev, rel)]
    print(f'changed vs previous: {changed}')


def _prev_digest(prev, rel):
    for raw in prev.read_text().splitlines():
        digest, _, name = raw.strip().partition('  ')
        if name == rel:
            return digest
    return None


if __name__ == '__main__':
    main()
