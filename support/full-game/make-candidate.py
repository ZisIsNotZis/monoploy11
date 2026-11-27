#!/usr/bin/env python3
"""#3278: build a real, checkable commit object out of the delivery set.

Why this exists
---------------
"Replayable" kept meaning "replayable from this worktree". The honest question the user
asked is whether someone who only got the delivered files can play the game. A commit id
answers that in a way prose cannot: `git archive <id> | tar -x` either yields the set or
it does not.

What it does NOT do
-------------------
By DEFAULT it does not move a branch, does not push, and does not touch `master`. The
object goes into the repository's own object database (so `git archive` can read it), and
the index used to build the tree is a TEMP file, never `.git/index`. The working tree is
never part of the decision.

`--branch NAME` is the deliberate exception, and the only way a ref moves: it points NAME
at the commit this run just built. That is what makes the delivery fetchable (`git
checkout NAME`, `git clone -b NAME`) instead of an id someone has to be told. It still
does not push, and it does not touch `master` or any other branch -- a name that already
exists and points somewhere else is refused rather than force-moved, so re-running this
script can never quietly rewrite a branch you already handed out.

Two shapes, and they answer different questions
--------------------------------------------------
* ROOT (default) -- the commit has no parent, so checking the branch out yields exactly
the manifest. This is the honest answer to "is the file set self-contained?", and it is
what `clean-checkout.py` is shaped like. But it cannot be published: a branch with no
history shared with `master` cannot fast-forward into `master`, and a user who already
has the repo sees their history replaced rather than extended.

* `--onto BASE` -- the commit's parent is BASE (normally `origin/master`) and its tree is
BASE's tree with the manifest laid over it. That is a **fast-forward** from BASE: nothing
anyone already has is deleted or rewritten, the slice arrives as one normal commit, and
`git diff BASE` names exactly what the slice changed. This is the publishable shape.

`--onto` therefore REFUSES to drop a file. If BASE has a file the delivery does not, the
result keeps it -- and because that can make a clean checkout differ from the root
candidate, the script prints both the fast-forward check and the list of files that exist
only because BASE had them, so nobody has to discover that difference later.

The self-reference problem, said out loud
----------------------------------------
The commit contains `docs/evidence/RESULT-3278.md`, so editing that doc changes the id.
That is why RESULT-3278.md must not claim a frozen id as "the delivery": it quotes the id
of the run it verified and tells you to re-run THIS script for the current one. A frozen
id is only meaningful if nobody may touch the prose again, which is not how a receipt
works. So: id = provenance, file set = the claim, and the file set is what this prints.
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LIST = HERE / 'DELIVERY.txt'
IDENT = {'GIT_AUTHOR_NAME': 'slice-bench', 'GIT_AUTHOR_EMAIL': 'slice-bench@localhost',
         'GIT_COMMITTER_NAME': 'slice-bench', 'GIT_COMMITTER_EMAIL': 'slice-bench@localhost'}


def delivery_files():
    """Every path the manifest names, globs expanded. A missing name is a hard stop."""
    files, missing = [], []
    for raw in LIST.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        _kind, _, target = line.partition(' ')
        target = target.strip()
        if '*' in target:
            hits = sorted(p for p in ROOT.glob(target) if p.is_file())
            if not hits:
                missing.append(target)
            files += [str(p.relative_to(ROOT)) for p in hits]
        elif (ROOT / target).is_file():
            files.append(target)
        else:
            missing.append(target)
    if missing:
        raise SystemExit(f'manifest names files that do not exist: {missing}')
    return sorted(set(files))


def build(files, parent=None, branch=None, onto=None):
    # The temp dir is entered as a context manager: an earlier version leaked one index
    # directory per run into /tmp, which is the same class of litter this repo already
    # spent two rounds cleaning out of `.scratch`.
    with tempfile.TemporaryDirectory(prefix='cand-3278-') as tmp:
        return _build(files, parent, Path(tmp) / 'index', branch, onto)


def _build(files, parent, idx, branch=None, onto=None):
    env = dict(os.environ, GIT_INDEX_FILE=str(idx), **IDENT)

    def git(*a, **kw):
        r = subprocess.run(['git', *a], cwd=str(ROOT), env=env, capture_output=True, text=True, **kw)
        if r.returncode != 0:
            raise SystemExit(f'git {a[0]} failed: {r.stderr.strip()}')
        return r

    # The INDEX starts either empty (root commit: the tree IS the manifest) or as BASE's
    # tree (`--onto`: the tree is BASE plus the manifest). Seeding from BASE rather than
    # building an empty tree is what makes the result a fast-forward instead of a
    # rewrite: every path BASE already had stays, unless the manifest replaces it.
    git('read-tree', '--empty' if not onto else onto)
    rows = []
    for rel in files:
        # Hash from worktree bytes: the tree is built from what would be shipped, not from
        # whatever an index happens to hold.
        h = git('hash-object', '-w', '--', rel).stdout.strip()
        rows.append(f'100644 {h}\t{rel}')
    # `update-index --index-info` reads the rows on stdin and rejects a trailing `--`
    # (exit 129), so the rows go through the same wrapper as everything else.
    git('update-index', '--index-info', input='\n'.join(rows) + '\n')
    tree = git('write-tree').stdout.strip()
    moved = f'branch {branch} points here' if branch else 'no branch moved'
    base_line = f'Fast-forward on top of {onto}; ' if onto else ''
    msg = (f'#3278 slice: narrow-screen full game, replayable delivery ({len(files)} files)\n\n'
           'Tree built from names in support/full-game/DELIVERY.txt, hashed from\n'
           f'worktree bytes. {base_line}{moved}; not pushed.\n')
    args = ['commit-tree', tree, '-F', '-'] + (['-p', parent] if parent else [])
    commit = git(*args, input=msg).stdout.strip()
    if branch:
        point_ref(branch, commit)
    return tree, commit


def point_ref(branch, commit):
    """Point BRANCH at COMMIT -- but never move a ref that already says something else.

    Force-moving is how a branch someone already cloned silently changes meaning. An
    existing ref that already IS this commit is a re-run (fine); anything else stops and
    tells you to delete it yourself.
    """
    ref = f'refs/heads/{branch}'
    have = subprocess.run(['git', 'rev-parse', '--verify', '--quiet', ref], cwd=str(ROOT),
                          capture_output=True, text=True)
    current = have.stdout.strip() if have.returncode == 0 else None
    if current == commit:
        print(f'REF     {ref} already at {commit[:12]} (unchanged)')
        return
    if current:
        raise SystemExit(f'REFUSED: {ref} already exists at {current[:12]}; not moving it.\n'
                         f'  delete it yourself first: git branch -D {branch}')
    r = subprocess.run(['git', 'update-ref', '-m', f'make-candidate: delivery {commit[:12]}',
                        ref, commit, '0' * 40], cwd=str(ROOT), capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'git update-ref failed: {r.stderr.strip()}')
    print(f'REF     {ref} -> {commit[:12]} (new)')


def resolve_rev(rev):
    r = subprocess.run(['git', 'rev-parse', '--verify', '--quiet', rev + '^{commit}'],
                       cwd=str(ROOT), capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'cannot resolve revision {rev!r} (is the remote fetched?)')
    return r.stdout.strip()


def tree_of(rev):
    r = subprocess.run(['git', 'ls-tree', '-r', '--name-only', rev], cwd=str(ROOT),
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'cannot list {rev}: {r.stderr.strip()}')
    return set(r.stdout.split())


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    branch, parent, onto_rev = None, None, None
    while argv:
        arg = argv.pop(0)
        if arg == '--branch':
            if not argv:
                raise SystemExit('--branch needs a name')
            branch = argv.pop(0)
            # 名字空间（candidate/...）是正常用法，所以斜杠允许；但 master 与 HEAD 是
            # 「会改变别人已有含义」的名字，且 git 自己拒绝的形态（前导 -、..、尾 /）提前挡掉。
            bad = (not branch or branch in ('master', 'main', 'HEAD')
                   or branch.startswith('-') or '..' in branch
                   or branch.endswith('/') or branch.endswith('.lock'))
            if bad:
                raise SystemExit(f'refusing branch name {branch!r}')
        elif arg == '--parent':
            parent = argv.pop(0)
        elif arg == '--onto':
            if not argv:
                raise SystemExit('--onto needs a revision (e.g. origin/master)')
            onto_rev = argv.pop(0)
        elif arg.startswith('-'):
            raise SystemExit(f'unknown option {arg}\n'
                             'usage: make-candidate.py [--branch NAME] [--onto REV | --parent REV]')
        elif parent is None and not argv:
            # 旧用法 `make-candidate.py <parent>` 只有一个位置参数：保留它，免得文档里的
            # 旧命令在读者手里变成「未知参数」。
            parent = arg
        else:
            raise SystemExit(f'unexpected argument {arg!r}')
    if onto_rev and parent:
        raise SystemExit('--onto and --parent are two different shapes; pick one')
    onto = resolve_rev(onto_rev) if onto_rev else None
    if onto:
        parent = onto
    files = delivery_files()
    base_files = tree_of(onto) if onto else set()
    tree, commit = build(files, parent=parent, branch=branch, onto=onto)
    print(f'FILES   {len(files)}')
    print(f'TREE    {tree}')
    print(f'COMMIT  {commit}')
    if onto:
        # Say out loud what a fast-forward commit does NOT contain, instead of leaving the
        # reader to diff two deliverables and wonder which one they got.
        kept = sorted(base_files - set(files))
        added = sorted(set(files) - base_files)
        print(f'ONTO    {onto_rev} = {onto}')
        print(f'        fast-forward from {onto_rev}: '
              f'{"yes" if onto == parent else "NO"}  (parent of the commit)')
        print(f'CHANGES {len(added)} added, {len(kept)} kept from base and NOT in the manifest')
        for rel in added:
            print(f'  + {rel}')
        for rel in kept:
            print(f'  = {rel}   (base only; the delivery does not name it)')
        print('        the root candidate (no --onto) has NONE of the `=` files; that shape is'
              ' for the file-set question, this one is for publishing.')
    # Printing only the archive line was a trap: the extracted tree plays fine but the
    # compare suite asserts LITERAL `.scratch/...` paths, so a bare extract shows red
    # tests that are missing fixtures, not product regressions.
    print('next    replay from THIS commit, in an empty dir outside the worktree:')
    print(f'          git archive {commit} | tar -x -C /tmp/try')
    print('          mkdir -p /tmp/try/.scratch && cp /tmp/try/support/compare/* /tmp/try/.scratch/')
    print('          (cd /tmp/try && node --test test/*.test.js)')
    print('          (cd /tmp/try && OUT_NAME=OUT-a python3 support/full-game/run-full.py)')
    if branch:
        print(f'byref   the same check out of the branch this run just pointed:')
        print(f'          git worktree add --detach /tmp/try {branch}   # or: git clone -b {branch} <repo> /tmp/try')
        print('          then the two checks above, from the checkout root')
    return 0


if __name__ == '__main__':
    sys.exit(main())
