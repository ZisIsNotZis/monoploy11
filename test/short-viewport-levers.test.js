import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SLICE_CARDS, SLICE_STYLES, createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { sliceCardLine } from '../src/ui/slice.js';

// #1886：给 #1688 的三个杠杆（卡高 96 / #players 11vh / line-clamp 5）加**后果**守卫。
//
// 为什么不钉常量：这三条原先在 test/ 里一个字都没有（只有注释提到）。
// 而「把 96 钉成 96」正是 #1745 咬过的那种假守卫 —— 改错了的人顺手更新常量就放行。
// 所以这里从**真实卡面文本**与**真实字体度量**推出「需要多少」，再比对盘上声明。
//
// 三条腿各自回答「值被改坏时玩家会失去什么」：
//   L1 卡面文字：最坏那张卡的全部文字必须装得下（不是「常量等于 96」）
//   L2 #players：滚到底后最后一名玩家的名字/现金行必须读得到
//   L3 几何：#1523 已签的短视口不退化 —— 这条由已有测试覆盖，这里只钉住它与前两条的耦合不被打破
//
// 度量来源（真 Edge 1280×720，见 .scratch/1886-levers/evidence.md）：
//   卡内 <b> 18.8 + gap 1 + span 行高 12.5 + padding 5+5；span 宽 92；
//   一家玩家行 82.3，其中名字/现金行 .pmeta 17.4、距行顶 26.9。
// 这四组数是**量出来的度量**，不是被守卫的现值；改字体或改 padding 时它们要重量。

