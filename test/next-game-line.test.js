import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession, buildPlot } from '../src/engine/flow.js';
import { nextGameLine, money, sliceResults } from '../src/ui/slice.js';
import { rentFor, buildCost } from '../src/engine/economy.js';

// #3337：结算屏那句「下局试试」原来是**三条按起手写死的推销句**，与本局无关。
// 实测其中一条是坑（300 seed 配对：胜 126→60，资产 −20,945），而且三条从不提本局真正的杠杆
// （街心书屋、半条街）。这一片把它换成从本局 state/log 算出来的一句。
//
// 这条测试钉住四件事：
//   ① 句子里出现的每个数字都能从本局 state/log 回算出来（不是写死的常数）；
//   ② 破产那一支必须指出击穿它的那一笔，且与日志原文一致；
//   ③ 另一半在对手手里的半条街**不能**被推荐去补齐（那只能靠收购，而收购实测是亏的）；
//   ④ 旧的三条写死句不再出现。
//
// 跑真整局而不只喂夹具：句子依赖 log 原文（买下 / 实付租金），夹具造不出来的偏差正是要抓的。

const seed = (style, s) => {
  const state = startSession(createSliceConfig({ human: true, seed: s, style }));
  state.over = true; state.phase = 'over';
  return state;
};

const human = state => state.players.find(p => p.controller === 'human');
const push = (state, text, day = 1) => state.log.push({ day, text });

test('旧的三条写死建议不再出现（任何起手）', () => {
  for (const style of ['grow', 'take', 'cross']) {
    const state = seed(style, 1);
    state.phase = 'over';
    const html = sliceResults(state);
    assert.doesNotMatch(html, /带现金收购别人养好的店/, `${style}: 旧的 grow 建议还在（实测那是最差的一条路）`);
    assert.doesNotMatch(html, /先把自己的两间店升起来，再抓一轮旺季/, `${style}: 旧的 take 建议还在`);
    assert.doesNotMatch(html, /留住停业卡，等对方开旺季/, `${style}: 旧的 cross 建议还在`);
  }
});

test('任何起手、任何局面都有一条句子，且不是空串', () => {
  for (const style of ['grow', 'take', 'cross']) {
    const line = nextGameLine(seed(style, 3));
    assert.ok(line.length > 8, `${style}: 句子太短或为空：${JSON.stringify(line)}`);
    assert.doesNotMatch(line, /undefined|NaN|null/, `${style}: 句子里有未求值的占位：${line}`);
  }
});

// #3337b（supervisor 在 5ec96f8 上抓到的真缺陷）：这一支原来取「人类付过的**最大**一笔租」。
// grow/seed 19：第 12 天为街心书屋付了 9,600（**付清了**），第 16 天同一间店应付 9,600、
// 实付 4,400、破产。旧句把一笔付清的账说成了出局原因。
// 所以判据要钉的是「出局那一笔」，不是「最贵那一笔」。
test('破产那一支：报出的是真的没付成的那一笔，不是付过的最大一笔', () => {
  const state = seed('grow', 1);
  const me = human(state);
  me.alive = false;
  push(state, `${me.name} 向 甲 应付租金 7000（晚风街小店） · 现金不够，会破产`, 9);
  push(state, `${me.name} 实付租金 7000（晚风街小店），甲 收到 7000`, 9);
  push(state, `${me.name} 向 乙 应付租金 11200（灯火街小店） · 现金不够，会破产`, 12);
  push(state, `${me.name} 付不出 11200（租金），破产`, 12);
  push(state, `${me.name} 实付租金 4400（灯火街小店），乙 收到 4400`, 12);
  const line = nextGameLine(state);
  assert.match(line, /11,200/, `应报出应付的 11,200：${line}`);
  assert.match(line, /4,400/, `应报出真的付得出的 4,400：${line}`);
  assert.match(line, /第 12 天/, `应报出出局那一天：${line}`);
  assert.match(line, /灯火街小店/, `应报出是哪间店：${line}`);
  assert.doesNotMatch(line, /7,000/, '不应报出一笔已经付清、不是出局原因的租金');
});

