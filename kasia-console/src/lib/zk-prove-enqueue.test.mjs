// zk-prove-enqueue.test.mjs — regression guard for enqueueZkProveJob (J1tn, 缺件①, 2026-07-08).
// In-memory sqlite fixture (dependency-injected db, same pattern as getSidesByShard(shardId, db)) —
// no real console.db touched, no chain/relay calls, pure logic + real production sub-functions
// (canonicalBetOrder/computeBetsRoot/computePariMutuelPayout/readPayoutShardV2AttestedState/
// _splicePayoutV2CloseRedeem) exercised for real, not mocked.
//
// Run: cd kasia-console && node src/lib/zk-prove-enqueue.test.mjs

import Database from 'better-sqlite3';
import { enqueueZkProveJob, retryZkProveJobAfterHandoffLanded } from './zk-prove-enqueue.mjs';
import { computeBetsRoot } from './pool-payout-root.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE market_shards (logical_market_id TEXT, shard_market_id TEXT, shard_index INTEGER);
    CREATE TABLE pool_bettor_sides (market_id TEXT, bettor_pk TEXT, stake_amount TEXT, direction INTEGER, side_lock_daa INTEGER, side_lock_tx TEXT);
    CREATE TABLE zk_prove_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, market_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      ordered_bets_json TEXT NOT NULL, bets_root_hex TEXT, attested_winner INTEGER, receipt_hex TEXT,
      journal_digest_hex TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      fee_leaves_json TEXT NOT NULL DEFAULT '[]', pool_total_sompi TEXT
    );
    CREATE UNIQUE INDEX idx_zk_prove_jobs_market_active ON zk_prove_jobs(market_id) WHERE status IN ('pending', 'in_progress');
    CREATE TABLE events (id TEXT, event_scope TEXT, event_type TEXT, source TEXT, level TEXT, summary TEXT, payload_json TEXT, created_at TEXT);
  `);
  return db;
}

// ── synthetic PayoutShardV2 pre-attest redeem (same 289B state-region layout as
//    bshard-close-enforce.psv2-read.test.mjs — offsets are the production single-source-of-truth). ──
function pushInt(n) {
  const neg = n < 0n; let mag = neg ? -n : n;
  const b = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) { b[i] = Number(mag & 0xffn); mag >>= 8n; }
  if (neg) b[7] |= 0x80;
  return Buffer.concat([Buffer.from([0x08]), b]);
}
function pushRoot32(hex) { return Buffer.concat([Buffer.from([0x20]), Buffer.from(hex, 'hex')]); }
function buildPreAttestRedeem(consolidatedPool) {
  const parts = [
    Buffer.from([0x00]),
    pushInt(consolidatedPool), pushInt(0n), pushRoot32('00'.repeat(32)),
    ...Array.from({ length: 17 }, () => pushInt(0n)),
    pushInt(-1n), pushInt(0n), pushRoot32('00'.repeat(32)), pushRoot32('00'.repeat(32)),
    Buffer.from('deadbeef', 'hex'),
  ];
  return Buffer.concat(parts).toString('hex');
}

const MARKET_ID = 'ext-pool-v07-test-market-zkproveenqueue';
const SHARD_ID = `${MARKET_ID}-s0`;
const BETTOR_A = { pk: 'aa'.repeat(32), stake: '2000000000', direction: 1, side_lock_daa: 100, side_lock_tx: 'txA' };  // winner (direction==1)
const BETTOR_B = { pk: 'bb'.repeat(32), stake: '1000000000', direction: 0, side_lock_daa: 101, side_lock_tx: 'txB' };  // loser
const BETTOR_C = { pk: 'cc'.repeat(32), stake: '1000000000', direction: 1, side_lock_daa: 99, side_lock_tx: 'txC' };   // winner, earlier daa (tests ordering)
const SEED = 20_000_000n;
const POOL = SEED + BigInt(BETTOR_A.stake) + BigInt(BETTOR_B.stake) + BigInt(BETTOR_C.stake);  // 4,020,000,000
const BROKER_PK = 'dd'.repeat(32);
const FEE_BPS = 190; // 1.9%, matches today's real broker_fee_pct discussion
const FEE_AMOUNT = (POOL * BigInt(FEE_BPS) / 10000n).toString();

function seedMarket(db) {
  db.prepare('INSERT INTO market_shards (logical_market_id, shard_market_id, shard_index) VALUES (?, ?, 0)').run(MARKET_ID, SHARD_ID);
  for (const b of [BETTOR_A, BETTOR_B, BETTOR_C]) {
    db.prepare('INSERT INTO pool_bettor_sides (market_id, bettor_pk, stake_amount, direction, side_lock_daa, side_lock_tx) VALUES (?,?,?,?,?,?)')
      .run(SHARD_ID, b.pk, b.stake, b.direction, b.side_lock_daa, b.side_lock_tx);
  }
}

// canonical order = by side_lock_daa ASC: C(99), A(100), B(101)
const orderedBettors = [BETTOR_C, BETTOR_A, BETTOR_B].map((b) => ({ pk: b.pk, stake: b.stake, direction: b.direction }));
const REAL_BETS_ROOT = computeBetsRoot(orderedBettors).toString('hex');

console.log('[test] happy path: enqueue succeeds, Σleaf conserved, canonical (daa) order used, not id/insertion order:');
{
  const db = freshDb();
  seedMarket(db);
  const preRedeem = buildPreAttestRedeem(POOL);
  const attestValues = {
    newPayoutRootHex: '00'.repeat(32), // guest hasn't run yet at enqueue time — placeholder, matches CloseZkV2 ZERO32 convention
    newAttestedWinner: 1, newBetsRootHex: REAL_BETS_ROOT, newRefundRootHex: '22'.repeat(32), newAttestedAtMs: 1783413621808,
  };
  const feeLeaves = [{ pk: BROKER_PK, amount: FEE_AMOUNT }];
  const r = enqueueZkProveJob(db, MARKET_ID, preRedeem, attestValues, feeLeaves);
  ok(r.ok && r.jobId != null, `enqueue ok, jobId=${r.jobId}`);
  const row = db.prepare('SELECT * FROM zk_prove_jobs WHERE id = ?').get(r.jobId);
  ok(row.status === 'pending', 'job status=pending');
  ok(row.bets_root_hex === REAL_BETS_ROOT, 'bets_root_hex stored matches recomputed value');
  ok(row.attested_winner === 1, 'attested_winner stored=1');
  ok(row.pool_total_sompi === POOL.toString(), `pool_total_sompi stored=${row.pool_total_sompi}`);
  const storedBets = JSON.parse(row.ordered_bets_json);
  ok(storedBets.map((b) => b.pk).join(',') === [BETTOR_C.pk, BETTOR_A.pk, BETTOR_B.pk].join(','),
    'ordered_bets_json uses canonical side_lock_daa order (C,A,B), not insertion order (A,B,C)');
  const storedFees = JSON.parse(row.fee_leaves_json);
  ok(storedFees.length === 1 && storedFees[0].amount === FEE_AMOUNT, 'fee_leaves_json round-trips byte-exact');

  console.log('[test] idempotent: second enqueue on same market while pending is a no-op skip, not a duplicate row:');
  const r2 = enqueueZkProveJob(db, MARKET_ID, preRedeem, attestValues, feeLeaves);
  ok(r2.ok && !!r2.skipped, `second call skipped: "${r2.skipped}"`);
  const count = db.prepare('SELECT COUNT(*) c FROM zk_prove_jobs WHERE market_id = ?').get(MARKET_ID).c;
  ok(count === 1, `still only 1 row for market (count=${count})`);
}

console.log('[test] fail-closed guards:');
{
  const db = freshDb();
  seedMarket(db);
  const preRedeem = buildPreAttestRedeem(POOL);
  const goodAttest = { newPayoutRootHex: '00'.repeat(32), newAttestedWinner: 1, newBetsRootHex: REAL_BETS_ROOT, newRefundRootHex: '22'.repeat(32), newAttestedAtMs: 1783413621808 };
  const goodFees = [{ pk: BROKER_PK, amount: FEE_AMOUNT }];

  ok((() => { try { enqueueZkProveJob(db, MARKET_ID, preRedeem, goodAttest, []); return false; } catch (e) { return /feeLeaves 为空/.test(e.message); } })(),
    'empty feeLeaves array throws (no silent bps-fallback)');

  ok((() => { try { enqueueZkProveJob(db, MARKET_ID, preRedeem, goodAttest, [{ pk: BROKER_PK, amount: (POOL + 1n).toString() }]); return false; } catch (e) { return /fee 配置异常/.test(e.message); } })(),
    'feeLeaves summing above consolidatedPool throws (would make distributable negative)');

  ok((() => { try { enqueueZkProveJob(db, MARKET_ID, preRedeem, { ...goodAttest, newBetsRootHex: 'ff'.repeat(32) }, goodFees); return false; } catch (e) { return /本地重算 betsRoot/.test(e.message); } })(),
    'attested betsRoot mismatching independently-recomputed betsRoot throws (gather-order/staleness tripwire)');

  ok((() => { try { enqueueZkProveJob(db, MARKET_ID, preRedeem, { ...goodAttest, newAttestedWinner: 0 }, goodFees); return true; } catch (e) { return false; } })(),
    'opposite winning direction (0, all-loser-for-fixture-since-only-B-has-dir0) exercised without crash');
}

console.log('[test] degenerate market (no winners on the attested side) skips cleanly instead of enqueueing a job the guest cannot prove:');
{
  // Fixture has bettors on both direction 0 and 1, so neither side is degenerate — build a fresh
  // single-bettor market instead so attesting the OTHER (unbet) direction as winner is genuinely degenerate.
  const db2 = freshDb();
  db2.prepare('INSERT INTO market_shards (logical_market_id, shard_market_id, shard_index) VALUES (?, ?, 0)').run(MARKET_ID, SHARD_ID);
  db2.prepare('INSERT INTO pool_bettor_sides (market_id, bettor_pk, stake_amount, direction, side_lock_daa, side_lock_tx) VALUES (?,?,?,?,?,?)')
    .run(SHARD_ID, BETTOR_A.pk, BETTOR_A.stake, 1, BETTOR_A.side_lock_daa, BETTOR_A.side_lock_tx);
  const onlyOneBet = [{ pk: BETTOR_A.pk, stake: BETTOR_A.stake, direction: 1 }];
  const onlyPool = SEED + BigInt(BETTOR_A.stake);
  const onlyBetsRoot = computeBetsRoot(onlyOneBet).toString('hex');
  const preRedeem2 = buildPreAttestRedeem(onlyPool);
  const attestZero = { newPayoutRootHex: '00'.repeat(32), newAttestedWinner: 0, newBetsRootHex: onlyBetsRoot, newRefundRootHex: '22'.repeat(32), newAttestedAtMs: 1783413621808 };
  const r = enqueueZkProveJob(db2, MARKET_ID, preRedeem2, attestZero, [{ pk: BROKER_PK, amount: '1' }]);
  ok(r.ok && /degenerate/.test(r.skipped || ''), `degenerate market skipped cleanly: "${r.skipped}"`);
  const count = db2.prepare('SELECT COUNT(*) c FROM zk_prove_jobs').get().c;
  ok(count === 0, 'no job row inserted for degenerate market');
}

console.log('[test] retryZkProveJobAfterHandoffLanded (缺件④, docs/2026-07-11-zk-autonomy-fourth-piece-handoff-enqueue-retry-design.md):');
{
  const db = freshDb();
  db.prepare(`INSERT INTO zk_prove_jobs (market_id, status, ordered_bets_json, error) VALUES (?, 'failed', '[]', ?)`)
    .run(MARKET_ID, `market ${MARKET_ID} 还没有 zk_continuation(zk_handoff 还没成功广播过)— 拒绝在花 4 分钟 proving+1KAS gate 注资之前跑一个下游必炸的 job`);
  const r = retryZkProveJobAfterHandoffLanded(db, MARKET_ID);
  ok(r.ok && r.retried === true, `liveness-gap failed job retried: ${JSON.stringify(r)}`);
  const row = db.prepare('SELECT status, error FROM zk_prove_jobs WHERE id = ?').get(r.jobId);
  ok(row.status === 'pending', 'job reset to pending');
  ok(row.error === null, 'error cleared');
  const auditEvt = db.prepare(`SELECT * FROM events WHERE event_type = 'zk_prove_job_retried_after_handoff'`).get();
  ok(!!auditEvt, 'audit event row written (NWT diff-review finding: design §2 步骤3 要求, 实现之前漏了)');
  ok(JSON.parse(auditEvt.payload_json).jobId === r.jobId, 'audit payload references correct jobId');

  console.log('  [negative] real data error must NOT be auto-retried (防退化成 blanket retry):');
  const db2 = freshDb();
  db2.prepare(`INSERT INTO zk_prove_jobs (market_id, status, ordered_bets_json, error) VALUES (?, 'failed', '[]', ?)`)
    .run(MARKET_ID, `enqueueZkProveJob: Σleaf(999) != consolidatedPool(1000) — 独立重算不守恒, 拒绝 enqueue`);
  const r2 = retryZkProveJobAfterHandoffLanded(db2, MARKET_ID);
  ok(r2.ok && r2.retried === false, `real data error not retried: ${JSON.stringify(r2)}`);
  const row2 = db2.prepare('SELECT status, error FROM zk_prove_jobs WHERE market_id = ?').get(MARKET_ID);
  ok(row2.status === 'failed', 'job stays failed');
  ok(row2.error != null, 'error preserved (not cleared)');

  console.log('  [no-op] no failed job for market → no-op, no throw, no new row:');
  const db3 = freshDb();
  const r3 = retryZkProveJobAfterHandoffLanded(db3, MARKET_ID);
  ok(r3.ok && r3.retried === false, `no failed job → clean no-op: ${JSON.stringify(r3)}`);
  const count3 = db3.prepare('SELECT COUNT(*) c FROM zk_prove_jobs').get().c;
  ok(count3 === 0, 'no job row created');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — enqueueZkProveJob: canonical order, Σleaf conservation, verify-value-source betsRoot cross-check, idempotent lock, degenerate skip; retryZkProveJobAfterHandoffLanded: liveness-gap retry, real-error non-retry, no-op safety all hold'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
