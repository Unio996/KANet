#!/usr/bin/env node
/**
 * 用例专用: 起一个只回固定应答的假 console, 用来测告警链的【应答校验】那一段。
 *
 * 🔴 为什么要真起一个 HTTP 服务, 而不是把 curl 的返回值注入进去:
 *    假体替被测代码准备好答案 ⇒ 挡掉整类真实失败(在册判据: 假体不许供给它要测的东西)。
 *    这里要测的正是"拿到一坨字节之后怎么判成功", 那就必须让那坨字节真的从网络上来。
 * 🔴 也不依赖 `nc`: 本机 Git Bash 没有它, 而"没测"当时长得跟"通过"很像(靠 SKIP 行才没混过去)。
 *
 * 用法: node scripts/j1-fake-console.mjs <port> <body> [status]
 *       起来后打印一行 READY, 便于调用方等它就绪而不是靠 sleep 猜。
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2]);
const body = process.argv[3] ?? '';
const status = Number(process.argv[4] || 200);
if (!Number.isInteger(port) || port <= 0) {
  console.error('用法: node j1-fake-console.mjs <port> <body> [status]');
  process.exit(2);
}

const srv = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  });
});
srv.listen(port, '127.0.0.1', () => console.log('READY'));
// 自杀闸: 用例崩了也不留孤儿进程。
setTimeout(() => process.exit(0), 30000).unref?.();