// 真局固化成判据：supervisor 报的那一局（grow / seed 19）必须不说错。
// 这一次是跑真实引擎重放，不是人造夹具 —— 夹具造不出「应付与实付不等」这种真实形状。
test('真局 grow/19：出局原因必须是第 16 天那一笔，不得指向第 12 天已付清的 9,600', async () => {
  const { runGame } = await import('../src/engine/flow.js');
  const { aiAnswer } = await import('../src/engine/ai.js');
  const s = startSession(createSliceConfig({ human: true, seed: 19, style: 'grow' }));
  await runGame(s, { render() {}, async step() {}, async ask(p) { return aiAnswer(p, s); } });
  const line = nextGameLine(s);
  assert.match(line, /第 16 天/, `应指向第 16 天：${line}`);
  assert.doesNotMatch(line, /第 12 天/, `不得把第 12 天那笔已付清的租说出局原因：${line}`);
  assert.match(line, /4,400/, `应报出那一笔只付得出 4,400：${line}`);
});

test('书屋在对手机里：句子的金额 = 引擎 rentFor/日志，不是写死的「近一万」', () => {
  const state = seed('grow', 1);
  const me = human(state);
  const rival = state.players.find(p => p.team !== me.team);
  state.properties.market = { ...state.properties.market, ownerId: rival.id, level: 2, bigType: 'bookstore' };
  push(state, `${rival.name} 买下 街心书屋（支付 26000）`, 4);
  push(state, `${me.name} 实付租金 3200（街心书屋），${rival.name} 收到 3200`, 8);
  push(state, `${me.name} 实付租金 3200（街心书屋），${rival.name} 收到 3200`, 11);
  const line = nextGameLine(state);
  assert.match(line, /街心书屋/, `应点名书屋：${line}`);
  assert.match(line, new RegExp(money(26000)), `应报出标价 26,000：${line}`);
  assert.match(line, /6,400/, `应报出两笔实付的合计 6,400（3,200×2）：${line}`);
  assert.match(line, /2 次/, `应报出踩到几次：${line}`);
  assert.match(line, new RegExp(`第 4 天`), `应报出对手哪一天拿走的：${line}`);
});

test('书屋没人买：说它本局的标价，租金用引擎 rentFor 算', () => {
  const state = seed('cross', 2);
  state.properties.market = { ...state.properties.market, ownerId: null, level: 2, bigType: 'bookstore' };
  const line = nextGameLine(state);
  assert.match(line, /街心书屋/, `应点名书屋：${line}`);
  assert.match(line, /26,000/, `应报出标价：${line}`);
  assert.match(line, /第 4 天/, `应报出它第几天开售：${line}`);
  assert.doesNotMatch(line, /近一万|约一万/, '不许用记忆里的约数代替引擎算出的租金');
});

// 这一片本来还想在屏上推荐「补齐只占一半的街」（80% 的局结束时有这么一条，同街两间把 Lv1
// 从 2,000 抬到 2,800，是本片测到的第二好杠杆）。但它排在书屋之后，而切片地图永远有书屋，
// 于是在真局里一次也到不了。所以那一段被删掉，而不是留一句永远不会执行的话。
// 这条测试钉住“别把它加回来而不解决可达性”。
test('没有任何真局会走到「补齐半条街」那一支（否则就不该删）', () => {
  for (const style of ['grow', 'take', 'cross']) {
    for (const s of [1, 2, 3]) {
      const state = seed(style, s);
      const line = nextGameLine(state);
      assert.doesNotMatch(line, /补齐/, `${style}/${s}: 回到了「补齐」分支（它排在书屋之后，真局到不了）：${line}`);
    }
  }
});

