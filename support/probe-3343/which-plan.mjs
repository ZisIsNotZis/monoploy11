// #3343 续：两种打法从哪里长出来 —— 把「买地」拆成三种花钱的意图，同 seed 配对。
//
// 上一支（plan-or-ledger.mjs）已经证明「买 vs 不买」不是零和：take/cross +24～25pp。
// 但它只量了「买不买」，没量「买哪一种」。玩家真正在屏上做的选择是后面这个：
//   同一笔 8,000～12,000，是去买「自己已有店那条街的另一半」，还是去买「一条陌生的街」，
//   还是干脆不买、把现金留到第 4 天去抢街心书屋？
//
// 三支只改 0 号位的 buy 应答，其余全部一样（出牌、走位、加盖、收购、补给）：
//   any    = 引擎原样，能买就买（对照）
//   same   = 只买「这条街我已有一间店」的地（补齐一条街 → 同街乘数 ×1.4 起）
//   hold   = 小店一律不买，只买大地产（书屋），即把现金留到第 4 天
//
// 判据不是「谁胜率高」一个数，而是每支各自改变了什么：
//   同街乘数 ×1.4 只作用在**已被踩中的那次**上，所以 same 支的价值必须体现在
//   「收租均值」与「收租次数」同时上升；若只有均值升、次数不升，说明它只是把
//   少数几次放大，不是新计划，只是同一张彩票买了两注。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf, rentFor } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 60);
const CONTESTED = process.argv[3] === 'cross';
// 座次轮换：把 config.participants 转过 k 位，被测的那个「起手」就坐到别的椅子上。
// 为什么要这样：争街表给 0 号位的两条街都是「免费补齐」，于是「same 支更好」可能只是
// 座位红利，不是「补齐一条街」这条路本身值钱。按起手（而不是按座位）锁住被测玩家，
// 换椅子重读，才能把两件事分开。
const SEAT = Number(process.argv[4] ?? 0);
// 每局决定数上限：产品自己的 evaluate-slice 用 5000。超过就说明探针在同一个屏上打转，
// 宁可抛错也不要计着 CPU 挂住（上一版就是这样挂了 23 分钟才发现）。
const DECISION_CAP = 1500;
const LAYOUT = CONTESTED ? '争街 (?cross=1)' : '默认（每人整条街）';
const STYLES = ['grow', 'take', 'cross'];
// complete = 「补齐一条街」：不买无主小店、不买陌生街的店，把现金与收购卡
// 全用在自己已有店那条街的另一半上。这是用户说的那条计划的直接实现。
const ARMS = ['any', 'same', 'hold', 'complete'];

const streetOf = (state, plotId) => state.map.plots.find(p => p.id === plotId)?.street;
const ownOnStreet = (state, p, street) => p.properties
  .filter(id => state.properties[id]?.street === street).length;

