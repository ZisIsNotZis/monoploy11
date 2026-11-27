#!/usr/bin/env python3
"""#3342: mint a new product lock from the files DELIVERY.txt marks `lock`.

Why this exists as a script: the previous locks were produced by hand, so "which files
are in the product" and "what their bytes were" could only be checked after the fact.
Here the list comes from DELIVERY.txt (the one place that already names the delivery set),
so minting and checking cannot disagree about *which* files.

Deliberately does NOT touch docs/evidence/current-lock.txt -- the pointer is moved by a
separate, explicit step, so a half-finished mint can never silently become "current".
"""
import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DELIVERY = HERE / 'DELIVERY.txt'


def locked_paths():
    out = []
    for line in DELIVERY.read_text().splitlines():
        line = line.strip()
        if line.startswith('lock '):
            out.append(line.split(None, 1)[1].strip())
    return out


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else 'slice-entry-3342.sha256'
    target = ROOT / 'docs' / 'evidence' / name
    if target.exists() and '--force' not in sys.argv:
        raise SystemExit(f'{target} already exists; pass --force to overwrite')
    rows, missing = [], []
    for rel in locked_paths():
        path = ROOT / rel
        if not path.is_file():
            missing.append(rel)
            continue
        rows.append(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {rel}')
    if missing:
        raise SystemExit(f'missing from checkout: {missing}')
    target.write_text('\n'.join(rows) + '\n')
    print(f'wrote {target.relative_to(ROOT)} with {len(rows)} files')
    # 立即自检：重读一遍，逐条比对，别让「写成功」冒充「写对了」。
    bad = []
    for line in target.read_text().splitlines():
        digest, rel = line.split('  ', 1)
        actual = hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()
        if actual != digest:
            bad.append(rel)
    print('self-check:', 'OK' if not bad else f'MISMATCH {bad}')


if __name__ == '__main__':
    main()
