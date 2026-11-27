import { buildAdj, edgeUsable } from './board-v2.js';
import { rentFor, buyPrice, buildCost, acquisitionPrice, takeoverEligible } from './economy.js';
import { TUNING } from '../data/tuning.js';
import { RENT_POOL } from './payback.js';

// 对切片的无障碍路网枚举准确落点；只读，不读取未来随机数。
export function reachableLandings(state, player, steps) {
  const adj = buildAdj(state.map);
  let frontier = [{pos:player.position,from:player.lastNode,face:player.facing}];
  for(let i=0;i<steps;i++) {
    const next=new Map();
    for(const q of frontier) {
      const exits=(adj[q.pos]??[]).filter(e=>edgeUsable(state.map,state.day,{a:q.pos,b:e.to,kind:e.kind}));
      let choices=exits.filter(e=>e.to!==q.from); if(!choices.length) choices=exits;
      if(exits.length===2) {
        if(i===0 && exits.some(e=>e.to===q.face)) choices=exits.filter(e=>e.to===q.face);
        else choices=choices.slice(0,1);
      }
      if(!choices.length) {next.set(`${q.pos}|${q.from}`,q);continue;}
      for(const e of choices) {const forward=(adj[e.to]??[]).filter(n=>edgeUsable(state.map,state.day,{a:e.to,b:n.to,kind:n.kind}));
        const face=(forward.find(n=>n.to!==q.pos)??forward[0])?.to;
        next.set(`${e.to}|${q.pos}`,{pos:e.to,from:q.pos,face});}
    }
    frontier=[...next.values()];
  }
  return [...new Set(frontier.map(q=>q.pos))];
}

export function landingInfo(state, player, nodeId) {
  const node=state.map.nodes.find(n=>n.id===nodeId);
  // Facilities resolve only when the move ends here. Keep the raw landing id
  // so map highlights and AI still identify the danger, while exposing where
  // the character will stand after landing effects have resolved.
  const facility = ['hospital','hospitalGate'].includes(node?.kind) ? 'hospital'
    : ['jail','jailGate'].includes(node?.kind) ? 'jail' : null;
  const effectDestination = facility ? state.map.facility?.[facility] ?? nodeId : nodeId;
  const turnsLost = facility ? state.config?.[`${facility}Turns`] ?? TUNING[`${facility}Turns`] : 0;
  const maxLevel=state.config?.maxLevel??TUNING.maxLevel;
  const plots=(node?.adjacentPlots??[]).map(id=>{
    const plot=state.map.plots.find(p=>p.id===id), pr=state.properties[id];
    const owner=state.players.find(p=>p.id===pr?.ownerId);
    const own=owner?.team===player.team;
    const level=pr?.level??0;
    // #3340：停在一块地旁边，钱到底往哪走 —— 由引擎决定，不由这块地的标价决定。
    // flow.js 里付租那一支第一句就是 `if (owner?.team === p.team) { …加盖询问…; continue; }`，
    // 即**自己的店不收自己的租**（#3338 实测 31/31 局、155 次停留、一分钱没有）。
    // 所以「我停在这里会收到多少」只能由这一处算，别处不许再拿 rentFor 当我的收益。
    //   rentToMe > 0  别人的店：我付给他（负号）
    //   rentToMe = 0  自己的店 / 无主地：不收也不付
    const rentToMe = own || !owner ? 0 : -rentFor(state,id);
    // 自己停在自己店旁唯一真会发生的事：加盖（引擎在同一支里问）。
    // 自己停在自己店旁唯一真会发生的事：加盖（引擎在同一支里问）。
    const canBuild = !!own && !(pr?.closed>0) && level>0 && level<maxLevel;
    const buildAskCost = canBuild ? Math.round((pr?.big?30000:buildCost(level+(state.slice?1:0)))*state.priceIndex) : null;
    const price = buyPrice(state,id);
    const rent = rentFor(state,id);
    // #3341：这一屏是给玩家**挑落点**用的，所以每一行都必须回答「我这一刻做得到吗」。
    // 起因：穿街高手 seed 1 第 13 天现金 20,000，定步 1 步写着「停在这里可加盖 30,000」——
    // 到了那里按钮是按不动的（`buildPlot` 第一句 `if (p.cash < cost) return;`）。
    // 三个「做得到吗」在引擎里有**两种**分母，不能合成一个数：
    //   · 买地 / 加盖看 `p.cash`（buyPlot / buildPlot / 按钮禁用 `(p?.cash ?? 0) < pending.cost` 三处一致）
    //   · 付租看 `p.cash + p.deposit`（pay() 里不够就是破产）
    // 切片里 deposit 实测恒为 0（120 局 7,439 个人类帧，0 帧非零），口径仍按引擎写。
    const cash = player?.cash ?? 0;
    const funds = cash + (player?.deposit ?? 0);
    // 引擎在对手店旁还有两条「根本不用付」的岔路：停业封租，和财神免租。
    const rentWaived = (pr?.closed ?? 0) > 0 || player?.god === '财神' || pr?.bigType === 'park';
    const affordable = !owner ? cash >= price
      : own ? (!canBuild || cash >= buildAskCost)
      : rentWaived || funds >= rent;
    return {id,name:plot?.name??id,street:plot?.street,level,owner:owner?.name??null,
      own,price,rent,closed:pr?.closed??0,inflate:pr?.inflate??0,availableFromDay:plot?.availableFromDay??1,
      rentToMe,canBuild,buildAskCost,affordable,
      // 这一刻还差多少才做得到（0 = 做得到）。买/盖与付租两种分母，各算各的。
      shortForBuild: canBuild ? Math.max(0, buildAskCost - cash) : 0,
      shortForBuy: !owner ? Math.max(0, price - cash) : 0,
      shortForRent: (!own && owner && !rentWaived) ? Math.max(0, rent - funds) : 0};
  });
  return {id:nodeId,label:node?.label??'街道',plots,effectDestination,facility,turnsLost,
    risk:plots.reduce((s,p)=>s+(!p.own&&p.owner?p.rent:0),0)};
}

