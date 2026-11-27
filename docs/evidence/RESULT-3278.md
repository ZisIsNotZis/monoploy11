# #3278 回执：从干净检出独立玩完整局

目标（用户原话）：

> 把这款游戏做到我能从干净检出独立玩完整局并知道结果的程度。优先走查短窄屏，确认关键选择在普通玩家操作下能看清、点到，追查卡住或误导的地方，再用完整一局和可复取的版本收口。

本页回答四件事：**从哪个入口开始**、**证据在哪**、**相对 PROJECTS.md 的约定范围做到哪一步**、**什么还没被证明**。

> **#3317 之后先看这里**：交付里那一局的可复判回执在 `docs/evidence/receipt-3317-390/`，
> 一条命令就能重判：`python3 support/full-game/report-full.py docs/evidence/receipt-3317-390`
> （24 PASS / 0 SKIP / `VERDICT: PASS`）。以前这里放的是整份原始帧（256 KB、11000+ 行），
> 现在只留判据真读的字段（58 KB），仍是一个 `report-full.py` 能直接判的目录；
> 裁剪前后判词由工具逐字比对，不同就拒写。原始帧不入库，`provenance.json` 记着它们的 sha256。

---

## 1. 真实入口

```bash
python3 -B serve.py 0            # 打印 LISTENING <port>，端口由它自己选，不占固定端口
# 浏览器打开（窄屏设备模拟 390×844 即可，无需特殊配置）：
#   http://127.0.0.1:<port>/index.html?slice=1&style=grow&seed=1
```

- `slice=1` 进「街角生意」切片；`style=grow` 选「街角店主」起手；`seed=1` 固定随机序列。

**README 已改到与交付集一致**。此前它把玩家指向两处交付集里不存在的东西：`python serve.py`
（干净检出只有 `python3`）和 `node tools/play.mjs`（`tools/` 根本不在清单里）。现在：

- 头版就是上面这条已复验的入口，不再先引 `.scratch` 对照页。
- `tools/play.mjs`、`tools/evaluate-slice.mjs` 已**纳入交付清单**（它们只 import 锁内的 `src/` 模块，
  不读私有路径、不写盘、不需要浏览器）；另外三个 `tools/verify-*.mjs` 硬编码了 Windows Edge
  路径与 `.scratch` profile，**明确标注不进交付集**。
- 新增 `test/delivery-readme.test.js` 钉住这件事：README 的 bash 代码块里敲的每个脚本都必须
  被交付清单解释，且代码块不得使用 `python …`。这条测试**咬过**：把入口命令改回旧写法会变红，
  改回即绿（第一版只扫反引号内文本，牙没响，已修）。

在**固定检出**（`/tmp` 空目录，只含清单文件）里逐条实测的结论：

| README 里的命令 | 结果 |
|---|---|
| `python3 -B serve.py 0` + `/index.html?slice=1&style=grow&seed=1` | 200；页面含 `sliceStyles`/`startSlice`；`styles.css`、`src/main.js` 均 200；`Cache-Control: no-store` |
| `python3 -B support/serve-variant.py 0` + `/af-variant.html` | 200 |
| `node tools/play.mjs --slice --seed 7`（stdin 发 `{"op":"auto","count":2}`） | exit 0，逐行回 JSON，含真实日志与 history |
| `node tools/evaluate-slice.mjs --seeds 3` | exit 0，输出 config/结果 JSON |
| `node --test test/*.test.js` | 全绿；具体条数以你那次运行打印的数为准（加测试会变；空目录里自行复跑见 §2） |
- 不带参数打开会落在完整设置页（完整模式 12 张地图仍在，是保留资产）。
- 页面零运行依赖、纯静态；除 `serve.py` 的 `no-store` 之外不依赖任何后端行为。

## 2. 一局怎么跑、结论怎么看

量具全部在 `support/full-game/`，已不再依赖 `.scratch`（此前「可重跑」的说法不成立，因为量具没入库）。

```bash
python3 support/full-game/run-full.py          # 跑一局（默认 390×844，真实 CDP 鼠标输入）
python3 support/full-game/check-delivery.py    # 交付清单与锁字节是否一致
python3 support/full-game/clean-checkout.py    # 只复制清单文件到空目录，再从那里跑一局
```

`run-full.py` 会自动调用 `report-full.py` 给出 PASS/FAIL，**不需要人工读 JSON**。
`clean-checkout.py` 自带的泄漏判据改为「**清单之外一个不许多**」：以前硬编码 no-tools/，
把清单刻意点名的两个调试工具误报成泄漏；现在它把实际文件集与清单逐个比，只报清单没解释的文件。

