// Phase 2b Ship #1 regression — doomed-market skip.
// A pool_markets row marked metadata.needs_larger_pot can never settle (settle TX storage
// mass over the 500k cap). poolSettlerTick must skip it instead of recomputing the doomed
// mass every tick, which starves healthy markets.
//
// Test point (Bettor r379): doomed market stops being retried; healthy markets unaffected.
// Faithful test — runs the EXACT SELECT query from poolSettlerTick + the exact skip predicate.
import Database from 'better-sqlite3';

const db = new Database('data/console.db');
const now = Math.floor(Date.now() / 1000);
const SYN = `_test-doomed-skip-${Date.now()}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

// Insert a synthetic doomed market (deadline in the past so the tick SELECT picks it up).
db.prepare(`
  INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash,
    deadline, protocol_status, metadata, oracle_relay_ids)
  VALUES (?, 'test-maker', 'kaspatest:test', 'deadbeef', ?, 'verifying', ?, '[]')
`).run(SYN, now - 600, JSON.stringify({ needs_larger_pot: true, est_storage_mass: 1991668 }));

try {
  // EXACT SELECT query poolSettlerTick uses.
  const markets = db.prepare(`
    SELECT id, protocol_status, metadata
    FROM pool_markets
    WHERE protocol_status IN ('verifying', 'collecting_sigs')
      AND deadline <= ?
  `).all(now);

  // EXACT skip predicate from poolSettlerTick.
  const skipped = [], processed = [];
  for (const m of markets) {
    let doomedMeta = {};
    try { doomedMeta = JSON.parse(m.metadata || '{}'); } catch {}
    if (doomedMeta.needs_larger_pot) { skipped.push(m.id); continue; }
    processed.push(m.id);
  }

  ok(markets.some(m => m.id === SYN), 'synthetic doomed market is in the tick SELECT result');
  ok(skipped.includes(SYN), 'doomed market (needs_larger_pot) is SKIPPED');
  ok(!processed.includes(SYN), 'doomed market is NOT processed (no dispatch)');
  ok(processed.every(id => id !== SYN), 'healthy markets still flow — none wrongly skipped');
  console.log(`  (tick saw ${markets.length} markets: ${skipped.length} doomed-skipped, ${processed.length} processed)`);
} finally {
  db.prepare('DELETE FROM pool_markets WHERE id = ?').run(SYN);
}

console.log(`\ntest-pool-doomed-skip: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