// #3340：落点旁那块地「对我这笔钱做了什么」的**唯一**措辞。
//
// 上一版对三种归属共用同一个形状：「名字：己方/某人 · 租 N」。对别人的店是对的（走过去要付 N），
// 对自己的店是错的 —— 引擎在自己的店旁从不收租，而是问要不要加盖。
// 实测（120 局，seed 1–40，`.scratch/3340/mislead.mjs`）：定步屏 3.46 次/局、20.8 个点选项/局，
// 其中 **25.1%** 的点选项里出现「己方 · 租 N」；这些行里 **89.7%** 的那个数比同屏所有对手租都大，
// **33%** 是那个点数下唯一的落点信息 —— 也就是说，最能拉动玩家选那个点数的那句话，
// 在自家店上是假的。平均被印出来的数是 5,669。
//
// 自己的店改成说引擎真会问的事（加盖多少钱、封顶没封顶），不再报一个不会到账的租金。
// 自己的店改成说引擎真会问的事（加盖多少钱、封顶没封顶），不再报一个不会到账的租金。
//
// #3341：上一版把三件事说对了（自己的店不收租、加盖价、对手付租），但**没说做不做得到**。
// supervisor 在真局里就撞上：现金 20,000，屏上写「可加盖 30,000」，走过去按钮按不动。
// 一屏用来挑落点，那「这一刻做不起」必须写在那一行上，而不是留给玩家自己减。
// 实测（120 局，support/probe-3341/unaffordable.mjs，改前）：
//   4,634 个点选项里 **223 行**在报一个此刻做不到的数：
//     加盖 449 行里 176 行超出此刻现金（39.2%，其中 176/176 是该行最大、21 行是该点数下唯一信息）
//     买地 211 行里 22 行超出（10.4%）；付租 410 行里 25 行付了直接破产（6.1%）
//   2,490 个点数选项里有 751 个（30.2%）**每一行**都做不起 —— 这个按钮当时给不出一个真能做的选择。
// 改法：做不到的那一行带「还差 N」/「会破产」，做得到的不加字（不把屏变吵）。
export function plotVisitLine(p, state) {
  if (!p.owner) {
    if (state.day < p.availableFromDay) return `第 ${p.availableFromDay} 天开售`;
    const price = `可买 ${p.price.toLocaleString()}`;
    return p.affordable === false ? `${price}，还差 ${p.shortForBuy.toLocaleString()}` : price;
  }
  if (p.own) {
    // 停业这件事两侧必须是同一句话（test/closed-rent.test.js 钉的）：
    // 「不付租」对我自己的店同样成立 —— 我不付，也不收。
    if (p.closed) return '你的店 · 停业 · 不付租';
    if (p.canBuild) {
      const cost = p.buildAskCost.toLocaleString();
      return p.affordable === false
        ? `你的店 Lv.${p.level} · 可加盖 ${cost}，还差 ${p.shortForBuild.toLocaleString()}`
        : `你的店 Lv.${p.level} · 停在这里可加盖 ${cost}`;
    }
    return `你的店 Lv.${p.level} · 自己停在自己的店旁不收租`;
  }
  if (p.closed) return `${p.owner} · 停业 · 不付租`;
  const rent = `付租 ${p.rent.toLocaleString()}`;
  // 付租走 pay()：付不出不是「按不动按钮」，是**破产**。这两个后果不能共用一个说法。
  return p.affordable === false ? `${p.owner} · ${rent} · 现金不够，会破产` : `${p.owner} · ${rent}`;
}
export function landingText(state, player, id) {
  const info=landingInfo(state,player,id);
  if(info.facility) return `${info.label}：失去 ${info.turnsLost} 回合，结算后停在${info.facility==='hospital'?'医院':'监狱'}入口`;
  const details=info.plots.map(p=>`${p.name}：${plotVisitLine(p,state)}`);
  return details.join(' / ') || (info.label==='零工'?'零工：随机收入，最多 3,000':info.label==='发薪处'?'经过发薪处 +4,000':info.label);
}

