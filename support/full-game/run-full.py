#!/usr/bin/env python3
"""#3278: play one full game from a CLEAN lock-built tree in a headless Chrome at
390x844 by default (VIEWPORT_W/VIEWPORT_H override it), with real CDP mouse input, all
the way to the results screen.

Why the tree is built from the lock instead of the worktree
-----------------------------------------------------------
The ask is "from a clean checkout, independently play a whole game and know the result".
docs/evidence/current-lock.txt names the current product lock (35 files); this script
copies ONLY those,
refuses if any is missing or drifted, then serves the tree on a second port and compares
the RESPONSE BYTES a browser receives with the lock. The repo's test/, tools/, docs/ and
support/ never enter the tree, so a pass here cannot be propped up by anything the lock
does not ship.

Self-contained on purpose
-------------------------
This file carries its own one_run/port/font helpers. It used to import them from a
`.scratch` scratchpad, which meant "replayable from a clean checkout" was false: the
replay instructions named files that were never committed. Everything here now lives
under support/full-game/ and is named by the lock's companion doc (RESULT-3278.md).

Single use: a fresh OUT dir and profile per run, ports checked free, everything released
afterwards, and this run's own Chrome verified gone. No network beyond 127.0.0.1.
"""
import glob
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import lockfile  # noqa: E402  (path set above)
# #3336：锁名不再写在这里。三份手写的「当前锁」副本已经漂过一次
# （verify-http.py 停在 3334，于是 receipt-3335-final 里那句 SEALED 比的是旧字节）。
# 现在唯一的指针是 docs/evidence/current-lock.txt，解析在 lockfile.py。
LOCK = lockfile.current_lock(ROOT)
# OUT_NAME comes from the environment so one attempt never overwrites the last:
# single-use means a name that already exists is refused, not reused.
OUT = HERE / (os.environ.get('OUT_NAME') or 'OUT-clean-full')
PROFILE = HERE / ('chrome-profile-' + OUT.name.lower())
TREES = HERE / 'trees'
# 端口不是接口的一部分：它们是「这台机器的这一次运行」的私有资源。写死三个号会让
# 两个检出（或一次验收撞上别人正在跑的整局）互相抢，而抢输的那一方看到的是
# 「http port 8041 not bindable after 90s」——一句把「有人在用」说成「量具坏了」的话。
# 所以：默认值仅作为**偏好**，被占用时向系统要一个新的空闲端口运行，并把实际用的号
# 写进 OUT/ports.json。 RUN_PORTS=1 可以一次给你三个具体的号（排查时用）。
def _ports_from_env():
    raw = os.environ.get('RUN_PORTS', '').strip()
    if not raw:
        return None
    parts = [p.strip() for p in raw.split(',') if p.strip()]
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        raise SystemExit('RUN_PORTS must be three comma-separated ports: http,cdp,verify')
    return tuple(int(p) for p in parts)


def _ephemeral(avoid=()):
    """Three distinct, currently-bindable ports, asked from the OS.

    Asking the kernel three times in a row can hand back the SAME number twice (each probe
    socket is closed before the next ask; there is no reservation). A duplicate here would
    surface much later as 'port already in use' inside our own run. So the probes are held
    open until all three are collected, which makes them distinct by construction, and the
    returned numbers are also checked against `avoid`.
    """
    import socket as _s
    held, got = [], []
    try:
        while len(got) < 3:
            s = _s.socket()
            s.bind(('127.0.0.1', 0))
            port = s.getsockname()[1]
            if port in got or port in avoid:
                s.close()
                continue
            held.append(s)
            got.append(port)
    finally:
        for s in held:
            s.close()
    return tuple(got)


HTTP_PORT, CDP_PORT, VERIFY_PORT = (_ports_from_env()
                                    or (8431, 19549, 19649))
DRIVER = HERE / 'drive-full.mjs'
# The viewport is a parameter with the receipts' size as its default. A narrower screen is
# the claim most likely to break, so it has to be runnable by command, not by editing code.
VW = int(os.environ.get('VIEWPORT_W') or 390)
VH = int(os.environ.get('VIEWPORT_H') or 844)
if not (VW > 200 and VH > 300):
    raise SystemExit(f'VIEWPORT-INSANE {VW}x{VH}')
