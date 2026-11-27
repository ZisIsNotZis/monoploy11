# 对照入口、路径归一体检、以及 8000 侧的污染（已堵）

本文记录的是 2026-11-20 那次对照实验的结论与风险。

**能不能复现**（#3341 更正）：本文开头原先写「全部读数都能用 `tools/verify-grow-panel.mjs` 复现」
—— 那个文件在本仓历史上从未存在过（`git log --all -- tools/verify-grow-panel.mjs` 为空），
所以那句话从第一天起就敲不出来。现在拆成两半，各说各的：

| 结论 | 今天怎么核 |
|---|---|
| 那处注入会改到引擎读的那一份 `SUPPLIES`（模块实例唯一） | `node support/probe-3341/variant-diff.mjs`，可跑 |
| 8001 服务对照页、8000 一律拦 `.scratch` | `node --test test/blocked-*.test.js test/serve-variant-*.test.js`，可跑 |
| 浏览器里两边 grow 面板文本不同（下文 §3 的输出） | **历史读数，本次未复跑**——那次的现场没留在仓库里。要重做得自己起两个入口，按 §3 的前置条件用手看 |

下文保留原文，包括当时的输出与网址（它们记录的是那次实验的现场，不是今天的入口）。

---

## 1. 两个入口

| 用途 | 地址 |
| --- | --- |
| 原版 | `http://127.0.0.1:8000/` |
| 对照版 | `http://127.0.0.1:8001/.scratch/af-variant.html` |

注意：8001 的**根路径**与原版相同。不要把「8001」当成「对照版」，只有那个带 `.scratch` 的路径是对照页。

---

## 2. 对照到底改了什么

grow 补给包的两张卡从 `翻修 + 旺季` 改成 `旺季 + 旺季`，改的是玩家在「这三天，你想怎么做？」面板上能直接看到的文本（`src/ui/render.js:301` 直接渲染 `o.name` / `o.desc`）。

接口会改到 `src/data/slice.js` 的 `SUPPLIES` 对象（运行时覆盖，不碰文件）：

```js
// .scratch/af-variant-inject.js
import { SUPPLIES, SLICE_CARDS } from '../src/data/slice.js';
const grow = SUPPLIES.find(i => i.id === 'grow');
if (grow) {
  grow.cards = ['inflate', 'inflate'];
  grow.desc = `${SLICE_CARDS.inflate.name} + ${SLICE_CARDS.inflate.name}…`;
}
```

它与 `src/main.js` 引用的是同一个模块实例（两边都解析到 `/src/data/slice.js`），所以 `src/engine/flow.js` 读到的也是改过的那份。

---

## 3. 当时那一次的运行（**历史读数，本文未复跑**）

> #3341：这一段原本写的是一条命令 `tools/verify-grow-panel.mjs`。那个文件在本仓从未存在过，
> 所以下面这一整套「它会自己起两套静态服务…」描述的是一个不在仓库里的工具，读者无法照做。
> 保留原文是因为**当时的输出是真的**（它就是下面那段对比表），但它是一次手做的实验，不是一键复现。
> 今天能跑的两条已挪到本文开头的表；要做到这一段描述的事，得按下面四个前置条件自己起两个入口用手看。

原来的描述：它会自己起两套静态服务（8100 原版 / 8101 对照，**不碰 8000/8001**），用真浏览器各开一局、各掷几次骰、走到第一次补给面板，比对 grow 那一项的文本。

**前置条件**

1. Node 22+（脚本用内置 `fetch` 与全局 `WebSocket`，22 起才有）
2. 本机装了 Microsoft Edge；若不是默认安装路径，设 `EDGE_PATH` 指过去
3. Python 3 在 PATH（起静态服务用）；不是 `python` 的话设 `PYTHON`
4. 端口 8100、8101、9401、9402 空闲

**实测输出（本机，exit 0）**

```
原版  : http://127.0.0.1:8100/
对照版: http://127.0.0.1:8101/.scratch/af-variant.html
用  msedge.exe 各开一局……

                 原版                                            对照版
  ----------------------------------------------------------------------------------------------------
  data-variant   null                                           no-worker-supply
  grow 名称        把生意做大                                          把生意做大
  grow 描述        翻修 + 旺季：升级自己的店，抓住几天收租窗口。       旺季 + 旺季：连开两轮旺季，翻修不再从补给里来。
  走到面板步数      34                                             34
  console        (无)                                            [variant] grow supply = ["inflate","inflate"]

✓ 两边 grow 面板文本不同
```

