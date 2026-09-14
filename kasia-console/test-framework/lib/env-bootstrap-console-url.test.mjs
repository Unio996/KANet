// env-bootstrap-console-url.test.mjs — rule 82 checkConsoleUrlListening() 负向测试
// (2026-09-14，设计 docs/2026-09-14-kanetui-test-runner-skip-gate-and-console-url-safety-design-v0.1.md，
// NWT GREEN 8578050b，(a)(b) 补充要求 ledger 1251)。
// Run: cd kasia-console && node test-framework/lib/env-bootstrap-console-url.test.mjs
//
// 用真实本地 socket（不 mock probe），因为 NWT (b) 明确要求"探测对端收到 0 字节"这条断言必须是
// 真实断言，不是描述——一个真的本地 net.createServer 统计收到的字节数，比 mock 一个 probe 函数说
// "我假装探测过了"更能证明这件事。exit 用 DI 注入 mock（"应该退出"这条路径不能真的杀测试进程）。

import net from 'node:net';
import { checkConsoleUrlListening } from './env-bootstrap.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name} ${detail}`); }
};

function startProbeServer(port) {
  return new Promise((resolve) => {
    let bytesReceived = 0;
    const server = net.createServer((sock) => {
      sock.on('data', (d) => { bytesReceived += d.length; });
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, getBytes: () => bytesReceived }));
  });
}
function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}
// 捕获 console.log 输出，测完还原（不留污染给同进程后续测试/case）。
function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  return Promise.resolve(fn()).finally(() => { console.log = orig; }).then(() => lines);
}

const PORT_EMPTY = 58311;   // 全程不起任何服务，验证"空端口零摩擦"
const PORT_LISTEN = 58312;  // 会起一个真实本地 server

console.log('[test] ① 空端口(无人监听) → 零摩擦，不 exit、不打印任何 LOUD 行:');
{
  let exitCalled = false;
  const logs = await captureLogs(() =>
    checkConsoleUrlListening({ hasRealChain: false }, {
      exit: (code) => { exitCalled = true; },
      consoleUrl: `http://127.0.0.1:${PORT_EMPTY}`,
      explicit: false,
    })
  );
  ok('空端口不 exit', exitCalled === false);
  ok('空端口不打印任何行', logs.length === 0, JSON.stringify(logs));
}

console.log('[test] ② 端口有人监听 + 非显式(派生) → LOUD + exit(1)（NWT (a) 原有行为，派生场景仍拒绝）:');
{
  const { server, getBytes } = await startProbeServer(PORT_LISTEN);
  let exitCode = null;
  const logs = await captureLogs(() =>
    checkConsoleUrlListening({ hasRealChain: false }, {
      exit: (code) => { exitCode = code; },
      consoleUrl: `http://127.0.0.1:${PORT_LISTEN}`,
      explicit: false,
    })
  );
  ok('非显式+监听中 → exit(1)', exitCode === 1, `got ${exitCode}`);
  ok('日志提到"不是调用方显式设置"', logs.some((l) => l.includes('不是调用方显式设置')));
  ok('(b) 探测对端收到 0 字节(真实 server 断言)', getBytes() === 0, `got ${getBytes()}`);
  await stopServer(server);
}

console.log('[test] ③ 端口有人监听 + 显式 URL + hasRealChain=false → 中等 LOUD，不 exit:');
{
  const { server, getBytes } = await startProbeServer(PORT_LISTEN);
  let exitCalled = false;
  const logs = await captureLogs(() =>
    checkConsoleUrlListening({ hasRealChain: false }, {
      exit: (code) => { exitCalled = true; },
      consoleUrl: `http://127.0.0.1:${PORT_LISTEN}`,
      explicit: true,
    })
  );
  ok('显式+监听中+非real_chain → 不 exit', exitCalled === false);
  ok('打印"调用方显式设置...不拦截"', logs.some((l) => l.includes('调用方显式设置了这个 URL，不拦截')));
  ok('横幅不是最高级(无 real_chain 三连🔴)', !logs.some((l) => l.includes('最高级警告')));
  ok('(b) 零字节', getBytes() === 0);
  await stopServer(server);
}

console.log('[test] ④ 端口有人监听 + 显式 URL + hasRealChain=true → 最高级 LOUD，仍不 exit（(a) 核心要求）:');
{
  const { server, getBytes } = await startProbeServer(PORT_LISTEN);
  let exitCalled = false;
  const logs = await captureLogs(() =>
    checkConsoleUrlListening({ hasRealChain: true }, {
      exit: (code) => { exitCalled = true; },
      consoleUrl: `http://127.0.0.1:${PORT_LISTEN}`,
      explicit: true,
    })
  );
  ok('显式+监听中+real_chain → 仍不 exit(NWT (a): 不必然拒绝)', exitCalled === false);
  ok('横幅确实是最高级(含"最高级警告"+real_chain 措辞)', logs.some((l) => l.includes('最高级警告') && l.includes('real_chain')));
  ok('仍打印"调用方显式设置...不拦截"(严重度升级但不改变放行结论)', logs.some((l) => l.includes('调用方显式设置了这个 URL，不拦截')));
  ok('(b) 零字节(严重度不同不代表探测方式不同)', getBytes() === 0);
  await stopServer(server);
}

console.log(`\n${pass && !fail ? '✅✅ ALL PASS' : '❌ FAIL'} (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
