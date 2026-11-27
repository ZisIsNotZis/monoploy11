# #3322：授权判「真正打开的那个文件」，不是两份字面路径

## 结论

`support/serve-variant.py` 现在对每个请求做**一次**规范解析，授权与响应共用同一个
结果；解析不出来就 404，不看盘上有没有占位文件。两种旧的越权形状都有常设测试钉住：

| 形状 | 旧行为 | 现在 |
|---|---|---|
| 白名单里的 URL，其**父目录**被换成仓内符号链接 | 200，发出诱饵目录里的同名文件 | 404 |
| 白名单里的 URL 在盘上解析失败，而根上恰好有 `__invalid_path__` | 200，发出哨兵文件内容 | 404 |
| 正常请求（正向对照） | 200 | 200 |

前两条是同一类毛病的两种摆法：**判定用的路径和真正打开的文件不是同一个值**。
上一轮（#3320b）的四条判据是「URL 在册 / abspath 在仓内 / 最后一段不是链 / 是文件」——
四条可以同时成立，而父目录是符号链接时，发出去的字节仍不是白名单里那个文件。
另一个形状是「解析失败」：`translate_path` 把失败换成 `ROOT/__invalid_path__` 哨兵，
落不落到 404 取决于**仓库根恰好没有**这个文件 —— 拦截依赖一个「恰好」。

> 上表的「旧行为」一列是改之前实测过的记录，不是发布树里能重跑的东西：
> 那需要一个专门把旧实现装回去的对照脚本，它只服务于这一轮取证，不入发布树。
> 发布树里留下的是**合同**：`test/serve-variant-identity.test.js` 问的是
> 「现在的实现是否只发白名单文件」，与旧实现怎么写无关。

## 改法：一次解析，两个用途

`support/serve-variant.py`

- `_strict_realpath()`：`os.path.realpath(path, strict=True)`，父目录也解析；
  `ENOENT` / `ELOOP` / `ENOTDIR` 一律返回 `None`。Python < 3.10 没有 `strict`，
  退化成「自己查存在性」，语义相同。
- `resolve_servable_file()` 加了第三条判据：解析结果必须**等于**「真根 + 同一个相对路径」。
  两边是同一个值才放行 —— 注意不能把允许集合也做成 realpath 再和请求的 realpath 比，
  那样父目录被换时两边同样同值，判据永远为真（这正是 #3320b 第一版踩过的坑的同一个形状）。
- `Handler._resolve()` 把一次请求的解析结果缓存下来，`translate_path()` 和
  `send_head()` **共用**它。`send_head()` 在解析失败时直接 404，不进父类，
  于是没有第二次解析、也不再看盘上有没有占位文件。
- `INVALID` 哨兵还在（`translate_path` 的返回类型要求一个字符串），但它已经
  **不承担拦截**：`send_head` 在解析失败时先返回，父类根本没机会去开那个文件。
  `_deny_blocked()` 里对应的注释也一并改成「这一层现在是冗余的」。

## 常设判据

`test/serve-variant-identity.test.js`（随检出走，`node --test` 里跑）把三种形状钉住，
用**临时假根**，不改真仓库的目录结构：

1. 父目录换成**仓内**符号链接 —— 这条最要紧，因为指向仓外的链已被 `_inside_root` 拦住，
   只有指向仓内别处的链才能区分「在不在仓里」与「是不是同一个文件」。
   测试同时断言诱饵文件在盘上、最后一段本身不是链、`_inside_root` 旧判据确实放行 ——
   少了任一条，否定断言会因为别的原因通过，看起来一样绿。
2. 解析失败 + 根上有内容可辨认的 `__invalid_path__` 哨兵 —— 断言 `send_head` 直接 404、
   不交出可打开的路径。同样带前置「哨兵确实在盘上」。
3. 正向：假根里四个白名单入口都还发得出去（收口没把自己堵死）。

## 真实入口：31 个资源、含 29 个产品模块

`support/compare-entry-smoke.py` 起真的 8001，打开 `/af-variant.html`，解析页面里的
`src`/`href`，再顺着每份 JS 的 `import` 递归取。输出是完整清单而不是一句话：

```
port=48249  入口实际取到 31 个资源：
    200  /af-variant-inject.js
    200  /src/data/bosses.js
    …（29 个产品模块）
    200  /src/main.js?v=150
    200  /styles.css
SMOKE: PASS
```

这个脚本自己被抓到两次，两次都是「量具在说假话」：

1. 第一版判后缀用 `url.endswith('.js')`，而入口给的是 `/src/main.js?v=150`（缓存串），
   于是递归**一次都没开始**，只取到 4 个资源就打了一行 `SMOKE: PASS`。
   修法：判后缀先去掉 query。
2. 修好之后仍然只有一行 PASS —— 因为统计输出被一次范围替换吃掉了，
   4 个资源也能绿。所以加了 `MIN_RESOURCES = 30` 这条**下限判据**：
   少于 30 就直接 FAIL，并在消息里写明「import 递归没发生，这条 PASS 不能当作
   页面能跑的证据」。递归被绕开时，现在会红而不是安静地绿。

## 复验（本机刚跑）

```bash
node --test                                                   # 570/570
python3 -B support/full-game/check-delivery.py                # DELIVERY: PASS（35 项字节锁未变）
python3 -B support/compare-entry-smoke.py                     # SMOKE: PASS（31 个资源）
CLEAN_TMPDIR=… python3 -B support/full-game/clean-checkout.py # CLEAN CHECKOUT: PASS
```

干净检出的关键行：`copied … named files + … test files`、
`checkout holds only delivered files (… named, none extra)`、`suite failures reported: 0`、
`VERDICT: PASS`（471 帧 / 61 按）。也就是说，本轮的证据脚本与结论文档
在**只有交付文件**的目录里也能跑 —— 这是 #3319 判「不可核对」时缺的那一条。

`support/serve-variant.py` 不在 35 项字节锁里（`slice-entry-3278.sha256` 只锁
`serve.py` 与 34 个产品文件），所以这一轮不需要重签交付锁。玩家看到的字节没有变化：
这一轮改的是对照页服务器的授权，不是游戏。

## 边界 / 未做

- **`serve.py`（8000 产品入口）没有同样的收口**。它仍有目录列表泄漏（`/support/`、`/docs/` 200
  且是列表），也仍然用「哨兵不存在所以 404」的形状。它在 35 项字节锁里，动它要重签整份锁与
  回执 —— 这是上一轮就登记过的有意取舍，本轮**没有改变**这个决定。
- 只验了本机 HTTP；没有在 Windows 的 `ntpath.realpath` 上取证「父目录大小写别名」那一层
  （本机 realpath 不归并大小写，`test/blocked-prefix-layers.test.js` 已把这条前提测出来并跳过）。
- 推送仍在常设边界之外。