最新回执（**以本轮最后一次整局为准**，此前几次留作对照）：

- `support/full-game/OUT-W-390-gate/` —— **390×844，最终版量具 + 两刀都生效的整局**（默认视口，无 `.scratch`、无字体覆盖）
  - `report-full.py`：**23 项全部真的被判到，0 项 SKIP**，`VERDICT: PASS`，`SEALED bytes+no-store`
  - 44 次按键、买地 2 次、结算 `穿街高手 12,400 / 80,000 / 92,400`、`街角店主 18,600 / 46,000 / 64,600`、
    `机会买家（破产）0 / 0 / 0`，「你与获胜者相差 27,800 资产」
  - 与下面的 `OUT-T` 同样 44 次按键、买地 2 次、结算逐字相同（本局 355 帧 / 45,856 ms；
    OUT-T 是 369 帧 / 44,165 ms，差异只是墙钟与提示测量帧数）
  - 多出来的那一项是 F6 真的被判了：`gate: OK -- 16 action-control press(es) carried acknowledgement evidence;`
    `0 of them landed while a bubble was live` —— 这一局的点击全部被接住（见 §4.1）
- `support/full-game/OUT-T-390-gate/` —— 同视口、同一修法的前一局（量具当时还没有 `after` 采样）
  - `report-full.py`：**22 项 PASS + 1 项 SKIP**，`VERDICT: PASS`，`SEALED bytes+no-store`；结算数字与 OUT-W 逐字相同
  - SKIP 的是 F6：那一局记录里没有“按下后 80ms 再看一眼”的证据，**对这个问题它没有发言权**
- `support/full-game/OUT-V-360-ack/` —— **360×640，两刀都生效后的整局**（`VIEWPORT_W=360 VIEWPORT_H=640`）
  - 49 次按键走到结算（`机会买家 68,000 / 穿街高手 66,400 / 街角店主 62,600`，差 5,400）
  - **F6 真正被判到**：`gate: OK -- 24 action-control press(es) carried acknowledgement evidence;
    1 of them landed while a bubble was live and were still taken`
  - 这一局的 2 项 SKIP 是 F2（它没落到无主地，`buys=0`），不是产品问题
- `support/full-game/OUT-K-final/` —— 390×844 上**修复前**的整局（同一入口、更早的锁）。
  当时判 22/22 PASS；**用今天的工具重判**仍 `VERDICT: PASS`，但 F6 变 SKIP 且多出一条 `WARN 1 burst`
  —— 这条 WARN 就是缺陷指纹（旧记录没有 `after` 采样，所以只能警告、不能定罪）。
  这正是我为什么要拿旧记录重跑新判据：旧的那 22/22 里有一项根本没被问过。
- `support/full-game/OUT-S-360-ask/` —— 360×640 上**只落了第一刀**的整局，缺陷仍在：
  `WARN 1 burst(s) … longest 20 on action:roll`（同一指纹连按 20 次），`gate: NOT EXERCISED`
- `clean-checkout.py` 本轮跑的那一局 —— **在只含清单文件的空目录里（`/tmp`）跑出的独立整局**：
  `checkout holds only delivered files (131 named, none extra)`、套件 **530/530**、
  整局 **23 项全 PASS、0 SKIP**、`VERDICT: PASS`、`SEALED bytes+no-store`，
  跑完 `CLEAN CHECKOUT: PASS` 且 `checkout removed`（临时目录不留下）。
  它证明的是「交付集自成一体」：那些文件之外没有任何东西参与这一局。
  文件数会随清单与测试文件变化，**上面那个 131 是这一次工具算出来的，不是手抄的常数**；
  读者应以自己那次运行的输出为准。
- **另修一个会让上面那句失效的缺口**：量具跑一局会在 `support/full-game/` 里产出 `OUT-*/`、`chrome-profile-*/`、
  `trees/`，把它们挡在提交之外的原来是**一条只存在于我这个工作区的 `.gitignore`**，它不在清单里。
  也就是说，别人从交付集跑完一局再 `git add -A`，会把这些证据目录当源码提交进去。
  已把 `support/full-game/.gitignore` 加进清单，并**用候选对象验证过**：
  从 `git archive` 的目录里 `ls -a` 能看到它，且新建一个 `OUT-fake/` 后 `git add -A` 不会收录它。

