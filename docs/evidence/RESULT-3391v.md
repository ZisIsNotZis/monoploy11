# #3391v：把开局说明讲准，并把可发布版本接在已推送的 `528de72` 上

supervisor 的三条意见，逐条对应本文三节：

1. **README 同一段自相矛盾** —— 先写「另一半可能是对手的」，后写「开局 100% 是无主空地」；
   紧接着一句「这一点只对两个 AI 座位成立」又把主语绕回去，玩家会按错的做决定。
2. **发布候选带了与玩法无关的 HTTP 路径测试改动** —— 那是首屏多加一块 `div` 的副作用。
3. **新加的五个对照脚本写死了本机 Chrome 路径** —— 别人的干净检出里只能看到「找不到 chrome」。

第 2 条我从**结构性**的地方改掉了：入口屏不再新增任何 DOM 节点。

---

## 1. 那句话到底该怎么写（`support/probe-3391/human-half.mjs`）

上一支探针 `support/probe-3346/half-owners.mjs` 用的是 `human: false`（三个座位全 AI）：
它证明了「0 号位那两条街的另一半是无主空地」，但**没有**证明人类坐的就是 0 号位，
也没证明这件事与所选起手无关。README 的矛盾正是在这两个前提上没对齐。

新探针按**真实入口**（`createSliceConfig({ human: true })`）跑，三个起手 × 5 个 seed，
四条硬断言，任一不成立就抛、不打印结论：

| 断言 | 结果 |
|---|---|
| 人类恰好一张椅子，且固定是 0 号位 | 15/15 局成立 |
| 人类手上每间店所在街的**另一半无人持有** | 15/15 局成立 |
| 人的座位与归属不随 `style` 变化 | 15/15 局（三张起手读数逐字相同） |
| AI 的另一半只在他们之间互转，从不归人类 | 15/15 局成立 |

```
$ node support/probe-3391/human-half.mjs
人类座位：0（真实入口 human:true；三个起手 × 5 seed 全部一致）

  晨光街 我 3,1 / 另一半 4,1=无主；月色街 我 9,9 / 另一半 8,9=无主
```

README 因此改成**两类座位各写一段**（不再有「这一点只对 X 成立」这种换主语的句子）：

- **你的椅子（0 号位）**：两条街的另一半都是无主空地与已建 Lv.1，走过去按标价 8,000 买 ——
  是买地，不是收购，也不等谁先开张。
- **两个对手的椅子**：他们的两条街才互为对方（8,1↔9,1、4,9↔3,9），只能走收购卡。

## 2. HTTP 路径测试为什么被拖下水，以及怎么解开的

上一版首屏为了放「规则（无进项 / 250）」这一排，在 `index.html` 里加了一块容器
（`<div id="sliceBusiness">`），并在 `styles.css` 里加了三条 chip 规则。后果是五个
**和玩法无关**的测试要改常量 —— 它们咬的是首页字节指纹与长度
（`blocked-matrix-both` / `blocked-prefix-sentinel` / `blocked-variant-internal` /
`trailing-slash` / `trailing-slash-variant`）。一次体验改动拖上一片路由测试。

两次尝试都失败，记录在这里免得下一个人重走：

1. 把规则 chip 渲染进已有的 `#sliceOpening`（2 列 grid）—— 两枚 chip 各占一个网格单元，
   多出**两行**：390×844 上「开一局」底边 854（视口 844），判红。
2. 把 `#sliceOpening` 改成 flex 一行 —— 390×844 通过，但 360×640 从基线 773 涨到 813，
   仍判红（`layout-smoke.mjs` 的 360 档是「不得比基线更差」）。

**最终做法**：这条规则本来就不配占首屏。`RESULT-3391u` 已经量过它——只在人类那张椅子上
有效（进项 3.97×），三把椅子平均 **0.0pp**；把对手那份收益补齐后，它与「白给同样多的钱」
分不开（**−0.9pp [−3.5, 1.7]**，跨 0；原来印的 −4.9pp 是对照臂少给对手发钱造成的，
复核 #3425 已撤回）。所以它退回地址栏：`?slice=1&business=250` 打开，省略或 0 就是正式规则。

**清干净的过程有一次没做完，这里记下来**：第一次只删了 `src/main.js` 里的渲染函数，
`index.html` 的 `<div id="sliceBusiness">` 与 `styles.css` 的 7 行 chip 规则还留着，
那个空 div 靠 `margin:8px 0 0` 仍占 8px —— 360×640 的「开一局」底边因此是 **781 > 基线 773**，
`layout-smoke` 判红。复核者在同一棵树上抓到并指出了这一点。

于是 `index.html` / `styles.css` **与已发布版 `528de72` 逐字节相同**（重签之后复核过：
`sha256(index.html)` = `b09ba9e3403ab60d…`，与 `git show 528de72:index.html` 相同；
`git diff --stat 528de72 -- index.html styles.css` 为空）：

```
$ git diff --stat 528de72 -- index.html styles.css
(空)
$ python3 support/compare/layout-smoke.mjs
390x844  cta [718,754] hitSelf=true      （基线同：757→现在 718，更靠上）
360x640  cta [737,773] hitSelf=false     （与基线逐像素相同）
1280x800 cta [480,516] hitSelf=true
PASS
```

**最终答案是：一条测试都不用改。** 第一版把三句起手文案放进 `src/data/slice.js` 的 `hook`
字段，于是 `test/trailing-slash.test.js` 的 sha16 常量与 `balance-3344-300.json` 绑定的
sha 都要跟着漂 —— 而这两处与本次玩法交付无关（supervisor 也明确要求候选只含玩法、
说明与相应证据，那条 HTTP 用例保持已发布状态）。

