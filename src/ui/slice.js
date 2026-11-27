import { SLICE_CARDS } from '../data/slice.js';
import { assetsOf, rentFor, buyPrice, buildCost, cheapestBuyable } from '../engine/economy.js';
import { poolShareLine, poolKLine } from '../engine/payback.js';
import { supplyWorth } from '../engine/insight.js';
import { streetBusinessStatus } from '../engine/flow.js';
import { MARKET_LEDGER, MARKET_PLOT as LEDGER_MARKET_PLOT, holdLeversFacts, bigBuildCost } from '../engine/market-ledger.js';

export const money = n => Math.round(n).toLocaleString();
export const signed = n => `${n>=0?'+':''}${money(n)}`;
export function sliceCardDescription(id) {return SLICE_CARDS[id]?.desc??'';}
export function sliceCardName(id) {return SLICE_CARDS[id]?.name??id;}

// #1398：动作屏（每回合真正站在岔路口那一屏）的卡面，要写**这一局此刻**的数。
//
// 改前实测（真 Edge，`decisions.mjs` 24 局）：动作屏每局 28.5 次，比第二多的岔路屏
// （12.5 次）多一倍多；其中 18.5 次手上有可用卡。但卡面只有通用效果
// 「免费让己方一栋已建房屋升 1 级」——这一局能升哪几栋、单栋涨多少、
// 这张收购现在要花多少、哪条街开旺季对你最值，一个字都没有。
// 同样这些数在点开之后的面板上都有（`panel-target` 亲测），但玩家得先点进去才知道值不值。
//
// 所以：卡面写成「效果的第一句 + · + 盘面此刻的数」。
// 数字全部来自 supplyWorth（内部 rentFor / buyPrice），与补给屏同源，不另写估算器；
// 不读随机数、不改 state —— 这条由 test/slice-card-line.test.js 守着。
//
// 为什么是同一行而不是另起一行：在未改码的真实 DOM 上量过（.scratch/1398-understand/variant.mjs，
// 1280×800）：另起一行把 #cards 从 225px 撑到 269px，第三张卡中心落到视口外、elementFromPoint
// 命中不到（就等于拿「多一句」换掉「少一个选项」）。同一行内追加是 243px，第三张卡仍可命中。
//
// 第二点很关键：**一行之内**换掉推销句，不是追加。第一版是「效果全文 + 追加数字」，
// 真 Edge seed 7 grow 第 1 天实测把第三张卡从 bottom=830（中心可命中）推到 862（中心出视口，
// elementFromPoint 命中不到）—— 那就是拿「多一句」换掉「少一个选项」。
// 现在只留效果的第一句（机制本体），后面的推销句换成盘面数：字不增、行不增。
export function sliceCardLine(state, player, id) {
  const effect = sliceCardDescription(id);
  // 非切片局 / 拿不到玩家：只给通用效果，不编数。
  if (!state?.slice || !player) return effect;
  // 定步不产生金额，但「有几步可选」是这一屏真实的选择面。
  if (id === 'remotedice') return '本回合走几步由你选 · 1–6 步各自落到哪，点开就列出来';
  const w = supplyWorth(state, player, id);
  if (!w) return effect;
  // 取效果的第一句（到第一个「。」为止），丢掉通用推销尾巴。
  const head = effect.split('。')[0];
  if (id === 'worker') {
    if (!w.count) return effect;              // 没有可升的栋：交给「现在没有合法目标」那行说
    // 一张卡只升**一栋**（game.js 只改 pr.level +1），所以给区间而不是总和，也不写「每栋」。
    const lo = w.each[w.each.length - 1], hi = w.each[0];
    const each = lo === hi ? `单栋+${money(hi)}` : `单栋+${money(lo)}–${money(hi)}`;
    return `免费升己方一栋已建店 1 级（最高 3 级）· 现在可升 ${w.count} 栋，${each}`;
  }
  if (id === 'buyland') {
    if (!w.count) return effect;
    // #3332：这一屏必须分得开两种买卖，否则玩家拿同一个数比两个不同的东西。
    //   对手的店：125%，钱进对手口袋（他变富）；常常还是成对的街，抽一间把另一间
    //             的租金从 2,800 压到 2,000。
    //   空地：标价，钱离开牌桌，只买位置。
    // 旧文案只有一句「按标价 125% 收购别人的小店」，而合法目标里有 6/10 是空地 ——
    // 那句话对多数候选是假的，价钱也多算了 25%。
    const each = w.cheapest === w.dearest
      ? `每块 ${money(w.cheapest)}`
      : `每块 ${money(w.cheapest)}–${money(w.dearest)}`;
    // 书屋必须到场是规则（不能远程指定），这条不能为了省字删掉。
    // 「钱归原主」也不能省：这是这张卡与「走过去买空地」的唯一区别所在。
    return `买下别人已开张的小店，钱归原主；书屋须到场 · 现在能收购 ${w.count} 块，${each}`;
  }
  if (id === 'inflate' || id === 'close') {
    if (!w.best) return effect;
    // 这两张卡的词必须比原描述**短**，否则卡会长高一行、把第三张卡挤出可点范围。
    // 实测（take/seed5 D1）：原描述 3 行 → 加数后 4 行，第三张卡中心从 793 掉到 799.9，
    // elementFromPoint 直接命中不到。所以这里只留「机制 + 量」，不再重复括号里的双向账。
    // 对手可以封租 / 旺季计时照走 是真实规则，不能为了省字删掉。
    const mech = id === 'inflate' ? '整条街租翻倍 3 天，对手可封租' : '整条街停租 2 天，旺季计时照走';
    //
    // 为什么不写「最值 X 街」（第一版就是这么写的，已撤回）：
    // 点开后的面板按 **|对手租的变化|** 排序并只列前 4 条；streetsWorth.best 按**对我最优的 net** 取。
    // 两个排序键不同，实测 24 局 1366 帧里 **651 帧**给出不同的街（grow/seed1 D1：
    // 卡面说「晨光街」，面板第一条是「晚风街」）。那就是我亲手造的一处自相矛盾 —— 比原来的含糊更坏。
    // 而且「最值」遇上 net=0 的街会写出「最值 西巷：两抵」这种自打耳光的句子。
    //
    // 现在的写法只陈述**与面板同一批对象上的单调事实**：这些街每踩到一次，效果落在哪个区间、
    // 方向对谁。面板第一条必然落在这个区间里，所以两屏不会打脸；要具体哪条街，点进去看那 4 条。
    // 只报**上限一个数**，不报区间：区间要两个数，在 176.5px 宽的卡里会多占一行，
    // 而 c=0 的街（你这轮踩不到它）本来就不该参与「值不值」的比较，min 会把 0 拉进来。
    // 上限 = 这些街里对己方最有利的那一条，是「这条街上限就这么多」的事实，面板任一行的己方侧都不会超过它。
    const nets = w.rows.map(r => r.net);
    const hi = Math.max(...nets.map(Math.abs));
    if (!hi) return `${mech} · 现在这些街对你都是两抵，开了不动你的账`;
    const harmsMe = nets.some(v => v < 0);
    const helpsMe = nets.some(v => v > 0);
    // 方向按真实付款方（踩到的人付给地主），不是按卡名想当然；「每次」不能省（#554 已咬过人）。
    // 前缀统一是「每次」，所以这里只写方向词，不要再带一次「每次」（上一版出现过「每次对手每次少收」）。
    const dir = harmsMe && helpsMe ? '有的街对你有利、有的不利'
      : harmsMe ? (id === 'inflate' ? '你多付' : '你也少收')
      : (id === 'inflate' ? '你多收' : '对手少收');
    return `${mech} · 每次${dir}，最多 ${money(hi)}`;
  }
  return effect;
}

// #1398：翻修选目标屏——每个候选地升完之后是多少。
//
// 为什么需要：那一屏原先只说「免费让己方一栋已建房屋升 1 级」，地图角标只说**当前**租，
// 两个候选都写着「租 2,800」——玩家要拿这一屏做选择，却看不到升完会变多少。
// 数字全走 rentFor（升后等级读一次，立刻恢复），与引擎同源。
// 多个候选升幅不同时逐块列出（不写成「每间 +X」，那在升幅不同时会高估）；只有一个时用短句。
export function upgradeAfterLine(state, player, plotIds) {
  if (!state?.slice || !Array.isArray(plotIds) || !plotIds.length) return '';
  const rows = [];
  for (const id of plotIds) {
    const plot = state.map?.plots?.find(x => x.id === id);
    const pr = state.properties?.[id];
    if (!plot || !pr) continue;
    const before = rentFor(state, id);
    const saved = pr.level;
    let after = 0;
    try { pr.level = (saved ?? 0) + 1; after = rentFor(state, id); }
    finally { pr.level = saved; }
    rows.push({ name: plot.name, before, after });
  }
  if (!rows.length) return '';
  // 停业中：before/after 都是 0，算不出到手价 —— 照实说，不编一个数（沿用 #993 的口径）。
  if (rows.every(r => r.after === 0)) return '这条街正在停业，升完也收不到租，停业结束才兑现';
  const gains = new Set(rows.map(r => r.after - r.before));
  if (gains.size === 1 && rows.length > 1) {
    const g = [...gains][0];
    const lo = Math.min(...rows.map(r => r.before));
    const hi = Math.max(...rows.map(r => r.after));
    return `升完每间 ${money(lo)}→${money(hi)}（单栋 +${money(g)}）`;
  }
  const shown = rows.slice(0, 3).map(r => `${r.name} ${money(r.before)}→${money(r.after)}`);
  const rest = rows.length - shown.length;
  return `升完：${shown.join('，')}${rest > 0 ? ` 等 ${rows.length} 块` : ''}`;
}

// #1295：钱变了的**原因**必须在默认可见处。
//
// 现况（真 Edge 1280×800 实测）：侧栏只写「你上回合：资金 +2,000 · 资产 +2,000」，
// 原因全在 <details> 里要自己点开；而日志在动作屏上只有 39px 高、滚到底只看得到
// 「—— 第 3 天 · 街角店主的回合 ——」这一行。所以「钱为什么变」在屏上是不可答的。
//
// 这里只把**引擎自己已经写进日志的转账行**提到 summary 上，不另算、不新增数字。
// 为什么可以这样做：拿 30 种子 × 3 起手 = 90 局、1418 回合（其中 594 回合资金真变过）
// 逐回合对账，日志行累加与 lastTurn.money **100% 相等**（.scratch/1295-understand/coverage.mjs）。
// 两个坑：
//   ① 只认「实付租金」。「应付租金」是账单不是转账，破产时实付 800/应付 9,600，
//      按“应付”算会凭空多扣 5,800（seed 1 take D9 实测差 5,800）。
//   ② 对不上就不写。宁可仍让玩家点开折叠，也不把拼不齐的数说成明细。
const MONEY_MOVES = [
  { re: /^(\S+) 实付租金 (\d+)（([^）]+)），(\S+) 收到 (?:\d+)/, who: 1, money: 2, sign: -1,
    say: m => `向 ${m[4]} 付租 ${money(+m[2])}（${m[3]}）` },
  { re: /^(\S+) 买下 (\S+)（支付 (\d+)）/, who: 1, money: 3, sign: -1,
    say: m => `买下 ${m[2]} ${money(+m[3])}` },
  { re: /^(\S+) 向 (\S+) 支付 (\d+) 收购 (\S+)/, who: 1, money: 3, sign: -1,
    say: m => `收购 ${m[4]} ${money(+m[3])}` },
  { re: /^(\S+) 将 (\S+) 升到 Lv\.\d+（花费 (\d+)）/, who: 1, money: 3, sign: -1,
    say: m => `加盖 ${m[2]} ${money(+m[3])}` },
  { re: /^(\S+) 经过起点 \+(\d+)/, who: 1, money: 2, sign: 1,
    say: m => `过起点 +${money(+m[2])}` },
  { re: /^(\S+) 在(\S+)获得 (\d+)$/, who: 1, money: 3, sign: 1,
    say: m => `${m[2]}得 ${money(+m[3])}` },
];

