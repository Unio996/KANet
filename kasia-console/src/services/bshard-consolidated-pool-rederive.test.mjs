// bshard-consolidated-pool-rederive.test.mjs — regression guard for P0(#28 MUST-FIX③, NWT GREEN f51cb938,
// docs/2026-07-21-p0-consolidated-pool-rederive-implementation-plan.md): consolidateAndBuildPsState's
// "already consolidated" branch must never silently fall back to predictedPool when its DB-cached
// payout_redeem_hex/payout_ps_outpoint cannot be independently chain-verified — it must fail-closed
// (throw + consolidated_pool_verify_drift event), not guess. Covers the 3rd regression scenario NWT
// requested (consolidate-mid-restart: DB cache stale/unreachable) via two sub-cases that both resolve
// through the real Tier1(kaspa_tx_log freshness check)→Tier2(autoDetectConsolidateResume genesis-walk)
// path against a REAL local kaspad connection (not mocked) — for fabricated addresses that genuinely
// never received funds, "no live UTXO found" is a true chain-observed fact, not a stub.
// Scope note (honest, not overclaimed): this covers the fail-closed/drift path for real. The POSITIVE
// Tier2 path (genesis-walk actually finding a real consolidatedPool via live funded shard UTXOs) needs
// a live-fire test with real testnet funds moving through an actual consolidate sequence — that is a
// pre-money-path-signoff gate item, not something faked here with unrealistic mocks (memory:
// feedback-ship-features-with-live-fire-test — money-path changes need a real live-fire run, not just
// a green offline test).
// Run: cd kasia-console && node src/services/bshard-consolidated-pool-rederive.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._RDPOOL_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j1_rdpool_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: {
      ...process.env, DB_PATH: tmpDb, _RDPOOL_TEST_BOOTSTRAPPED: '1',
      KASPA_RPC_URL: process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210',
      KASPA_NETWORK: process.env.KASPA_NETWORK || 'testnet-12',
      BROKER_RELAY_ID: process.env.BROKER_RELAY_ID || 'test-broker-relay-id-not-used',
    },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { consolidateAndBuildPsState, ensureReady } = await import('./bshard-settle-daemon.mjs');
const { randomUUID } = await import('node:crypto');

// NOTE: deliberately NOT using compilePayoutShardRedeem() here — it shells out to silverc, which is
// pinned per-machine (D:/silverscript/versioned-builds/) and absent on nodes that only run/read chain
// (this machine included, see memory reference-silverscript-pinned-build-not-on-every-node). This test
// only exercises the Tier1/Tier2 chain-comparison logic in consolidateAndBuildPsState, which needs SOME
// deterministic bytes to hash into a P2SH address (via _p2shCache/kaspa-wasm ScriptBuilder, pure crypto,
// no opcode-validity requirement) — it does not need a semantically valid PayoutShard script. Using an
// arbitrary deterministic buffer keeps this test runnable on any node regardless of silverc availability.
function fakeRedeemHex(seed) { return Buffer.from(`fakeredeem-${seed}-${'00'.repeat(20)}`).toString('hex'); }

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

sqlite.pragma('foreign_keys = OFF');
await ensureReady();   // loads kaspa-wasm (needed by _p2shCache inside consolidateAndBuildPsState) — no RPC yet

