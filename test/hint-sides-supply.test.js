import test from 'node:test';
import assert from 'node:assert/strict';
import { supplyOverflowText } from '../src/ui/render.js';

// #878 补充：补给屏与方向岔口屏用的是**同一个** mountOverflowHint。
// 本单给 mountOverflowHint 的 text 回调换了入参（数字 → {above, below}），
// 而 test/supply-fit.test.js:179-185 只调过 supplyOverflowText(3) 这种旧形态，
// 没有任何一条测试验证「补给屏真的会收到对象」—— 即本单改动在第二个界面上是否生效。
// 这一条补的就是这个洞：不补，补给屏的上沿会静默地一直不报。

const countIn = (s, n) => new RegExp('还有\\s*' + n + '\\s*个').test(s);

test('#878 L1：补给屏收到对象时，也要能说「上面」（否则方向屏修好了、补给屏没有）', () => {
  const t = supplyOverflowText({ above: 2, below: 0 });
  assert.equal(typeof t, 'string', '必须返回字符串，否则 textContent 会写成 [object Object]');
  assert.match(t, /在上面/, '上沿外 2 个补给选项，提示却说不是上面：' + t);
  assert.ok(countIn(t, 2), '条数没写出来：' + t);
  assert.doesNotMatch(t, /方向/, '补给屏不能说「方向」：' + t);
});

test('#878 L2：补给屏两侧都要报，且用「补给选项」而不是「方向」', () => {
  const t = supplyOverflowText({ above: 1, below: 3 });
  assert.match(t, /在上面/, '缺上面：' + t);
  assert.ok(countIn(t, 1), '上面的数不对：' + t);
  assert.ok(countIn(t, 3), '下面的数不对：' + t);
  assert.match(t, /补给选项/, '没用补给选项称谓：' + t);
  assert.doesNotMatch(t, /方向/);
});

test('#878 L3（不许误报）：above=0 时补给屏文本与旧版逐字相同', () => {
  assert.equal(supplyOverflowText({ above: 0, below: 2 }), '↓ 还有 2 个补给选项在下面',
    '既有断言（supply-fit.test.js:180-183）依赖这串字面；改了会静默漂');
});

test('#878 L4（向后兼容）：传数字仍走旧分支（既有调用与断言不受影响）', () => {
  assert.equal(supplyOverflowText(3), '↓ 还有 3 个补给选项在下面');
});