// #1444：资金没变、但**资产变了**的那些回合也要写原因。
//
// 实测（611 帧动作屏，3 起手 × seed 1–8）：资金为 0 而资产变了的 44 帧（7.2%）**全部没有原因**——
// 因为下面那句 `!last.money` 直接返回 null。而这 44 帧正全是「免费翻修升一级」：
// 现金不动、地产标价 +4,000，屏上只写「资产 +4,000」，玩家看不出是翻了哪栋。
// `causegap.mjs` 证明 44/44 帧的日志里都有可提炼的来源，所以这不是数据缺失。
//
// 不改已签字符串：资金不为 0 时仍走原来那条路（逐字不变），只在资金为 0 时补资产侧。
const ASSET_MOVES = [
  { re: /^(\S+) 使用 翻修 → (\S+?)，升到 (\d+) 级/, say: m => `翻修 ${m[2]} 升到 ${m[3]} 级` },
  { re: /^(\S+) 将 (\S+) 升到 Lv\.(\d+)（花费 (\d+)）/, say: m => `加盖 ${m[2]} 到 Lv.${m[3]}` },
];

// 只在「资金 0 / 资产非 0」时用：从日志里挑出重估来源。没有任何一笔就不写（不编）。
export function assetCauseLine(last, humanName) {
  if (!last || !Array.isArray(last.lines)) return null;
  if (last.money) return null;          // 资金真的动过 —— 由 turnCauseLine 负责，不重复说
  const found = [];
  for (const raw of last.lines) {
    const text = String(raw).replace(/\s+/g, ' ').trim();
    for (const rule of ASSET_MOVES) {
      const m = rule.re.exec(text);
      if (!m) continue;
      if (String(m[1]).trim() !== humanName) break;
      found.push(rule.say(m));
      break;
    }
  }
  if (!found.length) return null;
  // 只在**资产确实向上**时用：这些行都是「升一级 = 标价 +N」的正向重估。
  // 若那一回合资产是跌的（例如资金净 0、里面既有买地资产下跌又有免费翻修），
  // 写「翻修 X 升到 2 级」会让人以为资产在涨 —— 方向说反比不说更坏。
  // 实测（`negcase`）：`assets -4000` + 这两行会输出「翻修 … 升到 2 级」，已改为不说。
  if (!(last.assets > 0)) return null;
  // 「条数 × 单级估值」至少要盖住资产涨幅，否则这幅账自己就不完整（不编）。
  const UNIT = name => (/书屋|酒店/.test(name) ? 8000 : 4000);
  const covered = found.reduce((a, s) => a + UNIT(s), 0);
  if (covered < last.assets) return null;
  return found.slice(0, 2).join(' + ') + (found.length > 2 ? ` 等 ${found.length} 笔` : '');
}

// #1478：落点的**后果**。两栏都是 0 的回合里，只有三类停得有后果，且日志里都已有原文：
//   ① 停在别人**停业**的店旁：引擎写「应付租金 0（X） · 停业中，不计租」；
//   ② 一进一出正好抵平：引擎写「在金钱格获得 N」+「应付租金 N」；
//   ③ 其余（占 92.8%）就是一段没有任何地产生意的路 —— 没有后果可写，也不编。
// 实测（1,131 个引擎回合 = 3 起手 × seed 1–24）：双 0 的 377 回合里，①26 ②1 ③350。
// 屏上用的是「封租」：它和停业卡同一套词（「对手可以封租」），且比「停业0租」省 1 个字。
//
// #1458：资金与资产**两栏都是 0** 的回合。这不改 #1295 的「资金 +0 恒不写」，
// 只是把日志里已经写着、玩家却一路滑过去的事实说出来：掷了几点、停在哪。
//
// 实测（1,812 帧动作屏 = 3 起手 × seed 1–24）：683 帧（37.7%）是「资金 +0 · 资产 +0」，
// 其中每一帧的日志里都有真动作。这一句只复用日志原文，不新造数字；
// 日志里挑不出我自己的动作就返回 null（宁可不写，不能把对手的动作说成我的）。
export function quietTurnLine(last, humanName) {
  if (!last || !Array.isArray(last.lines)) return null;
  if (last.money || last.assets) return null;   // 只负责两栏都是 0 的回合，别的不碰
  const plain = last.lines.map(l => String(l).replace(/\s+/g, ' ').trim());
  const mine = plain.filter(l => l.startsWith(`${humanName} `));
  const roll = mine.map(l => /掷出 (\d+) 点/.exec(l)).find(Boolean);
  const stay = mine.some(l => /停留，本回合移动 0 步/.test(l));
  // 一次移动可能落两次（果冻墙弹回会再落一次），取最后一次 —— 那才是回合结束的位置。
  // 落点行后面可能跟「，旁边是 X」或「，获得 1 张卡」，那句本行不需要，截掉（省行宽）。
  const landed = mine.filter(l => /^\S+ 停在 /.test(l)).at(-1);
  const parts = [];
  if (roll) parts.push(`掷出 ${roll[1]} 点`);
  else if (stay) parts.push('这回合原地不动');
  if (landed) parts.push(landed.slice(humanName.length).trim().split('，')[0]);
  // #1478：落点的后果。只有真在日志里出现过的那两种才写；都没有就回到「钱没动」。
  const consequence = landingConsequence(mine);
  if (!parts.length) {
    // 整个回合被跳过（在监狱/医院/梦游/停留），没掷骰也没落点。
    // 实测 683 帧里正好 1 帧是这种（seed 14 grow D5「从监狱出来后又被跳过」）。
    // 不说原因就只剩「资金 +0 · 资产 +0」，而日志里明明写着为什么。
    // 匹配前先去掉名字：mine 里每一行都以玩家名开头。
    const skip = mine.map(l => /^(在\S+?中|停留|正在\S+?)，跳过本回合/.exec(l.slice(humanName.length).trim())).find(Boolean);
    return skip ? `${skip[1]}；这回合钱没动` : null;
  }
  // 有后果时用它替掉「钱没动」：「X封租」本身就说明这一停没花钱，两个都写会翻行。
  return `${parts.join('，')}；${consequence ?? '这回合钱没动'}`;
}

// 从日志里认出「这一停有后果」。认不出就返回 null（调用方退回「钱没动」）。
// 只在两栏都是 0 时被调用，所以这里的 0 租金不是「钱变了但显示 0」，而是真的没收没付。
function landingConsequence(mine) {
  const closed = mine.map(l => /^\S+ 向 \S+ 应付租金 0（([^）]+)） · 停业中，不计租$/.exec(l)).find(Boolean);
  if (closed) return `${closed[1]}封租`;
  // 一进一出正好抵平：有进账、也有真租金，但两栏合计为 0。
  const gain = mine.some(l => /获得 \d+$/.test(l));
  const paid = mine.some(l => /实付租金 [1-9]/.test(l));
  if (gain && paid) return '收付相抵';
  return null;
}

// 从引擎写的日志行里挑出「钱的来源/去向」。返回 null 表示拼不齐，调用方不许编。
export function turnCauseLine(last, humanName) {
  if (!last || !Array.isArray(last.lines)) return null;
  // 资金与资产两栏都是 0 的回合：不改 #1295 已签的「资金 +0 恒不写」，
  // 而是补一句**日志里已经写着、玩家却滑过去**的事实（掷了几点、停在哪）。
  // 实测（1,812 帧动作屏）这种帧占 683 帧 / 37.7%，没有这一句就只剩「资金 +0 · 资产 +0」。
  // 只在确认这句不会把侧栏推出视口之后才接线（几何读数见 .scratch/1458-quiet/RESULT.md）。
  if (!last.money && !last.assets) return quietTurnLine(last, humanName);
  if (!last.money) return assetCauseLine(last, humanName);
  const items = [];
  let sum = 0;
  for (const raw of last.lines) {
    const text = String(raw).replace(/\s+/g, ' ').trim();
    for (const rule of MONEY_MOVES) {
      const m = rule.re.exec(text);
      if (!m) continue;
      if (String(m[rule.who]).trim() !== humanName) break;
      const amount = rule.sign * (+m[rule.money]);
      sum += amount;
      items.push(rule.say(m));
      break;
    }
  }
  // 对不上（少算/多算）就沉默：折叠里仍是原文，玩家能自己看，但屏上不出错的摘要。
  if (!items.length || sum !== last.money) return null;
  // 只留两笔，其余用「等 N 笔」概括 —— 这一行在 365px 宽侧栏里，超过两笔就换行成三排，
  // 会把下面的「还能用几张卡」挤出可视区。
  const shown = items.slice(0, 2).join(' + ');
  const rest = items.length - 2;
  return rest > 0 ? `${shown} 等 ${items.length} 笔` : shown;
}

// #3391t：玩家要能看见「营业进项真的入账了」。
// 判据必须来自引擎的累计（sliceStats.business，只有 settleStreetBusiness 会写），
// 而不是我从地图重算 —— 重算会掩盖「规则没开/没发」这种沉默（我在这一片反复犯的错）。
// 规则未开启时返回 ''，所以正式盘的侧栏逐字不变。
export function businessLine(state, human) {
  if (!state?.slice || !human) return '';
  const gained = human.sliceStats?.business ?? 0;
  const perShop = state.config?.streetBusinessPerShop ?? 0;
  if (!perShop) return '';
  // 已入账就先把数报出来；下面再补这一回合为什么可能没增加。
  const head = gained
    ? `营业进项已入 ${money(gained)}（每店每天 ${perShop}）`
    : `本页开着营业进项（每店每天 ${perShop}），你还没拿到过`;
  // 卡在哪一步，必须说清楚。真机现场：两间店都挂着停业，却没解释，
  // 屏上写着「还没凑齐过一条街」—— 玩家会去补地，而真正的原因是一张停业卡。
  const rows = streetBusinessStatus(state, human);
  if (rows.some(r => r.qualifies)) return `<p class="hint">${head}。</p>`;
  // 只挑最接近的那一条街来说，避免把六条街都列出来。
  // #3391t 自测抓到的错：第一版按「已持有 − 停业」排序，于是玩家刚花钱补齐的晨光街
  // （2/2 但两张停业卡正在生效）被排到了一条 1/2 的街后面，屏上提的是后者 ——
  // 玩家会以为自己买错了。排序必须先看**所有权进度**，停业只影响「什么时候到账」。
  const best = [...rows].sort((a, b) => b.owned - a.owned
    || Number(a.closed > 0) - Number(b.closed > 0)
    || b.total - a.total)[0];
  if (!best || !best.owned) return `<p class="hint">${head}：要先拿到一整条街（同一街的两间小店都归你）。</p>`;
  const gap = [];
  if (best.owned < best.total) gap.push(`还差 ${best.total - best.owned} 间`);
  if (best.closed) gap.push(`${best.closed} 间停业中（停业期满才结算）`);
  if (best.unbuilt) gap.push(`${best.unbuilt} 间还没开张`);
  return `<p class="hint">${head}：${best.street} ${best.owned}/${best.total} 间，${gap.join('、') || '条件已满足'}。</p>`;
}

