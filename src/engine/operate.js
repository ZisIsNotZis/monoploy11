// #3468：「开门营业」—— 小店这条路线**自己的**一个动作，而不是又一条发钱规则。
//
// 为什么会走到这一步（前两轮的量死结论，别再重做）：
//   · 按店数 / 按层数每天发钱 = 给已经有地的人发钱，与**等额白给**分不开
//     （RESULT-3391y −22.7pp、RESULT-3457 −3.1pp）；它只是「钱变多」。
//   · 用现金买「加盖 → 每天进项」同样分不开：进项 − 白给 = −3.1pp [−5.3, −1.0]。
// 两次否定的共同点：那两条规则的**代价是钱**，而钱正是同一个记分单位 —— 于是任何
// 「花钱换进项」都会被同一个钱包统一成「钱的总量」，打法不可能变。
//
// 这一支换掉的正是那个前提：**代价是这一回合的移动**。你站在自己盖起来的店旁边，
// 可以放弃本回合的骰子去开门，按这条街自己的层数收一笔日营业额；
// 也可以照常掷骰，去抢书屋、去补地、去过发薪处。
//
// 为什么这个代价不能被「白给钱」复现：
//   · 放弃移动会同时放弃：过发薪处 +4,000、落地买地/加盖、走到书屋路口、躲开对手的店；
//   · 白给钱不会让对手多走一步，也不会让你少一次过路费；
//   · 所以对照臂（等额白给）与处理臂**结构上不同**，这一次它们分不分得开是一个真问题。
//
// 失手情形（屏上写得出来、玩家会撞到）：
//   · 站着不动 = 对手照常买地、抢书屋 —— 你收的固定钱不会因为对手变强而变多；
//   · 那条街被对手「停业」，当天营业 0（走停业卡是他们的正常动作）；
import { log, rentFor, incomeBonus, buyPrice, buildCost } from './economy.js';
import { reachableLandings } from './insight.js';
import { TUNING } from '../data/tuning.js';

// 默认档 900 是**量过的那一档**（RESULT-3468 §2b 扫 300–1,200，1,200 起 opSmart 到七成以上，
// 那是「钱变多」的开始了，所以排除高档）。地址栏 `?operate=1` 就是这一档：
// 「默认打开」必须与量过的那些局是同一个钱数，否则默认档测的是另一条规则。
// 上一版这里写 1,500、而所有读数都在 900 —— 两个数分家，默认档从没被任何一局量过（#3468 复核抓到）。
// 档位由 config.sliceOperatePerLevel 给；省略或 0 ⇒ 整条规则关闭，正式入口一个字节不变。
export const OPERATE_PER_LEVEL = 900;

// 地址栏解析与默认档放在同一处，就是为了不让它们再分家。
// 纯函数（不读 location）：可以直接测，不用起浏览器。
export function parseOperateParam(raw) {
  if (raw == null || raw === '' || raw === '0') return 0;
  if (raw === '1') return OPERATE_PER_LEVEL;
  const picked = Number(raw);
  return Number.isFinite(picked) && picked > 0 ? picked : 0;
}

export function operateRate(state) {
  const r = state?.config?.sliceOperatePerLevel;
  return Number.isFinite(r) && r > 0 ? r : 0;
}

// 站在哪条街旁边就能经营哪条街。
// 只认「已建成、己方、没被停业」的小店层数；书屋不算（它是另一条路，不该被这条规则顺带喂大）。
// 只读 state：不写、不读随机数 —— 按钮、AI、引擎三处调用它必须得到同一个数。
export function operateOffer(state, player) {
  const perLevel = operateRate(state);
  if (!state?.slice || !perLevel || !player) return null;
  const node = state.map.nodes.find(n => n.id === player.position);
  if (!node) return null;
  const streets = new Set();
  for (const pid of node.adjacentPlots ?? []) {
    const plot = state.map.plots.find(x => x.id === pid);
    if (plot && !plot.big && plot.street) streets.add(plot.street);
  }
  const rows = [];
  for (const street of streets) {
    const shops = state.map.plots.filter(x => !x.big && x.street === street);
    const mine = shops.map(plot => ({ plot, pr: state.properties[plot.id] }))
      .filter(({ pr }) => pr?.ownerId === player.id && pr.level > 0);
    if (!mine.length) continue;
    const open = mine.filter(({ pr }) => !(pr.closed > 0));
    const levels = open.reduce((a, { pr }) => a + pr.level, 0);
    const shut = mine.filter(({ pr }) => pr.closed > 0).map(({ plot }) => plot.name);
    rows.push({ street, levels, amount: levels * perLevel, shut, total: mine.length });
  }
  if (!rows.length) return null;
  // 一条街可能同时挨着（转角）；玩家按「收益最高的那条」结算，屏上也只报这一条，
  // 免得出现「按钮写 3,000 实收 4,500」那种两个真相。
  rows.sort((a, b) => b.amount - a.amount);
  const best = rows[0];
  if (best.amount <= 0) return { ...best, blocked: true };
  return best;
}

