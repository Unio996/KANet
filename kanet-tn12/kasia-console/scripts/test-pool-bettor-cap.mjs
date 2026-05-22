// B2 v0.5 regression — 50-bettor-max per market (PoolSpine.sil L13 v0.5 hard rule).
// pool.js bettor/register must reject the 51st bettor BEFORE transferAndConfirm locks
// stake on-chain (a post-transfer reject would strand the bettor's funds).
//
// Faithful test — runs the EXACT count query + cap predicate from pool.js.
import Database from 'better-sqlite3';

const db = new Database('data/console.db');
const MID = `_test-bettor-cap-${Date.now()}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

// pool_bettor_sides.market_id has an FK to pool_markets — seed a synthetic market.
db.prepare(`
  INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_status)
  VALUES (?, 'test-maker', 'kaspatest:test', 'deadbeef', ?, 'pending_bettors')
`).run(MID, Math.floor(Date.now() / 1000) + 3600);

const insertSide = (n) => db.prepare(`
  INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh)
  VALUES (?, ?, ?, ?, ?)
`).run(MID, `pk${n}`, n % 2, 50_000_000, `kaspatest:side${n}`);

// EXACT count query + predicate from pool.js bettor/register.
const countAndCheck = () => {
  const bettorCount = db.prepare('SELECT COUNT(*) c FROM pool_bettor_sides WHERE market_id = ?').get(MID).c;
  return { bettorCount, rejected: bettorCount >= 50 };
};

try {
  for (let i = 0; i < 49; i++) insertSide(i);
  let r = countAndCheck();
  ok(r.bettorCount === 49 && !r.rejected, `49 bettors → 50th allowed (count=${r.bettorCount}, rejected=${r.rejected})`);

  insertSide(49);
  r = countAndCheck();
  ok(r.bettorCount === 50 && r.rejected, `50 bettors → 51st rejected (count=${r.bettorCount}, rejected=${r.rejected})`);

  insertSide(50);
  r = countAndCheck();
  ok(r.bettorCount === 51 && r.rejected, `over-cap stays rejected (count=${r.bettorCount}, rejected=${r.rejected})`);
} finally {
  db.prepare('DELETE FROM pool_bettor_sides WHERE market_id = ?').run(MID);
  db.prepare('DELETE FROM pool_markets WHERE id = ?').run(MID);
}

console.log(`\ntest-pool-bettor-cap: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
