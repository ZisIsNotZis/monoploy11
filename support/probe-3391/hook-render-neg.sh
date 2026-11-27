#!/bin/bash
# #3391v 负对照：hook-render 探针必须咬得住「HOOKS 缺一个 id → 静默回退旧文案」。
#
# 这是本次重构（文案从 slice.js 搬进 main.js）最具体的失效方式：`HOOKS[s.id] ?? s.hook`
# 让缺失静默降级，屏上出现的是已收回的旧文案，而所有字节级判据照样全绿。
# 跑完按 sha256 断言产品字节复原。
set -u
cd "$(dirname "$0")/../.." || exit 1
MAIN=src/main.js
BAK=$(mktemp) || exit 1
cp "$MAIN" "$BAK"
BEFORE=$(sha256sum "$MAIN" | cut -d' ' -f1)
cleanup() { cp "$BAK" "$MAIN"; rm -f "$BAK"; }
trap cleanup EXIT

export CHROME="${CHROME:-$(node -e "import('./support/find-chrome.mjs').then(m=>console.log(m.findChrome()))")}"
export CDP_PORT="${CDP_PORT:-19713}"

echo "== 负对照 0：未改动时应当 PASS =="
if node support/probe-3391/hook-render.mjs >/tmp/hook-neg-clean.txt 2>&1; then
  echo "OK   未改动 PASS"
else
  echo "BAD  未改动就 FAIL："; tail -5 /tmp/hook-neg-clean.txt
  exit 1
fi

echo
echo "== 负对照：把 HOOKS 里的 take 拿掉（应静默回退到旧文案）=="
python3 - "$MAIN" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text()
old = "  take: '收购 + 定步：别人的店能出价，自己的落点能自己挑。',\n"
assert old in s, 'anchor missing'
p.write_text(s.replace(old, ""))
PY

if node support/probe-3391/hook-render.mjs >/tmp/hook-neg-broken.txt 2>&1; then
  echo "BAD  缺 id 时探针仍然 PASS —— 这条判据是空的"
  exit 1
fi
echo "OK   缺 id 时探针 FAIL（咬住了）："
grep -E '^ - ' /tmp/hook-neg-broken.txt | head -3 | sed 's/^/      /'

cp "$BAK" "$MAIN"   # 显式还原一次（trap 退出时还会再兜一次，幂等）
AFTER=$(sha256sum "$MAIN" | cut -d' ' -f1)
echo
if [ "$BEFORE" = "$AFTER" ]; then
  echo "RESTORED  $MAIN 字节已复原（$AFTER）"
else
  echo "DIRTY     $MAIN 没复原！"
  exit 1
fi
git status --porcelain -- "$MAIN"
echo "(上面为空 = 产品字节干净)"