// 岔路选项的前瞻：近处落点说明之外，再列出「这条路过完本回合后能摸到哪些街/设施」，
// 好让两条只经过未开售地块、说明完全相同。只读，不读随机数。
export const ROUTE_OUTLOOK_STEPS = 5;

// #719 D1：实测 345 个真实 direction 帧里有 15 帧，两个选项的落点说明**逐字相同**
// （例：`向左`/`向下` 都写「街心书屋：第 4 天开售」）。两条路真实的差别只剩
// 「下一回合从哪个格出发、能往哪走」，而屏幕上没有这一条。
// 这里只回答那一个问题：从 nodeId 出发，下回合能去的相邻格 → 方位词。
// 用 edgeUsable，所以当天封路算得进去；不读随机数。
export function nextTurnWords(state, nodeId) {
  const from = state.map.nodes.find(n => n.id === nodeId);
  if (!from) return '';
  const adj = buildAdj(state.map);
  const words = (adj[nodeId] ?? [])
    .filter(e => edgeUsable(state.map, state.day, { a: nodeId, b: e.to, kind: e.kind }))
    .map(e => {
      const to = state.map.nodes.find(n => n.id === e.to);
      if (!to) return null;
      return to.x > from.x ? '右' : to.x < from.x ? '左' : to.y > from.y ? '下' : '上';
    })
    .filter(Boolean);
  return words.length ? words.join('/') : '';
}

// 上一条不够。实测改后仍有 1 帧重文：take/seed=11 第14天 站在 10,5，
// 向下 → 10,6 与 向上 → 10,4 都得到「上/下」（两条都是长廊上的格子）。
// 而它们真实差别在**这两格各自挨着哪块地**：10,6 → 11,6，10,7 → 11,7。
// 所以还要能说出「这格挨着哪条街」。只读地块数量与名字，不算钱。
export function nextTurnStreetNames(state, nodeId) {
  const node = state.map.nodes.find(n => n.id === nodeId);
  const ids = node?.adjacentPlots ?? [];
  const names = [];
  for (const pid of ids) {
    const plot = state.map.plots.find(p => p.id === pid);
    if (!plot || !plot.street) continue;
    if (!names.includes(plot.street)) names.push(plot.street);
  }
  return names.join('、');
}

