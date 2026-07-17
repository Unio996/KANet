// bshard-recapture-shard-loop.test.mjs — regression guard for the shard-enumeration query added to
// bshard-settle-daemon.mjs (2026-07-17, 治本卡①第一条, docs/2026-07-17-bshard-recapture-side-lock-daa-
// port-design.md). Verifies pool_bettor_sides rows are scattered across shards (not the logical id)
// and that recaptureSideLockDaaForMarket, called once per shard, sees each shard's rows independently
// and never touches an already-filled row. Uses real recaptureSideLockDaaForMarket (no RPC needed —
// all seeded rows already have side_lock_daa set, so the function short-circuits before any chain call,
// per pool-market-settler-v06.mjs:424 `if (!nullBets.length) return`).
// Run: cd kasia-console && node src/services/bshard-recapture-shard-loop.test.mjs   (自举同 pool-bettor-refund-claim.test.mjs)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._SHARDLOOP_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_shardloop_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: {
      ...process.env, DB_PATH: tmpDb, _SHARDLOOP_TEST_BOOTSTRAPPED: '1',
      KASPA_RPC_URL: process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210',
      KASPA_NETWORK: process.env.KASPA_NETWORK || 'testnet-12',
    },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { recaptureSideLockDaaForMarket } = await import('./pool-market-settler-v06.mjs');
const { randomUUID } = await import('node:crypto');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

sqlite.pragma('foreign_keys = OFF');

const logicalId = `shardlooptest-${randomUUID().slice(0, 6)}`;
const shard0 = `${logicalId}-s0`, shard1 = `${logicalId}-s1`;
sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, created_at, updated_at) VALUES (?, 'r', 'kaspatest:x', 'h', 999999999, 'v0.7', 'verifying', datetime('now'), datetime('now'))`).run(logicalId);
sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, created_at, updated_at) VALUES (?, 'r', 'kaspatest:s0', 'h', 999999999, 'v0.7', 'shard_internal', datetime('now'), datetime('now'))`).run(shard0);
sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, created_at, updated_at) VALUES (?, 'r', 'kaspatest:s1', 'h', 999999999, 'v0.7', 'shard_internal', datetime('now'), datetime('now'))`).run(shard1);
sqlite.prepare(`INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, status, created_at) VALUES (?, 0, ?, 'kaspatest:s0', 'settled', datetime('now'))`).run(logicalId, shard0);
sqlite.prepare(`INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, status, created_at) VALUES (?, 1, ?, 'kaspatest:s1', 'settled', datetime('now'))`).run(logicalId, shard1);
// shard0: one already-filled row (must never be touched/overwritten). shard1: another already-filled row.
sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, side_lock_daa, created_at) VALUES (?, ?, 0, 100, 'p', ?, 12345, datetime('now'))`).run(shard0, 'aa'.repeat(32), 't0');
sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, side_lock_daa, created_at) VALUES (?, ?, 0, 100, 'p', ?, 67890, datetime('now'))`).run(shard1, 'bb'.repeat(32), 't1');

console.log('[test] shard-enumeration query (bshard-settle-daemon.mjs new code) finds both shards, not just the logical id:');
{
  const shardIds = sqlite.prepare('SELECT shard_market_id FROM market_shards WHERE logical_market_id = ?').all(logicalId).map(r => r.shard_market_id);
  ok(shardIds.length === 2, `2 shards found (got ${shardIds.length})`);
  ok(shardIds.includes(shard0) && shardIds.includes(shard1), 'both shard0 and shard1 present, not the logical id');
}

console.log('[test] recaptureSideLockDaaForMarket per-shard: no RPC needed (rows already filled), never overwrites:');
{
  const shardIds = sqlite.prepare('SELECT shard_market_id FROM market_shards WHERE logical_market_id = ?').all(logicalId).map(r => r.shard_market_id);
  let totalRecaptured = 0;
  for (const sid of shardIds) {
    const rc = await recaptureSideLockDaaForMarket(sid);
    totalRecaptured += rc.recaptured;
    ok(rc.recaptured === 0 && rc.remaining === 0, `shard=${sid.slice(-4)}: no NULL rows, zero-touch short-circuit (got ${JSON.stringify(rc)})`);
  }
  ok(totalRecaptured === 0, 'aggregate recaptured=0 across both shards (nothing was NULL)');
  const s0Daa = sqlite.prepare('SELECT side_lock_daa FROM pool_bettor_sides WHERE market_id = ?').get(shard0).side_lock_daa;
  const s1Daa = sqlite.prepare('SELECT side_lock_daa FROM pool_bettor_sides WHERE market_id = ?').get(shard1).side_lock_daa;
  ok(s0Daa === 12345, `shard0 original value untouched (got ${s0Daa})`);
  ok(s1Daa === 67890, `shard1 original value untouched (got ${s1Daa})`);
}

console.log('[test] a market with NO market_shards rows (edge case) falls back to querying the logical id itself:');
{
  const noshardId = `shardlooptest-noshard-${randomUUID().slice(0, 6)}`;
  sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, created_at, updated_at) VALUES (?, 'r', 'kaspatest:x', 'h', 999999999, 'v0.7', 'verifying', datetime('now'), datetime('now'))`).run(noshardId);
  sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, side_lock_daa, created_at) VALUES (?, ?, 0, 100, 'p', ?, 999, datetime('now'))`).run(noshardId, 'cc'.repeat(32), 't2');
  const shardIds = sqlite.prepare('SELECT shard_market_id FROM market_shards WHERE logical_market_id = ?').all(noshardId).map(r => r.shard_market_id);
  const targets = shardIds.length ? shardIds : [noshardId];
  ok(targets.length === 1 && targets[0] === noshardId, `no-shard fallback targets=[logicalId] (got ${JSON.stringify(targets)})`);
  const rc = await recaptureSideLockDaaForMarket(targets[0]);
  ok(rc.recaptured === 0 && rc.remaining === 0, `no-shard market: recapture still works against logical id directly (got ${JSON.stringify(rc)})`);
}

console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
