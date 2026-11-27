# Monopoly 11 · 大酒店

**项目状态 · 玩得完整，还不够好玩（2026-11-27）**。窄屏（390×844）已能从本文入口独立玩完整局并核到结算，
360×640 也能玩完但每回合要先整页滚一次（见下文）。产品判断仍未完成：
「爱玩」没有被人类试玩证明，完整模式的 12 张地图仍是保留资产而非本轮验收对象。

> 当前开发方向是「轻量、爱玩」的 vertical slice。打开页面优先进入 **街角生意**：三人、16 天、五种卡片和可选补给。
> 原有完整模式在「完整模式与自定义设置」中。当前目标见 [目标](docs/2_GOAL.md)，切片规则、验证与边界见
> [街角生意](docs/6_SLICE.md)。下文的大酒店内容介绍对应原有完整模式。

## 拿到并玩一局

```bash
git clone https://github.com/ZisIsNotZis/monoploy11.git
cd monoploy11
git pull --ff-only        # 已在本地有仓库时：快进到最新，不会生成合并提交
```

然后按下一节起一局。下面所有命令都在仓库根目录直接敲，不需要构建步骤或依赖安装。

> 维护者/审阅者要的提交形状、独立检出与两条验收路径，写在
> [RESULT-3278 §5](docs/evidence/RESULT-3278.md)，不放在玩家入口里。
> 要确认切片真能玩，请按下一节实跑一局而不是只读本文——360×640 的已知代价也写在下面
> （那一档要先整页滚一次才能点到掷骰与手牌）。

## 从干净检出玩一局（本次已复验）

```bash
python3 -B serve.py 0      # 打印 LISTENING <port>；端口交给系统分配，不占 8000
```

打开 `http://127.0.0.1:<port>/index.html?slice=1&style=grow&seed=1`。页面停在第一屏，
先在三张起手（街角店主 / 机会买家 / 穿街高手）里选一张，再点「开一局街角生意」。
三张卡上写着各自的开工现金（42,000 / 45,000 / 46,000）——差别写在屏上，不是隐藏属性。
三条起手实测胜率接近（每格 300 局，见 [RESULT-3330](docs/evidence/RESULT-3330.md)）；
“它们打法不同”靠卡表，“它们一样能赢”靠这个数。

- `slice=1` 进「街角生意」切片；`style=grow|take|cross` 预选起手；`seed` 固定随机序列。
- 不带参数打开会落在完整设置页（完整模式 12 张地图仍在）。
- 固定端口也可：`python3 -B serve.py 8000` → `http://127.0.0.1:8000/?slice=1&style=grow&seed=1`。

窄屏（390×844）已用真实鼠标点击走完整局并核对结算；360×640 也走完过两局，但那一档要先整页滚一次
才能点到掷骰与手牌，**不是同一结论**（回执 §5.1）。回执与复跑命令见
[RESULT-3278](docs/evidence/RESULT-3278.md)：

```bash
python3 support/full-game/run-full.py         # 跑一局，自动给 PASS/FAIL
python3 support/full-game/check-delivery.py   # 交付文件与锁字节是否一致
python3 support/full-game/clean-checkout.py   # 只复制交付文件到空目录，再从那里跑一局
python3 support/full-game/make-candidate.py   # 只打印把交付集做成根提交的 id（不动任何分支、不 push）
python3 support/full-game/make-candidate.py --branch candidate/3278-narrow-slice   # 同上，并把该分支指过去
python3 support/full-game/make-receipt.py support/full-game/OUT-<那次运行>   # 把一次整局的原始帧裁成可复判的精简回执
```

无浏览器调试（这两个脚本只依赖交付集里的模块，干净检出里可直接跑）：
`node tools/play.mjs --slice --seed 7`，逐行发送 `{"op":"auto","count":10}` 等 JSON；
策略实验 `node tools/evaluate-slice.mjs --seeds 20`。这些检查不能替代人类对乐趣的判断。

`tools/verify-*.mjs` 三个旧脚本硬编码了 Windows Edge 安装路径与 `.scratch` profile，
**不在交付集**，只适用于原来的开发机；窄屏整局的量具是 `support/full-game/`。

复判一局记录不需要浏览器：`python3 support/full-game/report-full\.py <那次运行的目录>`。
本次交付的那一局就在 `docs/evidence/receipt-3317-390/`（精简后的记录，257 KB 原始帧裁到 58 KB；
原始帧不入库，provenance.json 记着文件的 sha256 与裁掉了哪些字段）。
它会明确区分 PASS / FAIL / **SKIP**（这一局没走到那张屏，就不声称它被判过），例如 F6“可点 ⇔ 能接受回答”
这一项只对动作屏发言。

纯前端、零后端、零依赖的网格棋盘游戏。把《大富翁 11》的规则搬进浏览器，用 SVG 建筑、卡片和角色头像代替 3D 美术。

