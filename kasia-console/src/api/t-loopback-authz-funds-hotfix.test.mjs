// t-loopback-authz-funds-hotfix.test.mjs — T-LOOPBACK-AUTHZ 热修回归(J2 2026-09-14, Bettor/NWT v1.0 派工)。
// 覆盖 ADMIN_SECRET_FUNDS 三态(未设=503 / 设+带正确header=放行到原逻辑 / 设+不带或错header=403)
// 六条路由：/api/relay/:id/transfer、/api/chat/local、/api/prediction/publish-v2、
// /api/prediction/taker-stake/:offer_id、/api/prediction/refund/:offer_id、
// /api/pool/market/:id/oracle/deposit、/api/pool/market/:id/bettor/register；
// 外加 /skills/upload 恒 404(选项(b)，不受任何 env/header 影响)。
// 真 migration 隔离库 + 真 fastify 实例(同 feedback.test.mjs 既有 bootstrap 手法)。
// Run: cd kasia-console && node src/api/t-loopback-authz-funds-hotfix.test.mjs

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._TLA_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_tla_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    // KASPA_RPC_URL: relay.js 顶层 import rpc-health.js, 模块加载即读此 env(不实际连线, 只是路由注册需要它不抛)。
    env: {
      ...process.env, DB_PATH: tmpDb,
      KASPA_RPC_URL: process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210',
      KASPA_NETWORK: process.env.KASPA_NETWORK || 'mainnet',
      _TLA_TEST_BOOTSTRAPPED: '1',
    },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

import Fastify from 'fastify';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}: ${cond}`); fails++; } };

const HEADER = 'x-kanet-admin-secret';
const SECRET = 'test-funds-secret-9f3a';

// 六条路由的最小安全 payload(不真实触发转账/写状态 —— 全部指向不存在的 relay/offer/market,
// 目的只是验证"过了鉴权闸之后落到原逻辑的早期 404/400", 不是真跑一遍业务)。
const CASES = [
  { name: 'relay/:id/transfer', method: 'POST', url: '/api/relay/does-not-exist/transfer', payload: { to: 'kaspatest:x', amount: '1' } },
  { name: 'chat/local', method: 'POST', url: '/api/chat/local', payload: { relayId: 'does-not-exist', channel: 'c', message: 'm' } },
  { name: 'prediction/publish-v2', method: 'POST', url: '/api/prediction/publish-v2', payload: {} },
  { name: 'prediction/taker-stake/:offer_id', method: 'POST', url: '/api/prediction/taker-stake/does-not-exist', payload: { taker_relay_id: 'x' } },
  { name: 'prediction/refund/:offer_id', method: 'POST', url: '/api/prediction/refund/does-not-exist', payload: {} },
  { name: 'pool/market/:id/oracle/deposit', method: 'POST', url: '/api/pool/market/does-not-exist/oracle/deposit', payload: { oracle_relay_id: 'x' } },
  { name: 'pool/market/:id/bettor/register', method: 'POST', url: '/api/pool/market/does-not-exist/bettor/register', payload: { bettor_relay_id: 'x', direction: 0, stake_kas: 1 } },
];

async function buildApp() {
  const app = Fastify();
  const { registerRelayRoutes } = await import('./relay.js');
  const { registerChatRoutes } = await import('./chat.js');
  const { registerBettorRoutes } = await import('./bettor.js');
  const { registerPoolRoutes } = await import('./pool.js');
  const { registerSkillRoutes } = await import('./skills.js');
  await registerRelayRoutes(app);
  await registerChatRoutes(app);
  await registerBettorRoutes(app);
  await registerPoolRoutes(app);
  await registerSkillRoutes(app);
  await app.ready();
  return app;
}

console.log('[test] ① ADMIN_SECRET_FUNDS 未设 → 全部六条路由 503(主网默认关闭):');
{
  delete process.env.ADMIN_SECRET_FUNDS;
  const app = await buildApp();
  for (const c of CASES) {
    const res = await app.inject({ method: c.method, url: c.url, payload: c.payload });
    ok(res.statusCode === 503, `${c.name} 未设 env → 503 (实际 ${res.statusCode}: ${res.body.slice(0, 120)})`);
  }
  await app.close();
}

console.log('[test] ② ADMIN_SECRET_FUNDS 已设 + 不带 header → 全部六条路由 403(不是绕过, 是明确拒绝):');
{
  process.env.ADMIN_SECRET_FUNDS = SECRET;
  const app = await buildApp();
  for (const c of CASES) {
    const res = await app.inject({ method: c.method, url: c.url, payload: c.payload });
    ok(res.statusCode === 403, `${c.name} 设了env不带header → 403 (实际 ${res.statusCode}: ${res.body.slice(0, 120)})`);
  }
  await app.close();
}

console.log('[test] ③ ADMIN_SECRET_FUNDS 已设 + 带正确 header → 放行到原逻辑(早期404/400, 不再是503/403):');
{
  process.env.ADMIN_SECRET_FUNDS = SECRET;
  const app = await buildApp();
  for (const c of CASES) {
    const res = await app.inject({ method: c.method, url: c.url, payload: c.payload, headers: { [HEADER]: SECRET } });
    ok(res.statusCode !== 503 && res.statusCode !== 403, `${c.name} 带正确header → 过闸(实际 ${res.statusCode}, 应是404/400等原逻辑早期响应: ${res.body.slice(0, 120)})`);
  }
  await app.close();
}

console.log('[test] ④ /skills/upload 恒 404 —— 不受 env/header 影响(选项(b)硬下线, 与上面六条不同处置):');
{
  delete process.env.ADMIN_SECRET_FUNDS;
  const appNoEnv = await buildApp();
  const r1 = await appNoEnv.inject({ method: 'POST', url: '/skills/upload', payload: { fileName: 'x.mjs', fileContent: 'x' } });
  ok(r1.statusCode === 404, `未设 env → 404 (实际 ${r1.statusCode})`);
  await appNoEnv.close();

  process.env.ADMIN_SECRET_FUNDS = SECRET;
  const appWithHeader = await buildApp();
  const r2 = await appWithHeader.inject({ method: 'POST', url: '/skills/upload', payload: { fileName: 'x.mjs', fileContent: 'x' }, headers: { [HEADER]: SECRET } });
  ok(r2.statusCode === 404, `设了env且带header(FUNDS tier对本路由无意义) → 仍 404 (实际 ${r2.statusCode})`);
  await appWithHeader.close();
}

delete process.env.ADMIN_SECRET_FUNDS;

console.log(fails === 0
  ? '\n✅✅ ALL PASS — T-LOOPBACK-AUTHZ 六条路由三态(503/403/放行) + skills/upload 恒404 全绿'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