export function routePreview(state, player, forkNode, id, remainingSteps) {
  const clone = { ...player, position: id, lastNode: forkNode, facing: null };
  const near = new Set(remainingSteps > 0 ? reachableLandings(state, clone, Math.max(0, remainingSteps - 1)) : [id]);
  const text = [...new Set([...near].map(nodeId => landingText(state, player, nodeId)))].join('；');
  // #710：沿途清单。旧实现只取 nearSteps+ROUTE_OUTLOOK_STEPS 那一层，
  // 而屏幕写“再往前可达” —— 措辞承诺沿途，实测漏掉 81% 路线的对手租金（金额 59%）。
  // 改成逐层枚举，同一描述只留首次出现（最近的）并记 depth。
  const nearSteps = Math.max(0, remainingSteps - 1);
  const outlookTier = (plot, facility) => {
    if (facility) return 3;                       // 医院/监狱：不付钱但损失回合
    if (!plot.owner) return 1;                    // 可买 / 开售
    if (plot.closed) return plot.own ? 1 : 0;     // 对手停业=安全；己方停业=没用上
    return plot.own ? 2 : 4;                      // 己方租=收益；对手租=代价
  };
  const collected = new Map();                    // entry -> { entry, depth, tier, seq }
  let seq = 0;
  for (let d = nearSteps + 1; d <= nearSteps + ROUTE_OUTLOOK_STEPS; d++) {
    for (const nodeId of reachableLandings(state, clone, d)) {
      if (near.has(nodeId)) continue;
      const info = landingInfo(state, player, nodeId);
      const push = (entry, tier) => {
        if (collected.has(entry)) return;         // 只留首次（最近）出现
        collected.set(entry, { entry, depth: d, tier, seq: seq++ });
      };
      for (const plot of info.plots) {
        if (!plot.street) continue;
        // 与 landingText 同形：己方/对手 + 停业 或 租 N；无主则 可买 N / 第 N 天开售
        // 与 landingText 同形：己方/对手 + 停业 或 租 N；无主则 可买 N / 第 N 天开售。
        // #3341：这一屏也是「挑落点」，所以做不起的那一行同样要标出来（与 landingText 同口径）。
        // 多出的字数只加在做不起的那行上；做得到的不加字（本文件顶端有字数预算的来历）。
        const short = n => `（还差 ${n.toLocaleString()}）`;
        let tag;
        // 停业 = 走过去不付租。只写“停业”会被读成“他的地盘（危险）”，那是反的。
        if (plot.owner) tag = plot.closed ? '停业 · 不付租' : `租 ${plot.rent.toLocaleString()}`;
        else if (plot.availableFromDay && state.day < plot.availableFromDay) tag = `第 ${plot.availableFromDay} 天开售`;
        else tag = `可买 ${(plot.price ?? 0).toLocaleString()}` + (plot.affordable === false ? short(plot.shortForBuy) : '');
        // #3340：己方店不再印一个不会到账的租，改说走过去真能做的事（加盖）。
        const whom = plot.own ? '己方' : plot.owner ? plot.owner : '';
        // 到顶（或停业）时也不能回头写租金 —— 那条分支漏掉过一次，正是被本文件的判据咬出来的。
        if (plot.own) tag = plot.canBuild
          ? `可加盖 ${plot.buildAskCost.toLocaleString()}` + (plot.affordable === false ? short(plot.shortForBuild) : '')
          : '自己停在这里不收租';
        // 对手的店：付了会破产的那一行要说出来，而不是只报一个数。
        if (!plot.own && plot.owner && !plot.closed && plot.affordable === false) tag += ' · 会破产';
        push(`${plot.street}（${whom ? whom + ' · ' : ''}${tag}）`, outlookTier(plot, false));
      }      if (info.facility) {
        const f = info.facility === 'hospital' ? '医院' : '监狱';
        push(`${f}（失去 ${info.turnsLost} 回合）`, outlookTier(null, true));
      } else if (!info.plots.length && info.label !== '街道') {
        push(info.label, 1);
      }
    }
  }
  // 排序：depth 升序（近的在前）→ 同 depth 内 tier 降序（代价优先）→ 原出现顺序
  const grouped = [...collected.values()]
    .sort((a, b) => (a.depth - b.depth) || (b.tier - a.tier) || (a.seq - b.seq));
  const outlook = grouped.map(x => x.entry);
  const outlookDetail = grouped.map(x => ({ entry: x.entry, depth: x.depth, tier: x.tier }));
  return { text, outlook, outlookDetail, nodes: [...near] };
}