390×844 的五次独立运行（`OUT-J/K/P/T/W`）**决定性数字逐字相同**：44 次按键、买地 2 次、结算三行与
「相差 27,800 资产」一字符不差。浮动只有墙钟（P 44,155 / T 44,165 / J 44,219 / K 44,261 / W 45,856 ms）与提示测量帧数
（355 / 369 / 370 / 371 / 371）——两者都不参与判定。一致说明此前的差异是竞态，不是随机抽奖。
（`OUT-W` 与同锁候选提交里跑的那一局也是同样的 355 帧 / 44 按 / 结算 27,800，只是墙钟不同。）

**这一轮有三处是我自己的工具/测试出错，都是改根因而不是改断言，值得写下来**：
① 第二轮空目录跑在 `profile left behind` 上判 FAIL，而同一份日志里 22 项全 PASS、字节全 SAME。
根因是收尾只对 Chrome 主进程 `terminate`，渲染/GPU 子进程还会短暂回写 profile，
而 `rmtree(ignore_errors=True)` 把“没删干净”静默掉了。修法不是放宽断言，而是
`start_new_session` 收进程组 + 删除重试到目录真的消失（`run-full.py: launch/stop_tree/remove_dir`）。
② 同一次里我还发现 `delivery-readme.test.js` 的 `covered()` 把 `test/*.test.js` 当字面文件名，
于是“README 提到一个确实随检出走的测试文件”会被判未解释。改成真通配后**先加一条牙**，
把旧逻辑塞回去它确实变红（`同目录带扩展名的通配应当命中: false !== true`）；恢复后全量绿（当轮 517/517）。
③ `run-full.py` 把锁建树的文件清单写到 **`support/full-game/record-tree.json`**（脚本旁边），而不是那次运行的 OUT 里
  —— 每跑一局就往交付目录塞一个工作产物，而回执离开它描述的那一跑就无法核。现在写进 `OUT/record-tree.json`。

## 3. 相对约定范围做到了哪一步

PROJECTS.md 对本项目的原文是：

> 独立浏览器棋盘原型可开局，远端固定版本 `node --test` 96/96；**接受范围仍有窄屏决策与离线交付，活跃 Vibe 工作尚未验收。**
> 下一步：**从远端真实入口完成一次可读、可重复的窄屏完整局。**

逐条对照：

| 约定要求 | 本回执的状态 | 依据 |
|---|---|---|
| 窄屏决策「可读」 | 已达 | 结算三行名次全部落在 390×844 首帧内（`rowsFull=true`）；`record-9-results.png` 可目视核对；字体由宿主 Noto Serif CJK SC 承担，无缺字方框 |
| 窄屏决策「可点」 | **已修到「画得出就能点」** | 每次按键都是 CDP 真实鼠标事件，且仅当该点 `elementFromPoint` 命中控件本身（`usable=itself`）才按；买地屏首帧即可用（`OUT-W` 真的遇到了买地屏，且 `buyFirstUnusable=null`；没遇到买地屏的那局此项判 SKIP 而不是 PASS，理由见 §5.2）。此前有一类「画得出、点不着」（气泡在播时控件仍 enabled 而点击被静默丢弃），已在 §4.1 修复并有 F6 判据 |
| 「完成一次可读、可重复的完整局」 | 已达 | 390×844 五次独立运行（`OUT-J/K/P/T/W`）都是 44 次按键走到结算屏，买卖次数与结算三行逐字相同；360×640 另跑了几局走到结算（`OUT-L/V`；其中 `OUT-L` 早于修复）。决定性数字一致，见 §2 |
| 「离线交付」 | **已落成可 checkout 的本地候选分支 `candidate/3278-narrow-slice`** | 空目录里只有清单点名的文件，套件与整局都 `PASS`、README 每条命令 exit 0（文件数按工具现算，不抄常数，见 §2）；`make-candidate.py --branch …` 建的根提交用 `git archive` 抽出、以及**用 `git worktree add` 直接检出该分支**两条路都整局 `VERDICT: PASS`；`master` 未动、未推送。见 §5 |

## 4. 追到的真实缺陷（同一根因的两面）

提示（「↓ 还有 N 个方向在下面」）此前是本项目最实质的误导源，两次整局各自暴露了同一根因的一个方向：

- **OUT-G**：提示**插入前**量几何 ⇒ 插入后它说「还有 1 个」，而当时两个方向**都已可见**（`sides {0,0}`，屏上说假话）。
- **OUT-H**：提示**插入后**量几何 ⇒ 计数变 0、提示被自己收掉，路线重新变成**静默裁切**（`key3 parent:null`）。