const css = fs.readFileSync('styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// 短视口上下文：min-width 761 且 max-height ≤ 795（#1523 的触发条件）。
const MEDIA = '@media (max-height: 795px) and (min-width: 761px)';
const SHORT = css.indexOf(MEDIA);
assert.ok(SHORT >= 0, `styles.css 里找不到短视口媒体查询 ${MEDIA}`);

// 取短视口块内**所有**匹配 selector 的声明体（后出现者生效，所以取最后一条）。
function declsInShortBlock(selectorRe) {
  let j = css.indexOf('{', SHORT), depth = 1;
  for (; j < css.length && depth > 0; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') depth--;
  }
  const block = css.slice(SHORT, j - 1);
  const out = [];
  for (const m of block.matchAll(selectorRe)) {
    let k = m.index + m[0].length, d = 1;
    for (; k < block.length && d > 0; k++) {
      if (block[k] === '{') d++;
      else if (block[k] === '}') d--;
    }
    out.push(block.slice(m.index + m[0].length, k - 1));
  }
  return out;
}
const lastDecl = (res, prop) => {
  const all = res.map(b => new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(b)).filter(Boolean);
  return all.length ? all[all.length - 1][1].trim() : null;
};

// ---------------------------------------------------------------------------
// L1：卡面必须装得下最坏那张卡的全部文字
// ---------------------------------------------------------------------------
// 最坏文本从**真实代码**里扫出来（各风格 × 各 seed × 五种卡），不是抄一个串进测试。
function worstCardLines() {
  const worst = new Map();
  for (const style of SLICE_STYLES.map(s => s.id)) {
    for (let seed = 1; seed <= 40; seed++) {
      const state = startSession(createSliceConfig({ seed, style }));
      const human = state.players.find(p => p.controller === 'human');
      if (!human) continue;
      for (const id of Object.keys(SLICE_CARDS)) {
        const line = sliceCardLine(state, human, id) || '';
        const prev = worst.get(id);
        if (!prev || line.length > prev.length) worst.set(id, line);
      }
    }
  }
  return [...worst.entries()].map(([id, text]) => ({ id, text }));
}

// 行数估算：按字宽贪心折行。
// 为什么不用「字数 ÷ 常数」：CJK 与数字/空格宽度差一倍，硬套常数会在某些文本上偏一行。
// 系数（相对 font-size）：CJK 1.0、ASCII 0.55、空格 0.25 —— 实测在 92px 宽 / 10px 字下
// 复现四种卡的真行数（50 字→5、42→4、41→4、29→3，见 evidence.md）。
function estimateLines(text, boxWidthPx, fontSizePx) {
  const w = ch => {
    const c = ch.codePointAt(0);
    if (ch === ' ') return 0.25;
    if (c < 0x2e80) return 0.55;          // ASCII / 拉丁 / 数字 / 半角标点
    return 1.0;                          // CJK 与全角标点
  };
  let lines = 1, cur = 0;
  for (const ch of text) {
    const cw = w(ch) * fontSizePx;
    if (cur + cw > boxWidthPx + 0.01) { lines++; cur = cw; }
    else cur += cw;
  }
  return lines;
}

// 量出来的度量（改字体/宽度后要重量，见 evidence.md）
const METRICS = { spanInnerWidth: 92, titleH: 18.8, gap: 1, paddingY: 10 };

test('#1886/L1：短视口卡高必须装得下最坏那张卡的全部文字（不是"卡高等于96"）', () => {
  const cardRes = declsInShortBlock(/\.slice-mode #cards \.slice-card\s*\{/g);
  assert.ok(cardRes.length > 0, '短视口块里找不到 .slice-card 规则');
  const heightPx = Number(/(-?\d+(?:\.\d+)?)px/.exec(lastDecl(cardRes, 'height') ?? '')?.[1]);
  assert.ok(Number.isFinite(heightPx), '短视口 .slice-card 没有 px 高度，卡高会退回 min-height:104，挤掉第三张卡');

  const spanRes = declsInShortBlock(/\.slice-mode #cards \.slice-card span\s*\{/g);
  assert.ok(spanRes.length > 0, '短视口块里找不到 .slice-card span 规则');
  const fontSize = Number(/(-?\d+(?:\.\d+)?)px/.exec(lastDecl(spanRes, 'font-size') ?? '')?.[1]);
  const lhRaw = lastDecl(spanRes, 'line-height');
  const lineHeight = /^\d+(\.\d+)?$/.test(lhRaw ?? '')
    ? Number(lhRaw) * fontSize
    : Number(/(-?\d+(?:\.\d+)?)px/.exec(lhRaw ?? '')?.[1]);
  assert.ok(Number.isFinite(fontSize) && Number.isFinite(lineHeight),
    `短视口 .slice-card span 缺可用字号/行高（font-size=${lastDecl(spanRes, 'font-size')} line-height=${lhRaw}）`);

  const rows = worstCardLines();
  assert.ok(rows.length >= 5, `只扫到 ${rows.length} 种卡，最坏文本覆盖不全`);

  // 每张卡：算出它需要几行、需要多高
  const need = rows.map(({ id, text }) => {
    const lines = estimateLines(text, METRICS.spanInnerWidth, fontSize);
    const heightNeeded = METRICS.titleH + METRICS.gap + lines * lineHeight + METRICS.paddingY;
    return { id, name: SLICE_CARDS[id].name, lines, len: text.length, heightNeeded: +heightNeeded.toFixed(1) };
  });
  need.sort((a, b) => b.heightNeeded - a.heightNeeded);
  const worst = need[0];

  assert.ok(heightPx >= worst.heightNeeded,
    `短视口卡高 ${heightPx}px 装不下最坏一张卡「${worst.name}」：` +
    `${worst.len} 字按实测折行需 ${worst.lines} 行 × ${lineHeight}px 行高 + 标题 ${METRICS.titleH} + gap ` +
    `${METRICS.gap} + padding ${METRICS.paddingY} = ${worst.heightNeeded}px。` +
    `卡装不下时被裁掉的是句尾金额（#1523b 实测过）。逐卡需要高度：` +
    need.map(n => `${n.name}${n.heightNeeded}`).join(' / '));
});

test('#1886/L1：line-clamp 不得小于最坏卡需要的行数', () => {
  const spanRes = declsInShortBlock(/\.slice-mode #cards \.slice-card span\s*\{/g);
  const clampRaw = lastDecl(spanRes, '-webkit-line-clamp');
  const clamp = Number(clampRaw);
  assert.ok(Number.isFinite(clamp), `短视口 .slice-card span 缺 -webkit-line-clamp（读到 ${clampRaw}）`);

  const fontSize = Number(/(-?\d+(?:\.\d+)?)px/.exec(lastDecl(spanRes, 'font-size') ?? '')?.[1]) || 10;
  const rows = worstCardLines();
  const need = rows.map(({ id, text }) => ({
    id, name: SLICE_CARDS[id].name, lines: estimateLines(text, METRICS.spanInnerWidth, fontSize),
  })).sort((a, b) => b.lines - a.lines);

  assert.ok(clamp >= need[0].lines,
    `-webkit-line-clamp: ${clamp} 小于最坏一张卡「${need[0].name}」的 ${need[0].lines} 行 —— ` +
    `多出来的行会被裁掉，而卡片描述的数字全在句尾（#1523b：clamp:2 时砍掉「单栋+2,800」）。` +
    `逐卡行数：${need.map(n => `${n.name}${n.lines}`).join(' / ')}`);
});

// ---------------------------------------------------------------------------
// L2：#players 不得小到连一名玩家的现金行都读不到
// ---------------------------------------------------------------------------
// 量出来的几何：一名玩家行 82.3px，名字/现金行 17.4px、距行顶 26.9px。
// 滚到底时最后一行贴着盒底 ⇒ 盒高至少要 rowH − pmetaTop = 55.4px 才能露出那 17.4px。
// 参考高度取 720（#1523 的已签读数视口）；vh 值按它折算成 px。
const PLAYER_GEOM = { rowH: 82.3, pmetaTop: 26.9, pmetaH: 17.4, refViewportH: 720 };
const minPlayerBoxPx = PLAYER_GEOM.rowH - PLAYER_GEOM.pmetaTop;   // 55.4

test('#1886/L2：短视口 #players 高度不得小于"能读到一名玩家现金行"的下限', () => {
  const res = declsInShortBlock(/\.slice-mode #players\s*\{/g);
  assert.ok(res.length > 0, '短视口块里找不到 #players 规则 —— 删掉覆写会退回全局 21vh，那不是缺陷；' +
    '但那样就没有"短视口收紧"这件事，本条按记录停用（见下方不适用分支）');
  const raw = lastDecl(res, 'max-height');
  assert.ok(raw, '短视口 #players 规则里没有 max-height');

  let px;
  if (/vh$/.test(raw)) px = (Number.parseFloat(raw) / 100) * PLAYER_GEOM.refViewportH;
  else if (/px$/.test(raw)) px = Number.parseFloat(raw);
  else assert.fail(`短视口 #players 的 max-height 用了无法折算的单位：${raw}`);

  assert.ok(px >= minPlayerBoxPx,
    `短视口 #players max-height=${raw}（≈${px.toFixed(1)}px @720）小于 ${minPlayerBoxPx.toFixed(1)}px —— ` +
    `滚到底后最后一名玩家的名字/现金行读不全（行高 ${PLAYER_GEOM.rowH}，现金行距行顶 ${PLAYER_GEOM.pmetaTop}）。` +
    `实测 11vh（79.2px）能读到，4vh（28.8px）读不到。`);
});

test('#1886/L2：短视口 #players 必须仍然可滚（overflow-y: auto），否则收紧等于丢内容', () => {
  const res = declsInShortBlock(/\.slice-mode #players\s*\{/g);
  if (!res.length) return;   // 没有覆写：全局规则自己带滚动，见下条
  const ov = lastDecl(res, 'overflow-y');
  assert.ok(ov, '短视口 #players 覆写了 max-height 却没写 overflow-y —— 内容会被硬裁掉而不是可滚');
  assert.match(ov, /auto|scroll/, `短视口 #players 的 overflow-y 是 ${ov}，超出部分不可滚`);
});

// ---------------------------------------------------------------------------
// L3：三个杠杆的耦合 —— 卡高与 #players 不能同时往"抢高度"的方向走
// ---------------------------------------------------------------------------
// #1523 已签的几何（0 出窗 / 0 滚不到）是在「卡 96 + #players 11vh + 明细 96」这一组上量的。
// 这里不重跑几何（Node 里量不了像素），只钉住一件事：短视口块的**总占用**不因单改一项而变大。
test('#1886/L3：短视口卡片不靠 #players 让高度——#players 收紧只该影响它自己', () => {
  // 侧栏是 flex 列，#log 是 flex:1（styles.css:36），会吸收 #players 的高度变化；
  // 卡片在 #hand 里、不参与这条伸缩。实测（.scratch/1886-levers/probe-side.mjs）：
  //   #players 11vh→60vh：78→253px，#log 246.5→72.7px，卡首 top 616.0 → 616.0（不动）。
  //   #players 11vh→4vh： 78→28.8px，#log 246.5→296.9px，卡首 top 616.0 → 616.0（不动）。
  // 所以「加大 #players 会把卡片挤出去」是**不成立**的假说；真正会挤到卡片的是卡高与 clamp 本身。
  // 这条守卫因此不做「总量守恒」的断言（那会把我量错的因果写进测试），
  // 只挡住唯一真会发生的破坏：#players 被收紧到读不到现金（L2 已挡）与卡片装不下（L1 已挡）。
  const cssRaw = fs.readFileSync('styles.css', 'utf8');
  const logRule = /\.slice-mode #log\s*\{([^}]*)\}/.exec(cssRaw);
  assert.ok(logRule, 'styles.css 里找不到 .slice-mode #log 规则');
  assert.match(logRule[1], /flex\s*:\s*1/,
    '`.slice-mode #log` 不再是 flex:1 —— 侧栏的高度吸收者变了，' +
    '上面 probe-side 的读数（改 #players 不移动卡片）不再适用，必须重量 #1523 几何');
});
