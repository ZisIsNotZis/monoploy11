import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSliceConfig } from '../src/data/slice.js';
import { startSession } from '../src/engine/flow.js';
import { renderSliceInsight, turnCauseLine } from '../src/ui/slice.js';

// #1478b：两笔原因的汇总行曾经折成 2 行，把第三张卡顶出视口（实测 863.2 / out-of-view）。
//
// 为什么用 CSS 而不是压文案：两笔帧 101/996，最长 65 字；实测在 343px 可用宽、13px 字号下
// 连 49 字的压缩形状都翻行，而能装下的「（2 笔）」形状必须删掉金额或对象 —— 那违反
// 「事实不得丢」。改成白名单式的单行约束后，行数不再取决于文本长度：
// 65 字串实测仍是 1 行、第三张卡 845.7 可点。
//
// 这里钉两件事（Node 里量不了像素，所以钉的是契约本身）：
//   ① styles.css 里 summary 必须有 nowrap + ellipsis（少了任何一个都会重新允许折行）；
//   ② 两笔原因的两个金额与对象都在 summary 里，且折叠明细里仍有逐行原文。
// 像素读数在 .scratch/1478b-twoitem/ 与 .scratch/1478-consequence/RESULT.md。

test('#1478b：summary 必须是单行（nowrap + ellipsis），否则长原因会把卡顶出视口', () => {
  const css = fs.readFileSync('styles.css', 'utf8');
  const rule = /#insight summary\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'styles.css 里找不到 #insight summary 规则');
  const body = rule[1];
  assert.match(body, /white-space\s*:\s*nowrap/, `summary 缺 nowrap，长原因会折行：${body}`);
  assert.match(body, /text-overflow\s*:\s*ellipsis/, `summary 缺 ellipsis，截断会变得不可见：${body}`);
  assert.match(body, /overflow\s*:\s*hidden/, `summary 缺 overflow:hidden，nowrap 会横向溢出：${body}`);
});

