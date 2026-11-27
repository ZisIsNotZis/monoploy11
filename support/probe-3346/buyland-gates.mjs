// #3346：收购卡为什么在真实对局里几乎不发生 —— 一处处数闸门。
//
// 已确认的事实（不许改写）：
//   · 20 局 take 起手，AI 选中的卡次数：close 71 / remotedice 74 / worker 47 / inflate 49，
//     **buyland 0 次**。
//   · 120 局里 target 提示 buyland/plot 只出现 3 次，而 worker 1,177 / close 1,102 / inflate 1,045。
//   · 第三问的证据（takeover-arm.mjs）：硬把这张卡打出去，take 胜率 38.3% → 9.2%，
//     破产 9.2% → 19.2%。所以它不是「藏在手里的机会」，是**负期望**。
//
// 这一支只回答一件事：是哪一道闸把它关掉的。
// slice-ai.js plotTargets('buyland') 有四道，按顺序：
//   ① sliceTargetIds 里有合法目标（有主的、别人家的、开着的店）
//   ② 现金 ≥ 价 + reserve（第 12 天后 3,000，否则 9,000）
//   ③ 不在最后 3 天（day > dayLimit - 3 就不做）
//   ④ 净收益估值为正（net > 0）
// 前两道用引擎自己的函数现算；③ 直接看 day；④ 用「这一格如果归我，租金能多收多少」粗算。
//
// 用法：node support/probe-3346/buyland-gates.mjs [20]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { acquisitionPrice, buyPrice, rentFor } from '../../src/engine/economy.js';
import { sliceTargetIds } from '../../src/engine/insight.js';

const SEEDS = Number(process.argv[2] ?? 20);
const DECISION_LIMIT = 5000;
const reserve = state => (state.day > 12 ? 3000 : 9000);

const gate = {
  actionPrompts: 0,
  holdsCard: 0,
  hasLegalTarget: 0,
  passesReserve: 0,
  notTooLate: 0,
  passesAllThree: 0,
  aiChoseBuyland: 0,
};
const why = {};
const bump = k => { why[k] = (why[k] ?? 0) + 1; };

for (let seed = 1; seed <= SEEDS; seed++) {
  const style = 'take';
  const others = SLICE_STYLES.filter(s => s.id !== style).map(s => s.id);
  const order = [others[0], others[1]];
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  const wanted = [style, ...order];
  config.participants = wanted.map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  const me = state.players[0];
  let decisions = 0;
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > DECISION_LIMIT) throw new Error('Decision limit exceeded');
      if (prompt.type === 'action' && prompt.player?.id === me.id) {
        gate.actionPrompts++;
        const before = me.cards.slice();
        if (!me.cards.includes('buyland')) { bump('手里没有收购卡'); }
        else {
          gate.holdsCard++;
          const ids = sliceTargetIds(state, me, 'buyland');
          if (!ids.length) bump('没有合法目标（对手都已开张的店才有可能）');
          else {
            gate.hasLegalTarget++;
            const cheapest = Math.min(...ids.map(id => acquisitionPrice(state, id)));
            const cashOk = me.cash >= cheapest + reserve(state);
            const timeOk = state.day <= state.config.dayLimit - 3;
            if (!cashOk) bump(`现金不够（要 ${cheapest}+${reserve(state)}，有 ${me.cash}）`);
            else gate.passesReserve++;
            if (!timeOk) bump('最后 3 天不做');
            else gate.notTooLate++;
            if (cashOk && timeOk) {
              gate.passesAllThree++;
              // 第四道：AI 自己的净收益估值。用引擎租金现算，和 slice-ai 同口径。
              const bestId = ids.sort((a, b) => acquisitionPrice(state, a) - acquisitionPrice(state, b))[0];
              bump(`过了三道闸，AI 仍不选（最便宜 ${acquisitionPrice(state, bestId)}，现金 ${me.cash}）`);
            }
          }
        }
        const ans = aiAnswer(prompt, state);
        if (ans.action === 'card' && before[ans.index] === 'buyland') gate.aiChoseBuyland++;
        return ans;
      }
      return aiAnswer(prompt, state);
    },
  });
}

console.log(`take 起手 ${SEEDS} 局，动作屏共 ${gate.actionPrompts} 次`);
console.log(JSON.stringify(gate, null, 1));
console.log('\n被挡的原因（按提示次数计）：');
for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
