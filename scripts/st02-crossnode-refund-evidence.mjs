// ST-02 evidence package -- cross-node maker refund blockage (n=1293 claim)
//
// WHY: Codex review ddd4acee accepted the mechanism as CODE-LEVEL CONFIRMED but ruled the
// exact count "OBSERVED / NOT YET INDEPENDENTLY REPLAYABLE" -- the count was reported from an
// ad-hoc query with no committed SQL, no result digest, and no database identity. A number
// nobody else can recompute cannot enter the institutional failure corpus as VERIFIED.
//
// This script IS the replay procedure. It prints the SQL it ran, the database identity it ran
// against, the row counts, and a sha256 over the canonical result -- so a second party can
// diff a digest instead of trusting a sentence.
//
// Scope, stated up front: this reads ONE database (this node's console.db). It proves what
// this node's rows say. It does not prove what any other operator's database contains.
// Uses Node's BUILT-IN node:sqlite, deliberately not better-sqlite3.
// A new bare `require('better-sqlite3')` trips the M0a gate (R-M0A-BARE-IMPORT-DIFF),
// whose only sanctioned channel is a manifest entry with a human review anchor -- which
// is not mine to grant. The builtin needs no dependency and no exception, and opening
// read-only is the honest expression of what an evidence script may do anyway.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const DB_PATH = process.env.ST02_DB || 'D:/kanet/kanet/kasia-console/data/console.db';

// CORRECTION (2026-08-08, found by writing this very script):
// ST-02 v0.1 reported these rows as living in a table named `unresolved_needs_authorization`.
// There is no such table -- 113 tables, zero matches. It is a VALUE of the column
// `pool_markets.protocol_status`. The count 1293 was right; its stated location was not.
// That is exactly the failure a replayable evidence package is supposed to catch, and it
// only surfaced because Codex refused to let the number in as VERIFIED without one.
const STATUS = 'unresolved_needs_authorization';

const SQL_TOTAL = `SELECT COUNT(*) AS n FROM pool_markets`;
const SQL_REASON = `SELECT COUNT(*) AS n FROM pool_markets WHERE protocol_status = ?`;
const SQL_BY_REASON = `SELECT protocol_status, COUNT(*) AS n FROM pool_markets GROUP BY protocol_status ORDER BY n DESC`;
const SQL_IDS = `SELECT id FROM pool_markets WHERE protocol_status = ? ORDER BY id`;
const SQL_CROSSNODE = `SELECT COUNT(*) AS n FROM pool_markets WHERE protocol_status = ? AND maker_relay_id LIKE 'cross-node:%'`;

const db = new DatabaseSync(DB_PATH, { readOnly: true });

const stat = fs.statSync(DB_PATH);
// WAL identity (2026-08-08, J2): the main .db file alone does not identify the database state.
// In WAL mode, committed-but-not-yet-checkpointed rows live in the -wal file, so a package that
// fingerprints only the .db is describing part of the thing it claims to describe. Recorded, not
// digested -- these are provenance, and they legitimately differ between two honest runs.
// (Not claimed: that .db mtime "goes stale" while -wal advances. On the two databases checked
//  2026-08-08 the two mtimes matched. The defensible point is incompleteness, not skew.)
const walStat = (() => {
  try { const s = fs.statSync(`${DB_PATH}-wal`); return { present: true, sizeBytes: s.size, mtime: s.mtime.toISOString() }; }
  catch { return { present: false }; }
})();

// ── 🔴 Single-read-transaction pin (Codex 8cb7bb7e; implemented 2026-08-08 by J2) ─────────────
// WHY: each prepare().get()/.all() previously ran as its own implicit read transaction. Against a
// live WAL database that is five separate points in time. A concurrent settler tick between the
// COUNT and the id listing yields `total` from moment A and `ids` from moment B -- and the script
// still emits ONE digest over the result, i.e. a digest of a state that never existed.
// The rows would each be true; the package as a whole would be about no single moment.
// BEGIN DEFERRED takes the snapshot at the first read and holds it until COMMIT, so all five
// statements below observe the same snapshot. Verified 2026-08-08: a readOnly DatabaseSync
// connection can open and commit a read transaction (writes are still impossible).
db.exec('BEGIN DEFERRED');
const total = db.prepare(SQL_TOTAL).get().n;
const matching = db.prepare(SQL_REASON).get(STATUS).n;
const crossNode = db.prepare(SQL_CROSSNODE).get(STATUS).n;
const byReason = db.prepare(SQL_BY_REASON).all();
const ids = db.prepare(SQL_IDS).all(STATUS).map((r) => r.id);
// Read INSIDE the transaction: this is the snapshot's own identity, constant for its duration.
const dataVersionPinned = db.prepare('PRAGMA data_version').get().data_version;
db.exec('COMMIT');
// Read AFTER commit: if it moved, another connection committed while we were reading. Our numbers
// are still internally consistent (that is what the pin buys); what it tells a second party is that
// a re-run will legitimately differ. It is provenance, not a failure.
const dataVersionAfter = db.prepare('PRAGMA data_version').get().data_version;

