#!/usr/bin/env python3
"""#3278: turn one run's raw records into a single PASS/FAIL receipt.

Why this exists: the first rounds of this project ended with a folder of JSON and me
reading it by hand. That is not a receipt -- a teammate cannot tell from it whether the
game passed, and a later replay cannot either. This prints the verdict, names the field
behind each check, and exits non-zero when anything is red.

The hint criterion is deliberately NOT `mismatchCount == 0`. mismatchCount only counts
hints that were displayed with the wrong text; a screen that silently clips a route
displays no hint at all, so mismatchCount stays 0 while the player is misled. F3 asks the
stronger question: for every screen whose own geometry says something is hidden
(expectShow), was a hint actually mounted and did its text agree? Both are reported.

Three states, not two
---------------------
A check whose subject never appeared must not print PASS. Found at 360x640: that run never
met a buy screen (its landings differed), so `buyFirstUnusable` stayed null and
`F2 buy screen usable at first frame` printed PASS -- "no evidence" dressed as "evidence".
Missing evidence is now SKIP, which is not PASS and not FAIL: the buy path is simply not
judged by that run, and the receipt says so instead of implying it was verified. SKIP does
not fail the run (a game where the human never lands on an unowned plot is a legitimate
outcome), but it is named in the verdict so a reader cannot mistake it for coverage.
"""
import json
import sys
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else '.')


def load(name):
    p = OUT / name
    if not p.is_file():
        raise SystemExit(f'MISSING {p} -- the run did not get this far')
    return json.loads(p.read_text())


