// #3391zp2 / #3391zp3：把**确认框**与**流水单**并排打出来读一遍，平常与旺季各一遍。
//
// supervisor 第四轮：「我是在加盖前做决定，而且拿流水单看仍会用 4,000 去除成本。」
// supervisor 第五轮：「我用同一间店复算了已经在旺季的状态：平常增量 2,800、要四次，
//   旺季增量 5,600、要两次。屏上给出旺季的两次后，仍说旺季每次可算两次，容易读成一次就回本。
//   流水的『按上一条』单独翻看也找不到那笔除法。
//   请让两处以能当场确认的金额为准，未来的涨租或少收就说明会变。」
//
// 所以这个探针不查措辞，查可判的事：
//   ① 两块屏都说出了**同一句**除法（花费 ÷ 每次多收 = N 次），且 N 与现算一致；
//   ② 分母是增量，不是升级后的全额（「别拿 N 去除」必须出现）；
//   ③ **抬价不许被重复计数**：unit 已经是含翻倍的数时，句子里不许再说「一次算两次」；
//      而旺季现场必须给出「旺季结束后要几次」这个更差的数（读者拿它做决定才不吃亏）；
//   ④ 流水那一行**单看**就能做那道除法（花费与分母同在一行）。
// 用法：node support/probe-3391z/dump-forward.mjs [style] [seed] [inflate]
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, buildPlot } from '../../src/engine/flow.js';
import { buildForwardK, buildForwardLine } from '../../src/ui/slice.js';
import { paybackAccount, seasonTerms } from '../../src/engine/payback.js';
import { rentFor } from '../../src/engine/economy.js';

const style = process.argv[2] ?? 'take';
const seed = Number(process.argv[3] ?? 3);
const wantInflate = (process.argv[4] ?? '0') !== '0';
const s = startSession(createSliceConfig({ seed, style }));
const [me] = s.players;

const prefer = '月色街茶铺';
const id = me.properties.find(x => s.map.plots.find(p => p.id === x)?.name === prefer) ?? me.properties[0];
const plot = s.map.plots.find(p => p.id === id);
s.properties[id].level = 1;
if (wantInflate) s.properties[id].inflate = 2;
const cost = 10000;

const info = buildForwardK(s, id, cost);
const terms = seasonTerms(s, id, info.level);
const confirm = buildForwardLine(s, id, cost);

console.log(`# ${plot.name} Lv1 收 ${rentFor(s, id).toLocaleString()} → 加盖 ${cost.toLocaleString()}（${style}/seed ${seed}${wantInflate ? '，旺季中' : ''}）`);
console.log(`# 现算增量 ${info.unit.toLocaleString()} / 全额 ${info.after.toLocaleString()} / K=${info.K}`);
console.log(`# 平常口径 增量 ${terms.plainUnit.toLocaleString()} → ${Math.ceil(cost / terms.plainUnit)} 次`
  + ` / 旺季口径 增量 ${terms.hotUnit.toLocaleString()} → ${Math.ceil(cost / terms.hotUnit)} 次`);
console.log('\n=== 确认框（决定之前）===');
console.log(confirm);

me.cash = 500000;
const before = s.log.length;
buildPlot(s, me, id);
const rows = s.log.slice(before).map(x => x.text);
console.log('\n=== 流水单（决定之后）===');
for (const r of rows) console.log('  ' + r);

const account = paybackAccount(cost, info.unit, info.K, info.after, terms);
const ledger = rows.find(r => r.includes('这笔怎么算'));
const upgradeRow = rows.find(r => r.includes('次回本'));
const fail = [];

// ① 两块屏同一句
if (!confirm.includes(account)) fail.push('确认框没有那句共用的账');
if (!ledger || !ledger.includes(account)) fail.push('流水单没有那句共用的账');

// ② 分母是增量
if (!new RegExp(`${cost.toLocaleString()} ÷ 每次多收 ${info.unit.toLocaleString()} = ${info.K} 次`).test(account)) {
  fail.push(`账里的除法不是「花费 ÷ 每次多收 = 现算 K」：${account}`);
}
if (!/别拿 [\d,]+ 去除/.test(confirm)) fail.push('确认框没堵死「拿全额当分母」的读法');

// ③ 抬价不许重复计数；旺季现场必须给出更差的数
const all = confirm + '\n' + rows.join('\n');
if (/算两次/.test(all)) {
  fail.push('又把旺季说成「算两次」—— unit 已经含翻倍，这句是重复计数');
}
if (terms.inflating) {
  if (info.unit !== terms.hotUnit) fail.push(`旺季里增量应等于旺季口径 ${terms.hotUnit}，实得 ${info.unit}`);
  const plainK = Math.ceil(cost / terms.plainUnit);
  if (!new RegExp(`旺季[^。]*每次只多收 ${terms.plainUnit.toLocaleString()}，那时要 ${plainK} 次`).test(confirm)) {
    fail.push(`旺季现场没写「旺季结束后每次只多收 ${terms.plainUnit.toLocaleString()}，要 ${plainK} 次」：${confirm}`);
  }
} else {
  if (info.unit !== terms.plainUnit) fail.push(`平常里增量应等于平常口径 ${terms.plainUnit}，实得 ${info.unit}`);
  if (!/不在旺季/.test(confirm)) fail.push(`平常现场没说这是平常的数：${confirm}`);
  if (!new RegExp(`进了旺季每次会多收 ${terms.hotUnit.toLocaleString()}`).test(confirm)) {
    fail.push(`平常现场没说旺季会多收多少：${confirm}`);
  }
}

// ④ 流水那一行自足：花费与分母同在一行，单看能做完那道除法
if (!upgradeRow) fail.push('流水里没有升级行');
else {
  if (!upgradeRow.includes(`花 ${cost.toLocaleString()}`)) fail.push(`升级行没有花费：${upgradeRow}`);
  if (!upgradeRow.includes(`每次多收 ${info.unit.toLocaleString()}`)) fail.push(`升级行没有分母：${upgradeRow}`);
  if (!upgradeRow.includes(`${info.K} 次`)) fail.push(`升级行没有次数：${upgradeRow}`);
  // 租金字段仍是升级后的全额（已签约束），且不许写「回合回本」
  if (!upgradeRow.includes(rentFor(s, id).toLocaleString())) fail.push(`升级行的租金不是升级后的全额：${upgradeRow}`);
  if (/回合回本/.test(upgradeRow)) fail.push(`升级行又写「回合」了：${upgradeRow}`);
}

// 复原，避免污染同进程后续
s.properties[id].inflate = 0;

console.log('\n=== 判 ===');
console.log(fail.length ? 'FAIL\n  - ' + fail.join('\n  - ') : 'PASS 两块屏同一笔账；旺季不重复计数；流水行自足');
if (fail.length) process.exitCode = 1;
