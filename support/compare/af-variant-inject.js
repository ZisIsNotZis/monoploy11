// 对照入口的运行时覆盖：#108 问题②「翻修移出 grow 补给包」。
// 必须是 .scratch/af-variant.html 里第一个 module，保证在 src/main.js 求值前生效。
// import 的 URL 与 src/main.js 内部引用完全一致（/src/data/slice.js），
// 按 ESM 规范两边拿到同一个模块实例，所以改这里就是改游戏读到的那份。
import { SUPPLIES, SLICE_CARDS } from '../src/data/slice.js';

const grow = SUPPLIES.find(item => item.id === 'grow');
if (grow) {
  grow.cards = ['inflate', 'inflate'];
  grow.desc = `${SLICE_CARDS.inflate.name} + ${SLICE_CARDS.inflate.name}：连开两轮旺季，翻修不再从补给里来。`;
  document.documentElement.dataset.variant = 'no-worker-supply';
}
console.log('[variant] grow supply =', JSON.stringify(grow?.cards));
