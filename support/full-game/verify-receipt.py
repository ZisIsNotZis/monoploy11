#!/usr/bin/env python3
"""#3320: check a receipt against itself, and re-judge it, without the machine that ran it.

Why this exists
---------------
The #3319 receipt named `source_run: OUT-3319-final` and three raw sha256s. That directory
did not exist anywhere on disk, and no file on disk hashed to those values -- so the receipt
was re-judgeable (its slim copy is complete for the judge) but its PROVENANCE was
unfalsifiable. You could not confirm the cut was faithful, or even locate what it was cut
from. `OUT-*/` is gitignored, so the raw frames only ever lived on one machine and were
deleted by the next cleanup.

The fix has two halves, and this script is the second one:
  1. `make-receipt.py` now ships the raw bytes inside the receipt (`raw/<name>.gz`), with
     the gzip sha256 AND the sha256 of the decompressed bytes recorded in `provenance.json`.
  2. This script lets a reader holding ONLY the receipt check every one of those claims.

What it checks, in order
------------------------
  A. every file `provenance.json` names exists, at the size and sha256 it claims
     (slim files as-is; raw files gzipped, re-decompressed before hashing);
  B. the decompressed raw bytes hash to the `sha256` the receipt claims for the raw run;
  C. the slim files are a faithful cut of those raw bytes -- i.e. dropping exactly the
     listed `dropped_fields` from the raw record reproduces the slim record byte-for-byte;
  D. `report-full.py` on the receipt prints the same verdict the raw record produces when
     re-cut and re-judged (so the receipt still describes a passing run, not just a cut one).

C is the one that catches a dishonest cut: B alone would pass even if the slim copy were
trimmed until a check turned into a SKIP. It re-derives the slim file from the shipped raw
bytes using the same field rules, and refuses if the bytes differ.

Exit codes: 0 all checks passed, 1 a check failed, 2 the receipt is malformed/incomplete.
"""
import gzip
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPORT = HERE / 'report-full.py'


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def fail(msg):
    print('FAIL  ' + msg)
    return 1


def tree_digest(pairs):
    """Canonical digest of (path, sha256) pairs: independent of how the lock file is laid out.

    Why a prefix and length-prefixed fields: the naive ''.join(f'{d}  {p}\n' for ...) over a
    byte-sorted lock file reproduces that file's OWN sha256, which made the check compare a
    number to itself (#3331 caught this by running it, not by reading it).
    """
    import hashlib
    h = hashlib.sha256(b'monoploy11/tree-v1\0')
    for rel, digest in sorted(pairs):
        row = f'{rel}\0{digest}\n'.encode()
        h.update(len(row).to_bytes(8, 'big'))
        h.update(row)
    return h.hexdigest()


