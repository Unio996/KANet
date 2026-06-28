// Self-contained offline test: broker-fee-emit.mjs (J2, 2026-06-28)
//
// Verifies the broker_fee_landed emit-pass (Owner 主线·链验金额·幂等·backfill-suppress) against an in-memory
// DB with a stub deriveBrokerAddress. No server, no chain, no relay — independently runnable.
//   node kasia-console/scripts/j2-broker-fee-emit-test.mjs
//
// Asserts (co-verify 门: maker amount 链验·幂等·backfill-suppress·no-broker-output·pending-index):
//   1. backfill-suppress: pre-existing completed market on FIRST run → marked emitted, NO broker_fee_landed event
//   2. new settle w/ broker output indexed → emits broker_fee_landed, fee_sompi == outputs_json (NOT DB estimate)
//   3. idempotent: second run does NOT re-emit (metadata marker)
//   4. no-broker-output: settle TX indexed but no output to broker addr → marked skipped, no event
//   5. pending-index: completed market whose settle_txid NOT in kaspa_tx_log → not emitted, not marked (retry)

import Database from 'better-sqlite3';
import { brokerFeeLandedEmitTick } from '../src/services/broker-fee-emit.mjs';

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE pool_markets (
    id TEXT PRIMARY KEY, protocol_status TEXT, settle_txid TEXT, broker_pk TEXT,
    spine_p2sh TEXT, resolution_rule_spec TEXT, metadata TEXT
  );
  CREATE TABLE kaspa_tx_log ( tx_id TEXT, outputs_json TEXT );
  CREATE TABLE chain_events (
    id TEXT, txid TEXT, event_type TEXT, from_address TEXT, to_address TEXT,
    payload TEXT, observed_by TEXT, observed_at TEXT
  );
`);

// stub deriver: broker_pk → deterministic fake address (so outputs_json can be matched/mismatched on purpose).
const ADDR = (pk) => 'kaspatest:broker_' + pk;
const deriveBrokerAddress = (pk /*, net */) => ADDR(pk);
const log = () => {};

const insMarket = (id, status, settleTxid, brokerPk, extra = {}) =>
  db.prepare(`INSERT INTO pool_markets (id, protocol_status, settle_txid, broker_pk, spine_p2sh, resolution_rule_spec, metadata)
              VALUES (?,?,?,?,?,?,?)`).run(
    id, status, settleTxid, brokerPk, 'kaspatest:spine_' + id,
    JSON.stringify({ title: 'Market ' + id }), extra.metadata || null);
const insTx = (txid, outs) => db.prepare('INSERT INTO kaspa_tx_log (tx_id, outputs_json) VALUES (?,?)').run(txid, JSON.stringify(outs));
const events = () => db.prepare("SELECT * FROM chain_events WHERE event_type='broker_fee_landed'").all();
const marker = (id) => { try { return JSON.parse(db.prepare('SELECT metadata FROM pool_markets WHERE id=?').get(id).metadata || '{}').broker_fee_landed_emitted_at; } catch { return undefined; } };

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); } };

// ── Pre-existing completed market (settled BEFORE emit-pass existed) — must be backfill-suppressed on first run.
insMarket('pre_existing', 'completed', 'tx_pre', 'pkPRE');
insTx('tx_pre', [{ address: ADDR('pkPRE'), amount_sompi: 500000000 }]);  // has broker output, but pre-existing → suppress

console.log('[j2-broker-fee-emit-test]');

// ── Run 1: triggers one-time backfill-suppress. Pre-existing market should be marked, NOT emitted.
const r1 = brokerFeeLandedEmitTick(db, deriveBrokerAddress, log);
check('1a backfill-suppress marked >=1 pre-existing', r1.backfillSuppressed >= 1);
check('1b pre-existing has emit marker (suppressed)', !!marker('pre_existing'));
check('1c NO broker_fee_landed event from backfill (suppressed, no DM)', events().length === 0);

// ── Now a NEW settle lands (post-deploy). Add after backfill so it is NOT suppressed.
insMarket('new_settle', 'completed', 'tx_new', 'pkNEW');
insTx('tx_new', [
  { address: 'kaspatest:winner1', amount_sompi: 1900000000 },
  { address: ADDR('pkNEW'), amount_sompi: 320000000 },   // broker fee = secondary output (multiout) = 3.2 KAS
]);
// ── No-broker-output market: settle TX indexed but broker not among outputs.
insMarket('no_broker_out', 'completed', 'tx_nbo', 'pkNBO');
insTx('tx_nbo', [{ address: 'kaspatest:winnerX', amount_sompi: 1000000000 }]);  // no broker addr
// ── Pending-index market: settle_txid NOT in kaspa_tx_log yet.
insMarket('pending_idx', 'completed', 'tx_missing', 'pkPND');  // tx_missing not inserted

// ── Run 2: should emit ONLY for new_settle (chain-verified amount), skip no_broker_out (marked), defer pending_idx.
const r2 = brokerFeeLandedEmitTick(db, deriveBrokerAddress, log);
const ev = events();
check('2a emitted exactly 1 (new_settle only)', r2.emitted === 1 && ev.length === 1);
const payload = ev.length ? JSON.parse(ev[0].payload) : {};
check('2b fee_sompi == outputs_json broker amount (320000000·链验·非DB估)', payload.fee_sompi === 320000000);
check('2c output_index = 1 (secondary output·按地址匹配非位置)', payload.output_index === 1);
check('2d event to_address = broker address', ev.length && ev[0].to_address === ADDR('pkNEW'));
check('2e backfill did NOT run again (sentinel)', r2.backfillSuppressed === 0);
check('2f no_broker_out marked skipped (won\'t rescan)', !!marker('no_broker_out'));
check('2g no_broker_out emitted no event', !ev.some(e => JSON.parse(e.payload).market_id === 'no_broker_out'));
check('2h pending_idx NOT marked (will retry when indexed)', marker('pending_idx') === undefined);
check('2i pending_idx counted pendingIndex', r2.pendingIndex >= 1);

// ── Run 3: idempotent — new_settle already emitted, no re-emit. pending_idx still pending.
const r3 = brokerFeeLandedEmitTick(db, deriveBrokerAddress, log);
check('3a idempotent: no new emit (new_settle already marked)', r3.emitted === 0 && events().length === 1);

// ── Run 4: pending_idx settle TX finally indexed → now emits.
insTx('tx_missing', [{ address: ADDR('pkPND'), amount_sompi: 150000000 }]);
const r4 = brokerFeeLandedEmitTick(db, deriveBrokerAddress, log);
check('4a pending_idx emits once indexed', r4.emitted === 1 && events().length === 2);
check('4b pending_idx fee_sompi chain-verified (150000000)', events().some(e => JSON.parse(e.payload).market_id === 'pending_idx' && JSON.parse(e.payload).fee_sompi === 150000000));

console.log(`\n[j2-broker-fee-emit-test] ${pass} PASS / ${fail} FAIL`);
db.close();
process.exit(fail ? 1 : 0);