// Digest over the canonical id list: this is the artifact a second party diffs.
const idsDigest = createHash('sha256').update(ids.join('\n'), 'utf8').digest('hex');

const pkg = {
  artifact: 'ST02-CROSSNODE-REFUND-BLOCKED',
  generatedBy: 'scripts/st02-crossnode-refund-evidence.mjs',
  database: {
    path: DB_PATH,
    sizeBytes: stat.size,
    mtime: stat.mtime.toISOString(),
    wal: walStat,
  },
  // What a second party needs in order to know the five numbers below describe ONE moment.
  readSnapshot: {
    pinned: true,
    method: 'BEGIN DEFERRED / five reads / COMMIT (single WAL read snapshot)',
    dataVersionPinned,
    dataVersionAfter,
    changedDuringRun: dataVersionPinned !== dataVersionAfter,
    note: 'changedDuringRun=true means another connection committed while this ran. The package is '
        + 'still internally consistent -- that is what the pin buys -- but a re-run will differ.',
  },
  sql: { total: SQL_TOTAL, matching: SQL_REASON, breakdown: SQL_BY_REASON, ids: SQL_IDS, crossNode: SQL_CROSSNODE },
  statusLiteral: STATUS,
  result: {
    poolMarketsTotal: total,
    matchingStatus: matching,
    matchingStatusAndCrossNodeMaker: crossNode,
    distinctMarketIds: new Set(ids).size,
    breakdown: byReason,
  },
  idsSha256: idsDigest,
  // 🔴 An empty result set hashes to e3b0c442...b855 -- the sha256 of the empty string -- which is
  // a perfectly well-formed digest. A reviewer diffing hex strings cannot see that it encodes
  // "nothing was read". Wrong DB path, wrong status literal, or a renamed column all land here,
  // and every other field in this package still looks healthy (consistency: 0 === 0 is true).
  // So the emptiness is stated in words, not left for someone to infer from a hash.
  // (Surfaced 2026-08-08 by running this script against a database where the count is 0.)
  // idsSha256's formula is deliberately UNCHANGED: ST-02 v0.2 publishes cc124dfe... as an anchor,
  // and silently changing what that field means would invalidate a live anchor to fix a labelling
  // problem. The flag is added beside it instead.
  idsCount: ids.length,
  emptyResult: ids.length === 0,
  // Cheap structural invariant: the per-status breakdown must sum to the total, and the matching
  // count must equal the breakdown's own entry for STATUS. Under the pin these hold by
  // construction -- the value is as a REGRESSION guard: if a later edit removes the transaction,
  // a torn read CAN violate this and the package says so instead of looking fine.
  // 🔴 Honest limit: a torn read does not NECESSARILY violate it (two reads can be inconsistent
  //    and still sum correctly), so `true` here is not proof the reads were pinned --
  //    `readSnapshot.pinned` above is the claim; this is only a cross-check that can catch it.
  consistency: (() => {
    const breakdownSum = byReason.reduce((a, r) => a + r.n, 0);
    const statusRow = byReason.find((r) => r.protocol_status === STATUS);
    return {
      breakdownSum,
      breakdownSumEqualsTotal: breakdownSum === total,
      matchingEqualsBreakdownEntry: (statusRow ? statusRow.n : 0) === matching,
    };
  })(),
  // NOT a chain observation: these are DB rows. Chain-side anchoring is a separate claim.
  scope: 'single node console.db; proves what THIS node recorded, not what any other operator has',
};

console.log(JSON.stringify(pkg, null, 2));
db.close();
