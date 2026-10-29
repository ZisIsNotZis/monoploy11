// 角色天赋的确定性测试：位置、RNG 全部手工固定，不依赖真实对局。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, current, useCard, attachGod, cardRange } from '../src/engine/game.js';
import { pay } from '../src/engine/economy.js';
import { shopFlow } from '../src/engine/flow.js';
import { pathWithin } from '../src/engine/board-v2.js';

// parts: [{charId, team}]；第一个参与者是当前玩家。
function build(seed, parts, config = {}) {
  return createGame({
    seed,
    startingCards: 0,
    startingCash: 500_000,
    startingDeposit: 0,
    ...config,
    participants: parts.map((x, i) => ({ name: x.charId, charId: x.charId, team: x.team ?? `t${i + 1}`, controller: 'human' })),
  });
}

// 从 from 恰好 d 步、且没有玩家站着的节点。
function nodeAt(s, from, d, ok = () => true) {
  const taken = new Set(s.players.filter(p => p.alive).map(p => p.position));
  return s.map.nodes.find(n => {
    if (n.id === from || taken.has(n.id) || s.placements[n.id] || !ok(n)) return false;
    const path = pathWithin(s.map, from, n.id, d);
    return !!path && path.length === d;
  });
}

test('turtle_gives_banana: 被乌龟卡击中后获得 1 张香蕉皮卡', () => {
  const s = build(101, [{ charId: 'sunxiaomei' }, { charId: 'shalongbasi' }]);
  const p = current(s);
  const q = s.players[1];
  q.position = p.position;
  p.cards = ['turtle'];
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.equal(q.status, '乌龟');
  assert.ok(q.cards.includes('banana'), '天赋角色被乌龟卡击中应获得香蕉皮卡');
  assert.ok(!p.cards.includes('turtle'), '乌龟卡应被消耗');
});

test('turtle_gives_banana 只对天赋角色生效', () => {
  const s = build(102, [{ charId: 'sunxiaomei' }, { charId: 'atubo' }]);
  const p = current(s);
  const q = s.players[1];
  q.position = p.position;
  p.cards = ['turtle'];
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.equal(q.status, '乌龟');
  assert.ok(!q.cards.includes('banana'));
});

test('leave_shop_turtle: 离开商店/研究所/商人各获得 1 张乌龟卡', async () => {
  for (const kind of ['shop', 'research', 'merchant']) {
    const s = build(103, [{ charId: 'shalongbasi' }]);
    const p = current(s);
    p.cash = 500_000;
    const ui = { async ask() { return { action: 'leave' }; } };
    await shopFlow(s, p, ui, kind);
    assert.equal(p.cards.filter(x => x === 'turtle').length, 1, `${kind} 离开后应获得乌龟卡`);
  }
});

test('leave_shop_turtle 不改变其他角色', async () => {
  const s = build(104, [{ charId: 'atubo' }]);
  const p = current(s);
  await shopFlow(s, p, { async ask() { return { action: 'leave' }; } }, 'shop');
  assert.ok(!p.cards.includes('turtle'));
});

test('no_sendgod_outside_turn: 回合外无法被对手送神卡指定', () => {
  const s = build(105, [{ charId: 'gongben' }, { charId: 'jinbeibei' }]);
  const p = current(s);
  const q = s.players[1];
  q.position = p.position;
  q.god = '财神'; q.godDays = 3;
  p.cards = ['sendgod'];
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.equal(q.god, '财神', '乐园规则应挡住送神卡');
  assert.deepEqual(p.cards, ['sendgod'], '被拒绝的送神卡不消耗');
});

test('no_sendgod_outside_turn 只挡天赋角色', () => {
  const s = build(106, [{ charId: 'gongben' }, { charId: 'atubo' }]);
  const p = current(s);
  const q = s.players[1];
  q.position = p.position;
  q.god = '财神'; q.godDays = 3;
  p.cards = ['sendgod'];
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.equal(q.god, null);
  assert.deepEqual(p.cards, []);
});

