import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 结算屏的「换个打法，再开一局」曾经落到**完整模式设置页**：replay() 删掉了 ?slice 与
// ?style，只把 seed +1。第一次玩完的人想再来一局，先要在一堆完整模式选项里重新找入口、
// 再重选起手。390 整局实测就是这个（support/full-game/OUT-W-390-gate/record-10-replay.json：
// sliceEntryAfterReplay=false、stylePreselected=[]）。
//
// 现在回到切片第一屏、保留刚才那手起手、只把种子 +1。这条测试不跑浏览器，
// 它钉住的是**URL 契约**：三个参数各自该怎么写，以及不能退回旧写法。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(HERE, '..', 'src', 'main.js');

function replayBody() {
  const src = readFileSync(MAIN, 'utf8');
  const start = src.indexOf('  replay() {');
  assert.ok(start > 0, 'src/main.js 里找不到 replay()');
  const end = src.indexOf('\n  },', start);
  assert.ok(end > start, 'replay() 的结尾没找到（函数体结构变了，请更新这条测试）');
  return src.slice(start, end);
}

test('replay 回到切片入口，而不是完整模式设置页', () => {
  const body = replayBody();
  assert.match(body, /url\.searchParams\.set\('slice',\s*'1'\)/,
    'replay 没有把 slice=1 写回去：会落到完整模式设置页');
  assert.ok(!/url\.searchParams\.delete\('slice'\)/.test(body),
    'replay 仍在删 slice 参数（这正是旧缺陷的写法）');
});

test('replay 保留这局用的起手', () => {
  const body = replayBody();
  assert.match(body, /searchParams\.set\('style',\s*style\)/,
    'replay 没有把起手写回 URL：三种起手会一个都不预选');
  // 起手要从这一局的状态里读，不能写死某一个。
  assert.match(body, /controller\s*===\s*'human'|participants\?\.\[0\]\?\.style/,
    'replay 没有从当前对局读取人类座位的起手');
  assert.ok(!/set\('style',\s*'(grow|take|cross)'\)/.test(body),
    'replay 把起手写死了：换打法就没意义了');
});

test('replay 仍然把种子往前推一步（同一局不会原样重来）', () => {
  const body = replayBody();
  assert.match(body, /set\('seed',\s*state\.seed\s*\+\s*1\)/,
    'replay 没有推进种子，第二局会与刚结束的一局完全相同');
});

// 牙：把旧写法塞回去，上面两条必须红。用字符串层面复现旧函数体，
// 免得为了“咬一口”去改产品文件。
test('旧写法（删 slice/style、只改 seed）会被前两条判据拒绝', () => {
  const old = "  replay() {const url=new URL(location.href);"
    + "url.searchParams.delete('slice');url.searchParams.delete('start');"
    + "url.searchParams.set('seed',state.seed+1);location.href=url.href;},\n";
  assert.ok(!/url\.searchParams\.set\('slice',\s*'1'\)/.test(old), '牙：旧写法不该命中 slice 判据');
  assert.ok(/url\.searchParams\.delete\('slice'\)/.test(old), '牙：旧写法应当被 delete-slice 判据抓住');
  assert.ok(!/searchParams\.set\('style'/.test(old), '牙：旧写法不该命中 style 判据');
});
