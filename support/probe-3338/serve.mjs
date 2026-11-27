// #3335：量具自己的静态服务器，随仓库走（与 support/probe-3334/serve.mjs 同一份实现）。
// 用法：node support/probe-3335/serve.mjs <root> <port>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2] ?? '.';
const PORT = Number(process.argv[3] ?? 8035);
const TYPE = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = normalize(decodeURIComponent(url.pathname));
  if (p === '/' || p === '') p = '/index.html';
  const file = join(ROOT, p);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPE[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} on ${PORT}`));