VERIFY = HERE / 'verify-http.py'
# Chrome is a host dependency, not a repo file: find it instead of pinning one user's
# home directory. CHROME_BIN wins, then puppeteer's cache, then PATH.
def find_chrome():
    explicit = os.environ.get('CHROME_BIN')
    if explicit:
        return Path(explicit)
    hits = sorted(glob.glob(str(Path.home() / '.cache/puppeteer/chrome*/*/chrome-linux64/chrome')))
    for name, cand in (('chrome', Path(shutil.which('chrome') or '')),):
        if cand.is_file():
            hits.append(str(cand))
    return Path(hits[-1]) if hits else Path('/nonexistent')


CHROME = find_chrome()
FONTCONF = os.environ.get('FONTCONFIG_FILE')   # optional: only used when a caller sets one


def need(ok, why):
    if not ok:
        raise RuntimeError(why)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def port_listening(port):
    """有没有人在听：这是扫尾要问的问题（'端口放了' = 没有服务还在应答）。"""
    import errno
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(('127.0.0.1', port)) != errno.ECONNREFUSED


def port_bindable(port):
    """能不能真的绑上：这是启动前要问的问题。

    两者不是同一件事。serve.py 显式关掉 allow_reuse_address（#1807 的 Windows 抢占问题），
    所以一次健康的整局跑完，监听端口上会留下 TIME_WAIT（每个被接受的连接都留），
    POSIX 上大约 60s 内不许重新 bind —— 但那一秒确实**没有人在听**。
    把两件事混成一个 wait，就会在整局都跑完之后把 run 判死（实测 OUT-Q-360-ask）。
    """
    import errno
    with socket.socket() as probe:
        probe.settimeout(1)
        try:
            probe.bind(('127.0.0.1', port))
            return True
        except OSError as error:
            return error.errno not in (errno.EADDRINUSE, errno.EACCES)


def wait_for(check, port, seconds, what):
    end = time.time() + seconds
    while time.time() < end:
        if check(port):
            return True
        time.sleep(0.2)
    return False


def wait_free(port, seconds=10):
    return wait_for(port_bindable, port, seconds, 'bindable')


def launch(argv, **kw):
    """Start a child in ITS OWN process group so teardown can reap what it spawned."""
    return subprocess.Popen(argv, start_new_session=True, **kw)


def stop_tree(proc, grace=15):
    """Terminate a child AND its group, then kill what survives the grace period.

    Chrome is not one process: the browser shell exits on SIGTERM while renderers, GPU and
    zygote keep briefly writing into the profile. Killing only the parent leaves that
    window open -- see remove_dir below for what it cost.
    """
    if proc is None:
        return
    try:
        group = os.getpgid(proc.pid)
    except ProcessLookupError:
        return
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(group, sig)
        except ProcessLookupError:
            return
        try:
            proc.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            continue
        return


def remove_dir(path, seconds=20):
    """Remove a directory, waiting out children that are still flushing it.

    The first teardown used a single `rmtree(ignore_errors=True)`: a straggler re-created
    a file inside the profile right after it returned, ignore_errors hid that, and the
    `profile left behind` assertion then failed a run whose game had passed every check
    (clean-checkout 2026-11-26 11:55). Assertions stay as they are; the deletion gets the
    retry that the failure actually showed was missing.
    """
    end = time.time() + seconds
    while path.exists():
        shutil.rmtree(path, ignore_errors=True)
        if not path.exists():
            return True
        if time.time() >= end:
            return False
        time.sleep(0.25)
    return True


def fc_summary():
    """Which font actually claims the panel's hanzi (proves the shots are readable)."""
    out = []
    for label, arg in (('lang=zh', ':lang=zh'), ('U+4E2D', ':charset=4e2d'), ('U+76D6', ':charset=76d6')):
        try:
            r = subprocess.run(['fc-list', arg], capture_output=True, text=True, timeout=30)
            first = (r.stdout.strip().splitlines() or [''])[0]
            out.append(f'{label}: {first or "NONE"}')
        except Exception as ex:  # noqa: BLE001 - recorded, not fatal
            out.append(f'{label}: ERROR {ex}')
    return '\n'.join(out)


def lock_entries():
    return lockfile.entries(LOCK)


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


