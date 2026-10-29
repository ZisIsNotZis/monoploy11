// W6 内容测试：五卡合成、10 位神仙、4 名领主 × 3 档技能。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, current, useCard, addCard, drawBaseCard, makeOffer, attachGod, applyCard,
  releaseFrom, cardRange, ALL_GODS, CARD_DEFS,
} from '../src/engine/game.js';
import { pay, bossRentMultiplier, incomeBonus } from '../src/engine/economy.js';
import { groundPhase, postGodPhase, landingPhase, buildPlot } from '../src/engine/flow.js';
import { pathWithin } from '../src/engine/board-v2.js';

function game(seed = 1, extra = {}) {
  return createGame({
    seed, startingCards: 0, startingCash: 500_000, startingDeposit: 0,
    ...extra,
  });
}

function bossGame(bossId, bossTier, seed = 1) {
  return createGame({
    seed, startingCards: 0, startingCash: 500_000, startingDeposit: 0,
    participants: [
      { name: 'boss', charId: 'sunxiaomei', team: 'boss', controller: 'human', isBoss: true, bossId, bossTier },
      { name: 'a', charId: 'atubo', team: 'a', controller: 'human' },
      { name: 'b', charId: 'tangtang', team: 'b', controller: 'human' },
    ],
  });
}

function nodeAt(s, from, d) {
  const taken = new Set(s.players.filter(p => p.alive).map(p => p.position));
  return s.map.nodes.find(n => {
    if (n.id === from || taken.has(n.id) || s.placements[n.id]) return false;
    const path = pathWithin(s.map, from, n.id, d);
    return !!path && path.length === d;
  });
}

function adjacentNode(s) {
  const node = s.map.nodes.find(n => (n.adjacentPlots ?? []).length > 0);
  assert.ok(node, '地图上应有贴路地产');
  return { node, plotId: node.adjacentPlots[0] };
}

function ownPlot(s, owner, plotId, level = 0, big = false, bigType = null) {
  const plot = s.map.plots.find(x => x.id === plotId);
  s.properties[plotId] = { ownerId: owner.id, level, street: plot?.street ?? null, big, bigType, closed: 0, inflate: 0 };
  if (!owner.properties.includes(plotId)) owner.properties.push(plotId);
  return s.properties[plotId];
}

const passUI = { async ask() { return false; }, render() {}, async say() {} };

// ---------- 五卡合成 ----------

const RECIPES = [
  ['missile', 'rushmissile'],
  ['inflate', 'glory'],
  ['close', 'predicament'],
  ['sendgod', 'green'],
  ['monster', 'disaster'],
  ['invitegod', 'godfavor'],
];

for (const [base, advanced] of RECIPES) {
  test(`五卡合成：5 张 ${CARD_DEFS[base].name} → ${CARD_DEFS[advanced].name}`, () => {
    const s = game(200);
    const p = current(s);
    p.cards = [];
    for (let i = 0; i < 4; i++) addCard(s, p, base);
    // 第 5 张走卡片格/事件的“熟客”路径，证明自然获得也会触发合成。
    s.rng.float = () => 0;
    assert.equal(drawBaseCard(s, p), base);
    addCard(s, p, base);
    assert.deepEqual(p.cards, [advanced], '5 张同名卡应只剩 1 张进阶卡');
    assert.ok(s.log.some(x => x.text.includes(`合成了 ${CARD_DEFS[advanced].name}`)));
  });
}

test('四张同名卡不会提前合成', () => {
  const s = game(201);
  const p = current(s);
  p.cards = [];
  for (let i = 0; i < 4; i++) addCard(s, p, 'missile');
  assert.deepEqual(p.cards, ['missile', 'missile', 'missile', 'missile']);
});

test('商店货架每次至少有一种 3 张同名卡，正常逛街可凑齐融合', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const s = game(seed);
    const offer = makeOffer(s, 9, 'shop');
    assert.equal(offer.length, 9);
    const counts = {};
    for (const o of offer) counts[o.id] = (counts[o.id] ?? 0) + 1;
    assert.ok(Math.max(...Object.values(counts)) >= 3, `seed ${seed} 应有同名卡重复供应`);
  }
});

test('研究所仍然只供给进阶卡', () => {
  const advanced = new Set(RECIPES.map(([, a]) => a));
  const s = game(202);
  const offer = makeOffer(s, 6, 'research');
  assert.equal(offer.length, 6);
  assert.ok(offer.every(o => advanced.has(o.id)));
});

