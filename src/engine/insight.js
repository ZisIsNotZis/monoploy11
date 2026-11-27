import { buildAdj, edgeUsable } from './board-v2.js';
import { rentFor, buyPrice } from './economy.js';
import { TUNING } from '../data/tuning.js';

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
  const plots=(node?.adjacentPlots??[]).map(id=>{
    const plot=state.map.plots.find(p=>p.id===id), pr=state.properties[id];
    const owner=state.players.find(p=>p.id===pr?.ownerId);
    return {id,name:plot?.name??id,street:plot?.street,level:pr?.level??0,owner:owner?.name??null,
      own:owner?.team===player.team,price:buyPrice(state,id),rent:rentFor(state,id),closed:pr?.closed??0,inflate:pr?.inflate??0,availableFromDay:plot?.availableFromDay??1};
  });
  return {id:nodeId,label:node?.label??'街道',plots,effectDestination,facility,turnsLost,
    risk:plots.reduce((s,p)=>s+(!p.own&&p.owner?p.rent:0),0)};
}

export function landingText(state, player, id) {
  const info=landingInfo(state,player,id);
  if(info.facility) return `${info.label}：失去 ${info.turnsLost} 回合，结算后停在${info.facility==='hospital'?'医院':'监狱'}入口`;
  const details=info.plots.map(p=>`${p.name}：${p.owner?(p.own?'己方':p.owner)+' · '+(p.closed?'停业 · 不付租':`租 ${p.rent.toLocaleString()}`):state.day<p.availableFromDay?`第 ${p.availableFromDay} 天开售`:`可买 ${p.price.toLocaleString()}`}`);
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
        let tag;
        // 停业 = 走过去不付租。只写“停业”会被读成“他的地盘（危险）”，那是反的。
        if (plot.owner) tag = plot.closed ? '停业 · 不付租' : `租 ${plot.rent.toLocaleString()}`;
        else if (plot.availableFromDay && state.day < plot.availableFromDay) tag = `第 ${plot.availableFromDay} 天开售`;
        else tag = `可买 ${(plot.price ?? 0).toLocaleString()}`;
        const whom = plot.owner ? (plot.own ? '己方' : plot.owner) + ' · ' : '';
        push(`${plot.street}（${whom}${tag}）`, outlookTier(plot, false));
      }
      if (info.facility) {
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
    if(cardId==='buyland')return !plot.big&&owner?.team!==player.team&&player.cash>=Math.round(buyPrice(state,plot.id)*1.25);
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
export function streetCardModel(state, viewer, cardId) {
  const viewerId = viewer?.id ?? null;
  const streets = [...new Set(state.map.plots.map(p => p.street))];
  const rows = streets.map(street => {
    const plots = state.map.plots.filter(p => p.street === street);
    let mineCount = 0, oppCount = 0, unowned = 0, mine = 0, opponent = 0;
    let closed = 0, inflate = 0;
    // 单块租金也一并带出来：判据要能区分「街级合计」与「地图上本来就有的一块租」。
    const plotRents = [];
    for (const plot of plots) {
      const pr = state.properties[plot.id];
      const owner = pr?.ownerId ? state.players.find(q => q.id === pr.ownerId) : null;
      const rent = rentFor(state, plot.id);
      if (rent) plotRents.push(rent);
      if (!owner) { unowned += 1; continue; }
      if (owner.id === viewerId) { mineCount += 1; mine += rent; }
      else { oppCount += 1; opponent += rent; }
      // 只要有一块还在计时，这条街就还没恢复 —— 取最大值，别用「任意一块」冒充整条街。
      if ((pr?.closed ?? 0) > closed) closed = pr.closed;
      if ((pr?.inflate ?? 0) > inflate) inflate = pr.inflate;
    }
    // 用卡后：旺季租金翻倍，停业是 0。只算有主地产 —— 无主空地本来就不收租。
    const after = cardId === 'inflate' ? { mine: mine * 2, opponent: opponent * 2 }
      : cardId === 'close' ? { mine: 0, opponent: 0 }
      : { mine, opponent };
    return { street, mineCount, oppCount, unowned, mine, opponent, after,
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
    const prices = ids.map(id => Math.round(buyPrice(state, id) * buylandMul));
    return { kind: 'certain', count: ids.length,
      cheapest: prices.length ? Math.min(...prices) : 0, dearest: prices.length ? Math.max(...prices) : 0 };
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
        // 用卡后对我的净效果（每次踩到的量）
        net: cardId === 'inflate' ? (r.mine * 2 - r.mine) - (r.opponent * 2 - r.opponent)
                                 : (0 - r.mine) + r.opponent,
      }))
      .filter(r => r.myGain > 0 || r.myCost > 0);
    // 选「对我最有利」的那条，而不是「对手最大」的那条。
    const best = rows.slice().sort((a, b) => b.net - a.net)[0] ?? null;
    return { kind: 'per-visit', rows, selfHarm: cardId === 'close',
      best: best ? { street: best.street, myGain: best.myGain, myCost: best.myCost, net: best.net } : null };
  }
  return null;   // 定步不产生金额
}