test('worker_to_truck: 30% 阈值命中时返还工程车卡，未命中不返还', () => {
  const parts = [{ charId: 'qiange', team: 'a' }, { charId: 'atubo', team: 'a' }];
  const plot = s => s.map.plots.find(x => !x.big);
  const setup = seed => {
    const s = build(seed, parts);
    const p = current(s);
    const mate = s.players[1];
    const pl = plot(s);
    s.properties[pl.id] = { ownerId: mate.id, level: 1, street: pl.street, big: false, bigType: null };
    mate.properties = [pl.id];
    p.cards = ['worker'];
    s.phase = 'action';
    return { s, p, pl };
  };
  const hit = setup(107);
  hit.s.rng.float = () => 0.29;
  useCard(hit.s, 0, hit.pl.id);
  assert.equal(hit.s.properties[hit.pl.id].level, 2);
  assert.ok(hit.p.cards.includes('truck'), '命中 30% 应获得工程车卡');

  const miss = setup(108);
  miss.s.rng.float = () => 0.3;
  useCard(miss.s, 0, miss.pl.id);
  assert.equal(miss.s.properties[miss.pl.id].level, 2);
  assert.ok(!miss.p.cards.includes('truck'), '未命中不获得工程车卡');
});

test('truck_to_worker: 30% 阈值命中时返还机器工人卡，未命中不返还', () => {
  const setup = seed => {
    const s = build(seed, [{ charId: 'qiange' }, { charId: 'atubo' }]);
    const p = current(s);
    const pl = s.map.plots.find(x => !x.big);
    s.properties[pl.id] = { ownerId: s.players[1].id, level: 2, street: pl.street, big: false, bigType: null };
    s.players[1].properties = [pl.id];
    p.cards = ['truck'];
    s.phase = 'action';
    return { s, p, pl };
  };
  const hit = setup(109);
  hit.s.rng.float = () => 0.1;
  useCard(hit.s, 0, hit.pl.id);
  assert.equal(hit.s.properties[hit.pl.id].level, 1);
  assert.ok(hit.p.cards.includes('worker'));

  const miss = setup(110);
  miss.s.rng.float = () => 0.9;
  useCard(miss.s, 0, miss.pl.id);
  assert.ok(!miss.p.cards.includes('worker'));
});

test('immune_shuai_qiong / immune_hutu_xiong: 疫神与糊涂神系附身被跳过', () => {
  const s = build(111, [{ charId: 'shalagongzhu' }]);
  const p = current(s);
  for (const god of ['衰神', '穷神', '糊涂神', '凶神']) {
    attachGod(s, p, god);
    assert.equal(p.god, null, `${god} 应被免疫`);
  }
  attachGod(s, p, '财神');
  assert.equal(p.god, '财神', '其他神仙照常附身');
});

test('免疫天赋不改变其他角色的附身', () => {
  const s = build(112, [{ charId: 'atubo' }]);
  const p = current(s);
  attachGod(s, p, '穷神');
  assert.equal(p.god, '穷神');
});

test('immune_sleep: 梦游卡对天赋角色无效且不被浪费', () => {
  const s = build(113, [{ charId: 'sunxiaomei' }, { charId: 'xiaodanni' }]);
  const p = current(s);
  const q = s.players[1];
  q.position = p.position;
  p.cards = ['sleep'];
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.equal(q.status, null);
  assert.deepEqual(p.cards, ['sleep'], '无效的梦游卡应留在手里');
});

test('immune_sleep 不影响普通角色', () => {
  const s = build(114, [{ charId: 'sunxiaomei' }, { charId: 'atubo' }]);
  const p = current(s);
  const q = s.players[1];
  q.position = p.position;
  p.cards = ['sleep'];
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.equal(q.status, '梦游');
});

// 距离翻倍/加成的天赋：角色卡在 8 格（>5、<=10）处生效。
const RANGE_X2_CASES = [
  { charId: 'shalongbasi', card: 'turtle', kind: 'player' },
  { charId: 'xiaodanni', card: 'jelly', kind: 'cell' },
  { charId: 'xiaodanni', card: 'banana', kind: 'cell' },
  { charId: 'yuehanqiao', card: 'roadblock', kind: 'cell' },
  { charId: 'wumeila', card: 'stay', kind: 'player' },
  { charId: 'gongben', card: 'sendgod', kind: 'player' },
];

