// chain-events-sig-insert-observed-at.test.mjs — regression guard for the silent-INSERT bug
// (J2+NWT catch 2026-07-08 23:0x, uqmp8 first real batch-A cron run): chain_events.observed_at is
// TEXT NOT NULL with no default; omitting it made every bshard_close_sig(_v2) INSERT OR IGNORE
// silently fail — voter tick logged "signed=N" but zero rows ever landed, so collectCloseSigsV2
// always saw 0 sigs and submit never reached quorum. Verifies the fixed INSERT actually persists.
import { sqlite } from '../db/client.js';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

function testInsert(eventType) {
  const testTxid = `TEST_${eventType}_${Math.random().toString(36).slice(2)}`;
  // mirrors the fixed statement shape exactly (7 columns incl. observed_at).
  sqlite.prepare(`INSERT OR IGNORE INTO chain_events (txid, from_address, event_type, payload, observed_by, observed_at, is_public) VALUES (?, ?, ?, ?, ?, ?, 1)`)
    .run(testTxid, 'test_addr', eventType, 'test_payload', 'test_observer', new Date().toISOString());
  const row = sqlite.prepare('SELECT * FROM chain_events WHERE txid = ?').get(testTxid);
  ok(!!row, `${eventType}: INSERT with observed_at actually persists a row (was silently swallowed pre-fix)`);
  ok(row?.observed_at != null, `${eventType}: observed_at column is populated, not NULL`);
  // NWT catch (2026-07-08 23:0x): observed_at must be ISO-string format (chain-event.js canonical
  // convention across the codebase), not a bare unix-seconds integer-as-string — mixing formats in
  // the same TEXT column breaks lexicographic ORDER BY observed_at (idx_chain_events_type index).
  ok(/^\d{4}-\d{2}-\d{2}T/.test(String(row?.observed_at)), `${eventType}: observed_at is ISO-string format ('${row?.observed_at}'), not bare unix-seconds`);
  if (row) sqlite.prepare('DELETE FROM chain_events WHERE txid = ?').run(testTxid);
}

function testOmittedObservedAtStillFails(eventType) {
  // sanity: confirms the schema really does silently swallow the omitted-column case (proves the
  // bug was real, not a red herring) — this is the exact pre-fix statement shape.
  const testTxid = `TEST_OMIT_${eventType}_${Math.random().toString(36).slice(2)}`;
  sqlite.prepare(`INSERT OR IGNORE INTO chain_events (txid, from_address, event_type, payload, observed_by, is_public) VALUES (?, ?, ?, ?, ?, 1)`)
    .run(testTxid, 'test_addr', eventType, 'test_payload', 'test_observer');
  const row = sqlite.prepare('SELECT * FROM chain_events WHERE txid = ?').get(testTxid);
  ok(row === undefined, `${eventType}: pre-fix statement shape (no observed_at) confirmed silently swallowed — proves the bug was real`);
}

function testFailClosedAccounting(eventType) {
  // mirrors processCloseRequestV2/processCloseRequest's exact post-INSERT check (Bettor's fail-closed
  // accounting directive): changes===0 must be disambiguated — idempotent duplicate (row already
  // exists, e.g. a resumed tick re-signing the same root) is fine; a genuine silent failure (row
  // absent) must be reported as errored, never silently counted as signed.
  const testTxid = `TEST_FC_${eventType}_${Math.random().toString(36).slice(2)}`;
  const insert = () => sqlite.prepare(`INSERT OR IGNORE INTO chain_events (txid, from_address, event_type, payload, observed_by, observed_at, is_public) VALUES (?, ?, ?, ?, ?, ?, 1)`)
    .run(testTxid, 'test_addr', eventType, 'test_payload', 'test_observer', new Date().toISOString());

  const r1 = insert();
  ok(r1.changes === 1, `${eventType}: first insert changes=1 (real insert)`);

  const r2 = insert();
  ok(r2.changes === 0, `${eventType}: second insert (same txid) changes=0 (UNIQUE collision, idempotent retry)`);
  const existsAfterDup = sqlite.prepare('SELECT 1 FROM chain_events WHERE txid = ? AND event_type = ?').get(testTxid, eventType);
  ok(!!existsAfterDup, `${eventType}: changes=0 case correctly resolves to "row exists" (idempotent, NOT an error) — this is the disambiguation Bettor required`);

  sqlite.prepare('DELETE FROM chain_events WHERE txid = ?').run(testTxid);
}

testInsert('bshard_close_sig_v2');
testInsert('bshard_close_sig');
testOmittedObservedAtStillFails('bshard_close_sig_v2');
testFailClosedAccounting('bshard_close_sig_v2');
testFailClosedAccounting('bshard_close_sig');

console.log(fails === 0 ? '\n✅✅ ALL PASS — chain_events sig INSERT persists with observed_at fix' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