**它确实会失败**（负向自测，两边指同一页面）：

```
✗ 两边 grow 面板文本相同（对照没生效）
EXIT 1
```

**可能卡住的地方**

- 首次运行 Edge 若弹首启动向导/权限，先手动开一次 Edge 再跑。报错原文：`浏览器没有开出调试端口。若你第一次运行 Edge 弹了权限/首启动向导，先手动打开一次 Edge 再重试。`
- 端口被占：报 `服务 原版 在 127.0.0.1:8100 没有起来（端口被占？或 Python 不可用？）`，可用 `PLAIN_PORT` / `VARIANT_PORT` 改。
- 600 步内没走到补给面板：报 `在 600 步内没有到达第一次补给面板`。

---

## 4. 8000 侧的仓库内部目录 —— **已堵（2026-11-20，实测生效）**

不只 `.scratch`。静态根就是仓库根，所以 `.git/`、`.praxis2/` 默认也在 URL 空间里。实测改前 8000 与 8001 都返回 200：

```
/.git/config    200 302B   含 remote url（ssh://git@github.com/...）
/.git/HEAD      200 23B
/.praxis2/      200 715B   目录列表列出 trajectory.jsonl / memory.json / agents.json / processes.json
```

`.praxis2/trajectory.jsonl` 与 `memory.json` 是 agent 的私有推理与进程日志，本不该经 HTTP 读。所以拦截名单从单根扩成八个：`/.scratch`、`/.git`、`/.praxis2`、`/.vscode`、`/.idea`、`/node_modules`、`/__pycache__`、`/__invalid_path__`。

后两个是工具侧的：`__pycache__` 是 `py_compile` / `import serve` 在仓库根生成的字节码目录（实测 `/__pycache__/serve.cpython-314.pyc` 曾返回 200 / 7509B）；`__invalid_path__` 是本服务器内部的 404 哨兵名。现在探针用 `python -B`、校验用 `py_compile(cfile='.scratch/serve.pyc')`，不再向仓库根写 `.pyc`；拦截名单同时封住它们。`src/`、`docs/`、`README.md`、`serve.py`、`test/` 仍照常可取 —— 只拦内部目录，不是把仓库锁死。

**注**：8001 走 `.scratch/serve-variant.py`，2026-11-20 18:58 起它**也有三层拦截**了（与 `serve.py` 对齐）。
在那之前 8001 完全没有拦，`/.git/config` 会把 remote URL 一起发出去；现在已收口。

两侧实测（2026-11-20，生产实例）—— 14 种写法在 8000 与 8001 **都是 404 / 460B / `b47a55e09e9d3af6`**：

| 写法 | 测的是哪一层 |
| --- | --- |
| `/.git/config`、`/.git/`、`/.git` | 字面前缀 |
| `/.GIT/config`、`/.git./config` | 段名层（Windows 大小写不敏感 + 吃段尾点） |
| `//.git/config`、`/./.git/config` | 归一后落同一处 |
| `/.git%2fconfig`、`/%2e%67%69%74/config` | URL 编码斜杠与点，unquote 后仍是同一路径 |
| `/.praxis2/agents.json`、`/.praxis2/` | 轨迹目录 |
| `/__pycache__/serve.cpython-311.pyc` | 字节码 |
| `/node_modules/`、`/.vscode/settings.json` | 依赖与编辑器配置 |

正向对照两侧都 200：`/` 5108 `6f320608f37f1e9d`、`/styles.css` 39394 `6084098d4a7eb14d`、
`/src/data/slice.js` 5301 `24b2e2d38c48d51b`。8001 再加 `/.scratch/af-variant.html` 200/5230
`3d51b9d013370a81`、`/af-variant.html` 同、`/.scratch/af-variant-inject.js` 200/811 `e8b1148546523c6b`。
8000 的 `/.scratch/af-variant.html` 仍是 404。

