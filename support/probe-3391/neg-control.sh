#!/bin/bash
# #3391v 负对照：新测试必须真的咬得住。每处改动跑完立刻还原并断言字节复原。
#
# 只在**工作区**改，不提交；每一步前先备份、后按 sha 校验还原成功。
set -u
cd "$(dirname "$0")/../.." || exit 1
ML=src/engine/market-ledger.js
BAK=$(mktemp) || exit 1
cp "$ML" "$BAK"
BEFORE=$(sha256sum "$ML" | cut -d' ' -f1)
restore() { cp "$BAK" "$ML"; }
cleanup() { restore; rm -f "$BAK"; }
trap cleanup EXIT

fail=0

run_case() {
  local name="$1"
  local out
  out=$(node --test test/street-business-increment.test.js 2>&1 | grep -cE '^✖')
  if [ "$out" -gt 0 ]; then
    echo "OK   $name -> $out 条红（测试咬住了）"
  else
    echo "BAD  $name -> 测试全绿，说明这条判据是空的"
    fail=1
  fi
}

echo "== 负对照 0：未改动时应当全绿 =="
clean=$(node --test test/street-business-increment.test.js 2>&1 | grep -cE '^✖')
if [ "$clean" -eq 0 ]; then echo "OK   未改动全绿"; else echo "BAD  未改动就有红"; fail=1; fi

echo
echo "== 负对照 1：把「数组身份还原」退回旧写法（#3424 修的那处）=="
python3 - "$ML" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text()
old = "    p.properties.length = mineLen;"
assert old in s, 'anchor missing'
p.write_text(s.replace(old, "    p.properties = p.properties.slice(0, mineLen);  // 负对照：换掉数组身份"))
PY
run_case "身份恢复退化成换数组"
restore

echo
echo "== 负对照 2：停业时静默返回空（#3391t 修的那处）=="
python3 - "$ML" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text()
old = "  const blocked = after.closed > 0;"
assert old in s, 'anchor missing'
p.write_text(s.replace(old, "  const blocked = after.closed > 0;\n  if (blocked) return '';  // 负对照：停业时沉默"))
PY
run_case "停业时那一行静默消失"
restore

echo
echo "== 负对照 3：试算不再恢复属性格 =="
python3 - "$ML" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text()
old = "    state.properties[plotId] = saved;"
assert old in s, 'anchor missing'
p.write_text(s.replace(old, "    // 负对照：不恢复那一格"))
PY
run_case "试算污染 state.properties"
restore

AFTER=$(sha256sum "$ML" | cut -d' ' -f1)
if [ "$BEFORE" = "$AFTER" ]; then
  echo
  echo "RESTORED  $ML 字节已复原（$AFTER）"
else
  echo
  echo "DIRTY     $ML 没复原！$BEFORE -> $AFTER"
  fail=1
fi

echo
git status --porcelain -- "$ML"
echo "(上面为空 = 产品字节干净)"
exit "$fail"
