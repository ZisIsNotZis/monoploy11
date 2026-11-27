# 街角生意：发版前的入口恢复检查（#3071）

**尚不能从远端重建已验收的本地版本，不要清理当前树或 `.scratch` 证据。** 本地接手从 `review/monoploy11-route-verified`（`d47a96d8f5247a04c88a01594093882105318073`）开始：主管已验其父提交 `b8a5c67` 的产品归档；`d47a96d` 只补三份入口测试和 35 路径字节锁，未改产品字节。正式本地采用的普通 HTTP 与浏览器验收边界见 [街角生意](6_SLICE.md)。当时的 `HEAD`（`master`）和本地远端跟踪引用 `origin/master` 各有 17 份锁定字节相同、7 份缺、11 份不同；两份 #3077 采用文件均仍与跟踪引用不同。本地归档未推送；跟踪引用不是向远端服务重新取证，独有运行回执也不能仅凭此 Git 引用恢复。以下是发版前的检查范围，不是发版许可。

## 最小带走清单（按用途分开）

- **普通试玩及主体资产：** [当前 #3166 逐路径 SHA-256](evidence/slice-entry-3166.sha256) 中的 34 个产品文件：`index.html`、`styles.css` 与 `src/` 下的 32 个 JS（入口和模拟器、规则、街角与完整模式的地图/卡牌/角色数据、渲染和程序生成 SVG）。按清单取正确字节，不可只带 HTML 和最后一次 UI 差异；另外带同表中 `serve.py` 来复现普通入口及 `no-store`。清单也锁定了 `support/serve-variant.py`，它是对照服务，不是普通入口运行依赖。
- **说明和最小复验：** `LICENSE`、`README.md`、`docs/6_SLICE.md` 及其中要保留的规则/证据链接、本页及清单、`docs/variant-entry-and-risk.md`（`test/blocked-internal-dirs.test.js` 会断言它仍可被 `serve.py` 取到；少了它，干净检出里这条测试会红，被误读成产品回归）、`test/ui-entry.test.js`、`test/slice-entry-choice.test.js`、`test/slice-route-choice.test.js`。静态 Pages 目标另保留 `.nojekyll`。若声明可复跑完整测试套件，另外审计全部 `test/` 和相应夹具；不要用下面的小套件替代全量报告。
- **对照、音频和历史回执另列：** 若另做本地对照复验，`support/serve-variant.py` 单独不够；还需要 `support/serve-fixture.js`（HTTP 测试）和 `.scratch/af-variant.html`、`.scratch/af-variant-inject.js`（对照页）。只搬经审查的具体夹具，不要把 `.scratch` 整体作为公开静态资源。`assets/voice/` 的本地 MP3 不在签收表中；没有它时走可用的中文系统语音或文字，不能声称已交付原音频。任何清理之前须先独立归档两轮只在本地的原始证据： `.scratch/3002-map-click/READOUT-3063.md`、`evidence-run2/` 与 `.scratch/3067-route-steps/RESULT-3077.md`、`evidence-3077/`、采用回执、前像及对应身份/量具依赖；历史回执不是产品资产，不应被临时目录清理，也不随游戏原样发布。

#3166 增加完整模式超级骰子的预览与确认。隔离候选在 Windows Edge 390×844 通过 21 项检查，关闭候选样式的对照重现了裁剪。采用后从正式入口核对了 34 项 HTTP 字节及禁缓存响应，另有 15 项重点回归通过。截图、回执、前像仍在本地 [#3166 证据](../.scratch/3166-sheet/)，发版或清理前须一并归档。

## 获准后在另一份干净检出复验

对未来**明确授权的候选提交**在独立干净检出根目录执行，不在当前工作树执行恢复/清理操作。以下采用当前 #3166 基线；[#3077 锁](evidence/slice-entry-3077.sha256) 与 [#2980 锁](evidence/slice-entry-2980.sha256) 用于历史与回退。若候选包含待验新改动，先单列、审核差异并为对应字节及新验收冻结新清单，不把旧通过贴到新树上。

```bash
set -euo pipefail
lock=docs/evidence/slice-entry-3166.sha256
test -z "$(git status --porcelain=v1 --untracked-files=all)"
# 防止来自未跟踪/ignored 本地残留的文件碰巧让哈希通过。
while IFS= read -r path; do git ls-files --error-unmatch -- "$path" >/dev/null; done < <(cut -c67- "$lock")
sha256sum --strict -c "$lock"
node --test test/ui-entry.test.js test/slice-entry-choice.test.js test/slice-route-choice.test.js
python3 -B serve.py 0  # 专属 HTTP，终端会打印 LISTENING <port>
```

另一终端令 `PORT` 等于上述**本次自己的**端口，核对请求入口与 33 个客户端资源的 HTTP 字节；不连任一现有正式端口。浏览器环节另行授权。

```bash
set -euo pipefail
: "${PORT:?仅填写前一步专属 LISTENING 端口}"
base="http://127.0.0.1:$PORT"
while read -r expected path; do
  case "$path" in
    index.html) url="$base/?slice=1&seed=2&style=take" ;;
    styles.css|src/*.js) url="$base/$path" ;;
    *) continue ;;
  esac
  actual=$(curl --noproxy '*' --fail --silent --show-error "$url" | sha256sum)
  test "${actual%% *}" = "$expected" || { echo "HTTP 字节不符: $path" >&2; exit 1; }
done < docs/evidence/slice-entry-3166.sha256
```

最后用普通入口确认起手选择可见且不会自动开局；选定起手、开局、到目标岔口，验证候选声明的实际输入及画面。检查同一专属端口的 `Cache-Control: no-store`，退出自己启动的服务并确认专属端口释放。**字节一致、Node 绿、历史截图三者都不能取代新承载环境的试玩。** 当前已验收本地 390×844 浏览器流程、采用后的普通 HTTP 字节和上方本地 Git 归档；未验远端恢复或新的发布承载环境，不具备发布或清理依据。


## 追加：#3278 之后的现状（本页上文仍是 #3071/#3166 口径）

上文的锁、闸门与结论讲的是 #3166 那一版（`slice-entry-3166.sha256`，34 个产品文件）以及当时的
`HEAD`/`origin/master` 三方对比。**那一节的「尚不能从远端重建」在今天的产物上依然成立**，因为本轮仍未提交；
但它已不是对当前版本的最新描述，最新入口与整局回执见 [RESULT-3278](evidence/RESULT-3278.md)。

- **当前锁**是 [#3278](evidence/slice-entry-3278.sha256)（35 项，逐项 HTTP 核过且 `no-store`）。
  与 #3166 相比只多一项、只改了一处产品字节：`src/ui/render.js` 的提示定位（sticky → absolute overlay）。
  上文按 #3166 复验的步骤仍可照跑，但会把提示那一处当成旧字节而红；要复验当前版请换锁文件。
- **「可复取」这次是可点名的**：`support/full-game/DELIVERY.txt` 列出干净检出应当存在的每一项
  （产品 35 + 文档 + 量具 + 测试），`check-delivery.py` 逐项核字节，`clean-checkout.py` 只复制这些到空
  目录再跑；此前「可重跑」依赖 `.scratch`，那里不入库，所以那句话在干净检出里从来没有兑现过。
- **本页那道 `git status --porcelain` 闸门在本工作树永远过不了**（`test/`、`support/`、`docs/6_SLICE.md`
  等全部未跟踪），#3264 一节已给出替身与理由；本轮沿用同一替身（`clean-checkout.py`）。
  **它证明的是「清单内文件自成一体」，不是「Git 树干净」。**
- **「可检出」这次有了分支级证据，但仍不是发布许可**：`support/full-game/make-candidate.py` 用临时索引
  把交付清单做成真提交并只把**新名字**指过去（`master` 与其它分支不动、不 push、不走 `.git/index`；
  已存在且指向别处的同名分支会被拒绝而不是 force-move）。两种形状都有实测：
  `candidate/3278-narrow-slice`（根提交，树上只有清单文件）用 `git archive` 抽出后套件全绿、整局 `VERDICT: PASS`；
  `release/3278-narrow-slice`（`--onto origin/master`，父提交就是 `origin/master`，**不删任何已有文件**）
  `git worktree add` 检出后同样全绿 —— 后者是「`git pull --ff-only` 会成功」的实测替身，前者只回答
  「交付集自不自成一体」。判据是三态，SKIP 会点名，不再是“全 PASS”。但这**与远端能否重建仍是两件事**：
  本页开头那组 `HEAD`/`origin/master` 对比说的是跟踪引用里的字节，而两个本地分支谁都没收到。
- **本轮多修一个「画得出、点不着」**：气泡在播时动作屏仍画 enabled 的掷骰键与手牌，而 `answer()` 会静默丢掉
  这些点击（360×640 实测连按 20 次、引擎一步没动）。修法是两道闸：`ui.ask` 先装槽再等气泡，
  以及 `render()` 的 `answerable` 开关 + 作答后即时重画。判据 **F6** 只看控件自己的销账
  （按下 80ms 后仍 enabled ⇒ 没被接住），旧记录无采样则 SKIP。**残余**：只修了动作屏，
  非动作屏作答后仍不重画。锁因此从提示那一处扩到两项（`src/ui/render.js`、`src/main.js`），已重冻。
- **视觉结论未被这两刀改变**：360×640 修复后重跑（`OUT-V-360-ack`）仍是 `docH 697 / winH 640`、
  手牌首帧可用 `0/30`、掷骰首帧可用 `0/37`，滚动距离分布逐字相同 —— 两道闸让「滚到可点之后的那次点击
  不再被丢」，**没有**让 360 少滚一次页。
- **没有推进的部分**：远端恢复、发布承载环境、真机触屏、比 360×640 更窄的屏仍未验。360×640 已跑过两局
  （前半段：只能靠整页滚动才能行动，见 RESULT §5），但都是鼠标驱动，不是触屏。
  本页的收尾判断（「不具备发布或清理依据」）保持不变；尤其**仍不要清理当前树或 `.scratch` 证据**。
