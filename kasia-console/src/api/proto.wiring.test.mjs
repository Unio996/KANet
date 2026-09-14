// proto.wiring.test.mjs — 冒烟测试: 经真实 index.js 启动路径验证 registerProtoRoutes() 真的被接线了
// (KANet-UI 隔离联调抓到的真 bug: registerProtoRoutes 从未 import 进 index.js, proto.test.mjs 直接
// import 注册函数绕过了 index.js, 测不出这类"接线漏了"的问题——本文件专门堵这一类)。
//
// 真实 spawn `node src/index.js`(同 KANet-UI 联调手法: 独立端口 + 空库 + 死RPC), 用真实 HTTP fetch
// 打, 不是 app.inject()——app.inject() 也会绕过"index.js 有没有真的注册这个路由模块"这件事, 必须真的
// 走一次 index.js 的完整启动路径。
//
// 跑两轮(接线笔③启动断言落码后新增第②轮, 见 proto-relay-guard.mjs): ①PROTO_RELAY_ID 健康 → 路由
// 真的注册成功; ②PROTO_RELAY_ID 未配置 → 路由整体不可用(404), 且不拖垮 console 其余功能(health 端点
// 仍可用)——这条测的是 index.js 里"处理健康检查结果"这段胶水代码本身, 不是健康检查逻辑本身(那部分
// 有 proto-relay-guard.test.mjs 专门覆盖单元级别的 6 个分支)。
// Run: cd kasia-console && node src/api/proto.wiring.test.mjs

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

async function waitForPort(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function killAndCleanup(child, tmpDb) {
  // 🔴 NWT 修正(ledger 1358): `child.killed` 表示"kill() 被调用过", 不是"进程已退出"——SIGTERM 那行
  // 调完下一行它就已经是 true, `if (!child.killed)` 永远 false, SIGKILL 兜底是死代码。改判真实退出
  // (exitCode/signalCode 任一非 null = 进程已经真的退出了), 500ms 内没退出才补 SIGKILL。
  let exited = child.exitCode !== null || child.signalCode !== null;
  if (!exited) {
    child.kill('SIGTERM');
    // 🔴 NWT 实测(2026-09-14): Windows 上 `child.kill('SIGTERM')` 由 Node 直接终止子进程，不经过子进程
    // 自己的 JS 信号处理器(Windows 没有真正的 POSIX 信号语义，Node 在这个平台上把 SIGTERM 模拟成直接
    // TerminateProcess) —— 所以下面这条 500ms 超时后的 SIGKILL 兜底在 Windows 上几乎永远触发不到
    // (SIGTERM 已经把进程杀掉了，`exit` 事件几乎立即触发)；这条兜底真正起作用的场景是 Unix(那里子进程
    // 若自己注册了 SIGTERM 处理器可以选择不退出，才需要 SIGKILL 强制收尾)。在 Windows 上复现本文件时
    // 看到 SIGKILL 分支从未被打到，这是预期行为，不代表上面的兜底逻辑写错了。
    exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 500);
      child.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
  }
  if (!exited) child.kill('SIGKILL');
  try { fs.unlinkSync(tmpDb); } catch {}
}