// 真正结算：金额只从 operateOffer 来，不在这里重算一遍（同一件事两份实现必然分叉）。
export function operateHere(state, player) {
  const offer = operateOffer(state, player);
  if (!offer) return null;
  if (offer.blocked || offer.amount <= 0) {
    log(state, `${player.name} 想开门营业，但 ${offer.street} 己方店面停业中，今天没有进项`);
    return { ...offer, paid: 0 };
  }
  player.cash += offer.amount;
  if (player.sliceStats) player.sliceStats.operate = (player.sliceStats.operate ?? 0) + offer.amount;
  log(state, `${player.name} 留在 ${offer.street} 开门营业：${offer.levels} 层 × ${operateRate(state)} = ${offer.amount}（本回合不移动）`);
  return { ...offer, paid: offer.amount };
}

// 玩家放弃的那一回合值多少：屏上要能把「代价」写成**具体的事**，而不是一句「你不能走了」。
//
// 为什么需要（supervisor 的判据就是这一句）：按钮上写的是「+900 · 不走」——这只说了**得多少**，
// 没说**放弃什么**。而这个项目的 #1144 已经立过同一条规矩：只说收益那一半，等于把决定的一半拿走。
// 上一版这里是死代码（`operateCostLine(state, player, bestLanding)`，没有任何调用点，
// bestLanding 也从没被传过），所以「代价」在屏上一直是空的。
//
// 这句话里每一个数都必须**是真会发生的事**，而且频次要量过，不能挑好听的说。
// 实测（support/probe-3468/cost-headroom.mjs，33 seed / 99 局 / 1,086 个营业时刻，档 900）：
//   6 步内会停在对手的店旁（要付租）  725/1086 = 66.8%，单笔最大 22,400
//   6 步内可给自家店加盖（现金够）    627/1086 = 57.7%
//   6 步内能过起点（+4,000）         415/1086 = 38.2%
//   6 步内有无主地可买（现金够）      202/1086 = 18.6%，最便宜的一块 8,000
// 所以顺序按「真会发生 + 金额大」排：付租 → 过起点 → 加盖 → 买地。最多写两条，
// 写多了这一屏会抢走真正要看的手牌（#1458 量过：多一行就把第三张卡顶出视口）。
//
// 三处口径是复核时逐项跟引擎对出来的（support/probe-3468/cost-headroom.mjs 只量频次，
// `.scratch/` 里的临时量具量口径）：
//   ① 步数窗口是 **1–TUNING.dieFaces（6）**，不是 `TUNING.maxDice` —— 后者是骰子**颗数**
//      上限（3），而切片是一颗六面骰。差 3 步时 280/280 个营业时刻的代价都被说窄了（110 个
//      把付租风险说小）。掷骰、AI 估值、这句话三处现在读同一个 `TUNING.dieFaces`。
//   ② 租是**停下来**才付的：`groundPhase` 只在移动结束时结算一次，`passPhase` 里路过别人
//      的店不收钱。所以措辞是「停到…要付」，不是「路过…付」——这句话不能把不会发生的事
//      写成代价。
//   ③ 「可买 N 块 / 可加盖 N 栋」只数**现金够得着**的：`buyPlot`/`buildPlot` 第一句都是
//      `if (p.cash < cost) return;`。不筛就会出现「可买 2 块」而现金只有 2,200（实测到过）。
//      两个口径的分母不同也照旧：买地/加盖看 p.cash，付租看 p.cash + p.deposit（付不起就是破产）。
//
// ④ 两个方向必须分开写（supervisor 真机第二轮）：原先四件事并在一句「营业的代价：…」里，
//    “停到对手的店旁要付 2,000”读起来像**营业要付这 2,000**。而它恰好相反：那是走出去的
//    风险，留下来就把这个风险避开了。两种东西必须各带自己的标签：
//      · 留下就错过 —— 走出去才能拿到的东西（过起点 +4,000、加盖、买地）；
//      · 走出去会 —— 留下来刚好避开的东西（停在对手店旁付的租）。
//    一旬混着写，玩家会算错方向；分开了，同两个数字就各自有意义。
//
// 一条也不适用时不沉默：照实说「这 6 步里买不起地、也过不了起点」——#1144 同一条规矩。
export function operateCostLine(state, player) {
  const offer = operateOffer(state, player);
  if (!offer || offer.blocked || offer.amount <= 0) return '';
  // 切片只掷**一颗**骰（`flow.js` 锁 diceCount=1），所以能走几步的上界就是骰面数。
  // 上一版拿 `TUNING.maxDice`（=3，完整模式的骰子**颗数**上限）当步数窗口，于是屏上说
  // 「掷骰 · 1–6 步」而代价只看 3 步 —— 实测 280 个营业时刻里 280 个窗口更窄、
  // 110 个把付租风险说小了。
  const steps = TUNING.dieFaces;
  const reach = new Set();
  for (let d = 1; d <= steps; d++) for (const id of reachableLandings(state, player, d)) reach.add(id);
  if (!reach.size) return '';

  let worstRent = 0;
  let canBuild = 0;
  let canBuy = 0;
  let salary = 0;
  const cash = player.cash ?? 0;
  const maxLevel = state.config?.maxLevel ?? TUNING.maxLevel;
  const seen = new Set();
  for (const nodeId of reach) {
    const node = state.map.nodes.find(n => n.id === nodeId);
    for (const pid of node?.adjacentPlots ?? []) {
      const plot = state.map.plots.find(x => x.id === pid);
      const pr = state.properties[pid];
      if (!plot || plot.big) continue;
      const ownerId = pr?.ownerId ?? null;
      if (!ownerId) {
        // 买得起才算「放弃了一块地」：引擎的 buyPlot 现金不够直接返回。
        if (!seen.has(pid) && state.day >= (plot.availableFromDay ?? 1) && cash >= buyPrice(state, pid)) {
          seen.add(pid); canBuy += 1;
        }
        continue;
      }
      if (ownerId === player.id) {
        const level = pr.level ?? 0;
        // 加盖价与 flow.js 的 buildPlot 同一套公式：big 固定 30,000，小店 buildCost(升级后等级)。
        const cost = Math.round((pr.big ? 30_000 : buildCost(level + (state.slice ? 1 : 0))) * state.priceIndex);
        if (!seen.has(pid) && level > 0 && level < maxLevel && !(pr.closed > 0) && cash >= cost) {
          seen.add(pid); canBuild += 1;
        }
        continue;
      }
      // 对手的店：停业时停过去不付租，所以不算代价。
      if (pr.closed > 0) continue;
      worstRent = Math.max(worstRent, rentFor(state, pid));
    }
  }
  // 起点：reachable 里出现起点格就说明这一回合本来能过上。
  if (reach.has(state.map.startId)) salary = incomeBonus(player, state.slice ? 4000 : TUNING.salary);

  // 两个方向分两桶：
  //   forgo = 留下来的机会（走出去才拿得到）
  //   risk  = 走出去会撞上的（留下来刚好避开）
  const forgo = [];
  if (salary > 0) forgo.push(`过起点${salary.toLocaleString()}`);
  if (canBuild > 0) forgo.push(`加盖${canBuild}`);
  if (canBuy > 0) forgo.push(`买地${canBuy}`);

  // 长度是量出来的，不是拍出来的（supervisor 真机两轮都在这一行上）：
  // 这一行实测在 1280×800 与 390×844 下恒为**一行**，用的是最坏字符组合
  // （两项机会 + 五位数租金 22,400）。两行不行 —— 1280×800 上第二行把第三张手牌的
  // 中心挤出视口（实测 elementFromPoint 不再是它），390×844 上被面板下边裁 3px。
  // 所以用短标签：「留下」= 错过什么、「走出」= 撞上什么，金额紧贴标签不留空格。
  const parts = [];
  if (forgo.length) parts.push(`留下就错过 ${forgo.slice(0, 2).join('、')}`);
  if (worstRent > 0) parts.push(`走出去会 停对手店付${worstRent.toLocaleString()}`);
  if (!parts.length) return `这 ${steps} 步里买不起地、也过不了起点`;
  return parts.join(' · ');
}
