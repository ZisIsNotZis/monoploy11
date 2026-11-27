// 一个读数不够用：late-center 里「只南」的胜率低，可能是规则问题，也可能只是
// 「走到那儿、正好有钱、正好被问价」的随机结果 —— AI 并没有把南街书库当计划去抢。
// 若 AI 从不主动为它留钱/绕路，那么「只南赢不了」测的是 AI 的短视，不是规则的取舍。
//
// 这一支直接看：南街书库的成交发生在**谁**手里、**第几天**、以及买下时对方的现金还剩多少。
// 若几乎都是「顺手买下」（第 9 天路过、现金充裕），那它就不是一个计划。
//
// 用法：node support/probe-3391/late-center-who.mjs [40] [day] [price]
import { SLICE_STYLES, createSliceConfig } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';

const SEEDS = Number(process.argv[2] ?? 40);
const DAY = Number(process.argv[3] ?? 9);
const PRICE = Number(process.argv[4] ?? 13000);
const SOUTH = 'market-south';
const CELLS = [{ x: 5, y: 6 }, { x: 6, y: 6 }];

function addLate(state) {
  state.map.plots.push({ id: SOUTH, cells: CELLS.map(c => ({ ...c })), big: true, street: '南街',
    name: '南街书库', price: PRICE, availableFromDay: DAY });
  state.properties[SOUTH] = { ownerId: null, level: 2, street: '南街', big: true,
    bigType: 'bookstore', closed: 0, inflate: 0, price: PRICE };
  state.map.initialProperties.push({ plotId: SOUTH, level: 2, bigType: 'bookstore', price: PRICE });
  for (const node of state.map.nodes) {
    const [nx, ny] = node.id.split(',').map(Number);
    if (!CELLS.some(c => Math.abs(c.x - nx) + Math.abs(c.y - ny) === 1)) continue;
    (node.adjacentPlots ??= []).push(SOUTH);
  }
}

const rows = [];
for (const style of ['grow', 'take', 'cross']) for (let seed = 1; seed <= SEEDS; seed++) {
  const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
  const others = SLICE_STYLES.filter(s => s.id !== style).map(s => s.id);
  config.participants = [style, ...others].map((sid, i) => {
    const s = SLICE_STYLES.find(x => x.id === sid);
    return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
  });
  const state = startSession(config);
  addLate(state);
  const asked = [];
  await runGame(state, {
    render() {}, async step() {},
    async ask(prompt) {
      if (prompt.type === 'buy' && (prompt.plot?.id ?? prompt.plot) === SOUTH) {
        const buyer = prompt.player;
        const want = aiAnswer(prompt, state);
        asked.push({ day: state.day, buyer: buyer.style, want, cash: buyer.cash, price: prompt.price });
        return want;
      }
      return aiAnswer(prompt, state);
    },
  });
  const owner = state.players.find(p => p.id === state.properties[SOUTH].ownerId);
  rows.push({ style, asked, owner: owner?.style ?? null, day: asked.find(a => a.want)?.day ?? null });
}

const deals = rows.flatMap(r => r.asked.filter(a => a.want));
const totalAsked = rows.flatMap(r => r.asked);
console.log(`n=${rows.length} 局（${DAY} 天 / ${PRICE}）`);
console.log(`被问价 ${totalAsked.length} 次，成交 ${deals.length} 次，成交局 ${rows.filter(r => r.owner).length} 局`);
if (deals.length) {
  const mean = k => (deals.reduce((a, d) => a + d[k], 0) / deals.length).toFixed(0);
  console.log(`成交时平均：第 ${mean('day')} 天，买家剩现金 ${mean('cash')}，地价 ${mean('price')}`);
  const days = [...new Set(deals.map(d => d.day))].sort((a, b) => a - b);
  console.log(`成交天数分布 ${days.join(',')}`);
}
// 关键读数：成交者的现金余量。若远大于地价，说明是「顺手」，不是「攒钱去抢」。
const slack = deals.map(d => d.cash - d.price);
if (slack.length) {
  slack.sort((a, b) => a - b);
  const med = slack[Math.floor(slack.length / 2)];
  console.log(`买后现金余量 中位 ${med}（p90 ${slack[Math.floor(slack.length * 0.9)] ?? slack.at(-1)}）`);
  console.log(med > PRICE ? '  ⇒ 多数是「顺手买下」：手里钱远多于地价，不是攒钱抢的'
    : '  ⇒ 多数是「掏空现金买下」：这是一次真正的押注');
}
const askedButDeclined = totalAsked.filter(a => !a.want);
if (askedButDeclined.length) {
  const mean = askedButDeclined.reduce((a, d) => a + d.cash, 0) / askedButDeclined.length;
  console.log(`拒绝 ${askedButDeclined.length} 次，平均当时现金 ${mean.toFixed(0)}（地价 ${PRICE}）`
    + ` ⇒ 原因是${mean < PRICE ? '钱不够' : '估值不划算'}`);
}
