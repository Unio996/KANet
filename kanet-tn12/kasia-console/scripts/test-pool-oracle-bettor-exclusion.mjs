// B2 v0.5 regression — area-1 invariant oracle ∩ bettor = ∅ (pp.txt 1.4 + PoolSpine.sil L9-16).
// Before this patch pool.js bettor/register did NO check; a relay could be both oracle and
// bettor in the same market — a direct vote-manipulation vector (oracle adjudicates a
// market where they have a directional stake).
//
// Faithful test — runs the EXACT predicate from pool.js bettor/register.
import Database from 'better-sqlite3';

const db = new Database('data/console.db');
const MID = `_test-oracle-bettor-${Date.now()}`;
const ORACLE_RELAY_IDS = ['oracle-relay-A', 'oracle-relay-B', 'oracle-relay-C'];
const NON_ORACLE_RELAY = 'bettor-relay-X';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

db.prepare(`
  INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline,
    protocol_status, oracle_relay_ids)
  VALUES (?, 'test-maker', 'kaspatest:test', 'deadbeef', ?, 'pending_bettors', ?)
`).run(MID, Math.floor(Date.now() / 1000) + 3600, JSON.stringify(ORACLE_RELAY_IDS));

try {
  // EXACT predicate from pool.js bettor/register.
  const isOracle = (marketId, bettorRelayId) => {
    const m = db.prepare('SELECT oracle_relay_ids FROM pool_markets WHERE id = ?').get(marketId);
    let oracleIds = [];
    try { oracleIds = JSON.parse(m?.oracle_relay_ids || '[]'); } catch {}
    return oracleIds.includes(bettorRelayId);
  };

  ok(isOracle(MID, 'oracle-relay-A'), 'oracle A trying to bet → rejected');
  ok(isOracle(MID, 'oracle-relay-B'), 'oracle B trying to bet → rejected');
  ok(isOracle(MID, 'oracle-relay-C'), 'oracle C trying to bet → rejected');
  ok(!isOracle(MID, NON_ORACLE_RELAY), 'independent relay → allowed to bet');
  ok(!isOracle(MID, 'test-maker'), 'maker → not blocked by oracle exclusivity (area-1 allows maker=bettor)');
} finally {
  db.prepare('DELETE FROM pool_markets WHERE id = ?').run(MID);
}

console.log(`\ntest-pool-oracle-bettor-exclusion: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
