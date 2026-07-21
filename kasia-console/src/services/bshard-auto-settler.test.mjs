// bshard-auto-settler.test.mjs — regression guard for deriveResumePlanFromEvidence
// (resume-fix, 2026-07-11, docs/2026-07-11-backlog-markets-resume-fix-and-cleanup-design.md §1/§5).
// In-memory sqlite fixture, real production sub-functions exercised (getMarketBets/
// computePariMutuelPayout/buildPayoutRoot), no mocks, no console.db touched.
//
// Run: cd kasia-console && node src/services/bshard-auto-settler.test.mjs

import Database from 'better-sqlite3';
import { deriveResumePlanFromEvidence } from './bshard-auto-settler.mjs';
import { computePariMutuelPayout } from '../lib/pool-shard-settle.mjs';
import { payoutRoot as buildPayoutRoot } from '../lib/pool-payout-root.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pool_markets (id TEXT PRIMARY KEY, protocol_version TEXT, metadata TEXT);
    CREATE TABLE market_shards (logical_market_id TEXT, shard_market_id TEXT, shard_index INTEGER, status TEXT DEFAULT 'sealed');
    CREATE TABLE pool_bettor_sides (market_id TEXT, bettor_pk TEXT, stake_amount TEXT, direction INTEGER, side_lock_daa INTEGER, side_lock_tx TEXT);
  `);
  return db;
}

const MARKET_ID = 'ext-pool-v07-test-resumeplan';
const SHARD_ID = `${MARKET_ID}-s0`;
const WINNER = { pk: 'aa'.repeat(32), stake: '2000000000', direction: 1 };
const LOSER = { pk: 'bb'.repeat(32), stake: '1000000000', direction: 0 };
const POOL_SOMPI = (BigInt(WINNER.stake) + BigInt(LOSER.stake)).toString();

function seedMarket(db, metadata) {
  db.prepare('INSERT INTO pool_markets (id, protocol_version, metadata) VALUES (?, ?, ?)').run(MARKET_ID, 'v0.7', JSON.stringify(metadata || {}));
  db.prepare('INSERT INTO market_shards (logical_market_id, shard_market_id, shard_index) VALUES (?, ?, 0)').run(MARKET_ID, SHARD_ID);
  for (const b of [WINNER, LOSER]) {
    db.prepare('INSERT INTO pool_bettor_sides (market_id, bettor_pk, stake_amount, direction) VALUES (?,?,?,?)').run(SHARD_ID, b.pk, b.stake, b.direction);
  }
}

const realPm = computePariMutuelPayout({ bettors: [WINNER, LOSER].map(b => ({ pk: b.pk, stake: b.stake, direction: b.direction })), winningDirection: 1 });
const REAL_ROOT = buildPayoutRoot(realPm.payoutLeaves).toString('hex');

console.log('[test] no settle_evidence.close_txid → {ok:false}, caller falls back to computeSettlePlan:');
{
  const db = freshDb();
  seedMarket(db, {});
  const r = deriveResumePlanFromEvidence(MARKET_ID, { db });
  ok(r.ok === false, `no evidence → ok:false: ${JSON.stringify(r)}`);
}

console.log('[test] settle_evidence present + independently recomputed payoutRoot matches → resume plan derived, zero committee/getBlockAtDaa fields:');
{
  const db = freshDb();
  seedMarket(db, { settle_evidence: { close_txid: 'aa'.repeat(32), win_direction: 1, payout_root: REAL_ROOT } });
  const r = deriveResumePlanFromEvidence(MARKET_ID, { db });
  ok(r.ok === true, `derived ok: ${JSON.stringify(r)}`);
  ok(r.winDir === 1, 'winDir taken from evidence (not re-judged)');
  ok(r.payoutRoot === REAL_ROOT, 'payoutRoot independently recomputed, matches evidence');
  ok(r.poolSompi === POOL_SOMPI, `poolSompi=${r.poolSompi} matches bets`);
  ok(Array.isArray(r.winners) && r.winners.length === 1 && r.winners[0].pk === WINNER.pk, 'winners = only the winning-direction bettor');
  ok(!('committeeMeta' in r) && !('expectedClosedAddr' in r) && !('committeePkHash' in r), 'zero committee fields (resume branch never needs them)');
}

console.log('[test] settle_evidence present but payout_root MISMATCH (corrupted/stale evidence) → fail-closed, NOT a false resume:');
{
  const db = freshDb();
  seedMarket(db, { settle_evidence: { close_txid: 'aa'.repeat(32), win_direction: 1, payout_root: 'ff'.repeat(32) } });
  const r = deriveResumePlanFromEvidence(MARKET_ID, { db });
  ok(r.ok === false, `mismatched payoutRoot → ok:false (fail-closed, caller falls back to computeSettlePlan): ${JSON.stringify(r)}`);
}

console.log('[test] settle_evidence.win_direction invalid (neither 0 nor 1) → fail-closed:');
{
  const db = freshDb();
  seedMarket(db, { settle_evidence: { close_txid: 'aa'.repeat(32), win_direction: null, payout_root: REAL_ROOT } });
  const r = deriveResumePlanFromEvidence(MARKET_ID, { db });
  ok(r.ok === false, `invalid win_direction → ok:false: ${JSON.stringify(r)}`);
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — deriveResumePlanFromEvidence: no-evidence fallback, correct resume derivation with zero committee fields, corrupted-evidence fail-closed, invalid win_direction fail-closed all hold'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