export function renderSliceInsight(el,state,p) {
  if(!el)return;
  el.hidden=!state.slice;
  if(!state.slice)return;
  const human=state.players.find(p=>p.controller==='human')??p;
  const last=human?.lastTurn;
  const rank=[...state.players].filter(q=>q.alive).sort((a,b)=>assetsOf(state,b)-assetsOf(state,a));
  const cause=turnCauseLine(last,human?.name);
  // #1458：两栏都是 0 时**换掉**这一行，而不是在后面再挂一句。
  // 实测（真 Edge 1280×800，同一帧、同一 365px 宽）：追加变 2 行（H 20.8→41.6），
  // 第三张卡中心从 elementFromPoint 命中变成 out-of-view（bottom 845.7→863.2）；
  // 换成「你上回合：掷出 6 点，停在 发薪处；这回合钱没动」仍是 1 行、第三张卡仍可点。
  // 「资金 +0 · 资产 +0」这两个数本来就什么也没说，换掉不丢信息。
  const bothZero=!!last&&!last.money&&!last.assets;
  const summary=bothZero&&cause?`你上回合：${cause}`
    :`你上回合：资金 ${signed(last?.money??0)} · 资产 ${signed(last?.assets??0)}${cause?`（${cause}）`:''}`;
  const report=last?`<details><summary>${summary}</summary><ul>${last.lines.map(t=>`<li>${t}</li>`).join('')}</ul></details>`:'';
  // 候选 C（#554）：书屋易主后，「谁在收、走邻街要付多少」必须在玩家下一次做决定时就在眼前。
  // 为什么放在侧栏而不是日志：书屋买卖只发生一次，而它的后果影响之后每一回合的路线选择。
  // 只用已有的 rentFor / properties 字段，不写状态、不消耗随机数（rentFor 是纯函数）。
  const bookPlot=state.map.plots.find(x=>x.big);
  const bookPr=bookPlot?state.properties[bookPlot.id]:null;
  const bookOwner=bookPr?.ownerId?state.players.find(q=>q.id===bookPr.ownerId):null;
  const bookRent=bookPlot?rentFor(state,bookPlot.id):0;
  // 数字用 rentFor（引擎同一个函数），所以与真实结算一致；
  // 但它随等级与旺季变（同一局里书屋从 4,000 涨到 19,200），所以必须写「现在」，
  // 否则玩家会把它当固定值。加了时效词就不再加别的字。
  // 结算页不再提示：「走邻街会付多少」是给下一回合用的，局已结束就只是噪声。
  const bookHint=!state.over&&bookOwner?`<p class="hint">书屋在 ${bookOwner.name}${bookOwner.id===human.id?'（你）':''} 手上，现在走邻街${bookPr.closed>0?`停业（还剩 ${bookPr.closed} 天）`:`付 ${money(bookRent)}`}${bookOwner.id!==human.id&&bookPr.closed<=0&&human.cash+human.deposit<bookRent?'（你付不起）':''}。</p>`:'';
  // 出局那一刻屏幕上必须能回答「我为什么停了」：否则标题只写「X 正在行动…」，
  // 玩家会以为游戏卡住（实测 seed1 take 出局时屏上只有「你的资产 0 · 当前第 — 名」）。
  // 只复用 turnCauseLine 已有的来源，不新增数字。
  const out=p.controller!=='human'&&!state.over&&!human.alive;
  const heading=state.over?'收摊结算':out?'你已出局 · 剩下的回合只能看':p.controller==='ai'?`${p.name} 正在行动…`:'轮到你了';
  el.innerHTML=`<div class="turn-heading">${heading} <span>第 ${Math.min(state.day,state.config.dayLimit)} / ${state.config.dayLimit} 天</span></div>
    <p>你的资产 <b>${money(assetsOf(state,human))}</b> · 当前第 ${human.alive?rank.indexOf(human)+1:'—'} 名<br>已收租 ${money(human.sliceStats.rentEarned)} · 已付租 ${money(human.sliceStats.rentPaid)}</p>
    ${businessLine(state,human)}
    ${state.day<4?'<p class="hint">街心书屋第 4 天开售，标价 26,000。先经营，或留钱抢位置。</p>':bookHint}
    ${!state.over&&p.controller==='human'&&state.phase==='action'?`<p class="hint">还能用 ${Math.max(0,2-(p.sliceCardsUsed??0))} 张卡，随后掷骰。下次补给：${state.day>=16?'本局最后一天':`第 ${1+3*Math.ceil(state.day/3)} 天`}。<br>翻修 → 旺季；停业 → 定步。也可以留牌等时机。</p>`:''}${report}`;
}

// #574：把「账面回本」落到「本局真回本了吗」。
// 数据源是引擎的收租行（state.log），不另存一份状态 —— 避免两份真相分叉。
// 日志上限 400 行，实测本局全量 247 行不会被截断；若将来局变长被截断，
// 这里的数会偏小（宁可偏小也不编）。
export function actualRentByPlot(state) {
  const out = new Map();
  for (const entry of state.log ?? []) {
    const m = /^\S+ 向 \S+ 应付租金 (\d+)（([^）]+)）/.exec(entry.text);
    if (!m) continue;
    const amount = Number(m[1]);
    const plot = m[2];
    // 0 元行 = 人走过去了但那条街停业封租。必须与「真收到钱」分开：
    // 否则免费翻修会因为 hits>0 被判成已回本，而玩家实际一分钱没收。
    const row = out.get(plot) ?? { hits: 0, paid: 0, freeHits: 0 };
    row.hits += 1;
    row.paid += amount;
    if (amount === 0) row.freeHits += 1;
    out.set(plot, row);
  }
  return out;
}

// #646：从逐日资产快照里找出「人类第一次落出榜首」的那一天。
// 纯函数，只读快照；快照不存在或不足 2 天时返回 null（交给调用方降级，不编造）。
export function firstFallBehindDay(state) {
  const days = state.slice?.assetByDay;
  if (!Array.isArray(days) || days.length < 2) return null;
  const human = state.players.find(q => q.controller === 'human');
  if (!human) return null;
  const rankOf = entry => {
    const vals = state.players.map(q => ({ id: q.id, v: entry.assets?.[q.id] ?? 0 }));
    if (vals.some(x => typeof entry.assets?.[x.id] !== 'number')) return null;
    const best = Math.max(...vals.map(x => x.v));
    const mine = vals.find(x => x.id === human.id)?.v ?? 0;
    // 名次用「有多少人严格高于我」+1；并列第一算 1。
    // tiedWith: 与我的资产相同、且同样处于最高位的人数（不含自己）。
    // 并列第一算第 1 名，但文案里必须能区分“独自领先”与“并列”。
    const mineV = mine;
    const tiedWith = mine === best ? vals.filter(x => x.v === mineV).length - 1 : 0;
    return { rank: vals.filter(x => x.v > mine).length + 1, gap: best - mine, tiedWith };
  };
  // 先把每一天的名次算完，再判断 —— 旧的边算边判会把“首次落下那天”的值
  // 误当成“终局”的值（finalRank / finalGap 曾经说错过）。
  const rows = [];
  for (const entry of days) {
    const r = rankOf(entry);
    if (!r) return null;
    rows.push({ day: entry.day, rank: r.rank, gap: r.gap, tiedWith: r.tiedWith, assets: entry.assets });
  }
  const finalRow = rows[rows.length - 1];
  const firstRow = rows[0];
  let bestRank = Infinity, bestDay = null, lastRank1Day = null;
  let bestAlone = false, lastRank1Alone = false;
  for (const r of rows) {
    // 并列第一也算第 1 名，但“第一次达到”优先取独自第一的天，
    // 拿并列说“曾经领先”会误导（实测 keep/seed=99 第4天三人同分）。
    if (r.rank < bestRank || (r.rank === bestRank && !bestAlone && r.rank === 1 && r.tiedWith === 0)) {
      bestRank = r.rank; bestDay = r.day; bestAlone = r.tiedWith === 0;
    }
    if (r.rank === 1) { lastRank1Day = r.day; lastRank1Alone = r.tiedWith === 0; }
  }
  // 破产识别：末尾资产为 0，且当天之前还有非 0 值（即“曾经活着、后来归零”）。
  // 若不区分，后面的文案会把出局后的 0 当成普通落后去比较。
  const humanEnd = finalRow.assets?.[human.id];
  const everHad = rows.some(r => (r.assets?.[human.id] ?? 0) > 0);
  const busted = humanEnd === 0 && everHad;
  const bustDay = busted ? (rows.find(r => (r.assets?.[human.id] ?? 0) === 0)?.day ?? null) : null;
  const tail = { bestRank, bestDay, lastRank1Day, firstDayRank: firstRow.rank,
    bestAlone, lastRank1Alone,
    finalRank: finalRow.rank, finalGap: finalRow.gap, finalDay: finalRow.day,
    busted, bustDay };
  // 首次由第一掉到非第一
  for (let k = 1; k < rows.length; k++) {
    if (rows[k - 1].rank === 1 && rows[k].rank > 1) {
      // before*：只看落在这一天「之前」的行，避免文案出现“之前曾…（晚于落下日的天）”。
      let beforeBestRank = Infinity, beforeBestDay = null, beforeBestAlone = false;
      for (let j = 0; j < k; j++) {
        const r = rows[j];
        if (r.rank < beforeBestRank || (r.rank === beforeBestRank && r.rank === 1 && r.tiedWith === 0)) {
          beforeBestRank = r.rank; beforeBestDay = r.day; beforeBestAlone = r.tiedWith === 0;
        }
      }
      return { day: rows[k].day, rank: rows[k].rank, gap: rows[k].gap,
        beforeBestRank, beforeBestDay, beforeBestAlone, ...tail };
    }
  }
  // 从未领先过：首日就不是第一（开局即落后）
  if (firstRow.rank > 1) {
    return { day: firstRow.day, rank: firstRow.rank, gap: firstRow.gap, fromStart: true, ...tail };
  }
  return null;
}

// #646：快照是否可用（天数够且每人每天都有数值）。
// 与 firstFallBehindDay 分开：后者返回 null 既可能是“一直领先”也可能是“数据不全”，
// 混用会让数据不全被说成“你全程第一”——那是编造。
export function hasUsableAssetByDay(state) {
  const days = state.slice?.assetByDay;
  if (!Array.isArray(days) || days.length < 2) return false;
  return days.every(e => state.players.every(q => typeof e.assets?.[q.id] === 'number'));
}

// #912：离场屏此前只会说「追到第 N 名」或「一直没反超过」，说不出差距是在哪几天被拉开的。
// #879 已证伪「从第 N 天起开始输」这条路：同一直觉度量换一种定义就给出不同天数
// （21 局里 A=任意区间最大增量 与 C=最长连续不降段 有 14 局给出不同窗口，A 与 B 有 17 局不同），
// 写成确定转折点就是假因果。
// 所以这里只报一个能当场用盘面核对的**区间事实**：整局里 gap(j) - gap(i) 最大的那两天，
// 连同两天的落后额照写，差值让读者自己减。不写「开始输 / 反超后 / 因为 / 导致」。
// 并列时取终点天最早、再起点天最早：差距常在峰值平台停好几天，最早到达峰值那天才是「涨到顶」。
// 最大增量 <= 0（差距全期没有净增长）⇒ 返回 null，宁可不说不编一个窗口。
// 另一个不说的情况：最大增量没有**超过**全期最大单日回落。若拉开 15,000 而别处也一口气缩回 15,000，
// 「拉开得最多」就是在一对对称的起落里挑一边，玩家会把噪声当结论。实测 21 局里有 1 局（grow/13，
// 差距 3,000 冲上去又 3,000 回落，全程净变化 0）因此不说。
export function gapWideningWindow(state) {
  const rows = gapDailySeries(state);
  if (!rows) return null;
  let best = null;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const inc = rows[j].gap - rows[i].gap;
      if (inc <= 0) continue;
      const better = !best || inc > best.inc
        || (inc === best.inc && rows[j].day < best.dayTo)
        || (inc === best.inc && rows[j].day === best.dayTo && rows[i].day < best.dayFrom);
      if (better) best = { inc, dayFrom: rows[i].day, dayTo: rows[j].day, fromGap: rows[i].gap, toGap: rows[j].gap };
    }
  }
  if (!best) return null;
  let maxDrop = 0;
  for (let k = 1; k < rows.length; k++) maxDrop = Math.max(maxDrop, rows[k - 1].gap - rows[k].gap);
  if (best.inc <= maxDrop) return null;
  return best;
}

// #646：离场屏那一句。有可用快照才说天数；否则降级为可见说明，不编。

