import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, buildPlot } from '../src/engine/flow.js';
import { assetsOf, buyPrice, buildCost } from '../src/engine/economy.js';
import { render } from '../src/ui/render.js';
import { buildOrderLine } from '../src/ui/slice.js';

// #3335：主管在 90f15f9 的真机上抓到的两件事，都写在这里当判据。
//
// ① 同一句话出现在终局前：seed 4 街角店主把翻修卡留到第 16 天，晨光街小店仍说
//    「翻修卡下回合免费升」。按了放弃就结算 —— 没有下回合。屏上只能讲这局真的还做得到的事。
// ② 仓内给读者的手机复验入口会去找本机 .scratch 启动文件，干净副本上直接 ENOENT。

const human = s => s.players.find(p => p.controller === 'human');

function renderBuild(state, cellId, cost) {
  const mk = () => ({ innerHTML: '', hidden: false, scrollTop: 0, scrollHeight: 0, clientWidth: 390, clientHeight: 844,
    querySelector: () => null, querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {} }, style: {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0, left: 0, right: 0 }) });
  const root = { system: mk(), players: mk(), board: mk(), log: mk(), insight: mk(), dice: mk(), cards: mk(), hand: mk(), choice: mk() };
  const saved = state.pending;
  state.pending = { type: 'build', cellId, cost };
  render(root, state, new Proxy({}, { get: () => () => {} }));
  state.pending = saved;
  return root.choice.innerHTML;
}
const forkOf = html => /data-fork[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1];

test('#3335 最后一天那一屏不许承诺「下回合」—— 放弃之后就结算', () => {
  for (const style of ['grow', 'cross']) {
    const s = startSession(createSliceConfig({ seed: 4, style }));
    const p = human(s);
    const id = p.properties[0];
    assert.ok(p.cards.includes('worker'), `${style} 起手应带翻修卡`);
    s.day = s.config.dayLimit;                      // 真入口里 seed 4 就是走到了第 16 天
    const cost = Math.round(buildCost(s.properties[id].level + 1) * s.priceIndex);
    const line = buildOrderLine(s, id, cost, p);
    assert.ok(line, `${style}：最后一天没有分叉句`);
    // 「没有下回合」是在否认它；要挡的是**承诺**：卡下回合还能用、下回合也能免费升。
    assert.doesNotMatch(line, /翻修卡(下回合|下个回合)|(下回合|下个回合)也?能/, `${style}：最后一天仍在承诺下回合：${line}`);
    assert.match(line, /没有下回合/, `${style}：没说清没有下回合：${line}`);
    assert.match(line, /最后一天/, `${style}：没说清这是最后一天：${line}`);
    // 三个当场账目仍要在（这条修的是时态，不是删信息）
    assert.match(line, /现金 -\d/, `${style}：丢了现金那笔：${line}`);
    assert.match(line, /总资产/, `${style}：丢了总资产那笔：${line}`);
  }
});

test('#3335 最后一天的那一屏（真 render）整段都不出现「下回合免费」', () => {
  const s = startSession(createSliceConfig({ seed: 4, style: 'grow' }));
  const p = human(s);
  const id = p.properties[0];
  s.day = s.config.dayLimit;
  const cost = Math.round(buildCost(s.properties[id].level + 1) * s.priceIndex);
  const html = renderBuild(s, id, cost);
  const fork = forkOf(html);
  assert.ok(fork, '真 render 的加盖屏上没有 data-fork');
  assert.doesNotMatch(fork, /翻修卡下回合免费/, `最后一天仍写「下回合免费」：${fork}`);
});

test('#3335 非最后一天照旧讲顺序（别把时态修正做成删功能）', () => {
  const s = startSession(createSliceConfig({ seed: 1, style: 'grow' }));
  const p = human(s);
  const id = p.properties[0];
  const cost = Math.round(buildCost(s.properties[id].level + 1) * s.priceIndex);
  const line = buildOrderLine(s, id, cost, p);
  assert.match(line, /不付：翻修卡下回合免费升到 2 级/, `第 1 天的分叉句被改坏了：${line}`);
  assert.match(line, /先付再免费 10,000/, line);
});

// 独立复算最后一天「付这一笔」仍是真账（防止我为了让句子变短而改了数）。
test('#3335 最后一天的三个数仍与真 buildPlot 一致', () => {
  const s = startSession(createSliceConfig({ seed: 4, style: 'grow' }));
  const p = human(s);
  const id = p.properties[0];
  s.day = s.config.dayLimit;
  const cost = Math.round(buildCost(s.properties[id].level + 1) * s.priceIndex);
  const line = buildOrderLine(s, id, cost, p);
  const before = assetsOf(s, p), cash0 = p.cash, mark0 = buyPrice(s, id);
  buildPlot(s, p, id);
  const realNet = assetsOf(s, p) - before;
  const realMark = buyPrice(s, id) - mark0;
  assert.equal(cash0 - p.cash, cost, 'precondition：引擎扣的现金应等于提示里的费用');
  assert.ok(line.includes(`标价 +${realMark.toLocaleString()}`), `标价 +${realMark} 没写出来：${line}`);
  assert.ok(line.includes(`总资产 ${realNet >= 0 ? '+' : '-'}${Math.abs(realNet).toLocaleString()}`),
    `总资产变化应为 ${realNet}：${line}`);
});

// ② 读者入口：仓内那份 390×844 复验脚本不能依赖未跟踪的本机草稿目录。
test('#3335 手机复验脚本只引用随仓库走的文件', () => {
  const src = readFileSync(new URL('../support/probe-3334/geom.mjs', import.meta.url), 'utf8');
  const spawnLine = src.split('\n').find(line => /spawn\('node'/.test(line));
  assert.ok(spawnLine, '找不到起静态服务器那一行');
  assert.doesNotMatch(spawnLine, /\.scratch\//,
    `复验脚本仍从 .scratch/ 起服务（干净副本上不存在）：${spawnLine}`);
  assert.match(spawnLine, /support\/probe-3334\/serve\.mjs/, spawnLine);
  // 那个服务器文件必须真的被提交进来（不能只是改了名字）。
  const serve = readFileSync(new URL('../support/probe-3334/serve.mjs', import.meta.url), 'utf8');
  assert.match(serve, /createServer|createServer\(/, 'serve.mjs 看起来不是静态服务器');
});
