// Regression guard: excludeSideLockTx optional parameter (2026-07-11, 28mln shard9 phantom-leaf recovery)
//
// docs/2026-07-10-shard9-recovery-design.md — 3 independent raw-SQL consumption points of
// pool_bettor_sides (getSidesByShard/getMarketBets, loadBettorsCrossShard, verifyBettorsCompleteFromChain's
// local-DB fallback) each need to exclude the same set of phantom bet rows from V1 settlement math, keyed
// by side_lock_tx (chain-anchored, identical across every independent committee-voter node) rather than
// the local `id` primary key (SQLite auto-increment, insert-order-dependent per node — NOT safe across
// committee nodes that each run their own separate DB, per J1's machine being genuinely separate).
//
// This test covers gate (ii) from Bettor's 5-gate acceptance (#fcr3t2.1):
//   - passing excludeSideLockTx precisely excludes the matching rows (and only those)
//   - NOT passing it (all pre-existing callers) is byte-identical to pre-change behavior
//
// Same convention as zk_autonomy_ticks_regression.test.mjs: node assert, `node <file>` directly (not the
// declarative test-framework runner — these are JS function calls, not SQL-only checks), fresh migrated
// DB (runMigrations, real schema+triggers, not a live-DB copy — feedback-offline-test-must-use-real-
// schema-with-triggers).
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const TEST_DB = `D:/kanet-tn12/scratch/_shard9_exclude_test_${randomUUID().slice(0, 8)}.db`;
mkdirSync('D:/kanet-tn12/scratch', { recursive: true });
process.env.DB_PATH = TEST_DB;
const { runMigrations } = await import('file:///D:/kanet-tn12/kasia-console/src/db/migrate.js');
runMigrations();

const { sqlite } = await import('file:///D:/kanet-tn12/kasia-console/src/db/client.js');
const { getSidesByShard, getMarketBets } = await import('file:///D:/kanet-tn12/kasia-console/src/lib/pool-bettor-sides-query.mjs');
const { loadBettorsCrossShard } = await import('file:///D:/kanet-tn12/kasia-console/src/services/bshard-close-voter.js');

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.error(`❌ ${msg}`); } else { console.log(`✅ ${msg}`); } }

// ── seed a synthetic bshard market: 1 shard, 3 real bets + 2 "phantom" bets ──
const MKT = `test-shard9-exclude-${randomUUID().slice(0, 8)}`;
const SHARD = `${MKT}-s0`;
const insertMarketRow = sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, resolution_rule_spec)
  VALUES (?, 'test-relay', 'kaspatest:fake-spine', 'deadbeef', 9999999999, 'v0.7', ?, '{}')`);
insertMarketRow.run(MKT, 'verifying');
insertMarketRow.run(SHARD, 'shard_internal'); // shard clone row — market_shards.shard_market_id REFERENCES pool_markets(id)
sqlite.prepare(`INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, current_leaf_outpoint, current_leaf_state, status, created_at)
  VALUES (?, 0, ?, 'kaspatest:fake', 'deadbeef:0', '{}', 'sealed', strftime('%s','now'))`).run(MKT, SHARD);

const rows = [
  { pk: 'aa'.repeat(16), tx: 'real1'.padEnd(64, '0'), stake: 1000000000 },
  { pk: 'bb'.repeat(16), tx: 'real2'.padEnd(64, '0'), stake: 2000000000 },
  { pk: 'cc'.repeat(16), tx: 'real3'.padEnd(64, '0'), stake: 3000000000 },
  { pk: 'dd'.repeat(16), tx: 'phantom1'.padEnd(64, '0'), stake: 4000000000 },
  { pk: 'ee'.repeat(16), tx: 'phantom2'.padEnd(64, '0'), stake: 5000000000 },
];
const insertBet = sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex, pay_amount_sompi)
  VALUES (?, ?, NULL, 0, ?, '', ?, 0, '', ?)`);
for (const r of rows) insertBet.run(SHARD, r.pk, r.stake, r.tx, r.stake);

const excludeSet = [rows[3].tx, rows[4].tx]; // phantom1, phantom2
const REAL_SUM = (1000000000 + 2000000000 + 3000000000).toString();

// ── getSidesByShard ──
const gsAll = getSidesByShard(SHARD, sqlite);
check(gsAll.length === 5, 'getSidesByShard no-arg: returns all 5 rows (backward-compat baseline)');
const gsExcl = getSidesByShard(SHARD, sqlite, excludeSet);
check(gsExcl.length === 3, 'getSidesByShard excludeSideLockTx: excludes exactly the 2 phantom rows');
check(gsExcl.every((r) => !excludeSet.includes(r.side_lock_tx)), 'getSidesByShard excludeSideLockTx: no excluded txid present in result');
const gsAllAfter = getSidesByShard(SHARD, sqlite); // re-call without arg — must be unaffected by the prior excluded call
check(JSON.stringify(gsAllAfter) === JSON.stringify(gsAll), 'getSidesByShard no-arg call is unaffected by a prior excludeSideLockTx call (no shared mutable state)');

// ── getMarketBets ──
const gmAll = getMarketBets(MKT, sqlite);
check(gmAll.betCount === 5 && gmAll.poolSompi === '15000000000', 'getMarketBets no-arg: betCount=5, poolSompi=15000000000 (backward-compat baseline)');
const gmExcl = getMarketBets(MKT, sqlite, excludeSet);
check(gmExcl.betCount === 3, 'getMarketBets excludeSideLockTx: betCount=3');
check(gmExcl.poolSompi === REAL_SUM, `getMarketBets excludeSideLockTx: poolSompi=${REAL_SUM} (only real bets)`);
// unrelated txid list (matches nothing in this shard) → zero side effect, identical to no-arg
const gmIrrelevant = getMarketBets(MKT, sqlite, ['ffffffff'.padEnd(64, '0')]);
check(JSON.stringify(gmIrrelevant) === JSON.stringify(gmAll), 'getMarketBets with a non-matching excludeSideLockTx is byte-identical to no-arg call');

// ── loadBettorsCrossShard ──
const lbAll = loadBettorsCrossShard(MKT);
check(lbAll.length === 5, 'loadBettorsCrossShard no-arg: returns all 5 bettors (backward-compat baseline)');
const lbExcl = loadBettorsCrossShard(MKT, excludeSet);
check(lbExcl.length === 3, 'loadBettorsCrossShard excludeSideLockTx: excludes exactly the 2 phantom rows');
const lbExclSum = lbExcl.reduce((s, b) => s + BigInt(b.stake), 0n).toString();
check(lbExclSum === REAL_SUM, `loadBettorsCrossShard excludeSideLockTx: Σstake=${REAL_SUM} (only real bets)`);
const lbAllAfter = loadBettorsCrossShard(MKT);
check(JSON.stringify(lbAllAfter) === JSON.stringify(lbAll), 'loadBettorsCrossShard no-arg call is unaffected by a prior excludeSideLockTx call');

// ── real 28mln shard9 numbers, as a literal cross-check against the doc's recorded values (not re-derived) ──
check(REAL_SUM !== '64824000000', 'sanity: synthetic fixture Σ is NOT the real 28mln shard9 value (fixture is isolated, not accidentally aliasing prod data)');

console.log(failures === 0 ? `\n✅ ALL PASS (0 failures)` : `\n❌ ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