async function spawnConsole({ dbSetup = null, port, protoRelayId, protoSingleOperator }) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_wiring_${port}_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  if (dbSetup) await dbSetup(tmpDb);

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: tmpDb,
      PORT: String(port),
      HOST: '127.0.0.1',
      KASPA_RPC_URL: 'ws://127.0.0.1:1', // 死RPC(端口1永不会有kaspad监听), 不需要真链(余额查询走 REST fallback)
      KASPA_NETWORK: 'mainnet',
      CONSOLE_ENCRYPTION_KEY: '00'.repeat(32),
      ...(protoRelayId ? { PROTO_RELAY_ID: protoRelayId } : { PROTO_RELAY_ID: '' }),
      ...(protoSingleOperator ? { PROTO_SINGLE_OPERATOR: '1' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const up = await waitForPort(port);
  return { child, tmpDb, up, getLogs: () => ({ stdout, stderr }) };
}

console.log('[test] 第①轮: PROTO_RELAY_ID 健康(relay_nodes 里有一条 proto- 前缀、余额可验证为 0 的行) → registerProtoRoutes 真的被接线了:');
{
  const PROTO_TEST_RELAY_ID = 'wiring-test-proto-relay';
  // 🔴 接线笔③启动断言(index.js 现在会先调 assertProtoRelayHealthy() 才 registerProtoRoutes, 见
  // proto-relay-guard.mjs)——地址是一个格式合法但从未在链上出现过的真实 kaspa 地址(REST fallback
  // 查询会如实返回余额 0, 天然 < PROTO_MAX_BALANCE_KAS——已用真实网络请求核实过这个地址返回
  // {"balance":0}, 不是假设)。
  const { child, tmpDb, up, getLogs } = await spawnConsole({
    port: 32061,
    protoRelayId: PROTO_TEST_RELAY_ID,
    dbSetup: async (dbPath) => {
      // db/client.js 合法通道(见同目录 proto.wiring.test.seed-relay.mjs 头注)——不裸 import
      // better-sqlite3(M0a 差分门 R-M0A-BARE-IMPORT-DIFF 只认这条路径, 实测撞过)。
      execSync('node src/api/proto.wiring.test.seed-relay.mjs ' + PROTO_TEST_RELAY_ID, {
        cwd: process.cwd(), env: { ...process.env, DB_PATH: dbPath }, stdio: 'pipe',
      });
    },
  });
  try {
    ok(up, `console 在 32061 上真实起来了(不是 app.inject, 是真 HTTP)`);
    if (!up) {
      const { stdout, stderr } = getLogs();
      console.error('--- stdout tail ---\n' + stdout.slice(-2000));
      console.error('--- stderr tail ---\n' + stderr.slice(-2000));
    } else {
      const tokensRes = await fetch('http://127.0.0.1:32061/api/tokens');
      ok(tokensRes.status === 200, `GET /api/tokens 实际 ${tokensRes.status}(KANet-UI 联调抓到的原始 bug: 未接线时这里是 404)`);
      const tokensBody = await tokensRes.json().catch(() => ({}));
      ok(tokensBody.ok === true && Array.isArray(tokensBody.tokens), `响应形状正确: ${JSON.stringify(tokensBody).slice(0, 100)}`);

      const marketsRes = await fetch('http://127.0.0.1:32061/api/proto-markets');
      ok(marketsRes.status === 200, `GET /api/proto-markets 实际 ${marketsRes.status}`);

      const createRes = await fetch('http://127.0.0.1:32061/api/tokens/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Wiring Smoke', ticker: 'WSK' }),
      });
      ok(createRes.status === 200, `POST /api/tokens/create 实际 ${createRes.status}`);
      const createBody = await createRes.json().catch(() => ({}));
      ok(createBody.ok === true && !!createBody.id, `创建成功返回id: ${JSON.stringify(createBody).slice(0, 100)}`);

      const relistRes = await fetch('http://127.0.0.1:32061/api/tokens');
      const relistBody = await relistRes.json().catch(() => ({}));
      ok(Array.isArray(relistBody.tokens) && relistBody.tokens.some((t) => t.id === createBody.id), '刚创建的定义能在列表里读回(真实端到端, 非 mock)');
    }
  } finally {
    await killAndCleanup(child, tmpDb);
  }
}

console.log('\n[test] 第②轮: PROTO_RELAY_ID 未配置 → proto 路由整体不可用(404), 但不拖垮 console 其余功能(health 端点仍可用) — 验证 index.js 对健康检查失败结果的处理逻辑本身, 不是健康检查逻辑本身:');
{
  const { child, tmpDb, up, getLogs } = await spawnConsole({ port: 32062, protoRelayId: null });
  try {
    ok(up, `console 在 32062 上真实起来了(即使 proto 健康检查会失败, 其余部分仍应正常启动)`);
    if (!up) {
      const { stdout, stderr } = getLogs();
      console.error('--- stdout tail ---\n' + stdout.slice(-2000));
      console.error('--- stderr tail ---\n' + stderr.slice(-2000));
    } else {
      const tokensRes = await fetch('http://127.0.0.1:32062/api/tokens');
      ok(tokensRes.status === 404, `GET /api/tokens 未配置 PROTO_RELAY_ID 时 404(fail-closed, 不是"随便放行", 实际 ${tokensRes.status})`);

      const marketsRes = await fetch('http://127.0.0.1:32062/api/proto-markets');
      ok(marketsRes.status === 404, `GET /api/proto-markets 同样 404(实际 ${marketsRes.status})`);

      const healthRes = await fetch('http://127.0.0.1:32062/health');
      ok(healthRes.status === 200, `对照: /health 不受影响, 仍 200(证明失败面被隔离在 proto 路由本身, 没有拖垮整个 console, 实际 ${healthRes.status})`);

      const { stderr } = getLogs();
      ok(/PROTO_RELAY_ID health check failed/.test(stderr) || /PROTO_RELAY_ID not configured/.test(stderr), 'stderr 里有 LOUD 日志说明具体拒绝原因, 不是静默吞掉');
    }
  } finally {
    await killAndCleanup(child, tmpDb);
  }
}