const out = {};
for (const arm of ARMS) for (const style of STYLES) {
  const row = out[`${arm}/${style}`] = { games: 0, wins: 0, bankrupt: 0,
    buys: 0, spend: 0, sameStreetBuys: 0, bigBuys: 0,
    rentEarned: 0, rentRows: 0, cash: 0, assets: 0, minCash: 0, plots: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const cfg = createSliceConfig({ human: false, seed, style, sliceContestedStreets: CONTESTED });
    if (SEAT) cfg.participants = [...cfg.participants.slice(SEAT), ...cfg.participants.slice(0, SEAT)];
    const state = startSession(cfg);
    // 按**起手**锁住被测玩家（而不是按座位）；座次已经轮过。
    const seat0 = state.players.find(p => p.style === style) ?? state.players[0];
    const plots0 = new Set(seat0.properties);
    let buys = 0, spend = 0, sameBuys = 0, bigBuys = 0, minCash = seat0.cash, decisions = 0;
    // 兜底门：若 target 屏真的没有合法目标，就把「别再用这张卡」闩上，
    // 否则会回到同一张 action 屏（这正是上一版的死循环形态）。
    let buylandBlocked = false;
    // 看门狗：actionPhase 在「选了一张卡、但它的合法目标为空」时会 `continue` 回到同一屏，
    // 而 AI 是确定性的 ⇒ 同一张卡被反复选中，永远不消耗。这不是探针的错，是引擎的形态。
    // 探针遇到它不能计着 CPU 转：同一个签名第二次出现就强制掷骰，并把肇事卡记下来。
    let lastActionSig = null;
    const stuckCards = new Map();
    await runGame(state, {
      render() { minCash = Math.min(minCash, seat0.cash); },
      async step() {},
      async ask(prompt) {
        // #3343 修正（supervisor 复现）：**所有**覆盖必须先确认「现在轮到被测玩家」。
        // 上一版只给 buy 加了这道门，action / target 没有 —— 于是轮到 p1 时，
        // 我拿 p3 的手牌意图回答，返回的卡序号对 p1 不合法，引擎拒绝、重问，
        // 同一屏无限循环（complete / take / seed 1 / seat 1，已复现）。
        // 探针比产品更该守这条：一个搞错主体的量具，读数比没有读数更危险。
        const mine = prompt.player?.id === seat0.id;
        if (!mine) {
          // 别人行动：完全交给原 AI，一个字节都不改。
          return aiAnswer(prompt, state);
        }
        if (++decisions > DECISION_CAP) {
          throw new Error(`决策次数超过 ${DECISION_CAP}：arm=${arm} style=${style} seed=${seed} seat=${SEAT} day=${state.day} type=${prompt.type} player=${prompt.player?.id}`);
        }
        if (prompt.type === 'action') {
          const sig = `${state.day}|${state.turn}|${seat0.cards.join(',')}|${seat0.sliceCardsUsed ?? 0}|${state.day}_${state.phase}`;
          if (sig === lastActionSig) {
            const blame = seat0.cards[(lastActionIndex ?? -1)] ?? '(roll)';
            stuckCards.set(blame, (stuckCards.get(blame) ?? 0) + 1);
            return { action: 'roll', dice: 1 };
          }
          lastActionSig = sig;
          lastActionIndex = null;
        }
        if (prompt.type === 'buy') {
          minCash = Math.min(minCash, seat0.cash);
          const plot = prompt.plot;
          if (!plot) return aiAnswer(prompt, state);
          const sameStreet = ownOnStreet(state, seat0, plot.street) >= 1;
          if (arm === 'hold' && !plot.big) return false;
          if (arm === 'same' && !plot.big && !sameStreet) return false;
          if (arm === 'complete' && !plot.big) return false;   // 小店一律不买，把现金留给收购
          const ok = aiAnswer(prompt, state);
          if (ok) {
            buys++; spend += prompt.price;
            if (plot.big) bigBuys++; else if (sameStreet) sameBuys++;
          }
          return ok;
        }
        // complete 支：收购卡只砸在「自己已有店那条街的另一半」上 —— 争街布局里
        // 这是唯一能「补齐一条街」的路（同街另一半在对手手上，buy 屏根本不会出现）。
        if (arm === 'complete' && prompt.type === 'target' && prompt.cardId === 'buyland') {
          const allowed = (prompt.plotIds ?? []).filter(id => {
            const st = streetOf(state, id);
            return st && ownOnStreet(state, seat0, st) >= 1;
          });
          if (!allowed.length) { buylandBlocked = true; return null; }
          const pick = aiAnswer({ ...prompt, plotIds: allowed }, state);
          return allowed.includes(pick) ? pick : allowed[0];
        }
        // complete 支：收购卡只在这条街真有「可补的另一半」时打出；
        // 没有可补的就**把这张卡从候选里拿走**再问 AI ——
        // 否则 AI 仍可能选收购卡，而 target 覆盖又把它拒成 null，
        // 引擎 continue 回到同一张 action 屏，就成了上一版那个死循环。
        if (arm === 'complete' && prompt.type === 'action') {
          if ((seat0.sliceCardsUsed ?? 0) >= 2) return { action: 'roll', dice: 1 };
          const hasPair = state.map.plots.some(pl => !pl.big
            && state.properties[pl.id]?.ownerId
            && state.players.find(q => q.id === state.properties[pl.id].ownerId)?.team !== seat0.team
            && ownOnStreet(state, seat0, pl.street) >= 1);
          const idx = seat0.cards.indexOf('buyland');
          if (hasPair && idx >= 0 && !buylandBlocked) { lastActionIndex = idx; return { action: 'card', index: idx }; }
          const saved = seat0.cards;
          try {
            seat0.cards = saved.filter(c => c !== 'buyland');
            if (!seat0.cards.length) return { action: 'roll', dice: 1 };
            const a = aiAnswer(prompt, state);
            if (a?.action === 'card') {
              const want = saved.filter(c => c !== 'buyland')[a.index];
              return { action: 'card', index: saved.indexOf(want) };
            }
            return a ?? { action: 'roll', dice: 1 };
          } finally { seat0.cards = saved; }
        }
        return aiAnswer(prompt, state);
      },
    });
    if (!state.over) continue;
    row.games++;
    if (state.winnerTeam === seat0.team) row.wins++;
    if (!seat0.alive) row.bankrupt++;
    row.buys += buys; row.spend += spend;
    row.sameStreetBuys += sameBuys; row.bigBuys += bigBuys;
    row.rentEarned += seat0.sliceStats.rentEarned;
    row.cash += seat0.cash;
    row.assets += assetsOf(state, seat0);
    row.minCash += minCash;
    row.plots += seat0.properties.length - plots0.size;
    for (const line of state.log) if (/实付租金/.test(line.text) && /收到/.test(line.text)) row.rentRows++;
  }
  const n = row.games || 1;
  row.winRate = +(100 * row.wins / n).toFixed(1);
  row.bankruptRate = +(100 * row.bankrupt / n).toFixed(1);
  for (const k of ['buys', 'spend', 'sameStreetBuys', 'bigBuys', 'rentEarned', 'cash', 'assets', 'minCash', 'plots']) row[k] = Math.round(row[k] / n * 10) / 10;
  row.rentPerHit = row.rentRows ? Math.round(row.rentEarned * n / row.rentRows) : null;
  row.rentHitsPerGame = +(row.rentRows / n).toFixed(2);
}

