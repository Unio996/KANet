// proto-relay-guard.test.mjs — PROTO_RELAY_ID 基础设施回归(J2 2026-09-14, 接线笔③, 设计
// docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md §6(B′)/§9.2③, Bettor 1354/1365)。
// 真 migration 隔离库(同 proto.test.mjs 既有 bootstrap 手法), 余额查询用注入的假 getBalanceFn
// (离线, 不碰真实 RPC/kaspa-wasm——那部分是既有 GET /api/relay/:id/balance 同款模式的复用,
// 不是本次新写的逻辑, 不需要重复测)。
// Run: cd kasia-console && node src/lib/proto-relay-guard.test.mjs

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._PROTO_RELAY_GUARD_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_relay_guard_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _PROTO_RELAY_GUARD_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { rejectRelayIdInBody } = await import('./proto-relay-guard.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

function seedRelay({ id, name, address, network = 'mainnet' }) {
  sqlite.prepare(`
    INSERT INTO relay_nodes (id, name, address, network, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, name, address, network);
}

// assertProtoRelayHealthy 依赖模块加载时读一次的 PROTO_RELAY_ID 常量(process.env 快照) —— 每个分支
// 需要不同的 env 值时, 必须在设置好 env 之后才 import 这个模块(ESM 模块只求值一次, 不能中途重新读
// process.env)。用动态 import + 不同的临时脚本子进程规避"改 env 对已加载模块无效"这个 JS 语义。
console.log('[test] ① PROTO_RELAY_ID 未配置 ⇒ 启动断言 throw(fail-closed: 未配置=无人被授权):');
{
  delete process.env.PROTO_RELAY_ID;
  const { assertProtoRelayHealthy } = await import('./proto-relay-guard.mjs?t=1'); // query string 绕过 ESM 模块缓存, 强制重新求值 PROTO_RELAY_ID
  let threw = null;
  try { await assertProtoRelayHealthy(); } catch (e) { threw = e; }
  ok(threw && /PROTO_RELAY_ID not configured/.test(threw.message), `实际: ${threw && threw.message}`);
}

console.log('[test] ② PROTO_RELAY_ID 配置了但 relay_nodes 表里找不到这一行 ⇒ throw:');
{
  process.env.PROTO_RELAY_ID = 'does-not-exist-id';
  const { assertProtoRelayHealthy } = await import('./proto-relay-guard.mjs?t=2');
  let threw = null;
  try { await assertProtoRelayHealthy(); } catch (e) { threw = e; }
  ok(threw && /not found in relay_nodes table/.test(threw.message), `实际: ${threw && threw.message}`);
}

console.log('[test] ③ name 不含 proto- 前缀 ⇒ throw(名前缀是人眼可见的 tripwire, 硬条件):');
{
  seedRelay({ id: 'relay-no-prefix', name: 'production-relay-1', address: 'kaspa:qtest1' });
  process.env.PROTO_RELAY_ID = 'relay-no-prefix';
  const { assertProtoRelayHealthy } = await import('./proto-relay-guard.mjs?t=3');
  let threw = null;
  try { await assertProtoRelayHealthy({ getBalanceFn: async () => 0 }); } catch (e) { threw = e; }
  ok(threw && /does not start with 'proto-'/.test(threw.message), `实际: ${threw && threw.message}`);
}

console.log('[test] ④ 余额查询返回 null(两条路径都失败) ⇒ fail-closed throw(不假设余额安全):');
{
  seedRelay({ id: 'relay-good-name-1', name: 'proto-v0-funds-a', address: 'kaspa:qtest2' });
  process.env.PROTO_RELAY_ID = 'relay-good-name-1';
  const { assertProtoRelayHealthy } = await import('./proto-relay-guard.mjs?t=4');
  let threw = null;
  try { await assertProtoRelayHealthy({ getBalanceFn: async () => null }); } catch (e) { threw = e; }
  ok(threw && /could not determine on-chain balance/.test(threw.message), `实际: ${threw && threw.message}`);
}

console.log('[test] ⑤ 余额 >= 5 KAS 上限 ⇒ throw(硬顶, 不是"建议"):');
{
  seedRelay({ id: 'relay-good-name-2', name: 'proto-v0-funds-b', address: 'kaspa:qtest3' });
  process.env.PROTO_RELAY_ID = 'relay-good-name-2';
  const { assertProtoRelayHealthy, PROTO_MAX_BALANCE_KAS } = await import('./proto-relay-guard.mjs?t=5');
  ok(PROTO_MAX_BALANCE_KAS === 5, `PROTO_MAX_BALANCE_KAS 常量 = 5(实际 ${PROTO_MAX_BALANCE_KAS})`);
  let threw = null;
  try { await assertProtoRelayHealthy({ getBalanceFn: async () => 5 }); } catch (e) { threw = e; } // 恰好等于上限, 闭区间外(>=拒)
  ok(threw && /balance 5 KAS >= 5 KAS ceiling/.test(threw.message), `恰好等于上限被拒(实际: ${threw && threw.message})`);
}

console.log('[test] ⑥ 余额 < 5 KAS 且其余条件都满足 ⇒ 通过, 返回正确字段:');
{
  seedRelay({ id: 'relay-good-name-3', name: 'proto-v0-funds-c', address: 'kaspa:qtest4' });
  process.env.PROTO_RELAY_ID = 'relay-good-name-3';
  const { assertProtoRelayHealthy } = await import('./proto-relay-guard.mjs?t=6');
  const r = await assertProtoRelayHealthy({ getBalanceFn: async () => 4.999 });
  ok(r.ok === true, `ok:true(实际 ${JSON.stringify(r)})`);
  ok(r.name === 'proto-v0-funds-c', `name 正确(实际 ${r.name})`);
  ok(r.address === 'kaspa:qtest4', `address 正确(实际 ${r.address})`);
  ok(r.balanceKas === 4.999, `balanceKas 正确(实际 ${r.balanceKas})`);
}

console.log('[test] ⑦ rejectRelayIdInBody: 请求体带 relay_id 字段(任意值, 含 undefined/null)一律拒绝:');
{
  ok(rejectRelayIdInBody({ relay_id: 'anything' }) !== null, '字符串值 → 拒绝');
  ok(rejectRelayIdInBody({ relay_id: undefined }) !== null, 'undefined 值也拒绝(字段存在本身就是信号, 不看值)');
  ok(rejectRelayIdInBody({ relay_id: null }) !== null, 'null 值也拒绝');
  ok(rejectRelayIdInBody({ direction: 0, amount: 5 }) === null, '不含 relay_id 字段 → 放行(null)');
  ok(rejectRelayIdInBody(null) === null, 'body 本身是 null(无请求体) → 放行');
  ok(rejectRelayIdInBody(undefined) === null, 'body 本身是 undefined → 放行');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — PROTO_RELAY_ID 基础设施(启动断言 6 分支 + 请求体拒绝 6 分支) 全绿'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
