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
| `receipt-3338-final` | `slice-entry-3338.sha256` | **当前** | #3338 的整局回执，跑在当前锁上，415 帧 / 62 按，`VERDICT: PASS`（人类获胜）。产品字节相对 3337 改了四个文件：新增 `src/engine/market-ledger.js`（买地这一笔的整局账，买地屏与结算屏共读这一份），`src/ui/render.js`（买地屏不再拿「全场租金池」去比一笔**资产换手**），`src/ui/slice.js`（结算屏不再叫玩家自己走到自己店旁边收租；书屋加盖价从 15,000 改成引擎真扣的 30,000），`styles.css`（「下局试试」与「再开一局」打成一个 sticky 条）。同一份锁里还修了复核时抓到的两处：买不起时不再算负数（原来印「现金 13,000 → -13,000」「够付 -3 次」），终局停业时旺季那句不再写「0 变 0」。引擎结算未动。回执的 seal 覆盖 **36** 个响应，含新增的 `src/engine/market-ledger.js`。见 `RESULT-3338.md`。 |
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
