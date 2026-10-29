# 实现结构

本文件记录代码的组织方式，供后续接手者不靠对话记忆也能继续。规则口径以 `3_REQUIREMENT.md` 为准；本文件只讲实现。

## 运行

```bash
python3 serve.py          # no-store 静态服务，端口 8000
# http://127.0.0.1:8000/
node --test
node src/sim.js --games 100 --seed 1
```

- 无构建步骤、无运行时依赖。
- `serve.py` 禁止缓存；改 JS 后刷新即可，不会被旧模块顶掉。

## 分层

```text
src/data/       角色、卡、地图、调参表；只放数据，不依赖 UI
src/engine/     纯 JS 状态与规则；不访问 DOM，不读浏览器 API
src/ui/         渲染与输入；只通过 main.js 的 actions 进入引擎
index.html      单页入口；不承载规则
```

- `flow.js` 是回合编排层，负责顺序和 `await ui.ask`；具体规则由 `game.js`、`economy.js`、`board-v2.js` 提供。
- `main.js` 是 UI 适配层：把引擎的 prompt 映射成侧栏面板和地图点选，把点击 resolve 成引擎可读的值。
- `render.js` 只读状态，不修改状态；`icons.js` 只生成 SVG 字符串。
- 地图是数据；地图引擎 v2 加入 `mapRuntime` 后，地图规则仍通过 `flow.js` 的通用阶段和原语执行，不直接操作 DOM 或玩家对象。
- Node 模拟复用同一套引擎，不经过 `main.js` 和 `render.js`。

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
| `src/data/maps/grid-manor.js` | 当前 25×17 网格地图；目标地图集见 3_REQUIREMENT 2.2.5 |
| `src/data/maps/test-manor.js` | 旧环图测试数据，只用于回归测试 |
| `src/ui/render.js` | 网格棋盘、侧栏、日志、底部情境区、tooltip |
| `test/*.test.js` | 15 项规则/流程测试 |

## 地图模型（当前）

当前只有 `src/data/maps/grid-manor.js` 一张可玩地图，另有 `test-manor.js` 只用于回归测试。

`GRID_MANOR`：

- `w/h/cell`：25×17，格 44px。
- `nodes`：所有路面格；`id = "x,y"`；`kind` 为路面类型；`x/y` 为像素坐标；`adjacentPlots` 是四邻接的地产 id。
- `edges`：路面正交邻接，用于移动与图算法。
- `plots`：地产；`cells` 为 1 或 4 个格子坐标；`big` 标记大地产；`street` 用于连锁租金。
- `facility`：医院/监狱侧路入口。
- 地产格不是 `nodes`，不可走；只通过 `adjacentPlots` 与路面关联。
- 死路不要求传送门；移动在度数 1 处取唯一出边，原路反弹。

当前实现只能表达静态地图：没有地形表面、没有初始地产、没有动态边、没有地图定时规则；渲染仍假设大地产是 2×2。这些是债务，不是目标模型。

## 地图引擎 v2（目标，未实现）

地图引擎的目标是让 12 张地图共享同一套回合和结算流程，同时各自拥有不同的路线、地形、初始局面和签名机制。地图文件是数据，不是第二套规则代码。

### 地图数据

地图对象至少包含：

```js
{
  id, name, w, h, cell,
  startAreas: [{ x, y, w, h }],          // 可选：限制随机落点范围
  nodes: [{
    id, x, y,
    kind: 'road' | 'bank' | 'shop' | ...,
    surface: 'normal' | 'ice' | 'water' | 'lava' | 'cloud' | 'mud',
    zone: 'zoneId' | null,
  }],
  edges: [{
    a, b, direction,
    oneWay: false,
    group: 'bridge-a' | null,            // 由地图规则开关的边组
  }],
  plots: [{
    id, cells: [{ x, y }],
    big: false,
    street: 'A',
    zone: 'zoneId' | null,
    footprint: { w: 2, h: 2 },           // 大地产的矩形；小地产为 1×1
  }],
  initialProperties: [{
    plotId,
    owner: null,                         // null = 无主；'neutral' = 中立地标，不属于地产
    level: 3,
    bigType: 'hotel' | null,
  }],
  landmarks: [{ id, nodeId, effect: 'manor' }],
  spawnTables: { road: {...}, day: {...} },
  schedule: [{
    id, when: { everyDays: 5, phase: 'dayStart' },
    effect: 'toggleBridgeGroup',
    args: { group: 'bridge-a' },
  }],
  rules: {
    rentModifiers: [{ zone, multiplier: 2 }],
    movementModifiers: [{ surface: 'ice', extraSteps: 1 }],
    shopModifiers: [{ zone, discount: 0.7 }],
  },
}
```

