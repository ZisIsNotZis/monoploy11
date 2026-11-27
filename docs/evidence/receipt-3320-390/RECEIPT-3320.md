# #3320：对照入口的隔离要对「将来的文件」成立；回执要能定位来源并核对

这一轮修的是**证据本身**，不是游戏玩法：一次「哪些文件能被发出去」的收口，
和一次「回执从哪来」的收口。两条都是被实测的现状逼出来的，不是假设的风险。

## 1. 对照入口（8001）：前缀白名单 = 范围小一点的黑名单

上一版把 `/src/` **整段前缀**放行。它的注释写着「白名单」，但形状还是黑名单：
之后任何落进 `src/` 的文件都会**自动**变成可下载，没有人需要再为它做一次决定。

实测的现状（不是推测）：

| 路径 | 改前 | 说明 |
|---|---|---|
| `/src/debug/session.js` | 200 | 调试会话，能驱动真实引擎 |
| `/src/sim.js` | 200 | 测试模拟器 |
| `/src/debug/` | 200 + **目录列表** | 把有哪些文件全列出来 |
| `/src/data/maps/` | 200 + **目录列表** | 同上 |

**改法**（`support/serve-variant.py`）：

1. `SERVABLE_MODULES` 逐文件列出 29 个产品模块；`SERVABLE_PREFIXES = ('/src/',)` 删掉。
   发一个新文件需要有人改这一行 —— 那是一次有意的决定，而不是目录内容的副作用。
2. 重写 `list_directory()` 让它直接回 404。目录列表是**另一种**泄漏：
   白名单判的是「这个 URL 该不该发」，而目录根本不在名单里，所以它一路走到父类的
   列目录分支。先列一遍、再点名取，等于把「以后该不该发」的答案提前告诉任何人。

**改名册不靠手抄**：`test/serve-variant-allowlist.test.js` 顺着真实 import 图走一遍，
与 `SERVABLE_MODULES` 逐条比对 —— 产品加模块忘了登记，测试**红并指名缺哪个**，
而不是页面悄悄少一个文件。

### 判据咬不咬人（都实测过）

| 把防护改回去 | 结果 |
|---|---|
| `is_servable` 改回 `startswith('/src/')` | 2 条红（「将来的文件」+「调试会话」） |
| 删掉 `list_directory` 整个函数 | 只有**新增的直接单测**红 |

第二条是我自己抓到的量具缺陷：**HTTP 层咬不住 `list_directory`**。
`/src/debug/` 这类路径在 `is_servable` 就被拒了，根本走不到列目录分支 ——
「删掉防护」和「保留防护」在 HTTP 层长得一模一样。所以补了一条直接考这个函数的测试
（Fake handler 问它「请求目录时你发什么」，必须是「什么都不发」+404）。

### 1b. 落盘目标也要判（#3320b）

上一版只问「URL 在不在白名单」，然后把两个分支各自算出的路径**直接返回**：
`/.scratch/x` 走 `compare_fallback` 时提前 `return`，绕过了后面的 `..`、仓内前缀、
`_blocked_realpath` 三道；其余路径也只做了 abspath 前缀检查。
于是「URL 白名单」与「实际发出去的字节」不是同一个集合 ——
一个符号链接就能让白名单里的名字发出白名单外的内容。

现在收口的是**最终文件**：`resolve_servable_file()` 是唯一的落盘判定，所有分支都必须经过它，
要求真路径在仓内、没被拦、**不是符号链接**、而且正好是允许发的那几个文件之一。

实测（都做过）：

| 攻击 | 改前 | 改后 |
|---|---|---|
| `.scratch/af-variant.html -> /etc/passwd` | 会发 | 404 |
| `.scratch/af-variant.html -> ../README.md`（仓内互指） | 会发 | 404 |
| `/` （入口本身） | 200 | 200（`/` 显式翻成 `/index.html`） |

两个自己踩的坑，都记在测试注释里：

1. **第一版用 realpath 建「允许集合」，再把请求的 realpath 拿去比。** 链到 `/etc/passwd` 时
   两边算出同一个值 ⇒ 判定「匹配」，永远为真。这是自己跟自己比的判据。现在用 abspath 建集合，
   符号链接另用「链本身拒 + realpath 出仓拒」两道阻。
2. **第一次攻击测试是空转的**：我拿 `support/compare/af-variant.html` 去链，
   但 `/.scratch/` 里有同名副本会先被取，那个文件根本不是被服务的对象。
   改测试去链**真正会被服务**的那个路径，才验到东西。

第一条攻击（仓外）由 `_inside_root` 的 realpath 拦住；第二条（仓内互指）只能靠
`islink` —— 实测把 `islink` 改成 `False`，这条测试就红，另一条仍绿。

## 2. 精减回执：能重判 ≠ 能核对

`receipt-3319-390/provenance.json` 写着 `source_run: OUT-3319-final` 和三个 raw sha256。
实测三条：

