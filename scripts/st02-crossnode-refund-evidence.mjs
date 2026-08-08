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
const total = db.prepare(SQL_TOTAL).get().n;
const matching = db.prepare(SQL_REASON).get(STATUS).n;
const crossNode = db.prepare(SQL_CROSSNODE).get(STATUS).n;
const byReason = db.prepare(SQL_BY_REASON).all();
const ids = db.prepare(SQL_IDS).all(STATUS).map((r) => r.id);

// Digest over the canonical id list: this is the artifact a second party diffs.
const idsDigest = createHash('sha256').update(ids.join('\n'), 'utf8').digest('hex');

const pkg = {
  artifact: 'ST02-CROSSNODE-REFUND-BLOCKED',
  generatedBy: 'scripts/st02-crossnode-refund-evidence.mjs',
  database: {
    path: DB_PATH,
    sizeBytes: stat.size,
    mtime: stat.mtime.toISOString(),
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
  // NOT a chain observation: these are DB rows. Chain-side anchoring is a separate claim.
  scope: 'single node console.db; proves what THIS node recorded, not what any other operator has',
};

console.log(JSON.stringify(pkg, null, 2));
db.close();
