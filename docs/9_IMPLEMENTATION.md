# 实现现状

本文件记录“代码现在怎么工作”，供后续接手者不靠对话记忆也能继续。规则口径以 `3_REQUIREMENT.md` 为准；本文件只讲实现。

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
| `src/main.js` | UI 事件、开局、热座、动画、金钱飘字、目标选择 |
| `src/engine/game.js` | 规则内核：开局、回合、移动、落点、卡/神/建筑/商店/银行/乐透/股票/领主 |
| `src/engine/board-v2.js` | 图模型辅助：邻接、校验、移动、死路反弹、机关板 |
| `src/engine/economy.js` | 租金、买价、资产、付款、租金进存款 |
| `src/engine/rng.js` | 种子 RNG |
| `src/data/tuning.js` | 全部近似系数 |
| `src/data/maps/grid-manor.js` | 当前 25×17 网格地图（路面/地产/街区） |
| `src/data/maps/test-manor.js` | 旧环图测试数据，只用于回归测试 |
| `src/ui/render.js` | 网格棋盘、侧栏、日志、底部情境区、tooltip |
| `test/*.test.js` | 41 项规则/地图测试 |

## 地图模型

`GRID_MANOR`：

- `w/h/cell`：25×17，格 44px。
- `nodes`：所有**路面**格；`id = "x,y"`；`kind` 为路面类型；`x/y` 为像素坐标；`adjacentPlots` 是四邻接的地产 id。
- `edges`：路面正交邻接，用于移动与图算法。
- `plots`：地产；`cells` 为 1 或 4 个格子坐标；`big` 标记 2×2；`street` 用于连锁租金；没有名字或编号，只有内部 id。
- `facility`：医院/监狱侧路入口。
- 地产格不是 `nodes`，不可走；只通过 `adjacentPlots` 与路面关联。
- 死路不要求传送门；移动时 `walk` 在度数 1 处会取唯一出边（原路）继续走，即反弹。

## 场景状态

`createGame(config)` 返回纯对象：

- `players[]`：现金、存款、卡、位置、朝向、pendingDirection、槽、地产、状态。
- `map`：上面的地图对象。
- `properties{}`：key 为 `plotId`；值 `{ownerId, level, big, bigType, street, closed, inflate}`。
- `placements{}`：key 为路面 id；值 `{kind, name?}`；每格最多 1 个。
- `rng`：种子 RNG；规则层只通过它取随机。
- `pending`：当前选择（buy/build/direction/bank/stock/lottery/shop/research/magic/news/merchant/chooseBig）。
- `shopOffer[]`：`{id, price}`；买过立即从数组删除。
- `lottery`：`{tickets[], sold[], jackpot, lastDrawDay}`。
- `stats/log/lastRoll`：统计与 UI。

## 回合与结算

1. `startTurn`：天数+1、物价、月息、股票、乐透开奖、随机刷新路面东西、处理监禁/住院/跳过。
2. 回合开始弃牌到 8。
3. 行动阶段：用卡、股票、银行（若可用）。
4. `roll`：按载具取 1–3 骰；`walk` 沿 `edges` 移动；经过生效（银行/乐透/送卡/地面道具）；定时炸弹可主动送给追上的人。
5. `resolveLanding` 顺序：
   - `handleOccupant`：脚下东西（神仙/狗/乞丐/神秘人/道具）。
   - 路面类型：card/bank/lottery/shop/magic/news/tax/event/hospital/jail/teleport。
   - `adjacentPlots`：`resolveAdjacentPlots`，有主收租、队友免租、无主逐块入队、自己的地产加盖/大建筑选择。
   - `pendingDirection`：如果停在交叉点，记录方向选项，等以上结算结束后由 `endTurn` 弹出方向选择。
6. `endTurn`：如果本周期的落点还有 `landingCell`，先把相邻地产处理完；然后处理 `postGodCell` 的事后神；若当前玩家有 `pendingDirection`，再弹方向；否则换人。

## 经济

- `pay(state, from, to, amount, reason)`：金额为 0 直接成功；免费卡抵消；现金不足按破产；`reason === '租金'` 时金额进入 `to.deposit`，否则进 `to.cash`。
- `rentFor`：按 `plotId` 取地产；空地面租金为零；同街连锁只数同一所有者已建的小房屋；大建筑乘数；物价；关门/涨价修正。
- `buyPrice`：小地产 8000，大地产 20000（近似）；买入后小地产 `level=0`，大地产 `bigType=null`，下一次投资才建房。
- `assetsOf`：现金 + 存款 + 地产估值。

## 界面实现

