// #3391zp2：把**确认框**与**流水单**并排打出来读一遍。
//
// supervisor 第四轮的原话：「我是在加盖前做决定，而且拿流水单看仍会用 4,000 去除成本。
// 请把确认和流水当成同一笔账验回来。」
// 所以这个探针不查措辞，查三件可判的事：
//   ① 两块屏都说出了同一句除法（花费 ÷ 每次多收 = N 次），且 N 相同；
//   ② 两块屏都不许教人拿升级后的全额当分母（「用 4,000 去除」那种读法必须被明确堵死）；
//   ③ 「少付」与「抬价」不许混成一句 —— 抬价是**多收**（一次顶两次），少付是付不出。
// 用法：node support/probe-3391z/dump-forward.mjs [style] [seed]
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, buildPlot } from '../../src/engine/flow.js';
import { buildForwardK, buildForwardLine } from '../../src/ui/slice.js';
import { paybackAccount } from '../../src/engine/payback.js';
import { rentFor } from '../../src/engine/economy.js';

const style = process.argv[2] ?? 'take';
const seed = Number(process.argv[3] ?? 3);
const s = startSession(createSliceConfig({ seed, style }));
const [me] = s.players;

// supervisor 的实例：月色街茶铺。找不到就退到第一块地。
const prefer = '月色街茶铺';
const id = me.properties.find(x => s.map.plots.find(p => p.id === x)?.name === prefer) ?? me.properties[0];
const plot = s.map.plots.find(p => p.id === id);
s.properties[id].level = 1;
const cost = 10000;

const info = buildForwardK(s, id, cost);
const confirm = buildForwardLine(s, id, cost);

console.log(`# ${plot.name} Lv1 收 ${rentFor(s, id).toLocaleString()} → 加盖 ${cost.toLocaleString()}（${style}/seed ${seed}）`);
console.log(`# 增量 ${info.unit.toLocaleString()} / 全额 ${info.after.toLocaleString()} / K=${info.K}`);
console.log('\n=== 确认框（决定之前）===');
console.log(confirm);

// 流水：真按一次加盖，取那两条账行。
me.cash = 500000;
const before = s.log.length;
buildPlot(s, me, id);
const rows = s.log.slice(before).map(x => x.text);
console.log('\n=== 流水单（决定之后）===');
for (const r of rows) console.log('  ' + r);

const account = paybackAccount(cost, info.unit, info.K, info.after);
const ledger = rows.find(r => r.includes('这笔怎么算'));
const fail = [];
if (!confirm.includes(account)) fail.push('确认框没有那句共用的除法');
if (!ledger || !ledger.includes(account)) fail.push('流水单没有那句共用的除法');
// 按含义判：分母必须是「每次多收」那个增量（不是全额），且句子自己说出来。
if (!/每次多收/.test(confirm)) fail.push('确认框没写清分母是每次多收');
if (!confirm.includes(info.unit.toLocaleString())) fail.push('确认框里没有增量那个数');
if (!/别拿 [\d,]+ 去除/.test(confirm)) fail.push('确认框没堵死「拿全额当分母」的读法');
if (!rows.some(r => /别拿 [\d,]+ 去除/.test(r))) fail.push('流水单没堵死「拿全额当分母」的读法');
// ③ 少付与抬价必须分开：抬价只能出现在「多收」的说法里。
if (!/旺季那次租金翻倍/.test(confirm) || !/不是少付/.test(confirm)) {
  fail.push('确认框没说清抬价是多收，不是少付');
}
if (/被抬价那次不足/.test(confirm) || /被抬价那次不足/.test(rows.join('\n'))) {
  fail.push('还留着「被抬价那次不足」——抬价是多收，不是少付');
}
console.log('\n=== 判 ===');
console.log(fail.length ? 'FAIL\n  - ' + fail.join('\n  - ') : 'PASS 两块屏同一笔账，三种情形分开');
if (fail.length) process.exitCode = 1;