test('半条街的另一半在对手手里：不得推荐「补齐」（那只能靠收购卡，实测是亏的）', () => {
  const state = seed('grow', 1);
  const me = human(state);
  const rival = state.players.find(p => p.team !== me.team);
  const plots = state.map.plots.filter(x => x.street === '晨光街' && !x.big);
  state.properties[plots[0].id] = { ...state.properties[plots[0].id], ownerId: me.id, level: 1 };
  state.properties[plots[1].id] = { ...state.properties[plots[1].id], ownerId: rival.id, level: 1 };
  state.properties.market = { ...state.properties.market, ownerId: me.id };
  const line = nextGameLine(state);
  assert.doesNotMatch(line, /补齐.*晨光街|晨光街.*补齐/,
    `不该推荐补齐一条另一半在对手手里的街（只能靠收购卡）：${line}`);
});

// 已经买下书屋时，本局「拿到没拿到」不再是问题 —— 下一局的问题是「拿到之后做什么」。
// 所以那一支必须给出下一个动作的引擎真值（buildCost 与 rentFor），而不是复述本局。
// 已经买下书屋时，本局「拿到没拿到」不再是问题 —— 下一局的问题是「拿到之后做什么」。
//
// #3338：这条判据原来把 buildCost(3)=15,000 当成「书屋从 2 级盖到 3 级」的价。
// 那是**小店**的价；书屋是 big，flow.js 的 buildPlot / groundPhase 都写
// `pr.big ? 30_000 : buildCost(...)`。实测（.scratch/3338/upcost.mjs）：句子说 15,000，
// 真 buildPlot 扣 30,000 —— 差一倍，而这条判据当时是绿的，因为它自己也用同一个错公式算。
// 所以现在钉的是「句子的价 = 引擎真实扣款」，不钉某个公式。
test('已买下书屋且未到顶：报的价必须等于引擎真实扣款，租金两个数也都与引擎一致', () => {
  const state = seed('grow', 1);
  const me = human(state);
  state.properties.market = { ...state.properties.market, ownerId: me.id, level: 2, bigType: 'bookstore' };
  state.log.push({ day: 5, text: `${me.name} 买下 街心书屋（支付 26000）` });
  const line = nextGameLine(state);

  // 真扣款：给足现金，调引擎的 buildPlot，看现金少了多少。
  me.cash = 500_000;
  const before = me.cash;
  buildPlot(state, me, 'market');
  const charged = before - me.cash;
  assert.equal(state.properties.market.level, 3, '夹具没把书屋盖到顶');
  assert.match(line, new RegExp(money(charged)), `结算屏必须报引擎真扣的 ${money(charged)}：${line}`);
  // 小店的价不得再被当成书屋的价（两者真的不同，否则上面那条断言什么也没钉住）。
  const smallPrice = Math.round(buildCost(3) * (state.priceIndex ?? 1));
  assert.notEqual(charged, smallPrice, '书屋与小店同价，这条判据区分不了两个口径');
  assert.doesNotMatch(line, new RegExp(`要花 ${money(smallPrice)}`),
    `报的还是小店的价 ${money(smallPrice)}：${line}`);

  const saved = state.properties.market.level;
  state.properties.market.level = 2; const now = rentFor(state, 'market');
  state.properties.market.level = 3; const top = rentFor(state, 'market');
  state.properties.market.level = saved;
  assert.match(line, new RegExp(money(now)), `应报出现在每次 ${money(now)}：${line}`);
  assert.match(line, new RegExp(money(top)), `应报出到顶后每次 ${money(top)}：${line}`);
  assert.match(line, /2 级/, `应说出现在几级：${line}`);
});

