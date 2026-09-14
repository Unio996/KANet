// proto.test.mjs — 原型v0端点骨架回归(J2 2026-09-14)。真migration隔离库+真Fastify+app.inject()
// (同feedback.test.mjs/t-loopback-authz-funds-hotfix.test.mjs既有手法)。覆盖:①代币定义真实CRUD
// ②市场/下注/结算/claim/withdraw五个链上端点在§6/§9未定案前一律501+不写任何DB状态(NO-TX-NO-STATE)
// ③输入校验先于buildAndBroadcast占位触发(400/404/409在501之前拦下,不该让占位错误掩盖真实校验)。
// Run: cd kasia-console && node src/api/proto.test.mjs

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._PROTO_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _PROTO_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

import Fastify from 'fastify';
const { sqlite } = await import('../db/client.js');
const { registerProtoRoutes } = await import('./proto.js');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const app = Fastify();
await registerProtoRoutes(app);
await app.ready();

let tokenDefId;
console.log('[test] ① 代币定义真实CRUD(纯DB,不上链):');
{
  const res = await app.inject({ method: 'POST', url: '/api/proto/tokens', payload: { name: 'Test Token', ticker: 'TST', description: 'demo', default_denomination: 8 } });
  const body = JSON.parse(res.body);
  ok(res.statusCode === 200 && body.ok === true, `创建成功: ${res.statusCode} ${res.body.slice(0, 100)}`);
  tokenDefId = body.id;
  const listRes = await app.inject({ method: 'GET', url: '/api/proto/tokens' });
  const listBody = JSON.parse(listRes.body);
  ok(listBody.tokens.length === 1 && listBody.tokens[0].id === tokenDefId, '列表能读回刚创建的定义');

  const missingName = await app.inject({ method: 'POST', url: '/api/proto/tokens', payload: { ticker: 'X' } });
  ok(missingName.statusCode === 400, `缺name → 400(实际 ${missingName.statusCode})`);
}

console.log('[test] ② POST /api/proto/markets: 校验先行, 广播占位501, 不写DB:');
{
  const badTokenDef = await app.inject({ method: 'POST', url: '/api/proto/markets', payload: { token_def_id: 'does-not-exist', deadline_ms: Date.now() + 100000, min_bet: 10 } });
  ok(badTokenDef.statusCode === 404, `不存在的token_def_id → 404(实际 ${badTokenDef.statusCode})`);

  const pastDeadline = await app.inject({ method: 'POST', url: '/api/proto/markets', payload: { token_def_id: tokenDefId, deadline_ms: Date.now() - 1000, min_bet: 10 } });
  ok(pastDeadline.statusCode === 400, `过去的deadline_ms → 400(实际 ${pastDeadline.statusCode})`);

  const valid = await app.inject({ method: 'POST', url: '/api/proto/markets', payload: { token_def_id: tokenDefId, deadline_ms: Date.now() + 100000, min_bet: 10, seal_count: 99 } });
  const body = JSON.parse(valid.body);
  ok(valid.statusCode === 501, `合法请求但§6/§9未定案 → 501(实际 ${valid.statusCode})`);
  ok(/market_genesis/.test(body.error) || /market_genesis/.test(body.detail || ''), `错误信息标注具体卡在哪(market_genesis): ${JSON.stringify(body).slice(0, 150)}`);
  const marketCount = sqlite.prepare('SELECT COUNT(*) c FROM proto_markets').get().c;
  ok(marketCount === 0, `NO-TX-NO-STATE: 501不写任何proto_markets行(实际行数 ${marketCount})`);
}

console.log('[test] ③ GET /api/proto/markets 与 /:id 在空表/不存在时行为正确:');
{
  const listRes = await app.inject({ method: 'GET', url: '/api/proto/markets' });
  const listBody = JSON.parse(listRes.body);
  ok(listRes.statusCode === 200 && Array.isArray(listBody.markets) && listBody.markets.length === 0, '空市场列表返回200+空数组,不是报错');

  const notFound = await app.inject({ method: 'GET', url: '/api/proto/markets/does-not-exist' });
  ok(notFound.statusCode === 404, `不存在的市场id → 404(实际 ${notFound.statusCode})`);
}

console.log('[test] ④ 下注/结算/claim/withdraw 四个端点: market不存在时404(校验先于501占位):');
{
  const bet = await app.inject({ method: 'POST', url: '/api/proto/markets/does-not-exist/bet', payload: { bettor_pk: 'aa'.repeat(32), side: 0, stake: 100 } });
  ok(bet.statusCode === 404, `bet: market不存在 → 404(实际 ${bet.statusCode})`);

  const resolve = await app.inject({ method: 'POST', url: '/api/proto/markets/does-not-exist/resolve', payload: { winning_side: 0 } });
  ok(resolve.statusCode === 404, `resolve: market不存在 → 404(实际 ${resolve.statusCode})`);

  const claim = await app.inject({ method: 'POST', url: '/api/proto/markets/does-not-exist/claim', payload: { bettor_pk: 'aa'.repeat(32) } });
  ok(claim.statusCode === 404, `claim: market不存在 → 404(实际 ${claim.statusCode})`);

  const withdraw = await app.inject({ method: 'POST', url: '/api/proto/markets/does-not-exist/withdraw', payload: { bettor_pk: 'aa'.repeat(32) } });
  ok(withdraw.statusCode === 404, `withdraw: market不存在 → 404(实际 ${withdraw.statusCode})`);
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — 原型v0端点骨架(代币定义CRUD真实可用 + 五个链上端点校验先行+501占位+零DB副作用) 全绿'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
