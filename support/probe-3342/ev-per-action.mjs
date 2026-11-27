// #3342 决定性问题：花出去的每 10,000，最后从哪条路回来？
//
// #3339/#3340 已经量过「加盖净亏」：花 10,000、标价 +4,000。但那只是**记分面**。
// 真正该问的是：这一间店此后实际产生了多少现金？并且必须分成两笔 ——
//   收租（对手踩到）  和  营业/巡视（我踩到）
// 若两笔之和仍小于花费，加盖就是陷阱；若其中一笔够大，加盖才是一条**路**。
//
// 做法：给每一间店记一份账。每次收入落账时按发生顺序归到具体店上：
//   · 「实付租金 N（店名）」            → 收租，记到那间店
//   · 「巡视/营业 +N」                  → 营业，按规则摊回该玩家名下各店
// 买入/加盖的时点也记下来，于是可以只统计「投资之后」的收入。
//
// 这个脚本不改产品；它读的是真实对局（config 由命令行决定跑哪个规则）。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { buildCost } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 30);
const MODE = process.argv[3] ?? 'trade:0.5';   // trade:<rate> | patrolflat:<n> | patrol:<n> | rent-only
const [mode, value] = MODE.split(':');
const RATE = Number(value ?? 0);
const STYLES = ['grow', 'take', 'cross'];

const per = () => ({ rent: 0, trade: 0 });
const ledger = new Map();        // plotId -> { ownerId, cost, rent, trade, atDay, kind }
const sums = { upgrade: { spend: 0, n: 0, rent: 0, trade: 0 }, buy: { spend: 0, n: 0, rent: 0, trade: 0 },
  daysLeftU: 0, daysLeftB: 0 };

for (const style of STYLES) for (let seed = 1; seed <= SEEDS; seed++) {
  const config = createSliceConfig({ human: false, seed, style });
  if (mode === 'trade') config.sliceTradeRate = RATE;
  if (mode === 'patrol') { config.slicePatrol = true; config.slicePatrolPerLevel = RATE; }
  if (mode === 'patrolflat') { config.slicePatrol = true; config.slicePatrolPerLevel = RATE; config.slicePatrolFlat = true; }
  const state = startSession(config);
  ledger.clear();
  for (const [id, pr] of Object.entries(state.properties)) {
    ledger.set(id, { ownerId: pr.ownerId, cost: 0, rent: 0, trade: 0, atDay: 0, kind: 'initial' });
  }
  // 从日志增量里找出每笔收入，归到店上。日志带 day，但没有 playerId ——
  // 用「同一回合内、该玩家自己的店」这个口径分摊，这是**近似**，写在这里免得被当成精确值。
  let lastDay = 0;
  const claim = (gameDay, playerName, storeName, amount, field) => {
    if (!amount) return;
    if (storeName) {
      const plot = state.map.plots.find(p => p.name === storeName);
      const rec = plot && ledger.get(plot.id);
      if (rec && rec.ownerId) { rec[field] += amount; return; }
    }
    // 没有店名（巡视合计）：按该玩家当前各店平均摊。
    const player = state.players.find(p => p.name === playerName);
    const ids = (player?.properties ?? []).filter(id => state.properties[id]?.ownerId === player.id);
    if (!ids.length) return;
    const share = Math.round(amount / ids.length);
    for (const id of ids) if (ledger.has(id)) ledger.get(id)[field] += share;
  };

  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      const answer = aiAnswer(prompt, state);
      if (prompt.type === 'buy' && answer) {
        const rec = ledger.get(prompt.plot.id);
        if (rec) { rec.ownerId = prompt.player.id; rec.cost += prompt.price; rec.atDay = state.day; rec.kind = 'buy'; }
      }
      if (prompt.type === 'build' && answer) {
        const rec = ledger.get(prompt.plot.id);
        if (rec) { rec.cost += prompt.cost; rec.atDay = state.day; rec.kind = 'upgrade'; }
      }
      return answer;
    },
  });

  // 收尾：先把日志逐行过一遍，再按「投资发生日之后」的收入统计。
  const investments = [];
  for (const line of state.log) {
    const rent = /^(\S+) 实付租金 (\d+)（([^）]+)）/.exec(line.text);
    if (rent) {
      const plot = state.map.plots.find(p => p.name === rent[3]);
      const rec = plot && ledger.get(plot.id);
      if (rec) rec.rent += +rent[2];
      continue;
    }
    const trade = /^(\S+) 在 (.+?) 营业 \+(\d+)/.exec(line.text);
    if (trade) { claim(line.day, trade[1], trade[2], +trade[3], 'trade'); continue; }
    const patrol = /^(\S+) 巡视自家店铺 \d+ 间，营业 \+(\d+)/.exec(line.text);
    if (patrol) { claim(line.day, patrol[1], null, +patrol[2], 'trade'); continue; }
  }
  // 只看「投资之后」的收入：把投资日之前的收入从记录里扣掉做不到（没有分日明细），
  // 所以改用保守口径：只统计**花过钱**的店，并且要求投资日 ≤ 第 8 天（还剩一半以上时间）。
  for (const [id, rec] of ledger) {
    if (!rec.cost) continue;
    const bucket = rec.kind === 'upgrade' ? sums.upgrade : sums.buy;
    const left = Math.max(0, state.config.dayLimit - rec.atDay);
    if (left < 6) continue;                 // 太晚才投，来不及回本，单独排除
    bucket.spend += rec.cost; bucket.n += 1; bucket.rent += rec.rent; bucket.trade += rec.trade;
    if (rec.kind === 'upgrade') sums.daysLeftU += left; else sums.daysLeftB += left;
  }
  lastDay = state.day;
}

const report = {};
for (const kind of ['upgrade', 'buy']) {
  const b = sums[kind];
  if (!b.n) { report[kind] = { n: 0 }; continue; }
  const total = b.rent + b.trade;
  report[kind] = {
    笔数: b.n,
    平均花费: Math.round(b.spend / b.n),
    平均收回: Math.round(total / b.n),
    其中收租: Math.round(b.rent / b.n),
    其中营业: Math.round(b.trade / b.n),
    净额: Math.round((total - b.spend) / b.n),
    每花费一万收回: Math.round((total / b.spend) * 10000),
    平均剩余天数: Math.round((kind === 'upgrade' ? sums.daysLeftU : sums.daysLeftB) / b.n),
  };
}
console.log(JSON.stringify({ mode: MODE, seeds: SEEDS, ...report }, null, 1));
