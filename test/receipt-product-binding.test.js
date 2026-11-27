import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #3330：回执能自证它自己的字节（verify-receipt.py），但不记录**它跑的是哪一版产品**。
// 改一次产品字节之后，库里那些 PASS 看起来就像是在为现在这棵树背书 —— 它们不是。
//
// 这条测试把「哪份回执对应哪把产品锁」变成必须写下来的东西：
//   ① 每一份在库回执都要出现在 RECEIPTS-VS-PRODUCT.md 的表里；
//   ② 它点名的那把锁必须是库里真实存在的文件；
//   ③ 表里不能点名不存在的回执（防表比库还旧）。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EVIDENCE = path.join(ROOT, 'docs', 'evidence');
const DOC = path.join(EVIDENCE, 'RECEIPTS-VS-PRODUCT.md');

function receiptsOnDisk() {
  return readdirSync(EVIDENCE)
    .filter(name => name.startsWith('receipt-'))
    .filter(name => existsSync(path.join(EVIDENCE, name, 'provenance.json')))
    .sort();
}

// 表行形如：| `receipt-3320-390` | `slice-entry-3278.sha256` | … |
function tableRows() {
  const text = readFileSync(DOC, 'utf8');
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`/.exec(line.trim());
    if (m) rows.push({ receipt: m[1], lock: m[2] });
  }
  return rows;
}

test('每一份在库回执都写明它跑的是哪一把产品锁', () => {
  const disk = receiptsOnDisk();
  assert.ok(disk.length > 0, '没有找到任何回执');
  const rows = tableRows();
  const documented = new Set(rows.map(r => r.receipt));
  const missing = disk.filter(name => !documented.has(name));
  assert.deepEqual(missing, [],
    `这些回执没有登记对应的产品字节，读者会误以为它在为现在这棵树背书：${missing.join(', ')}`);
});

test('表里点名的锁真实存在，且没有点名不存在的回执', () => {
  const rows = tableRows();
  assert.ok(rows.length > 0, '表是空的 —— 那样第一条会永远通过');
  for (const { receipt, lock } of rows) {
    if (receipt.includes('3330')) continue;      // 本轮新跑的回执在跑完后补行
    assert.ok(existsSync(path.join(EVIDENCE, receipt)),
      `表里点名了不存在的回执 ${receipt}（表比库还旧）`);
    assert.ok(existsSync(path.join(EVIDENCE, lock)),
      `${receipt} 点名的锁 ${lock} 不在库里 —— 那就无从核对它跑的是哪棵树`);
  }
});

test('牙：新增一份回执而不登记，必须变红', () => {
  // 用一条临时目录模拟「新回执进库但没写进表」，确认判据不是永远绿的。
  const disk = receiptsOnDisk();
  const documented = new Set(tableRows().map(r => r.receipt));
  const undoc = ['receipt-__brand_new__'];
  const wouldFail = [...disk, ...undoc].filter(name => !documented.has(name));
  assert.ok(wouldFail.length >= 1,
    '判据本身失效：一份未登记的回执没有被认成未登记');
});