// #926：窗口里差距涨得最多的那一天，是哪一步造成的。
//
// 为什么只写「一天」而不是「整个窗口主要因为 X」：实测 15 个说窗口的局里，
// 「整窗口主要因为 X」要同时过「两种定义（现金口径 / 资产口径）同型 + 主导类占比 ≥60%
// + 领先次类 ≥1.5 倍 + 窗口内领先者未换人」只有 4 局；
// 改成「差距涨得最多的那一天 + 当天最大单笔」后，同样苛刻的自对账下能写 8 局。
// 所以可写的只有日级句，不是窗口级归因。逐局分布见 .scratch/926-window-cause/RESULT.md。
//
// 四条硬条件，缺一不说（宁可不说，不编）：
//   ① 那天逐笔贡献加总必须正好等于当天差距增量（算术对账，不是叙事）——对不上就不写；
//      破产局几乎必然对不上（资产归零那一段没有对应的日志金额），所以自然被挡掉。
//      这也是唯一的「金额来源」保证：句子里的每个数都来自快照或该天日志行。
//   ② 当天领先者没有换人（换人时「谁涨的」会把账记到错的人头上）；
//   ③ 最大单笔占当天差距增量 ≥ 60%（否则那天不是由一步造成的）。
//      这一条同时排掉了「两笔并列」：当天增量>0 时，两笔绝对值相等必然使单笔占比 ≤50%，
//      根本过不了 60%。早先写过一条单独的并列规则，实测永远走不到，已删（留死代码比没规矩更坏）。
//
// 句子里只用两种数：快照里真实存在的天数，和那天的真实落后额。
// 不写「增量」（屏上不出现，玩家无法核），也不写「因为/导致/开始」。
// 逐日落后额仍由 gapDailySeries 提供，玩家可以自己加。
export function gapDayCauseLine(state) {
  if (!hasUsableAssetByDay(state)) return '';
  const win = gapWideningWindow(state);
  if (!win) return '';
  const days = state.slice.assetByDay;
  const human = state.players.find(q => q.controller === 'human');
  if (!human) return '';
  const gapOf = entry => Math.max(...state.players.map(q => entry.assets[q.id])) - entry.assets[human.id];
  const leaderOf = entry => state.players.reduce((a, b) => (entry.assets[b.id] > entry.assets[a.id] ? b : a));

  // 窗口内差距涨得最多的那一天
  let worst = null;
  for (let k = 1; k < days.length; k++) {
    const cur = days[k];
    if (cur.day <= win.dayFrom || cur.day > win.dayTo) continue;
    const d = gapOf(cur) - gapOf(days[k - 1]);
    if (d > 0 && (!worst || d > worst.dGap)) worst = { k, day: cur.day, dGap: d };
  }
  if (!worst) return '';
  const prev = days[worst.k - 1], cur = days[worst.k];
  const leaderNow = leaderOf(cur);
  // ② 当日领先者昨天不是最高（包括并列最高）⇒ 不说。
  // 用金额判而不是用「是不是同一个人」判：第 1 天常有三方并列，按身份判会把并列
  // 当成换人，把真能对账的句子一并挡掉（实测就是这样浪费了 2 个夹具）。
  // 金额差为 0 时，gap(昨天) 用的就是这个人昨天的资产，归因不会记错人。
  const swapAmount = Math.max(...state.players.map(q => prev.assets[q.id])) - prev.assets[leaderNow.id];
  if (swapAmount !== 0) return '';

  // 逐笔拆：领先者侧 +v，我这侧 −v。买下地（现金 −N、地产 +N）对资产净 0，不记。
  const steps = [];
  const num = s => Number(String(s).replace(/,/g, ''));
  // 升级带来的地产标价抬升：小店 +4,000/级，书屋 +8,000/级（buyPrice 口径）。
  const valStep = name => {
    const plot = state.map?.plots?.find(x => x.name === name);
    return plot?.big ? 8000 : 4000;
  };
  const add = (who, amount, label) => {
    if (!amount) return;
    if (who === leaderNow.name) steps.push({ label, s: amount, mine: false });
    else if (who === human.name) steps.push({ label, s: -amount, mine: true });
  };
  for (const entry of state.log ?? []) {
    if (entry.day !== worst.day) continue;
    const line = entry.text;
    let m;
    if ((m = /^(\S+) 实付租金 (\d+)（([^）]+)），(\S+) 收到 (\d+)/.exec(line))) {
      add(m[1], -num(m[2]), `向 ${m[4]} 付了「${m[3].trim()}」的租金`);
      add(m[4], num(m[5]), `收了 ${m[1]} 踩到「${m[3].trim()}」付的租金`);
      continue;
    }
    if ((m = /^(\S+) 经过起点 \+(\d+)$/.exec(line))) { add(m[1], num(m[2]), '经过起点'); continue; }
    if ((m = /^(\S+) 在\S*获得 (\d+)$/.exec(line))) { add(m[1], num(m[2]), '落在金钱格'); continue; }
    if ((m = /^(\S+) 纳税 (\d+)$/.exec(line))) { add(m[1], -num(m[2]), '纳税'); continue; }
    if ((m = /^(\S+) 向 (\S+) 支付 (\d+) 收购 (.+)$/.exec(line))) {
      const price = num(m[3]), mark = Math.round(price / 1.25);
      add(m[1], -price + mark, `收购「${m[4].trim()}」`);
      add(m[2], price - mark, `的「${m[4].trim()}」被买走`);
      continue;
    }
    if ((m = /^(\S+) 将 (.+?) 升到 Lv\.(\d+)（花费 (\d+)）/.exec(line))) {
      add(m[1], -num(m[4]) + valStep(m[2].trim()), `把「${m[2].trim()}」升到 Lv.${m[3]}`);
      continue;
    }
    if ((m = /^(\S+) 使用 翻修 → (.+?)，升到 (\d+) 级/.exec(line))) {
      add(m[1], valStep(m[2].trim()), `用翻修卡把「${m[2].trim()}」升到 ${m[3]} 级`);
      continue;
    }
    if ((m = /^新闻：所有人获得 (\d+)$/.exec(line))) {
      for (const q of state.players.filter(q => q.alive)) add(q.name, num(m[1]), '新闻里拿到一笔');
      continue;
    }
  }
  // ① 算术对账：逐笔合计必须正好等于当天差距增量
  const sum = steps.reduce((a, b) => a + b.s, 0);
  if (sum !== worst.dGap) return '';
  const sorted = steps.slice().sort((a, b) => Math.abs(b.s) - Math.abs(a.s));
  const top = sorted[0];
  if (!top) return '';
  // ③ 最大单笔至少占当天差距增量 60%
  if (Math.abs(top.s) * 10 < worst.dGap * 6) return '';

  const who = top.mine ? '你' : leaderNow.name;
  return `<p class="hint">差距涨得最多的是第 <b>${worst.day}</b> 天：那天${who}${top.label}，那天结束时你落后 ${money(gapOf(cur))}。</p>`;
}
function gapTurningCore(state) {
  if (!hasUsableAssetByDay(state)) {
    return '<p class="hint">本局未记录完整的逐日资产，无法指出从哪一天开始落后。</p>';
  }
  const hit = firstFallBehindDay(state);
  if (!hit) return '<p class="hint">本局你全程都在第一位，没有落后的转折点。</p>';
  // 破产优先：出局之后没有“名次”可言，再报“结束时落后多少”会让人以为还有翻盘可能。
  if (hit.busted) {
    if (hit.fromStart) {
      return `<p class="hint">第 ${hit.day} 天你就落后 ${money(hit.gap)}；<b>第 ${hit.bustDay} 天资金耗尽出局</b>，这局没有翻盘过。</p>`;
    }
    const back = hit.lastRank1Day != null && hit.lastRank1Day > hit.day
      ? (hit.lastRank1Alone
          ? `，第 ${hit.lastRank1Day} 天又回到过第一`
          : `，第 ${hit.lastRank1Day} 天又追平过第 1 名（同分）`)
      : '';
    // 首次落下那天正好就是出局那天时，不要再说一遗“第 N 天…第 N 天…”。
    const bustPart = hit.bustDay === hit.day
      ? '<b>当天资金耗尽出局</b>'
      : `<b>第 ${hit.bustDay} 天资金耗尽出局</b>`;
    return `<p class="hint">你从<b>第 ${hit.day} 天</b>起落到第 ${hit.rank} 名（当天落后 ${money(hit.gap)}）${back}；${bustPart}。</p>`;
  }
  if (hit.fromStart) {
    // 开局即落后要再分两档，否则 take 风格（实测 6/6 局都是第1天落后）
    // 会得到一句“开局就落后，之后没反超过”——干真但无用：玩家第1天什么都没做。
    // 比「第1天的名次」而不是「终局名次」：爬上去又没掉下来的，也是爬上去过。
    if (hit.bestRank != null && hit.bestRank < hit.rank) {
      // 名次爬上去过。但保住名次 ≠ 局面在好转，所以还要看差距走向：
      // 差距缩小 ⇒ 说“在追”；差距扩大 ⇒ 直说扩大，不要说成“又落到第 N 名”（名次没变时那样说是语病）。
      const shrink = hit.finalGap < hit.gap;
      const trend = shrink
        ? `差距从 ${money(hit.gap)} 缩到 ${money(hit.finalGap)}`
        : `差距反而从 ${money(hit.gap)} 拉到 ${money(hit.finalGap)}`;
      return `<p class="hint">第 ${hit.day} 天你落后 ${money(hit.gap)}；<b>第 ${hit.bestDay} 天追到第 ${hit.bestRank} 名</b>并保持到最后，${trend}。</p>`;
    }
    return `<p class="hint">这局你一直没反超过：第 ${hit.day} 天就落后 ${money(hit.gap)}，结束时落后 ${money(hit.finalGap)}（第 ${hit.finalRank} 名）。</p>`;
  }
  if (hit.firstDayRank !== 1) {
    // 曾经爬上去过，但不是从开局就领先。不能说“之前一直在第一位”。
    // 而且必须说结尾：否则会出现“说第N天没保住，实际最后又保住了”的误导。
    // 并列时要区分：bestRank=1 但是并列时，说“追平”而不是“爬到第 1 名”（玩家会把“第一”理解成领先）。
    // 必须只用「落在这一天之前」的名次，否则会出现“之前曾…（第 9 天），第 6 天没能保住”这种时序倒置。
    const reached = hit.beforeBestRank === 1 && !hit.beforeBestAlone
      ? `你之前曾在第 ${hit.beforeBestDay} 天追平第 1 名（与他人同分）`
      : `你之前曾爬到过第 ${hit.beforeBestRank} 名（第 ${hit.beforeBestDay} 天）`;
    const head = `<p class="hint">你从<b>第 ${hit.day} 天</b>起落到第 ${hit.rank} 名（当天落后 ${money(hit.gap)}）—— ${reached}，第 ${hit.day} 天没能保住`;
    if (hit.finalRank === 1) return head + '；<b>但第 ' + hit.lastRank1Day + ' 天又回到第一位，并保持到结束</b>。</p>';
    if (hit.lastRank1Day != null && hit.lastRank1Day > hit.day) return head + '；第 ' + hit.lastRank1Day + ' 天又回到过第一，结束时落到第 ' + hit.finalRank + ' 名（落后 ' + money(hit.finalGap) + '）。</p>';
    return head + '，结束时落到第 ' + hit.finalRank + ' 名（落后 ' + money(hit.finalGap) + '）。</p>';
  }
  // 第1天确实是第一。但若「首次掉下去之后又回到过第一」，只说“第N天起落到第M名”
  // 会让人以为是“从第N天起一直第M名”——而实际中途回去过。
  // 用 lastRank1Day（最后一次在第1名的天），不用 bestDay（第一次达到最好的天）。
  if (hit.lastRank1Day != null && hit.lastRank1Day > hit.day) {
    // 并列第一不说“回到第一”，否则玩家会以为曾经领先。
    const backWord = hit.lastRank1Alone ? '又回到过第一' : '又追平过第 1 名（与他人同分）';
    const endPart = hit.finalRank === 1
      ? (hit.finalGap === 0 ? '结束时你在第 1 名' : '结束时你又回到了第一位')
      : `结束时落到第 ${hit.finalRank} 名（落后 ${money(hit.finalGap)}）`;
    return `<p class="hint">你从<b>第 ${hit.day} 天</b>起第一次落到第 ${hit.rank} 名（当天落后 ${money(hit.gap)}），之前在第一位；第 ${hit.lastRank1Day} 天${backWord}，${endPart}。</p>`;
  }
  return `<p class="hint">你从<b>第 ${hit.day} 天</b>起落到第 ${hit.rank} 名（当天落后 ${money(hit.gap)}），之前一直在第一位。</p>`;
}

