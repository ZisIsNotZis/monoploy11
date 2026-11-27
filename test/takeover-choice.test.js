import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { takeoverModel, sliceTargetIds } from '../src/engine/insight.js';
import { applyCard } from '../src/engine/game.js';
import { acquisitionPrice, takeoverEligible, rentFor, assetsOf } from '../src/engine/economy.js';

// #3332：第一回合真正有后果的决定是「收购哪一间」，而当时屏上四个候选全都写「收 10,000」。
// 这三个判据分别咬住：规则（谁能被收购）、价（一处实现）、以及**屏上能不能分出高低**。

const fresh = () => startSession(createSliceConfig({ human: false, seed: 1, style: 'take' }));

test('#3332 收购卡不再把「空地」当目标：那是拿 125% 溢价买一块走过去就能买的地', () => {
  const state = fresh();
  const me = state.players[0];
  const ids = sliceTargetIds(state, me, 'buyland');
  assert.ok(ids.length > 0, '夹具失效：没有合法目标');
  for (const id of ids) {
    const pr = state.properties[id];
    assert.ok(pr.ownerId, `${id} 无主却被列为收购目标`);
    assert.ok(pr.level > 0, `${id} 还没开张却被列为收购目标`);
    assert.notEqual(pr.ownerId, me.id, `${id} 是自己的店`);
    assert.equal(takeoverEligible(state, id), true);
  }
  // 引擎自己也拒绝空地（不只是名单里没有）—— 名单与规则必须是同一件事。
  for (const plot of state.map.plots) {
    if (plot.big) continue;
    if (state.properties[plot.id]?.ownerId) continue;
    const cash = me.cash;
    assert.equal(applyCard(state, me, 'buyland', plot.id), false, `${plot.id} 是空地却成交了`);
    assert.equal(me.cash, cash, '被拒绝的收购仍然扣了钱');
  }
});

test('#3332 有主的店仍付 125%，原主人拿全款（这个溢价是设计好的代价，不能一起改掉）', () => {
  const state = fresh();
  const me = state.players[0];
  const id = sliceTargetIds(state, me, 'buyland')[0];
  const pr = state.properties[id];
  const seller = state.players.find(q => q.id === pr.ownerId);
  const price = acquisitionPrice(state, id);
  const sellerBefore = seller.cash;
  const meBefore = assetsOf(state, me);
  assert.equal(applyCard(state, me, 'buyland', id), true, '有主的店收不了');
  assert.equal(seller.cash - sellerBefore, price, '原主人没有拿到全款');
  // 溢价是真的资产损失：我方资产恰好少掉 25%。
  const mark = price / 1.25;
  assert.equal(Math.round(meBefore - assetsOf(state, me)), Math.round(price - mark),
    '收购的净资产损失不等于那 25% 溢价');
});

test('#3332 收购候选的排序必须与实测结局同向（灯火街 > 晚风街）', () => {
  // 实测（take，seed 1–300，同样的第一回合只改买哪一间）：
  //   晚风街 5.0% / 5.3%   灯火街 19.3% / 19.3%
  // 屏上给的「每局约 +N」如果把这四间排成另一副样子，那就是拿一个假数去指导真决定。
  const state = fresh();
  const me = state.players[0];
  const model = takeoverModel(state, me);
  assert.ok(model && model.rows.length === 4, '第一回合应当有 4 个候选');
  const byStreet = new Map();
  for (const r of model.rows) byStreet.set(r.street, Math.max(byStreet.get(r.street) ?? 0, r.net));
  assert.ok(byStreet.get('灯火街') > byStreet.get('晚风街'),
    `模型说灯火街 ${byStreet.get('灯火街')} 不高于晚风街 ${byStreet.get('晚风街')}，与实测结局相反`);
  // 四个候选不能给出同一个数 —— 那正是被修掉的那个状态。
  assert.equal(new Set(model.rows.map(r => r.net)).size, 4, '四个候选又变成同一个数了');
});

test('#3332 takeoverModel 只读：不改 state、不消耗随机数', () => {
  const state = fresh();
  const me = state.players[0];
  const snap = () => JSON.stringify({
    properties: state.properties,
    players: state.players.map(p => ({ id: p.id, cash: p.cash, props: p.properties })),
    rng: state.rng?.state ?? null,
  });
  const before = snap();
  takeoverModel(state, me);
  takeoverModel(state, me);
  assert.equal(snap(), before, 'takeoverModel 改了 state 或读了随机数');
});

test('#3332 面板/角标上的数与模型同源（不是渲染层又算一遍）', async () => {
  const { readFileSync } = await import('node:fs');
  const render = readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8');
  // 渲染层不许自己乘收购溢价，也不许自己估「每局收多少」。
  assert.doesNotMatch(render, /buyPrice\([^)]*\)\s*\*\s*[\d.]/, 'render.js 又自己乘了一遍收购价');
  assert.match(render, /takeover/, 'render.js 没有用 takeoverModel 的结果');
  // 街名不再重复：店名本身已含街名。
  assert.doesNotMatch(render, /\$\{r\.street\}·\$\{r\.name\}/, '面板又把街名和店名拼了一遍');
});