修法是把那三句搬进 `src/main.js` 的 `HOOKS` 常量（它本来就只在那里被渲染），
`slice.js` 回到与已发布版逐字节相同。于是：

```
$ sha256(src/data/slice.js) = 08e9670cdf1d8314…   （= 528de72）
$ sha256(index.html)        = b09ba9e3403ab60d…   （= 528de72）
$ sha256(styles.css)        = 与 528de72 相同
```

五条 HTTP/路径测试、`balance-3344-300.json` 与 `test/published-numbers.test.js` **全部保持
已发布状态**，本轮没有改动它们一个字。

## 3. 对照脚本不再依赖本机路径

新增 `support/find-chrome.mjs`，九个脚本从这里查找浏览器：

1. 显式 `CHROME=<path>`（说了算，指向不存在会直接报错，不静默降级）；
2. `PATH` 上的 `chrome` / `chromium` / `chromium-browser` / `google-chrome`；
3. puppeteer 缓存（`~/.cache/puppeteer/chrome*/*/chrome-linux64/chrome`，多版本取字典序末位）。

规则与 `support/full-game/run-full.py` 的 `find_chrome` 一致，两处不各记一套。

九个调用点包括五个
`support/compare/` 的 smoke，加四个早就写死同一条路径的老探针
（`probe-3334/geom.mjs`、`probe-3335/geom-lastday.mjs`、`probe-3338/geom.mjs`、
`probe-3338/settlement.mjs`）。只改新的五个会留下半截，所以九个一起换。

核对方式（在任何一台机器上都能跑，不含本机路径）：

```bash
# 拼出前缀再做扫描，避免这条命令本身被自己命中。
grep -rnE "/(home|mnt|Users)/" support/ tools/ src/ test/ \
  --include='*.mjs' --include='*.js' --include='*.py' --include='*.html' \
  | grep -v '为什么要有这个文件'
# 期望：空
```

（排除条件留的那一行是 `find-chrome.mjs` 里「为什么需要这个文件」的说明文字 ——
它解释的是**曾经**写死过路径这件事，本身不是被执行的路径。
`--include` 覆盖不到 `.md` 是有意的：文档里当然会讨论这些前缀。）

## 4. 发布提交

玩法交付为公开提交 `f109795`，直接接在 `528de72` 上。用固定提交比较本次玩家代码：

```bash
git diff 528de72 f109795 -- src index.html styles.css
```

玩家可见改动：

| 文件 | 玩家看到的 |
|---|---|
| `src/main.js` | 三句起手说明按手上实际拿到的卡写。争街说明区分人类座位与对手座位。开局和可选规则写回地址栏。 |
| `src/engine/flow.js` | 默认关闭的 `settleStreetBusiness`（一条街全归你时的每日进项） |
| `src/ui/slice.js`、`src/engine/market-ledger.js` | 侧栏与买地屏在**决定之前**说清这笔进项 |


## 5b. 补上复核指出的零覆盖（本轮新增）

复核 #3425 第一轮第 4 条：「672 条绿测试对这次唯一的玩法改动一句话都没说」。
现在 `test/street-business-increment.test.js` 有 9 条，咬四类局面（还差几间 / 停业中 /
已凑齐 / 这块地已在我的列表里）加身份与幂等。产品字节 0 改动。

判据是不是空的，由 `support/probe-3391/neg-control.sh` 证明 —— 它把三处实现各自改坏，
跑完按 sha256 断言产品字节已复原：

```
$ bash support/probe-3391/neg-control.sh
OK   未改动全绿
OK   身份恢复退化成换数组 -> 3 条红（测试咬住了）
OK   停业时那一行静默消失 -> 3 条红（测试咬住了）
OK   试算污染 state.properties -> 5 条红（测试咬住了）
RESTORED  src/engine/market-ledger.js 字节已复原
```

写这条测试时我自己写错了两处前提（以为「已有一间」会印「还差 1 间」；以为只停一条街时
侧栏会提它），两次都是我的预期错、不是产品错 —— 已在测试注释里记下可达条件。

## 5. 本片验证（全部实跑）

```
node --test test/*.test.js                       **681** pass / 0 fail（含本轮新增 9 条）
python3 support/full-game/check-delivery.py      PASS 435 entries, 36 lock bytes unchanged
python3 support/full-game/verify-receipt.py docs/evidence/receipt-3400-full
                                                 A–F 全过（E: tree 51a3fee7…；F: lock sha 73ce617c…）
python3 support/full-game/run-full.py            494–496 帧 / 66 按 / 3 次买地，VERDICT PASS
support/compare/layout-smoke.mjs                 PASS（390×844 / 1280×800 命中；360×640 同基线）
support/compare/entry-opening-smoke.mjs          PASS（真点开局单选；规则档关→第 2 天无进项，开→真入账）
```

整局回执 `docs/evidence/receipt-3400-full`，锁 `docs/evidence/slice-entry-3400.sha256`。
本节的 **681** 条按上面指定的 `test/*.test.js` 范围计数。

## 6. 不能引用 / 仍未解决

- 「争街比整条街更公平」—— 两个样本量下起手差距都不是零，README 已写明这与公平无关。
- 「两种打算」仍然不存在（见 `RESULT-3391u` §0）—— 本片不试图修它，只把已有事实说准。
- 360×640 首屏要整页滚一次才能点到「开一局」（底边 773，视口 640）是**基线既有**
  缺陷，本片没修；`layout-smoke` 只保证不变得更差。
