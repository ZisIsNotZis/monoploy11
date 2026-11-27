// 可亲手试的「整条街营业进项」：#3391s。
//
// **这是对照页，不是产品改动。** 规则本身在引擎里（src/engine/flow.js 的 settleStreetBusiness），
// 但默认关闭；本页把它打开（每店每天 250），正式入口照旧没有这条规则。
//
// 为什么先做成能亲手玩的对照，而不是直接改默认：
//   · 它第一次把「两条路打平」做出来了（360 局/臂，同局配对）：
//       「只开街」33.3% 对「只抢高地」33.1%，差 +0.3pp [−6.9, 7.2]；
//       而符号随起手翻：街角店主 +28.3pp、机会买家 −15.8pp、穿街高手 −11.7pp。
//   · 但量级没定下来：加进项让「照常打」整体 +17.8pp，三起手差距 10.8 → 32.5pp。
//     200–350 两档都不可发布。**谁该强、量级多大是产品决策**，不该由我替用户定。
// 所以：让人亲手玩一局再决定。证据见 support/probe-3391/RESULT.md 3d 与 shop-income.mjs。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession } from '../../src/engine/flow.js';
import { settleStreetBusiness } from '../../src/engine/flow.js';

const PER_SHOP = 250;

// ① 把参数补到地址栏 —— main.js 是读 URL 决定开不开这条规则的。
//    少了这一步，「页面能打开」会被当成「规则生效」（我在 #3391n 栽过同样的跟头）。
// #3391t：只在本页「第一次打开」时把 250 填进去。
// 以前每次加载都强塞 250 ⇒ 玩家在屏上选「无营业进项」开局后刷新，又被改回 250，
// 屏上说的和他选的又对不上。已有 business 参数（包括 0）时一律尊重。
const url = new URL(location.href);
if (!url.searchParams.has('business')) {
  url.searchParams.set('business', String(PER_SHOP));
  if (url.searchParams.get('slice') !== '1') url.searchParams.set('slice', '1');
  history.replaceState(null, '', url.href);
}
document.documentElement.dataset.variant = 'street-business';
document.documentElement.dataset.businessPerShop = String(PER_SHOP);
console.log(`[street-business] 营业进项 = 每店每天 ${PER_SHOP}（一条街的小店全归你才结算）`);

// ② 自检：**用引擎自己的函数**验一遍这条规则真的按这个量级工作。
//    为什么不靠读对局日志：进项在第 2 天结算，而真人一局要按几十次才走到第 2 天，
//    「日志里还没出现」既可能是规则没开，也可能只是还没走到 —— 那是「把沉默当读数」，
//    正是我这一片反复犯的错。这里改成一次可判真假的调用。
{
  const state = startSession(createSliceConfig({ human: false, seed: 1, sliceContestedStreets: true }));
  state.config.streetBusinessPerShop = PER_SHOP;
  // 给 0 号位一条完整的小店街（找地图上第一对同街小店）。
  const byStreet = new Map();
  for (const pl of state.map.plots) {
    if (pl.big) continue;
    const cur = byStreet.get(pl.street) ?? [];
    cur.push(pl.id);
    byStreet.set(pl.street, cur);
  }
  const [, pair] = [...byStreet].find(([, ids]) => ids.length >= 2);
  const p = state.players[0];
  for (const id of pair) {
    const pr = state.properties[id];
    if (pr.ownerId && pr.ownerId !== p.id) {
      const prev = state.players.find(q => q.id === pr.ownerId);
      if (prev) prev.properties = prev.properties.filter(x => x !== id);
    }
    pr.ownerId = p.id;
    pr.closed = 0;
    if (!p.properties.includes(id)) p.properties.push(id);
  }
  const before = p.cash;
  const levels = pair.map(id => Math.max(1, state.properties[id].level));
  const expected = levels.reduce((a, lv) => a + PER_SHOP * lv, 0);
  settleStreetBusiness(state);
  const got = p.cash - before;
  document.documentElement.dataset.ruleCheck = got === expected ? 'ok' : `bad:${got}!=${expected}`;
  console.log(`[street-business] 自检：一条街 ${pair.length} 间全归我 ⇒ 结算 ${got}，期望 ${expected}`);

  // 反面：把其中一间拿走，这条街就不该再有任何进项。
  const stolen = state.properties[pair[0]];
  stolen.ownerId = state.players[1].id;
  state.players[1].properties.push(pair[0]);
  p.properties = p.properties.filter(x => x !== pair[0]);
  const before2 = p.cash;
  settleStreetBusiness(state);
  const got2 = p.cash - before2;
  document.documentElement.dataset.ruleNegative = got2 === 0 ? 'ok' : `bad:${got2}`;
  console.log(`[street-business] 反面：少一间 ⇒ 结算 ${got2}，期望 0`);
}
