# 实现结构

## 当前切片入口（2026-11-13）

街角生意的规则及验证以 [6_SLICE.md](6_SLICE.md) 为准。既有完整模式继续保留，本文件下文记录其基础结构。

- `src/data/slice.js`：精简地图、五卡定义、补给和开局配置；不向旧 12 图目录增加伪完成项。
- `src/engine/flow.js` / `game.js`：同一真实回合引擎，按 `config.mode === 'slice'` 启用明确的切片规则。
- `src/engine/insight.js`：只读落点枚举、风险说明和合法目标，供界面与 AI 共享；不读未来 RNG。
- `src/engine/slice-ai.js`：公开信息 AI，按风格偏好及当前经济机会选卡、选补给、选路。
- `src/ui/slice.js`：资金/资产回顾、卡片清晰文案与结算解释；`main.js` 接入实际交互，旧完整设置折叠保留。
- `src/debug/session.js` + `tools/play.mjs`：引擎 `ui.ask` 的可暂停 JSONL 调试适配器，支持只读观察、带 promptId 的回答和 AI 推进。
- `tools/evaluate-slice.mjs`：各实际座次排列的批量实验；证据在 `docs/evidence/slice-benchmark.json`。

Node DOM 适配器测试执行真实入口与选择处理；它验证接线与生成文案，不验证浏览器布局。切片体验时长也在 `src/data/experience.js` 统一配置。

## 完整模式实现基线

> 三层文档分工：`3_REQUIREMENT.md` 是玩法设计，`5_PRODUCT.md` 是体验设计，本文件是**架构设计**。本文件只讲数据、模块、状态和执行顺序，不讲主题、配色和动效观感。

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
| `src/main.js` | UI 事件、开局、热座、飘字、目标选择、AI/移动停顿 |
| `src/engine/game.js` | 状态创建、卡片/神仙/经济/地图效果等规则内核 |
| `src/engine/flow.js` | 回合引擎：异步大循环、逐格移动、落点顺序、UI 选择 await |
| `src/engine/board-v2.js` | 图模型辅助：邻接、校验、移动、死路反弹、机关板 |
| `src/engine/economy.js` | 租金、买价、资产、付款、租金进存款 |
| `src/engine/map-runtime.js` | 地图动态边、地形、区域、定时机制 |
| `src/engine/rng.js` | 种子 RNG |
| `src/data/tuning.js` | 全部金额、概率、天数、倍率和上限 |
| `src/data/experience.js` | 体验时长唯一来源：逐格、AI、飘字、新闻、气泡/语音 |
| `src/data/maps/grand-hotel.js` | 默认产品图：27×19，中心 3×3 大酒店、四角 6 入口 2×2 大地产、初始无主建筑 |
| `src/data/maps/index.js` | 12 张产品地图注册表 |
| `src/data/maps/variants.js` | 雪国、云上庭院等 11 张地图变体与机制参数 |
| `src/data/maps/grid-manor.js` | 旧 25×17 测试地图；只用于回归 |
| `src/data/maps/test-manor.js` | 旧环图测试数据，只用于回归测试 |
| `src/ui/render.js` | 网格棋盘、侧栏、日志、底部情境区、tooltip |
| `src/ui/voice.js` | 本地 mp3 语音、8 声线 + 角色音高/语速、中文回退、串行语音队列 |
| `src/ui/speech.js` | 对话气泡队列、token 定位、空格/点击跳过 |
| `test/*.test.js` | 规则/流程/体验时长测试 |

## 地图实现：12 张产品图

12 张产品地图共享网格、回合和结算流程；大酒店是默认图，其余地图通过机制数据和通用原语区分。

- 新地图 `grand-hotel`：27×19，中心 3×3 大酒店，外圈、内环、四条放射路、四角小环路。
- `plot.cells` 是权威包围盒；渲染按 `min/max` 计算宽高，不再使用 `plot.big ? 2 : 1`。
- `plot.price` 可覆盖默认地价；初始已建地产的价格写在 `initialProperties` 里。
- `initialProperties` 在 `createGame` 时物化为 `ownerId: null` 的 `state.properties`，保留 `level/bigType/price`。
- `rentFor` 对无主地产返回 0；`buyPlot` 继承等级和建筑类型。
- 动态边、区域、定时规则通过 `map-runtime.js` 的通用钩子执行。
- 旧图 `grid-manor` 只保留为回归数据；选图列表是 12 张产品图。

验收测试：

- 大酒店 `validateMap` 通过；中央 3×3 有 12 个相邻路面格。
- 3×3/2×2 的包围盒宽度正确；渲染不重叠。
- 初始已建地产未买下时租金为 0，买下后等级/类型不变。
- 默认地图和旧地图都能完成一局。

## 地图模型（当前）

