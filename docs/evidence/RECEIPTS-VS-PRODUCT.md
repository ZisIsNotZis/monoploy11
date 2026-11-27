# 回执对应的是哪一份产品字节

为什么要这份文件：回执能自证它自己的字节没被动过（`verify-receipt.py` 的 A/B 两项），
但它**不记录**当时跑的是哪一版产品。于是改一次产品字节之后，库里那些 PASS 会看起来
像是在为**现在**这棵树背书 —— 它们不是。

「当前」一列由 `docs/evidence/current-lock.txt` 决定，不是手写的判断：
`test/current-lock.test.js` 会核对这张表标「当前」的那一行确实就是指针点名的那把锁。
所以升级产品时这张表不会悄悄停在旧版本上（#3336 之前它正是这么停的）。

| 回执 | 播放的产品字节 | 当前 | 说明 |
|---|---|---|---|
| `receipt-3317-390` | `slice-entry-3278.sha256` 之前 | — | 记录的是 F6 扩到所有屏之后判红的那一次，判词是 FAIL，作为失败样本保留 |
| `receipt-3319-390` | `slice-entry-3278.sha256` 之前 | — | 无 raw/，已在 `UNVERIFIABLE.md` 登记为不可核对 |
| `receipt-3319i-tree` | `slice-entry-3278.sha256` | — | 当时用 `tree-after.sha256` 逐项核过 35 个产品文件，那份核对表未随交付发出 |
| `receipt-3320-390` | `slice-entry-3278.sha256` | — | 真 Chrome 423 帧 / 64 按，`VERDICT: PASS` |
| `receipt-3330-final` | `slice-entry-3330.sha256` | — | 起手开工现金改动后的一整局：415 帧 / 62 按，`VERDICT: PASS`（人类获胜），见 `RESULT-3330.md`。回执自己报 `NOT BOUND`（剪的时候还没有 `product` 字段）；这一行的锁是**对着那一版的字节核出来的**，不是它自报的 |
| `receipt-3331-final` | `slice-entry-3331.sha256` | — | **第一份真正绑定产品的回执**：`provenance.json` 带 `product.lock` / `product.lock_sha256` / `product.tree_sha256`，`verify-receipt.py` 的 E 项可从库里的锁文件重算；415 帧 / 62 按，`VERDICT: PASS`（人类获胜） |
| `receipt-3332-final` | `slice-entry-3332.sha256` | — | #3332 的整局回执，跑在它自己那把锁上（已不是当前产品）。修了「收购卡对空地也收 125% 溢价」（空地不再是合法目标），产品字节因此变了，所以重签锁并重跑。416 帧 / 62 按，`VERDICT: PASS`（人类获胜）。收购卡改了目标规则、平衡表逐位未变（45.7/32.0/34.7）。 |
| `receipt-3334-final` | `slice-entry-3334.sha256` | — | #3334 的整局回执，跑在它自己那把锁上（相对 3333 只改 `src/ui/slice.js` / `src/ui/render.js`，都是加盖屏那句话）。415 帧 / 62 按，`VERDICT: PASS`（人类获胜）。平衡逐位未变（45.7/32.0/34.7）。见 `RESULT-3334.md`。 |
| `receipt-3342-final` | `slice-entry-3342.sha256` | **当前** | #3342 的整局回执，跑在争街开局（`?slice=1&style=grow&seed=1&cross=1`）上：496 帧 / 66 按 / 3 次买地，`VERDICT: PASS`，结局是「人类落后 51,600」。它同时是**新入口真被打开过**的证明：`record-8-summary.json` 的 `entry` 字段保留着带 `cross=1` 的 URL。产品字节相对 3341 只改三个文件：`src/data/slice.js`（新增 `STARTS_CONTESTED`，默认路径不动）、`src/main.js`（`?cross=1` 接线 + 第一屏那句说明），`src/engine/economy.js`（只多一段注释，代码行一行未变 —— 这一条是 `git diff` 为空核出来的，不是自述）。见 `RESULT-3342.md`。 |
| `receipt-3341-final` | `slice-entry-3341.sha256` | — | #3341 的整局回执，跑在当前锁上，415 帧 / 62 按，`VERDICT: PASS`（人类获胜），`kinds` 含 `build` / `buy` / `diceValue` / `direction`。产品字节相对 3340 只改一个文件 `src/engine/insight.js`：选落点那一屏不再报「此刻做不起」的金额 —— 做不到的那一行自己写「还差 N」或「· 现金不够，会破产」，做得到的不加字。根因是 supervisor 的真局：穿街高手 seed 1 第 13 天现金 20,000，屏上写「街心书屋：你的店 Lv.2 · 停在这里可加盖 30,000」，走过去按钮按不动（`buildPlot` 第一句 `if (p.cash < cost) return;`）。实测 120 局：4,634 个点选项里 223 行是这种（加盖 176 / 买地 22 / 付租会破产 25），其中加盖那 176 行 176/176 是该行最大的数、21 行是该点数下唯一信息；改后 0 行。同一片顺带修了交付文档里三处指向不存在路径的复现命令（判据 `test/shipped-doc-paths.test.js`）。见 `RESULT-3341.md`。 |
| `receipt-3340-final` | `slice-entry-3340.sha256` | — | #3340 的整局回执，跑在当前锁上，415 帧 / 62 按，`VERDICT: PASS`（人类获胜），本局真走过定步屏（`kinds` 含 `diceValue`）。产品字节相对 3339 只改一个文件 `src/engine/insight.js`：落点屏/岔路屏上**自己的店**不再印「己方 · 租 N」，改说引擎真会做的事（`你的店 Lv.N · 停在这里可加盖 M`；到顶或停业时写「自己停在这里不收租」）。根因：引擎在自己的店旁只问加盖、从不收租（`flow.js` 付租分支第一句 `if (owner?.team === p.team) { …; continue; }`），而屏上把 `rentFor` 印成了「我的落点收益」——实测 25.1% 的点选项含这一行，其中 89.7% 是那个点数下最大的数、33% 是唯一信息。判据 `test/landing-own-shop.test.js`（7 条，含负对照）。见 `RESULT-3340.md`。 |
| `receipt-3339-final` | `slice-entry-3339.sha256` | — | #3339 的整局回执，跑在当前锁上，416 帧 / 62 按，`VERDICT: PASS`（人类获胜）。产品字节相对 3338 只改一个文件 `src/ui/render.js`，只改一句：买地屏「账面约 7 回合回本」→「按这个价收到 7 次才够本（租金只在对手停到这块地上时收，不是每回合收）」。根因是单位：引擎在 `flow.js:659` 只在 `landingPhase` 写「实付租金」行，从来没有「每回合收租」；旧句把「要收几次」叫成「几回合」，而同一屏下面那张 72 局表说这间书屋整局平均实收 11,948（26,000 的 46%）。监管者在 390×844 真机上确认改后两句能同时读懂、两键仍可点。判据 `test/midgame-buy.test.js` 改成钉「次」并禁用「回合回本」。见 `RESULT-3339.md`。 |
| `receipt-3338-final` | `slice-entry-3338.sha256` | — | #3338 的整局回执，跑在当前锁上，415 帧 / 62 按，`VERDICT: PASS`（人类获胜）。产品字节相对 3337 改了四个文件：新增 `src/engine/market-ledger.js`（买地这一笔的整局账，买地屏与结算屏共读这一份），`src/ui/render.js`（买地屏不再拿「全场租金池」去比一笔**资产换手**），`src/ui/slice.js`（结算屏不再叫玩家自己走到自己店旁边收租；书屋加盖价从 15,000 改成引擎真扣的 30,000），`styles.css`（「下局试试」与「再开一局」打成一个 sticky 条）。同一份锁里还修了复核时抓到的两处：买不起时不再算负数（原来印「现金 13,000 → -13,000」「够付 -3 次」），终局停业时旺季那句不再写「0 变 0」。引擎结算未动。回执的 seal 覆盖 **36** 个响应，含新增的 `src/engine/market-ledger.js`。见 `RESULT-3338.md`。 |
| `receipt-3337-final` | `slice-entry-3337.sha256` | — | #3337 的整局回执，跑在它自己那把锁上（已不是当前产品），416 帧 / 62 按，`VERDICT: PASS`（人类获胜）。产品字节相对 3335 只改两个文件：`src/ui/slice.js`（结算屏那句「下局试试」从三条写死句改成从本局 state/log 算出来的一句）与 `styles.css`（结算屏底部留白 62→116px）。平衡逐位未变（引擎未动）。新增判据 `F4 nextGameVisible` / `nextGameNotEmpty`，并有负对照：把留白改回 62px，同一条判据变红（见 `RESULT-3337.md`）。 |
| `receipt-3336-final` | `slice-entry-3335.sha256` | — | #3336 的整局回执，跑在当前锁上，416 帧 / 62 按，`VERDICT: PASS`（人类获胜）。它带 `seal` 字段：**35 个响应逐一**与锁逐字节相同且 `no-store`，读者拿回执就能重算（`verify-receipt.py` F 项）。旧的 `receipt-3335-final` 仍在库里，但那一句 SEALED 比的其实是 3334 的字节（见它那一行）。 |
| `receipt-3335-final` | `slice-entry-3335.sha256` | — | #3335 的整局回执（414 帧 / 62 按，`VERDICT: PASS`）。E 项经得起复核（它从锁重算树指纹），**但它当时那句 SEALED 是错的**：`verify-http.py` 还停在 3334，且只核 5 个样本文件、不含 3335 唯一改过的 `src/ui/slice.js`。保留它是因为 #3335 的结论（最后一天那句承诺）自己有独立证据；但引用字节封印时请引 `receipt-3336-final`。见 `RESULT-3336.md`。 |
| `receipt-3333-final` | `slice-entry-3333.sha256` | — | #3333 的整局回执，跑在它自己那把锁上（相对 3332 只改 `insight.js` / `slice-ai.js` / `render.js`）。修了两处：①「每局约 +N，另压对手 M」把已在 N 里的 M 又印一次、且两个单位不同；②AI 的收购候选集 ⊃ 引擎合法集，导致 seed 173 那一局**永远走不下去**。415 帧 / 62 按，`VERDICT: PASS`（人类获胜）。平衡逐位未变（45.7/32.0/34.7）。见 `RESULT-3333.md`。 |