根因：提示曾是 `position:sticky`，**仍占 flow**；而 `#hand` 是 `margin-top:auto`、`#choice` 内容底对齐，
append 一条约 34px 的提示会把可见带从上方撑高 34px —— **插入这件事自己抹掉了它要报告的短缺**。

修法（`src/ui/render.js`，只此一个文件变动，已重冻锁）：

1. 提示改为 **absolute overlay**（`left:0;right:0;bottom:0`，`pointer-events:none`），不占布局空间；
   插入不改变任何 item box，因此计数在显示时始终为真。
2. 宿主若为 `static` 就地改 `relative`（只影响定位，不改尺寸与流），并用能力探测而非 try/catch。

代价（诚实记录）：overlay 会**盖住最后一项底部约 34px**，但该项中心仍可点，且提示本身 `pointer-events:none` 不抢点击。

### 4.1 360×640 上的第二个真缺陷：**画得出、点不着**

这是用户点名要追的那类「误导」，但它不是提示，而是**动作屏在自己的气泡窗口里假装还能作答**。

证据链（全部来自保存的记录，不是推测）：

1. 360×640 的一局里，`pressLog[40..59]` 是 **20 次连按掷骰**，每次按下时 `hit=itself`（点确实落在键上，
   没被挡住），而 `seen` 指纹**完全不变**：`第 12 天`、`logLen 3535`、`rollDisabled=false`、`choiceHidden=true`。
   20 次点击，引擎一步没动。
2. 为什么会这样（读代码得到，且有测试钉住）：`src/ui/speech.js` 的气泡是 `position:fixed`，不阻塞点击；
   `main.js` 的 `answer(value)` 开头是 `if (!active) return;` —— **槽空着时静默丢弃**；
   而 `active` 只在 `await flushSpeech()` **之后**才被赋值。于是「气泡在播」这一段里，屏上画着 enabled 的
   掷骰键与手牌，点下去却什么也不会发生。

**两刀都必要，第一刀不够**（这是本轮最贵的教训）：

- **第一刀**：`ui.ask` 的人类分支改成**先装槽 + `applyPromptToState` + 重画**，再在 `.then` 里等气泡
  做焦点交接（AI 分支保持原序）。这只保证「第一次点击**被接住**」。
- **第二刀**：只改 ask 顺序**不够** —— `answer()` 清槽后**没有任何人重画**，而到引擎真正前进还隔着
  `settle` 里的 `flushSpeech()`（实测每句 1.2–1.8s）。那张屏继续把控件画成 enabled，
  玩家自然会再点一次，然后又被丢掉。所以：`render(root, state, actions, opts = {})` 增加
  `answerable`，`canRoll` 追加 `&& opts.answerable !== false`（手牌复用 `canRoll`，一起被闸住）；
  `main.js` 的 `rerender()` 传 `{answerable: !!active}`；`answer()` 清槽后、`resolve` 之前对动作屏重画一次。
  三参数调用（`flow.js`、`tools/`）不传 opts ⇒ 行为不变。

判据（`F6`，三态）：**不看「按下时有没有气泡」**（修好之后那恰好是正常情形，我一开始就是用它判的，
把修复后的 `OUT-U` 误判成红），而看控件自己的销账：按下 80ms 后若同一个控件**仍然 enabled**，
说明这次点击没被接住。修复后 `OUT-V-360-ack` 的实测是
`24 action-control press(es) carried acknowledgement evidence; 1 of them landed while a bubble was live and were still taken`。
没有 `after` 采样的旧记录一律 SKIP ——「量具没问这个问题」不等于「那时没问题」。

**残余（未修，如实记下）**：重画只做了动作屏。岔路 / 买地 / 补给等屏在作答之后**仍不重画**，
所以同样的「画得出、点不着」在那几屏理论上还在（只是它们的作答到换屏之间通常不隔气泡）。
F6 也明确只对动作屏发言，报告里那句 `Non-action screens are NOT claimed` 就是这个意思。

## 5. 边界：什么没被证明

- **360×640 已实测两局，但它证明的不是「同样可用」**（细节见 §5.1）：视口现已参数化，
  `VIEWPORT_W=360 VIEWPORT_H=640` 的第一局（`OUT-L-360`）走到结算（机会买家胜，差 5,400），482 帧 / 76 次按键；
  修复后又一局（`OUT-V-360-ack`）49 次按键走到结算，差 5,400。两局结论相同：**能玩完，但得先滚动。**
  裁决是：**能玩完，但每个回合都要先滚一次页才能行动**。比 360×640 更窄、真机触屏手势、
  双指缩放、iOS Safari **仍未覆盖**。