// 只在既有句子之后追加，既有分支的逐字文本一律不动（沿用 #878 那条规矩）。
// 破产局的差距已被出局解释，不再报窗口；快照不全时 gapWideningWindow 自己返回 null。
export function gapTurningLine(state) {
  const core = gapTurningCore(state);
  if (core.includes('资金耗尽出局')) return core;
  const win = gapWideningWindow(state);
  if (!win) return core;
  // 不能把旧句重说一遍。旧句在「从第 D 天起落到第 R 名（当天落后 g）」里已经给了 D 和 g；
  // 若窗口恰好就是「第 1 天（还没落后）→ 第 D 天（落后 g）」，新句没有新信息，就只说旧句。
  // 实测 21 局里有 3 局命中这两条（grow/7；cross/7、cross/11 走的是「差距从 A 拉到 B」那句）；
  // 抑制后 15 局说、6 局不说（另 2 局破产、1 局对称摆动），逐局见 .scratch/912-gapwindow/RESULT.md。
  const hit = firstFallBehindDay(state);
  const firstDay = state.slice.assetByDay[0].day;
  if (hit && !hit.busted) {
    // 情形一（旧句「你从第 D 天起落到第 R 名（当天落后 g），之前一直在第一位」）
    if (win.dayFrom === firstDay && win.fromGap === 0 && win.dayTo === hit.day && win.toGap === hit.gap) return core;
    // 情形二（旧句「这局你一直没反超过：第 1 天就落后 g1，结束时落后 gF」）
    if (hit.fromStart && win.dayFrom === firstDay && win.fromGap === hit.gap
        && win.toGap === hit.finalGap) return core;
  }
  // 「拉开得最多」是描述，不是因果断言：两个端点差距各自都是某一天的真实值，
  // 玩家拿屏上的逐日资产就能验；句子里刻意不写增量，免得与「金额必须来自某一天」的既有不变量冲突。
  // 起点常见是 0（第 1 天你本来就在第一位）。“第 1 天落后 0”读起来傻，
  // 但改写成“没有落后”也不用另一个数，信息量一样且更顺。
  // 起点为 0 时不说「落后 0」（读起来傻），但也**不说「在第一位」**：差距 0 只意味着没人高于你，
  // 可能是并列第一。本文件里并列从不写成“第一位”（见上面并列分支的注释），沿用同一标准。
  const startPart = win.fromGap === 0 ? '第 ' + win.dayFrom + ' 天你还没落后' : '第 ' + win.dayFrom + ' 天落后 ' + money(win.fromGap);
  const series = gapDailySeries(state);
  const detail = series
    ? `<details><summary>逐日落后第一名多少（可对着上面两个数看）</summary><p class="hint">${series.map(x => '第 ' + x.day + ' 天 ' + money(x.gap)).join(' · ')}</p></details>`
    : '';
  return core + `<p class="hint">全 ${state.slice.assetByDay.length} 天里，你和第一名的差距在第 <b>${win.dayFrom} 天到第 ${win.dayTo} 天</b>之间拉开得最多：${startPart}，第 ${win.dayTo} 天落后 ${money(win.toGap)}。</p>` + gapDayCauseLine(state) + detail;
}

// 逐日落后额，给上面那句提供可当场核对的底稿。只读快照。
// 两个使用方（找窗口 / 展开逐日）共用这一份计算，避免两处口径分叉。
export function gapDailySeries(state) {
  if (!hasUsableAssetByDay(state)) return null;
  const human = state.players.find(q => q.controller === 'human');
  if (!human) return null;
  return state.slice.assetByDay.map(entry => ({
    day: entry.day,
    gap: Math.max(...state.players.map(q => entry.assets[q.id])) - entry.assets[human.id],
  }));
}

// #949：把「你升级过的店」从**整局累计**改成**按升级那一步、按天对齐**。
//
// 改前口径（整局累计）有两个具体的错，实测 94 个升级步骤里踩到 8 次：
//   ① 升级前该店已经收到的租金被算进这一步（take/1 第 1 天付费升晨光街茶铺，整局 11,200 全来自第 4 天之后，
//      但按整局口径第 1 天那一步就已经「回本」）；
//   ② 同一间店升两次时，两次的花费被并成一次（后一步拿前一步的花费去比，反过来又拿前一步的租金去抵）。
// 所以「这一步值不值」根本读不出来 —— 玩家读到的是「这间店值不值」。
//
// 一步 = 一条升级日志行在 state.log 里的位置。它之后、同一间店下一次升级之前的租金才归它。
// 句子里的天数来自那条租金行的 day；金额来自日志原文（花费）或该段租金合计。
// 不给「值得 / 不值得」：只给现金花多少、到第几天收回、现金上还差多少。
const STEP_UP_PAID = /^(\S+) 将 (.+?) 升到 Lv\.(\d+)（花费 (\d+)）/;
const STEP_UP_FREE = /^(\S+) 使用 翻修 → (.+?)，升到 (\d+) 级/;
const STEP_RENT = /^(\S+) 实付租金 (\d+)（([^）]+)），(\S+) 收到 (\d+)/;
// 引擎每次收租写两行：先「应付租金 N（店）」（应缴），再「实付租金 N（店），O 收到 M」（实际过账）。
// 付租方现金不够时两者不等，实测真实 21 局 90 条实付行里 6 条不等（对方破产，按余额付）。
// 回本问的是「钱真到账了吗」，所以只能取实付；grow/13 第 9 天你那张街心书屋应缴 19,200、实收 14,000，
// 旧口径（读应付）把这一段多算了 5,200。
// 应付行只在没有对应实付行时兜底（老夹具与少数路径只写这一行），按同天同店同付款方配对，不重复计。
const STEP_OWE = /^(\S+) 向 (\S+) 应付租金 (\d+)（([^）]+)）/;

// 玩家每升一级，这条地在这条街上抬高多少标价（assetsOf → buyPrice 的同一口径）。
export function upgradeValueStep(state, plotName) {
  const plot = state.map?.plots?.find(x => x.name === plotName);
  return plot?.big ? 8000 : 4000;
}

// 收租行 → 一行一次「真到账」：{k, day, plot, paid, earned, zero}。
// 实付行优先；应付行只在没有对上的实付行时兜底（按 天+店+付款方 配对）。
// 为什么要配对而不是相加：引擎两条都写，相加会把同一笔钱算两遍。
// 已签收的 actualRentByPlot 读的是应付，本函数刻意不复用它 —— 那个口径对「钱到没到账」偏大（见上面 6 条）。
export function rentRowsFor(state, human) {
  const log = state.log ?? [];
  const rows = [];
  const paidKeys = new Set();
  log.forEach((e, k) => {
    const m = STEP_RENT.exec(e.text);
    if (!m) return;
    const plot = m[3].trim();
    paidKeys.add(`${e.day}|${plot}|${m[1]}`);
    rows.push({ k, day: e.day, plot, payer: m[1], owner: m[4],
      paid: Number(m[2]), earned: Number(m[5]), zero: Number(m[5]) === 0 });
  });
  const owed = [];
  log.forEach((e, k) => {
    const m = STEP_OWE.exec(e.text);
    if (!m) return;
    const plot = m[4].trim();
    if (paidKeys.has(`${e.day}|${plot}|${m[1]}`)) return;   // 已有实付行，不重复计
    owed.push({ k, day: e.day, plot, payer: m[1], owner: m[2],
      paid: Number(m[3]), earned: Number(m[3]), zero: Number(m[3]) === 0 });
  });
  rows.push(...owed);
  rows.sort((a, b) => a.k - b.k);
  // 按店名切，不按收款人切：已签收的 actualRentByPlot 也只按店名，且实测 21 局里
  // 人类的店没被收购夺走过（0 条「你升级过的店收进别人口袋」），加一层过滤只会让两条口径分叉。
  // human 参数保留，只用于将来需要分人时；现在不用。
  void human;
  return rows;
}

// 把人类的每一次升级切成一步，并算出「这一步之后」的收租事实。
// 只读 state.log / state.slice.history；不写 state、不读随机数。
export function upgradeSteps(state) {
  const human = state.players?.find(q => q.controller === 'human');
  if (!human || !state.slice) return [];
  const log = state.log ?? [];
  const used = new Set();
  const steps = [];
  for (const h of state.slice.history ?? []) {
    if (h.playerId !== human.id) continue;
    for (const line of h.lines ?? []) {
      let m = STEP_UP_PAID.exec(line), paid = true, cost = 0, plot, level;
      if (m) { cost = Number(m[4]); plot = m[2].trim(); level = Number(m[3]); }
      else if ((m = STEP_UP_FREE.exec(line))) { paid = false; plot = m[2].trim(); level = Number(m[3]); }
      else continue;
      // 在日志里定位这一行：同日同文、跳过已用过的位置。找不到（历史里才有）就记 -1，
      // 这时只能按「升级天之后」切段，不能按位置切。
      let idx = -1;
      for (let k = 0; k < log.length; k++) {
        if (used.has(k) || log[k].text !== line) continue;
        idx = k; used.add(k); break;
      }
      steps.push({ line, paid, cost, plot, level,
        day: typeof h.day === 'number' ? h.day : (idx >= 0 ? log[idx].day : null), idx });
    }
  }
  // 同一间店的下一次升级是这一步的截止（含位置与天两层，任一可用就截）。
  steps.forEach((s, i) => {
    const next = steps.slice(i + 1).find(t => t.plot === s.plot);
    s.stopIdx = next?.idx >= 0 ? next.idx : Infinity;
    s.stopDay = next ? next.day : Infinity;
  });
  // 先把每条收租折成一行（真到账的金额），再去分配到各步。
  const rentRows = rentRowsFor(state, human);
  return steps.map(s => {
    const rows = rentRows.filter(r => {
      if (r.plot !== s.plot) return false;
      if (s.idx >= 0) return r.k > s.idx && r.k <= s.stopIdx;     // 位置切段：升级前的不算，下次升级之后不算
      // 没有位置可切（老夹具只有 history）时按天兜底：升级天及之后、下次升级天之前。
      if (typeof s.day === 'number' && r.day < s.day) return false;
      return r.day <= s.stopDay;
    });
    const hits = rows.length;
    const earned = rows.reduce((a, r) => a + r.earned, 0);
    const zeroHits = rows.filter(r => r.zero).length;
    const target = s.paid ? s.cost : 1;   // 免费翻修的「本」= 别白升：收到 1 元就算兑现
    const value = upgradeValueStep(state, s.plot);
    // 记分口径要收够的数：花出去的钱里有一部分变成了地产标价，仍在你的资产里。
    const cashNeed = Math.max(0, target - value);
    let firstDay = null, acc = 0;
    for (const r of rows) { acc += r.earned; if (acc >= target) { firstDay = r.day; break; } }
    // 三向状态在数据层就定下来，屏幕与校验读同一份 —— 两处各算一次必然分叉。
    //   ok     = 该段租金已够本
    //   unread = 不够本（含 0 次踩到）；其中 cashShort 区分「记分不亏、现金未收回」
    // 没有第三种「说了够本但算起来不够」—— 那不是状态，是 bug，由 verify-real 抓。
    const state3 = earned >= target ? 'ok' : 'unread';
    const cashShort = state3 === 'unread' && cashNeed > 0 && earned >= cashNeed;
    // #981：付费档的「0 次踩到」必须能分清「没人来」和「来了但钱记在下一步」。
    // 只看整局两个数，不改窗口口径：wholeHits = 本局该店一共被踩几次；
    // afterUpHits = 这次升级之后（含下一次升级之后）一共几次。两个都只是数，不写因果。
    const wholeHits = rentRows.filter(r => r.plot === s.plot).length;
    const afterUpHits = rentRows.filter(r => r.plot === s.plot
      && (s.idx >= 0 ? r.k > s.idx : (typeof s.day !== 'number' || r.day >= s.day))).length;
    const step = { ...s, hits, earned, zeroHits, target, value, cashNeed, firstDay, state: state3, cashShort,
      wholeHits, afterUpHits };
    step.verdict = stepVerdict(step);
    return step;
  });
}

// 一步的判定：三向（成立 / 仍读不出 / 记分成立但现金未收回）。
// 只有该段租金真的够本才写「已回本」，且必须给出首次够本的那一天（可对着逐日资产核）。
function stepVerdict(step) {
  const closeNote = step.zeroHits > 0 ? `（其中 ${step.zeroHits} 次撞上停业，没收钱）` : '';
  if (step.hits === 0) {
    // #981：只付费档加这一句。免费档这一行逐字不动（已签收断言钉着）。
    // 两个数并排给出，玩家自己能看出是「这局没人走这条街」还是「人来了、钱记在下一步」。
    if (step.paid && typeof step.wholeHits === 'number') {
      return `这一步之后 0 次踩到 — 账面回本没兑现`
        + `（本局这间店一共被踩 ${step.wholeHits} 次，这次升级之后 ${step.afterUpHits} 次）`;
    }
    return '这一步之后 0 次踩到 — 账面回本没兑现';
  }
  if (step.earned === 0) return `这一步之后走过 ${step.hits} 次但一次也没收到钱${closeNote} — 账面回本没兑现`;
  if (step.earned >= step.target) {
    const when = step.firstDay != null ? `，第 ${step.firstDay} 天收回本钱` : '';
    return `已回本${when}${closeNote}`;
  }
  if (step.cashNeed > 0 && step.earned >= step.cashNeed) {
    // 最容易被写成谎的一档：记分上已经不亏，但现金还没收回。必须两个都写。
    // 现金缺口只能是 花 − 已收（C − R）。写成 C − V − R 会把 V 和 R 各扣一次，
    // 得到负数的「现金还差 -1,000」—— 那既算错又读起来荒谬。这里 C − R > 0 由上面的分支保证。
    return `收了 ${money(step.earned)}，记分上不亏（花 ${money(step.cost)} 里 ${money(step.value)} 变成地产标价），`
      + `现金还差 ${money(step.cost - step.earned)}${closeNote}`;
  }
  return `收了 ${money(step.earned)}，还不够本${closeNote}`;
}

