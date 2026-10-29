# 实现结构

本文件记录代码的组织方式，供后续接手者不靠对话记忆也能继续。规则口径以 `3_REQUIREMENT.md` 为准；本文件只讲实现。

## 运行

```bash
python3 serve.py          # no-store 静态服务，端口 8000
# http://127.0.0.1:8000/
node --test
node src/sim.js --games 100 --seed 1
node src/sim.js --games 50 --seed 3 --boss doctor --tier 3
```

- 无构建步骤、无运行时依赖。
- `serve.py` 禁止缓存；改 JS 后刷新即可，不会被旧模块顶掉。

## 目录

| 路径 | 作用 |
|---|---|
| `index.html` | 单页入口；右侧栏 + 棋盘 + 开局层 |
| `styles.css` | 全部样式；网格、侧栏、卡片、日志 |
| `src/main.js` | UI 事件、开局、热座、飘字、目标选择 |
| `src/engine/game.js` | 状态创建、卡片/神仙/经济/地图效果等规则内核 |
| `src/engine/flow.js` | 回合引擎：异步大循环、逐格移动、落点顺序、UI 选择 await |
| `src/engine/board-v2.js` | 图模型辅助：邻接、校验、移动、死路反弹、机关板 |
| `src/engine/economy.js` | 租金、买价、资产、付款、租金进存款 |
| `src/engine/rng.js` | 种子 RNG |
| `src/data/tuning.js` | 全部金额、概率、天数、倍率和上限 |
| `src/data/maps/grid-manor.js` | 当前 25×17 网格地图（路面/地产/街区） |
| `src/data/maps/test-manor.js` | 旧环图测试数据，只用于回归测试 |
| `src/ui/render.js` | 网格棋盘、侧栏、日志、底部情境区、tooltip |
| `test/*.test.js` | 12 项规则/流程测试 |

## 地图模型

`GRID_MANOR`：

- `w/h/cell`：25×17，格 44px。
- `nodes`：所有路面格；`id = "x,y"`；`kind` 为路面类型；`x/y` 为像素坐标；`adjacentPlots` 是四邻接的地产 id。
- `edges`：路面正交邻接，用于移动与图算法。
- `plots`：地产；`cells` 为 1 或 4 个格子坐标；`big` 标记 2×2；`street` 用于连锁租金；没有名字或编号，只有内部 id。
- `facility`：医院/监狱侧路入口。
- 地产格不是 `nodes`，不可走；只通过 `adjacentPlots` 与路面关联。
- 死路不要求传送门；移动在度数 1 处取唯一出边，原路反弹。

## 场景状态

`createGame(config)` 返回纯对象：

- `players[]`：现金、存款、卡、位置、朝向、槽、地产、状态。
- `map`：上面的地图对象。
- `properties{}`：key 为 `plotId`；值 `{ownerId, level, big, bigType, street, closed, inflate}`。
- `placements{}`：key 为路面 id；值 `{kind, name?}`；每格最多 1 个。
- `rng`：种子 RNG；规则层只通过它取随机。
- `pending`：只属于 UI 的显示状态，用来显示选择面板；引擎流程由 `flow.js` 的 `await ui.ask()` 驱动。
- `shopOffer[]`：`{id, price}`；买过立即从数组删除。
- `lottery`：`{tickets[], sold[], jackpot, lastDrawDay}`。
- `stats/log/lastRoll`：统计与 UI。

## 回合与结算

入口是 `runGame(state, ui)`，一个异步大循环：`beginTurn` → `playTurn` → `nextPlayer`，直到 `state.over`。`playTurn` 按顺序 `await` 行动阶段、掷骰、逐格移动、落点、相邻地产、事后神、方向；没有 `endTurn`/`advanceTurn`，也没有哪个普通处理函数能中途换人。

`ui` 只提供 `render(state)` 和 `ask(prompt) => Promise`。银行、商店、买地、加盖、大建筑、方向、卡牌目标都通过 `await ui.ask` 等待玩家；银行存取在 `bankFlow` 里循环，存/取不结束移动，只有离开才返回移动循环。移动由 `movePhase` 逐格 `await`：每格先处理经过道具，再处理银行/乐透/卡片，死亡就返回，不处理后续格。落点后依次 `landingPhase`、`groundPhase`、`postGodPhase`、`directionPhase`；这些函数只返回状态，不负责换人。

## 经济

