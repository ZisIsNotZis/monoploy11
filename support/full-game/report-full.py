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
    # #3337 新增：结算屏那句「下局试试」自己也是被量的对象（读不到等于没说）。
    # 只在这次运行真的记过它时才判 —— #3337 之前的回执（含 3319 那份交付回执）跑的是
    # 还没有这一行的产品，那时既没有这一行也没有它的证据。凭空补两项 SKIP 只是把
    # 「那时候没有这个问题」写成「这一局没判过」，对读者没有信息量。
    for key in ('nextGameVisible', 'nextGameNotEmpty'):
        if key in judge['checks']:
            checks[f'F4 {key}'] = judge['checks'][key]
    # F5: replay lands somewhere a human can start again from.
    replay = load('record-10-replay.json')
    checks['F5 replay landed on setup'] = replay['checks']['setupShown']
    # #3319b: the driver used to hardcode "seed 2" because every run started on seed 1
    # (replay writes seed+1). With the entry seed parameterised the expectation is derived
    # (`seedIsNext`), so read the new key when present and fall back to the old name -
    # receipts produced before this change still say `seedIs2` and must stay judgeable.
    rc = replay['checks']
    seed_ok = rc.get('seedIsNext', rc.get('seedIs2'))
    url_ok = rc.get('urlSeedIsNext', rc.get('urlSeedIs2'))
    checks['F5 replay advanced the seed'] = bool(seed_ok and url_ok)
    checks['F5 replay offered all three styles'] = replay['checks']['stylesOffered']
    checks['F5 replay button pressable'] = replay['checks']['ctaUsable']
    # 三态，与 F2/F6 同一条规矩：旧记录（本条判据存在之前跑的）没有这两项证据，
    # 那时“落回完整设置页、起手不预选”是已知缺陷而非通过 —— 所以判 SKIP，不判 PASS。
    # #3344b：supervisor 手选「整条街」打完后重开，起手与种子都对，
    # 发牌方式却悄悄回到了默认的争街 —— 于是他想「重开对比玩法」时比的不是同两张盘。
    # 这两项跟 sliceEntry/styleKept 同一套三态规则：旧记录没这项证据就判 SKIP，
    # 不判 PASS（那时它确实没被验过）。
    for label, key in (('F5 replay returned to the slice entry', 'sliceEntry'),
                       ('F5 replay kept the starter it was played with', 'styleKept')):
        value = replay['checks'].get(key)
        checks[label] = None if value is None else bool(value)
    # #3344b 的两项只在回执真的带了这份证据时才发言。
    # 为什么不像上面两项那样「缺了就 SKIP」：那会给所有旧回执永久增加两条未判项，
    # 而 test/receipt-slim 的规矩是「除了这一局没走到的那项，交付回执不得留未判项」——
    # 那条规矩是对的（永久 SKIP 会把「没验过」写成看起来像结论的东西）。
    # 所以：旧回执仍只印它当年能印的那些行；新回执（driver 总是写这两个键）必须 PASS。
    # “必需”由 test/receipt-3345.test.js 对**当前交付的那份**回执死咬。
    if 'openingKept' in replay['checks']:
        checks['F5 replay kept the opening (same board)'] = bool(replay['checks']['openingKept'])
        checks['F5 the opening is still switchable after replay'] = bool(replay['checks']['openingSwitchable'])
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
    # #3319c: 这条以前只对 action:* 发言（非动作屏作答后不重画，量具问不出所以然）。
    # 现在非动作屏作答后也会把按钮置灰，所以判据扩到**所有**按下的控件：
    # 「按下的控件 80ms 后仍 enabled」在任何一屏上都是「点击没被接住」。
    checks['F6 no press on a control that had already stopped accepting'] = (
        None if not probes else (not swallowed))

    # #3319b：选街屏的「取消」必须**真的关掉这一屏**。
    # 为什么需要单独一条：这一屏在 390×844 上曾经整块落在 #hand 的裁切线以下
    # （面板下沿 857.5 / 裁切 837，取消键中心 838），而 F6 只问「按下的控件有没有销账」，
    # 它回答不了「手根本没伸到那颗键上」。判据必须是「按到了 + 屏真的关了」两件事：
    #   · 按下时 elementFromPoint 中心命中的是它自己（hit == 'itself'）；
    #   · 按下后屏消失（after.panelHidden == True）且手牌回来（after.cardsVisible == True）。
    # 只认这种**结果**证据：没有 cancel 按压的旧记录一律 SKIP，不拿几何数字冒充“点到了”。
    cancels = [p for p in plog if str(p.get('tag', '')).endswith(':cancel-pick')]
    cancel_ok = None if not cancels else all(
        p.get('hit') == 'itself'
        and isinstance(p.get('after'), dict)
        and p['after'].get('panelHidden') is True
        and p['after'].get('cardsVisible') is True
        for p in cancels)
    checks['F7 street-picker cancel press actually dismissed the panel'] = cancel_ok

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
        # #3319c：这一句以前写「Non-action screens are NOT claimed」——那时非动作屏作答后不重画，
        # 量具确实问不出所以然。现在它们也会置灰，F6 已覆盖所有屏，这句话反过来会误导读回执的人。
        print(f'gate: OK -- {len(probes)} press(es) carried acknowledgement evidence on any screen; '
              f'{len(acts)} of them were action controls, {len(bub)} landed while a bubble was live and '
              'were still taken (the control went disabled within 80ms). Non-action screens ARE claimed '
              'now: answer() greys their panel buttons before the engine advances.')
    bad = [k for k, v in checks.items() if v is False]
    skipped = [k for k, v in checks.items() if v is None]
    print()
    print('VERDICT: PASS' if not bad else 'VERDICT: FAIL ' + ', '.join(bad))
    if skipped:
        print(f'NOT JUDGED by this run ({len(skipped)}): ' + ', '.join(skipped))
    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main())