1. **它自己的数字是对的**：committed slim 文件与 `slim` 哈希逐项一致（89,830 / 588 / 90）。
2. **它点名的来源不存在**：`OUT-3319-final` 在任何地方都没有。
3. **raw 哈希对不上盘上任何一次运行**：把 `OUT-*` 逐个按同一规则切一遍，一次都没命中；
   全工作区也没有 317,097 字节的那个文件。而它是 `cross`/seed=2（425 帧），
   所有还活着的 `OUT-*` 都是 `grow`/seed=1 ⇒ 它来自一次**已被清理删除**的运行。

`OUT-*/` 在 `.gitignore` 里，所以「回到原始记录去反对这次剪裁」这条路从清理那天起就断了。
回执仍然能被 `report-full.py` 判 PASS —— 这正是最坏的那种安心：**能重判，不能核对**。

### 改法

- `make-receipt.py` 把 raw 字节用 gzip **一起发进回执**（`raw/<name>.gz`，317 KB → 约 16 KB），
  `provenance.json` 同时记 gzip 的 sha256 与**解压后**字节的 sha256。
- 新增 `verify-receipt.py`：只拿回执就能核
  A 文件在不在、大小/哈希对不对 →
  B 解压后的字节是否等于声明的 raw 哈希 →
  C slim 是否**正好是** raw 减去声明的丢弃字段 →
  D 判词是否与「用随附 raw 重建再判一次」一致。

C 是关键：只做 B 的话，剪裁可以偷偷多剪到某个判据变成 SKIP，而 B 照样绿。

### 这一轮新交付的三份回执

| 回执 | 来源 | 为什么收它 |
|---|---|---|
| `receipt-3319i-tree` | `OUT-3319i-cross` | 它的 `tree-after.sha256` 35 个文件与交付锁**逐个相合**（实测 `mismatches: NONE`）⇒ 「交付的那棵树」真的打完了一整局。424 帧 / 64 按 / PASS |
| `receipt-3320-390` | `OUT-3320-final`（本轮新跑） | 真 Chrome 跑完的一整局：423 帧 / 64 按 / PASS |
| `receipt-3317-390` | `OUT-Y3317-390`（源还在） | 重切后与已发 slim **逐字节相同**，补上了 raw/*.gz。它是一次**真 FAIL**（F6），那正是 #3319 故意判红的那次 |

`receipt-3319-390` 保留，但加了 `UNVERIFIABLE.md`：原始记录已被删除，既补不回来，
也不该重跑一局去冒充它。`test/receipt-provenance.test.js` 要求任何没有 `raw/` 的在库回执
**必须**带这份说明，否则测试红 —— 缺口可以被登记，不能被忘记。

### 一个自己写错、被自己抓到的判据

`verify-receipt.py` 第一版 D 项要求「判词必须是 PASS」。于是它把 `receipt-3317-390`
判成「不可核对」—— 而那份是**诚实 FAIL** 的回执。FAIL 的回执是合法来源：
它说的是「这次运行失败了，字节在这」。改成「cut 没改变判词」（slim vs 随附 raw 各判一次，
两个判词必须相同），PASS 与 FAIL 都成立。

## 3. 复验（都在本机刚跑）

```bash
node --test test/*.test.js                                    # 566/566
python3 -B support/full-game/verify-receipt.py docs/evidence/receipt-3320-390   # PROVENANCE: PASS
python3 -B support/full-game/verify-receipt.py docs/evidence/receipt-3319i-tree # PROVENANCE: PASS
python3 -B support/full-game/verify-receipt.py docs/evidence/receipt-3317-390   # PROVENANCE: PASS（判词 FAIL，与 raw 一致）
python3 -B support/full-game/check-delivery.py                # DELIVERY: PASS（94 项）
CLEAN_TMPDIR=… python3 -B support/full-game/clean-checkout.py # CLEAN CHECKOUT: PASS（含整套回执自证）
```

**离开源目录也成立**：`support/full-game/OUT-3320-final` 已**真的删掉**后重跑，
`PROVENANCE: PASS`。这正是用户遇到的那个场景。

### 交付形状：必须是 fast-forward，不能删掉公开版已有的文件

第一次建提交用 `--parent`，它的树**就是**清单 —— 于是公开版已有的
`.gitignore`、`.nojekyll`、`docs/0_STAGING.md`、`docs/1_PROBLEM.md`、`docs/4_USECASE.md`、
`tools/tts.py` 全部从提交里消失了（`git diff` 显示 6 个 `D`），而 README 还写着「`.nojekyll` 已放置」。

`make-candidate.py` 早就有能避开的形状：`--onto BASE` 从 BASE 的树开始铺清单，
所以**不会丢文件**，并且它自己会把「只因为 BASE 有而存在的文件」列出来。
现在用的是 `--onto release/3319-picker`：实测 `deletions=0`，六个文件都在。

## 4. 未做 / 边界

- **`serve.py`（8000 产品入口）也有同样的目录列表泄漏**：实测 `/support/`、`/docs/` 200 且是列表。
  它**在 35 项字节锁里**（`slice-entry-3278.sha256`），动它要重新签发整份锁与交付，
  所以这一轮没有动 —— 这是一次有意的取舍，不是遗漏。
- 对照页的隔离只验了本机 HTTP 与本机 Chrome；iOS Safari 未覆盖。
- 推送仍在常设边界之外。
