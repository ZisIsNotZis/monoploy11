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
| `test/*.test.js` | 26 项规则/地图测试 |

## 地图模型

`GRID_MANOR`：

- `w/h/cell`：25×17，格 44px。
- `nodes`：所有**路面**格；`id = "x,y"`；`kind` 为路面类型；`x/y` 为像素坐标；`adjacentPlots` 是四邻接的地产 id。
- `edges`：路面正交邻接，用于移动与图算法。
- `plots`：地产；`cells` 为 1 或 4 个格子坐标；`big` 标记 2×2；`street` 用于连锁租金；`label` 名字。
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
6. `endTurn`：若当前玩家有 `pendingDirection`，先弹方向；否则换人。

## 经济

- `pay(state, from, to, amount, reason)`：金额为 0 直接成功；免费卡抵消；现金不足按破产；`reason === '租金'` 时金额进入 `to.deposit`，否则进 `to.cash`。
- `rentFor`：按 `plotId` 取地产；同街连锁指数；大建筑乘数；物价；关门/涨价修正。
- `buyPrice`：小地产 8000，大地产 20000（近似）。
- `assetsOf`：现金 + 存款 + 地产估值。

## UI

- 侧栏 390px：`#system`（天数/物价/股票）、`#players`（一行式）、`#log`（flex 1）、`#hand`（情境区）。
- `renderHand`：无 pending 时渲染骰子行 + 卡片行；有 pending 时隐藏卡片/骰子，渲染 `#choice` 选择面板。
- 卡片间距按数量动态计算：少时散开，多时负 margin + 轻微旋转；不横向滚动。
- 棋盘：`renderBoard` 画路面 `.cell` 与地产 `.prop`；大地产只画一个 2×2 `.prop`；路面东西 `.occs`；人物 `.tok` 带方向指针；不写文字，tooltip 提供说明。
- `main.js` 的 `actions` 是唯一 UI → 引擎入口；`rerender()` 全量重绘。

## 测试覆盖

- 地图校验、开局、同 seed 复现、整局无崩溃、48 卡不抛异常。
- 同街指数租金、租金进存款、大空地/建筑选择、2×2 共享产权、乐透号码去重、商店买 3 自动退出。
- 死路反弹、方向不能回头、步行不能掷 2 骰、定时炸弹主动送出。

## 已知实现缺口

- 路面类型 + 相邻地产“同一次落点都结算”只对空路面完整；有 pending 的路面事件后会跳过部分相邻地产。
- 冻结/冰冻的 0 点规则没有状态来源。
- 结盟/背叛、AI、16 张图、热斗/抢房未实现。
- 体验层素材/语音/BGM 未实现。
- 数值全是近似；乐透 10 天、银行 30 天为暂定。