数据约束：

- 大地产 `footprint` 是矩形，默认 2×2；允许 1×2、2×1、2×3、3×2、3×3。`cells` 必须等于 `footprint` 覆盖的所有格，不重叠。
- `initialProperties` 只写初始状态，不直接写玩家对象；无主已建地产在买下前 `ownerId = null`，`rentFor` 返回 0。
- 中立地标不是地产，不进入 `properties`，不能被买卖；它的效果由 `landmarks` 和地图规则声明。
- 动态边只通过 `group` 引用，地图规则不能直接改写 `edges` 数组。
- 刷新表只影响数量与权重；签名机制必须落在路线、时间、估值或初始局面上。

### 地图运行时

`createGame` 在创建玩家后、进入第一回合前执行：

1. 深拷贝地图数据，建立 `state.mapRuntime`：`disabledEdges`、`surfaceOverrides`、`zoneState`、`timers`、`landmarks`。
2. 把 `initialProperties` 物化为 `state.properties`：空地/无主已建地产的 `ownerId` 为 `null`，等级和 `bigType` 保留。
3. 校验初始地产不重叠、不悬空、贴路，初始建筑类型合法。
4. 按地图规则注册定时器；定时器只存数据，不存函数。

`flow.js` 只在固定阶段调用通用钩子：

- `mapPhase(state, phase, player, ui)`：`dayStart`、`turnStart`、`pass`、`land`、`turnEnd` 五类。
- 钩子先读地图规则，再调用原语；原语包括：
  `move`, `teleport`, `pay`, `gain`, `addCard`, `spawn`, `despawn`, `setSurface`, `closeEdge`, `openEdge`, `setZone`, `raisePlot`, `lowerPlot`, `buryPlot`, `damage`, `log`.
- 地图钩子不能直接改 `state.players` 的字段，不能跳过付款顺序，不能重写落点顺序。
- 引擎中不允许出现 `if (map.id === '...')`；所有差异由数据、规则 id 和原语组合产生。
- 所有定时和随机都从 `state.day`、`state.rng` 取，固定 seed 必须复现。

### 当前需要补的引擎能力

| 能力 | 当前 | 目标 |
|---|---|---|
| 静态路面/地产 | 有 | 保留 |
| 地形表面 | 无 | `surface` 影响移动、租金、落点 |
| 矩形大地产 | 只有 2×2 | 1×2 到 3×3 的整块矩形 |
| 初始地产 | 全部为空 | 无主已建小房屋、大建筑、公园、中立地标 |
| 动态边 | 无 | 边组开关、单向边、换路 |
| 地图定时规则 | 无 | 按天/回合触发的开关、喷发、潮汐、换季 |
| 区域加成 | 无 | 巡游区、名所、乐章区 |
| 地图校验 | 基础连通 | 初始地产、动态边、地形、地标、矩形 |
| 地图渲染 | 静态 | 地形底色、初始建筑、关闭边、区域高亮 |

### 渲染

- `renderBoard` 的地产位置和大小从 `plot.cells` 的包围盒算，不再用 `plot.big ? 2 : 1`。
- 大建筑 SVG 按矩形宽高缩放，不拉伸内部线条；结构按落地轮廓绘制。
- 地形表面画在路面底色或边缘，不占放置物层；冰面、水、熔岩、云桥、坡道各有纹理和颜色。
- 关闭的边画断口；单行道画箭头；区域加成用地块边缘色，不刷满整格，避免遮住图标。
- 初始无主建筑和普通已建建筑使用同一套 SVG，区别只在归属色边框和 tooltip。
- 地图规则状态显示在侧栏顶部：当前天气、下一次喷发、开启的桥、当前巡游区、当前季节。日志记录规则触发。

### AI 与地图

AI 选择目标时要读 `mapRuntime`：

- 冰面、上坡、单行道、关闭边改变路径成本。
- 熔岩、洪水、风暴区提高风险权重。
- 巡游区、名所、神殿祝福提高地产估值。
- 初始无主已建地产按保留等级估值，不按空地估值。

### 测试

每张地图至少有一组地图校验测试：连通、贴路、矩形不重叠、初始地产合法、动态边引用存在、医院监狱侧路可达。地图规则原语要有单元测试：开关一条边、改变一格地形、触发一次喷发、结算一次区域加成、买入一块无主已建地产。无头模拟要能跑完 12 张地图，固定 seed 结果一致。

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

商店、神秘人和研究所用 `.shop-grid` 的 `repeat(auto-fill, minmax(62px, 1fr))` 自动排列；`.shop-card` 是方形卡面加价格，不渲染卡名和效果，卡名与说明放在 tooltip。手牌间距按数量动态计算，少时散开，多时负 margin 加轻微旋转，不横向滚动。