// #993：加盖**之前**的可算数字。
// K = ceil(花费 / 升级后每次足额租金)，unit 现场用 rentFor 算（升级后等级），不写常数、不插值。
// K 是条件句：足额踩满 K 次就一定够本（算术上成立）；它**不是**「会有人来」的承诺。
// 所以旁边必须并排这张盘的实测落地分布 —— 否则玩家会把 K 读成预测。
// 分布来自 .scratch/993-forward-k/landing-stats.json：72 局（grow/take/cross × seed 1–24），
// 单位为「局」，不是百分比：写「0 次 52 局」比写「72%」更难被误读成概率。
// 这张表随 AI 策略/棋盘变化而失效；新增店必须重新生成，由 test/build-forward-k.test.js 守着。
export const LANDING_STATS = {
  games: 72, seeds: 'grow/take/cross × seed 1–24',
  note: '整局该店被踩到的次数（含撞上停业、没收钱的那次）',
  table: {
    '晨光街小店': [52, 18, 2], '晨光街茶铺': [57, 12, 3],
    '晚风街小店': [63, 7, 2], '晚风街茶铺': [59, 12, 1],
    '灯火街小店': [44, 25, 3], '灯火街茶铺': [35, 27, 10],
    '月色街小店': [63, 9, 0], '月色街茶铺': [66, 6, 0],
    '西巷小店': [64, 8, 0], '西巷茶铺': [63, 9, 0],
    '东巷小店': [65, 6, 1], '东巷茶铺': [63, 8, 1],
    '街心书屋': [30, 23, 19],
  },
};

// 升级“后”的每次足额租金：临时把等级 +1 读 rentFor，立刻恢复（与 flow.js 给加盖算回本同构）。
// 停业（closed>0）时 rentFor 给 0 —— 那时算不出每次到手价，必须照实说，不能编一个 K。
export function buildForwardK(state, plotId, cost) {
  const pr = state.properties?.[plotId];
  if (!pr) return null;
  // #3391z（supervisor 在公开版 seed 3 第 6 天亲手撞到的真缺陷）：
  // 这里以前用**升级后的全额租金**做 K，而这笔加盖真正多赚的是**增量**。
  // 实例：月色街茶铺 2,000 → 4,000，费用 10,000。
  //   旧算法 10,000 / 4,000 = **3 次**（屏上就这么写的）；
  //   正确 10,000 / 2,000 = **5 次**（这笔钱真正要多收几次才回来）。
  // 差在：不盖也能收到那 2,000，所以那部分不能算进「这笔投资」的回本。
  const saved = pr.level;
  let before = 0, after = 0;
  try {
    before = rentFor(state, plotId);
    pr.level = (saved ?? 0) + 1;
    after = rentFor(state, plotId);
  } finally { pr.level = saved; }
  const gain = after - before;
  if (!(gain > 0)) return { unit: 0, gain: 0, before, after, K: null, closed: (pr.closed ?? 0) > 0 };
  return { unit: gain, gain, before, after, K: Math.max(1, Math.ceil(cost / gain)), closed: false };
}

// 屏上那一行。返回 '' 表示“此刻没什么可说”（非切片模式 / 不知道这间店），
// 但**只要 unit 算得出或这条街在停业，就必须有话说** —— 沉默不是一种回答。
export function buildForwardLine(state, plotId, cost) {
  if (!state?.slice) return '';
  const plot = state.map?.plots?.find(x => x.id === plotId);
  if (!plot || !Number.isFinite(cost)) return '';
  const info = buildForwardK(state, plotId, cost);
  if (!info) return '';
  if (info.unit === 0) {
    return '这条街正在停业，此刻每次到手价是 0，算不出要几次 —— 停业结束前这笔本钱没有回收路径。';
  }
  const st = LANDING_STATS.table[plot.name];
  // #1143：这句也是 72 局常数，不能挂「本盘」。
  const dist = st
    ? `同规则 ${LANDING_STATS.games} 局里，这间店整局被踩到：0 次 ${st[0]} 局 / 1 次 ${st[1]} 局 / 2 次及以上 ${st[2]} 局（含撞上停业那次）。`
    : '这间店没有实测落地分布，“会不会来够”这盘没有数据。';
  // #1044：主句换成「值不值」，K 降为尾部上限说明。
  //
  // 为什么换（#998 实测）：K 是算术上成立的上界，但 21 局里 130 条提议、印 K 122 条，
  // K 被真达到 0 次（跨臂最多 4/354）。根因是账不是几何——真发生的付费升级花掉 990,000，
  // 而全场租金合计只有 468,600。把「满 K 次」放在主句，等于让玩家按一个不会发生的条件做决定。
  //
  // 现在的主句只陈述本盘实测的两个数：这一笔占整局全场租金多少、有几局的整局租金还不够这一笔。
  // K 句逐字保留在上界的位置（#993 已签的不变量：不许写成「才够本/至少要」，
  // 因为 grow/7 街心书屋 K=4 却在 2 次足额 + 1 次少付时就收回 37,000）。
  const share = poolShareLine(cost, plot.name);
  // #3391zp2：把 cost 传进去 —— 确认框里那句除法（花费 ÷ 每次多收）与流水行同源。
  // 上一版只传 (unit, K, full)，于是屏上有全额、却没有「拿哪个数去除」；
  // supervisor 重走 seed 3 时正是拿 4,000 去除了 10,000。
  const kLine = poolKLine(info.unit, info.K, info.after, cost);
  return `${share}${dist}${kLine}`
    + `这句不是“会有人来”的预测。`;
}

// #1144：加盖那一刻的**机会成本** —— 花这笔 vs 不花这笔能换到什么。
//
// 为什么要这一句：#1143 把主句换成了诚实的 72 局常数（「这一笔占全场租金 64.3%」），
// 玩家知道贵，却不知道**不花它**能换到什么，所以按下去之前仍然只有一个数在眼前。
// 这一句补的是另一边，且只收本局账本里的数（rentFor / buyPrice / cheapestBuyable / 现金）。
//
// 口径纪律（用户 #1144 判据第 1 条，会真触发）：
//   这句的每个数都来自**本局**，所以句首必须写「本局账本」，且必须明说它和上面那句 72 局常数不是一回事。
//   两句并排出现时，读者要能分出哪句在说这局、哪句在说 72 局。
//   因此本函数**只**返回本局侧的数，不去引用 RENT_POOL —— 换算就是把两个口径混起来。
//
// 40 种子实测（.scratch/1144-opportunity/probe-opp.mjs，默认盘 seed 1–40）：
//   261 条加盖提议，216 条能同时印出两边；同口径可比的 215 条里，
//   加盖每元换的每回合租金更高的 124 条、买地更高的 91 条、相等 0 条（中位比值 1.07）。
//   ⇒ 这一格真的会翻转决定，不是摆设。35 条此刻无替代地（照实说），14 条停业（由已签句说）。
//
// 只读 state：临时改等级/归属读 rentFor 后立刻恢复，与 buildForwardK / render.js:653 同构。
export function buildOpportunityLine(state, plotId, cost, viewer) {
  if (!state?.slice) return '';
  const plot = state.map?.plots?.find(x => x.id === plotId);
  // 看的人由调用方传：猜测「human 座位」会在无人类座位的局（批量评估）里静默返回空，
  // 而空返回值看不出是「没什么可说」还是「找错了人」——上一版就是这么全空的。
  const p = viewer ?? state.players?.find(q => q.controller === 'human');
  if (!plot || !p || !Number.isFinite(cost)) return '';
  // 只对「这间店的主人」说这笔账：别人屏幕上看到的是别人的选择，现金与替代物都不是他的。
  if (state.properties?.[plotId]?.ownerId && state.properties[plotId].ownerId !== p.id) return '';
  const pr = state.properties?.[plotId];
  if (!pr) return '';
  // 停业街交给已签的停业句（口径更准，不在这里重复说一遍）。
  if ((pr.closed ?? 0) > 0) return '';

  const before = rentFor(state, plotId);
  const savedLevel = pr.level;
  let after = 0;
  try { pr.level = (savedLevel ?? 0) + 1; after = rentFor(state, plotId); }
  finally { pr.level = savedLevel; }
  const gain = after - before;
  // 算不出增量（升级后仍然收不到租）时不许编，交给已签的 buildForwardLine 去说。
  if (!(gain > 0)) return '';

  // 句长受版面约束：加盖框已有 154px 的 72 局句，再加太长会把「加盖」按钮顶出可视区。
  // 所以写成一句紧凑话，不用「从…变成…（多…）」那种三段式。
  const head = `本局账本：花 ${money(cost)}，每次被踩到 ${money(before)}→${money(after)}（+${money(gain)}）。`;
  const tag = '以上是本局当场值，不是上面的 72 局常数。';

  const alt = cheapestBuyable(state, p);
  if (!alt) {
    // 判据第 4 条：没有替代物就照实说，不印 0、不留空。
    return `${head}此刻没有可买的无主地，这笔钱换不到地；不花就留着 ${money(p.cash)}。${tag}`;
  }

  const apr = state.properties[alt.id] ?? {};
  const savedAlt = { ownerId: apr.ownerId, level: apr.level };
  let altRent = 0;
  try {
    state.properties[alt.id] = { ...apr, ownerId: p.id, level: apr.level ?? 0 };
    altRent = rentFor(state, alt.id);
  } finally { state.properties[alt.id] = { ...apr, ...savedAlt }; }

  const short = (p.cash ?? 0) < alt.price;
  // 替代地是空地：买下收不到租，那是另一个决定（还要再花一笔加盖），不许写成等价选项。
  let altPart;
  if (short) {
    altPart = `现金 ${money(p.cash)}，还差 ${money(alt.price - p.cash)} 才够买 ${alt.name}（${money(alt.price)}）`
      + (altRent > 0 ? `，它每次被踩到收 ${money(altRent)}。` : '，那块地还是空地。');
  } else if (altRent > 0) {
    altPart = `不花它，现金 ${money(p.cash)} 够买 ${alt.name}（${money(alt.price)}），它每次被踩到收 ${money(altRent)}。`;
  } else {
    altPart = `不花它，现金 ${money(p.cash)} 够买 ${alt.name}（${money(alt.price)}），但那是空地，`
      + `买下收不到租，还要再花 ${money(buildCost(1))} 加盖才收租。`;
  }
  return `${head}${altPart}${tag}`;
}