// 满级是一支很容易写成「复述本局」的分支。它必须回答「这座店还剩什么事可做」，
// 而引擎里满级之后租金只取决于「对手有没有踩到」（自己踩到不收租）。
test('书屋已满级：说清再投钱没用，并给出剩下的真变量（被踩次数/金额来自日志）', () => {
  const state = seed('cross', 1);
  const me = human(state);
  const rival = state.players.find(p => p.team !== me.team);
  state.properties.market = { ...state.properties.market, ownerId: me.id, level: 3, bigType: 'bookstore' };
  state.log.push({ day: 6, text: `${rival.name} 向 ${me.name} 应付租金 9600（街心书屋）` });
  state.log.push({ day: 6, text: `${rival.name} 实付租金 9600（街心书屋），${me.name} 收到 9600` });
  state.log.push({ day: 11, text: `${rival.name} 实付租金 9600（街心书屋），${me.name} 收到 9600` });
  const line = nextGameLine(state);
  assert.match(line, /3 级/, `应说出现在满级：${line}`);
  assert.match(line, /2 次/, `应报出被踩 2 次：${line}`);
  assert.match(line, new RegExp(money(19200)), `应报出实收 19,200：${line}`);
  assert.match(line, /踩到/, `必须点出「被踩到」才是剩下的变量：${line}`);
});

// #3338（supervisor 在 a7564dd 的真机上抓到的）：满级且一次没被踩到时，旧句写
// 「下一局把它放在你的路线上（停步的落点选它旁边），满级的租才收得到」——**这是假的**。
// 引擎里租金只在别人踩到时才收（flow.js groundPhase：自己站自己的店旁边只走加盖询问）。
// supervisor 那一局（grow/seed 9）他自己停在书屋旁边 7 次、一分钱没收，结算却叫他下次再走。
// 所以这条判据现在钉两件事：① 不许再出现「放在你的路线上/落点选它旁边」这类不可执行建议；
//                        ② 必须点出真正的变量（对手走位）与玩家真能改的那张牌（旺季）。
test('书屋已满级且一次没被踩到：不许再叫玩家自己走那条路，要说出真变量', () => {
  const state = seed('grow', 9);
  const me = human(state);
  state.properties.market = { ...state.properties.market, ownerId: me.id, level: 3, bigType: 'bookstore' };
  const line = nextGameLine(state);
  assert.match(line, /一次没被(对手)?踩到/, `应如实说没被踩到：${line}`);
  assert.match(line, /到顶/, `应说明已到顶：${line}`);
  assert.doesNotMatch(line, /放在你的路线上|落点选它旁边|你的路线/,
    `又出现了「自己走过去」这条假建议（自己的店不收自己的租）：${line}`);
  assert.match(line, /对手/, `必须点出租金来自对手走位：${line}`);
  assert.match(line, /旺季/, `必须给出玩家真能改的那张牌（旺季：这条街租 ×2）：${line}`);
});

// 自己停在旁边那几次是**空手**，句子里必须明说 —— 这正是玩家会被绕晕的那件事。
test('自己停在自己书屋旁边：照实说那几次一分钱没有', () => {
  const state = seed('grow', 9);
  const me = human(state);
  state.properties.market = { ...state.properties.market, ownerId: me.id, level: 3, bigType: 'bookstore' };
  state.log.push({ day: 5, text: `${me.name} 停在 街道，旁边是 街心书屋` });
  state.log.push({ day: 9, text: `${me.name} 停在 街道，旁边是 街心书屋` });
  const line = nextGameLine(state);
  assert.match(line, /你自己停在它旁边 2 次/, `应数出自己停了几次：${line}`);
  assert.match(line, /一分钱也没有|不收自己的租/, `必须说清自己站旁边收不到：${line}`);
});

test('句子里的钱一律是 money() 的格式（与排名表同一个格式化函数）', () => {
  for (const style of ['grow', 'take', 'cross']) {
    const line = nextGameLine(seed(style, 5));
    for (const m of line.match(/\d{4,}/g) ?? []) {
      assert.equal(m, money(Number(m.replace(/,/g, ''))), `${style}: ${m} 不是 money() 的输出：${line}`);
    }
  }
});
