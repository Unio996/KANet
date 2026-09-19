// ingest-settle-dispatch.test.mjs — /ingest/proto-bet-intent-phase 端点新增的 'settle:' 前缀
// 分派分支端到端冒烟(J2 2026-09-16, 实现计划v0.2 §5/§7批2)。真 fastify 实例 + 真 migration 临时库,
// 验证整条链路(PSK鉴权→intentKey前缀分派→recordSettlementIntentPhase→proto_settlement_intents落库)
// 不只是单测里绕过HTTP层直接调函数——同proto-bet-intent.test.mjs"零链零IPC但真状态机"的精神，这里
// 补的是"真HTTP路由分派没有接错线"这一层，两者互补不重复。
// Run: cd kasia-console && node src/api/ingest-settle-dispatch.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._INGEST_SETTLE_DISPATCH_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_ingest_settle_dispatch_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _INGEST_SETTLE_DISPATCH_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: 'mainnet', PROTO_RELAY_ID: 'relay-test-A', CONSOLE_ENCRYPTION_KEY: 'a'.repeat(64) },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const Fastify = (await import('fastify')).default;
const { sqlite } = await import('../db/client.js');
const { setConfig } = await import('../data/settings/configs.js');
const { registerIngestRoutes } = await import('./ingest.js');
const { ensureSettlementIntent, getSettlementIntent, settlementIntentKeyFor } = await import('../lib/proto-settlement-intent.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}: ${JSON.stringify(cond)}`); fails++; } };

const SECRET = 'test-ingest-secret-for-settle-dispatch';
await setConfig('ingest_secret', SECRET);

const app = Fastify({ logger: false });
await app.register(registerIngestRoutes);
await app.ready();

function seedMarket(marketId, tokenDefId = 't1') {
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT OR IGNORE INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)`).run(tokenDefId, 'Test', 'TST', now);
  sqlite.prepare(`INSERT OR IGNORE INTO proto_markets (id,token_def_id,deadline_ms,min_bet,committee_pubkeys_json,committee_privkey_enc,rootclose_tmpl_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(marketId, tokenDefId, 1700000000000, 100, '[]', 'enc', 'aa'.repeat(32), now, now);
}

console.log('[test] ① settle: 前缀 prepared 回执 → 正确落进 proto_settlement_intents(不是 proto_bet_intents):');
{
  seedMarket('m1');
  ensureSettlementIntent({ subjectType: 'market', subjectId: 'm1', step: 'seal' });
  const intentKey = settlementIntentKeyFor('market', 'm1', 'seal');
  const txid = 'aa11bb22'.repeat(8);
  const res = await app.inject({
    method: 'POST', url: '/ingest/proto-bet-intent-phase',
    headers: { 'x-ingest-secret': SECRET, 'content-type': 'application/json' },
    payload: { relay_id: 'relay-test-A', intentKey, phase: 'prepared', txid, txJson: JSON.stringify({ id: txid }) },
  });
  ok(res.statusCode === 201, `HTTP 201(实际 ${res.statusCode}, body=${res.body})`);
  const body = JSON.parse(res.body);
  ok(body.ok === true && body.status === 'prepared', `响应体 status=prepared(实际 ${JSON.stringify(body)})`);
  const row = getSettlementIntent(intentKey);
  ok(row?.status === 'prepared' && row?.prepared_txid === txid, `proto_settlement_intents 真的落库(实际 ${JSON.stringify(row)})`);
  const betRow = sqlite.prepare('SELECT 1 FROM proto_bet_intents WHERE intent_key = ?').get(intentKey);
  ok(!betRow, 'settle:前缀的行没有误落进 proto_bet_intents 表');
}

console.log('[test] ② settle: 前缀 submitted 回执 → 状态推进:');
{
  const intentKey = settlementIntentKeyFor('market', 'm1', 'seal');
  const txid = 'aa11bb22'.repeat(8);
  const res = await app.inject({
    method: 'POST', url: '/ingest/proto-bet-intent-phase',
    headers: { 'x-ingest-secret': SECRET, 'content-type': 'application/json' },
    payload: { relay_id: 'relay-test-A', intentKey, phase: 'submitted', txid },
  });
  ok(res.statusCode === 201, `HTTP 201(实际 ${res.statusCode})`);
  const row = getSettlementIntent(intentKey);
  ok(row?.status === 'submitted' && row?.submitted_txid === txid, `状态推进到 submitted(实际 ${JSON.stringify(row)})`);
}

console.log('[test] ③ 未知 intent_key(console 还没 ensureSettlementIntent 建过) → 409, 不静默建行:');
{
  const res = await app.inject({
    method: 'POST', url: '/ingest/proto-bet-intent-phase',
    headers: { 'x-ingest-secret': SECRET, 'content-type': 'application/json' },
    payload: { relay_id: 'relay-test-A', intentKey: 'settle:market:never-seen:seal', phase: 'prepared', txid: 'cc33dd44'.repeat(8) },
  });
  ok(res.statusCode === 409, `未知intentKey返回409(实际 ${res.statusCode})`);
}

console.log('[test] ④ relay_id 不匹配 PROTO_RELAY_ID → 403(既有鉴权逻辑对settle:分支同样生效):');
{
  seedMarket('m2');
  ensureSettlementIntent({ subjectType: 'market', subjectId: 'm2', step: 'seal' });
  const intentKey = settlementIntentKeyFor('market', 'm2', 'seal');
  const res = await app.inject({
    method: 'POST', url: '/ingest/proto-bet-intent-phase',
    headers: { 'x-ingest-secret': SECRET, 'content-type': 'application/json' },
    payload: { relay_id: 'wrong-relay', intentKey, phase: 'prepared', txid: 'ee55ff66'.repeat(8) },
  });
  ok(res.statusCode === 403, `relay_id不匹配返回403(实际 ${res.statusCode})`);
}

await app.close();

console.log(fails === 0
  ? '\n✅✅ ALL PASS — /ingest/proto-bet-intent-phase 的 settle: 前缀分派端到端冒烟 全绿'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