console.log('\n[test] 第③轮: PROTO_SINGLE_OPERATOR=1 → 多方入口结构性不存在(未知 market_id 一律 404, 外部市场/bettor 身份字段一律 400) — 证明 bet/resolve/claim/withdraw 没有绕过 proto_markets 已落表记录的路径:');
{
  const PROTO_TEST_RELAY_ID = 'wiring-test-proto-relay-single-op';
  const { child, tmpDb, up, getLogs } = await spawnConsole({
    port: 32063,
    protoRelayId: PROTO_TEST_RELAY_ID,
    protoSingleOperator: true,
    dbSetup: async (dbPath) => {
      execSync('node src/api/proto.wiring.test.seed-relay.mjs ' + PROTO_TEST_RELAY_ID, {
        cwd: process.cwd(), env: { ...process.env, DB_PATH: dbPath }, stdio: 'pipe',
      });
    },
  });
  try {
    ok(up, `console 在 32063 上真实起来了(PROTO_SINGLE_OPERATOR=1)`);
    if (!up) {
      const { stdout, stderr } = getLogs();
      console.error('--- stdout tail ---\n' + stdout.slice(-2000));
      console.error('--- stderr tail ---\n' + stderr.slice(-2000));
    } else {
      const UNKNOWN_MARKET_ID = 'ffffffff-0000-0000-0000-000000000000'; // 格式合法但从未落表的 market_id
      for (const [path, body] of [
        [`/api/proto-markets/${UNKNOWN_MARKET_ID}/bet`, { direction: 0, amount: 10 }],
        [`/api/proto-markets/${UNKNOWN_MARKET_ID}/resolve`, { outcome: 0 }],
        [`/api/proto-markets/${UNKNOWN_MARKET_ID}/claim`, {}],
        [`/api/proto-markets/${UNKNOWN_MARKET_ID}/withdraw`, {}],
      ]) {
        const res = await fetch(`http://127.0.0.1:32063${path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        ok(res.status === 404, `POST ${path}(未知 market_id, 正常字段) ⇒ 404(实际 ${res.status}) —— 唯一合法入口是 proto_markets 已落表记录, 不存在别的市场发现路径`);
      }

      // 外部身份字段(即使 market_id 也是未知的)一律 400——证明这条检查发生在 DB 查询之前, 是请求级
      // 结构性拒绝, 不依赖"market 存不存在"这个后续判断。
      for (const [field, value] of [['covenant_id', 'x'], ['bettor_pk', 'y'], ['shardleaf_txid', 'z']]) {
        const res = await fetch(`http://127.0.0.1:32063/api/proto-markets/${UNKNOWN_MARKET_ID}/bet`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction: 0, amount: 10, [field]: value }),
        });
        ok(res.status === 400, `POST bet 请求体含外部身份字段 ${field} ⇒ 400(实际 ${res.status}), 不是 404 —— 证明该拒绝在 market 查询之前生效`);
        const resBody = await res.json().catch(() => ({}));
        ok(typeof resBody.error === 'string' && resBody.error.includes(field), `错误信息点名具体字段 ${field}(实际: ${JSON.stringify(resBody).slice(0, 150)})`);
      }

      const { stdout } = getLogs();
      ok(/PROTO_SINGLE_OPERATOR=1/.test(stdout), 'stdout 里有 LOUD 日志确认 PROTO_SINGLE_OPERATOR 模式已生效(不是静默开启)');
    }
  } finally {
    await killAndCleanup(child, tmpDb);
  }
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — registerProtoRoutes() 真的被 index.js 接线了 + PROTO_RELAY_ID 健康检查失败时 fail-closed 且不拖垮其余 console 功能'
  : `\n❌ ${fails} assertions failed`);
// 🔴 不用 process.exit(): 本文件真 spawn 了子进程, 子进程的 stdio pipe 句柄在 kill 后需要事件循环
// 自己走完关闭流程——立即同步 process.exit() 会在 Windows 上撞 libuv 断言崩溃(实测见 ledger 1358 附近
// 讨论)。改用 exitCode 属性, 让进程自然退出、句柄自然清干净。
process.exitCode = fails === 0 ? 0 : 1;
