#!/usr/bin/env node
// #3341：`docs/variant-entry-and-risk.md` 开头原来写「全部读数都能用 `node tools/verify-grow-panel.mjs`
// 复现」—— 而**这个文件在本仓历史上从未存在过**（`git log --all -- tools/verify-grow-panel.mjs` 为空）。
// 那句话从第一天起就不成立：读者拿着干净检出敲不出任何东西。
//
// 这个脚本替换掉那句承诺里的「一条命令」。它回答的是那篇文档真正的主张，而且是**不用浏览器**就能核的一条：
//   grow 补给包原本是「翻修 + 旺季」，对照版运行时把它改成「旺季 + 旺季」。
//   这里在同一个进程里加载同一个 slice.js 模块实例、按对照注入的做法改一次，再读回来。
// 它证明的是：**那处注入真的会改到引擎读到的那一份 SUPPLIES**（模块实例唯一）。
// 它不证明浏览器里画出来的文本——那是原文档里真跑过的那一次（输出在下面 §「实测输出」），
// 那一次的现场没有留在仓库里，所以这里把它标成「历史读数，本次未复跑」，而不是继续假装能一键复现。
//
// 跑：node support/probe-3341/variant-diff.mjs
import { SUPPLIES, SLICE_CARDS } from '../../src/data/slice.js';

const show = () => SUPPLIES.find(i => i.id === 'grow');
const before = { cards: [...show().cards], desc: show().desc };

// 与 docs/variant-entry-and-risk.md §2 里那段注入**逐字同义**（只是把注释换成说明）。
import * as sliceModule from '../../src/data/slice.js';
const live = sliceModule.SUPPLIES.find(i => i.id === 'grow');
const saved = { cards: [...live.cards], desc: live.desc };
try {
  live.cards = ['inflate', 'inflate'];
  live.desc = `${SLICE_CARDS.inflate.name} + ${SLICE_CARDS.inflate.name}：连开两轮旺季，翻修不再从补给里来。`;
  const after = { cards: [...show().cards], desc: show().desc };
  console.log(JSON.stringify({
    sameModuleInstance: show() === live,
    before, after,
    cardsChanged: JSON.stringify(before.cards) !== JSON.stringify(after.cards),
    descChanged: before.desc !== after.desc,
    // 文档 §1 说「8001 的根路径与原版相同，只有带 .scratch 的路径是对照页」——
    // 那是服务器路由的事实，由 support/serve-variant.py 与 test/serve-variant-*.test.js 管，不在这里。
  }, null, 1));
} finally {
  live.cards = saved.cards;
  live.desc = saved.desc;
}
