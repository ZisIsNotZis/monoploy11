// #3391t（第三支）：真机 smoke 的读数与引擎对不上，先把它隔离成一个可判真假的小实验。
//
// 真机现场（support/compare/entry-opening-smoke.mjs，正式入口、整条街开局、cross、seed 2、250 档）：
//   第 2 天日志只有两条进项：街角店主 750、机会买家 500 —— **0 号位（穿街高手，人类）一条都没有**，
//   现金 46,000 − 加盖 10,000 = 36,000，一分进项没拿到。
//   但按规则，0 号位在整条街表里开局就独享晨光街两间，且刚把茶铺升到 Lv.2，
//   应当拿到 250×1 + 250×2 = 750。
//
// 这支探针只做一件事：把「0 号位独享一条街」这件事在引擎里摆好，调引擎自己的
// settleStreetBusiness，看它到底付给谁。不靠日志推断，直接比现金。
//
// 用法：node support/probe-3391/income-seat0.mjs
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, settleStreetBusiness } from '../../src/engine/flow.js';

const PER_SHOP = 250;
const fail = [];
const check = (ok, msg) => { console.log(`  ${ok ? '✅' : '❌'} ${msg}`); if (!ok) fail.push(msg); };

for (const table of ['whole', 'contested']) {
  console.log(`\n=== ${table} 表 · 0 号位独享一条街 ===`);
  const config = createSliceConfig({
    human: true, style: 'cross', seed: 2,
    sliceContestedStreets: table === 'contested',
  });
  const state = startSession(config);
  state.config.streetBusinessPerShop = PER_SHOP;
  const seat0 = state.players[0];

  // 0 号位实际拿到什么 —— 这是后面所有判断的前提。
  const rows = state.map.plots.filter(pl => !pl.big).map(pl => {
    const pr = state.properties[pl.id];
    return { id: pl.id, street: pl.street, owner: pr.ownerId ?? null, level: pr.level, closed: pr.closed ?? 0 };
  });
  const mine = rows.filter(r => r.owner === seat0.id);
  console.log(`  0 号位（${seat0.name}）持有：${mine.map(r => `${r.id}@${r.street} Lv${r.level}`).join(' · ') || '（无）'}`);

  // 找一条「整条街都是 0 号位」的街；没有就如实说，不硬造。
  const byStreet = new Map();
  for (const r of rows) { const cur = byStreet.get(r.street) ?? []; cur.push(r); byStreet.set(r.street, cur); }
  const whole = [...byStreet].filter(([, rs]) => rs.every(r => r.owner === seat0.id));
  if (!whole.length) {
    console.log('  这条表上 0 号位没有完整的一条街 —— 跳过结算（这正是争街表的已知结构）');
    continue;
  }
  for (const [street, rs] of whole) console.log(`  整条街归它：${street}（${rs.length} 间）`);

  // 摆一个「其中一间升到 Lv.2」的局面 —— 真机里 0 号位就是这么做的。
  const [street, rs] = whole[0];
  state.properties[rs[0].id].level = 2;
  const expected = rs.reduce((a, r) => a + PER_SHOP * Math.max(1, state.properties[r.id].level), 0);

  const before = new Map(state.players.map(p => [p.id, p.cash]));
  settleStreetBusiness(state);
  const gained = state.players.map(p => ({ name: p.name, id: p.id, got: p.cash - before.get(p.id),
    stats: p.sliceStats?.business ?? 0 }));

  console.log('  结算后各家现金变化：' + gained.map(g => `${g.name} +${g.got}`).join(' · '));
  console.log(`  期望 ${seat0.name}（0 号位）+${expected}（${street} ${rs.length} 间，其中一间 Lv.2）`);
  check(gained.find(g => g.id === seat0.id)?.got === expected, `0 号位拿到 ${expected}`);
  check(state.players.filter(p => p.id !== seat0.id).every(p => p.cash === before.get(p.id)),
    '其他家一分没拿（这条街不是他们的）');
}

// 反面：同一局面下把 0 号位一间店拿走，进项必须归 0 —— 否则「整条街」这个条件没生效。
console.log('\n=== 反面：把 0 号位这条街的一间转给别人 ===');
{
  const state = startSession(createSliceConfig({ human: true, style: 'cross', seed: 2, sliceContestedStreets: false }));
  state.config.streetBusinessPerShop = PER_SHOP;
  const seat0 = state.players[0];
  const streetPlots = state.map.plots.filter(pl => !pl.big && state.properties[pl.id].ownerId === seat0.id);
  const other = state.players[1];
  state.properties[streetPlots[0].id].ownerId = other.id;
  other.properties.push(streetPlots[0].id);
  seat0.properties = seat0.properties.filter(x => x !== streetPlots[0].id);
  const before = seat0.cash;
  settleStreetBusiness(state);
  check(seat0.cash === before, `少一间 ⇒ 0 号位进项 0（实得 ${seat0.cash - before}）`);
}

console.log(fail.length ? `\nFAIL\n - ${fail.join('\n - ')}` : '\nPASS：规则本身按「整条街归我」正确结算');
process.exit(fail.length ? 1 : 0);