**8001 的拦截故意不包含 `.scratch`** —— 那是对照页与注入脚本的唯一入口，堵了 8001 就没意义。
测试里专门有两条防卫这个：`_blocked_segments('/.scratch/...')` 必须为假，`BLOCKED_PREFIXES` 不得含 `.scratch`。

⚠ 一个容易误读的坑（本轮踩过）：**不能只看某个路径是 404 就说“拦住了”**。
8001 曾对 `/__pycache__/` 返回 404，看着像被拦，实际只是盘上根目录没有那个目录 ——
建一个立刻能取（实测 200/17B）。判拦截要看「盘上真有这个文件时会不会发出」，
或者直接验函数层。

### 原来是什么问题

`http://127.0.0.1:8000/.scratch/af-variant.html` 曾是**一个功能完整、可正常游玩的对照页**，不是「能取到一个文件」而已。当时实测（CDP，真浏览器，走完一局到第一次补给）：

```
url             http://127.0.0.1:8000/.scratch/af-variant.html
dataVariant     "no-worker-supply"
console         ["[variant] grow supply = [\"inflate\",\"inflate\"]"]
grow 面板 desc  「旺季 + 旺季：连开两轮旺季，翻修不再从补给里来。」
```

风险是**结论会作废，而不是页面难看**：8000 与 8001 服务的是同一个仓库目录，`.scratch/` 就在里面，`serve.py` 只做归一不做前缀屏蔽，所以天然能取到。人在 8000 手输 `.scratch` 就会玩到对照版而不自知 —— 而「两版 grow 哪个好玩」恰恰是要靠人回答的问题，他自己都不知道在玩哪版，答案就没有意义。

### 现在怎么做

只改 `serve.py`（`serve-variant.py` 一字未动）。拦是三层叠起来的，每层拦一类绕过：

```python
BLOCKED_PREFIXES = ('/.scratch', '/.git', '/.praxis2', '/.vscode', '/.idea', '/node_modules',
                    '/__pycache__', '/__invalid_path__')
BLOCKED_ROOTS = tuple(os.path.join(ROOT, p.lstrip('/')) for p in BLOCKED_PREFIXES)
BLOCKED_SEGMENTS = frozenset(p.lstrip('/') for p in BLOCKED_PREFIXES)

def _blocked_segments(norm):
    # Windows 大小写不敏感、吃段尾的点和空格、有 8.3 短名：
    # /.SCRATCH/x、/.Scratch/x、/.scratch./x 全落到盘上同一个目录。
    for seg in norm.split('/'):
        if seg.rstrip('. ').lower() in BLOCKED_SEGMENTS:
            return True
    return False

def _blocked_realpath(full):
    # realpath 问内核要规范大小写、展开短名与链接，名字层绕不掉的在这里收口。
    real = os.path.realpath(full)
    for root in BLOCKED_ROOTS:
        blocked = os.path.realpath(root)
        if real == blocked or real.startswith(blocked + os.sep):
            return True
    return False

def is_blocked(norm):
    for pref in BLOCKED_PREFIXES:
        if norm == pref or norm.startswith(pref + '/'):
            return True
    return _blocked_segments(norm)
```

Handler 里三处钩子：

```python
def _deny_blocked(self):            # do_GET / do_HEAD 最前面
    norm = normalize_url_path(self.path)
    if norm == '/__invalid_path__':  # 内部保留名不进 URL 空间
        self.send_error(404, 'File not found'); return True
    if is_blocked(norm):
        self.send_error(404, 'File not found'); return True
    return False

# translate_path() 归一之后
def translate_path(self, path):
    norm = normalize_url_path(path)
    if is_blocked(norm): return INVALID
    ...
    if _blocked_realpath(full): return INVALID

# _redirect_trailing_slash() 里，算完 target 之后
if is_blocked(target):
    return False        # 否则先发 301，Location 会把 404 变成可见跳转
```

**三处缺一不可**，每一处都是被实测咬出来的：

