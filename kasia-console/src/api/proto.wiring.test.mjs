// proto.wiring.test.mjs — 冒烟测试: 经真实 index.js 启动路径验证 registerProtoRoutes() 真的被接线了
// (KANet-UI 隔离联调抓到的真 bug: registerProtoRoutes 从未 import 进 index.js, proto.test.mjs 直接
// import 注册函数绕过了 index.js, 测不出这类"接线漏了"的问题——本文件专门堵这一类)。
//
// 真实 spawn `node src/index.js`(同 KANet-UI 联调手法: 独立端口 + 空库 + 死RPC), 用真实 HTTP fetch
// 打, 不是 app.inject()——app.inject() 也会绕过"index.js 有没有真的注册这个路由模块"这件事, 必须真的
// 走一次 index.js 的完整启动路径。
// Run: cd kasia-console && node src/api/proto.wiring.test.mjs

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const PORT = 32061; // 不与常规部署端口(3200/3202)冲突的隔离端口
const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_wiring_${process.pid}.db`;
try { fs.unlinkSync(tmpDb); } catch {}
execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });

const child = spawn(process.execPath, ['src/index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DB_PATH: tmpDb,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    KASPA_RPC_URL: 'ws://127.0.0.1:1', // 死RPC(端口1永不会有kaspad监听), 不需要真链
    KASPA_NETWORK: 'mainnet',
    CONSOLE_ENCRYPTION_KEY: '00'.repeat(32),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '', stderr = '';
child.stdout.on('data', (d) => { stdout += d.toString(); });
child.stderr.on('data', (d) => { stderr += d.toString(); });

async function waitForPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/tokens`);
      if (res) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

try {
  const up = await waitForPort(PORT);
  ok(up, `console 在 ${PORT} 上真实起来了(不是 app.inject, 是真 HTTP)`);
  if (!up) {
    console.error('--- stdout tail ---\n' + stdout.slice(-2000));
    console.error('--- stderr tail ---\n' + stderr.slice(-2000));
  } else {
    console.log('[test] GET /api/tokens 经真实 index.js 启动路径可达(不是 404 Route not found):');
    const tokensRes = await fetch(`http://127.0.0.1:${PORT}/api/tokens`);
    ok(tokensRes.status === 200, `实际 ${tokensRes.status}(KANet-UI 联调抓到的原始 bug: 未接线时这里是 404)`);
    const tokensBody = await tokensRes.json().catch(() => ({}));
    ok(tokensBody.ok === true && Array.isArray(tokensBody.tokens), `响应形状正确: ${JSON.stringify(tokensBody).slice(0, 100)}`);

    console.log('[test] GET /api/proto-markets 经真实 index.js 启动路径可达:');
    const marketsRes = await fetch(`http://127.0.0.1:${PORT}/api/proto-markets`);
    ok(marketsRes.status === 200, `实际 ${marketsRes.status}`);

    console.log('[test] POST /api/tokens/create 经真实 index.js 启动路径真的写库:');
    const createRes = await fetch(`http://127.0.0.1:${PORT}/api/tokens/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Wiring Smoke', ticker: 'WSK' }),
    });
    ok(createRes.status === 200, `实际 ${createRes.status}`);
    const createBody = await createRes.json().catch(() => ({}));
    ok(createBody.ok === true && !!createBody.id, `创建成功返回id: ${JSON.stringify(createBody).slice(0, 100)}`);

    const relistRes = await fetch(`http://127.0.0.1:${PORT}/api/tokens`);
    const relistBody = await relistRes.json().catch(() => ({}));
    ok(Array.isArray(relistBody.tokens) && relistBody.tokens.some((t) => t.id === createBody.id), '刚创建的定义能在列表里读回(真实端到端, 非 mock)');
  }
} finally {
  // 🔴 NWT 修正(ledger 1358): `child.killed` 表示"kill() 被调用过", 不是"进程已退出"——SIGTERM 那行
  // 调完下一行它就已经是 true, `if (!child.killed)` 永远 false, SIGKILL 兜底是死代码。改判真实退出
  // (exitCode/signalCode 任一非 null = 进程已经真的退出了), 500ms 内没退出才补 SIGKILL。
  let exited = child.exitCode !== null || child.signalCode !== null;
  if (!exited) {
    child.kill('SIGTERM');
    exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 500);
      child.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
  }
  if (!exited) child.kill('SIGKILL');
  try { fs.unlinkSync(tmpDb); } catch {}
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — registerProtoRoutes() 真的被 index.js 接线了(真实 spawn + 真实 HTTP, 不是 app.inject 绕过接线检查)'
  : `\n❌ ${fails} assertions failed`);
// 🔴 不用 process.exit(): 本文件真 spawn 了一个子进程, 子进程的 stdio pipe 句柄在 kill 后需要事件循环
// 自己走完关闭流程——立即同步 process.exit() 会在 Windows 上撞 libuv 断言崩溃(实测: "Assertion failed:
// !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c" ——断言在全部测试通过之后才炸, exit code
// 变成 127 而不是 0, 会被误判为测试失败)。改用 exitCode 属性, 让进程自然退出、句柄自然清干净。
process.exitCode = fails === 0 ? 0 : 1;
