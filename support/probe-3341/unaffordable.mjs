// #3341 探针：选落点这一屏，有多少行在说「此刻做不起的事」？
//
// 起因（supervisor 的真局）：穿街高手 seed 1 第 13 天，现金 20,000，
// 定步 1 步的落点写着「街心书屋：你的店 Lv.2 · 停在这里可加盖 30,000」。
// 挑落点看的就是这一屏；那句话里的动作，到了那里按钮是按不动的。
//
// ## 这个探针**不读产品的新字段**
// 第一版我用 `landingInfo(...).affordable` 判「做不起」，改前那个字段还不存在 ⇒ 全是 undefined ⇒
// 「每个点数下每一行都做不起」被算成 751 / 30.2%。那是我自己造出来的基线，不是测量。
// 现在一律从**引擎原语**重算：cash、buyPrice、加盖价、rentFor。产品怎么措辞不参与判定。
//
// ## 口径（两条分母，来自引擎）
//   · 买地 / 加盖看 `p.cash`（buyPlot / buildPlot / 按钮禁用三处一致）
//   · 付租看 `p.cash + p.deposit`（pay() 里不够就是破产）
//   切片里 deposit 实测恒为 0（120 局 7,439 个人类帧，0 帧非零），口径仍按引擎写。
//
// ## 三类「做不到」 + 判据
//   build  句子写「可加盖 N」，N > cash       → 到了那里只有一个按不动的按钮
//   buy    句子写「可买 N」，N > cash         → 同上
//   rent   句子写「付租 N」，N > cash+deposit → 到了那里直接破产
//   判据（改后必须为 0）：unaffordableNotMarked —— 上三类里，句子没有同时给出
//   「还差多少 / 会破产」这类可核标记的行数。做得到的那行**不要求**加字。
//
// 跑：node support/probe-3341/unaffordable.mjs 40 [--print]
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { buyPrice, buildCost, rentFor } from '../../src/engine/economy.js';
import { reachableLandings, landingText } from '../../src/engine/insight.js';

const SEEDS = Number(process.argv[2] ?? 40);
const say = process.argv.includes('--print');
const num = t => Number(String(t).replace(/[,\s]/g, ''));

// 「这一行说清了我做不起」的标记：金额后缀（还差 N）或后果词（会破产 / 做不起）。
const MARKED = /还差\s*[\d,]+|会破产|做不起/;
const buildAsk = (state, id, pr) =>
  Math.round((pr.big ? 30_000 : buildCost((pr.level ?? 0) + (state.slice ? 1 : 0))) * state.priceIndex);

const rows = { games: 0, screens: 0, optionRows: 0, steps: 0, stepsAllUnaffordable: 0 };
const build = { shown: 0, over: 0, overUnmarked: 0, overOnlyInfo: 0, overBiggest: 0 };
const buy = { shown: 0, over: 0, overUnmarked: 0 };
const rent = { shown: 0, fatal: 0, fatalUnmarked: 0 };
const samples = [];

for (const style of ['grow', 'take', 'cross']) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const state = startSession(createSliceConfig({ human: true, seed, style }));
    rows.games++;
    await runGame(state, {
      render() {}, async step() {},
      async ask(prompt) {
        const p = prompt.player;
        if (p?.controller !== 'human' || prompt.type !== 'diceValue') return aiAnswer(prompt, state);
        rows.screens++;
        const cash = p.cash, funds = p.cash + p.deposit;
        for (let n = (prompt.min ?? 1); n <= (prompt.max ?? 6); n++) {
          const lands = reachableLandings(state, p, n);
          const texts = [...new Set(lands.map(id => landingText(state, p, id)))];
          const onlyInfo = texts.length === 1;
          rows.steps++;

          // 「这个点数给不出一个真能做的选择」：这一格挨着的每一块地，此刻都做不起。
          if (lands.length && lands.every(id => {
            const node = state.map.nodes.find(x => x.id === id);
            const plots = (node?.adjacentPlots ?? []).map(pid => {
              const pr = state.properties[pid], owner = state.players.find(q => q.id === pr?.ownerId);
              const own = owner?.team === p.team;
              if (!owner) return cash >= buyPrice(state, pid);
              if (own) return !pr || (pr.level ?? 0) >= (state.config.maxLevel ?? 3) || (pr.closed > 0) || cash >= buildAsk(state, pid, pr);
              if ((pr?.closed ?? 0) > 0 || pr?.bigType === 'park' || p.god === '财神') return true;
              return funds >= rentFor(state, pid);
            });
            return plots.length > 0 && plots.every(ok => !ok);
          })) rows.stepsAllUnaffordable++;

          for (const text of texts) {
            rows.optionRows++;
            const amounts = [...text.matchAll(/([\d,]+)/g)].map(m => num(m[1]));
            const biggest = amounts.length ? Math.max(...amounts) : 0;
            const marked = MARKED.test(text);
            for (const m of text.matchAll(/可加盖\s*([\d,]+)/g)) {
              build.shown++;
              const cost = num(m[1]);
              if (cost <= cash) continue;
              build.over++;
              if (!marked) {
                build.overUnmarked++;
                if (samples.length < 5) samples.push({ kind: 'build', cash, cost, text });
              }
              if (onlyInfo) build.overOnlyInfo++;
              if (cost === biggest) build.overBiggest++;
            }
            for (const m of text.matchAll(/可买\s*([\d,]+)/g)) {
              buy.shown++;
              const price = num(m[1]);
              if (price <= cash) continue;
              buy.over++;
              if (!marked) {
                buy.overUnmarked++;
                if (samples.length < 5) samples.push({ kind: 'buy', cash, price, text });
              }
            }
            for (const m of text.matchAll(/付租\s*([\d,]+)/g)) {
              rent.shown++;
              const owed = num(m[1]);
              if (owed <= funds) continue;
              rent.fatal++;
              if (!/会破产/.test(text)) {
                rent.fatalUnmarked++;
                if (samples.length < 5) samples.push({ kind: 'rent', funds, owed, text });
              }
            }
          }
        }
        return 6;
      },
    });
  }
}

const pct = (a, b) => +(100 * a / Math.max(1, b)).toFixed(1);
const report = {
  games: rows.games, diceValueScreens: rows.screens, optionRows: rows.optionRows, steps: rows.steps,
  stepOptionsWhereEveryRowIsUnaffordable: rows.stepsAllUnaffordable,
  stepOptionsWhereEveryRowIsUnaffordablePct: pct(rows.stepsAllUnaffordable, rows.steps),
  build: { shown: build.shown, overCash: build.over, overCashUnmarked: build.overUnmarked,
    shareOfBuildRowsPct: pct(build.over, build.shown),
    onlyInfo: build.overOnlyInfo, biggestInRow: build.overBiggest },
  buy: { shown: buy.shown, overCash: buy.over, overCashUnmarked: buy.overUnmarked, shareOfBuyRowsPct: pct(buy.over, buy.shown) },
  rent: { shown: rent.shown, fatal: rent.fatal, fatalUnmarked: rent.fatalUnmarked, shareOfRentRowsPct: pct(rent.fatal, rent.shown) },
  unaffordableNotMarked: build.overUnmarked + buy.overUnmarked + rent.fatalUnmarked,
};
if (say) report.samples = samples;
console.log(JSON.stringify(report, null, 1));