当前有 12 张产品地图，统一由 `src/data/maps/index.js` 注册；`grid-manor`/`test-manor` 只用于回归。

`GRAND_HOTEL`：

- `w/h/cell`：27×19，格 44px；外圈、内环、四条放射路、四象限小环路。
- `zones`：只有狂欢节地图使用四象限色块表示当天加成区；大酒店不使用装饰色块。
- 中心 `plot_b5` 是 3×3 大地产，四周 12 个路面格与它相邻；四角 `plot_b1..b4` 是 2×2，每个有 6 个邻接路面。
- `plots` 的 `cells` 可以是 1、4 或 9 格；`big` 标记大地产；`street` 用于连锁租金；`plot.price` 覆盖默认地价；`plot.name` 用于 tooltip 和地图叙事。
- `initialProperties` 在开局物化为无主已建地产：中央大酒店 Lv.3 大饭店、两块四角 Lv.2 大建筑、外圈/内圈散布 Lv.1–2 小房屋。无主地产租金为 0，买下继承等级和类型。
- `nodes.adjacentPlots` 是四邻接的地产 id；`centerFront` 标记 12 个中心入口；地产格不是 `nodes`，不可走。
- `facility`：医院/监狱侧路入口；地图有上下两个传送门死路。

当前能力：

- 矩形大地产：`cells` 驱动包围盒，渲染按 `min/max` 计算宽高，3×3、2×2 都是一整块。
- 初始地产：已物化、可买、可继承等级/类型；未买下不产租金。
- 地图 AI：会评估邻接地产和中心大酒店，会买中心；会把封闭边当作不可走。
- 地图机制：冰面滑行、暴雪/云桥/涨潮封边、齿轮换路、昼夜租金、潮汐、坡道、风暴、节日区、节拍、四季、火山喷发。

## 地图引擎 v2（数据/运行时基础已实现，视觉差异化仍可扩展）

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
| 地形表面 | 冰面滑行、坡道步数、水面/熔岩/云面视觉 | 地形影响更多落点与估值 |
| 矩形大地产 | 已有 2×2、3×3，cells 驱动包围盒 | 1×2 到 3×3 的整块矩形 + 校验 |
| 初始地产 | 大酒店已有无主已建小房屋/大建筑 | 小房屋、大建筑、公园、中立地标 |
| 动态边 | 按天封闭边（暴雪/云桥/潮汐/宵禁/齿轮） | 边组开关、单向边、换路 |
| 地图定时规则 | 已有 10 种地图的日级 tick | 更多阶段与组合 |
| 区域加成 | 节日区租金、季节/昼夜租金和商店倍率 | 巡游区、名所、乐章区 |
| 地图校验 | 12 张图连通、医院/监狱侧路；单测覆盖初始地产 | 初始地产、动态边、地形、地标、矩形的完整校验器 |
| 地图渲染 | 包围盒、初始建筑、中心入口、地形底色 | 关闭边、区域高亮 |

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

## 体验层接口（当前）

体验设计规定“看到什么、等多久”，实现把所有时长收在 `src/data/experience.js`，不散落在 `flow.js`、`render.js` 和 CSS 里。CSS 动画通过 `main.js` 写入的 `--step-dur` / `--float-dur` / `--news-dur` 读取同一组值。

```js
ui.render(state)
ui.ask(prompt) -> Promise<value>                 // 先 flushSpeech()，AI 再按 350/500ms 停顿
ui.step(state, player, cell) -> Promise<void>    // 等 300ms，再等气泡结束
speech.say(player, event, text?) -> Promise<void> // 气泡 + 语音，气泡结束才 resolve
speech.flushSpeech() -> Promise<void>            // 队列清空
voice.speak(player, event, text?) -> Promise<{audio, text}> // 单句语音，串行
```

规则：

- 逐格移动 300ms；AI 相邻动作 350ms，读信息动作 500ms（`AI_INFO_PROMPTS`）；飘字和新闻 2400ms。
- 气泡/语音是一条串行队列：同一时间只有一个气泡；台词只抽一次，气泡和 `speak` 共用同一句 `VOICE_LINES` 文本。
- 气泡跟随说话者 token 的屏幕坐标，fixed 定位挂到 body，不参与棋盘 `transform: scale()`；上方空间不足时翻到下方，尾尖始终指向 token。
- 气泡最多两行；点击或空格提前关闭；有语音时语音结束再停 0.3s，无语音 1.8s，静音 1.2s。静音状态由 `voice.setMuted()` / `localStorage['monopoly11:muted']` 控制。
- 本地 mp3 优先；台词不包含角色名和冒号；20 名角色使用 8 个中文声线加各自音高/语速。只有浏览器存在中文语音时才回退 `speechSynthesis`，且整句朗读，不逐字读中文。自动播放被拦截或素材缺失时按无语音时长 resolve，流程不会挂住。
- `speak` 返回 Promise 并进入语音队列；提前关闭时 `stopSpeech()` 让当前 Promise 立即 resolve。
- `flow.js` 不改暂停点；UI 在 `ui.ask` 和 `ui.step` 继续前 `await flushSpeech()`，所以金钱、卡牌、状态、神仙、监狱、医院台词期间引擎不会继续下一步。
- 人类玩家不额外等待 AI 停顿，但点完按钮后仍等当前气泡结束。
- `prefers-reduced-motion` 关闭飘字和气泡的出现动画，不改变语义等待时长；飘字仍在 2.4s 后由 JS 移除，文字仍然可见。