1. **`_redirect_trailing_slash` 那个钩子**：漏了它，`/.scratch/af-variant.html/` 会先回 301 再被跟随，404 变成一次可见跳转。
2. **段名 + realpath 两层**：只比字面小写 `'/.scratch'` 时，`/.SCRATCH/af-variant.html` 实测返回 **200 / 5230 / `3d51b9d013370a81`**，就是对照页本体。人随手大写一个字母就能绕过。
3. **`_deny_blocked` 在 handler 层直接拒**：早先版本只把被拦路径换成 `INVALID` 哨兵路径，靠「那个文件名不存在」才 404。实测建出 `__invalid_path__` 后，`/.scratch/af-variant.html` 返回 **200 且内容是那个文件**。拦截不该依赖文件系统状态。顺带把 `/__invalid_path__` 本身也封了，否则它存在时能被直接下载。

### 实测（重启后的 8000，`http.client` 绕开自动跟随）

| 路径 | 结果 |
| --- | --- |
| `/.scratch/af-variant.html` | 404 |
| `/.scratch/af-variant-inject.js` | 404 |
| `/.scratch/` | 404 |
| `/.scratch/af-variant.html/` | 404（不再是 301） |
| `/.scratch` | 404 |
| `/./.scratch/af-variant.html` | 404 |
| `//.scratch/af-variant.html` | 404 |
| `/.SCRATCH/af-variant.html` 等大小写变体 | 404 |
| `/.scratch./af-variant.html`、`/.scratch%20/...`、`/.scrat~1/...` | 404 |
| `/__invalid_path__` | 404 |
| `/`、`/index.html` | 200 / 5108 / `6f320608f37f1e9d` |
| `/styles.css` | 200 / 39394 / `6084098d4a7eb14d` |
| `/src/data/slice.js` | 200 / 5301 / `24b2e2d38c48d51b` |
| `/index.html/?slice=1` | 301 → `/index.html?slice=1` |

HEAD 走同一套判定，同样 404。

### 完备性不是“写了 15 条断言”就算，是另一批更刁的形态也真打过了

上表那 15 条是测试里钉住的。为了不只靠测试自证，另跑了两批**真打 8000** 的探针（不跟随重定向，301 也算没堵住）：

| 方向 | 形态（共 26 种，全部 404） |
| --- | --- |
| 反斜杠 | `/.scratchf-variant.html`、`\.scratch\…`、`/src/..\.scratch/…` |
| URL 编码斜杠/点 | `%2f`、`%2F`、`/%2escratch/`、`/.scratch/%2e%2e/…` |
| NTFS 特性 | `af-variant.html::$DATA`、尾点、`%20` 尾空格 |
| 8.3 短名 | `/.scrat~1/…`（目录）与 `/.scratch/af-var~1.html`（文件） |
| 多重斜杠/点段混写 | `/.//scratch/…`、`/.///.scratch//…`、`/src/../../.scratch/…` |
| 查询串与片段 | `?x=1`、`#frag` |

另跑一批**裸 socket** 探针（`http.client` 会拒发含裸空格/制表符的 URL，会误报成“服务器拒了”）：

- `/.scratch /af-variant.html`、`/.scratch<TAB>/af-variant.html`（段尾制表符）、`/ .scratch/…` → **400**，是 `http.server` 自己的请求行解析器拒的（报 `Bad request syntax`），不是我的拦截。
- `/.scratch.../af-variant.html`、`/.scratch/af-variant.html `（行尾空格） → **404**。

结论：26 + 7 种形态 `bad: 0`。

### 对照页只存在于 `.scratch`（不是“只是 8000 不拦其他路径”）

拦前缀只能拦住**那一个前缀**。所以又扫了全仓 **13057 个文件**找副本，判据是 sha 与正本逐位相同：

- 逐位相同的副本：**仓库里只有 `.scratch/` 里那一份**（页面 5230 `3d51b9d013370a81`、注入 811 `e8b1148546523c6b`），`.scratch` 之外 **0 个**。
- 内容含判别串（`data-variant` / `no-worker-supply` / `"inflate","inflate"`）的文件全落在已被拦的 `.praxis2/`（agent 轨迹）或 `.scratch/`（探针与日志）里。

### 人能不能把整局打完（真浏览器验证）

前面所有关于 grow 的证据只覆盖到**第 4 天第一次补给面板**。人不只玩到第 4 天 ——
若后半局 UI 卡死或回合不推进，前面的「面板文本不同」就不足以支撑验收。
所以另写了 `tools/verify-full-game.mjs`：真浏览器、真点击，一直点到结算屏。

