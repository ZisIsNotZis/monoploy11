#!/usr/bin/env node
// #3331：三条起手胜率的**可重算**量具。
//
// 为什么它必须入库
// ----------------
// #3330 报告了「grow 42.0% / take 39.0% / cross 42.7%（每格 300 局）」，
// 但产出这些数的脚本只活在 `.scratch/`，而 `.scratch` 不入库 ——
// 于是从干净检出**没人能重算它**，那份表只能被相信，不能被核对。
// 这个文件就是把那张表变成可执行的：谁检出这棵树，都能重新跑出同样的数。
//
// 它量的是什么（以及不量什么）
// ---------------------------
// 量：**开局结构** —— 三条起手在同一个引擎、同一套 AI 下，各自赢下 16 天的概率。
// 不量：人类偏好。AI 不会因为「穿街高手听起来酷」而选它，所以这里没有任何一条数字
//       能回答「玩家想不想再开一局」。胜率接近只说明第一屏不是一个选择加两个陷阱。
//
// 走的是真实入口
// --------------
// `createSliceConfig({style})` → `startSession` → `runGame` + `aiAnswer`：
// 与 `tools/evaluate-slice.mjs` 同一条路径，也是浏览器入口造 state 的方式。
// 现金来自 `SLICE_STYLES[].cash`（起手自带），不在这里另加 ——
// #3330 中途就栽在这一点：草稿实验只给 players[0] 加钱，与产品规则对不上。
//
// 座位与现金必须被断言
// -------------------
// 被量的那条起手永远坐在 0 号位（第一屏把玩家放进去的位置）。#3330 第一次做「解耦」
// 实验时把参与者顺序也换了，结果三行数字一模一样 —— 因为被量的始终是 grow。
// 所以每局开局前断言 `players[0].style` 与 `players[0].cash`，不一致直接抛，不产出数字。
//
// 用法
//   node tools/balance-slice.mjs                     # 每格 300 局（150 seed × 2 座位排列）
//   node tools/balance-slice.mjs --seeds 150
//   node tools/balance-slice.mjs --seeds 500 --json > report.json
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SLICE_STYLES, createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { assetsOf } from '../src/engine/economy.js';

const args = process.argv.slice(2);
const arg = (key, fallback) => {
  const i = args.indexOf(`--${key}`);
  return i < 0 ? fallback : Number(args[i + 1]);
};
const SEEDS = arg('seeds', 150);
const SEED_START = arg('seed', 1);
const AS_JSON = args.includes('--json');
if (!Number.isInteger(SEEDS) || SEEDS < 1 || SEEDS > 2000) throw new Error('Use integer --seeds 1–2000.');
if (!Number.isInteger(SEED_START) || SEED_START < 1) throw new Error('Use integer --seed ≥ 1.');
const DECISION_LIMIT = 5000;

// 95% Wilson 区间。不用 p ± 1.96√(p(1-p)/n)：低胜率那一格（改前 take 13.7%）用它会在 0
// 附近给出负下界，读起来像「胜率可能是负的」。Wilson 在 p 贴近 0/1、样本小时都更老实。
function wilson(wins, n) {
  if (!n) return null;
  const z = 1.96, p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

const pct = x => `${(x * 100).toFixed(1)}%`;

// 对手座位两种排列：被量的起手固定在 0 号位，另两条交换。
// 这不是「跑两遍同样的东西」—— 它把「对手谁先手」这个与起手无关的变量一起扫掉。
const opponentOrders = id => {
  const others = SLICE_STYLES.filter(s => s.id !== id).map(s => s.id);
  return [[others[0], others[1]], [others[1], others[0]]];
};

// 报告带上产品字节指纹：同一个量具在两棵树上跑出的两张表，要看得出量的是不同产品。
// 这正是 #3330 那张表现缺的东西 —— 它没法说清自己量的是哪一版字节。
async function sha256(path) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}
const SLICE_JS = fileURLToPath(new URL('../src/data/slice.js', import.meta.url));

const buckets = new Map(SLICE_STYLES.map(s => [s.id, {
  id: s.id, name: s.name, cash: s.cash, hand: s.hand,
  games: 0, wins: 0, tiedAtTop: 0, bankrupt: 0, failures: 0,
  endDays: 0, finalAssets: 0,
}]));
const failures = [];
let ties = 0;

