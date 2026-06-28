// Self-contained offline test: broker-fee-emit.mjs (J2, 2026-06-28)
//
// Verifies the broker_fee_landed emit-pass (Owner 主线·链验金额·幂等·backfill-suppress) against an in-memory
// DB with a stub deriveBrokerAddress. No server, no chain, no relay — independently runnable.
//   node kasia-console/scripts/j2-broker-fee-emit-test.mjs
//
// 🔴 LESSON (2026-06-28·Bettor/J2 live catch): v1 of this test used a MINIMAL chain_events schema WITHOUT the
//   production migrate-v83 trigger `chain_events_txid_format_check` (broker_* events 必 64-hex txid·禁 placeholder)
//   + WITHOUT UNIQUE(txid,event_type). → offline 15/15 PASS 却 live 每 tick FAIL (placeholder txid throw)。
//   FIX: this test now REPLICATES the real chain_events schema (UNIQUE + trigger). 所以它现在会抓 placeholder-txid
//   类 bug。settle_txid 用真 64-hex (broker_fee_landed txid=settle_txid 须过 trigger)。
//
// Asserts: backfill-suppress (sentinel event_type 非 broker_·不撞 trigger) / chain-verified amount / 按地址匹配次级
//   output / 幂等 / no-broker-output / pending-index / broker_fee_landed txid == settle_txid (64-hex·过 trigger)。

import Database from 'better-sqlite3';
import { brokerFeeLandedEmitTick } from '../src/services/broker-fee-emit.mjs';

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE pool_markets (
    id TEXT PRIMARY KEY, protocol_status TEXT, settle_txid TEXT, broker_pk TEXT,
    spine_p2sh TEXT, resolution_rule_spec TEXT, metadata TEXT
  );
  CREATE TABLE kaspa_tx_log ( tx_id TEXT, outputs_json TEXT );
  -- REAL chain_events schema (migrate L1109-1118): UNIQUE(txid,event_type) — 复现生产约束。
  CREATE TABLE chain_events (
    id TEXT PRIMARY KEY, txid TEXT NOT NULL, from_address TEXT, to_address TEXT,
    event_type TEXT NOT NULL, payload TEXT, observed_by TEXT NOT NULL, observed_at TEXT NOT NULL,
    UNIQUE(txid, event_type)
  );
  -- REAL migrate-v83 trigger: broker_* events 必 64-hex txid (禁 placeholder)。v1 test 缺这个 → 漏 live bug。
  CREATE TRIGGER chain_events_txid_format_check
  BEFORE INSERT ON chain_events
  WHEN NEW.event_type LIKE 'broker_%'
  BEGIN
    SELECT RAISE(ABORT, 'chain_events.txid must be 64-hex chain hash for broker_* events (no placeholder allowed)')
    WHERE length(NEW.txid) != 64 OR NEW.txid GLOB '*[^a-fA-F0-9]*';
  END;