实测（2026-11-20，两边各一局）：

| | 原版 | 对照版 |
| --- | --- | --- |
| 打完 | 是 | 是 |
| 交互步数 | 179 | 201 |
| 结算屏 | 「穿街高手 的生意做到了最后」 | 同 |
| 未捕获异常 / console.error | 无 | 无 |

`dayLimit=16`，第 17 天由 `finishByAssets` 结算（所以结算屏的「第 17 天」不是多打了一天）。
对照版整局中 `document.documentElement.dataset.variant === 'no-worker-supply'` 一直在位
⇒ 注入不是只在开局瞬间生效，是全程生效。

**读数时的一个误判陷阱**：AI 回合时 `#choice` 为空、`#dice button[data-roll]` 也不可点，
看着像卡死，实际是引擎在 `await wait(aiMs)` 等气泡关闭。别把这个当死锁证据。

**工具本身踩过的坑**（值得记，否则会报假失败）：全新 Edge profile 下第一个 `type==='page'`
是 `edge://sync-confirmation-dialog/`（首次启动同步向导）。第一版工具直接拿第一个 page 当目标，
`Page.navigate` 把游戏开到别处，向导页上永远读不到天数 ⇒ 空转到 3000 步上限，
报出「某版没打完」的假失败。修法：只认 `about:blank` / 空 url / `http://127.0.0.1:` 开头的 target。
（`tools/verify-grow-panel.mjs` 有同款写法，只是它的 profile 预热过才没暴露。）

### 对照版里 AI 对手会用错的价值估 grow（已知不对称，不影响对照成立）

人类看得到 UI 上改后的描述（旺季 + 旺季），AI 看不到 —— 它选补给时算的是：

```js
const grow = best(plotTargets(state, player, 'worker'));  // 按「能翻修哪块地」打分
```

这个评分函数不随 `SUPPLIES` 变。所以对照版里 AI 仍把 grow 当“翻修包”估值。
另外 `held('worker')` 在对照版里永远不涨（补给不再发 worker），于是 AI **更**愿意选 grow。

实测（`.scratch/ai-supply-bias.mjs` 40 局全 AI、seed 1–40，同一份 AI 代码）：

| | 原版 | 对照 |
| --- | --- | --- |
| AI 选 grow 占比 | 285/568 = 50.2% | 381/579 = 65.8% |
| AI 选 cross 占比 | 283/568 = 49.8% | 198/579 = 34.2% |
| 各风格夺冠 | grow 13 / take 12 / cross 15 | grow 13 / take 13 / cross 14 |

**这个偏差的方向与后果**：AI 多选了 grow（+33.7%）、少选了 cross（−30.0%），
但夺冠分布两版几乎一样（grow 13 vs 13）。

⚠ 我先用 8 局跑过一次，看到「grow 夺冠 4→1」就想下结论说对照版削弱了 grow 流；
40 局是 **13→13**。8 局那次的差是样本噪声（每差一局就是 12.5%）。
记在这里免得后来人拿 8 局的数据当结论。

**对真人对照的影响**：AI 在对照版里给 grow 流的对手会更“像”在拿翻修包 ——
也就是说你感受到的对手强度差异，掺了 AI 评分滞后这一项。
这不使对照失效（两版跑同一份 AI，差异仍只来自 grow 补给），
但你品“哪版好玩”时要知道：**对手不会因为规则变了而按新价值出牌**。

### 顺带发现：`take` 补给在实际对局里近乎死选项（既有行为，两版共有）

前节量 AI 选补给时发现 `take` **一次都没被选**（568 次里 0 次）。追了一下
（`.scratch/probe-take-never.mjs`）：

- 12 局共 173 次供给提示，实际选择只有 `grow` 89 / `cross` 84，`take` **0**。
- 但 `take` 并不是没机会：173 次里 **103 次（59.5%）** 存在可收购地块（平均 4.51 块）。
- 另 70 次（40.5%）确实无候选 —— 那些提示里 `take` 的分数退化成兜底值 1。

从评分公式能看出为何它赢不了（`slice-ai.js` 的 `case 'supply'`）：

```js
take: (take ? 7 + take.score * 0.4 : 1) / (1 + held('buyland')),
scores[player.style] = (scores[player.style] ?? 0) * 1.3;   // 本风格加权
```

