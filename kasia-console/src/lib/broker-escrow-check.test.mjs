// v0.2 offline: 真 schema temp DB; RPC/coverage 全注入; 不碰 live。跑法: cd kasia-console && node ../scratch/_j2_broker_escrow/broker-escrow-check.v02.test.mjs
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'escrow2-'));
process.env.DB_PATH = join(dir, 't.db');
let repo = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(repo, 'kasia-console', 'package.json'))) { const up = dirname(repo); if (up === repo) throw new Error('repo root not found'); repo = up; }
const { sqlite: db } = await import(pathToFileURL(join(repo, 'kasia-console', 'src', 'db', 'client.js')).href);
const { runMigrations } = await import(pathToFileURL(join(repo, 'kasia-console', 'src', 'db', 'migrate.js')).href);
await runMigrations();
const { checkBrokerEscrowV2, decideReconcileAction, ESCROW, RECONCILE_MODE } = await import('./broker-escrow-check.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const NOW = Date.parse('2026-08-29T10:00:00.000Z'); const iso = (ms) => new Date(ms).toISOString();
const TN_ADDR = 'kaspatest:qq' + 'a'.repeat(59), MAIN_ADDR = 'kaspa:qq' + 'b'.repeat(59), PEER = 'kaspatest:qq' + 'c'.repeat(59);
const hb = (ageMs) => db.prepare(`INSERT INTO spc_tip_heartbeat (id, daa_score, updated_at) VALUES (1, 1, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`).run(iso(NOW - ageMs));
const inbound = (addr, amount, atMs) => db.prepare(`INSERT INTO kaspa_tx_log (tx_id, to_address, amount, observed_at, network) VALUES (?, ?, ?, ?, 'testnet-12')`).run('t'.repeat(40) + String(Math.random()).slice(2, 26), addr, amount, iso(atMs));
const ORDER_AT = iso(NOW - 3600e3);
const env = { KASPA_NETWORK: 'testnet-12', BROKER_KAS_ADDR: TN_ADDR };
const rpcNone = () => [];
const covOk = () => ({ covered: true, holes: [] });
const covHole = () => ({ covered: false, holes: [{ start_daa: 1, end_daa: 2 }] });
const base = { db, peerAddr: PEER, qty: 10, orderCreatedAt: ORDER_AT, nowMs: NOW, env };
hb(30e3);

t('V1 生产形(主网地址+TN12) ⇒ UNKNOWN(network_prefix_mismatch), 即使 RPC/coverage 都给', () => { const r = checkBrokerEscrowV2({ ...base, env: { KASPA_NETWORK: 'testnet-12', BROKER_KAS_ADDR: MAIN_ADDR }, rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.ok(/network_prefix_mismatch/.test(r.reason)); });
t('V2 全条件齐: 零行 + RPC 成功 no-match + 心跳新 + coverage 无洞 ⇒ NOT_PAID', () => { const r = checkBrokerEscrowV2({ ...base, rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.verdict, ESCROW.NOT_PAID); assert.strictEqual(r.reason, 'coverage_attested_absence+rpc_no_match'); });
t('V3 RPC 缺(未注入) ⇒ UNKNOWN(rpc_lookup_unavailable) — MUST①', () => { const r = checkBrokerEscrowV2({ ...base, indexerCoverage: covOk }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.strictEqual(r.reason, 'rpc_lookup_unavailable'); });
t('V4 RPC 抛 ⇒ UNKNOWN(rpc_lookup_fail) — MUST①', () => { const r = checkBrokerEscrowV2({ ...base, rpcUtxoLookup: () => { throw new Error('rpc down'); }, indexerCoverage: covOk }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.ok(/rpc_lookup_fail/.test(r.reason)); });
t('V5 RPC 劣化(返回非数组) ⇒ UNKNOWN — MUST①', () => { const r = checkBrokerEscrowV2({ ...base, rpcUtxoLookup: () => null, indexerCoverage: covOk }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.ok(/degraded/.test(r.reason)); });
t('V6 RPC 命中 ⇒ ESCROWED(rpc_utxo_match), 不看 coverage', () => { const r = checkBrokerEscrowV2({ ...base, rpcUtxoLookup: () => [{ amountKas: 10.3 }], indexerCoverage: covHole }); assert.strictEqual(r.verdict, ESCROW.ESCROWED); });
t('V7 coverage 账缺(未注入) ⇒ UNKNOWN(coverage_ledger_unavailable) — 过渡形, 依赖 L2 期 1', () => { const r = checkBrokerEscrowV2({ ...base, rpcUtxoLookup: rpcNone }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.ok(/coverage_ledger_unavailable/.test(r.reason)); });
t('V8 coverage 有洞 ⇒ UNKNOWN(coverage_holes) — MUST②', () => { const r = checkBrokerEscrowV2({ ...base, rpcUtxoLookup: rpcNone, indexerCoverage: covHole }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.strictEqual(r.reason, 'coverage_holes'); });
t('V9 coverage 抛 ⇒ UNKNOWN', () => { const r = checkBrokerEscrowV2({ ...base, rpcUtxoLookup: rpcNone, indexerCoverage: () => { throw new Error('ledger locked'); } }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); });
t('V10 心跳陈 ⇒ UNKNOWN 即使 coverage 说无洞 (必要非充分, MUST③)', () => { hb(20 * 60e3); const r = checkBrokerEscrowV2({ ...base, rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.ok(/indexer_heartbeat_stale/.test(r.reason)); hb(30e3); });
t('V11 索引入金命中 ⇒ ESCROWED, 不调 RPC', () => { inbound(TN_ADDR, 10.1, NOW - 1800e3); let called = 0; const r = checkBrokerEscrowV2({ ...base, rpcUtxoLookup: () => { called++; return []; }, indexerCoverage: covOk }); assert.strictEqual(r.verdict, ESCROW.ESCROWED); assert.strictEqual(called, 0); });
t('V12 顺序: 配置校验先于一切 (错网 + 有行 + RPC 命中 仍 UNKNOWN)', () => { const r = checkBrokerEscrowV2({ ...base, env: { KASPA_NETWORK: 'testnet-12', BROKER_KAS_ADDR: MAIN_ADDR }, rpcUtxoLookup: () => [{ amountKas: 10 }], indexerCoverage: covOk }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.strictEqual(r.evidence.inbound, undefined); });
// 选项 A/B 决策 (NWT ④)
t('D1 NOT_PAID + 选项 B(默认) ⇒ held_for_review(可逆, 无 no_escrow)', () => { const d = decideReconcileAction(ESCROW.NOT_PAID); assert.deepStrictEqual(d, { action: 'transition', toState: 'held_for_review', opts: { reason: 'reconcile_no_escrow_review', reversible: true } }); });
t('D2 NOT_PAID + 选项 A ⇒ failed + no_escrow(今天的终态)', () => { const d = decideReconcileAction(ESCROW.NOT_PAID, RECONCILE_MODE.A_FAILED); assert.strictEqual(d.toState, 'failed'); assert.strictEqual(d.opts.no_escrow, true); });
t('D3 UNKNOWN ⇒ alert_once, 不 transition; ESCROWED ⇒ none', () => { assert.strictEqual(decideReconcileAction(ESCROW.UNKNOWN).action, 'alert_once'); assert.strictEqual(decideReconcileAction(ESCROW.ESCROWED).action, 'none'); });
t('D4 未知 mode ⇒ throw(不静默选终态)', () => { assert.throws(() => decideReconcileAction(ESCROW.NOT_PAID, 'whatever'), /unknown mode/); });

db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`broker-escrow-check v02: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