侧栏由 `#system`、`#players`、`#log` 和 `#hand` 四段组成，宽度由 `--side-w` 控制，默认 390px；`#sideGrip` 拖动这个变量，`#desk` 和 `#side` 同时跟着变，松手后重绘棋盘。`renderHand` 在没有 pending 时画骰子行和卡片行，有 pending 或 `state.mapPick` 时给 `#hand` 加 `.choice`，让 `#choice` 变成全宽块并画选择面板；没有这个 class 时 `#choice` 会缩成右侧一条，商店和乐透都会变形。

方向选择由 `state.pending.type === 'direction'` 驱动：`renderBoard` 给合法路面加 `data-dir-cell`、高亮和箭头，点击调用 `actions.direction`。卡片点选由 `state.mapPick = { index }` 驱动：`actions.card` 遇到 `target === 'cell'` 时不弹选择器，地图所有路面加 `data-pick-cell`，点击调用 `actions.pickCell`，取消走 `cancel-pick`。这套机制也适用于后续新增的炸弹、障碍和其他选格卡。

商店、神秘人和研究所用 `.shop-grid` 的 `repeat(auto-fill, minmax(62px, 1fr))` 自动排列；`.shop-card` 是方形卡面占位加价格，不渲染卡名和效果，名字与说明放在 tooltip。手牌间距按数量动态计算，少时散开，多时负 margin 加轻微旋转，不横向滚动。

棋盘由 `renderBoard` 画路面 `.cell` 和地产 `.prop`；大地产只画一个 2×2 `.prop`，路面东西画在 `.occs`，人物 `.tok` 带方向指针。空白路面不渲染 `.gicon`，放置物默认占满整格；特殊路面和放置物同时存在时各缩到 70%，一个左上、一个右下叠放。金额飘字从 `[data-player]` 的 token 取 `getBoundingClientRect`，用 fixed 定位挂到 body。`main.js` 的 `actions` 是唯一 UI 到引擎的入口，`rerender()` 全量重绘。

## 事后神实现

`resolveLanding` 同时记下 `landingCell` 和 `postGodCell`，`endTurn` 先处理 `landingCell` 的相邻地产，再处理 `postGodCell`，最后才进入方向或换人。`state.landingBuilt` 记录本次落点里玩家自己加盖/建起的地产，供凶神判断“刚升级的房子”。`applyPostGods` 的顺序是：福神/天使先给相邻地产加盖，己方大空地打开 `chooseBig`；凶神再把本次刚建起的小房屋降一层；土地公最后收走所有非己方相邻地产，并保留原有的层数和建筑类型。空地由土地公收走时创建 `level=0` 的地产记录。

## 测试覆盖

测试覆盖地图校验、开局、同 seed 复现、整局无崩溃、48 卡不抛异常、同街指数租金、租金进存款、大空地/建筑选择、2×2 共享产权、乐透号码去重、商店买三张自动退出、死路反弹、方向不能回头、步行不能掷两颗骰、定时炸弹主动送出、新闻自动结算并继续相邻地产，魔法屋/乐透/商店落点各自打开正确面板，离开商店/银行/乐透/魔法屋后继续相邻地产，乐透一次只能买一注且号码全局唯一，果冻墙弹回两格、遥控骰子选范围目的地、机器娃娃沿路径清障、经过神秘人不触发、免费卡付款询问，买小地后保持空地、下一次才建第一层，大地产不增加小房屋街区倍率，以及破产后建筑保留、只清空归属。

## 状态、提示与颜色实现

人物状态存在 `p.god/godDays`（绑定）、`p.status/statusDays`（人物，乌龟/梦游/冬眠/冰冻）、`p.jail/hospital`（物理）。侧栏玩家行用三个 `.slot` 显示图标和剩余天数；`startTurn` 处理状态倒计时，梦游/冬眠跳过回合，乌龟限制每次走一步，冰冻保留 0 点规则。地块同时带 `road-stop`/`road-pass`/`occ-stop`/`occ-pass` 类，CSS 用实线/虚线、明暗和透明度区分四种组合，不使用高饱和红蓝。地块 `title` 由路面描述、路面上的东西描述和邻接地产数组合，空的普通路面不写描述。方向指针用 `--c` 跟随角色颜色并加长到 9px。

卡片的角色目标范围集中在 `TARGET_RANGE_5`，玩家选择器只列 5 步内目标；免费卡在付款时用 `window.confirm` 询问是否消耗，Node 测试环境没有窗口时自动消耗。无懈、转移等响应还没有完整的暂停/询问流程。

## 已知实现缺口

所有落点事件现在都通过 `landingCell` 在二次操作结束后继续相邻地产；冻结或冰冻的零点规则还没有状态来源。结盟、背叛、AI、16 张图、热斗和抢房还没有实现，体验层素材、语音和 BGM 也还没有接。数值全是近似值，乐透十天和银行三十天是暂定值。