当前债务：地图机关状态显示未接；买地/建造由 `flow.js` 调用 `ui.say`，其余暂停统一收口在 UI 的 `ask`/`step`。新闻/事件已经通过 `state.lastNews` 触发 2.4s 侧栏横幅。

## 测试覆盖

测试覆盖地图校验、空地开局、买地/升级、街区倍率只算小房屋、彩票号码保留与奖池累计、飞弹进医院、测试卡组复制到所有玩家、强制付款顺序、队友建造、机器工人升级队友建筑、异步整局能结束、流程测试中的一局无残留 pending，以及体验时长表、AI 350/500ms 分类、整句台词和无声环境下的 `speak` resolve。

## 状态、提示与颜色

人物状态存在 `p.god/godDays`（绑定）、`p.status/statusDays`（人物，乌龟/梦游/冬眠/冰冻）、`p.jail/hospital`（物理）。侧栏玩家行用三个 `.slot` 显示图标和剩余天数；`beginTurn` 处理状态倒计时，梦游/冬眠跳过回合，乌龟限制每次走一步，冰冻保留 0 点规则。地块同时带 `road-stop`/`road-pass`/`occ-stop`/`occ-pass` 类，CSS 用实线/虚线、明暗和透明度区分四种组合，不使用高饱和红蓝。地块的 `title` 分别挂在 `.gicon`（路面）和 `.occs`（路面上的东西）上，空路面没有图标也没有提示；人物行 `title` 列出该角色两个天赋的名称与说明。方向指针用 `--c` 跟随角色颜色并加长到 9px。

卡片的角色目标范围集中在 `TARGET_RANGE_5`，玩家选择器只列 5 步内目标；地块目标由卡牌定义，购地、换屋、改建、工程车、怪兽和机器工人不再使用统一的 5 步限制。免费卡、同命卡、转移卡、无懈卡是灰色不可主动使用的被动卡；免费卡在单次付款达到 10,000 时询问是否消耗，Node 测试环境没有窗口时自动消耗。魔法屋的菜单、合法目标与结算以 `3_REQUIREMENT.md` 的六选一为准，入口是 `magicFlow`，目标选择复用同一套 `ui.ask` 目标流程。


## 当前完成度与债务

已实现：回合循环、逐格移动、方向、地产买卖/加盖/租金、现金存款/付款/破产、银行、股票、乐透、商店/研究所/神秘人、魔法屋、新闻、医院、监狱、传送、障碍、52 张卡、10 位神仙、7 种大建筑、4 名角色 × 3 档、6 个五卡合成、12 张地图、AI、SVG 素材、本地 Edge TTS。

仍是债务：

- 12 张地图已注册并可被 AI 打完；地图视觉仍主要复用大酒店骨架，逐图美术不是完整独立场景。
- 16 名角色天赋和 4 名角色 × 3 档已接入。
- 6 个五卡合成已实现，并可通过商店/卡片格/书店自然达成。
- 4 名角色 × 3 档已接入。
- 10 位神仙已有可观察效果、持续时间和免疫关系。
- 地图 AI 会把封闭边当作不可走，但还不会主动利用地形/区域做长线规划。
- 当前 `node --test` 96 项，覆盖体验、规则、融合、神仙、角色档位、12 张地图与初始地产。
- 平衡、移动端和发布已进入当前版本；长期平衡仍可继续。

## 当前文件事实

- `createGame` 从 `map.initialProperties` 物化无主地产；没有 `initialProperties` 的旧图保持全空地。
- `src/engine/flow.js` 的移动循环逐格 `await ui.step`；进入岔路时 `chooseStep` 先 `await ui.ask({type:'direction'})` 再走下一格。落点顺序为 `landingPhase → groundPhase → postGodPhase → directionPhase`。
- `src/ui/render.js` 用 `plot.cells` 的 `min/max` 算包围盒；3×3 与 2×2 都按整块渲染。
- `src/ui/icons.js` 的 `structureSvg` 现在为 6 种大建筑 × 5 级、1 种小房屋 × 5 级、公园 1 种；矩形大地产需要按宽高缩放，不改变内部比例。
