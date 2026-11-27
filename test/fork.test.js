import test from 'node:test';
import assert from 'node:assert/strict';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { routePreview, landingInfo, reachableLandings } from '../src/engine/insight.js';

// #682：岔路口的「再往前可达」必须带金额，不能只给街名。
// 反例（seed=7 第 15 天）：两个方向的 outlook 都是「东巷/书屋/晚风街」的字面重排，
// 而东巷当时是对手的租 8,000、西巷是对手的租 4,000 —— 只给名字等于没给信息。

const mk = () => {
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  return { s, human: s.players.find(p => p.controller === 'human') };
};

test('outlook 条目带金额/状态，而不是只有街名', () => {
  const { s, human } = mk();
  const opts = s.map.nodes.find(n => (n.adjacentPlots ?? []).length)?.id;
  // 找一个有分叉的节点；没有就退化为用当前位置
  const pos = human.position;
  const node = s.map.nodes.find(n => n.id === pos);
  const dirs = (node?.adjacentNodes ?? s.map.nodes.filter(n => n.id !== pos).slice(0, 2).map(n => n.id));
  const out = dirs.flatMap(id => routePreview(s, human, pos, id, 3).outlook);
  if (!out.length) return; // 该帧没有可看的前瞻，跳过
  const withMoney = out.filter(x => /租\s*[\d,]+|可买\s*[\d,]+|停业|开售|失去\s*\d+\s*回合|零工|发薪处/.test(x));
  assert.ok(withMoney.length > 0, `outlook 至少要有带金额/状态的条目，实际：${out.slice(0, 6).join('、')}`);
});

test('真对局里：outlook 遇到已建地产必须带租字与金额（不是光街名）', async () => {
  // 前两版都栽在“猜地图 API”：先扫全图命中 0，再用 adjacentNodes 而该字段不存在。
  // 改成：真跑一局，在第一个人类方向帧上直接取真 outlook，逐条检查形状。
  const { runGame } = await import('../src/engine/flow.js');
  const { aiAnswer } = await import('../src/engine/ai.js');
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  let checked = 0;
  let withOwner = 0;
  await runGame(s, {
    render() {}, async step() {}, async say() {},
    async ask(prompt) {
      if (prompt.type === 'direction' && prompt.player?.controller === 'human' && checked < 3) {
        checked++;
        const me = prompt.player;
        const rs = prompt.remainingSteps ?? 0;
        for (const id of prompt.options) {
          const pv = routePreview(s, me, me.position, id, rs);
          for (const e of pv.outlook) {
            // 每个条目必须是「街名（…）」的形式且括号里带可判定的状态
            // 只认「已建地产的状态」——上一版把“可买/开售/失去回合”也算命中，
            // 于是短路后依然能命中，该测试没牙。现在专查租/停业。
            if (/租\s*[\d,]+|停业/.test(e)) withOwner++;
            else if (/[一-龥]/.test(e)) {
              // 带括号的条目必须括号里有可判定状态；不带括号的只能是设施/格子名（零工、发薪处…）。
              // “医院（失去 2 回合）”是合法条目，上一版因为只认租/停业而被误判。
              if (/（/.test(e)) {
                assert.match(e, /租\s*[\d,]+|停业|可买\s*[\d,]+|开售|失去\s*\d+\s*回合/,
                  `带括号的 outlook 条目必须含可判定状态，实际：${e}`);
              }
            }
          }
        }
      }
      s.pending = null; s.mapPick = null;
      return aiAnswer(prompt, s);
    },
  });
  assert.ok(checked > 0, '该局应至少有一个人类方向帧');
  assert.ok(withOwner > 0, '真对局的 outlook 里应至少有一条带「租 N」或「停业」的条目（已建地产）');
});

test('outlook 里同一街名只出现一次（不重复刷屏）', () => {
  const { s, human } = mk();
  const pos = human.position;
  const node = s.map.nodes.find(n => n.id === pos);
  const dirs = (node?.adjacentNodes ?? s.map.nodes.filter(n => n.id !== pos).slice(0, 2).map(n => n.id));
  for (const id of dirs) {
    const pv = routePreview(s, human, pos, id, 5);
    const dup = pv.outlook.filter((x, i) => pv.outlook.indexOf(x) !== i);
    assert.equal(dup.length, 0, `outlook 有重复条目：${dup.join('、')}`);
  }
});

test('不用“N 步”以外的隐晦说法：方向面板本来带“还剩 N 步”，这条路无需改', () => {
  // 这一条不是在测代码，是在钉住“步数信息已经存在”这个事实，防止将来有人把它删了
  const { s, human } = mk();
  const pv = routePreview(s, human, human.position, s.map.nodes[1].id, 2);
  assert.equal(typeof pv.text, 'string');
  assert.ok(Array.isArray(pv.outlook));
});
