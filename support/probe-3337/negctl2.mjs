// #3337 负对照 v2：撤掉 styles.css 里**真正起作用**的那一处（结算屏底部留白 116px → 62px），
// 看 nextGameVisible 是否变红。
//
// v1 撤错了对象：我以为起作用的是「把句子也 sticky 钉底」，撤掉它句子仍在 754–792、
// 点得到、判定照绿 —— 那正好说明我多写了那条规则，留着它会让 review 以为遮挡是靠它修的。
// 现在撤 padding，这才是造成遮挡的那一处。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const url = new URL('../../styles.css', import.meta.url);
const original = readFileSync(url, 'utf8');
const anchor = '  #choice:not([hidden]):has([data-replay]) { padding-bottom: 116px; }';
if (!original.includes(anchor)) throw Error(`负对照锚点变了：styles.css 里找不到 "${anchor.trim()}"`);

mkdirSync(new URL('./negctl/', import.meta.url), { recursive: true });
writeFileSync(new URL('./negctl/styles.before.css', import.meta.url), original);
const broken = original.replace(anchor, '  #choice:not([hidden]):has([data-replay]) { padding-bottom: 62px; }');
writeFileSync(new URL('./negctl/styles.after.css', import.meta.url), broken);
console.log(JSON.stringify({ removed: anchor.trim(), bytesBefore: original.length, bytesAfter: broken.length }));
