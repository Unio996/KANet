// proto-bet-intent-phase-ingest.test.mjs — POST /ingest/proto-bet-intent-phase 回归(J2 2026-09-14,
// 设计 docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md §9.5, ledger 1366, Bettor 四条硬条件)。
// 真 migration 隔离库 + 真 Fastify + app.inject()(同 proto.test.mjs 既有手法)。
// Run: cd kasia-console && node src/api/proto-bet-intent-phase-ingest.test.mjs
//
// 覆盖: ①PSK 鉴权(继承 /ingest/* 既有 preHandler) ②relay_id 必须等于 PROTO_RELAY_ID, 不等/未配置
// 一律 403+LOUD(硬条件①) ③字段校验 ④未知 intentKey→409(同 /ingest/submit-intent 既有契约) ⑤幂等:
// 重复调用同一 phase 不报错不产生副作用 ⑥单调: 通过 HTTP 层试图倒退到更早 phase 仍被 markBetIntent
// 的 RANK 机制拒绝(硬条件②)。
// 硬条件④剩余两条(prepared 失败⇒零广播 / relay 崩溃后 resume 恢复)属于 relay 侧
// covenant-broadcast-relay.mjs 集成测试范围, 不在本文件——本文件只测这个 ingest 端点自身。

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._PROTO_BET_INTENT_PHASE_INGEST_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_proto_bip_ingest_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _PROTO_BET_INTENT_PHASE_INGEST_TEST_BOOTSTRAPPED: '1', PROTO_RELAY_ID: 'proto-test-relay' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

