// #3456：旺季的「还能收几次」不许把**天数当成次数上限**。
//
// supervisor 真机（seed 42 机会买家开局第 15 天，晨光街茶铺）看到同一天两笔全额到账：
// 7,800 与 11,200。我上一版（#3453）为了让「今天是最后一天」不与「踩到 2 次」打架，
// 把例子次数夹成 `min(inHot−1, 剩余天数)` —— 那个修法本身就把天数当成了次数上限。
//
// 这条判据钉三件事：
//   ① 口径：seasonTerms 给出的 maxPerDay 是**当天能踩到的对手数**，不是常数 1；
//   ② 屏幕：旺季那屏必须说出窗口容量（天数 × 对手数），且例子不超过它；
//   ③ 负对照：把容量退回「只看天数」，剩 1 天那一档必须**变红** ——
//      否则这条判据只是把上一版的错修法换了个位置钉住。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, runGame } from '../src/engine/flow.js';
import { aiAnswer } from '../src/engine/ai.js';
import { seasonTerms, seasonLength } from '../src/engine/payback.js';
import { buildForwardLine } from '../src/ui/slice.js';

const n0 = n => Math.round(n).toLocaleString();

// 跑一局真实整局（产品自己的 AI），找出「同一块地、同一天」收到两笔的那一格。
// slice.history 是**每人每回合**一条（一天三条），所以同一天的两笔分散在不同 rep 里。
async function runForDouble(seed, style) {
  const s = startSession(createSliceConfig({ human: false, seed, style, sliceContestedStreets: true }));
  let decisions = 0;
  await runGame(s, {
    render() {}, async step() {},
    async ask(prompt) {
      if (++decisions > 20000) throw new Error('decision limit');
      return aiAnswer(prompt, s);
    },
  });
  const perDay = new Map();
  for (const rep of s.slice?.history ?? []) {
    for (const line of rep.lines ?? []) {
      const m = /^(\S+) 实付租金 (\d+)（(.+?)）/.exec(line);
      if (!m) continue;
      const plot = s.map.plots.find(p => p.name === m[3]);
      if (!plot) continue;
      const k = `${rep.day}|${plot.id}`;
      const cur = perDay.get(k) ?? { day: rep.day, plotId: plot.id, payers: [], n: 0 };
      cur.payers.push(m[1]);
      cur.n += 1;
      perDay.set(k, cur);
    }
  }
  for (const v of perDay.values()) {
    if (v.n < 2) continue;
    const owner = s.players.find(p => p.id === s.properties[v.plotId]?.ownerId);
    v.opp = s.players.filter(p => p.team !== owner?.team).length;
    return { ...v, seed, style };
  }
  return null;
}

// 一间小店（月色街茶铺式：平常增量 2,000 / 旺季 4,000），把其余地清空，
// 这样「这格一天能被谁踩到」只由座位数决定，不受别的所有权干扰。
function fixture() {
  const s = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow', sliceContestedStreets: true }));
  const [p] = s.players;
  const id = s.map.plots.find(x => x.name === '月色街茶铺').id;
  for (const plot of s.map.plots) {
    if (plot.id === id) continue;
    if (!plot.big) s.properties[plot.id].ownerId = null;
    s.properties[plot.id].inflate = 0;
    s.properties[plot.id].closed = 0;
  }
  s.properties[id].ownerId = p.id;
  s.properties[id].level = 1;
  s.properties[id].closed = 0;
  if (!p.properties.includes(id)) p.properties.push(id);
  s.day = 6;
  return { s, id };
}

test('#3456 maxPerDay 是「能踩到这格的对手数」，不是 1', () => {
  const { s, id } = fixture();
  const enemies = s.players.filter(p => p.alive && p.team !== s.players.find(q => q.id === s.properties[id].ownerId).team).length;
  assert.equal(enemies, 2, `夹具不对：敌对座位 ${enemies}`);
  for (const inflate of [0, 1, 2, 3]) {
    s.properties[id].inflate = inflate;
    const terms = seasonTerms(s, id, 1);
    assert.equal(terms.maxPerDay, enemies, `inflate=${inflate}：maxPerDay=${terms.maxPerDay}，应等于对手数 ${enemies}`);
  }
});

