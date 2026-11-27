#!/usr/bin/env bash
# #3346：收购溢价 1.25 是不是把「机会买家」这条路关死的那一下？
#
# 为什么必须改产品字节才能量：`TAKEOVER_PREMIUM` 是 economy.js 里的模块级 const，
# 探针改不动它（不像 TUNING 那样是可写对象）。所以这里逐档改写那一行、跑、再还原。
#
# 安全约束：
#   · 只改 `const TAKEOVER_PREMIUM = X;` 这一行，其它字节一律不动；
#   · 每档跑完立刻 `git checkout --` 还原，并**用 sha256 断言还原成功**；
#   · trap EXIT 兜底，中途失败也会还原；
#   · 结束时 git status 必须干净（除了 support/probe-3346/ 这个新增目录）。
set -euo pipefail
cd "$(dirname "$0")/../.."

FILE=src/engine/economy.js
ORIG=$(sha256sum "$FILE" | cut -d' ' -f1)
SEEDS=${1:-30}

restore() {
  git checkout -- "$FILE"
  local now
  now=$(sha256sum "$FILE" | cut -d' ' -f1)
  if [ "$now" != "$ORIG" ]; then
    echo "!! 还原失败：$FILE sha256 $now != $ORIG" >&2
    exit 3
  fi
}
trap restore EXIT

for P in 1.25 1.00 0.85; do
  git checkout -- "$FILE"
  perl -pi -e "s/^const TAKEOVER_PREMIUM = [0-9.]+;/const TAKEOVER_PREMIUM = $P;/" "$FILE"
  if ! grep -q "^const TAKEOVER_PREMIUM = $P;" "$FILE"; then
    echo "!! 没改成 $P" >&2
    exit 2
  fi
  echo
  echo "################ 收购溢价 ×$P ################"
  node support/probe-3346/premium-arm.mjs "$SEEDS"
done
