#!/usr/bin/env python3
"""#3317: cut one run's raw records down to a receipt a reviewer can actually read.

Why this exists
---------------
`report-full.py` judges a finished run, but the files it reads are the run's raw frames:
`record-8-summary.json` is ~256 KB for a 44-press game, most of it `firstFrames` (92 KB)
and `hintInserts` (6 KB) that no check reads. Committing that into the delivery makes the
public receipt 11 000+ lines of JSON, which is not a receipt -- a reader cannot tell
whether it says PASS without running the judge, and a diff of it is unreviewable.

So: the raw run stays in `OUT-*/` (gitignored, kept for re-verification), and the delivery
carries a SLIM copy that contains **exactly the fields the judge reads**. The slim copy is
still a directory `report-full.py` runs on, so "read the receipt" and "re-judge the
receipt" are the same command. That is the property worth having: a receipt you cannot
re-judge is a claim.

What "exactly the fields" means, and why it is checked rather than asserted
--------------------------------------------------------------------------
The risk of trimming a record is silent: drop a field the judge reads and the judge turns
that check into SKIP (or crashes), so the receipt quietly weakens while still saying PASS.
This tool therefore does not trust its own field list. It runs `report-full.py` on the
raw dir and on the slim dir and refuses to write anything unless the two verdicts are
byte-identical. A missing field shows up as a different verdict, not as a smaller file.

Three states, same rule as `report-full.py`
-------------------------------------------
Dropping an unread field is safe; dropping a read-but-null field is not the same thing.
The comparison covers the printed verdict, the checks, and the NOT JUDGED list, so a slim
record that turns a PASS into a SKIP fails here instead of shipping.

Provenance
----------
The receipt names the run it came from, the byte size and sha256 of every raw file it was
cut from, and the fields it dropped. Someone holding only the receipt can still say which
run it describes and go back to the raw frames to disagree with the cut.
"""
import gzip
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
REPORT = HERE / 'report-full.py'

# Top-level keys `report-full.py` reads. Two rules, and confusing them was a real bug:
#   REQUIRED -- the judge indexes it (`summary['kinds']`, `judge['checks']`). Without it the
#               judge crashes or silently SKIPs, so a raw record lacking it is refused.
#   OPTIONAL -- read with `[]` on a sub-object that a run may legitimately not have produced
#               (an older driver never wrote `at`/`scroll`). Kept WHEN PRESENT, never invented.
# `hintTrace` and `pressLog` are kept whole: they are the evidence behind F3/F6, and
# trimming the rows inside them would be trimming the evidence, not the boilerplate.
REQUIRED_SUMMARY = [
    'label', 'human', 'entry', 'frames', 'ms', 'kinds', 'presses', 'pressLog',
    'stuck', 'runtimeErrors', 'runtimeErrorCount', 'png', 'judge', 'buys',
    'buyFirstUnusable', 'mismatchCount', 'mismatches', 'hintTrace',
]
# `observed` is written by the driver for a human; nothing indexes it. Kept when present.
# `replay` is NOT kept: it is the driver's copy of record-10-replay.json, which the receipt
# carries as its own file. Two copies of one record is how they drift.
OPTIONAL_SUMMARY = ['observed']
REQUIRED_REPLAY = ['checks']
OPTIONAL_REPLAY = ['observed', 'landed', 'at', 'scroll', 'ctaUsable']
# Only what the judge reads: whether THIS run's chrome survived and the ports came back.
# `host_chrome_total` is a courtesy count for a human, not a judged field.
REQUIRED_AFTER = ['own_chrome', 'ports_free']
OPTIONAL_AFTER = []