## 运行

```bash
python3 serve.py
# 打开 http://localhost:8000
```

`serve.py` 禁止缓存；改完 JS 刷新即可。也可以换任意静态服务器。

### 第二入口（8001 对照页）

对照页 `/.scratch/af-variant.html` 需要一个额外的静态服务，**唯一权威入口是 `support/serve-variant.py`**：

```bash
python3 -B support/serve-variant.py 8001
# 打开 http://127.0.0.1:8001/af-variant.html
```

`support/serve-variant.py` 与 `serve.py` 同一套内部目录拦截（但不拦 `.scratch` —— 对照页只能从那里取），
并且同样支持 `python3 -B support/serve-variant.py 0` 由系统分配端口（stdout 会打印 `LISTENING <port>`）。

> 历史：这个入口原先住 `.scratch/serve-variant.py`。`.scratch` 是例行清理的 ignored 目录，
> 2026-11-22 被清掉后，仍在跑的 8001 进程 argv 指向了一个已不存在的文件 ——
> 重启会直接失败。现在副本在 `support/`（随仓库走），`tools/verify-full-game.mjs` 与
> `tools/verify-grow-panel.mjs` 也都用 `support/` 的路径起服务。

## 现在能玩什么

- **大酒店地图**：27×19。中央是一块 3×3 的大酒店，四周 12 个路面格全部与它相邻；四角各有 2×2 大地产，被三条路包住，形成 6 个入口。
- 开局有 13 块无主已建地产：中央 Lv.3 大饭店、两块四角 Lv.2 大建筑、外圈和內圈的小房屋。买下前不收费，买下后继承等级和类型。
- 移动是逐格真实行走；进入岔路先选方向，停在岔路再定下回合朝向。死路反弹，传送门保留剩余步数。
- 回合：弃牌 → 用卡/银行/股票 → 掷骰 → 逐格移动 → 脚下东西 → 路面类型 → 相邻地产 → 方向。
- 买地、加盖、大建筑、街区倍率、租金、现金/存款、银行利息、股票、乐透、商店、研究所、魔法屋、新闻、神秘人、野狗、乞丐、医院、监狱、52 张卡、10 位神仙、7 种大建筑、4 名角色 × 3 档。
- 7 种大建筑各有不同收益：商业中心转盘租金，大饭店双倍租金并强制住店，书店产卡，能源中心提高对手买卡价格并收能源费，地产公司降低己方租金，研究所产进阶卡，公园不收费。
- 12 张地图：大酒店、雪国、云上庭院、机械迷宫、不夜天、水乡、山城、天使岛、狂欢节、音乐之都、锦绘时代、火山古迹；各有独立机制。
- 6 个五卡合成、10 位神仙、4 名角色 × 3 档、16 名角色天赋。
- 2–20 名参赛者，人类/AI 混排、任意队伍、热座；固定种子可复现。
- 右侧可拖宽侧栏；地图直接点选方向、卡片目标和障碍位置；金额/卡牌/状态飘字 2.4 秒。
- 角色说话时，地图 token 上方弹出漫画气泡，气泡和语音同句；游戏等气泡结束再继续。点击气泡或空格可跳过；没有中文语音时只显示文字。
- AI 动作之间有停顿；AI 会评估中心大酒店、邻接地产和对手建筑。

## 测试与模拟

```bash
node --test
node src/sim.js --games 20 --seed 1
node src/sim.js --games 20 --seed 3 --boss doctor --tier 3
```

## 部署

这是纯静态站点，没有构建步骤：

```bash
python3 serve.py
```

也可把仓库根目录直接交给任意静态服务器。`serve.py` 会给 JS/CSS 加 no-store，避免旧模块缓存。GitHub Pages 可直接使用仓库根目录；`.nojekyll` 已放置。

## 目录

- `docs/`：玩法设计（1–4）、体验设计（5）、架构设计（9）和路线（0）。
- `src/engine/`：规则内核，纯 JS，可在 Node 无头跑。
- `src/data/`：角色、卡、地图、调参表、体验时长。
- `src/ui/`：网格棋盘、侧栏、SVG、语音和气泡。

## 已知边界

- 12 张地图、6 个五卡合成、10 位神仙、4 名角色 × 3 档、移动端布局和静态部署已进入当前版本。
- 角色天赋、五卡合成、神仙完整效果和角色档位已接入；长期平衡仍可继续调。
- 租金、物价、利息、股票、彩票和事件金额是可调值，定稿不在本次范围。
- 素材全部本地生成；TTS 语音在 `assets/`，该目录被 gitignore。仓库不包含原版美术、音频、字体素材。
- 结盟不是本游戏的系统。

## 许可

AGPL-3.0，见 `LICENSE`。

## 声明

非官方、非商业同人项目，与软星/大宇无关。角色名、卡片名、地名仅作为规则事实引用。