- **有声音未验**：`src/ui/voice.js` 走系统语音或文字回退；`assets/voice/` 的本地 MP3 不在交付集内，**没有声称已交付原音频**。
- **量具本身的代价**：页面没有 window 级 state 句柄，所以屏类型与「人类座位」全靠 DOM + 起手名单推断
  （`style=grow` ⇒ 人类必为「街角店主」）。若产品改起手名单，量具要同步改，这是量具的脆弱点，不是产品缺陷。
- **replay 落点已修（原为已知边界）**：结算屏「换个打法，再开一局」曾落在**完整设置页**、三种起手未预选
  （旧记录 `OUT-W-390-gate/record-10-replay.json`：`sliceEntryAfterReplay=false, picks=[], url="?style=grow&seed=2"`）。
  现在 `replay()` 写回 `slice=1` 与本局人类座位的 `style=`、种子 +1，回到切片第一屏且保留起手。
  改后整局 `OUT-X390-replay`：**24 项全 PASS / 0 SKIP**，`url="?slice=1&style=grow&seed=2"`、`picks=["grow"]`、
  `sliceEntry=true`；决定性数字（44 按 / 买地 2 / 差 27,800）与改前逐字相同。
  这两项旧记录里没有证据 ⇒ 判 SKIP 并点名，不判 PASS。**已验的只是「回到入口、起手保留、种子 +1」**，
  连续再开几局的节奏与疲劳属于体验判断，未验。