export function sliceTargetIds(state, player, cardId) {
  return state.map.plots.filter(plot=>{
    const pr=state.properties[plot.id],owner=state.players.find(p=>p.id===pr?.ownerId);
    if(cardId==='worker')return owner?.team===player.team&&pr.level>0&&pr.level<(state.config.maxLevel??3);
    // #3332：只收**别人已经开着的店**。空地不是「别人的小店」，而这张卡要付 125%
    // —— 把空地列进来就是拿溢价买一块走过去就能买的地（实测 240/240 个无主目标凭空烧钱）。
    if(cardId==='buyland')return takeoverEligible(state,plot.id)&&owner?.team!==player.team&&player.cash>=acquisitionPrice(state,plot.id);
    if(cardId==='inflate')return Object.values(state.properties).some(pr=>pr.street===plot.street&&pr.ownerId&&pr.level>0);
    return true;
  }).map(plot=>plot.id);
}

// #741：选街类卡（旺季 / 停业）在点下去那一刻该看到的量。
//
// 为什么需要：这两张卡的后果方向相反，而且都取决于「这条街归谁」——
// 在「对手 2 间、你 0 间」的街上开旺季是帮对手（对手每次踩到翻倍），停业才是压对手。
// 目标屏原来只有一句「直接点地图上的地产」，玩家得自己在地图上数名字。
//
// 只读：不改 state、不读随机数、不算金额以外的任何东西。
// 数字一律走 rentFor（引擎同一个函数），所以与真实结算一致；
// 但它随等级/旺季/停业变，调用方必须写「现在」，不能当固定值（#554 的规矩）。
// #3319：用卡后是多少，**不能**用「现在 ×2 / 归零」的公式推。
// 引擎在 game.js:543/500 只是把计时器**重设**成 3 / 2 天，不叠加；
// 而 rentFor 只要 inflate>0 就已经翻倍、closed>0 就已经归零。
// 所以对一条「已在旺季」的街，用卡后的租金和现在**一模一样**，变的是还能持续几天。
// 旧公式在这处会说谎（实测 2,668 行可见行里 58 行是假的，例如已翻倍的 22,400 被写成 44,800），
// 而且这些假行恰好变化量最大、被排序顶到最上面。
//
// 现在改成真的照引擎的做法改一次计时器、再读同一个 rentFor，读完立刻恢复 ——
// 与 upgradeAfterLine / buildOpportunityLine 同一套只读夹具，公式不再有第二份。
const CARD_TIMER = { inflate: 3, close: 2 };   // slice 档；完整模式 6 / 5
export function rentAfterStreetCard(state, street, cardId, mode = state?.config?.mode) {
  if (!CARD_TIMER[cardId]) return null;
  const plots = state.map.plots.filter(p => p.street === street);
  const saved = plots.map(p => ({ id: p.id, pr: state.properties[p.id],
    closed: state.properties[p.id]?.closed, inflate: state.properties[p.id]?.inflate }));
  const out = new Map();
  try {
    for (const p of plots) {
      const pr = state.properties[p.id];
      if (!pr) continue;
      if (cardId === 'inflate') pr.inflate = mode === 'slice' ? 3 : 6;
      if (cardId === 'close') pr.closed = mode === 'slice' ? 2 : 5;
    }
    for (const p of plots) out.set(p.id, rentFor(state, p.id));
  } finally {
    for (const s of saved) {
      if (!s.pr) continue;
      if (s.closed === undefined) delete s.pr.closed; else s.pr.closed = s.closed;
      if (s.inflate === undefined) delete s.pr.inflate; else s.pr.inflate = s.inflate;
    }
  }
  return out;
}