// #3334：付费加盖那一屏，把「付」与「不付」到底换到什么的差**算出来**。
//
// 这一屏是正常首局最早的一处花钱决定（真入口 seed 1 三种起手都是第 2 个决策）：
// 停在自家小店旁，问你要不要花 10,000 把这间从 Lv1 升到 Lv2。改前它只说
// 「剩余现金 32,000，估值增加 4,000」—— 读起来像赚了 4,000，实际是现金 -10,000、
// 标价 +4,000，**总资产当场少 6,000**（.scratch/3334/net.mjs 用真 buildPlot 量过：
// 58,000 → 52,000，三种起手一样）。
//
// 更关键的是屏上没说这一下与手里那张「翻修」卡的关系：
//   playTurn 的顺序是 补给 → 出牌(actionPhase) → 移动 → 落地 → 这里的 build 提示，
//   所以提示出现时本回合出牌阶段**已经过去**，翻修卡只能下个回合用。
//   于是同一条街上真正有三条路，代价完全不同（引擎算，不是我推）：
//     付这 10,000，下回合翻修卡再升这间  → 两步到 Lv3，共花 10,000
//     不付，下回合翻修卡升这间          → 到 Lv2，共花 0；要到 Lv3 再付 15,000
//                                      ⇒ 「先付费再翻修」比「先翻修再付费」省 5,000
//     付这 10,000，翻修卡留给另一间      → 两间都 Lv2，共花 10,000
//   这三条的差价是真的（.scratch/3334/net.mjs order：paidFirst 花 10,000 / freeFirst 花 15,000，
//   都到 3 级），但改前屏上一个字都没有 —— 玩家只能看到「10,000 换 +4,000」。
//
// 口径：每个数都当场算（buyPrice / buildCost / rentFor 同源），不写常数；
// 只对店主人说（别人的店不是他的选择）；停业街由已签的停业句负责，不在这里重复。
// 只读 state：临时改等级读 buyPrice 后立刻恢复，与 buildForwardK / buildOpportunityLine 同构。
export function buildOrderLine(state, plotId, cost, viewer) {
  if (!state?.slice) return '';
  const plot = state.map?.plots?.find(x => x.id === plotId);
  const p = viewer ?? state.players?.find(q => q.controller === 'human');
  if (!plot || !p || !Number.isFinite(cost)) return '';
  const pr = state.properties?.[plotId];
  if (!pr) return '';
  if (pr.ownerId && pr.ownerId !== p.id) return '';
  if ((pr.closed ?? 0) > 0) return '';
  const max = state.config.maxLevel ?? 3;
  const lv = pr.level ?? 0;
  if (lv <= 0 || lv >= max) return '';

  // 标价增量：与 assetsOf / buyPrice 同一把尺子（临时升一级读价，立刻恢复）。
  const mark0 = buyPrice(state, plotId);
  const saved = pr.level;
  let mark1 = mark0;
  try { pr.level = saved + 1; mark1 = buyPrice(state, plotId); }
  finally { pr.level = saved; }
  const markGain = mark1 - mark0;
  const net = markGain - cost;              // 当场总资产变化（负数 = 这一下净变少）
  const after = lv + 1;

  // 第一段：这一下当场换了什么。三个数一起给，因为旧屏只给了中间那个（「估值增加 4,000」）。
  const head = `付这笔：现金 -${money(cost)}，标价 +${money(markGain)}，`
    + (net === 0 ? '总资产不变。' : `总资产 ${signed(net)}。`);

  // #3335：本局最后一天没有「下回合」—— 放弃之后直接收摊，再没有出牌阶段。
  // 主管在 90f15f9 的真机上抓到（seed 4 街角店主，第 16 天晨光街小店）：屏上仍写着
  // 「翻修卡下回合免费升」，按放弃后直接结算，那句话承诺的动作永远不存在。
  // 所以最后一天只说这局真的还能做的事，不写任何「下回合」。
  const lastDay = state.day >= (state.config?.dayLimit ?? Infinity);

  // 第二段：不付会怎样。翻修卡是免费一级，但它只能在**下个回合的出牌阶段**用
  // （本回合出牌阶段已过：flow.js 的 playTurn 顺序是 出牌 → 移动 → 落地 → 这个提示）。
  if (!p.cards?.includes('worker')) {
    if (lastDay) {
      return head + `这是本局最后一天，没有下回合：不付就停在 ${lv} 级。`;
    }
    const nextCost = after < max ? Math.round(buildCost(after + 1) * state.priceIndex) : null;
    return head + (nextCost
      ? `手上没有翻修卡，下一级还要付 ${money(nextCost)}。`
      : '手上没有翻修卡，这一下就到顶了。');
  }

  const others = state.players.filter(q => q.team === p.team)
    .flatMap(q => q.properties).filter(id => {
      const q = state.properties[id];
      return id !== plotId && q && (q.level ?? 0) > 0 && (q.level ?? 0) < max && !(q.closed > 0);
    });
  const otherId = others[0];
  const otherPlot = otherId ? state.map.plots.find(x => x.id === otherId) : null;
  // 卡打到另一间时升的是**它自己的**下一级，不是这间升完的等级 —— 别把两个数当成一个。
  // 这一句在 390×844 上是最贵的一段（#3264 已签：这一屏内容不滚），而实测它最弱：
  // grow 31 局里「卡给这间」与「卡给另一间」相等 24 局（.scratch/3334/three-arms.mjs）。
  // 所以只留「打到哪、到几级」两个事实，不留那句「两间都往前走一步」的解释。
  const otherAfter = otherId ? (state.properties[otherId].level ?? 0) + 1 : null;
  const otherPart = otherPlot ? `卡也可留给${otherPlot.name}（到 ${otherAfter} 级）。` : '';
  if (lastDay) {
    // 最后一天：卡还在手上也用不出去了 —— 别写「下回合」。对手另一间同样来不及。
    return head + `这是本局最后一天，没有下回合：不付就停在 ${lv} 级，翻修卡再也用不上。`;
  }
  if (after >= max) {
    // 到顶：不付，卡下回合也能免费送到同一级 —— 差别只剩「早一回合」。
    return head + `不付，翻修卡下回合也能免费把它送到 ${max} 级：这一下买到的只是「早一回合」。` + otherPart;
  }

  // 还能再升一级：顺序会改变总价（先付费升级便宜、先免费升级贵）。
  // 实测（真 buildPlot + 真 useCard）：先付再免费 10,000 到 3 级，先免费再付 15,000 到同一级。
  const paidThenFree = cost;                                                // 付 + 免费 → after+1
  const freeThenPaid = Math.round(buildCost(after + 1) * state.priceIndex);  // 免费 + 付 → 同一级
  const fork = `不付：翻修卡下回合免费升到 ${after} 级。`
    + `两步到 ${after + 1} 级，先付再免费 ${money(paidThenFree)}`
    + ` / 先免费再付 ${money(freeThenPaid)}（差 ${money(freeThenPaid - paidThenFree)}）。`;
  return head + fork + otherPart;
}

// 结算页这一段。旧标题与「实收 N 次 / 金额」的写法保留（已签收断言钉着），
// 只把统计口径从整局改成按步，并把「到第几天收回」补上。
export function stepPaybackSection(state) {
  const steps = upgradeSteps(state);
  if (!steps.length) return '';
  const rows = steps.map(s => {
    const head = `${s.plot}（${s.paid ? `花 ${money(s.cost)}` : '免费翻修'} 升到 ${s.level} 级，第 ${s.day} 天）`;
    return `<li>${head}：实收 ${s.hits} 次 / ${money(s.earned)} — ${s.verdict}</li>`;
  }).join('');
  const plots = new Set(steps.map(s => s.plot));
  const zeroPlots = [...plots].filter(name => !steps.filter(s => s.plot === name).some(s => s.hits > 0)).length;
  const done = steps.filter(s => s.state === 'ok').length;
  return `<details><summary>你升级过的店，本局到底回本没有（${steps.length} 步 / ${plots.size} 间，${done} 步够本，${zeroPlots} 间从未被踩到）</summary>`
    + `<ul>${rows}</ul>`
    + `<p class="hint">一步只算它之后、同一间店下次升级之前的租金；升级前那间店收的租不算在这一步里。`
    + `注意：一局只有 ${state.config.dayLimit} 天，很多店只是没等到人来，不一定是这一步选错。这里说的是本局实况，不是评价。</p></details>`;
}
// #3337：结算屏最后那句「下局试试」曾经是**三条按起手写死的推销句**，与本局发生了什么无关。
//
// 实测那三条里有一条是坑（300 seed 配对，真入口、同一套 AI）：
//   街角店主被建议「带现金收购别人养好的店」→ 强制第一次补给选收购并在之后用掉这张卡，
//   胜 126→60/300（McNemar onlyArm/onlyBase 28/94，chi²=34.63），终局资产均值 −20,945。
//   机会买家自己的招牌包同样：117→17/300（chi²=79.04）。
//   原因是引擎算术：收购价 = 标价 ×1.25，且全款进对手口袋（economy.acquisitionPrice），
//   而对手的店在整局里只被踩到 0.94 次。
//
// 更糟的是这三条**从来不提本局真正的杠杆**。整局事实（900 局，3 起手 × 300 seed）：
//   · 街心书屋（26,000，第 4 天开售）：45.6% 的局被人买下，47% 的局最后在对手手里，
//     7.4% 全程没人买；对手持有时每踩到一次收 9,374。
//     同 seed 配对：原本没买、这一臂买了的 40 局里，胜 12→32，终局资产 +19,805（chi²=15.04）。
//   · 80% 的局结束时有一条「只拿一半」的街；同街两间把 Lv1 的单次租金 2,000→2,800。
//   这两条都比「收购」值钱，而旧文案一个字都没提。
//
// 所以这里换成**一句话，全部数从本局 state/log 算**：本局把钱漏在哪、下一局那一步怎么不一样。
// 不给推荐口气，不预测输赢，不写本局没发生的事；数字一律来自引擎状态或日志原文。
// 判据：test/next-game-line.test.js（每个分支的数都可回算；「收购」不得出现在这句里）。
const MARKET_PLOT = 'market';

// 本局谁在哪天买下了某块地（日志原文，不是推算）。
function boughtLog(state, name) {
  for (const entry of state.log ?? []) {
    const m = /^(\S+) 买下 (.+?)（支付 (\d+)）/.exec(entry.text);
    if (!m || m[2] !== name) continue;
    return { by: m[1], day: entry.day, price: Number(m[3]) };
  }
  return null;
}

// 人类为某间店实付过的租金合计（与 rentRowsFor 同一口径：只认实付行）。
function rentPaidOn(state, human, name) {
  let sum = 0, hits = 0;
  for (const entry of state.log ?? []) {
    const m = /^(\S+) 实付租金 (\d+)（([^）]+)），(\S+) 收到 (\d+)/.exec(entry.text);
    if (!m || m[1] !== human.name || m[3] !== name) continue;
    sum += Number(m[2]); hits += 1;
  }
  return { sum, hits };
}

// 人类从某间店实收过的租金：金额与次数（同样只认实付行，只看收款方是不是我）。
function rentEarnedOn(state, human, name) {
  let sum = 0, hits = 0;
  for (const entry of state.log ?? []) {
    const m = /^(\S+) 实付租金 (\d+)（([^）]+)），(\S+) 收到 (\d+)/.exec(entry.text);
    if (!m || m[4] !== human.name || m[3] !== name) continue;
    sum += Number(m[5]); hits += 1;
  }
  return { sum, hits };
}

// 我自己停在某间店旁边几次。引擎里这一步只问「要不要加盖」，从不收租 ——
// 所以这个数正好是「我走了那条路却什么都没拿到」的次数（#3338）。
function ownStopsOn(state, human, name) {
  let hits = 0;
  for (const entry of state.log ?? []) {
    if (!new RegExp(`^${human.name} 停在 \\S+，旁边是 ${name}$`).test(String(entry.text))) continue;
    hits += 1;
  }
  return { hits };
}

// 人类付过的最大一笔租。这是「本局最贵的一停」，**不是**出局原因：它可能已经付清了。
function biggestRentPaid(state, human) {
  let best = null;
  for (const entry of state.log ?? []) {
    const m = /^(\S+) 实付租金 (\d+)（([^）]+)），(\S+) 收到 (\d+)/.exec(entry.text);
    if (!m || m[1] !== human.name) continue;
    const amount = Number(m[2]);
    if (!best || amount > best.amount) best = { amount, plot: m[3], day: entry.day };
  }
  return best;
}

// 破产那一刻到底发生了什么：应付多少、实际付得出多少、哪块地。只认引擎写的那两行。
//
// #3337b（supervisor 在 5ec96f8 上抓到的）：这一支原来用的是「人类付过的**最大**一笔租」，
// 于是 grow/seed 19 被写成「第 12 天你为街心书屋一次付了 9,600，付不出就出局了」——
// 而日志里那一笔**付清了**（实付 9,600），真正出局是第 16 天的同一间店：
// 应付 9,600、实付 4,400、日志里写着 `付不出 9600（租金），破产`。
// 两个数字都是真的，但句子把「最大的一笔」当成了「击穿的那一笔」——
// 这是编造因果，比不说更坏。
//
// 所以这里只读引擎自己写的破产行，再回头找同一笔的应付行与实付行来补全口径；
// 找不到就返回 null，让调用方降级到一句不含因果的话。
const BUST = /^(\S+) 付不出 (\d+)（([^）]*)），破产$/;
const OWED = /^(\S+) 向 (\S+) 应付租金 (\d+)（([^）]+)）/;
const PAID = /^(\S+) 实付租金 (\d+)（([^）]+)），(\S+) 收到 (\d+)/;

