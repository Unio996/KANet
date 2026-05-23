// B2 v0.5 area-8 E6 v142 regression — pool_bettor_sides.refund_attempted_at column
// added for DB-persistent 24h cooldown dedupe of PoolSide refund_market_cancelled
// broadcasts (= multi-Console-instance race-safe + Console-restart-safe).
//
// Faithful test — verifies the column exists after the running console's migrate.js
// has executed (= apply-time check, not a fresh-boot dry-run).
import Database from 'better-sqlite3';

const db = new Database('data/console.db');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

const cols = db.prepare("PRAGMA table_info(pool_bettor_sides)").all();
const colNames = cols.map(c => c.name);

ok(colNames.includes('refund_attempted_at'), 'pool_bettor_sides has refund_attempted_at column (v142)');

const col = cols.find(c => c.name === 'refund_attempted_at');
ok(col && col.notnull === 0, 'refund_attempted_at is NULL-able (NOT NULL=0)');
ok(col && /TIMESTAMP/i.test(col.type), `refund_attempted_at is TIMESTAMP type (actual: ${col?.type})`);

// Spot-check insert + select pattern works (= the column is functional, not just declared)
const MID = `_test-v142-${Date.now()}`;
db.prepare(`
  INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_status, oracle_relay_ids)
  VALUES (?, 'test-maker', 'kaspatest:test', 'deadbeef', ?, 'pending_bettors', '[]')
`).run(MID, Math.floor(Date.now() / 1000) + 3600);
const sideRowId = db.prepare(`
  INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh)
  VALUES (?, 'pk', 0, 50000000, 'kaspatest:side')
`).run(MID).lastInsertRowid;

try {
  // before update: refund_attempted_at is NULL
  const before = db.prepare('SELECT refund_attempted_at FROM pool_bettor_sides WHERE id = ?').get(sideRowId);
  ok(before.refund_attempted_at === null, 'fresh row: refund_attempted_at = NULL');

  // simulate a refund attempt — update to CURRENT_TIMESTAMP
  db.prepare('UPDATE pool_bettor_sides SET refund_attempted_at = CURRENT_TIMESTAMP WHERE id = ?').run(sideRowId);
  const after = db.prepare('SELECT refund_attempted_at FROM pool_bettor_sides WHERE id = ?').get(sideRowId);
  ok(typeof after.refund_attempted_at === 'string' && after.refund_attempted_at.length > 0, `after UPDATE: refund_attempted_at = "${after.refund_attempted_at}"`);

  // dedupe predicate: row within last 24h cooldown
  const stmt = db.prepare(`
    SELECT 1 FROM pool_bettor_sides
    WHERE id = ? AND refund_attempted_at IS NOT NULL
      AND refund_attempted_at >= datetime('now', '-24 hours')
  `);
  ok(!!stmt.get(sideRowId), 'dedupe query: row matches 24h cooldown predicate');
} finally {
  db.prepare('DELETE FROM pool_bettor_sides WHERE id = ?').run(sideRowId);
  db.prepare('DELETE FROM pool_markets WHERE id = ?').run(MID);
}

console.log(`\ntest-pool-v142-refund-attempted-at: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