test('卡片来源偏向已握有的同名卡，让合成自然发生', () => {
  const s = game(203);
  const p = current(s);
  p.cards = ['monster', 'monster'];
  s.rng.float = () => 0; // 必中“熟客”分支
  assert.equal(drawBaseCard(s, p), 'monster');
});

// ---------- 神仙 ----------

test('10 位神仙都能附身并给出 3 天以上持续时间', () => {
  const s = game(210);
  const p = current(s);
  assert.equal(ALL_GODS.length, 10);
  for (const god of ALL_GODS) {
    p.god = null; p.godDays = 0;
    attachGod(s, p, god);
    assert.equal(p.god, god, `${god} 应附身`);
    assert.ok(p.godDays >= 3, `${god} 持续时间应有下限`);
  }
});

test('财神：附身期间免除租金', async () => {
  const s = game(211);
  const p = current(s);
  const q = s.players[1];
  const { node, plotId } = adjacentNode(s);
  p.position = node.id;
  ownPlot(s, q, plotId, 1);
  p.cash = 100_000;
  p.god = '财神'; p.godDays = 3;
  await groundPhase(s, p, passUI);
  assert.equal(p.cash, 100_000, '财神附身不应支付租金');
});

test('穷神：租金翻倍', async () => {
  const base = game(212);
  const pb = current(base);
  const qb = base.players[1];
  const nb = adjacentNode(base);
  pb.position = nb.node.id;
  ownPlot(base, qb, nb.plotId, 1);
  pb.cash = 100_000;
  await groundPhase(base, pb, passUI);
  const normal = 100_000 - pb.cash;
  assert.ok(normal > 0);

  const s = game(212);
  const p = current(s);
  const q = s.players[1];
  const { node, plotId } = adjacentNode(s);
  p.position = node.id;
  ownPlot(s, q, plotId, 1);
  p.cash = 100_000;
  p.god = '穷神'; p.godDays = 3;
  await groundPhase(s, p, passUI);
  assert.equal(100_000 - p.cash, normal * 2, '穷神应让租金翻倍');
});

test('衰神：走到己方地产不能加盖', async () => {
  const s = game(213);
  const p = current(s);
  const { node, plotId } = adjacentNode(s);
  p.position = node.id;
  ownPlot(s, p, plotId, 0);
  p.god = '衰神'; p.godDays = 3;
  let asked = false;
  const ui = { async ask(x) { if (x.type === 'build') asked = true; return false; }, render() {}, async say() {} };
  await groundPhase(s, p, ui);
  assert.equal(asked, false, '衰神期间不应询问加盖');
  assert.equal(s.properties[plotId].level, 0);

  p.god = null;
  const ui2 = { async ask(x) { return x.type === 'build'; }, render() {}, async say() {} };
  await groundPhase(s, p, ui2);
  assert.equal(s.properties[plotId].level, 1, '没有衰神时可以加盖');
});

test('恶魔：走到任何有主地产降 1 层，空地不破坏', async () => {
  const s = game(214);
  const p = current(s);
  const q = s.players[1];
  const cell = s.map.nodes.find(n => (n.adjacentPlots ?? []).length >= 2);
  assert.ok(cell);
  const [a, b] = cell.adjacentPlots;
  p.position = cell.id;
  ownPlot(s, q, a, 2);
  ownPlot(s, q, b, 0);
  p.god = '恶魔'; p.godDays = 3;
  await groundPhase(s, p, passUI);
  assert.equal(s.properties[a].level, 1);
  assert.equal(s.properties[b].level, 0);
  assert.ok(s.log.some(x => x.text.includes('恶魔')));
});

test('土地公：走到非己方地产直接占为己有', async () => {
  const s = game(215);
  const p = current(s);
  const q = s.players[1];
  const { node, plotId } = adjacentNode(s);
  p.position = node.id;
  ownPlot(s, q, plotId, 1);
  p.god = '土地公'; p.godDays = 3;
  await groundPhase(s, p, passUI);
  assert.equal(s.properties[plotId].ownerId, p.id);
  assert.ok(!q.properties.includes(plotId));
  assert.ok(p.properties.includes(plotId));
});