def build_lock_tree(dest):
    """Copy exactly the lock's files; a missing or drifted source refuses the run."""
    entries = lock_entries()
    need(len(entries) == 35, f'lock names {len(entries)} files, expected 35')
    dest.mkdir(parents=True)
    for rel, digest in entries:
        src = ROOT / rel
        need(src.is_file(), f'lock names {rel} but it is missing from the worktree')
        need(sha(src) == digest, f'{rel} drifted from the lock: {sha(src)}')
        dst = dest / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())     # copy2 would carry mtimes; bytes are the claim
    return entries


def one_run(tree, out, profile, http_port, cdp_port, label, driver=DRIVER):
    need(not out.exists(), f'REFUSED: single use, {out} already exists')
    need(not profile.exists(), f'profile root already exists: {profile}')
    # 起跑前必须**能绑**，不能只问「有没有人在听」：serve.py 不带 SO_REUSEADDR，
    # 紧接着上一轮跑时端口还在 TIME_WAIT（~60s），bind 会 EADDRINUSE。
    need(wait_free(http_port, 90), f'http port {http_port} not bindable after 90s')
    need(wait_free(cdp_port, 30), f'cdp port {cdp_port} not bindable after 30s')
    out.mkdir(parents=True)
    from urllib.request import build_opener, ProxyHandler
    fontline = (FONTCONF + '\n' if FONTCONF else '(ambient fontconfig, no override)\n') + fc_summary()
    (out / 'fontconfig.txt').write_text(fontline + '\n')
    opened = build_opener(ProxyHandler({}))
    serve = launch([sys.executable, '-B', str(tree / 'serve.py'), str(http_port)],
                   cwd=str(tree), stdout=subprocess.PIPE, text=True)
    chrome = None
    try:
        line = serve.stdout.readline().strip()
        need(line == f'LISTENING {http_port}', f'server did not announce: {line!r}')
        # #3319b: same entry as the driver uses (the driver holds the truth; this is just
        # the pre-flight reachability check). Keep the grow/1 default so old receipts replay.
        style = os.environ.get('ENTRY_STYLE') or 'grow'
        seed = os.environ.get('ENTRY_SEED') or '1'
        r = opened.open(f'http://127.0.0.1:{http_port}/index.html?slice=1&style={style}&seed={seed}', timeout=5)
        body = r.read()
        need(r.status == 200 and b'Monopoly 11' in body, 'index.html not served')
        (out / 'served-styles.css.sha256').write_text(sha(tree / 'styles.css') + '  served\n')
        profile.mkdir(parents=True)
        env = dict(os.environ, CDP_PORT=str(cdp_port), HTTP_PORT=str(http_port),
                   OUT_DIR=str(out), LABEL=label, VIEWPORT_W=str(VW), VIEWPORT_H=str(VH))
        if FONTCONF:
            env['FONTCONFIG_FILE'] = FONTCONF
        chrome = launch([
            str(CHROME), '--headless=new', f'--remote-debugging-port={cdp_port}',
            f'--user-data-dir={profile}', '--no-first-run', '--no-default-browser-check',
            '--disable-gpu', '--hide-scrollbars', f'--window-size={VW},{VH}',
            '--force-device-scale-factor=1', '--disable-features=Translate,HeadlessModeReporter',
            'about:blank'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            run = subprocess.run(['node', str(driver)], env=env, timeout=460,
                                 capture_output=True, text=True)
        except subprocess.TimeoutExpired as ex:
            text = ((ex.stdout or b'') + (ex.stderr or b''))
            if isinstance(text, bytes):
                text = text.decode('utf-8', 'replace')
            (out / 'drive-stdout.txt').write_text(text + '\n--- DRIVER OVERRAN 460s, killed ---\n')
            raise RuntimeError('driver overran 460s; output in drive-stdout.txt')
        (out / 'drive-stdout.txt').write_text(run.stdout + '\n--- stderr ---\n' + run.stderr)
        print(f'[{label}] ' + run.stdout.strip().replace('\n', f'\n[{label}] '))
        if run.returncode != 0:
            raise RuntimeError(f'[{label}] driver exit {run.returncode}: ' + run.stderr[-1500:])
    finally:
        stop_tree(chrome)
        stop_tree(serve)
        close = {'serve_port_released': not port_listening(http_port),
                 'cdp_port_released': not port_listening(cdp_port)}
        # Chrome's stragglers can re-create a file under the profile just after rmtree
        # returns; `profile_removed` is the claim, so it waits for the directory to be
        # gone instead of assuming one attempt was enough.
        close['profile_removed'] = remove_dir(profile)
        close['serve_pid'] = serve.pid
        close['chrome_pid'] = chrome.pid if chrome else None
        (out / 'cleanup.json').write_text(json.dumps(close, indent=2) + '\n')
        print(f'[{label}] CLEANUP ' + json.dumps(close))


def selftest_driver(driver=DRIVER):
    """Compile the driver's browser-side expressions before Chrome is started."""
    env = dict(os.environ, SELFTEST='1', OUT_DIR='/nonexistent')
    r = subprocess.run(['node', str(driver)], env=env,
                       capture_output=True, text=True, timeout=60)
    need(r.returncode == 0 and 'SELFTEST OK' in r.stdout,
         f'driver self-test failed: {r.stdout[-400:]} {r.stderr[-400:]}')
    return r.stdout.strip()


def chrome_census(profile):
    """Split 'chrome processes' into MINE and the rest of the host.

    A shared host's process count says nothing about this run, so the only honest check
    is "did MY profile's browser survive": every flag is read from the process command
    line, and the host total is kept as context, not as a verdict.
    """
    r = subprocess.run(['pgrep', '-af', 'chrome'], capture_output=True, text=True)
    mine, host = [], []
    marker = '--user-data-dir=' + str(profile)
    for entry in (r.stdout or '').splitlines():
        pid, _, cmd = entry.partition(' ')
        if not cmd:
            continue
        (mine if marker in cmd else host).append({'pid': int(pid), 'cmd': cmd[:200]})
    return {'own': len(mine), 'host_total': len(mine) + len(host), 'own_cmds': mine}


def self_check():
    """The driver compiles its browser-side expressions; the wrapper checks its own pins."""
    print('SELFTEST ' + selftest_driver())
    r = subprocess.run(['node', str(HERE / 'probe-lib.mjs')], capture_output=True, text=True, timeout=60)
    need(r.returncode == 0 and 'PROBE OK' in r.stdout, f'probe gate failed: {r.stdout[-300:]} {r.stderr[-300:]}')
    print(r.stdout.strip())


def claim_ports(preferred, timeout=20):
    """Use the preferred trio if it is free; otherwise ask the OS and say so out loud.

    A verification that fails only because a *different* checkout is mid-run teaches the
    reader nothing about the product, and the message it printed ('not bindable after
    90s') actively says 'broken' when the truth is 'someone else is using that number'.
    Concurrency is a real condition on this host -- it happened to an outside verifier
    -- so the harness moves out of the way and records what it actually used.
    """
    # ALL THREE, not just the first two. The verify port is bound by verify-http.py after
    # the game finishes, so a run that only checked http+cdp would get all the way through
    # a 45-second game and then fail at the last step for a reason that was already true
    # when it started -- the worst kind of late, unexplained failure for an outside
    # verifier. An occupied verify port alone now moves all three, same as the others.
    busy = [p for p in preferred if not port_bindable(p)]
    if not busy:
        return preferred, None
    picked = _ephemeral(preferred)
    return picked, f'preferred {preferred} busy ({busy}); asked the OS for {picked}'


def main():
    global HTTP_PORT, CDP_PORT, VERIFY_PORT
    need(CHROME.is_file(), f'missing chrome (set CHROME_BIN); looked at {CHROME}')
    need(VERIFY.is_file(), f'missing {VERIFY}')
    need(not OUT.exists(), f'REFUSED: {OUT} already exists (single use)')
    need(not PROFILE.exists(), f'REFUSED: profile {PROFILE} exists')
    (HTTP_PORT, CDP_PORT, VERIFY_PORT), port_note = claim_ports(
        (HTTP_PORT, CDP_PORT, VERIFY_PORT))
    if port_note:
        print('PORTS ' + port_note)
    need(wait_free(HTTP_PORT, 90), f'http port {HTTP_PORT} not bindable after 90s')
    need(wait_free(CDP_PORT, 30), f'cdp port {CDP_PORT} not bindable after 30s')
    need(wait_free(VERIFY_PORT, 30), f'verify port {VERIFY_PORT} not bindable after 30s')
    # A trees/ dir means an earlier attempt died mid-run. Trees are disposable by design;
    # saying so and clearing it beats silently reusing a tree of unknown provenance.
    stale = sorted(glob.glob(str(TREES / '*')))
    need(not stale, f'REFUSED: {stale} left by an earlier attempt; remove it by hand')
    self_check()

    TREES.mkdir()
    tree = TREES / 'lock'
    try:
        entries = build_lock_tree(tree)
        on_disk = sorted(str(p.relative_to(tree)) for p in tree.rglob('*') if p.is_file())
        need(on_disk == sorted(rel for rel, _ in entries),
             'tree file set differs from the lock (an extra file would ship)')
        tree_record = {'count': len(on_disk), 'files': on_disk}
        one_run(tree, OUT, PROFILE, HTTP_PORT, CDP_PORT, 'clean-full', driver=str(DRIVER))
        # Written into THIS run's OUT, not next to the script. It used to land in the
        # repo directory itself, so every run quietly added a work product to the delivery
        # set -- and a receipt that lives outside the run it describes is unreviewable.
        (OUT / 'record-tree.json').write_text(json.dumps(tree_record, indent=2) + '\n')
        # 端口属于「这一次运行」，所以要留在这一次的证据里："why did my run fail at bind"
        # 和 "which ports were actually used" 是同一个问题的两半。
        (OUT / 'ports.json').write_text(json.dumps({
            'http': HTTP_PORT, 'cdp': CDP_PORT, 'verify': VERIFY_PORT,
            'note': port_note}, indent=2) + '\n')
        # #3336: the seal also writes a machine-readable record. The .txt log truncates
        # hashes to 12 chars, which reads fine and proves nothing; the JSON carries the
        # full served digests so a reader holding only the receipt can recompare them
        # against the lock (verify-receipt.py item F).
        check = subprocess.run([sys.executable, str(VERIFY), str(tree), str(VERIFY_PORT),
                               str(OUT / 'served-seal.json')],
                               capture_output=True, text=True, timeout=120)
        (OUT / 'verify-http.txt').write_text(check.stdout + '\n--- stderr ---\n' + check.stderr)
        print(check.stdout.strip())
        need(check.returncode == 0, 'HTTP byte verification failed; see verify-http.txt')
        after = {rel: sha(tree / rel) for rel, _ in entries}
        (OUT / 'tree-after.sha256').write_text(''.join(f'{v}  {k}\n' for k, v in sorted(after.items())))
        # #3331: WHICH product did this run serve? tree-after.sha256 says the bytes did not
        # move during the run; it does not say which lock they came from, so a receipt cut
        # from this run could not name a version. `product.json` carries the lock name, the
        # lock's own sha256, and one digest over the served (path, sha256) pairs -- enough
        # for a reader with the repo to recompute the same number from the lock file alone.
        (OUT / 'product.json').write_text(json.dumps({
            'lock': str(LOCK.relative_to(ROOT)),
            'lock_sha256': sha(LOCK),
            'tree_sha256': tree_digest(after.items()),
            'files': len(after)}, indent=2) + '\n')
    finally:
        remove_dir(TREES)
        need(not PROFILE.exists(), 'profile left behind')
        need(not TREES.exists(), 'tree dir left behind')
    # 扫尾问的是「还有谁在应答」，不是「能不能立刻 bind」：TIME_WAIT 里绑不上但仍空着端口
    # 是健康跑完的正常状态（见 port_bindable 的注释）。
    released = {p: not port_listening(p) for p in (HTTP_PORT, CDP_PORT, VERIFY_PORT)}
    need(all(released.values()), f'a port still answers: {released}')
    census = chrome_census(PROFILE)
    need(census['own'] == 0, f"this run's chrome survived teardown: {census['own_cmds']}")
    (OUT / 'after.json').write_text(json.dumps({'own_chrome': census['own'],
        'host_chrome_total': census['host_total'],
        'ports_free': {'http': released[HTTP_PORT], 'cdp': released[CDP_PORT],
                       'verify': released[VERIFY_PORT]}}, indent=2) + '\n')
    print('DONE: ' + str(OUT))
    report = subprocess.run([sys.executable, str(HERE / 'report-full.py'), str(OUT)],
                            capture_output=True, text=True)
    print(report.stdout.strip())
    need(report.returncode == 0, 'acceptance report failed; see stdout above')


if __name__ == '__main__':
    sys.exit(main())