console.log('=== 三种花钱意图 · ' + LAYOUT + ' · 被测起手坐在 ' + SEAT + ' 号位（同 seed 配对，每格 ' + SEEDS + ' 局）===');
for (const style of STYLES) {
  console.log('\n起手 ' + style);
  for (const arm of ARMS) {
    const r = out[`${arm}/${style}`];
    console.log('  ' + arm.padEnd(5), JSON.stringify({
      胜率: r.winRate + '%', 破产率: r.bankruptRate + '%',
      买: r.buys, 同街: r.sameStreetBuys, 大店: r.bigBuys, 花: r.spend,
      收租: r.rentEarned, 收租次数: r.rentHitsPerGame, '每次均额': r.rentPerHit,
      季末现金: r.cash, 资产: r.assets, 局中最低: r.minCash, 净增店: r.plots,
    }));
  }
  const a = out[`any/${style}`], s = out[`same/${style}`], h = out[`hold/${style}`], c = out[`complete/${style}`];
  console.log('  差(pp): same−any', +(s.winRate - a.winRate).toFixed(1),
    ' hold−any', +(h.winRate - a.winRate).toFixed(1),
    ' complete−any', +(c.winRate - a.winRate).toFixed(1));
}

// 同街乘数的算术：一间自己的店 + 同街第二间，租金到底涨多少。
{
  const state = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: CONTESTED }));
  const seat0 = state.players[0];
  const own = seat0.properties.find(id => !state.properties[id].big);
  const street = state.properties[own].street;
  const other = state.map.plots.find(p => !p.big && p.street === street && p.id !== own);
  const r1 = rentFor(state, own);
  const saved = { ...state.properties[other.id] };
  state.properties[other.id] = { ...saved, ownerId: seat0.id, level: 1 };
  const r2 = rentFor(state, own);
  state.properties[other.id] = saved;
  console.log('\n=== 同街乘数核对 ===');
  console.log(JSON.stringify({ 街: street, 一间时: r1, 两间时: r2, 倍数: +(r2 / r1).toFixed(2),
    说明: '乘数 1+0.4×(本街己方已建店数−1) 只放大「已经被踩中」的那一次，不增加被踩次数' }));
}