function seedMarket(marketId, { poolMerkleRoot, predicateCommit, consolidatedPoolSeed, psOutpoint }) {
  sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, created_at, updated_at)
    VALUES (?, 'r', 'kaspatest:x', 'h', 999999999, 'v0.7', 'verifying', datetime('now'), datetime('now'))`).run(marketId);
  // two shards, both already past sealed/open → needConsolidate=false → forces the "already consolidated" branch.
  const s0 = `${marketId}-s0`, s1 = `${marketId}-s1`;
  sqlite.prepare(`INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, status, created_at, current_leaf_state) VALUES (?, 0, ?, 'kaspatest:s0', 'settled', datetime('now'), ?)`).run(marketId, s0, JSON.stringify({ pool_value: 0 }));
  sqlite.prepare(`INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, status, created_at, current_leaf_state) VALUES (?, 1, ?, 'kaspatest:s1', 'settled', datetime('now'), ?)`).run(marketId, s1, JSON.stringify({ pool_value: 0 }));
  const redeemHex = fakeRedeemHex(marketId);
  sqlite.prepare(`INSERT INTO payout_shards (logical_market_id, payout_cov_id, payout_ps_addr, payout_ps_outpoint, payout_redeem_hex, pool_merkle_root, predicate_commit, created_at)
    VALUES (?, 'covtest', 'kaspatest:psaddr', ?, ?, ?, ?, strftime('%s','now'))`).run(marketId, psOutpoint, redeemHex, poolMerkleRoot, predicateCommit);
  return { redeemHex };
}

const ctx = { alert: (mid, reason) => { ctx._lastAlert = { mid, reason }; } };

console.log('[test] scenario A: no kaspa_tx_log row at all for the cached outpoint (indexer gap, same shape as consolidate-mid-restart where the DB write never committed) → Tier1 skips straight to Tier2, Tier2 finds no live UTXO anywhere (real chain check, fabricated address genuinely never funded) → fail-closed throw, no silent predictedPool fallback:');
{
  const marketId = `rdpooltest-a-${randomUUID().slice(0, 6)}`;
  const psRoot = 'aa'.repeat(32), predCommit = 'bb'.repeat(32);
  const fakeOutpoint = `${'11'.repeat(32)}:0`;   // txid never broadcast — genuinely absent from kaspa_tx_log AND from live chain
  const { redeemHex } = seedMarket(marketId, { poolMerkleRoot: psRoot, predicateCommit: predCommit, consolidatedPoolSeed: '20000000', psOutpoint: fakeOutpoint });
  const ps = sqlite.prepare('SELECT * FROM payout_shards WHERE logical_market_id = ?').get(marketId);

  let threw = null;
  try { await consolidateAndBuildPsState(marketId, ps, ctx); }
  catch (e) { threw = e; }

  ok(threw != null, `throws instead of returning a guessed consolidatedPool (got: ${threw ? 'threw' : 'no throw — REGRESSION'})`);
  ok(threw && /consolidated_pool 无法链上验证/.test(threw.message), `error message carries fail-closed marker (got: ${threw?.message})`);
  ok(ctx._lastAlert && ctx._lastAlert.mid === marketId, 'ctx.alert() was called for this market (loud, not silent)');
  const ev = sqlite.prepare(`SELECT * FROM events WHERE event_type = 'consolidated_pool_verify_drift' AND summary LIKE ?`).get(`%${marketId.slice(-8)}%`);
  ok(!!ev, 'consolidated_pool_verify_drift event was written to events table');
  if (ev) {
    const payload = JSON.parse(ev.payload_json);
    ok(payload.marketId === marketId, 'drift event payload.marketId matches');
    ok(payload.redeemFresh === false, 'drift event records redeemFresh=false (Tier1 correctly found no kaspa_tx_log row)');
    ok(payload.driftReason === 'full_shard_walk_no_live_utxo' || payload.driftReason === 'genesis_still_unspent_contradicts_consolidated_status',
      `drift event records a specific driftReason for post-hoc diagnosis (NWT observation b), got: ${payload.driftReason}`);
  }
}

console.log('[test] scenario B: kaspa_tx_log DOES have a row for the cached outpoint, but its on-chain address does NOT match what payout_redeem_hex compiles to (proves Tier1 is a real independent check, not vacuously trusting presence-of-row) → still falls to Tier2 → still fail-closed (no live funds anywhere for this fabricated market either):');
{
  const marketId = `rdpooltest-b-${randomUUID().slice(0, 6)}`;
  const psRoot = 'cc'.repeat(32), predCommit = 'dd'.repeat(32);
  const fakeTxid = '22'.repeat(32);
  const fakeOutpoint = `${fakeTxid}:0`;
  seedMarket(marketId, { poolMerkleRoot: psRoot, predicateCommit: predCommit, consolidatedPoolSeed: '20000000', psOutpoint: fakeOutpoint });
  // seed a kaspa_tx_log row for this exact txid, but with a WRONG/unrelated observed address at index 0 —
  // simulates payout_redeem_hex encoding a stale consolidatedPool (real chain output exists, but for a
  // different script than what the DB-cached redeem hex would compile to).
  sqlite.prepare(`INSERT INTO kaspa_tx_log (tx_id, outputs_json, observed_at) VALUES (?, ?, datetime('now'))`)
    .run(fakeTxid, JSON.stringify([{ address: 'kaspatest:totally-unrelated-address-not-matching-redeem-hex', amount_sompi: '999' }]));
  const ps = sqlite.prepare('SELECT * FROM payout_shards WHERE logical_market_id = ?').get(marketId);

  let threw = null;
  try { await consolidateAndBuildPsState(marketId, ps, ctx); }
  catch (e) { threw = e; }

  ok(threw != null, `throws (kaspa_tx_log row present but address mismatch must NOT be treated as fresh; got: ${threw ? 'threw' : 'no throw — REGRESSION, Tier1 wrongly trusted a mismatched row'})`);
  const ev = sqlite.prepare(`SELECT * FROM events WHERE event_type = 'consolidated_pool_verify_drift' AND summary LIKE ?`).get(`%${marketId.slice(-8)}%`);
  ok(!!ev, 'drift event written for scenario B too');
  if (ev) {
    const payload = JSON.parse(ev.payload_json);
    ok(payload.redeemFresh === false, 'drift event correctly records redeemFresh=false despite kaspa_tx_log row existing (address mismatch caught, not presence-trusted)');
  }
}

console.log(fails === 0 ? `\n✅ all checks passed` : `\n❌ ${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);