export function streetCardModel(state, viewer, cardId) {
  const viewerId = viewer?.id ?? null;
  const streets = [...new Set(state.map.plots.map(p => p.street))];
  const rows = streets.map(street => {
    const plots = state.map.plots.filter(p => p.street === street);
    // 用卡后的单块租金由引擎自己给出（照计时器改一次再读 rentFor），不在这里乘。
    const postRent = rentAfterStreetCard(state, street, cardId);
    let mineCount = 0, oppCount = 0, unowned = 0, mine = 0, opponent = 0;
    let afterMine = 0, afterOpponent = 0;
    let closed = 0, inflate = 0;
    // 单块租金也一并带出来：判据要能区分「街级合计」与「地图上本来就有的一块租」。
    const plotRents = [];
    for (const plot of plots) {
      const pr = state.properties[plot.id];
      const owner = pr?.ownerId ? state.players.find(q => q.id === pr.ownerId) : null;
      const rent = rentFor(state, plot.id);
      if (rent) plotRents.push(rent);
      if (!owner) { unowned += 1; continue; }
      // 用卡后归属不会变（旺季/停业都不换主人），所以按同一个 owner 分两边加。
      const after = postRent?.get(plot.id) ?? rent;
      if (owner.id === viewerId) { mineCount += 1; mine += rent; afterMine += after; }
      else { oppCount += 1; opponent += rent; afterOpponent += after; }
      // 只要有一块还在计时，这条街就还没恢复 —— 取最大值，别用「任意一块」冒充整条街。
      if ((pr?.closed ?? 0) > closed) closed = pr.closed;
      if ((pr?.inflate ?? 0) > inflate) inflate = pr.inflate;
    }
    // #3319：
    //   旺季 —— 我方由 mine→after.mine（多收），对方由 opponent→after.opponent（我踩到就多付）
    //   停业 —— 对方收不到（我踩到不用付，好事），我方也收不到（我少赚，坏事）
    // 方向按真实付款方写（flow.js:599：踩到的人付给地主）。
    //
    // 这个数是这一屏**唯一**的排序/点名依据：
    // 卡面（supplyWorth）、选街屏的排序、标题里点名的那条街，都从这里取。
    // 上一版是在 insight.js 与 render.js 各写一份公式 —— 两份公式一定会漂，
    // 而漂出来的正是「两屏互相打脸」这种最难当场发现的错。
    const net = cardId === 'inflate' ? (afterMine - mine) - (afterOpponent - opponent)
      : cardId === 'close' ? (opponent - afterOpponent) - (mine - afterMine)
      : null;
    return { street, mineCount, oppCount, unowned, mine, opponent,
      after: { mine: afterMine, opponent: afterOpponent }, net,
      closed, inflate, owned: mineCount + oppCount, plotRents };
  });
  // 只留「用卡会影响谁」的街：全无主的街放上去只是噪声。
  return rows.filter(r => r.owned > 0);
}

// #759：补给屏上的「值不值」。
//
// #742 只回答了「能不能下手」，没回答「下手值多少」。这里把每张卡此刻的**确定量**
// 用引擎自己的函数算出来，不另写估算器。
//
// 三条硬规矩（都是前面踩过的坑）：
//  1. 不把「对手恰好走到」当必然。旺季/停业的收益是「每踩到一次」的量，不是总额。
//     给一个总额单值就是编数 —— 所以这两张卡只出「每次」+ 最多/最少两端。
//  2. 金额必须带时点（#554）：翻修改动的是「现在」的租金，旺季还没开就写「用卡后」。
//  3. 翻修增益不靠改 state 试探：economy.js:29 的 base 随等级翻倍，
//     而它在 rentFor 里是整体乘进去的，所以「升一级的增量 == 当前租金」。
//     但仍然要留一条测试用 rentFor 前后对比来钉住这个等式（等式变了测试就红）。
export const BUYLAND_PREMIUM = 1.25;   // 与 game.js:454 的收购溢价一致；测试锁住两边相等

