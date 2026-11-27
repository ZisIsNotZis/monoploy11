#!/usr/bin/env python3
"""#3278: check that the delivery can be reproduced from what a clean checkout holds.

Two independent questions, both answered here:

  1. DOES THE LIST EXIST?  Every file named by DELIVERY.txt is present, and every `lock`
     line still matches the sha256 written in docs/evidence/slice-entry-3333.sha256.
     This is what stops "replayable" from being a claim about files nobody committed.

  2. DOES THE LIST COVER WHAT IS SHIPPED?  Walk the repo's product dirs and report any
     file the list forgot. A silent extra file is how a pass gets propped up by something
     the delivery does not actually contain.

It does NOT play the game (run-full.py does that, from a tree built out of the lock) and
it does not run the suite. Its one job is the file-set question, kept cheap.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LIST = HERE / 'DELIVERY.txt'
# #3330：起手开工现金改动后重签的那把锁。旧锁 3278 仍在库里，但产品已不是它的字节。
LOCK = ROOT / 'docs/evidence/slice-entry-3333.sha256'

# Product bytes a player loads. Anything here that the list forgets is a real gap.
PRODUCT_DIRS = ['src']
PRODUCT_FILES = ['index.html', 'serve.py', 'styles.css']


def sha(path):
    import hashlib
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_list():
    kinds = []
    for raw in LIST.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        kind, _, target = line.partition(' ')
        kinds.append((kind, target.strip()))
    return kinds


def main():
    lock = {}
    for line in LOCK.read_text().splitlines():
        if line.strip():
            digest, rel = line.split('  ', 1)
            lock[rel] = digest

    kinds = read_list()
    problems = []

    # 1. named files exist; lock lines still match the frozen bytes.
    for kind, target in kinds:
        if '*' in target:
            if not sorted(ROOT.glob(target)):
                problems.append(f'{kind} pattern matches nothing: {target}')
            continue
        path = ROOT / target
        if not path.is_file():
            problems.append(f'{kind} missing: {target}')
            continue
        if kind == 'lock':
            want = lock.get(target)
            if want is None:
                problems.append(f'lock file not named by the sha256 lock: {target}')
            elif sha(path) != want:
                problems.append(f'{target} drifted from the lock: {sha(path)[:12]} != {want[:12]}')

    # 2. nothing shipped is outside the list.
    named = {t for k, t in kinds if k in ('lock', 'doc', 'tool') and '*' not in t}
    shipped = list(PRODUCT_FILES)
    for d in PRODUCT_DIRS:
        shipped += [str(p.relative_to(ROOT)) for p in (ROOT / d).rglob('*')
                    if p.is_file() and '__pycache__' not in p.parts]
    for rel in sorted(shipped):
        if rel not in named:
            problems.append(f'shipped but not in DELIVERY.txt: {rel}')

    lock_named = {t for k, t in kinds if k == 'lock'}
    for rel in sorted(lock):
        if rel not in lock_named:
            problems.append(f'lock names {rel} but DELIVERY.txt forgot it')

    if problems:
        for p in problems:
            print('FAIL  ' + p)
        print(f'\nDELIVERY: FAIL ({len(problems)} problems)')
        return 1
    print(f'PASS  {len(kinds)} entries present, {len(lock)} lock bytes unchanged, '
          f'{len(shipped)} shipped product files all named')
    print('DELIVERY: PASS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
