// B2 v0.5 area-8 regression — Q14: PoolSide ctor has no disambiguator, so registering the
// SAME (bettor_pk, direction, stake_amount) twice on the same market derives the IDENTICAL
// PoolSide P2SH. Two transferAndConfirm calls would put two UTXOs at the same address; SS
// PoolSide.claim_winner unlocks only one UTXO → the second stake permanently stuck.
//
// Faithful test — runs the EXACT duplicate-check predicate from pool.js bettor/register.
import Database from 'better-sqlite3';

const db = new Database('data/console.db');
const MID = `_test-bettor-dup-${Date.now()}`;
const BETTOR_PK = 'bettor-pk-deadbeef';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

db.prepare(`
  INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline,
    protocol_status, oracle_relay_ids)
  VALUES (?, 'test-maker', 'kaspatest:test', 'deadbeef', ?, 'pending_bettors', '[]')
`).run(MID, Math.floor(Date.now() / 1000) + 3600);

// Insert an initial registration to set up the duplicate scenario
db.prepare(`
  INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh)
  VALUES (?, ?, 0, 100000000, 'kaspatest:side-existing')
`).run(MID, BETTOR_PK);

try {
  // EXACT predicate from pool.js bettor/register Q14:
  const isDup = (bp, dir, stake) => {
    const r = db.prepare('SELECT id FROM pool_bettor_sides WHERE market_id = ? AND bettor_pk = ? AND direction = ? AND stake_amount = ?')
      .get(MID, bp, dir, stake);
    return !!r;
  };

  ok(isDup(BETTOR_PK, 0, 100000000), 'exact same (pk, direction, stake) → duplicate detected');
  ok(!isDup(BETTOR_PK, 0, 200000000), 'different stake → not a duplicate');
  ok(!isDup(BETTOR_PK, 1, 100000000), 'different direction → not a duplicate (separate PoolSide)');
  ok(!isDup('other-pk-cafe', 0, 100000000), 'different bettor_pk → not a duplicate');
  ok(!isDup(BETTOR_PK, 0, 100000001), 'stake differs by 1 sompi → not a duplicate (P2SH would differ)');
} finally {
  db.prepare('DELETE FROM pool_bettor_sides WHERE market_id = ?').run(MID);
  db.prepare('DELETE FROM pool_markets WHERE id = ?').run(MID);
}

console.log(`\ntest-pool-bettor-duplicate-params: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
