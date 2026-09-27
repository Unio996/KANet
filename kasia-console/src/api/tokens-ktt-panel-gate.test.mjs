// tokens-ktt-panel-gate.test.mjs — D-035 NWT diff 审 MUST 闭合 §①②③(2026-09-27, docs/iteration/
// j1-inbox/2026-09-27T13-55Z-nwt-VERDICT-d035-ktt-v2-impl-diff-review.md §⑥): tokens.js 的
// /api/ktt/mint、/api/ktt/transfer 两条真花 relay 真实 KAS 手续费的路由——开关关/relay_id 未配/
// 限流触发 三个拒绝路径的路由级单测(真 Fastify + app.inject + 真 migration 临时库, 同
// proto-oracle-create-route.test.mjs 既有先例)。
// 不测 mint/transfer 成功路径的链上广播(那部分已由 docs/provenance/2026-09-27-j2-ktt-v2-simnet/
// 的真实 simnet 广播证据覆盖) —— 这里只补新加的三道闸, 全部在触达 relay 之前就应该被拒。
// Run: cd kasia-console && node src/api/tokens-ktt-panel-gate.test.mjs

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._KTT_PANEL_GATE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_ktt_panel_gate_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _KTT_PANEL_GATE_TEST_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
process.env.KASPA_NETWORK = 'simnet';
// 测试起点: 三个闸相关 env 全清(不继承外部 shell 可能已设的值, 保证每个 case 从已知状态开始)。
delete process.env.KTT_PANEL_ENABLED;
delete process.env.KTT_PANEL_RELAY_ID;
delete process.env.KTT_PANEL_RATE_LIMIT_PER_MIN;
delete process.env.KTT_PANEL_RATE_LIMIT_PER_DAY;

import Fastify from 'fastify';
const { registerTokenRoutes } = await import('./tokens.js');

let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const app = Fastify(); await registerTokenRoutes(app); await app.ready();
const body = (r) => { try { return JSON.parse(r.body); } catch { return {}; } };

const VALID_OWNER = 'a'.repeat(64);
const mintPayload = () => ({ owner_scheme: 0, owner_hex: VALID_OWNER });
const transferPayload = () => ({ ledger_id: 'nonexistent', dest_owner_hex: VALID_OWNER, dest_owner_scheme: 0 });
const mint = (p = mintPayload()) => app.inject({ method: 'POST', url: '/api/ktt/mint', payload: p });
const transfer = (p = transferPayload()) => app.inject({ method: 'POST', url: '/api/ktt/transfer', payload: p });
const holdings = () => app.inject({ method: 'GET', url: '/api/ktt/holdings?owner_hex=' + VALID_OWNER });

console.log('[test] §① KTT_PANEL_ENABLED 开关:');
{
  delete process.env.KTT_PANEL_ENABLED;
  const rm = await mint(); ok(rm.statusCode === 403 && /disabled/.test(body(rm).error), `开关未设 ⇒ mint 403 disabled(实际 ${rm.statusCode} ${body(rm).error})`);
  const rt = await transfer(); ok(rt.statusCode === 403 && /disabled/.test(body(rt).error), `开关未设 ⇒ transfer 403 disabled(实际 ${rt.statusCode} ${body(rt).error})`);
  const rh = await holdings(); ok(rh.statusCode === 200, `开关未设 ⇒ holdings(只读) 不受限, 200(实际 ${rh.statusCode})`);

  process.env.KTT_PANEL_ENABLED = '0';
  const rm2 = await mint(); ok(rm2.statusCode === 403, `开关=0 ⇒ mint 仍 403(实际 ${rm2.statusCode})`);
}

console.log('[test] §② KTT_PANEL_RELAY_ID 收紧:');
{
  process.env.KTT_PANEL_ENABLED = '1';
  delete process.env.KTT_PANEL_RELAY_ID;
  const rm = await mint(); ok(rm.statusCode === 403 && /KTT_PANEL_RELAY_ID/.test(body(rm).error), `开关开+relay_id 未配 ⇒ mint 403(实际 ${rm.statusCode} ${body(rm).error})`);
  const rt = await transfer(); ok(rt.statusCode === 403 && /KTT_PANEL_RELAY_ID/.test(body(rt).error), `开关开+relay_id 未配 ⇒ transfer 403(实际 ${rt.statusCode} ${body(rt).error})`);

  // request body 里塞一个 relay_id 字段(旧客户端可能还在传)——必须被忽略, 不能绕过服务端固定配置。
  const rm2 = await mint({ ...mintPayload(), relay_id: 'attacker-chosen-relay' });
  ok(rm2.statusCode === 403, `body 里显式传 relay_id 也不能绕过(仍走服务端固定值, 未配时仍 403, 实际 ${rm2.statusCode})`);
}

console.log('[test] §③ 限流(分钟窗口, 用极小 env 值让测试快速触发):');
{
  process.env.KTT_PANEL_ENABLED = '1';
  process.env.KTT_PANEL_RELAY_ID = 'relay-does-not-exist-in-db'; // 过闸后续下游会因 relay_nodes 查无该行而 500——不影响限流断言(限流计数在下游查询之前已经 INSERT)
  process.env.KTT_PANEL_RATE_LIMIT_PER_MIN = '2';
  process.env.KTT_PANEL_RATE_LIMIT_PER_DAY = '999999';

  const r1 = await mint(); ok(r1.statusCode !== 403 && r1.statusCode !== 429, `第 1 次(限额 2/分钟内): 过闸(未被开关/relay_id 拦, 实际 ${r1.statusCode} ${body(r1).error || ''})`);
  const r2 = await mint(); ok(r2.statusCode !== 403 && r2.statusCode !== 429, `第 2 次(限额内): 过闸(实际 ${r2.statusCode})`);
  const r3 = await mint(); ok(r3.statusCode === 429 && /限流/.test(body(r3).error), `第 3 次(超过 2/分钟限额): 429(实际 ${r3.statusCode} ${body(r3).error})`);
  const r4 = await mint(); ok(r4.statusCode === 429, `第 4 次仍 429(超限持续拒绝, 不因为被拒请求本身而"用完"额度提前恢复)`);

  // transfer 与 mint 是独立 action key, 各自限流, 互不占用对方额度。
  const rt1 = await transfer(); ok(rt1.statusCode !== 403 && rt1.statusCode !== 429, `transfer 第 1 次: 独立于 mint 的限流计数, 过闸(实际 ${rt1.statusCode})`);
}

console.log(`\n[summary] fails=${fails}`);
process.exit(fails > 0 ? 1 : 0);