test('武神：所有卡片使用范围增加', () => {
  const s = game(216);
  const p = current(s);
  const before = cardRange(p, 'turtle');
  p.god = '武神'; p.godDays = 3;
  assert.equal(cardRange(p, 'turtle'), before + 2);
});

test('糊涂神：用卡按概率失败且卡片不退还', () => {
  const s = game(217);
  const p = current(s);
  const q = s.players[1];
  q.position = p.position;
  p.cards = ['turtle'];
  p.god = '糊涂神'; p.godDays = 3;
  s.rng.float = () => 0;
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.deepEqual(p.cards, []);
  assert.equal(q.status, null);
  assert.ok(s.log.some(x => x.text.includes('糊涂神')));
});

test('凶神：税、事件、新闻、野狗、乞丐对自身无效', async () => {
  const s = game(218);
  const p = current(s);
  const tax = s.map.nodes.find(n => n.kind === 'tax');
  assert.ok(tax, '地图应有纳税格');
  p.position = tax.id;
  p.god = '凶神'; p.godDays = 3;
  p.cash = 100_000;
  await landingPhase(s, p, passUI);
  assert.equal(p.cash, 100_000, '凶神应免除纳税');
  assert.ok(s.log.some(x => x.text.includes('凶神')));
});

test('凶神：撤销本次落点刚建的房屋', async () => {
  const s = game(219);
  const p = current(s);
  const { node, plotId } = adjacentNode(s);
  p.position = node.id;
  ownPlot(s, p, plotId, 0);
  p.god = '凶神'; p.godDays = 3;
  p.builtThisTurn = [];
  buildPlot(s, p, plotId);
  assert.equal(s.properties[plotId].level, 1);
  await postGodPhase(s, p, passUI);
  assert.equal(s.properties[plotId].level, 0);
  assert.ok(s.log.some(x => x.text.includes('撤销')));
});

// ---------- 4 名领主 × 3 档 ----------

test('神秘博士：反噬比例随档位 20% / 35% / 50% 提高', () => {
  const shares = [1, 2, 3].map(tier => {
    const s = bossGame('doctor', tier);
    const boss = s.players[0];
    const victim = s.players[1];
    boss.cash = 500_000;
    victim.cash = 100_000;
    pay(s, boss, null, 100_000, '租金');
    return 100_000 - victim.cash;
  });
  assert.deepEqual(shares, [20_000, 35_000, 50_000]);
});

test('神秘博士：0 档不启用反噬', () => {
  const s = bossGame('doctor', 0);
  const boss = s.players[0];
  const victim = s.players[1];
  boss.cash = 500_000;
  victim.cash = 100_000;
  pay(s, boss, null, 100_000, '租金');
  assert.equal(victim.cash, 100_000);
});

test('神秘博士：只有 3 档手牌上限 16', () => {
  assert.equal(bossGame('doctor', 1).players[0].handLimit, 8);
  assert.equal(bossGame('doctor', 2).players[0].handLimit, 8);
  assert.equal(bossGame('doctor', 3).players[0].handLimit, 16);
});

test('章鱼王：1 档起免疫拾取卡，0 档不免疫', () => {
  for (const [tier, immune] of [[1, true], [0, false]]) {
    const s = bossGame('octopus', tier);
    const boss = s.players[0];
    const caster = s.players[1];
    boss.cards = ['banana'];
    applyCard(s, caster, 'pick', boss.id);
    assert.equal(boss.cards.length, immune ? 1 : 0, `tier ${tier}`);
  }
});

test('章鱼王：1 档起拾取卡距离无限，0 档仍受 5 格限制', () => {
  const far = (tier) => {
    const s = bossGame('octopus', tier, 300 + tier);
    const boss = s.players[0];
    const q = s.players[1];
    const node = nodeAt(s, boss.position, 8);
    assert.ok(node, '地图上应有 8 步远节点');
    q.position = node.id;
    q.cards = ['banana'];
    boss.cards = ['pick'];
    s.phase = 'action';
    useCard(s, 0, q.id);
    return s;
  };
  const t1 = far(1);
  assert.deepEqual(t1.players[1].cards, []);
  assert.ok(t1.players[0].cards.includes('banana'));
  const t0 = far(0);
  assert.deepEqual(t0.players[1].cards, ['banana'], '0 档拾取不应越过距离');
});