`);

// 64-hex settle txids (broker_fee_landed txid=settle_txid 须过 trigger)。
const HEX = (c) => c.repeat(64);
const TX_PRE = HEX('a'), TX_NEW = HEX('b'), TX_NBO = HEX('c'), TX_MISSING = HEX('d');

// stub deriver: broker_pk → deterministic fake address (so outputs_json can be matched/mismatched on purpose).
const ADDR = (pk) => 'kaspatest:broker_' + pk;
const deriveBrokerAddress = (pk /*, net */) => ADDR(pk);
const log = () => {};

const insMarket = (id, status, settleTxid, brokerPk) =>
  db.prepare(`INSERT INTO pool_markets (id, protocol_status, settle_txid, broker_pk, spine_p2sh, resolution_rule_spec, metadata)
              VALUES (?,?,?,?,?,?,?)`).run(
    id, status, settleTxid, brokerPk, 'kaspatest:spine_' + id, JSON.stringify({ title: 'Market ' + id }), null);
const insTx = (txid, outs) => db.prepare('INSERT INTO kaspa_tx_log (tx_id, outputs_json) VALUES (?,?)').run(txid, JSON.stringify(outs));
const events = () => db.prepare("SELECT * FROM chain_events WHERE event_type='broker_fee_landed'").all();
const marker = (id) => { try { return JSON.parse(db.prepare('SELECT metadata FROM pool_markets WHERE id=?').get(id).metadata || '{}').broker_fee_landed_emitted_at; } catch { return undefined; } };

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); } };

console.log('[j2-broker-fee-emit-test]');

// ── Pre-existing completed market (settled BEFORE emit-pass existed) — must be backfill-suppressed on first run.
insMarket('pre_existing', 'completed', TX_PRE, 'pkPRE');
insTx(TX_PRE, [{ address: ADDR('pkPRE'), amount_sompi: 500000000 }]);

// ── Run 1: triggers one-time backfill-suppress. Pre-existing market should be marked, NOT emitted.
const r1 = brokerFeeLandedEmitTick(db, deriveBrokerAddress, log);
check('1a backfill-suppress marked >=1 pre-existing', r1.backfillSuppressed >= 1);
check('1b pre-existing has emit marker (suppressed)', !!marker('pre_existing'));
check('1c NO broker_fee_landed event from backfill (suppressed, no DM)', events().length === 0);
check('1d sentinel event_type 非 broker_ (不撞 v83 trigger·backfill 没 throw)', r1.backfillSuppressed >= 1);

// ── NEW settle (post-deploy·NOT suppressed). broker fee = secondary output (multiout).
insMarket('new_settle', 'completed', TX_NEW, 'pkNEW');
insTx(TX_NEW, [
  { address: 'kaspatest:winner1', amount_sompi: 1900000000 },
  { address: ADDR('pkNEW'), amount_sompi: 320000000 },
]);
// ── No-broker-output: settle TX indexed but broker not among outputs.
insMarket('no_broker_out', 'completed', TX_NBO, 'pkNBO');
insTx(TX_NBO, [{ address: 'kaspatest:winnerX', amount_sompi: 1000000000 }]);
// ── Pending-index: settle_txid NOT in kaspa_tx_log yet.
insMarket('pending_idx', 'completed', TX_MISSING, 'pkPND');

// ── Run 2: emit ONLY new_settle (chain-verified amount), skip no_broker_out (marked), defer pending_idx.
const r2 = brokerFeeLandedEmitTick(db, deriveBrokerAddress, log);
const ev = events();
check('2a emitted exactly 1 (new_settle only)', r2.emitted === 1 && ev.length === 1);
const payload = ev.length ? JSON.parse(ev[0].payload) : {};
check('2b fee_sompi == outputs_json broker amount (320000000·链验·非DB估)', payload.fee_sompi === 320000000);
check('2c output_index = 1 (secondary output·按地址匹配非位置)', payload.output_index === 1);
check('2d event to_address = broker address', ev.length && ev[0].to_address === ADDR('pkNEW'));
check('2e 🔴 broker_fee_landed txid == settle_txid (64-hex·过 v83 trigger)', ev.length && ev[0].txid === TX_NEW);
check('2f backfill did NOT run again (sentinel)', r2.backfillSuppressed === 0);
check('2g no_broker_out marked skipped (won\'t rescan)', !!marker('no_broker_out'));
check('2h no_broker_out emitted no event', !ev.some(e => JSON.parse(e.payload).market_id === 'no_broker_out'));
check('2i pending_idx NOT marked (will retry when indexed)', marker('pending_idx') === undefined);
check('2j pending_idx counted pendingIndex', r2.pendingIndex >= 1);

// ── Run 3: idempotent — new_settle already emitted, no re-emit.
const r3 = brokerFeeLandedEmitTick(db, deriveBrokerAddress, log);
check('3a idempotent: no new emit (new_settle already marked)', r3.emitted === 0 && events().length === 1);

// ── Run 4: pending_idx settle TX finally indexed → now emits.
insTx(TX_MISSING, [{ address: ADDR('pkPND'), amount_sompi: 150000000 }]);
const r4 = brokerFeeLandedEmitTick(db, deriveBrokerAddress, log);
check('4a pending_idx emits once indexed', r4.emitted === 1 && events().length === 2);
check('4b pending_idx fee_sompi chain-verified (150000000) + txid==settle_txid', events().some(e => {
  const p = JSON.parse(e.payload); return p.market_id === 'pending_idx' && p.fee_sompi === 150000000 && e.txid === TX_MISSING;
}));

console.log(`\n[j2-broker-fee-emit-test] ${pass} PASS / ${fail} FAIL`);
db.close();
process.exit(fail ? 1 : 0);
