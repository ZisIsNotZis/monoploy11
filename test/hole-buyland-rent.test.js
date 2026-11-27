import test from 'node:test';
import assert from 'node:assert/strict';

// #845：无主小店全卖完时（跨 7 局 225 个行动帧 = 12.9%），rent 行的 Q3 整段消失。
// 补那一段时最容易犯的错是「无条件报一个收购价」——但收购是**卡牌动作**
// （game.js:454 的 buyland 分支），没拿收购卡就没有「收购最便宜一块要多少」这件事。
// 所以这里锁两件必须同时成立的事：
//   ① 玩家手里没有 buyland ⇒ 这一行**不得出现任何价格**
//   ② 玩家手里有 buyland 且存在可收小店 ⇒ 必须给出金额，且**逐值等于** buyPrice×1.25
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, groundPhase } from '../src/engine/flow.js';
import { buyPrice, cheapestAcquirable } from '../src/engine/economy.js';

// 同一局固定种子：真人 = 机会买家（手牌含 buyland），对手 = 街角店主。
function fixture({ humanCards, leaveFree = 0 }) {
  const s = startSession(createSliceConfig({ seed: 7, style: 'take' }));
  const me = s.players.find(p => p.controller === 'human');
  const opp = s.players.find(p => p.id !== me.id);
  // 真人踩到对手的一条街（照 test/slice-economy.test.js 的做法）。
  const target = opp.properties[0];
  s.players.find(p => p.id === me.id).position = s.map.nodes.find(n => n.adjacentPlots.includes(target)).id;
  me.cash = 50_000;
  me.deposit = 0;
  me.cards = [...humanCards];
  // 把其余小地全部分给对手（等级 0 ⇒ 标价 8,000 ⇒ 收购 10,000），制造「无主地耗尽」。
  const smalls = s.map.plots.filter(p => !p.big && s.day >= (p.availableFromDay ?? 1));
  let kept = 0;
  for (const p of smalls) {
    if (s.properties[p.id]?.ownerId === me.id) continue;
    if (kept < leaveFree) { kept += 1; s.properties[p.id] = { ...(s.properties[p.id] ?? {}), ownerId: null, level: 0 }; continue; }
    s.properties[p.id] = { ...(s.properties[p.id] ?? {}), ownerId: opp.id, level: 0, closed: 0, inflate: 0 };
  }
  for (const id of me.properties) s.properties[id] = { ...(s.properties[id] ?? {}), ownerId: me.id };
  return { s, me, opp, target };
}

async function rentLine(s, me) {
  const before = s.log.length;
  await groundPhase(s, me, { async ask() { return false; } });
  const line = s.log.slice(before).map(e => e.text ?? e).find(t => /实付租金/.test(t));
  assert.ok(line, '没产生实付租金行，夹具失效：' + JSON.stringify(s.log.slice(before).map(e => e.text ?? e)));
  return line;
}

const MONEY = /\d{1,3}(?:,\d{3})+|\d{3,}/g;

// —— 前提自检：夹具真的把无主地耗尽了，否则下面两条断言都是空过 ——
test('#845 夹具自检：这局被造成「无主小地 = 0」', () => {
  const { s, me } = fixture({ humanCards: ['buyland'] });
  const free = s.map.plots.filter(p => !p.big && s.day >= (p.availableFromDay ?? 1) && !s.properties[p.id]?.ownerId);
  assert.equal(free.length, 0, '夹具没耗尽无主地，后面的断言会空过：' + JSON.stringify(free.map(p => p.name)));
  assert.ok(cheapestAcquirable(s, me), '对手有店却算不出可收目标');
});

// —— N1：没有收购卡 ⇒ 一个字的价格都不许出现 ——
test('#845 N1：手里没有 buyland 时不得报任何收购价，只给一句真话', async () => {
  const { s, me } = fixture({ humanCards: ['worker', 'inflate'] }); // 不含 buyland
  const line = await rentLine(s, me);
  // 行首的「实付租金 2800 / 收到 2800」是结算本身，不是报价；只看 Q3 半句（「·」之后）。
  const q3 = line.slice(line.indexOf(' · ') + 3);
  assert.ok(q3.length > 0, 'Q3 半句整段消失（这就是本单要补的空洞）：' + line);
  const numbers = q3.match(MONEY) ?? [];
  // 「你剩 47,200」是余额，允许；除此之外不许再有钱（收购价）。
  assert.equal(numbers.length, 1, '没卡却报了价：' + q3);
  assert.match(q3, /你剩 [\d,]+/, 'Q3 里连余额都没了：' + q3);
  assert.match(q3, /收购卡/, '没卡时应说清要靠收购卡才能收对手的店：' + q3);
  assert.doesNotMatch(q3, /要 [\d,]+/, '没卡却写了「要多少钱」：' + q3);
});

// —— N2：有收购卡 ⇒ 必须报真价，且与 buyPrice×1.25 逐值相等 ——
test('#845 N2：手里有 buyland 时必须报出收购价，且等于 buyPrice×1.25', async () => {
  const { s, me } = fixture({ humanCards: ['buyland', 'remotedice'] });
  const expect = cheapestAcquirable(s, me); // 先取价（groundPhase 会改变现金，但 buyPrice 看等级不看现金）
  assert.ok(expect, '夹具里没有可收小店');
  const manual = Math.round(buyPrice(s, expect.id) * 1.25);
  assert.equal(expect.price, manual, 'cheapestAcquirable 的价格不等于 buyPrice×1.25');
  const line = await rentLine(s, me);
  const q3 = line.slice(line.indexOf(' · ') + 3);
  assert.match(q3, /收购 /, '有卡却没给收购目标：' + q3);
  const nums = [...q3.matchAll(MONEY)].map(m => Number(m[0].replace(/,/g, '')));
  assert.ok(nums.includes(manual), `收购价必须是 ${manual}（buyPrice×1.25 现算），实际：${JSON.stringify(nums)} ← ${q3}`);
  // 不许出现标价冒充收购价：8,000 这种「标价」不得单独作为“要多少钱”出现。
  const mark = buyPrice(s, expect.id);
  assert.notEqual(mark, manual, '夹具里标价与收购价相等，这条反证会空过');
  assert.doesNotMatch(q3, new RegExp(`要 ${mark.toLocaleString()}`), '把标价当成收购价说了：' + q3);
});
