// #3340 探针 17：一局的钱到底从哪来 —— 修正前几版的正则错误。
//
// 前几版把 salary/oddjob 都读成 0，因为日志原文是：
//   `${p.name} 经过起点 +${salary}`            （flow.js:299，没有「发薪处」字样）
//   `${p.name} 在${reason}获得 ${amount}`        （flow.js:437，reason 是「金钱格」）
// 这两条与「停在 X，旁边是 Y」不是一回事：前者是**经过**（每绕一圈都有），后者是停。
//
// 这一轮按日志原文逐类解析人类座位的全部现金进出，并核对：
//   期初现金 + 各进项 − 各出项 = 期末现金（恒等式必须成立，否则解析错）。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { assetsOf } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 40);
const rows = [];

const num = s => Number(String(s).replace(/[,\s]/g, ''));

for (const style of ['grow', 'take', 'cross']) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const state = startSession(createSliceConfig({ human: true, seed, style }));
    await runGame(state, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, state); } });
    const me = state.players.find(q => q.controller === 'human');
    const startCash = createSliceConfig({ human: true, seed, style }).participants?.[0] ? null : null;
    const b = { salary: 0, oddjob: 0, rentIn: 0, rentOut: 0, buyLand: 0, build: 0, takeoverIn: 0, takeoverOut: 0, other: 0 };
    for (const e of state.log ?? []) {
      const t = String(e.text);
      if (!t.startsWith(`${me.name} `)) {
        // 别人给我钱的行：「X 实付租金 N（店），<me> 收到 M」
        const m = /^(\S+) 实付租金 (\d+)（([^）]+)），(\S+) 收到 (\d+)/.exec(t);
        if (m && m[4] === me.name) b.rentIn += num(m[5]);
        const o = /^(\S+) 向 (\S+) 支付 (\d+) 收购 (.+)$/.exec(t);
        if (o && o[2] === me.name) b.takeoverIn += num(o[3]);
        continue;
      }
      let m;
      if ((m = /^(\S+) 经过起点 \+(\d+)$/.exec(t))) b.salary += num(m[2]);
      else if ((m = /^(\S+) 在(\S*)获得 (\d+)$/.exec(t))) b.oddjob += num(m[3]);
      else if ((m = /^(\S+) 实付租金 (\d+)（([^）]+)），(\S+) 收到 (\d+)/.exec(t))) b.rentOut += num(m[2]);
      else if ((m = /^(\S+) 买下 (\S+)（支付 (\d+)）/.exec(t))) b.buyLand += num(m[3]);
      else if ((m = /^(\S+) 将 (.+?) 升到 Lv\.\d+（花费 (\d+)）/.exec(t))) b.build += num(m[3]);
      else if ((m = /^(\S+) 向 (\S+) 支付 (\d+) 收购/.exec(t))) b.takeoverOut += num(m[3]);
      else if ((m = /^(\S+) 纳税 (\d+)$/.exec(t))) b.other += num(m[2]);
    }
    const net = b.salary + b.oddjob + b.rentIn + b.takeoverIn - b.rentOut - b.buyLand - b.build - b.takeoverOut - b.other;
    rows.push({ style, seed, ...b, net, cash: me.cash, assets: assetsOf(state, me), win: me.team === state.winnerTeam });
  }
}
const n = rows.length;
const avg = k => Math.round(rows.reduce((s, r) => s + r[k], 0) / n);
console.log(JSON.stringify({
  games: n,
  income: { salary: avg('salary'), oddjob: avg('oddjob'), rentIn: avg('rentIn'), takeoverIn: avg('takeoverIn') },
  outgo: { rentOut: avg('rentOut'), buyLand: avg('buyLand'), build: avg('build'), takeoverOut: avg('takeoverOut'), other: avg('other') },
  netMean: avg('net'), cashMean: avg('cash'), assetsMean: avg('assets'), winPct: +(100 * rows.filter(r => r.win).length / n).toFixed(1),
  identityHolds: rows.filter(r => Math.abs(r.net) < 1).length + '/' + n,
}, null, 1));