- `pay(state, from, to, amount, reason)`：金额为 0 直接成功；免费卡抵消；现金不足按破产；`reason === '租金'` 时金额进入 `to.deposit`，否则进 `to.cash`。
- `rentFor`：按 `plotId` 取地产；空地面租金为零；同街连锁只数同一所有者已建的小房屋；大建筑乘数；物价；关门/涨价修正。
- `buyPrice`：小地产 8000，大地产 20000；买入后小地产 `level=0`，大地产 `bigType=null`，下一次投资才建房。
- `assetsOf`：现金 + 存款 + 地产估值。

## 界面实现

侧栏由 `#system`、`#players`、`#log` 和 `#hand` 四段组成，宽度由 `--side-w` 控制，默认 390px；`#sideGrip` 拖动这个变量，`#desk` 和 `#side` 同时跟着变，松手后重绘棋盘。`renderHand` 在没有 pending 时画骰子行和卡片行，有 pending 或 `state.mapPick` 时给 `#hand` 加 `.choice`，让 `#choice` 变成全宽块并画选择面板。

方向选择由 `ui.ask({type:'direction'})` 驱动，main 把它映射成侧栏提示和地图高亮，点路面调用 `actions.direction` 并 resolve。卡牌目标由 `ui.ask({type:'target', kind})` 驱动：`kind='cell'` 点路面、`kind='plot'` 点地产、`kind='street'` 点地产取街区、`kind='player'` 点角色。`state.mapPick` 只负责渲染高亮，不承担引擎流程。

商店、神秘人和研究所用 `.shop-grid` 的 `repeat(auto-fill, minmax(62px, 1fr))` 自动排列；`.shop-card` 是方形卡面加价格，不渲染卡名和效果，名字与说明放在 tooltip。手牌间距按数量动态计算，少时散开，多时负 margin 加轻微旋转，不横向滚动。

棋盘由 `renderBoard` 画路面 `.cell` 和地产 `.prop`；大地产只画一个 2×2 `.prop`，路面东西画在 `.occs`，人物 `.tok` 带方向指针。空白路面不渲染 `.gicon`，放置物默认占满整格；特殊路面和放置物同时存在时各缩到 70%，一个左上、一个右下叠放。金额飘字从 `[data-player]` 的 token 取 `getBoundingClientRect`，用 fixed 定位挂到 body。`main.js` 的 `actions` 是唯一 UI 到引擎的入口，`rerender()` 全量重绘。

## 事后神

`playTurn` 在 `groundPhase` 之后调用 `postGodPhase`，再调用 `directionPhase`。福神/天使先对相邻地产免费加层，己方大空地打开 `chooseBig`；凶神把本次落点里刚加盖的己方小房屋降一层；土地公最后收走所有非己方相邻地产，保留原有层数和建筑类型。

## 测试覆盖

测试覆盖地图校验、空地开局、买地/升级、街区倍率只算小房屋、彩票号码保留与奖池累计、飞弹进医院、测试卡组复制到所有玩家、异步整局能结束，以及流程测试中的一局无残留 pending。

## 状态、提示与颜色

人物状态存在 `p.god/godDays`（绑定）、`p.status/statusDays`（人物，乌龟/梦游/冬眠/冰冻）、`p.jail/hospital`（物理）。侧栏玩家行用三个 `.slot` 显示图标和剩余天数；`beginTurn` 处理状态倒计时，梦游/冬眠跳过回合，乌龟限制每次走一步，冰冻保留 0 点规则。地块同时带 `road-stop`/`road-pass`/`occ-stop`/`occ-pass` 类，CSS 用实线/虚线、明暗和透明度区分四种组合，不使用高饱和红蓝。地块的 `title` 分别挂在 `.gicon`（路面）和 `.occs`（路面上的东西）上，空路面没有图标也没有提示；人物行 `title` 列出该角色两个天赋的名称与说明。方向指针用 `--c` 跟随角色颜色并加长到 9px。

卡片的角色目标范围集中在 `TARGET_RANGE_5`，玩家选择器只列 5 步内目标；地块目标默认 5 步，机器娃娃 10 步。免费卡、同命卡、转移卡、无懈卡是灰色不可主动使用的被动卡；免费卡在单次付款达到 10,000 时询问是否消耗，Node 测试环境没有窗口时自动消耗。魔法屋的菜单、合法目标与结算以 `3_REQUIREMENT.md` 的六选一为准，入口是 `magicFlow`，目标选择复用同一套 `ui.ask` 目标流程。