export function supplyWorth(state, viewer, cardId) {
  const buylandMul = BUYLAND_PREMIUM;
  if (cardId === 'worker') {
    const ids = sliceTargetIds(state, viewer, 'worker');
    const gains = ids.map(id => rentFor(state, id)).filter(v => v > 0);
    return { kind: 'certain', count: gains.length,
      each: [...new Set(gains)].sort((a, b) => b - a), total: gains.reduce((s, v) => s + v, 0) };
  }
  if (cardId === 'buyland') {
    const ids = sliceTargetIds(state, viewer, 'buyland');
    const prices = ids.map(id => acquisitionPrice(state, id));
  if (cardId === 'buyland') {
    const ids = sliceTargetIds(state, viewer, 'buyland');
    // #3332：合法目标现在只有「别人已开张的小店」。卡面给的数只此一种，不必再分类。
    const prices = ids.map(id => acquisitionPrice(state, id));
    return { kind: 'certain', count: ids.length,
      cheapest: prices.length ? Math.min(...prices) : 0, dearest: prices.length ? Math.max(...prices) : 0 };
  }
  }
  if (cardId === 'inflate' || cardId === 'close') {
    // 方向必须按引擎的真实结算写（flow.js:599：踩到的人付给地主）。
    //   旺季：那条街的地主每次踩到多收一倍。
    //     ⇒ 地主是**我**：我多收（对我好）；地主是**对手**：我踩到时多付（对我坏）。
    //   停业：那条街归零。
    //     ⇒ 对手的地盘归零（对我好，也保护我路过）；我自己的地盘归零（对我坏）。
    //
    // 上一版错得很严重：我把「对手」当成了付款方，屏上写「对手每次多付」——
    // 读起来像对手在花钱，实际上是他在收钱。而「最佳街」按对手租降序 ⇒
    // 推给玩家的恰好是**最帮对手**的那条街（夹具：晨光街对手 56,000/我 0 被推荐，
    // 而我真正该开的晚风街 22,400 根本没提）。
    //
    // 现在统一算「对我的净效果」：正数=赚，负数=亏，0=只影响对手。
    const rows = streetCardModel(state, viewer, cardId)
      .map(r => ({
        street: r.street,
        // 我在这条街上每次踩到自己地盘收多少 / 踩到对手地盘付多少
        myGain: r.mine, myCost: r.opponent,
        // 用卡后分别会变成多少（渲染层要写「对手 X→Y」时用同一个数）
        myGainAfter: r.after.mine, myCostAfter: r.after.opponent,
        // 用卡后对我的净效果（每次踩到的量）—— 由 streetCardModel 算一次，这里不重写公式。
        // #3319：它基于 r.after（引擎照计时器重设后读出的 rentFor），不是「现在×2 / 归零」。
        // 已在旺季的街再开旺季，租金不变（计时器重设），旧公式会报一个不存在的翻倍。
        net: r.net ?? 0,
      }))
      .filter(r => r.myGain > 0 || r.myCost > 0);
    // 选「对我最有利」的那条，而不是「对手最大」的那条。
    const best = rows.slice().sort((a, b) => b.net - a.net)[0] ?? null;
    return { kind: 'per-visit', rows, selfHarm: cardId === 'close',
      best: best ? { street: best.street, myGain: best.myGain, myCost: best.myCost, net: best.net } : null };
  }
  return null;   // 定步不产生金额
}

