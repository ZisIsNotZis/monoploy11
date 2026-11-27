import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #1807：测试起 serve.py 的唯一正确方式。
//
// 以前每个文件都有自己的一份 freePort()：先探一个「看起来空闲」的端口号，
// 再 spawn serve.py 用那个号。两步之间有窗口，并发时两份测试可能选到同一个号。
//
// 而**在 Windows 上那不会报错**：HTTPServer.allow_reuse_address 默认 1，
// Windows 的 SO_REUSEADDR 允许绑定已被监听的端口，于是两台服务器静默共用一根线
// （实测：两个 serve.py 同绑一个端口都成功；杀掉先绑者后端口仍在应答）。
//
// 后果不是「起不来」，而是**前置校验假绿**：后起那份的 waitTcp 与 get('/index.html')
// 连到的都是**别人**的 serve.py —— 同一个仓库根、内容一模一样，HTTP 侧无从区分。
// 等对方跑完 after() 杀掉进程，本份剩下的断言就集体 ECONNREFUSED / ECONNRESET，
// 连「只绑回环地址」这种根本不联网的同步断言也一起红。
// 这就是 09:30 那次 23 红的形状，也是本单压测里 block-prefix(26 条)、
// sentinel(3/3 轮) 复现出来的形状。
//
// 修法：不猜端口。让 serve.py 自己 bind(0)、由 OS 原子分配，再从**自己 spawn 的进程**
// 的 stdout 把实际端口读回来。这样「这个端口是我的」是结构性事实，不靠 HTTP 探针去猜。
// 实测（.scratch/1807-port-race/）：8 进程 × 6 轮并发 bind(0) 共 48 个样本 0 重号；
// 8 实例 × 5 轮压测：改前 5/5 轮有红，改后 0/5。

// 放在 support/ 而不是 test/helpers/：`node --test` 默认搜集 `test/**/*.js`，
// 放进 test/ 会被当成一个测试文件计入总数 —— 而它没有任何断言，
// 于是总数从 501 变成 502，多出来的是一条**永远绿的假测试**。
// 实测：放在 test/helpers/ 时全量为 502/502。
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

/**
 * 起一份 serve.py，端口由 OS 分配。
 * @returns {{child: import('node:child_process').ChildProcess, announced: Promise<number>}}
 */
export function startServer() {
  const child = spawn(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    ['serve.py', '0'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let stderrText = '';
  child.stderr.on('data', d => { stderrText += d.toString(); });

  const announced = new Promise((resolve, reject) => {
    let buf = '';
    // 宣告超时就**杀掉子进程**再 reject。
    // 不杀的话，超时的测试文件会因为那个 python 还活着而拖住整个 node 进程：
    // 实测（.scratch/1807-port-race/stress-final.py）一次臂跑到 400s 超时被杀，
    // 而且它是在 serve.py 被换回改前字节（不打印 LISTENING）时暴露的。
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已经死了就算了 */ }
      reject(new Error(`serve.py 10s 内没有宣告端口\n${stderrText}`));
    }, 10000);
    const onData = d => {
      buf += d.toString();
      const m = /LISTENING (\d+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(Number(m[1]));
      }
    };
    child.stdout.on('data', onData);
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`serve.py 在宣告端口前退出 rc=${code}\n${stderrText}`));
    });
  });

  return { child, announced };
}

/** 起服务；返回 { child, port }。宣告失败时 reject 带上 stderr。 */
export async function startServerFixture() {
  const { child, announced } = startServer();
  const port = await announced;
  return { child, port };
}