# Files the judge loads by name. A run that did not produce one is a run the judge cannot
# read; copying the others anyway would hand out a receipt nobody can re-judge.
RAW_FILES = {
    'record-8-summary.json': (REQUIRED_SUMMARY, OPTIONAL_SUMMARY),
    'record-10-replay.json': (REQUIRED_REPLAY, OPTIONAL_REPLAY),
    'after.json': (REQUIRED_AFTER, OPTIONAL_AFTER),
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def judge(dirpath):
    """Run the REAL judge and return its stdout. Not a copy of its logic."""
    r = subprocess.run([sys.executable, '-B', str(REPORT), str(dirpath)],
                       capture_output=True, text=True)
    out = (r.stdout or '') + (r.stderr or '')
    if r.returncode not in (0, 1):
        raise SystemExit(f'report-full.py did not answer on {dirpath}:\n{out}')
    return out, r.returncode


def slim(src):
    raw = json.loads(Path(src).read_text())
    required, optional = RAW_FILES[Path(src).name]
    missing = [k for k in required if k not in raw]
    if missing:
        # A key the judge INDEXES is absent from the RAW record. That is not this tool's
        # business to invent, and silently omitting it would ship a receipt whose SKIP
        # looks like a property of the game rather than of the record.
        raise SystemExit(f'{src}: raw record lacks judged field(s) {missing}; '
                         'refusing to cut a record that is already incomplete')
    # Optional keys are copied only if the run actually produced them: inventing an `at`
    # would fabricate evidence, and `report-full.py` treats an absent one as "not measured".
    keep = required + [k for k in optional if k in raw]
    dropped = [k for k in raw if k not in keep]
    return {k: raw[k] for k in keep}, dropped


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        raise SystemExit('usage: make-receipt.py <raw OUT dir> [--dest DIR]')
    src = Path(argv.pop(0)).resolve()
    dest = None
    while argv:
        a = argv.pop(0)
        if a == '--dest':
            if not argv:
                raise SystemExit('--dest needs a directory')
            dest = Path(argv.pop(0)).resolve()
        else:
            raise SystemExit(f'unexpected argument {a!r}')
    if not src.is_dir():
        raise SystemExit(f'not a run directory: {src}')
    if dest is None:
        dest = HERE / ('receipt-' + src.name.lower().replace('out-', ''))
    if dest.exists():
        raise SystemExit(f'REFUSED: {dest} already exists (single use; delete it yourself)')

    want, code = judge(src)
    trimmed, dropped = {}, {}
    with tempfile.TemporaryDirectory(prefix='receipt-3317-') as tmp:
        tmp = Path(tmp)
        for name in RAW_FILES:
            p = src / name
            if not p.is_file():
                raise SystemExit(f'MISSING {p} -- this run did not get that far')
            data, gone = slim(p)
            trimmed[name] = data
            dropped[name] = gone
            (tmp / name).write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n')
        got, got_code = judge(tmp)
        if got != want or got_code != code:
            # Not a warning: a different verdict means the cut changed what is claimed.
            print('--- raw ---\n' + want)
            print('--- slim ---\n' + got)
            raise SystemExit('REFUSED: the slim record judges differently from the raw one; '
                             'a judged field was dropped. Fix KEEP_* in this script.')
        dest.mkdir(parents=True)
        for name, data in trimmed.items():
            (dest / name).write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n')

    # #3320: ship the RAW bytes too, compressed, inside the receipt.
    #
    # What went wrong without this: `provenance.json` said `source_run: OUT-3319-final` and
    # gave three raw sha256s -- and that directory did not exist anywhere. `OUT-*/` is
    # gitignored, so the raw frames live only on the machine that ran them, and the next
    # cleanup deletes them. The receipt stayed re-judgeable (the slim copy is complete for
    # the judge) but its provenance became unfalsifiable: nobody could locate the run it
    # named, let alone check that the cut was faithful. That is exactly the complaint.
    #
    # A pointer to a volatile path is not provenance. So the source travels with the receipt:
    # `raw/<name>.gz` is the byte-for-byte raw record, and `provenance.json` carries both the
    # gzip sha256 and the sha256 of the DECOMPRESSED bytes (which is the number the old file
    # claimed and nobody could check). ~317 KB of frames is ~16 KB gzipped, so this costs
    # about one screen of diff and turns three unfalsifiable hashes into three checkable ones.
    rawdir = dest / 'raw'
    rawdir.mkdir(exist_ok=True)
    for name in RAW_FILES:
        with open(src / name, 'rb') as f, gzip.open(rawdir / (name + '.gz'), 'wb', compresslevel=9) as g:
            shutil.copyfileobj(f, g)

    # Provenance lives beside the receipt so "which run is this?" is answerable without
    # the OUT dir, and so the cut can be re-derived and disagreed with.
    # #3331: the run recorded which product lock it built from; carry it verbatim. Copied,
    # never re-derived -- a cutter that recomputes the binding cannot tell you the run's
    # own record changed. A run that predates product.json simply has none, and
    # verify-receipt.py says so out loud instead of passing quietly.
    product = None
    if (src / 'product.json').is_file():
        product = json.loads((src / 'product.json').read_text())
    prov = {
        'source_run': str(src.name),
        'product': product,
        # #3336: the per-request seal record. It used to live only in OUT-*/verify-http.txt,
        # which is gitignored and truncated to 12 hex chars -- so the most-repeated claim
        # about this product ("the browser got the lock's bytes") could not be rechecked
        # by a reader holding the receipt. Carried verbatim (not recomputed: recomputing
        # would hide a tampered record) when the run produced one.
        'seal': (json.loads((src / 'served-seal.json').read_text())
                 if (src / 'served-seal.json').is_file() else None),
        'cut_by': 'support/full-game/make-receipt.py',
        'judged_same_as_raw': True,
        'raw': {name: {'bytes': (src / name).stat().st_size, 'sha256': sha(src / name),
                       'gz': 'raw/' + name + '.gz',
                       'gz_bytes': (rawdir / (name + '.gz')).stat().st_size,
                       'gz_sha256': sha(rawdir / (name + '.gz'))}
                for name in RAW_FILES},
        'slim': {name: {'bytes': (dest / name).stat().st_size, 'sha256': sha(dest / name)}
                 for name in RAW_FILES},
        'dropped_fields': dropped,
    }
    (dest / 'provenance.json').write_text(json.dumps(prov, ensure_ascii=False, indent=1) + '\n')
    total = sum(v['bytes'] for v in prov['slim'].values())
    raw_total = sum(v['bytes'] for v in prov['raw'].values())
    print(f'RECEIPT {dest}')
    print(f'        {raw_total} raw bytes -> {total} receipt bytes '
          f'({100 * total // max(raw_total, 1)}%)')
    print('        judged identically to the raw run (report-full.py, both dirs)')
    # dest may be outside the repo (a scratch probe); relative_to() would raise there.
    shown = dest.relative_to(ROOT) if dest.is_relative_to(ROOT) else dest
    print('next    python3 support/full-game/report-full.py ' + str(shown))
    return 0


if __name__ == '__main__':
    sys.exit(main())