// #1745：上面那条断言钉住了 nowrap/ellipsis/overflow，但**钉不住 disclosure 三角**。
// 曾经写成 display:block —— 单行、省略号、裁切三件都满足，上面那条照样绿，
// 而三角被一起吃掉：折叠态 45 帧里玩家看不到「这行能点开」（真 Edge 1280×720）。
// 这是「门与被检对象共用实现就发现不了自己的错」的反例：尺子得量**屏上占没占位**。
//
// 这里钉的是那三行 CSS 之外的第 4 件事：summary 必须是 list-item。
// 为什么钉这个而不是钉 markerSpacePx：Node 里没有布局引擎，量不了像素；
// display 的值是三角能否被画出来的**必要条件**，可以在源码层钉住。
// 像素级证据在 .scratch/1745-costcues/RESULT-1745.md（:8107 → :8000，46 → 0）。
//
// 第一版只读了**第一处**规则，被自己咬到：实际生效的是**最后一条命中的规则**。
// 实测三臂（.scratch/1745-costcues/guardBite.mjs）：现盘绿、全局改回 block 红、
// 但在后面追加一条 `@media (max-height:795px){ #insight summary{ display:block } }`
// —— 命中规则块变 2 处、**守卫仍然绿**，而 720 上三角真回来了。
// 所以这里必须逐条查：任何一条把 display 写成 block 的规则都要红。
test('#1745：每一条 #insight summary 规则都不许把 display 写成 block（不止第一条）', () => {
  const css = fs.readFileSync('styles.css', 'utf8');
  const rules = [...css.matchAll(/#insight summary\s*\{([^}]*)\}/g)];
  assert.ok(rules.length > 0, 'styles.css 里找不到 #insight summary 规则');
  // 至少一条给出 list-item（否则三角无从画出）
  assert.ok(rules.some(r => /display\s*:\s*list-item/.test(r[1])),
    `没有任何一条 #insight summary 规则写 list-item，disclosure 三角不会画出来：${rules.map(r => r[1].trim()).join(' | ')}`);
  // 且没有任何一条把它改回 block（媒体查询里的覆写同样生效）
  const blocks = rules.filter(r => /display\s*:\s*block/.test(r[1]));
  assert.deepEqual(blocks.map(r => r[1].trim().slice(0, 80)), [],
    '有 #insight summary 规则把 display 写回 block，短视口下三角会被吃掉');
});

// #1745 第二处改动：短视口 `#insight details` 的 max-height。这条原先**没有任何真守卫**。
//
// 准确的说法（実测，不是我一开始用 grep 推的那句）：
//   把 96px 改回 40px、测试文件用改前原件 ⇒ 500 测试里 **4 条红**，但四条红
//   **全是 `styles.css` 字节指纹钉**（「/styles.css 指纹变了」），红在“字节变了”，
//   **不是**红在“明细盒太短”。指纹钉不区分改对改错，每次合法改 CSS 都必须更新它。
//   于是再跑一臂：40px + 指纹钉按流程改到新值 ⇒ **500/500 全绿**。
//   一个开发者把 96 改回 40、顺手更新指纹（**正确流程**），门禁一声不响地放行。
// 这才是本守卫存在的理由。证据：.scratch/1745b-details-guard/coverage-proof2.txt。
// 与本文件上面两条同族：改前能过、改后也能过，缺陷在门禁里从来没红过。
//
// 量出来的依据（真 Edge 1280×720，`.scratch/1745-costcues/RESULT-1745.md`）：
//   summary 自吃约 34px；明细行高 20.8（1 行）/41.6（2 行）/**62.4（3 行）**。
//   40px 时第一条只剩 6px；64px 时装 3 行的长条目差 0.8px，5/29 帧滚到底末条仍缺字。
//   ⇒ 96px 是能完整装下最长一条的最小档，且仍小于改前全局的 110px。
//
// 判据方向（上一单咬过的地方，这里刻意分三格）：
//   · **太小**要红 —— 这是 #1745 修的那个缺陷方向；
//   · **覆写被删、回落到全局 110px** 不许红 —— 那更大，不是缺陷，红在这里就是把判据测反；
//   · **太大**要红 —— 明细盒长高是从 #players 与卡片 96px 里挤出来的，无上限会顶回 #1688 的几何。
//
// 这条守卫第一版又犯了 #1745 的错：用正则取出**第一个** `@media (max-height:795px) and (min-width:761px)`
// 块就读它的值。实测（.scratch/1745b-details-guard/append-arm.mjs）：在文件末尾追加**第二个**同 query 块、
// 里面写 `max-height:40px` —— 层叠上它生效（同优先级、后出现者赢），而守卫仍然绿。
// 所以现在扫全文：把每一条 `#insight details` 的 max-height 连同它所在的媒体查询上下文一起收上来，
// 凡落在短视口上下文里的每一条都得落在区间内，不止一条。
test('#1745：每一条短视口 #insight details 的 max-height 都必须装得下 3 行明细，且不得高过改前 110px', () => {
  const css = fs.readFileSync('styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // 去注释，避免注释里的字串被当成声明
  const px = h => Number(/-?\d+(?:\.\d+)?/.exec(h)?.[0]);

  // ① 先把所有 @media 块的区间算出来（大括号配平）。
  const mediaBlocks = [];
  for (const m of css.matchAll(/@media[^{]*\{/g)) {
    let j = m.index + m[0].length, depth = 1;
    for (; j < css.length && depth > 0; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    mediaBlocks.push({ prelude: m[0].slice(0, -1).trim(), start: m.index + m[0].length, end: j - 1 });
  }
  const isShort = p => {
    const h = /max-height\s*:\s*(\d+(?:\.\d+)?)px/.exec(p);
    return !!h && Number(h[1]) <= 795;
  };
  // ② 再把每一条 #insight details 规则的声明体与位置收上来 —— 扫全文，不止第一处。
  const found = [];
  for (const m of css.matchAll(/#insight\s+details[^{]*\{/g)) {
    let j = m.index + m[0].length, depth = 1;
    for (; j < css.length && depth > 0; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    const body = css.slice(m.index + m[0].length, j - 1);
    const h = /max-height\s*:\s*([^;]+);/.exec(body);
    if (!h) continue;
    const enclosing = mediaBlocks.filter(b => m.index > b.start && m.index < b.end);
    found.push({ value: px(h[1]), short: enclosing.some(b => isShort(b.prelude)),
      selector: m[0].slice(0, -1).trim(), media: enclosing.map(b => b.prelude) });
  }

  const short = found.filter(f => f.short);
  const globalFallback = found.filter(f => f.media.length === 0).map(f => f.value).pop();

  // 短视口下的生效值：有覆写就用最后一条（后出现者赢），没有就回落到全局声明。
  // **不能要求「必须存在短视口覆写」** —— 删掉覆写回落到全局 110px 是更大的盒子，不是缺陷；
  // 那样写就是把判据测反（C 臂实测就是这样误红的）。
  const effective = short.length ? short[short.length - 1].value : globalFallback;
  assert.ok(Number.isFinite(effective),
    `短视口 #insight details 没有可用的 max-height（短视口声明 ${JSON.stringify(short.map(f => f.value))}，全局 ${globalFallback}）`);

  // 太小：装不下 3 行（summary 34 + 62.4 ≈ 96）。这正是 #1745 修的缺陷方向。
  assert.ok(effective >= 96,
    `短视口 #insight details 生效 max-height=${effective}px，装不下 3 行明细（需 >=96）`);
  // 太大：会从 #players 与卡片 96px 里多挤，顶回 #1688 已签的几何。改前全局就是 110px。
  assert.ok(effective <= 110,
    `短视口 #insight details 生效 max-height=${effective}px，超过改前全局的 110px，会顶回 #1688 的卡片几何`);

  // 另外：凡落在短视口上下文里的**每一条**都不得低于 96 —— 后面追加一条 40px 的
  // 会把生效值拉回去（F 臂）。只看最后一条会漏掉「先大后小」以外的形状，逐条查更稳。
  const bad = short.filter(f => f.value < 96);
  assert.deepEqual(bad.map(f => `${f.selector} → ${f.value}px`), [],
    `有短视口 #insight details 规则低于 96px，会把生效值拉回装不下 3 行的状态`);
});

test('#1478b：两笔原因不丢事实——两个金额与对象都还在 summary 里', () => {
  // 真实帧（grow seed 18 D8）：过起点 +4,000，然后向机会买家付租 19,200。
  const last = { day: 8, money: -15200, assets: -15200, lines: [
    '—— 第 8 天 · 街角店主 的回合 ——',
    '街角店主 经过起点 +4000',
    '街角店主 实付租金 19200（街心书屋），机会买家 收到 19200',
  ] };
  const cause = turnCauseLine(last, '街角店主');
  assert.ok(cause.includes('+4,000'), `丢了过起点的金额：${cause}`);
  assert.ok(cause.includes('19,200'), `丢了租金金额：${cause}`);
  assert.ok(cause.includes('机会买家'), `丢了收款对象：${cause}`);
  assert.ok(cause.includes('街心书屋'), `丢了地产名：${cause}`);

  const s = startSession(createSliceConfig({ seed: 18, style: 'grow' }));
  const human = s.players.find(p => p.controller === 'human');
  human.lastTurn = last;
  const el = { innerHTML: '', hidden: false };
  renderSliceInsight(el, s, human);
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(el.innerHTML)?.[1] ?? '';
  // 屏上这一行仍是完整文本（只是视觉上省略）；不许出现「等 N 笔」「2 笔」这类抹平
  assert.ok(summary.includes('19,200'), `summary 丢了租金金额：${summary}`);
  assert.ok(summary.includes('+4,000'), `summary 丢了过起点金额：${summary}`);
  assert.equal(/等 \d+ 笔|（\d+ 笔）/.test(summary), false, `不许把两笔抹成计数：${summary}`);
  // 折叠明细里逐行原文必须还在（省略号的补偿）
  assert.ok(el.innerHTML.includes('<li>街角店主 经过起点 +4000</li>'), '折叠明细丢了过起点那一行');
  assert.ok(el.innerHTML.includes('街角店主 实付租金 19200（街心书屋）'), '折叠明细丢了租金那一行');
});

test('#1478b：单笔原因的屏上文案一位都不变（旧口径的守护线保留）', () => {
  const last = { day: 9, money: -5600, assets: -5600, lines: [
    '街角店主 实付租金 5600（东巷茶铺），穿街高手 收到 5600',
  ] };
  assert.equal(turnCauseLine(last, '街角店主'), '向 穿街高手 付租 5,600（东巷茶铺）');
  const s = startSession(createSliceConfig({ seed: 7, style: 'grow' }));
  const human = s.players.find(p => p.controller === 'human');
  human.lastTurn = last;
  const el = { innerHTML: '', hidden: false };
  renderSliceInsight(el, s, human);
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(el.innerHTML)?.[1] ?? '';
  assert.equal(summary, '你上回合：资金 -5,600 · 资产 -5,600（向 穿街高手 付租 5,600（东巷茶铺））');
});