// #3332：收购选目标时，这四个候选**真的不一样**，而屏上四个都写「收 10,000」。
//
// 实测（take，seed 1–300，同样是第一回合出收购卡，只改买哪一间）：
//   晚风街 8,1 / 9,1 → 胜率 5.0% / 5.3%
//   灯火街 3,9 / 4,9 → 胜率 19.3% / 19.3%
// 价一样、等级一样、租金标称一样（都是 Lv.1 · 2,800），差别全在**这条街有没有人走**。
// 同 120 局按真实收租行统计（每次踩到付一次）：
//   灯火街两间合计 5,250/局   晚风街两间合计 677/局  ← 差 7.7 倍
// 所以「买哪一间」是第一回合真正有后果的决定，而当时屏上没有任何东西能区分它们。
//
// 这里只回答一个问题：**买下这一块之后，这条街每局大概能收多少**。
// 取数只用两件都已存在的东西：
//   ① rentFor（引擎同一个函数）—— 买下后我这块每次收多少；
//   ② RENT_POOL.meansPerPlot（72 局实测的「每间店每局被踩到几次」）—— 走得多不多。
// 不用「距离我多远」之类的猜测，也不读随机数、不写 state。
//
// 为什么必须带上「同街另一间」：买下 8,1 之后 9,1 还在对手手里，而引擎的
// 连锁乘数是「同街每多一块己方地乘一次」。实测买下 8,1 的同一帧：
//   我的 8,1 收 2,000；对手剩下的 9,1 从 2,800 掉到 2,000。
// 这就是「接盘」真正的收益 —— 不只多一间，还把他那条街的另一半压下去。
export function takeoverModel(state, viewer) {
  if (!state?.slice || !viewer) return null;
  const ids = sliceTargetIds(state, viewer, 'buyland');
  if (!ids.length) return null;
  const means = RENT_POOL.meansPerPlot;
  const rows = ids.map(id => {
    const plot = state.map.plots.find(p => p.id === id);
    const pr = state.properties[id];
    const seller = pr?.ownerId ? state.players.find(q => q.id === pr.ownerId) : null;
    const cost = acquisitionPrice(state, id);
    // 买下之后我这块每次收多少：照引擎的做法临时换主读一次 rentFor，读完恢复。
    // 与 upgradeAfterLine / rentAfterStreetCard 同一套只读夹具，不另写公式。
    let rentMine = 0;
    const savedOwner = pr?.ownerId;
    try {
      pr.ownerId = viewer.id;
      rentMine = rentFor(state, id);
    } finally {
      pr.ownerId = savedOwner;
    }
    const hits = means[plot?.name] ?? 0;
    const perGame = Math.round(rentMine * hits);
    // #3333：对手那块「每局」少收多少 —— **同一个量纲**（每局被踩次数 × 每次少收）。
    //
    // #3332 的错（用户当场抓到）：siblingLoss 是「对手**每次**被踩少收 800」这个**单次量**，
    // 却被直接加进「每局约 +N」，然后又在句尾印了一次 —— 屏上读成「多赚 2,078，再额外压 800」。
    // 实测同一帧：灯火街茶铺 perGame=1,278 + siblingLoss=800 = net=2,078，
    // 而 siblingLoss 真实的每局意义是 800 × 对手那块每局被踩 0.431 次 ≈ 345。
    // 两个数被加在一起，既重复计了一次，单位也不一致。
    //
    // 现在：两项各自都是「每局」，且都不含对方。排序才用它们的和。
    // 对手那条街剩下的那块会掉多少（同街连锁乘数断掉）。
    const siblings = state.map.plots.filter(p => p.street === plot?.street && p.id !== id);
    let siblingLoss = 0;
    for (const s of siblings) {
      const sp = state.properties[s.id];
      const owner = sp?.ownerId ? state.players.find(q => q.id === sp.ownerId) : null;
      if (!owner || owner.id === viewer.id) continue;
      const before = rentFor(state, s.id);
      const savedSib = sp.ownerId;
      try {
        sp.ownerId = viewer.id;             // 假设整条街都归我 —— 断链后的真实值
        siblingLoss += before - rentFor(state, s.id);
      } finally {
        sp.ownerId = savedSib;
      }
    }
    // 对手那块「每局」少收多少 = 每次少收 × 每局被踩次数（与 perGame 完全同一个量纲）。
    const siblingHits = siblings.reduce((s, p) => s + (means[p.name] ?? 0), 0);
    const siblingPerGame = Math.round(siblingLoss * siblingHits);
    return {
      id, name: plot?.name ?? id, street: plot?.street ?? '',
      seller: seller?.name ?? null, cost,
      rentMine, hits, perGame,
      siblingLoss: Math.round(siblingLoss),        // 每次被踩少收（单次量）
      siblingPerGame,                              // 每局约少收（与 perGame 同量纲）
    };
  });
  // 排序键 = 我这块每局能收多少 + 断掉对手连锁每局少收的。**两者同量纲（每局）**，互不包含。
  for (const r of rows) r.net = r.perGame + r.siblingPerGame;
  rows.sort((a, b) => b.net - a.net);
  return { rows, best: rows[0] ?? null, worst: rows[rows.length - 1] ?? null };
}