def judge(dirpath):
    """The last VERDICT line report-full.py prints for this directory, or None."""
    r = subprocess.run([sys.executable, '-B', str(REPORT), str(dirpath)],
                       capture_output=True, text=True)
    out = (r.stdout or '') + (r.stderr or '')
    lines = [ln.strip() for ln in out.splitlines() if ln.startswith('VERDICT:')]
    return lines[-1] if lines else None


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        raise SystemExit('usage: verify-receipt.py <receipt dir>')
    dest = Path(argv[0]).resolve()
    if not (dest / 'provenance.json').is_file():
        raise SystemExit(f'not a receipt directory (no provenance.json): {dest}')
    prov = json.loads((dest / 'provenance.json').read_text())

    # Import the cutting rules instead of copying them: a verifier that re-implements the
    # cutter cannot tell you the cutter changed. Same lesson as the picker probe in #3319.
    sys.path.insert(0, str(HERE))
    import importlib.util
    spec = importlib.util.spec_from_file_location('mk', HERE / 'make-receipt.py')
    mk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mk)

    print(f'receipt  {dest}')
    print(f'source   {prov.get("source_run")}')

    # A receipt that does not carry its own raw bytes cannot locate its source, which is
    # the whole point of this script. Say that plainly instead of crashing on a KeyError.
    # (#3319's receipt is exactly this case: it names OUT-3319-final and no such run exists.)
    if not prov.get('raw'):
        return fail('provenance.json names no raw files at all; nothing to check')
    missing_gz = [name for name, meta in prov['raw'].items() if not meta.get('gz')]
    if missing_gz:
        return fail('this receipt predates "raw/" shipping: it records raw sha256 for '
                    + ', '.join(missing_gz)
                    + ' but does not carry those bytes, so the source cannot be located '
                    'or checked. Re-cut it with make-receipt.py from a surviving run.')

    # ---- A. every named file exists at the claimed size and hash -------------------
    problems = 0
    for group in ('slim', 'raw'):
        for name, meta in prov.get(group, {}).items():
            path = (dest / name) if group == 'slim' else (dest / meta['gz'])
            if not path.is_file():
                problems += fail(f'{group}/{name}: missing at {path.relative_to(dest)}')
                continue
            if path.stat().st_size != meta.get('bytes' if group == 'slim' else 'gz_bytes'):
                problems += fail(f'{group}/{name}: size {path.stat().st_size} != claimed')
            want = meta.get('sha256' if group == 'slim' else 'gz_sha256')
            if sha256_bytes(path.read_bytes()) != want:
                problems += fail(f'{group}/{name}: hash differs from provenance')
    if problems:
        return 1
    print(f'A  files    {len(prov["slim"])} slim + {len(prov["raw"])} raw present, sizes and hashes match')

    # ---- B. the decompressed raw bytes are the run the receipt names ---------------
    raw = {}
    for name, meta in prov['raw'].items():
        data = gzip.decompress((dest / meta['gz']).read_bytes())
        if len(data) != meta['bytes']:
            return fail(f'raw/{name}: decompressed size {len(data)} != claimed {meta["bytes"]}')
        if sha256_bytes(data) != meta['sha256']:
            return fail(f'raw/{name}: decompressed sha256 != the raw sha256 in provenance')
        raw[name] = data
    print('B  raw      decompressed bytes hash to the sha256 provenance claims for the raw run')

    # ---- C. the slim copy really is these raw bytes minus the listed fields -------
    with tempfile.TemporaryDirectory(prefix='verify-receipt-') as tmp:
        tmp = Path(tmp)
        for name in mk.RAW_FILES:
            record = json.loads(raw[name].decode('utf-8'))
            keep = [k for k in record if k not in prov['dropped_fields'].get(name, [])]
            # Rebuild through the cutter's own rules: required always, optional only if present.
            required, optional = mk.RAW_FILES[name]
            missing = [k for k in required if k not in record]
            if missing:
                return fail(f'raw/{name}: lacks judged field(s) {missing} -- cut is not valid')
            expected = {k: record[k] for k in required + [k for k in optional if k in record]}
            got = json.loads((dest / name).read_text())
            if expected != got:
                diff = [k for k in set(expected) | set(got)
                        if expected.get(k) != got.get(k)]
                return fail(f'{name}: slim copy is NOT the raw record minus dropped fields '
                            f'(differs in {sorted(diff)})')
            lost = [k for k in record if k not in expected and k not in prov['dropped_fields'].get(name, [])]
            if lost:
                return fail(f'{name}: field(s) {lost} vanished but were not declared dropped')
    print('C  cut      slim files are exactly the raw record minus the declared dropped fields')

    # ---- D. the cut did not change the verdict ------------------------------------
    #
    # NOT "the verdict is PASS". A receipt of a FAILING run is legitimate provenance: it
    # says "this run failed, and here are the bytes that say so". #3317 is exactly that --
    # it is the run #3319 deliberately turned red when F6 widened to all screens.
    # Demanding PASS here would have declared an honest failing receipt "unverifiable",
    # which is the opposite of the point. (It did catch me: the first version of this
    # script refused receipt-3317-390 for being FAIL.)
    #
    # The property worth checking is the one provenance.json claims: `judged_same_as_raw`.
    # So judge the slim copy, re-judge a directory rebuilt from the SHIPPED RAW bytes, and
    # require the two printed verdicts to match. That holds for PASS and for FAIL.
    with tempfile.TemporaryDirectory(prefix='verify-receipt-raw-') as tmp:
        rawdir = Path(tmp)
        for name, data in raw.items():
            (rawdir / name).write_bytes(data)
        got_raw = judge(rawdir)
    got_slim = judge(dest)
    if not got_slim:
        return fail('report-full.py printed no VERDICT on the receipt')
    if got_slim != got_raw:
        return fail(f'the cut changed the verdict\n  receipt: {got_slim}\n  raw:     {got_raw}')
    print(f'D  judge    {got_slim} -- same verdict from the receipt and from its shipped raw bytes')

    # ---- E. which product bytes did it run? --------------------------------------
    #
    # A/B/C/D prove the record is intact and internally consistent. None of them says which
    # VERSION of the game produced it, so a PASS from before a product change reads exactly
    # like a PASS for the current bytes. This check closes that: the receipt names a lock,
    # the lock is in the repo, its sha256 is unchanged, and the tree digest the run recorded
    # equals the one recomputed from the lock file on disk.
    #
    # Absent `product` is NOT a pass. A receipt that cannot name its product is a weaker
    # claim, and the honest report is to say which claim you got.
    prod = prov.get('product')
    if not prod:
        print('E  product  NOT BOUND -- this receipt does not record which product bytes it ran '
              '(cut before product.json existed). A/B/C/D still hold; the version does not.')
    else:
        lock_rel = prod.get('lock')
        lock_path = (HERE.parent.parent / lock_rel) if lock_rel else None
        if not lock_path or not lock_path.is_file():
            return fail(f'E  product  names a lock that is not in the repo: {lock_rel!r}')
        if sha256_bytes(lock_path.read_bytes()) != prod.get('lock_sha256'):
            return fail(f'E  product  {lock_rel} has changed since this receipt ran '
                        f'(lock sha256 on disk != recorded)')
        pairs = []
        for line in lock_path.read_text().splitlines():
            if not line.strip():
                continue
            digest, rel = line.split('  ', 1)
            pairs.append((rel, digest))
        want = tree_digest(pairs)
        if want != prod.get('tree_sha256'):
            return fail('E  product  the tree digest recorded by the run does not match the '
                        'lock on disk; this receipt describes different bytes than the lock names')
        print(f'E  product  ran exactly {lock_rel} ({prod.get("files")} files, '
              f'tree {prod["tree_sha256"][:16]}), and that lock is unchanged on disk')

    # ---- F. what the browser actually received -----------------------------------
    #
    # E says which lock the run was BUILT from. It cannot say what crossed the wire,
    # because the digest is computed over the tree on disk, not over responses. The run's
    # `verify-http.txt` used to be the only evidence for that step, and it was wrong on
    # #3335 in two ways: the script's lock name still said 3334, and its five-file sample
    # omitted src/ui/slice.js, the one file that version changed. Both are fixed
    # (support/full-game/verify-http.py reads current-lock.txt and seals all 35 files);
    # this item makes the result re-checkable from the receipt alone.
    #
    # Older receipts have no `seal` field. Like E, that is NOT a pass token: say what was
    # checked. It is also not a failure -- A-E remain true for them.
    seal = prov.get('seal')
    if not seal:
        print('F  seal     NOT RECORDED -- this receipt predates the per-request seal record, '
              'so nothing here shows what bytes the browser received.')
    else:
        claimed = (prod or {}).get('lock')
        if claimed and seal.get('lock') != claimed:
            return fail(f'F  seal     the seal covers {seal.get("lock")!r} but the run claims '
                        f'{claimed!r} -- two different products in one receipt')
        lock_path = HERE.parent.parent / seal['lock']
        if not lock_path.is_file():
            return fail(f'F  seal     names a lock not in the repo: {seal["lock"]}')
        if sha256_bytes(lock_path.read_bytes()) != seal.get('lock_sha256'):
            return fail('F  seal     the lock file changed since the seal ran')
        # 锁文件的行是 "<sha256>  <path>"（不是反过来）—— 第一版写反了，
        # 于是 F 说「服务过的集合与锁不一致」，错的其实是解析器。#3336 自查到的。
        want = {rel: digest for digest, rel in
                (ln.split('  ', 1) for ln in lock_path.read_text().splitlines() if ln.strip())}
        served = seal.get('served') or {}
        if not seal.get('sealed'):
            return fail('F  seal     the run itself reported NOT-SEALED; see verify-http.txt')
        if sorted(served) != sorted(want):
            missing = sorted(set(want) - set(served))
            extra = sorted(set(served) - set(want))
            return fail(f'F  seal     served set != lock set (missing {missing}, extra {extra}); '
                        'a sample cannot seal a product')
        wrong = [rel for rel, digest in want.items()
                 if (served[rel] or {}).get('sha256') != digest]
        if wrong:
            return fail(f'F  seal     served bytes differ from the lock for {wrong}')
        no_store = [rel for rel in sorted(want) if not served[rel].get('no_store')]
        if no_store:
            return fail(f'F  seal     response for {no_store} did not forbid reuse')
        print(f'F  seal     {len(served)} responses matched the lock byte-for-byte with no-store '
              f'({seal["lock"]}, lock sha {seal["lock_sha256"][:12]})')

    print()
    print('PROVENANCE: PASS -- this receipt locates its own source and can be checked '
          'without the run directory')
    return 0


if __name__ == '__main__':
    sys.exit(main())