- **交付有两种形状，回答两个不同的问题，别混用**。同一个工具 `make-candidate.py` 都能做，
  它们是**不同**的提交对象：

  | 形状 | 命令 | 树里有什么 | 用来回答 |
  |---|---|---|---|
  | 根提交（对照） | `make-candidate.py --branch candidate/3278-narrow-slice` | **只有**清单点名的文件 | 「交付集自成一体系吗？」——`clean-checkout.py` 就是它的替身 |
  | 快进提交（发布用） | `make-candidate.py --onto origin/master --branch release/3278-narrow-slice` | `origin/master` 的树 + 清单覆盖其上，**一个文件都不删** | 「能不能快进到 master、不抹掉用户已有历史？」 |

  发布要的是第二种：根提交与 `master` 没有共同祖先，推上去是在替换别人的历史，
  而用户已经看得到 `master` 上的提交。快进提交的父提交就是 `origin/master`，
  `git pull --ff-only` 直接吸收它，`git diff <提交>^ master` 就是这一次的全部变化。

  作者身份与索引都是临时的（`GIT_INDEX_FILE` 指向 `/tmp` 下的文件，从不碰 `.git/index`），
  字节来自工作树里将被发出的那些文件。**两种形状都不动 `master`、不推送。**
  工具默认连引用都不移动（只打印 id）；移动一个**新名字**要显式 `--branch`，
  而一个已存在且指向别处的同名分支会被拒绝而不是 force-move —— 重跑不会悄悄改变
  已经交出去的分支含义（同名同 id 是幂等的）。

  **刻意不写死提交哈希**：提交包含本文件，改一个字 id 就变；把过期 id 当「交付」就是让读者
  复制一条命令却检不到东西。冻结的是**文件集**（`support/full-game/DELIVERY.txt`），
  id 是那次运行的出处，工具每次现算并打印。

  **两个形状都真跑过，不是口头可 checkout**（合入者要的两条命令就在这里）：

  ```bash
  # 发布形状：一份独立检出，不碰当前工作树
  git fetch <repo> release/3278-narrow-slice
  git worktree add --detach /tmp/monoply11-slice FETCH_HEAD

  # 对照形状：只含清单文件的树
  git archive <root-commit-id> | tar -x -C /tmp/try
  ```

  | 取法 | 结果 |
  |---|---|
  | 根提交 `git archive \| tar -x` 到空目录 | 文件数与 `FILES` 逐一相等；套件全绿、整局 **23 PASS / 0 SKIP** + `SEALED` + `VERDICT: PASS`（**不需要任何手工暂存**，见下） |
  | 快进提交 `git worktree add --detach … release/3278-narrow-slice` | 同左；且 `git rev-list --count origin/master..HEAD` = 1、父提交就是 `origin/master` —— 这是「`git pull --ff-only` 会成功」的实测替身 |

  合入者只关心三件事，都已经量过：**只多一个提交**（`git rev-list --count <基线>..HEAD` = 1）、
  **一个文件都不删**（`git diff --name-status <基线> <提交> | grep -c '^D'` = 0）、
  **父提交就是基线**（`git rev-parse <提交>^` = 基线）。
  另有 6 个线上版本存在、清单没点名的文件（`.gitignore`、`.nojekyll`、`docs/0_STAGING.md`、
  `docs/1_PROBLEM.md`、`docs/4_USECASE.md`、`tools/tts.py`）在快进提交里**原样保留**；
  根提交里没有它们——这是两种形状唯一实质差别，不要把它读成“交付少东西”。

  **基线不是 `origin/master`，而是线上那一版。** 这一段原先写「父提交就是 `origin/master`」，
  那是拿远端默认分支当“用户手上那一版”，而这两者在这里并不是同一个东西，实测：
  `origin/master` = `7ad1f8a`，它的父提交是 `a79c1af`（更早发布的那一版），两者都是从 `a79c1af` 分出去的兄弟。
  `a873a66` 是 `a79c1af` 的另一个子，**不能**沿 `7ad1f8a` 快进。
  这一轮（#3319）因此把基线改成 **`7ad1f8a`（当前线上版本）**：

  ```bash
  python3 support/full-game/make-candidate.py --onto 7ad1f8a --branch release/3319-picker
  ```

  实测：父提交 = `7ad1f8a`、`git rev-list --count 7ad1f8a..HEAD` = 1、删除 0。
  教训写在这里而不是留在记忆里：**发布基线永远是“用户手上那一版”，不是远端默认分支**——
  这条上一轮已经被指出过一次，而同一份报告里又把它写回去了（因为文档抄了旧结论）。

  线上版那两份文档（本文件与 `6_SLICE.md`）里也还留着同一句旧话，本轮一并改正；
  它们本来就在清单里，所以交付集带的就是改正后的版本。

  两种形状下，390×844 整局都是 **44 按 / 买地 2 / 差 27,800**，与 §2 的 `OUT-W` 逐字相同；
  360×640 在候选上重跑仍是 **差异 5,400、先整页滚一次**，即 §5.1 的边界没有被这次交付改动。
  **对照夹具曾要求手工暂存，那个坑已从根上填了**：对照测试断言的是字面 URL
  `/.scratch/af-variant.html`，而夹具的正式家是已提交的 `support/compare/`。以前只在
  「开发机恰好有 `.scratch` 副本」时两者才重合，于是普通 `git clone` + `node --test` 会红 44 条
  `blocked-*`，第一句是「端口上没有正常的 serve-variant.py」——看起来像服务坏了。
  现在 URL → 文件的映射在 [serve-variant.py](../../support/serve-variant.py) 里：
  `.scratch/<名>` 不存在时取 `support/compare/<名>`，`clean-checkout.py` 也不再手工暂存。
  已验证：把发布提交抽到**完全没有 `.scratch` 的目录**里，套件 545/545 全绿、整局 `VERDICT: PASS`
  （个数随测试文件变化，以自己那次运行的输出为准，不要抄这里的数字）。

  **未做的部分**：没有推送、没有在远端重建。两个分支都只在做了这次提交的这台机器上；
  跨机器分发要么主管推一次，要么用 `git bundle`（未做，属于「发布」而不是「交付」）。

### 5.1 360×640 那一跑：能玩完，但每回合要先滚一次页

视口原本硬编码在量具里，所以「走查更窄屏」只能靠改代码。现在 `drive-full.mjs` 与 `run-full.py`
都从 `VIEWPORT_W` / `VIEWPORT_H` 取尺寸（默认 390×844，非法尺寸直接拒绝），
`support/full-game/OUT-L-360/` 就是 `VIEWPORT_W=360 VIEWPORT_H=640` 跑出来的整局。

实测（`record-8-summary.json`，本轮用一份现算脚本逐项复算过，不靠记忆）：

- 走到结算屏，**482 帧 / 76 次按键**，`机会买家 的生意做到了最后`，`你与获胜者相差 5,400 资产`。
- **F3 在 360 也全绿**：`hintTrace` 16 帧里 `expectShow` 10 帧，**10 帧都真的挂了提示且文本一致**，
  `expectShow=false` 却挂提示的 0 帧，`mismatchCount=0`。