for (const [i, c] of RANGE_X2_CASES.entries()) {
  test(`${c.card} 的距离被 ${c.charId} 的天赋翻倍到 10`, () => {
    const s = build(120 + i, [{ charId: c.charId }, { charId: 'atubo' }]);
    const p = current(s);
    const q = s.players[1];
    const node = nodeAt(s, p.position, 8);
    assert.ok(node, '地图上应存在 8 步远的节点');
    if (c.kind === 'player') q.position = node.id;
    if (c.card === 'sendgod') { q.god = '财神'; q.godDays = 3; }
    p.cards = [c.card];
    s.phase = 'action';
    useCard(s, 0, c.kind === 'cell' ? node.id : q.id);
    if (c.kind === 'cell') assert.equal(s.placements[node.id]?.kind, c.card, '8 格处应能放置');
    else if (c.card === 'turtle') assert.equal(q.status, '乌龟');
    else if (c.card === 'stay') assert.equal(q.skipMove, 1);
    else assert.equal(q.god, null);
  });
}

test('距离翻倍不会让无天赋角色打到 8 格外', () => {
  const s = build(130, [{ charId: 'sunxiaomei' }, { charId: 'atubo' }]);
  const p = current(s);
  const q = s.players[1];
  const node = nodeAt(s, p.position, 8);
  q.position = node.id;
  p.cards = ['turtle'];
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.equal(q.status, null);
  assert.deepEqual(p.cards, ['turtle']);
});

test('card_range_plus: 所有卡距离 +1（6 格可达）', () => {
  const s = build(131, [{ charId: 'ludwig' }, { charId: 'atubo' }]);
  const p = current(s);
  const q = s.players[1];
  q.position = nodeAt(s, p.position, 6).id;
  p.cards = ['sleep'];
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.equal(q.status, '梦游');
  assert.equal(cardRange(p, 'sleep'), 6);
  assert.equal(cardRange(p, 'robotdoll', 10), 11, '机器娃娃的 10 格也 +1');
});

test('无 card_range_plus 的角色在 6 格处打不到', () => {
  const s = build(132, [{ charId: 'sunxiaomei' }, { charId: 'atubo' }]);
  const p = current(s);
  const q = s.players[1];
  q.position = nodeAt(s, p.position, 6).id;
  p.cards = ['sleep'];
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.equal(q.status, null);
  assert.equal(cardRange(p, 'sleep'), 5);
});

test('stay_refund: 30% 阈值命中时返还停留卡', () => {
  const setup = seed => {
    const s = build(seed, [{ charId: 'wumeila' }, { charId: 'atubo' }]);
    const p = current(s);
    const q = s.players[1];
    q.position = p.position;
    p.cards = ['stay'];
    s.phase = 'action';
    return { s, p, q };
  };
  const hit = setup(133);
  hit.s.rng.float = () => 0.0;
  useCard(hit.s, 0, hit.q.id);
  assert.equal(hit.q.skipMove, 1);
  assert.deepEqual(hit.p.cards, ['stay'], '命中应返还 1 张停留卡');

  const miss = setup(134);
  miss.s.rng.float = () => 0.7;
  useCard(miss.s, 0, miss.q.id);
  assert.deepEqual(miss.p.cards, []);
});

test('roadblock_refund: 30% 阈值命中时返还路障卡', () => {
  const setup = seed => {
    const s = build(seed, [{ charId: 'yuehanqiao' }]);
    const p = current(s);
    p.cards = ['roadblock'];
    s.phase = 'action';
    return { s, p, node: nodeAt(s, p.position, 3) };
  };
  const hit = setup(135);
  hit.s.rng.float = () => 0.0;
  useCard(hit.s, 0, hit.node.id);
  assert.equal(hit.s.placements[hit.node.id]?.kind, 'roadblock');
  assert.deepEqual(hit.p.cards, ['roadblock']);

  const miss = setup(136);
  miss.s.rng.float = () => 0.5;
  useCard(miss.s, 0, miss.node.id);
  assert.deepEqual(miss.p.cards, []);
});

test('ensemble: 队友回合外失去卡时全队各补 1 张，且只补一次', () => {
  const s = build(137, [
    { charId: 'sunxiaomei', team: 'a' },
    { charId: 'atubo', team: 'b' },
    { charId: 'ludwig', team: 'b' },
  ]);
  const p = current(s); // 当前玩家是 sunxiaomei
  const victim = s.players[1];
  const ludwig = s.players[2];
  victim.position = p.position;
  p.cards = ['pick'];
  victim.cards = ['banana'];
  ludwig.cards = ['free'];
  s.phase = 'action';
  useCard(s, 0, victim.id);
  assert.ok(p.cards.includes('banana'), '当前玩家拾走了香蕉皮卡');
  assert.equal(victim.cards.length, 1, '失去 1 张又补 1 张');
  assert.equal(ludwig.cards.length, 2, '合奏只触发一次（不含递归）');
  assert.ok(s.log.some(x => x.text.includes('合奏')));
});

