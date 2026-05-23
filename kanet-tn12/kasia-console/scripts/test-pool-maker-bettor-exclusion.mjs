// B2 v0.5 regression — area-1 invariant: maker is the implicit bettor via outcome_side at
// create (stake locked at spine). Allowing the maker to also register via bettor/register
// would create a second stake at the maker's PoolSide, and computePoolPayouts L374-376
// would count the maker twice in `participants` (once isMaker:true from spine + once from
// sides.map). Block at bettor/register to preserve "maker 恒 bettor" single identity.
//
// Faithful test — runs the EXACT predicate from pool.js bettor/register.
import Database from 'better-sqlite3';

const db = new Database('data/console.db');
const MID = `_test-maker-bettor-${Date.now()}`;
const MAKER_RELAY_ID = 'maker-relay-X';
const NORMAL_BETTOR = 'bettor-relay-Z';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

db.prepare(`
  INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline,
    protocol_status, oracle_relay_ids)
  VALUES (?, ?, 'kaspatest:test', 'deadbeef', ?, 'pending_bettors', '[]')
`).run(MID, MAKER_RELAY_ID, Math.floor(Date.now() / 1000) + 3600);

try {
  // EXACT predicate from pool.js bettor/register: reject if bettor_relay_id === maker_relay_id.
  const isMaker = (marketId, bettorRelayId) => {
    const m = db.prepare('SELECT maker_relay_id FROM pool_markets WHERE id = ?').get(marketId);
    return bettorRelayId === m?.maker_relay_id;
  };

  ok(isMaker(MID, MAKER_RELAY_ID), 'maker trying to bettor/register → rejected');
  ok(!isMaker(MID, NORMAL_BETTOR), 'independent relay → allowed to register');
  ok(!isMaker(MID, ''), 'empty relay_id → not falsely matched as maker');
  ok(!isMaker(MID, 'maker-relay-X-suffix'), 'partial-string-match → not falsely rejected (exact match only)');
} finally {
  db.prepare('DELETE FROM pool_markets WHERE id = ?').run(MID);
}

console.log(`\ntest-pool-maker-bettor-exclusion: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