- **手牌在首帧从来没有一张可用**：64 个纯动作首帧里有手牌的 63 个，**可用 0**。
- **掷骰键在首帧 27/64 可用，但那是同一张屏**：按 `heading + players + cards + logLen` 去重，
  27 个「可用」首帧只剩 **1** 个不同屏；37 个不可用首帧里 `disabled` 23、`clipped:centre-outside` 14。
  所以「27/64」不能读成「27 张屏都能点」。
- **整页偏高是恒定的**：64 个纯动作首帧里 `docH=697`、`winH=640`（高 57px）且 `scroll.y=0`，
  无一例外 —— 这就是「必须滚一次才能动手」的来源。
- **但「每一次按键都在滚动之后」是错的，本轮改正**：`pressLog` 只记录 60 条（总按键 76），其中
  人类动作类（`action:` / `diceValue:`）**40 条**，带 `afterScroll` 的是 **16 条**（全部 60 条里 17 条），
  滚动距离为 102 / 117 / 118 / 122 / 129 / 147 / 165 / 183 px。
  大多数按键发生在已经滚过之后（所以不必再滚），不是“每按必滚”。

**我没有据此改产品，理由是量过的反面证据**：在真页面里注入候选规则实测（360×640），
`#side{min-height:min(300px,38vh)}` 确实把 `docH` 从 697 压到 640（页不再滚了），
但 roll 与三张手牌**仍然**全部 `clipped:centre-outside` —— 那就更糟：连「滚一下就能点」都没了。
`board-56vh + side-min-cap`、`+ hand-shrink`、`+ log28` 三种变体同样全不可用。
那个探针是 `.scratch/3278-short-probe.mjs`（**不在交付集内**：它是一次性的变异探针，依赖 `.scratch` 里的
临时树；结论已写在这里，但不要指望在干净检出里跑它——“不可重跑”的就是这一条探针，不是整局量具）。
**那一轮我为此没有动任何锁内字节**，只把它写成「360 是能玩完的，代价是每回合一次整页滚动」这条
实测边界，而不是冒充成和 390 一样的结论。要真修这一屏，得重排版面并重冻锁、重跑整局，那是下一片的事。

**后一轮的字节变动与版式无关**（别把两件事混起来读）：`src/ui/render.js` 与 `src/main.js` 改的是**提示定位**
与**作答闸门**（§4、§4.1），两个文件都在锁内、已重冻。本节说的版面结论**一字未动**：
修复后的 `OUT-V-360-ack` 里 `docH` 仍是 697、`winH` 仍是 640、手牌首帧可用仍是 **0/30**、
掷骰键首帧可用仍是 **0/37**，滚动距离分布与修复前逐字一致（102–183px）。
换句话说：这两刀让「已经滚到可点之后的那次点击不再被丢弃」，**没有**让 360 少滚一次页。

### 5.2 报告本身也修了一个「缺证据当证据」的洞

360 这一局恰好暴露了**我自己量具的错**：那局根本没有出现过买地屏（`kinds` 里没有 `buy`、`buys=0`），
而 `report-full.py` 仍然打出 `PASS  F2 buy screen usable at first frame` —— 因为 `buyFirstUnusable`
在「没见到」和「见到且首帧可用」两种情况下都是 `null`。

修法是把这两项改成**三态**：没出现买地屏时判 `SKIP`，并在结尾打印
`NOT JUDGED by this run (n): …`；`SKIP` 不算 FAIL（人没落在无主地是合法结局），
但也不许被读成 PASS。`test/report-verdict.test.js` 用两份手写记录喂真正的 `report-full.py`
（见过 / 见过但首帧不可用 / 没见过），期望值取自报告自己的输出；牙已咬过（把 `saw_buy` 三态删回旧归纳，
第 3 例立刻红）。所以今天用**当前判据**重跑 `OUT-K-final` 是 `VERDICT: PASS` 且带 1 项 SKIP（F6，
那时还没有 `after` 采样），`OUT-L-360` 带 3 项 SKIP（F2 两项 + F6）。
两项都是 PASS，但读者能一眼看出「谁没被判」——这正是把它改成三态的意义。

### 5.3 判据也修了两轮（都在同一类错上：把「我没问」当成「没问题」）

1. **`F4 gapMatches` 只在输的那一支上跑过**。产品在玩家赢了时打 `你赢了。`（`src/ui/slice.js:995`），
   而这条检查要求一句「相差 N 资产」，所以此前 20 份 PASS 记录全是输的，它从没在赢的那支上被测过；
   第一次赢（360×640）时立刻红。修法不是放宽，而是**从 `judge.rows` 重算差额**：
   差额为 0 ⇒ 屏上必须没有差额数字；否则屏上那个数必须等于重算值。`fit.js` 同样改了。