棋盘由 `renderBoard` 画路面 `.cell` 和地产 `.prop`；大地产只画一个 2×2 `.prop`，路面东西画在 `.occs`，人物 `.tok` 带方向指针。空白路面不渲染 `.gicon`，放置物默认占满整格；特殊路面和放置物同时存在时各缩到 70%，一个左上、一个右下叠放。金额飘字从 `[data-player]` 的 token 取 `getBoundingClientRect`，用 fixed 定位挂到 body。`main.js` 的 `actions` 是唯一 UI 到引擎的入口，`rerender()` 全量重绘。

## 事后神

`playTurn` 在 `groundPhase` 之后调用 `postGodPhase`，再调用 `directionPhase`。福神/天使先对相邻地产免费加层，己方大空地打开 `chooseBig`；凶神把本次落点里刚加盖的己方小房屋降一层；土地公最后收走所有非己方相邻地产，保留原有层数和建筑类型。

## 测试覆盖

测试覆盖地图校验、空地开局、买地/升级、街区倍率只算小房屋、彩票号码保留与奖池累计、飞弹进医院、测试卡组复制到所有玩家、强制付款顺序、队友建造、机器工人升级队友建筑、异步整局能结束，以及流程测试中的一局无残留 pending。

## 状态、提示与颜色

人物状态存在 `p.god/godDays`（绑定）、`p.status/statusDays`（人物，乌龟/梦游/冬眠/冰冻）、`p.jail/hospital`（物理）。侧栏玩家行用三个 `.slot` 显示图标和剩余天数；`beginTurn` 处理状态倒计时，梦游/冬眠跳过回合，乌龟限制每次走一步，冰冻保留 0 点规则。地块同时带 `road-stop`/`road-pass`/`occ-stop`/`occ-pass` 类，CSS 用实线/虚线、明暗和透明度区分四种组合，不使用高饱和红蓝。地块的 `title` 分别挂在 `.gicon`（路面）和 `.occs`（路面上的东西）上，空路面没有图标也没有提示；人物行 `title` 列出该角色两个天赋的名称与说明。方向指针用 `--c` 跟随角色颜色并加长到 9px。

卡片的角色目标范围集中在 `TARGET_RANGE_5`，玩家选择器只列 5 步内目标；地块目标由卡牌定义，购地、换屋、改建、工程车、怪兽和机器工人不再使用统一的 5 步限制。免费卡、同命卡、转移卡、无懈卡是灰色不可主动使用的被动卡；免费卡在单次付款达到 10,000 时询问是否消耗，Node 测试环境没有窗口时自动消耗。魔法屋的菜单、合法目标与结算以 `3_REQUIREMENT.md` 的六选一为准，入口是 `magicFlow`，目标选择复用同一套 `ui.ask` 目标流程。


## 当前完成度与债务

已实现：回合循环、逐格移动、方向、地产买卖/加盖/租金、现金存款/付款/破产、银行、股票、乐透、商店/研究所/神秘人、魔法屋、新闻、医院、监狱、传送、障碍、48 张卡、10 位神仙的部分效果、7 种大建筑、4 名角色 × 3 档的部分效果、AI、SVG 素材、本地 Edge TTS。

仍是债务：

- 12 张地图只完成 1 张；地图引擎 v2 的数据、运行时、校验和渲染都未实现。
- 32 个角色天赋中只有 14 个接入引擎。
- 6 个五卡合成没有实现。
- 4 名角色 × 3 档的部分技能还没有接入。
- 10 位神仙的部分效果还没有接入。
- 地图 AI 只按当前静态地图估值，不读地形、动态边或区域加成。
- 当前渲染仍假设大地产为 2×2；矩形大地产需要改渲染和结构 SVG 缩放。
- 当前测试 15 项，缺少地图规则、初始地产、融合、天赋档位和地图模拟测试。
- 平衡、移动端和发布按路线放到后续里程碑，不在当前范围。

## 当前文件事实

- `createGame` 建立 `state.properties = {}`；初始地产物化在目标引擎中实现。
- `src/engine/flow.js` 的移动循环逐格 `await ui.step`，落点顺序为 `landingPhase → groundPhase → postGodPhase → directionPhase`。
- `src/ui/render.js` 中地块宽度来自 `(plot.big ? 2 : 1) * S`，这是 2×2 假设，地图 v2 需要改为包围盒。
- `src/ui/icons.js` 的 `structureSvg` 现在为 6 种大建筑 × 5 级、1 种小房屋 × 5 级、公园 1 种；矩形大地产需要按宽高缩放，不改变内部比例。
