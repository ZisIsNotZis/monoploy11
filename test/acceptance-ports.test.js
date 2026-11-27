import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 外部复验真的撞过两次，都是「验收者被别人的端口拖下水」：
//  1) 两个独立检出同时跑整局，抢输的那一方看到「http port 8041 not bindable after 90s」
//     ——把「别人正在用」说成「量具坏了」。端口因此改成「偏好值 + 被占就向系统要新的」。
//  2) 那一版只检查三个里的**前两个**，而 verify 端口是跑完一局之后才绑的，
//     所以单独占用它时会先白跑 45 秒、再在最后一步失败。
// 这条测试复现 (2) 的情境：真占住 verify 端口，三个端口都必须换，且互不相同、当场可绑。
//
// 关键约束（第一版违反了它，于是自己变成了新的失败源）：测试**不能借操作者的 RUN_PORTS**。
// 如果操作者恰好占着某个端口，测试又去 bind 同一个号，它会先于一切产品检查而红，
// 整局根本不会开始——一次「公开整套复验」就这样被测试自己的端口选择毁掉。
// 所以这里的三个端口由测试向系统要，并且子进程环境里明确去掉 RUN_PORTS。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = path.join(ROOT, 'support', 'full-game', 'run-full.py');

// 子进程里不继承操作者的端口选择：这条测试要验的是「端口被占时怎么办」，
// 不是「操作者指定了什么」。
const ENV = { ...process.env };
delete ENV.RUN_PORTS;

const PY_PRELUDE = `
import importlib.util, json
spec = importlib.util.spec_from_file_location('rf', ${JSON.stringify(HARNESS)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
`;

function python(body) {
  const r = spawnSync('python3', ['-B', '-'],
    { input: PY_PRELUDE + body, encoding: 'utf8', cwd: ROOT, timeout: 120000, env: ENV });
  assert.equal(r.status, 0, `探测脚本失败：${r.stderr}`);
  const out = String(r.stdout ?? '');
  return JSON.parse(out.trim().split('\n').pop());
}

test('只占用 verify 端口时，三个偏好端口一起换（迟到失败就是这个原因）', () => {
  // 三个由系统分配的端口，且**同时**持有到拿到为止，保证彼此不同；
  // 然后只留第三个（verify 位）继续占着，前两个放掉，模拟「只有 verify 被占」。
  const out = python(`
import socket
held = []
try:
    while len(held) < 3:
        s = socket.socket()
        s.bind(('127.0.0.1', 0))
        held.append(s)
    preferred = [s.getsockname()[1] for s in held]
    # 只留 verify 位：前两个关掉，第三个继续 listen。
    for s in held[:2]:
        s.close()
    held = held[2:]
    held[0].listen(1)
    verify = preferred[2]
    picked, note = m.claim_ports(tuple(preferred), timeout=2)
    print(json.dumps({'preferred': preferred, 'picked': list(picked), 'note': note,
                      'bindable': [m.port_bindable(p) for p in picked]}))
finally:
    for s in held:
        s.close()
`);

  const [http, cdp, verify] = out.preferred;
  assert.equal(out.picked.length, 3);
  assert.equal(new Set(out.picked).size, 3, `换出来的端口有重复：${out.picked}`);
  assert.notEqual(out.picked[2], verify, 'verify 端口被占用，却仍然用它');
  for (const p of [http, cdp, verify]) {
    assert.ok(!out.picked.includes(p), `偏好端口 ${p} 明明被占，却还在用：${out.picked}`);
  }
  assert.deepEqual(out.bindable, [true, true, true], '换出来的端口当场绑不上');
  assert.match(out.note, new RegExp(String(verify)), '提示里没有指名哪个偏好端口被占');
});