`take` 风格玩家起手就有 `buyland`（`hand: ['buyland','remotedice','close']`）
⇒ 分母恒为 2，×1.3 后净系数 0.65；而 `buyland` 的分数本身还要扣
`relativeCost`（有主地是溢价×2）与 500 底数。与 `grow` 的 `6 + score*0.3`（分母 1）相比，
要赢需要 `take.score` 比 `grow.score` 高出一大截。三风格的分母对称（各起手都有自己那张），
所以这不是“针对性惩罚”，更可能是 `buyland` 目标评分偏保守的结果。

**与本单的关系**：这是**既有行为，两版完全一致**（AI 代码两版相同），
所以它**不污染 grow 对照**。记在这里是因为：

1. 你玩的时候会看到 `take` 这个选项，而 AI 对手从不选它 —— 这是可预期的，不是 bug 在当前改动里。
2. 要不要把 `take` 调成有竞争力的选项，是**游戏平衡决策**，属于用户/父级定，不在拦截与对照完整性范围内。

### 一个没说出口的前提：8000 发的是**整个仓库**，不是“站点目录”

实测 `/serve.py` 200 / 7087、`/test/blocked-prefix.test.js` 200、`/tools/verify-grow-panel.mjs` 200、
`/docs/…` 200 —— 静态根是仓库根，源码与测试天然在 URL 空间里。
这不归本次拦截处理：它们不泄 remote（那在已拦的 `/.git/config`）、不含对照页。
真要收紧得把根换成 `public/` 之类的交付目录，那是另一个决定，不在本单范围。
写在这里是为了不让下一个读的人误以为“8000 只发站点首页”。

**8001 不受影响**：`/.scratch/af-variant.html` 仍 200 / 5230 / `3d51b9d013370a81`，`/af-variant.html` 走别名表仍 200。

### `.scratch` 在 8001 上是有意开放的，但它里面装了什么（实测 2026-11-20）

`.scratch` 必须开放 —— 对照页 `af-variant.html` 与注入 `af-variant-inject.js` 只在那里。
但“开放这个目录”和“不管里面有什么”是两件事，所以把实际内容查了一遍：

- 目录列表 **82 项**，全部可读
- 内容构成：本次的探针脚本（`probe-*.py` / `*.mjs`）、日志（`*.txt`）、
  `serve.py` 的历史备份（`.bak240` / `.keep` / `.keep2` / `.snap` / `.before-dent`）、
  `serve-variant.py` 与它的 `.bak240`、`serve.pyc` 字节码、`README-entries.md`
- **凭据扫描结果：无**。全目录扫 `BEGIN … PRIVATE KEY` / `ssh-rsa` / `ghp_` / `sk-…`，命中 0

⇒ 这个开放面暴露的是**本单的工作产物**，不是秘密。要不要把探针/日志挪出 `.scratch`
是整理问题，不是安全问题；真要收，得给 8001 加白名单（只放行 `af-variant*`），
但那会让“临时脚本放 `.scratch` 就能被浏览器取”这个调试便利消失 —— 需用户定。

### 一个真实发生过的泄漏（已修，且加了防复发测试）

上面说“凭据扫描无命中”，但**曾经不是这样**。跑真浏览器验证时会在 `.scratch` 下
生成 `edge-*` profile 目录，实测曾累积 **10 个、3.0 GB**，里面含：

```
.scratch/edge-cdp-9333/Default/Login Data      200 / 55296 B / "SQLite f"
.scratch/edge-cdp-9333/Default/Network/Cookies 200 / 32768 B / "SQLite f"
.scratch/edge-cdp-9333/Default/Web Data        200 / 241664 B / "SQLite f"
```

也就是说 8001 当时在发放浏览器的登录库与 cookie 库 —— 盘上共 **60 个凭据类文件**。
那不是我“有意开放”的东西，是测试副产品。已全部删除（3.0 GB 回收），并加了测试：
`test/blocked-variant-internal.test.js` 会扫 `.scratch`，发现 `edge-*` 目录或
`Login Data` / `Cookies` / `Web Data` 文件就报错并列出路径。