def main():
    summary = load('record-8-summary.json')
    judge = summary['judge']

    checks = {}
    # F1: the entry itself answered, in a browser, with no exceptions.
    checks['F1 entry ran, no runtime errors'] = (
        summary['runtimeErrorCount'] == 0 and summary['runtimeErrors'] == [])
    checks['F1 no stuck screen'] = summary['stuck'] == []
    checks['F1 reached the results screen'] = 'results' in summary['kinds']
    # F2: a player could actually press things. A buy screen whose first frame has no
    # usable control is the defect earlier rounds shipped with.
    # A buy screen that never appeared is not a pass. `buy` in kinds is what proves the run
    # actually met one; buyFirstUnusable alone cannot, because it stays null either way.
    saw_buy = 'buy' in summary['kinds']
    checks['F2 buy screen usable at first frame'] = (
        None if not saw_buy else summary['buyFirstUnusable'] is None)
    checks['F2 a land purchase happened'] = (None if not saw_buy else summary['buys'] >= 1)
    # F3: the hint question, both halves (see module docstring).
    hinted = [h for h in summary['hintTrace'] if h['expectShow']]
    checks['F3 every expectShow screen really hinted'] = all(h.get('visible') for h in hinted)
    checks['F3 hinted text agreed with the product'] = all(h.get('agree') for h in hinted)
    checks['F3 no hint where nothing is hidden'] = not [
        h for h in summary['hintTrace'] if not h['expectShow'] and h.get('visible')]
    checks['F3 mismatchCount 0'] = summary['mismatchCount'] == 0
    # F4: the result is readable AND independent-checkable: rows sum, the gap line matches
    # the rows, the title names the actual winner, all rows fit, replay is pressable.
    # F4: the result is readable AND independent-checkable: rows sum, the gap line matches
    # the rows, the title names the actual winner, all rows fit, replay is pressable.
    #
    # The gap is RECOMPUTED here from the rows instead of trusting judge['checks']: until
    # this round the driver demanded a "相差 N 资产" string on every result, which the win
    # branch (src/ui/slice.js:995, "你赢了。") never prints. Twenty PASS records all lost,
    # so the bug only surfaced when a 360x640 run happened to WIN. A check that can only
    # pass on one branch is a check that has never been tested on the other.
    rows = judge.get('rows') or []
    def _num(s):
        digits = ''.join(ch for ch in str(s) if ch.isdigit() or ch == '-')
        return int(digits) if digits else None
    totals = {r['owner']: _num(r['total']) for r in rows}
    human = summary.get('human')
    gap_line = judge.get('gapLine') or ''
    import re as _re
    claimed = _re.search(r'相差\s*([\d,]+)\s*资产', gap_line)
    claimed_n = int(claimed.group(1).replace(',', '')) if claimed else None
    expect = None
    if rows and human in totals:
        top = max(v for v in totals.values() if v is not None)
        expect = top - (totals.get(human) or 0)
    if expect is None:
        checks['F4 gapMatches'] = None
    elif expect == 0:
        # The human at the top total: the line must say so and print no invented gap.
        checks['F4 gapMatches'] = (claimed_n is None and bool(gap_line))
    else:
        checks['F4 gapMatches'] = (claimed_n == expect)
    for key in ('rowsFull', 'sumsOk', 'titleNamesWinner', 'replayUsable',
                'threeRows', 'headerOrder'):
        checks[f'F4 {key}'] = judge['checks'][key]
    # F5: replay lands somewhere a human can start again from.
    replay = load('record-10-replay.json')
    checks['F5 replay landed on setup'] = replay['checks']['setupShown']
    checks['F5 replay advanced the seed'] = replay['checks']['seedIs2'] and replay['checks']['urlSeedIs2']
    checks['F5 replay offered all three styles'] = replay['checks']['stylesOffered']
    checks['F5 replay button pressable'] = replay['checks']['ctaUsable']
    # Housekeeping: the run released what it took.
    after = load('after.json')
    checks['X this run left no chrome'] = after['own_chrome'] == 0
    checks['X all ports released'] = all(after['ports_free'].values())

    # ---- 按压分析：必须在打印 checks 之前算完，否则 F6 这一项根本印不出来 ----
    plog = summary.get('pressLog') or []
    # 同一张屏被连按：不是 FAIL（真玩家也可能连点），但它必须可见。
    # #3278 实测过两次：一次是驱动器把同一屏反复测成「首帧」，一次是产品在气泡窗口里
    # 画着 enabled 的 roll 键却丢掉点击（pressLog[40..59]，day/logLen 全程不变）。
    bursts, run = [], []
    for p in plog:
        key = (p.get('tag'), json.dumps(p.get('seen'), sort_keys=True, ensure_ascii=False))
        if run and run[-1] == key:
            run.append(key)
        else:
            if len(run) >= 3:
                bursts.append(run)
            run = [key]
    if len(run) >= 3:
        bursts.append(run)
    # 判据不是「按下时气泡在播」——修复后那恰好是**正常**情形（ask 先把本屏画出来，
    # 点击被接住，引擎在 settle 里等气泡播完）。判据是「按下的控件自己有没有销账」：
    # 产品规则是「可点 ⇔ 此刻能接受回答」，所以若同一控件 80ms 后仍 enabled，就说明
    # 这次点击**没有被接住**（槽空着，answer() 早退）—— 这正是修复前的 OUT-S 指纹。
    # 没有 after 的旧记录一律 SKIP：那是「量具没问这个问题」，不是「那时没问题」。
    swallowed = [p for p in plog if isinstance(p.get('after'), dict) and p['after'].get('stillEnabled') is True]
    eaten = [p for p in swallowed if str(p.get('tag', '')).startswith(('action:roll', 'action:card'))]
    probes = [p for p in plog if isinstance(p.get('after'), dict)]
    # 进判决：缺陷记录必须**红**，干净记录绿或 SKIP —— 只在某一版上出色的判据不算判据。
    checks['F6 no press on a control that had already stopped accepting'] = (
        None if not probes else (not eaten))

    for k, v in checks.items():
        print(f'{"SKIP" if v is None else "PASS" if v else "FAIL"}  {k}'
              + ('' if v is not None else '  (the run never met this screen; nothing is claimed)'))
    print()
    print(f'hint screens: {len(hinted)} expectShow of {len(summary["hintTrace"])} measured, '
          f'{sum(1 for h in hinted if h.get("visible"))} mounted, mismatchCount={summary["mismatchCount"]}')
    print(f'play: {summary["frames"]} frames, {summary["presses"]} presses, {summary["ms"]} ms, '
          f'buys={summary["buys"]}, kinds={sorted(summary["kinds"])}')
    branch = 'not judged' if expect is None else ('human-won' if expect == 0 else 'human-behind')
    print(f'result: {judge["heading"]} / {judge["gapLine"]}  [branch {branch}, recomputed gap {expect}]')
    if bursts:
        worst = max(bursts, key=len)
        print(f'WARN  {len(bursts)} burst(s) of >=3 presses with an identical screen fingerprint; '
              f'longest {len(worst)} on {worst[0][0]} -- check whether the screen was still taking answers')
    if not probes:
        print('gate: NOT EXERCISED -- this run has no press that could distinguish "taken" from '
              '"swallowed", so it says nothing about the answer-gate (good or bad)')
    elif eaten:
        print(f'gate: FAIL-OBSERVED {len(eaten)} press(es) on a control that was still enabled after the '
              'click -- the screen drew a pressable control whose answer was not taken')
    else:
        acts = [p for p in probes if str(p.get('tag', '')).startswith(('action:roll', 'action:card'))]
        bub = [p for p in acts if p.get('bubble')]
        print(f'gate: OK -- {len(acts)} action-control press(es) carried acknowledgement evidence; '
              f'{len(bub)} of them landed while a bubble was live and were still taken '
              '(the control went disabled within 80ms). Non-action screens are NOT claimed: '
              'answer() only repaints the action screen.')
    bad = [k for k, v in checks.items() if v is False]
    skipped = [k for k, v in checks.items() if v is None]
    print()
    print('VERDICT: PASS' if not bad else 'VERDICT: FAIL ' + ', '.join(bad))
    if skipped:
        print(f'NOT JUDGED by this run ({len(skipped)}): ' + ', '.join(skipped))
    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main())
