// preprune-capture-worker.test.mjs — regression guard for K-17 worker (2026-07-17, J2, docs/
// 2026-07-17-preprune-capture-invariant-k16-gate-design.md v1.1, NWT GREEN dd6496b0/369f6679).
// Mirrors bshard-recapture-shard-loop.test.mjs's self-bootstrap pattern (fresh migrated temp DB).
// Run: cd kasia-console && node src/services/preprune-capture-worker.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._PREPRUNE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_preprune_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: {
      ...process.env, DB_PATH: tmpDb, _PREPRUNE_TEST_BOOTSTRAPPED: '1',
      KASPA_RPC_URL: process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210',
      KASPA_NETWORK: process.env.KASPA_NETWORK || 'testnet-12',
    },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { randomUUID } = await import('node:crypto');
const { _tick, _hasBeenMarkedUnrecoverable, _markUnrecoverableIfBeyondFloor, _coverageFloor, _resolveLogicalMarket } = await import('./preprune-capture-worker.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

sqlite.pragma('foreign_keys = OFF');

function mkMarket(id, { deadline_daa = null, status = 'verifying' } = {}) {
  sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, deadline_daa, protocol_version, protocol_status, created_at, updated_at)
    VALUES (?, 'r', 'kaspatest:x', 'h', 999999999, ?, 'v0.7', ?, datetime('now'), datetime('now'))`).run(id, deadline_daa, status);
}

console.log('[test] A: already-filled rows are a zero-touch short-circuit (no RPC needed), heartbeat written:');
{
  const id = `preprunetest-a-${randomUUID().slice(0, 6)}`;
  mkMarket(id);
  sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, side_lock_daa, created_at) VALUES (?, ?, 0, 100, 'p', ?, 12345, datetime('now'))`).run(id, 'aa'.repeat(32), 't-a');
  const r = await _tick();
  ok(!r.error, `tick completes without error (got ${JSON.stringify(r)})`);
  const hb = sqlite.prepare('SELECT tick_count FROM spc_prune_capture_heartbeat WHERE id = 1').get();
  ok(hb && hb.tick_count >= 1, `heartbeat row written after tick (got ${JSON.stringify(hb)})`);
}

console.log('[test] B: terminal-status market with NULL side_lock_daa is NOT scanned (data loss on a dead market is not a money-path risk):');
{
  const id = `preprunetest-b-${randomUUID().slice(0, 6)}`;
  mkMarket(id, { status: 'cancelled' });
  sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, side_lock_daa, created_at) VALUES (?, ?, 0, 100, 'p', ?, NULL, datetime('now'))`).run(id, 'bb'.repeat(32), 't-b');
  const before = sqlite.prepare('SELECT tick_count FROM spc_prune_capture_heartbeat WHERE id = 1').get().tick_count;
  await _tick();
  // Row must still be NULL (worker never touched it — recapture on a terminal market is skipped entirely,
  // this is not testing recapture correctness, it's testing the terminal-status filter fired at all).
  const row = sqlite.prepare('SELECT side_lock_daa FROM pool_bettor_sides WHERE market_id = ?').get(id);
  ok(row.side_lock_daa === null, 'cancelled market row remains untouched (terminal-status skip fired)');
  const after = sqlite.prepare('SELECT tick_count FROM spc_prune_capture_heartbeat WHERE id = 1').get().tick_count;
  ok(after === before + 1, 'heartbeat still advances even though this market was skipped');
}

console.log('[test] C: _hasBeenMarkedUnrecoverable / _markUnrecoverableIfBeyondFloor — persistent skip, not the 1h alert-dedup window:');
{
  const id = `preprunetest-c-${randomUUID().slice(0, 6)}`;
  ok(_hasBeenMarkedUnrecoverable(id) === false, 'fresh market id: not yet marked unrecoverable');

  // No spc_daa_index_coverage rows exist in this fresh DB → _coverageFloor() returns null →
  // _markUnrecoverableIfBeyondFloor must no-op (honest: "don't know the floor" != "confirmed unrecoverable").
  mkMarket(id, { deadline_daa: 100 });
  const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(id);
  ok(_coverageFloor() === null, 'no spc_daa_index_coverage rows in fresh DB: floor is null');
  _markUnrecoverableIfBeyondFloor(market, 3);
  ok(_hasBeenMarkedUnrecoverable(id) === false, 'floor unknown: does NOT mark unrecoverable (fail-loud honesty, not guess)');

  // Seed a coverage row so floor is known and ABOVE this market's deadline_daa (structurally unreachable).
  sqlite.prepare('INSERT INTO spc_daa_index_coverage (start_daa, end_daa) VALUES (500, 1000)').run();
  ok(_coverageFloor() === 500, 'coverage floor now resolvable from seeded row');
  _markUnrecoverableIfBeyondFloor(market, 3);
  ok(_hasBeenMarkedUnrecoverable(id) === true, 'deadline_daa(100) < floor(500): now marked unrecoverable');

  // Second call within the same hour must not duplicate the event row (1h alert-dedup, separate from the
  // persistent _hasBeenMarkedUnrecoverable skip which never expires).
  const countBefore = sqlite.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='side_lock_daa_unrecoverable' AND payload_json LIKE ?`).get(`%"marketId":"${id}"%`).c;
  _markUnrecoverableIfBeyondFloor(market, 3);
  const countAfter = sqlite.prepare(`SELECT COUNT(*) c FROM events WHERE event_type='side_lock_daa_unrecoverable' AND payload_json LIKE ?`).get(`%"marketId":"${id}"%`).c;
  ok(countAfter === countBefore, `alert-dedup: repeated calls within 1h don't spam events (before=${countBefore} after=${countAfter})`);
}

console.log('[test] D: once marked unrecoverable, _tick() skips the market entirely (no wasted recapture attempt):');
{
  const id = `preprunetest-d-${randomUUID().slice(0, 6)}`;
  mkMarket(id, { deadline_daa: 100 });
  sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, side_lock_daa, created_at) VALUES (?, ?, 0, 100, 'p', ?, NULL, datetime('now'))`).run(id, 'cc'.repeat(32), 't-d');
  const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(id);
  _markUnrecoverableIfBeyondFloor(market, 1); // floor(500) already seeded above, deadline_daa(100) < floor
  ok(_hasBeenMarkedUnrecoverable(id) === true, 'setup: market is marked unrecoverable before this tick');
  const r = await _tick();
  ok(!r.error, `tick with a marked-unrecoverable market present completes cleanly (got ${JSON.stringify(r)})`);
}

console.log('[test] E: _resolveLogicalMarket falls back correctly for both shard and non-shard ids:');
{
  const logicalId = `preprunetest-e-${randomUUID().slice(0, 6)}`;
  const shardId = `${logicalId}-s0`;
  mkMarket(logicalId);
  sqlite.prepare(`INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, status, created_at) VALUES (?, 0, ?, 'kaspatest:s0', 'settled', datetime('now'))`).run(logicalId, shardId);
  const viaShard = _resolveLogicalMarket(shardId);
  ok(viaShard && viaShard.id === logicalId, `shard id resolves to logical market (got ${viaShard?.id})`);
  const directId = `preprunetest-e2-${randomUUID().slice(0, 6)}`;
  mkMarket(directId);
  const direct = _resolveLogicalMarket(directId);
  ok(direct && direct.id === directId, `non-shard id resolves to itself (got ${direct?.id})`);
}

console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
