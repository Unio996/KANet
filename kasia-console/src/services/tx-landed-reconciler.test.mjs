// tx-landed-reconciler.test.mjs — (c) F3 对账器 离线向量 (J2 2026-09-13, 设计 v0.3 §4 F3-正/反/弱注入 + intents)。
// 真 migration 临时库 + 假 chain reader(kaspa_tx_log 是真表); 零链。
// Run: cd kasia-console && node src/services/tx-landed-reconciler.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._RECON_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_recon_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _RECON_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: 'mainnet' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { reconcileTxRecords, reconcileIntents } = await import('./tx-landed-reconciler.mjs');
const { ensureIntent, recordIntentPhase, getIntent, intentKeyFor } = await import('../lib/submit-intent.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const ago = (min) => new Date(Date.now() - min * 60 * 1000).toISOString();
const ev = (t) => sqlite.prepare('SELECT count(*) AS n FROM events WHERE event_type = ?').get(t).n;
function tx(id, { ageMin, target = 'kaspa:qt', network = 'mainnet' }) {
  sqlite.prepare(`INSERT INTO tx_records (id, trace_id, direction, network, txid, status, target_address, created_at, updated_at) VALUES (?, ?, 'outbound', ?, ?, 'broadcasted', ?, ?, ?)`)
    .run(id, `t:${id}`, network, id.padEnd(64, '0'), target, ago(ageMin), ago(ageMin));
  return id.padEnd(64, '0');
}
const row = (id) => sqlite.prepare('SELECT * FROM tx_records WHERE id = ?').get(id);
const reader = {
  virtual: 10_000, blockDaas: {}, utxos: {}, mempool: new Set(),
  async virtualDaa() { return this.virtual; },
  async blockDaa(h) { return this.blockDaas[h] ?? null; },
  async utxoOutpointDaa(addr, txid) { const d = this.utxos[`${addr}|${txid}`]; return d === undefined ? null : { found: true, daa: d }; },
  async inMempool(txid) { return this.mempool.has(txid); },
};

// F3-正: kaspa_tx_log 命中 → landed_at = block_time, depth = virtual − blockDaa
{ const t = tx('a1', { ageMin: 15 });
  sqlite.prepare(`INSERT INTO kaspa_tx_log (tx_id, block_hash, block_time, to_address, amount, observed_at, network) VALUES (?, 'h1', 1700000000, 'kaspa:qt', 1, ?, 'mainnet')`).run(t, ago(14));
  reader.blockDaas.h1 = 9_950;
  const r = await reconcileTxRecords({ reader });
  ok(r.landed === 1 && row('a1').landed_depth === 50 && row('a1').landed_at === new Date(1700000000 * 1000).toISOString(), 'F3-正: 索引器命中 → landed_at/depth 回写'); }
// F3-正 b: UTXO 集命中
{ const t = tx('a2', { ageMin: 15 }); reader.utxos[`kaspa:qt|${t}`] = 9_900;
  const r = await reconcileTxRecords({ reader });
  ok(r.landed === 1 && row('a2').landed_depth === 100, 'F3-正 b: 收款地址 UTXO 集命中 → depth 100'); }
// F3-反: 三源无 age 15 → tx_not_landed 1 行; 再跑限频不再加; landed_checked_at 更新
{ tx('a3', { ageMin: 15 });
  const r = await reconcileTxRecords({ reader });
  const r2 = await reconcileTxRecords({ reader });
  ok(r.notLanded === 1 && r2.notLanded === 1 && ev('tx_not_landed') === 1 && row('a3').landed_checked_at && row('a3').landed_at === null, 'F3-反: 三源无 → 告警恰 1 行(限频), status 不改'); }
// F3-弱注入: age 9 min → 不扫; mempool 有 → 不告警
{ tx('a4', { ageMin: 9 }); const t5 = tx('a5', { ageMin: 15 }); reader.mempool.add(t5);
  const r = await reconcileTxRecords({ reader });
  ok(r.scanned === 2 && r.inMempool === 1 && ev('tx_not_landed') === 1 && row('a4').landed_checked_at === null, 'F3-弱注入: 9 min 不扫; mempool 中的不告警'); }
// 无 target_address 老行: 只靠索引器, 计 noTarget
{ sqlite.prepare(`INSERT INTO tx_records (id, trace_id, direction, network, txid, status, created_at, updated_at) VALUES ('a6', 't', 'outbound', 'mainnet', ?, 'broadcasted', ?, ?)`).run('a6'.padEnd(64, '0'), ago(20), ago(20));
  const r = await reconcileTxRecords({ reader });
  ok(r.noTarget === 1, '老行无 target_address → noTarget 计数(不当"没落链"证据)'); }
// intents: submitted 31 min + UTXO 落 → landed; submitted 31 min 无 → intent_not_landed; prepared 3 min → intent_prepared_stale
{ ensureIntent({ intentKind: 'payout', offerId: 'i1', relayId: 'r', targetAddress: 'kaspa:qt', amountKas: '1' });
  recordIntentPhase({ intentKey: intentKeyFor('payout', 'i1'), phase: 'submitted', txid: 'i1'.padEnd(64, '1') });
  ensureIntent({ intentKind: 'taker_stake', offerId: 'i2', relayId: 'r', targetAddress: 'kaspa:qt', amountKas: '1' });
  recordIntentPhase({ intentKey: intentKeyFor('taker_stake', 'i2'), phase: 'submitted', txid: 'i2'.padEnd(64, '2') });
  ensureIntent({ intentKind: 'escrow_lock', offerId: 'i3', relayId: 'r', targetAddress: 'kaspa:qt', amountKas: '1' });
  recordIntentPhase({ intentKey: intentKeyFor('escrow_lock', 'i3'), phase: 'prepared', txid: 'i3'.padEnd(64, '3'), txJson: '["b"]' });
  sqlite.prepare('UPDATE submit_intents SET updated_at = ? WHERE intent_key IN (?, ?)').run(ago(31), intentKeyFor('payout', 'i1'), intentKeyFor('taker_stake', 'i2'));
  sqlite.prepare('UPDATE submit_intents SET updated_at = ? WHERE intent_key = ?').run(ago(3), intentKeyFor('escrow_lock', 'i3'));
  reader.utxos[`kaspa:qt|${'i1'.padEnd(64, '1')}`] = 9_990;
  const r = await reconcileIntents({ reader });
  ok(r.submittedScanned === 2 && r.landed === 1 && r.notLanded === 1 && r.preparedStale === 1 && getIntent(intentKeyFor('payout', 'i1')).status === 'landed' && getIntent(intentKeyFor('payout', 'i1')).landed_depth === 10 && ev('intent_not_landed') === 1 && ev('intent_prepared_stale') === 1, `intents: landed 回写 / not_landed 告警 / prepared_stale 告警 (${JSON.stringify(r)})`);
  const r2 = await reconcileIntents({ reader });
  ok(ev('intent_not_landed') === 1 && ev('intent_prepared_stale') === 1 && r2.landed === 0, 'intents: 第二次限频不重复告警'); }
// harness 翻转臂
{ const before = fails; ok(ev('tx_not_landed') === 99, 'harness-flip (expect FAIL)'); if (fails === before + 1) { fails--; console.log('  ✅ harness flip arm went red as required'); } else { fails++; } }

console.log(fails ? `\n❌ ${fails} failure(s)` : '\n✅ all reconciler vectors passed');
process.exit(fails ? 1 : 0);