判据由 `test/receipt-product-binding.test.js` 咬住：
**每一份在库回执都必须在这张表里出现**，而且点名的那把锁必须是库里真实存在的文件。
新加一份回执却不登记它对应哪版产品 → 红。

两张历史锁因此必须随检出走：`slice-entry-3278.sha256` 与 `slice-entry-3330.sha256`。
之前 3330 那份只活在 git 历史（`b8bc9cb`）里，于是这一行的锁在干净检出中**不存在**，
读者无从核对——而那正是这张表存在的意义。#3331 把它作为 `doc` 收进交付集。
（3328→3330 之间 `slice.js` 只改了注释，所以两把锁下的对局行为相同；但**字节不同**，
所以 `receipt-3330-final` 不能记在 3331 名下。）

## 这张表原本有个洞，`#3331` 补上了

这张表说了「哪份回执对应哪把锁」，但**回执自己并不知道**。跑整局的目录 `OUT-*/` 是被
gitignore 的，事后就被清掉了；于是除了这张手写的表，盘上没有任何东西把一份 PASS 连到
某一版产品字节上。更糟的是 `test/receipt-product-binding.test.js` 里有一句

```js
if (receipt.includes('3330')) continue;      // 本轮新跑的回执在跑完后补行
```

—— 刚好把 `#3330` 新加的那份回执豁免掉了。判据在它最该咬的那一份上闭上了嘴。