test('#3456 一天里两位对手都能踩到同一格 —— 必须在真结算里出现，且不超容量', async () => {
  // #3456b（supervisor 指出）：这一条原来是**手写的两行日志字符串**，
  // 于是把结算改坏它照样绿 —— 它证明的是正则，不是引擎。
  // 现在跑真引擎（产品自己的 AI、自己的 16 天），从 state.slice.history 里数
  // 「同一块地、同一天」的实付行。找到那一局才算这条成立。
  let found = null;
  for (let seed = 1; seed <= 8 && !found; seed++) {
    found = await runForDouble(seed, 'grow') ?? await runForDouble(seed, 'take');
  }
  assert.ok(found, '8 个 seed 里没有「同一天两笔」—— 容量按天数就够用了，这条规则的前提变了');
  // ① 一定是两位不同的对手（不是同一人一天踩两次）
  assert.equal(new Set(found.payers).size, found.n, `同一人同一天在同一格付了两次：${JSON.stringify(found)}`);
  // ② 当天笔数不得超过当天敌对的座位数 —— 这正是屏上那个「最多」
  assert.ok(found.n <= found.opp,
    `一天 ${found.n} 笔 > 当天对手 ${found.opp} 位：容量口径失效 ${JSON.stringify(found)}`);
});

test('#3456 旺季那屏说出窗口容量（天数 × 对手数），例子不超过它', () => {
  const { s, id } = fixture();
  const seasonDays = seasonLength(s);
  assert.ok(seasonDays > 0, '读不到季节长度，判据无从下手');
  for (const daysLeft of [1, 2, 3]) {
    s.properties[id].inflate = daysLeft;
    const terms = seasonTerms(s, id, 1);
    const line = buildForwardLine(s, id, 10000);
    const cap = daysLeft * terms.maxPerDay;
    // 容量句必须在，且三个操作数都在（天数、对手数、容量），读者能自己复核。
    assert.ok(line.includes(`最多收 ${cap} 次`),
      `剩余 ${daysLeft} 天：屏幕没说窗口容量 ${cap} 次：${line}`);
    assert.ok(line.includes(`${daysLeft} 天内最多收 ${cap} 次`),
      `剩余 ${daysLeft} 天：容量句不含期限 ${daysLeft} 天：${line}`);
    // #3456b：给玩家的是能做决定的短解释，不是乘法的推导。
    assert.ok(line.includes(`${terms.maxPerDay} 位对手每天各来一次`),
      `剩余 ${daysLeft} 天：没说清一天为什么能收多次：${line}`);
    assert.equal(/天 × \d+ 位对手/.test(line), false, `屏上又出现了乘法推导：${line}`);
    // 例子里的次数不得超过容量。
    const m = /旺季里踩到 (\d+) 次/.exec(line);
    if (m) assert.ok(Number(m[1]) <= cap, `剩余 ${daysLeft} 天：例子 ${m[1]} 次超出容量 ${cap}：${line}`);
    // 「今天最后一天」不再意味着只能 1 次 —— 这是 supervisor 点名的那一档。
    if (daysLeft === 1) {
      assert.ok(!/最多次|只能.*次|仅.*1 次/.test(line), `剩余 1 天：仍写成天数上限：${line}`);
    }
  }
});

test('#3456 负对照：容量退回「只看天数」时，剩 1 天那一档必须与产品不一致', () => {
  const { s, id } = fixture();
  s.properties[id].inflate = 1;
  const terms = seasonTerms(s, id, 1);
  const line = buildForwardLine(s, id, 10000);
  // 旧修法把容量写成 daysLeft（=1）；真容量是 daysLeft × maxPerDay（=2）。
  const daysOnly = 1;
  const realCap = 1 * terms.maxPerDay;
  assert.notEqual(daysOnly, realCap, '前提不成立：对手数为 1 时这条负对照分不出新旧');
  assert.ok(line.includes(`最多收 ${realCap} 次`),
    `产品印的不是真容量（应 ${realCap} 次）：${line}`);
  assert.equal(line.includes(`最多收 ${daysOnly} 次`), false,
    `产品仍按「天数=次数上限」印 ${daysOnly} 次 —— 这正是 #3453 的错修法：${line}`);
});