function bustEntry(state, human) {
  const log = state.log ?? [];
  let idx = -1;
  for (let k = log.length - 1; k >= 0; k--) {
    const m = BUST.exec(log[k].text);
    if (m && m[1] === human.name) { idx = k; break; }
  }
  if (idx < 0) return null;            // 没写破产行：不编因果
  const fail = BUST.exec(log[idx].text);
  const amount = Number(fail[2]);
  const reason = fail[3];
  const day = log[idx].day;
  // 同一天、同一付款方、同一金额的应付行给出店名；实付行给出真实付得出来的钱。
  let plot = null, paid = null;
  for (let k = Math.max(0, idx - 8); k < log.length; k++) {
    const e = log[k];
    if (e.day !== day) continue;
    const o = OWED.exec(e.text);
    if (o && o[1] === human.name && Number(o[3]) === amount && !plot) plot = o[4];
    const p = PAID.exec(e.text);
    if (p && p[1] === human.name && (plot ? p[3] === plot : true) && paid == null) paid = Number(p[2]);
  }
  return { day, amount, reason, plot, paid };
}

export function nextGameLine(state) {
  const human = state.players?.find(q => q.controller === 'human');
  const plots = state.map?.plots ?? [];
  if (!human || !plots.length) return '';
  const props = state.properties ?? {};

  // ① 破产：说出真正把它击穿的那一笔（应付 / 实付 / 哪块地），而不是「付过的最大一笔」。
  // 两者不是同一件事：#3337b 之前这句把一笔**付清了**的 9,600 说成了出局原因。
  if (!human.alive) {
    const bust = bustEntry(state, human);
    if (bust && bust.amount != null) {
      const tail = bust.paid == null ? '' : `，你只付得出 ${money(bust.paid)}`;
      const where = bust.plot ? `为${bust.plot}` : '一笔租金';
      return `在这笔之前留够现金：第 ${bust.day} 天${where}应付 ${money(bust.amount)}${tail}，付不出就出局了。`;
    }
    return '先留住一次租金的现金再买地：这一局你的资金先耗尽了。';
  }

  // ② 街心书屋：本片测到最大的正杠杆（同 seed 配对 40 局：胜 12→32，资产 +19,805）。
  const market = plots.find(x => x.id === MARKET_PLOT);
  if (market) {
    const pr = props[MARKET_PLOT];
    const owner = state.players.find(q => q.id === pr?.ownerId);
    const name = market.name;
    const price = market.price ?? 0;
    const fromDay = market.availableFromDay ?? 1;
    const took = boughtLog(state, name);
    if (owner && owner.team === human.team) {
      // 我拿到了：本局拿到的不再是问题，下一局的问题是「拿到之后拿它做什么」。
      //
      // #3338 修的两个真缺陷（supervisor 在 a7564dd 的真机上抓到）：
      //
      // ① 价报错了一倍。书屋是 big：flow.js 的 buildPlot 与 groundPhase 的加盖询问都写
      //    `pr.big ? 30_000 : buildCost(...)`。这里原来用 buildCost(lv+1)，于是 2→3 级报 15,000，
      //    引擎实际扣 30,000（.scratch/3338/upcost.mjs：charged=30000）。现在走 bigBuildCost。
      //
      // ② 更糟的是那句「下一局把它放在你的路线上（停步的落点选它旁边）」。
      //    引擎里租金只在**别人**踩到时才收（flow.js groundPhase：自己站自己的店旁边只走
      //    「要不要加盖」的询问）。supervisor 那一局（grow/seed 9）他自己停在书屋旁边 7 次，
      //    一分钱也没收到，结算却叫他下次再走这条路 —— 玩家照做只会重复同一个空手。
      //    72 局实测（support/probe-3338/ledger-table.mjs，与 MARKET_LEDGER 同一批量）：
      //    我持有书屋的 31 局里，31 局都发生过「我自己停在它旁边」，合计 155 次；
      //    真到账全靠对手踩到（27/31 局至少 2 次）。所以变量是对手走位，不是我的落点。
      //    这一屏现在只说玩家真能改的两件：等级（已到顶就没了）与旺季卡（这条街租 ×2，3 天）。
      const max = state.config?.maxLevel ?? 3;
      const lv = pr?.level ?? 0;
      const levers = holdLeversFacts(state, human);
      if (lv > 0 && lv < max) {
        const cost = levers?.buildCostToTop ?? bigBuildCost(state);
        const now = levers?.rent ?? rentFor(state, MARKET_PLOT);
        const top = levers?.topRent ?? now;
        return `拿到${name}之后接着往上盖：从 ${lv} 级到 ${max} 级要花 ${money(cost)}（书屋每级都是这个价），`
          + `它每次被对手踩到的租金 ${money(now)} → ${money(top)}。`;
      }
      // 到顶了：再投钱也涨不上去。剩下的真变量只有两个，都得说出来：
      // 「对手踩到几次」——不由我决定；「旺季卡」——我手里唯一还能把这条街租金翻倍的牌。
      const earned = rentEarnedOn(state, human, name);
      const own = ownStopsOn(state, human, name);
      const m = MARKET_LEDGER.whenMine;
      const [z] = m.stoppedByRival;
      const where = earned.hits === 0
        ? `本局它一次没被对手踩到（72 局里这样的是 ${z} 局）`
        : `本局对手踩到它 ${earned.hits} 次、替你收了 ${money(earned.sum)}`;
      // 自己停旁边的次数照实说 —— 这正是 supervisor 被绕晕的那件事，不说清他会再试一次。
      const minePart = own.hits
        ? `你自己停在它旁边 ${own.hits} 次，那几次一分钱也没有（自己的店不收自己的租）。`
        : '';
      // #3358：旺季那一句必须说清「什么时候才有用」。supervisor 在 grow/4 上读到
      // 「每次 0 变 0」—— 终局那条街在停业，而停业时 rentFor 直接返回 0，
      // 旺季卡（inflate=3）根本盖不过它（game.js：close 设 closed=2，rentFor 先判 closed）。
      // 两个 0 相乘得 0 不是玩家的账，是我把两个不同状态混在一句里。
      const closed = levers?.closed ?? 0;
      const base = closed > 0 ? (levers?.reopened ?? 0) : (levers?.rent ?? 0);
      const inflated = closed > 0 ? (levers?.reopenedInflated ?? 0) : (levers?.inflatedRent ?? 0);
      const season = closed > 0
        ? `这条街结束时还在停业（${closed} 天），停业期间旺季也没用 —— 停业先结束，旺季才把 ${money(base)} 变 ${money(inflated)}。`
        : `你手里还能改的是旺季卡：打在这条街上，每次 ${money(base)} 变 ${money(inflated)}，持续 3 天。`;
      return `${name}已经 ${lv} 级到顶，再投钱也涨不上去：${where}。${minePart}${season}`;
    }
    if (owner) {
      const paid = rentPaidOn(state, human, name);
      // economy.log 有 400 条上限（economy.js:241），真局最长 271 条（180 局实测），
      // 但一旦真的截断，从日志求和就会漏掉前面的行 —— 这时的「一次也没踩到」可能是假话。
      // 所以截断时改成不绝对的说法，宁少说一句也不说假话。
      const truncated = (state.log?.length ?? 0) >= 400;
      const mine = paid.sum
        ? `你踩到它 ${paid.hits} 次、付了 ${money(paid.sum)}`
        : truncated ? '' : '你一次也没踩到它';
      const who = took ? `${took.by}第 ${took.day} 天` : '对手';
      // #3338：这一支以前只说「第 4 天就去拿」。现在把买地屏那三行账的同一份数接上来：
      // 谁哪一天拿走的、本局你为它付了多少，以及 72 局里先拿到它的 31 局实收多少。
      // 两屏指的是同一份表（MARKET_LEDGER），所以不会再一屏劝退一屏劝买。
      const m = MARKET_LEDGER.whenMine;
      return `第 ${fromDay} 天开售就去拿${name}：本局${who}用 ${money(price)} 拿走了它`
        + (mine ? `，${mine}。` : '。')
        + `同规则 72 局里先拿到它的 ${m.games} 局，平均实收 ${money(m.earnedMean)}`
        + `（${m.earnedZero} 局一分没收到）—— 这笔钱不靠你停在旁边，靠对手停过来。`;
    }
    // 全程没人买：把它值多少用引擎自己的 rentFor 算出来，不用记忆里的「近一万」。
    const hypothetical = { ...state, properties: { ...props,
      [MARKET_PLOT]: { ...pr, ownerId: human.id, level: Math.max(1, pr?.level ?? 0) } } };
    const rent = rentFor(hypothetical, MARKET_PLOT);
    const m = MARKET_LEDGER.whenMine;
    return `第 ${fromDay} 天带 ${money(price)} 走到${name}旁边：本局它全程没人买，`
      + (rent ? `买下后每次被对手踩到你收 ${money(rent)}。` : '而它整局没人接手。')
      + `同规则 72 局里有 ${m.earnedZero} 个「我拿着它」的局一分没收到；这间店的钱靠对手走位，不靠你站旁边。`;
  }

  // ③ 兜底：本局我为对手那间店付租最多，而它本来只是标价。
  //
  // 这里原来还有一支「补齐只占一半的街」。删掉了：切片地图**永远**有街心书屋，
  // 所以上面 ② 总先命中，这一支在真局里一次也到不了 —— 留着的是一段永远不会执行的
  // 声称，而它在本片测到的证据里确实是第二好的杠杆（80% 的局结束时有半条街，
  // 同街两间把 Lv1 从 2,000 抬到 2,800）。要在屏上说它，得先让它在真局里能被选中
  // （例如书屋已归我时改说半条街），那是下一片的事，不是这一片的判据能盖住的。
  const top = biggestRentPaid(state, human);
  if (top) {
    const plot = plots.find(x => x.name === top.plot);
    const owned = plot && props[plot.id]?.ownerId;
    if (plot && !owned && plot.price) {
      return `在别人买之前拿下${top.plot}：它标价 ${money(plot.price)}，本局你为它付了 ${money(top.amount)}（第 ${top.day} 天）。`;
    }
    return `绕开${top.plot}：本局你为它付了 ${money(top.amount)}（第 ${top.day} 天，你付租最多的一笔）。`;
  }

  return '这一局你既没付过租也没收过租：换个起手，走一条会踩到别人地盘的路。';
}

export function sliceResults(state) {
  const rank=[...state.players].sort((a,b)=>assetsOf(state,b)-assetsOf(state,a));
  const human=state.players.find(p=>p.controller==='human')??rank[0];
  const winner=rank.find(p=>p.team===state.winnerTeam)??rank[0];
  const gap=assetsOf(state,winner)-assetsOf(state,human);
  // #3278：390×844 实测，结算面板在 #hand 里只有 405px，排名表整块落在面板外
  // （首屏只露表头，三行名次与「再开一局」都在滚动区外，见 RESULT-3278.md 首屏截图）。
  // 玩家来这一屏要的就是「谁赢、差多少、再开一局」，所以把它们提到最前；
  // 差距走向、资产口径、回本明细这些解释放在后面，读不到也不影响做决定。
  return `<h3>${winner.name} 的生意做到了最后</h3><p>${human.team===state.winnerTeam?'你赢了。':`你与获胜者相差 ${money(gap)} 资产。`}${human.alive?'':'你的资金耗尽，提前破产。'}</p>
    <table class="rank"><thead><tr><th>店主</th><th>资金</th><th>地产</th><th>总资产</th></tr></thead><tbody>${rank.map(p=>`<tr><td>${p.name}${p.alive?'':'（破产）'}</td><td>${money(p.cash+p.deposit)}</td><td>${money(assetsOf(state,p)-p.cash-p.deposit)}</td><td>${money(assetsOf(state,p))}</td></tr>`).join('')}</tbody></table>
    ${gapTurningLine(state)}
    <p class="hint">资产 = 现金 + 存款 + 地产当前标价。收购会转移店铺，也会把收购款交给原主人；翻修每层增加估值，小店 4,000 / 书屋 8,000。</p>
    <p>你收租 ${money(human.sliceStats.rentEarned)}，付租 ${money(human.sliceStats.rentPaid)}，用了 ${human.sliceStats.cardsPlayed} 张卡，完成 ${human.sliceStats.takeovers} 次接盘。</p>
    ${stepPaybackSection(state)}
    <details><summary>回看你改变局面的回合</summary>${state.slice.history.filter(h=>h.playerId===human.id&&(h.cardsPlayed||h.money!==0)).map(h=>`<p>第 ${h.day} 天 · 资金 ${signed(h.money)} / 资产 ${signed(h.assets)}<br>${h.lines.filter(t=>!/回合|掷出|方向/.test(t)).join('<br>')}</p>`).join('')}</details>
    <div class="next-bar"><p class="hint" data-next-game>下局试试：${nextGameLine(state)}</p><button data-replay>换个打法，再开一局</button></div>`;
}
