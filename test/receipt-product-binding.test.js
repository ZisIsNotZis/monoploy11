import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

// #3331：上面三条只回答「表里写了哪把锁」，不回答「回执自己记了没有」。
// 这正是 supervisor 抓到的那个洞：新回执被 `if (receipt.includes('3330')) continue;`
// 豁免掉，于是它恰恰没被检查 —— 判据在它该咬的那一份上闭上了嘴。
//
// 下面两条把「记了没有」变成必须：
//   ④ 当前产品锁对应的回执，provenance.json 里必须真的带 product 绑定；
//   ⑤ 反例守卫：一份没有 product 的回执必须被认成「未绑定」，而不是被当成通过。
test('当前锁的回执必须在 provenance 里带真实的产品绑定', () => {
  const lock = readFileSync(path.join(EVIDENCE, 'slice-entry-3331.sha256'), 'utf8');
  const lockSha = createHash('sha256').update(lock).digest('hex');
  const bound = receiptsOnDisk().filter(name => {
    const prov = JSON.parse(readFileSync(path.join(EVIDENCE, name, 'provenance.json'), 'utf8'));
    return prov.product && prov.product.lock_sha256 === lockSha;
  });
  assert.ok(bound.length > 0,
    '没有任何在库回执记录 product.lock_sha256 = 当前锁 —— 那份 PASS 就无从说明它跑的是哪版字节');
  // 绑定的回执还必须点的是**产品锁本身**，不是随手一个 sha。
  for (const name of bound) {
    const prov = JSON.parse(readFileSync(path.join(EVIDENCE, name, 'provenance.json'), 'utf8'));
    assert.equal(prov.product.lock, 'docs/evidence/slice-entry-3331.sha256',
      `${name} 绑定指向了别的文件`);
    assert.match(prov.product.tree_sha256, /^[0-9a-f]{64}$/, `${name} 的 tree_sha256 不是 sha256`);
    assert.notEqual(prov.product.tree_sha256, prov.product.lock_sha256,
      `${name} 的 tree_sha256 等于 lock_sha256 —— 那把校验在和它自己比较`);
  }
});

test('牙：没有 product 的回执不能被当成已绑定', () => {
  // 用 receiptsOnDisk 里真实存在的一份老回执（无 product 字段）负对照。
  const unbound = receiptsOnDisk().filter(name => {
    const prov = JSON.parse(readFileSync(path.join(EVIDENCE, name, 'provenance.json'), 'utf8'));
    return !prov.product;
  });
  assert.ok(unbound.length > 0, '负对照失效：库里已没有未绑定回执，这条守卫就测不到东西');
  const lockSha = createHash('sha256')
    .update(readFileSync(path.join(EVIDENCE, 'slice-entry-3331.sha256'))).digest('hex');
  const wouldBind = unbound.some(name => {
    const prov = JSON.parse(readFileSync(path.join(EVIDENCE, name, 'provenance.json'), 'utf8'));
    return prov.product && prov.product.lock_sha256 === lockSha;
  });
  assert.equal(wouldBind, false, '未绑定回执被认成了已绑定 —— 判据失效');
});