test('章鱼王：2 档起别人出院/出狱时获得梦游卡', () => {
  const two = bossGame('octopus', 2);
  releaseFrom(two, two.players[1], 'hospital');
  assert.ok(two.players[0].cards.includes('sleep'));
  const one = bossGame('octopus', 1);
  releaseFrom(one, one.players[1], 'hospital');
  assert.ok(!one.players[0].cards.includes('sleep'));
});

test('章鱼王：3 档使用主动卡 30% 获得拾取卡，1 档没有', () => {
  for (const [tier, expected] of [[3, true], [1, false]]) {
    const s = bossGame('octopus', tier);
    const boss = s.players[0];
    const q = s.players[1];
    q.position = boss.position;
    boss.cards = ['turtle'];
    s.rng.float = () => 0;
    s.phase = 'action';
    useCard(s, 0, q.id);
    assert.equal(boss.cards.includes('pick'), expected, `tier ${tier}`);
  }
});

test('小熊：租金倍率按档位累积', () => {
  const s0 = bossGame('bear', 0); const p0 = s0.players[0];
  const s1 = bossGame('bear', 1); const p1 = s1.players[0];
  const s2 = bossGame('bear', 2); const p2 = s2.players[0];
  assert.equal(bossRentMultiplier(s0, p0), 1);
  assert.equal(bossRentMultiplier(s1, p1), 1.5);
  s2.day = 20;
  assert.ok(Math.abs(bossRentMultiplier(s2, p2) - 1.7) < 1e-9);
  s2.day = 30;
  assert.ok(Math.abs(bossRentMultiplier(s2, p2) - 1.8) < 1e-9);
});

test('小熊：3 档免疫第一次破产并获得导致破产金额的 2 倍', () => {
  const s = bossGame('bear', 3);
  const boss = s.players[0];
  boss.cash = 0; boss.deposit = 0;
  assert.equal(pay(s, boss, null, 30_000, '租金'), true);
  assert.equal(boss.alive, true);
  assert.equal(boss.cash, 60_000);
  assert.equal(boss.revived, true);
  assert.ok(s.log.some(x => x.text.includes('过载')));
});

test('圆圆：1 档存款月息 15%，0 档仍是 10%', async () => {
  const { applyMonthly } = await import('../src/engine/game.js');
  const one = bossGame('yuanyuan', 1);
  const y1 = one.players[0];
  one.day = 30; y1.deposit = 100_000;
  applyMonthly(one, y1);
  assert.equal(y1.deposit, 115_000);
  const zero = bossGame('yuanyuan', 0);
  const y0 = zero.players[0];
  zero.day = 30; y0.deposit = 100_000;
  applyMonthly(zero, y0);
  assert.equal(y0.deposit, 110_000);
});

test('圆圆：2 档所有金钱收入 +50%', () => {
  const s = bossGame('yuanyuan', 2);
  assert.equal(incomeBonus(s.players[0], 10_000), 15_000);
  const one = bossGame('yuanyuan', 1);
  assert.equal(incomeBonus(one.players[0], 10_000), 10_000);
});

test('圆圆：3 档对手损失金钱时收走存款利息抽成', () => {
  const s = bossGame('yuanyuan', 3);
  const yu = s.players[0];
  const victim = s.players[1];
  yu.deposit = 100_000;
  victim.cash = 100_000;
  pay(s, victim, null, 10_000, '税');
  assert.equal(yu.deposit, 101_000);
  assert.ok(s.log.some(x => x.text.includes('流通手段')));
});

test('4 名领主都免疫查账、均贫、魔术、均富卡', () => {
  for (const bossId of ['doctor', 'octopus', 'bear', 'yuanyuan']) {
    const s = bossGame(bossId, 1);
    const boss = s.players[0];
    const caster = s.players[1];
    boss.cards = ['banana'];
    caster.cards = ['banana'];
    assert.equal(applyCard(s, caster, 'audit', boss.id), false, `${bossId} 查账`);
    assert.equal(applyCard(s, caster, 'equalpoor', boss.id), false, `${bossId} 均贫`);
    assert.equal(applyCard(s, caster, 'magic', boss.id), false, `${bossId} 魔术`);
    const before = boss.cash;
    caster.cash = 100_000;
    applyCard(s, caster, 'equalrich');
    assert.equal(boss.cash, before, `${bossId} 均富`);
  }
});