for (const style of SLICE_STYLES) {
  const bucket = buckets.get(style.id);
  for (const order of opponentOrders(style.id)) for (let seed = SEED_START; seed < SEED_START + SEEDS; seed++) {
    const config = createSliceConfig({ human: false, seed, style: style.id });
    const wanted = [style.id, ...order];
    config.participants = wanted.map((sid, i) => {
      const s = SLICE_STYLES.find(x => x.id === sid);
      return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
    });

    let state;
    try {
      state = startSession(config);
      // 座位断言：量错了会得到一张自洽但无意义的表（#3330 的坑一）。
      const seated = state.players.map(p => p.style);
      if (seated.join(',') !== wanted.join(',')) {
        throw new Error(`SEATING MISMATCH 想要 ${wanted.join(',')} 实得 ${seated.join(',')}`);
      }
      // 现金断言：报告里的「起手现金」必须真是这一局开局手里的钱。
      // 起手没写 cash 的老树上不适用（那时三家都拿 config.startingCash）——
      // 所以只在产品真的声明了 per-style 现金时才断言，而不是放宽成「不查」。
      if (style.cash != null && state.players[0].cash !== style.cash) {
        throw new Error(`CASH MISMATCH ${style.id}: 表上写 ${style.cash} 局内是 ${state.players[0].cash}`);
      }
      let decisions = 0;
      await runGame(state, {
        render() {}, async step() {},
        async ask(prompt) {
          if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
          return aiAnswer(prompt, state);
        },
      });
      if (!state.over) throw new Error('Engine returned before game ended');
    } catch (error) {
      bucket.failures++;
      failures.push({ style: style.id, order, seed, message: error.message });
      continue;
    }

    const me = state.players[0];
    const alive = state.players.filter(p => p.alive);
    const max = Math.max(...alive.map(p => assetsOf(state, p)));
    const leaders = alive.filter(p => assetsOf(state, p) === max);
    const winner = state.players.find(p => p.team === state.winnerTeam);
    const tied = leaders.length > 1;
    if (tied) ties++;

    bucket.games++;
    bucket.wins += winner === me ? 1 : 0;
    bucket.tiedAtTop += tied && leaders.includes(me) ? 1 : 0;
    bucket.bankrupt += me.alive ? 0 : 1;
    bucket.endDays += state.day;
    bucket.finalAssets += assetsOf(state, me);
  }
}

const report = {
  config: {
    seeds: SEEDS, seedStart: SEED_START, gamesPerStyle: SEEDS * 2,
    opponentOrders: SLICE_STYLES.map(s => ({ style: s.id, orders: opponentOrders(s.id) })),
    dayLimit: 16, decisionLimit: DECISION_LIMIT,
  },
  product: { 'src/data/slice.js': await sha256(SLICE_JS) },
  ties,
  failures,
  byStyle: [...buckets.values()].map(b => {
    const ci = wilson(b.wins, b.games);
    return {
      ...b,
      winRate: b.games ? b.wins / b.games : null,
      winRatePct: b.games ? pct(b.wins / b.games) : null,
      ci95: ci,
      ci95Pct: ci ? [pct(ci.lo), pct(ci.hi)] : null,
      meanEndDay: b.games ? b.endDays / b.games : null,
      meanFinalAssets: b.games ? Math.round(b.finalAssets / b.games) : null,
    };
  }),
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`每格 ${report.config.gamesPerStyle} 局（seed ${SEED_START}–${SEED_START + SEEDS - 1}，两种对手座位排列）`);
  console.log(`产品字节 src/data/slice.js ${report.product['src/data/slice.js']}`);
  console.log('');
  console.log('起手         现金   胜率     95% 区间            平局居首  破产  均终局资产');
  for (const b of report.byStyle) {
    if (!b.games) { console.log(`${b.name.padEnd(11)} ${String(b.cash).padEnd(6)} 无有效局（${b.failures} 次失败）`); continue; }
    console.log(`${b.name.padEnd(11)} ${String(b.cash).padEnd(6)} ${b.winRatePct.padEnd(8)} `
      + `${b.ci95Pct.join('–').padEnd(20)} ${String(b.tiedAtTop).padEnd(8)} ${String(b.bankrupt).padEnd(5)} ${b.meanFinalAssets}`);
  }
  const scored = report.byStyle.filter(b => b.games);
  if (scored.length > 1) {
    const rates = scored.map(b => b.winRate);
    console.log('');
    console.log(`最大差距 ${((Math.max(...rates) - Math.min(...rates)) * 100).toFixed(1)} 个百分点`);
    // 「差距收窄」是能说的；「三条一样强」要另外的证据。区间重叠只说明这个样本量分不开
    // 它们，不说明它们真的相等 —— 换了样本，读数还会动。
    const overlap = scored.every(a => scored.every(b => a === b || (a.ci95.lo <= b.ci95.hi && b.ci95.lo <= a.ci95.hi)));
    console.log(overlap
      ? '三格 95% 区间两两重叠：这个样本量分不开它们。（只说明「看不出差别」，不证明「没有差别」。）'
      : '有三格 95% 区间不重叠：这个样本量已经能分开它们，差距是真的。');
  }
  if (report.failures.length) {
    console.log('');
    console.log(`失败 ${report.failures.length} 局：`);
    for (const f of report.failures.slice(0, 10)) console.log(`  ${f.style} order=${f.order} seed=${f.seed} ${f.message}`);
  }
  console.log('');
  console.log('这只量开局结构，不量人类偏好：AI 不会因为「听起来酷」而选某条起手。');
}
if (report.failures.length) process.exitCode = 1;
