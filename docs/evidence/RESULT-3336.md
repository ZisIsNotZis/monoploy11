# #3336：回执索引的缺口，根子是「当前锁」有三份副本

Supervisor 报的是一句话：干净候选里 `receipt-3335-final` **没登记**，而旧条目还自称「当前版本」，
仓里原有的 `receipt-product-binding.test.js` 因此直接红。发布前把索引对齐。

对齐之后我去找**为什么**会漏：如果只是忘了写一行，那补一行就完了。结果补不起 —— 缺行是症状。

## 事实（都可重跑）

三个会封印或播放产品字节的工具，各自写死了一份「当前锁」：

```
run-full.py:40        LOCK = ROOT / 'docs/evidence/slice-entry-3335.sha256'
check-delivery.py:24  LOCK = ROOT / 'docs/evidence/slice-entry-3335.sha256'
verify-http.py:22     LOCK = HERE.parent.parent / 'docs/evidence/slice-entry-3334.sha256'   ← 停在上一版
```

`verify-http.py` 自己的注释就写着「这一行必须与 run-full.py 的 LOCK 同步 —— 只改一个就会出现
『整局跑在新树上、字节校验却对旧锁』」。它说的正是后来发生的事。

于是 `docs/evidence/receipt-3335-final/` 里那句

```
SEALED bytes+no-store
```

比的是 **3334** 的字节。而且还有第二层洞，独立的：

```python
CHECK = ['index.html', 'styles.css', 'src/main.js', 'src/ui/render.js', 'serve.py']
```

3334→3335 **只改了一个文件**，`src/ui/slice.js` —— 五个样本里没有它。所以即便锁指对了，
那一步也看不见这次改动。

两处都能用跑出来的对照证明，不是读代码猜的：

```
$ # 合法锁树，改一个字节（src/ui/slice.js），旧脚本：
$ python3 <旧 verify-http.py> /tmp/lockneg3336 8733
SEALED bytes+no-store                      ← 一棵被改过的树被判 SEALED
$ # 同一棵树，新脚本：
$ python3 support/full-game/verify-http.py /tmp/lockneg3336 8732
src/ui/slice.js: "DIFFERS" ...
NOT-SEALED (1 of 35 files failed)
```

**范围要说清**：E 项没有受影响。它从锁文件重算 `tree_sha256`，与那次 HTTP 比对无关，
所以 `receipt-3335-final` 的「跑的是哪一版」仍然成立。错的只是被引用得最多的那一句
「浏览器收到的就是锁里的字节」。A–D 也不受影响。

## 修法

1. **当前锁只留一个指针**：`docs/evidence/current-lock.txt`（一行），解析在
   `support/full-game/lockfile.py`。`run-full.py` / `check-delivery.py` / `verify-http.py`
   都从它取，锁文件的解析也只有一份（`lockfile.entries`）。
2. **封印改成核整把锁**，不再抽样：35 个文件逐一 fetch、逐一报 `SAME/DIFFERS`。
   抽样不能封印一棵树，只能抽查；#3335 就是被抽查漏掉的。
3. **把封印结果变成回执的一部分**：`serve.py` 那一步现在写 `served-seal.json`
   （每个响应的完整 sha256、字节数、`no-store`），`make-receipt.py` 原样抄进
   `provenance.json` 的 `seal` 字段，`verify-receipt.py` 新增 **F 项**从锁重算。
   旧的 `verify-http.txt` 只保留 12 位十六进制，读起来够用，核不了。
4. **索引里「当前」不再是人写的判断**：`RECEIPTS-VS-PRODUCT.md` 加了一列，
   由 `test/current-lock.test.js` 核对「标当前的那一行 = 指针点名的那把锁，且恰好一条」。
5. **`receipt-product-binding.test.js` 自己也有第三份副本**（`slice-entry-3333.sha256`
   写死两处），产品一升级它就会对旧锁报绿。已改成读指针。

## 判据（先红后绿）

| 判据 | 红的样子 |
|---|---|
| `test/current-lock.test.js` 5 条 | 写回字面锁名 → 红；索引标两条「当前」→ 红；解析器忽略指针 → 红 |
| `test/lock-seal-coverage.test.js` 1 条 | **跑**封印脚本：合法树必须 `SEALED ... all 35 lock files`，改一个字节必须 `NOT-SEALED` |
| `test/receipt-product-binding.test.js` 5 条 | 新回执不登记 → 红（supervisor 看到的那条） |

第 2 条我特意写成跑进程而不是读文本：旧脚本的文本看不出「5 个样本够不够」，
只有让它去核一棵改过的树才现形。写完先拿 `git show HEAD:` 的旧脚本跑了一遍，确认会红，再换回新版。

中途自查到两个自己的错，都留在这里而不是改掉就算了：

- F 项第一版把锁文件的行解析成 `(path, sha)` —— 实际是 `(sha, path)`。它报「服务过的集合与锁
  不一致」，错的其实是解析器。跑一次就露了。
- 索引里「当前」这一列第一版手写在 3332 那行，而指针是 3335 —— 同一种病又长出来一次，
  所以它最终是由测试比对指针，不是由我记。

## 证据

- 新回执 `docs/evidence/receipt-3336-final/`（390×844 真鼠标跑到结算，416 帧 / 62 按，人类获胜，
  `recomputed gap 0`）。`verify-receipt.py` **A–F 六项全过**：

```
A  files    3 slim + 3 raw present, sizes and hashes match
B  raw      decompressed bytes hash to the sha256 provenance claims for the raw run
C  cut      slim files are exactly the raw record minus the declared dropped fields
D  judge    VERDICT: PASS -- same verdict from the receipt and from its shipped raw bytes
E  product  ran exactly docs/evidence/slice-entry-3335.sha256 (35 files, tree 422d75de06275133), and that lock is unchanged on disk
F  seal     35 responses matched the lock byte-for-byte with no-store (docs/evidence/slice-entry-3335.sha256, lock sha 8e9c5b98931a)
```

- 负对照：把 F 里一个响应的 sha256 改一位 → `FAIL F seal served bytes differ from the lock for ['src/ui/slice.js']`。
- `receipt-3335-final` 现在如实报 `F NOT RECORDED`（剪它的时候还没有这个字段），
  而不再有任何东西暗示它的字节封印成立。索引里那一行也这么写了。
- `node --test` **618/618**（新增 5 + 1 + 若干）；`check-delivery.py` PASS；封印脚本对
  合法树/篡改树各跑一次（见判据）。

## 没做到 / 不能证实

- **玩家感受仍未证实。** 这一片一个字的玩法、平衡、屏上文案都没动：35 个产品文件的字节
  与 3335 完全一致（`current-lock.txt` 指的还是同一把锁），所以平衡表逐位不变是**构造上的**，
  不是又测了一遍。
- **`receipt-3335-final` 的字节封印无法追溯修复。** 那一步当时到底给浏览器发了什么，
  证据已经不在（`OUT-3335/` 不入库，`verify-http.txt` 只有 12 位）。我选择保留它、写明它错在哪，
  而不是删掉或重写它。
- **F 项证明的是「这一次运行里 serve.py 回的字节 = 锁里的字节」**，不证明浏览器真的执行了
  这些字节：那由 F 之外的那一整局（帧、按键、结算）间接支撑。
- 锁的指针仍有一个人工步骤：签新锁时要记得同时改 `current-lock.txt`。忘了会红
  （指针点名的锁还在库里，但绑定的回执会对不上），但红的位置是回执，不是签名的那一刻。