test('ensemble 不在自己回合内触发', () => {
  const s = build(138, [{ charId: 'ludwig', team: 'a' }, { charId: 'atubo', team: 'b' }]);
  const p = current(s);
  p.cards = ['banana', 'free'];
  attachGod(s, p, '衰神'); // 自己回合内失去 2 张
  assert.equal(p.cards.length, 0);
  assert.ok(!s.log.some(x => x.text.includes('合奏')));
});

test('suishimen_to_superdice: 使用随意门后获得超级骰子卡', () => {
  const s = build(139, [{ charId: 'shiyi' }]);
  const p = current(s);
  p.cards = ['randomdoor'];
  s.phase = 'action';
  useCard(s, 0);
  assert.ok(p.cards.includes('superdice'));
  assert.ok(!p.cards.includes('randomdoor'));
});

test('freecard_to_remotedice: 免费卡抵账后获得遥控骰子卡', () => {
  const s = build(140, [{ charId: 'shiyi' }]);
  const p = current(s);
  p.cash = 100_000; p.deposit = 0;
  p.cards = ['free'];
  assert.equal(pay(s, p, null, 20_000, '租金'), true);
  assert.equal(p.cash, 100_000, '免费卡抵消了付款');
  assert.ok(p.cards.includes('remotedice'));
});

test('immune_pick_audit: 有神仙时无法被拾取/查账', () => {
  const s = build(141, [{ charId: 'sunxiaomei' }, { charId: 'qianfuren' }]);
  const p = current(s);
  const q = s.players[1];
  q.position = p.position;
  q.cards = ['banana'];
  q.god = '福神'; q.godDays = 3;
  p.cards = ['pick', 'audit'];
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.deepEqual(q.cards, ['banana']);
  assert.deepEqual(p.cards, ['pick', 'audit'], '被拒绝的卡不消耗');
  q.god = null;
  useCard(s, 0, q.id);
  assert.deepEqual(q.cards, [], '没有神仙时可以拾取');
});

test('immune_pick_audit 不影响普通角色', () => {
  const s = build(142, [{ charId: 'sunxiaomei' }, { charId: 'atubo' }]);
  const p = current(s);
  const q = s.players[1];
  q.position = p.position;
  q.cards = ['banana'];
  q.god = '福神'; q.godDays = 3;
  p.cards = ['pick'];
  s.phase = 'action';
  useCard(s, 0, q.id);
  assert.deepEqual(q.cards, []);
});

test('caishen 附身行为不再被免疫逻辑干扰', () => {
  const s = build(143, [{ charId: 'jinbeibei' }, { charId: 'atubo' }]);
  const p = current(s);
  const q = s.players[1];
  p.cash = 10_000; q.cash = 50_000;
  attachGod(s, p, '财神');
  assert.equal(p.god, '财神');
  assert.equal(p.godDays, 6, 'caishen_fushen_plus 仍然 +3 天');
  assert.equal(q.cash, 40_000, '财神仍然向对手收 10000');
});

test('hotel and trap skip turns are consumed at turn start, not immediately', async () => {
  const { startSession, runGame } = await import('../src/engine/flow.js');
  const s = startSession({ seed: 900, participants: [{ charId: 'sunxiaomei', team: 't1', controller: 'ai' }, { charId: 'atubo', team: 't2', controller: 'ai' }], dayLimit: 2 });
  s.players[1].skipTurns = 1;
  s.players[1].position = s.map.startId;
  let answerCount = 0;
  const ui = { render() {}, async ask(p) { answerCount++; return p.type === 'action' ? { action: 'roll', dice: 1 } : p.type === 'direction' ? p.options[0] : p.type === 'buy' || p.type === 'build' ? false : p.type === 'chooseBig' ? null : p.type === 'magic' ? { id: 'cards' } : p.type === 'target' ? null : p.type === 'bank' || p.type === 'stock' || p.type === 'lottery' || p.type === 'shop' || p.type === 'merchant' ? { action: 'leave' } : null; }, async step() {} };
  await runGame(s, ui);
  assert.equal(s.players[1].skipTurns, 0);
});