`#3331` 把绑定做成回执的**自带属性**，而不是表里的文字：

- `run-full.py` 写 `OUT/product.json`：用的是哪把锁、锁文件的 sha256、以及一个对
  **实际服务出去的每个文件 (path, sha256)** 算出的 `tree_sha256`。
- `make-receipt.py` 把 `product.json` **原样**抄进 `provenance.json`（不重算 ——
  会重算的裁剪器无法告诉你「原始记录被改过」）。
- `verify-receipt.py` 新增 **E 项**：拿库里的锁文件重算 `tree_sha256`，与回执记的比。
  不符就 FAIL。没有 `product` 字段的老回执报 **`NOT BOUND`**，不报 PASS。

一个自己踩到的坑：第一版 E 用 `''.join(sorted(pairs))` 算 `tree_sha256`，而锁文件本身
就是按字节排好序的 —— 于是这个「树指纹」**正好等于锁文件的 sha256**，E 在拿一个数跟它
自己比，永远不会因为「字节变了」而红。改成带域前缀、长度前缀的规范记录后两者才独立。
这不是读出来的，是跑出来的。

反过来也要说清：这张表**不证明**旧回执描述的行为现在仍然成立。它只回答
「那份 PASS 是对着哪棵树说的」。产品改了，旧回执就只是历史，不是现状。