**守卫自己的盲区（后补，已修）**：第一版只在 `e.isDirectory()` 分支里匹配 `edge-*`，
于是 `.scratch/edge-dump-variant.html`（`--dump-dom` 落下的 0 字节文件）被漏掉 ——
实测它在 8001 上是 `200 / 0B`，而守卫全绿。现在文件名与目录名都咬。

**教训**：验“边界是否合理”时，不能只验“这个路径能不能取”，还要验“这个目录里现在有什么”。
目录内容会随工作过程变化，而开放策略不会。

### 测试分四层，故意叠着

| 文件 | 条数 | 管什么 |
| --- | --- | --- |
| `test/blocked-prefix.test.js` | 25 | HTTP 行为：15 种写法全 404、首页四资源指纹、301 query 不丢、被拦前缀不发 301、对照页本体仍在盘、HEAD 同拦、页面与源码不引用 `.scratch`、整张 ES 模块图（实测 29 个资源）逐个 200 |
| `test/blocked-prefix-layers.test.js` | 4 | 直接 `import serve`，分别验 `_blocked_segments` / `_blocked_realpath` 各自成立，并验 import 不会把服务跑起来 |
| `test/blocked-prefix-sentinel.test.js` | 7 | 真建出 `__invalid_path__` 后，被拦路径仍 404 且不泄内容；`/__invalid_path__` 不泄 |
| `test/blocked-internal-dirs.test.js` | 23 | `.git` / `.praxis2` 等内部目录不发放（含大小写、尾点、`/./`、`//` 写法）；`.git/config` 不泄 remote、`.praxis2/` 不泄轨迹文件名；游戏三资源指纹不变；`src/`、`docs/` 仍可取 |
| `test/variant-supply.test.js` | 4 | 对照版的面板与**发放**是否一致：改 `SUPPLIES` 里 grow 的 `cards` 后，选了 grow 手里真多出两张旺季（不是只改文字） |
| `test/trailing-slash-variant.test.js` | 8 | 8001 对照入口：尾斜杠 301 落到别名展开后的路径；**根路径必须发原版**（把 8001 首页当对照版会玩错版本）；三个别名入口同内容且与首页不同 |
| `test/blocked-variant-internal.test.js` | 34 | 8001 侧内部目录不发放（含编码/大小写/尾点变体、`.idea`、两个 pyc 名）+ `.scratch` 仍可达 + 3 条分层 |
| 其余既有测试 | 133 | 与本次改动无关的游戏逻辑 |

合计 **238 tests / 238 pass / 0 fail**（`test/` 下 25 个文件自身）。**`node --test` 实跑报 239**，差的那 1 条是 `src/data/maps/test-manor.js` 被 glob `test-*` 当测试文件跑了。跑法是不带参数的 `node --test`：Node 24 不接受目录参数（`node --test test/` 报 `Cannot find module …\test`），而不带参数时它按 glob 自动发现，连 `src/data/maps/test-manor.js` 也被 `test-*` 这条 glob 当测试文件跑一遍、计 1 条 —— 所以 239 里有 1 条是那个数据模块，`test/` 下 25 个文件自身是 238 条。

另外两条比拦目录更底层的前提也钉在那个文件里：

- **只绑回环**：从 `serve.py` 源码取 `ThreadingHTTPServer(('127.0.0.1'` 的地址并断言。实测把地址改成 `0.0.0.0`，这条立刻变红（报「绑定地址变成 0.0.0.0，不再只限本机」）。
- **写方法一律 501**：`POST`/`PUT`/`DELETE`/`PATCH`/`TRACE` 实测全 501，不落盘。

**为什么要分层**：只测 HTTP 时，把整个段名层短路成 `return False`，24 条照样全绿 —— 因为 realpath 层独自兜住了。也就是说 HTTP 层咬不住「某一层被删了」。分层测试加上后，摘哪层哪层红（实测：摘段名层 ⇒ HTTP 24 绿、分层 1 红，报 `/.scratch/x 段名层该判拦住  false !== true`）。

**已知副作用（有意接受）**：8000 上 `/.scratch/` 下的调试文件（`serve-path-test.py`、`cdp-*.mjs`、`edge-*` profile 目录）也一起 404。它们本来就不该从 HTTP 取。以后想在浏览器里开对照页，只能走 8001。
