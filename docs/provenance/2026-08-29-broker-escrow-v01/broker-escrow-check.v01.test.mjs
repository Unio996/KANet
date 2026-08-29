// offline: 真 schema (runMigrations 到 temp DB) + 候选三态; 不碰 live。跑法: cd kasia-console && node ../scratch/_j2_broker_escrow/broker-escrow-check.v01.test.mjs
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'escrow-'));
process.env.DB_PATH = join(dir, 't.db');
// 仓根自寻 (scratch/_x/ 与 docs/provenance/x/ 深度不同); 经生产 db/client.js + migrate.js 取真 schema (M0a: 无裸 sqlite import)
let repo = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(repo, 'kasia-console', 'package.json'))) { const up = dirname(repo); if (up === repo) throw new Error('repo root not found'); repo = up; }
const { sqlite: db } = await import(pathToFileURL(join(repo, 'kasia-console', 'src', 'db', 'client.js')).href);
const { runMigrations } = await import(pathToFileURL(join(repo, 'kasia-console', 'src', 'db', 'migrate.js')).href);
await runMigrations();
const { checkBrokerEscrowV2, checkBrokerEscrowCompat, resolveBrokerKasAddr, ESCROW } = await import('./broker-escrow-check.v01.mjs');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const NOW = Date.parse('2026-08-29T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const TN_ADDR = 'kaspatest:qq' + 'a'.repeat(59), MAIN_ADDR = 'kaspa:qq' + 'b'.repeat(59), PEER = 'kaspatest:qq' + 'c'.repeat(59);
const RELAY_ID = 'broker-relay-1';
// relay_nodes 有多列 NOT NULL: 只填测试需要的 + 用 PRAGMA table_info 自动给其余 NOT NULL 无默认列塞占位 (真 schema, 不猜列名)
{
  const cols = db.prepare(`PRAGMA table_info(relay_nodes)`).all();
  const want = { id: RELAY_ID, name: 'broker', address: TN_ADDR, created_at: iso(NOW - 86400e3), updated_at: iso(NOW - 86400e3) };
  for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in want)) want[c.name] = c.type === 'INTEGER' ? 0 : 'x';
  const names = Object.keys(want);
  db.prepare(`INSERT INTO relay_nodes (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((n) => want[n]));
}
const hb = (ageMs) => db.prepare(`INSERT INTO spc_tip_heartbeat (id, daa_score, updated_at) VALUES (1, 1, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`).run(iso(NOW - ageMs));
const inbound = (addr, amount, atMs) => db.prepare(`INSERT INTO kaspa_tx_log (tx_id, to_address, amount, observed_at, network) VALUES (?, ?, ?, ?, 'testnet-12')`).run('t'.repeat(40) + String(Math.random()).slice(2, 26), addr, amount, iso(atMs));
const ORDER_AT = iso(NOW - 3600e3);
const base = { db, peerAddr: PEER, qty: 10, orderCreatedAt: ORDER_AT, nowMs: NOW };
const envTN = { KASPA_NETWORK: 'testnet-12', BROKER_RELAY_ID: RELAY_ID };

// V1 (今天的生产形): 主网硬编地址 + TN12 ⇒ UNKNOWN (不是 false/NOT_PAID)
t('V1 主网地址配置在 TN12 ⇒ UNKNOWN(network_prefix_mismatch), compat=true(不 force-fail)', () => {
  const r = checkBrokerEscrowV2({ ...base, env: { KASPA_NETWORK: 'testnet-12', BROKER_KAS_ADDR: MAIN_ADDR } });
  assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.ok(/network_prefix_mismatch/.test(r.reason), r.reason);
  assert.strictEqual(checkBrokerEscrowCompat({ ...base, env: { KASPA_NETWORK: 'testnet-12', BROKER_KAS_ADDR: MAIN_ADDR } }), true);
});
t('V2 地址未配置 ⇒ UNKNOWN(broker_addr_unconfigured)', () => { const r = checkBrokerEscrowV2({ ...base, env: { KASPA_NETWORK: 'testnet-12' } }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.strictEqual(r.reason, 'broker_addr_unconfigured'); });
t('V3 地址经 relay_nodes(BROKER_RELAY_ID) 解析且前缀对', () => { const r = resolveBrokerKasAddr({ env: envTN, db }); assert.ok(r.ok, r.reason); assert.strictEqual(r.addr, TN_ADDR); assert.strictEqual(r.source, 'relay_nodes:BROKER_RELAY_ID'); });
// V4: 零行 + 索引心跳陈 ⇒ UNKNOWN (不得 no_escrow)
hb(20 * 60e3);
t('V4 零匹配行 + 索引心跳陈 20min ⇒ UNKNOWN(indexer_heartbeat_stale)', () => { const r = checkBrokerEscrowV2({ ...base, env: envTN }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.ok(/indexer_heartbeat_stale/.test(r.reason), r.reason); });
// V5: 零行 + 心跳新鲜 + relay 早于订单 ⇒ NOT_PAID (coverage-attested absence)
hb(30e3);
t('V5 零匹配行 + 心跳 30s + broker relay 早于订单 ⇒ NOT_PAID(coverage_attested_absence), compat=false', () => { const r = checkBrokerEscrowV2({ ...base, env: envTN }); assert.strictEqual(r.verdict, ESCROW.NOT_PAID); assert.strictEqual(checkBrokerEscrowCompat({ ...base, env: envTN }), false); });
t('V6 无心跳行 ⇒ UNKNOWN(no_indexer_heartbeat)', () => { db.prepare(`DELETE FROM spc_tip_heartbeat`).run(); const r = checkBrokerEscrowV2({ ...base, env: envTN }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.strictEqual(r.reason, 'no_indexer_heartbeat'); hb(30e3); });
// V7: 有匹配入金 ⇒ ESCROWED (不管心跳)
inbound(TN_ADDR, 10.2, NOW - 1800e3);
t('V7 索引里有 peer→broker 10.2 KAS(±0.5) ⇒ ESCROWED', () => { const r = checkBrokerEscrowV2({ ...base, env: envTN }); assert.strictEqual(r.verdict, ESCROW.ESCROWED); assert.strictEqual(r.reason, 'indexed_inbound_match'); });
t('V8 入金早于订单窗 ⇒ 不算 (observed_at >= created_at 原样)', () => { inbound(TN_ADDR, 20, NOW - 7200e3); const r = checkBrokerEscrowV2({ ...base, qty: 20, env: envTN }); assert.notStrictEqual(r.verdict, ESCROW.ESCROWED); });
t('V9 金额不在 ±0.5 ⇒ 不算入金 (qty=30 vs 10.2)', () => { const r = checkBrokerEscrowV2({ ...base, qty: 30, env: envTN }); assert.notStrictEqual(r.verdict, ESCROW.ESCROWED); });
// V10: 主网地址行存在于 kaspa_tx_log 也救不了错配置 (地址解析先于查询)
inbound(MAIN_ADDR, 10, NOW - 600e3);
t('V10 错网地址即使有行也 UNKNOWN(先校验配置, 不进查询)', () => { const r = checkBrokerEscrowV2({ ...base, env: { KASPA_NETWORK: 'testnet-12', BROKER_KAS_ADDR: MAIN_ADDR } }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.strictEqual(r.evidence.inbound, undefined); });
// V11: rpc 第三源命中 ⇒ ESCROWED 覆盖索引零行; 抛 ⇒ UNKNOWN
t('V11 rpcUtxoLookup 命中 ⇒ ESCROWED(rpc_utxo_match); 抛 ⇒ UNKNOWN', () => {
  const r1 = checkBrokerEscrowV2({ ...base, qty: 55, env: envTN, rpcUtxoLookup: () => [{ amountKas: 55.3 }] }); assert.strictEqual(r1.verdict, ESCROW.ESCROWED);
  const r2 = checkBrokerEscrowV2({ ...base, qty: 55, env: envTN, rpcUtxoLookup: () => { throw new Error('rpc down'); } }); assert.strictEqual(r2.verdict, ESCROW.UNKNOWN);
});
t('V12 broker relay 晚于订单创建 ⇒ UNKNOWN(broker_watched_after_order)', () => {
  db.prepare(`UPDATE relay_nodes SET created_at = ? WHERE id = ?`).run(iso(NOW - 60e3), RELAY_ID);
  const r = checkBrokerEscrowV2({ ...base, qty: 77, env: envTN }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.strictEqual(r.reason, 'broker_watched_after_order');
  db.prepare(`UPDATE relay_nodes SET created_at = ? WHERE id = ?`).run(iso(NOW - 86400e3), RELAY_ID);
});
t('V13 qty 非法 ⇒ UNKNOWN(bad_qty)', () => { const r = checkBrokerEscrowV2({ ...base, qty: 'x', env: envTN }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); });

db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`broker-escrow-check v01: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