2. **`F6` 不能拿「按下时气泡在播」当判据**。第一版就是这么写的，而修复后那恰好是**正常**情形，
   结果把 `OUT-U` 误判成红。改成只认控件自己的销账（80ms 后仍 enabled ⇒ 没被接住），
   并且**旧记录没有 `after` 采样时判 SKIP 而不是 PASS**。
3. **WARN 不是 FAIL**：同一指纹连按 ≥3 次会打印一行提醒。修的时候还改掉一个比较 bug
   （`run[-1][0] == key` → `run[-1] == key`），否则这行永远不会触发。

牙在 `test/report-answer-gate.test.js`（5 条）与 `test/report-verdict.test.js`（夹具补了按压证据）：
把旧逻辑塞回去会红，把修复后的正常情形误判成红也会被抓。

## 6. 复跑

```bash
python3 support/full-game/check-delivery.py     # 清单 + 锁字节
python3 support/full-game/run-full.py           # 整局 + 自动 PASS/FAIL
python3 support/full-game/clean-checkout.py     # 空目录模拟干净检出（会跑全量测试 + 整局）
python3 support/full-game/make-candidate.py     # 只打印根提交对象 id（不移动分支、不 push）
# 发布形状（快进到 master 之上，不删已有文件）：
python3 support/full-game/make-candidate.py --onto origin/master --branch release/3278-narrow-slice

# 换视口（默认 390×844；输出目录必须是不存在的新名字，上例里已用过的名字会被拒绝）
env OUT_NAME=OUT-W-360 VIEWPORT_W=360 VIEWPORT_H=640 python3 support/full-game/run-full.py

# 判一局已保存的记录（不需要浏览器）：
python3 support/full-game/report-full.py support/full-game/OUT-T-390-gate
```

`run-full.py` 的卫生检查：新 OUT 目录必须不存在、单次使用、端口先查空闲、
结束后核验**本进程自己的** Chrome 已归零（不拿宿主总进程数当判据）、profile 与临时树都删除。
只连 127.0.0.1，不出网。

**端口不再写死，而且三处一起看**。以前三个号是常量，于是两个检出同时验收时，
抢输的那一方看到的是“http port 8041 not bindable after 90s”——把“别人正在用”说成“量具坏了”。
真实发生过：一次外部复验撞上正在跑的整局，失败且只打印了部分 stdout。
现在偏好值（8431/19549/19649）里**任一个**被占用就三个一起换（向系统要新口，彼此保证不同），
并打印 `PORTS preferred … busy ([…]); asked the OS for …`，实际用的号写进 `OUT/ports.json`；
要指定具体端口用 `RUN_PORTS=http,cdp,verify`。

**为什么三个都要看**：`verify` 端口是在整局跑完**之后**才绑的。第一版只检查前两个，
单独占用它时一局会照常跑完 45 秒、再在最后一步失败——对外部验收者来说是最坏的一种迟到失败。
`test/acceptance-ports.test.js` 真占用 verify 端口复现这个情境，
把旧的两项检查塞回去它会红（已实测）。

从**发布分支**复跑（不依赖当前工作树；`/tmp` 下任意空目录）：

```bash
git worktree add --detach /tmp/try <发布分支>
cd /tmp/try
node --test test/*.test.js
# 以前这一步要手工 `mkdir -p .scratch && cp support/compare/* .scratch/`。现在不需要了：
# support/serve-variant.py 把字面 URL `/.scratch/…` 映到 support/compare/，
# 所以在完全没有 .scratch 的树里套件仍然全绿（测试断言的是 URL，不是磁盘上的 .scratch）。
OUT_NAME=OUT-a python3 support/full-game/run-full.py
```

这两步要真分开跑：`run-full.py` 拒绝已存在的 OUT，而 `OUT_NAME` 只能由环境传入。

从**根提交**复跑（回答的是另一个问题：交付集自不自成一体）：

```bash
c=$(python3 support/full-game/make-candidate.py | awk '/^COMMIT/{print $2}')
mkdir -p /tmp/try && cd /tmp/try && git -C <你的仓库> archive "$c" | tar -x
```

根提交抽出的就是交付集本身 —— 不带 `master` 的历史，也不带清单外的任何东西。