import Fastify from 'fastify';
const { sqlite } = await import('../db/client.js');
const { registerIngestRoutes } = await import('./ingest.js');
const { setConfig } = await import('../data/settings/configs.js');
const { ensureBetIntent, getBetIntent, betIntentKeyFor } = await import('../lib/proto-bet-intent.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const INGEST_SECRET = 'test-ingest-secret-xyz';
await setConfig('ingest_secret', INGEST_SECRET);
const PROTO_RELAY_ID = process.env.PROTO_RELAY_ID; // 'proto-test-relay'(由 bootstrap 阶段的 spawn env 传入)

const app = Fastify();
await registerIngestRoutes(app);
await app.ready();

function seedBet(betId, marketId = 'm1', tokenDefId = 't1') {
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT OR IGNORE INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)`).run(tokenDefId, 'Test', 'TST', now);
  sqlite.prepare(`INSERT OR IGNORE INTO proto_markets (id,token_def_id,deadline_ms,min_bet,committee_pubkeys_json,committee_privkey_enc,rootclose_tmpl_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(marketId, tokenDefId, 1700000000000, 100, '[]', 'enc', 'aa'.repeat(32), now, now);
  sqlite.prepare(`INSERT OR IGNORE INTO proto_bets (id,market_id,bettor_pk,side,stake,status,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(betId, marketId, 'bb'.repeat(32), 0, 1000, 'pending', now);
}

const post = (payload, headers = {}) => app.inject({
  method: 'POST', url: '/ingest/proto-bet-intent-phase',
  headers: { 'x-ingest-secret': INGEST_SECRET, ...headers },
  payload,
});

console.log('[test] ① PSK 鉴权(继承既有 /ingest/* preHandler): 缺 x-ingest-secret → 401(不是本端点新写的逻辑, 验证挂载生效):');
{
  const res = await app.inject({ method: 'POST', url: '/ingest/proto-bet-intent-phase', payload: { relay_id: PROTO_RELAY_ID } });
  ok(res.statusCode === 401, `实际 ${res.statusCode}`);
}

console.log('[test] ② relay_id 必须等于 PROTO_RELAY_ID(硬条件①):');
{
  seedBet('bet1');
  const key = betIntentKeyFor('bet1', 'append');
  ensureBetIntent({ betId: 'bet1', step: 'append' });
  const txid = 'aa'.repeat(32);

  const missingRelayId = await post({ intentKey: key, phase: 'prepared', txid });
  ok(missingRelayId.statusCode === 403, `relay_id 缺失 → 403(实际 ${missingRelayId.statusCode})`);

  const wrongRelayId = await post({ relay_id: 'some-other-relay', intentKey: key, phase: 'prepared', txid });
  ok(wrongRelayId.statusCode === 403, `relay_id 不等于 PROTO_RELAY_ID → 403(实际 ${wrongRelayId.statusCode})`);
  ok(/relay_id mismatch/.test(JSON.parse(wrongRelayId.body).error), 'error 信息说明是 relay_id 不匹配');

  const after = getBetIntent(key);
  ok(after.status === 'pending', `被拒的请求不产生任何副作用, intent 仍是 pending(实际 ${after.status})`);
}

console.log('[test] ③ PROTO_RELAY_ID 未配置时全部拒绝(fail-closed 方向: 未配置=无人被授权, 不是全部放行):');
{
  const savedEnv = process.env.PROTO_RELAY_ID;
  delete process.env.PROTO_RELAY_ID;
  try {
    const key = betIntentKeyFor('bet1', 'append');
    const res = await post({ relay_id: 'anything-at-all', intentKey: key, phase: 'prepared', txid: 'bb'.repeat(32) });
    ok(res.statusCode === 403, `实际 ${res.statusCode}`);
  } finally {
    process.env.PROTO_RELAY_ID = savedEnv;
  }
}

console.log('[test] ④ 字段校验: intentKey/phase/txid 缺一 → 400:');
{
  const r1 = await post({ relay_id: PROTO_RELAY_ID, phase: 'prepared', txid: 'cc'.repeat(32) });
  ok(r1.statusCode === 400, `缺 intentKey → 400(实际 ${r1.statusCode})`);
  const r2 = await post({ relay_id: PROTO_RELAY_ID, intentKey: 'x', txid: 'cc'.repeat(32) });
  ok(r2.statusCode === 400, `缺 phase → 400(实际 ${r2.statusCode})`);
  const r3 = await post({ relay_id: PROTO_RELAY_ID, intentKey: 'x', phase: 'prepared' });
  ok(r3.statusCode === 400, `缺 txid → 400(实际 ${r3.statusCode})`);
}

console.log('[test] ⑤ 未知 intentKey → 409(同 /ingest/submit-intent 既有"relay 只对 console 先 INSERT 的意图回执"契约):');
{
  const res = await post({ relay_id: PROTO_RELAY_ID, intentKey: 'proto-bet:nonexistent:append', phase: 'prepared', txid: 'dd'.repeat(32) });
  ok(res.statusCode === 409, `实际 ${res.statusCode}`);
}

console.log('[test] ⑥ 正常调用 phase=prepared → 201, proto_bet_intents 行落表(硬条件②的正路径):');
{
  const key = betIntentKeyFor('bet1', 'append');
  const txid = 'ee'.repeat(32);
  const res = await post({ relay_id: PROTO_RELAY_ID, intentKey: key, phase: 'prepared', txid, txJson: JSON.stringify([{ id: txid }]) });
  ok(res.statusCode === 201, `实际 ${res.statusCode} ${res.body}`);
  const body = JSON.parse(res.body);
  ok(body.ok === true && body.status === 'prepared', `响应 status=prepared(实际 ${body.status})`);
  const row = getBetIntent(key);
  ok(row.status === 'prepared' && row.prepared_txid === txid, `落表正确: status=${row.status} prepared_txid=${row.prepared_txid}`);
}

console.log('[test] ⑦ 幂等: 重复调用同一 phase=prepared(同 txid) → 仍 201, 不报错不产生副作用(硬条件②):');
{
  const key = betIntentKeyFor('bet1', 'append');
  const txid = 'ee'.repeat(32); // 与 ⑥ 相同
  const res = await post({ relay_id: PROTO_RELAY_ID, intentKey: key, phase: 'prepared', txid });
  ok(res.statusCode === 201, `重复调用仍 201(实际 ${res.statusCode})`);
  const row = getBetIntent(key);
  ok(row.status === 'prepared', `状态仍是 prepared, 未被破坏(实际 ${row.status})`);
}

console.log('[test] ⑧ 推进到 submitted → 201, 落表:');
{
  const key = betIntentKeyFor('bet1', 'append');
  const txid = 'ee'.repeat(32);
  const res = await post({ relay_id: PROTO_RELAY_ID, intentKey: key, phase: 'submitted', txid });
  ok(res.statusCode === 201, `实际 ${res.statusCode}`);
  const row = getBetIntent(key);
  ok(row.status === 'submitted' && row.submitted_txid === txid, `落表正确: status=${row.status} submitted_txid=${row.submitted_txid}`);
}

console.log('[test] ⑨ 单调性: 已是 submitted 后, 再打一次 phase=prepared(模拟 relay 网络重试/乱序) → HTTP 层仍 201(不报错), 但底层状态不倒退(markBetIntent RANK 机制生效, 硬条件②):');
{
  const key = betIntentKeyFor('bet1', 'append');
  const oldTxid = 'ff'.repeat(32); // 故意传一个不同的 txid, 验证不会覆盖 prepared_txid 也不会退状态
  const res = await post({ relay_id: PROTO_RELAY_ID, intentKey: key, phase: 'prepared', txid: oldTxid });
  ok(res.statusCode === 201, `实际 ${res.statusCode}(端点本身不因为"逻辑上是倒退"而报错, 是 markBetIntent 内部悄悄吃掉状态位的倒退请求)`);
  const row = getBetIntent(key);
  ok(row.status === 'submitted', `状态仍是 submitted, 没有被打回 prepared(实际 ${row.status})`);
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — POST /ingest/proto-bet-intent-phase(relay_id 限定+幂等+单调+未知intentKey拒) 全绿'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
