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
const { autoDetectConsolidateResume, verifyRedeemMatchesChainObservedOutput } = await import('../lib/pool-shard-settle.mjs');
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

console.log('[test] scenario C (K-18 §3.4, splice-authority not recompile): autoDetectConsolidateResume must return the already-spliced redeemHex bytes it computed during its genesis-walk, not just the pool value — this is what closes Codex MUST-FIX4 (consumer no longer needs to recompile via silverc to get spend-authority bytes). Verified with a stubbed getUtxos (function accepts it as an injected param — no real chain needed for this specific unit):');
{
  const marketId = `rdpooltest-c-${randomUUID().slice(0, 6)}`;
  const psRoot = 'ee'.repeat(32), predCommit = 'ff'.repeat(32);
  // dedicated fixture, NOT fakeRedeemHex(): autoDetectConsolidateResume does readBigInt64LE(2)/
  // writeBigInt64LE(2) on the real byte layout (offset 2, 8 bytes LE = consolidatedPool, matching
  // compilePayoutShardRedeem's actual PUSH8 state encoding) — needs a buffer with a KNOWN value at
  // that exact offset for this test's arithmetic to be self-consistent, unlike scenarios A/B which
  // only need SOME bytes to hash into SOME P2SH address.
  const genesisBuf = Buffer.alloc(40, 0); genesisBuf.writeBigInt64LE(20000000n, 2);
  const genesisRedeemHex = genesisBuf.toString('hex');
  seedMarket(marketId, { poolMerkleRoot: psRoot, predicateCommit: predCommit, consolidatedPoolSeed: '20000000', psOutpoint: `${'33'.repeat(32)}:0` });
  sqlite.prepare(`UPDATE payout_shards SET payout_redeem_hex = ? WHERE logical_market_id = ?`).run(genesisRedeemHex, marketId);
  // one shard with a known pool_value contribution
  sqlite.prepare(`UPDATE market_shards SET current_leaf_state = ? WHERE logical_market_id = ? AND shard_index = 0`).run(JSON.stringify({ pool_value: 5000000 }), marketId);
  const ps = sqlite.prepare('SELECT * FROM payout_shards WHERE logical_market_id = ?').get(marketId);

  // stub getUtxos: genesis address has nothing (forces the walk forward); shard0's candidate address
  // (genesis pool + 5000000) has a fake UTXO — deterministic, offline, no RPC.
  const fakeUtxo = { outpoint: { transactionId: '44'.repeat(32), index: 0 }, amount: '25000000' };
  const stubGetUtxos = async (addr) => (addr === expectedShard0Addr ? [fakeUtxo] : []);
  // compute the expected shard0 candidate address the same way the function does internally (genesis
  // bytes + splice consolidatedPool=25000000 at offset 2) so the stub can recognize it.
  await ensureReady();
  const kaspa = await import('kaspa-wasm');
  const _p2sh = (hex) => {
    const sb = kaspa.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(hex, 'hex')));
    return kaspa.addressFromScriptPublicKey(sb.createPayToScriptHashScript(), 'testnet-12').toString();
  };
  const splicedBuf = Buffer.from(genesisRedeemHex, 'hex'); splicedBuf.writeBigInt64LE(25000000n, 2);
  const expectedShard0Addr = _p2sh(splicedBuf.toString('hex'));

  const resumePoint = await autoDetectConsolidateResume({
    db: sqlite, getUtxos: stubGetUtxos, p2sh: _p2sh, logicalMarketId: marketId,
    payoutShard: { payout_redeem_hex: genesisRedeemHex, payout_ps_outpoint: ps.payout_ps_outpoint, payout_cov_id: ps.payout_cov_id },
  });

  ok(resumePoint != null, `autoDetectConsolidateResume finds the stubbed match (got: ${resumePoint ? 'found' : 'null — check stub wiring'})`);
  if (resumePoint) {
    ok(typeof resumePoint.redeemHex === 'string' && resumePoint.redeemHex.length > 0, 'resumePoint carries a redeemHex field (the new K-18 field, previously absent)');
    ok(resumePoint.redeemHex === splicedBuf.toString('hex'), 'returned redeemHex is byte-exact the spliced bytes (genesis template + consolidatedPool spliced at offset 2), matches what a consumer would have gotten from splice — NOT a recompile');
    const decoded = Buffer.from(resumePoint.redeemHex, 'hex').readBigInt64LE(2);
    ok(decoded === 25000000n, `redeemHex correctly encodes consolidatedPool=25000000 at the state offset (decoded: ${decoded})`);
    ok(resumePoint.pool === '25000000', `resumePoint.pool matches (${resumePoint.pool})`);
  }
}

console.log('[test] scenario D (Codex finding③, dust-poisoning defenses): autoDetectConsolidateResume must NOT treat an amount-mismatched UTXO, or multiple UTXOs at one candidate address, as a valid match — both are attacker-reachable false-positive vectors since candidate addresses are publicly derivable from genesis + known shard pool_values (anyone can compute the same walk and send dust to a future step\'s address). Verified offline via stubbed getUtxos:');
{
  const kaspa = await import('kaspa-wasm');
  const _p2sh = (hex) => {
    const sb = kaspa.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(hex, 'hex')));
    return kaspa.addressFromScriptPublicKey(sb.createPayToScriptHashScript(), 'testnet-12').toString();
  };

  console.log('  [D1] amount mismatch: a UTXO exists at the exact candidate address but its amount does NOT equal the theoretical consolidatedPool for that step (dust/unrelated deposit) — must be skipped, not trusted:');
  {
    const marketId = `rdpooltest-d1-${randomUUID().slice(0, 6)}`;
    const genesisBuf = Buffer.alloc(40, 0); genesisBuf.writeBigInt64LE(20000000n, 2);
    const genesisRedeemHex = genesisBuf.toString('hex');
    seedMarket(marketId, { poolMerkleRoot: 'a1'.repeat(32), predicateCommit: 'a2'.repeat(32), consolidatedPoolSeed: '20000000', psOutpoint: `${'55'.repeat(32)}:0` });
    sqlite.prepare(`UPDATE payout_shards SET payout_redeem_hex = ? WHERE logical_market_id = ?`).run(genesisRedeemHex, marketId);
    sqlite.prepare(`UPDATE market_shards SET current_leaf_state = ? WHERE logical_market_id = ? AND shard_index = 0`).run(JSON.stringify({ pool_value: 5000000 }), marketId);
    const ps = sqlite.prepare('SELECT * FROM payout_shards WHERE logical_market_id = ?').get(marketId);
    const splicedBuf = Buffer.from(genesisRedeemHex, 'hex'); splicedBuf.writeBigInt64LE(25000000n, 2);
    const candidateAddr = _p2sh(splicedBuf.toString('hex'));
    // dust UTXO sitting at the CORRECT candidate address but with the WRONG amount (1 sompi, not 25000000)
    const dustUtxo = { outpoint: { transactionId: '66'.repeat(32), index: 0 }, amount: '1' };
    const stubGetUtxos = async (addr) => (addr === candidateAddr ? [dustUtxo] : []);
    const resumePoint = await autoDetectConsolidateResume({
      db: sqlite, getUtxos: stubGetUtxos, p2sh: _p2sh, logicalMarketId: marketId,
      payoutShard: { payout_redeem_hex: genesisRedeemHex, payout_ps_outpoint: ps.payout_ps_outpoint, payout_cov_id: ps.payout_cov_id },
    });
    ok(resumePoint === null, `dust at the right address with the wrong amount is rejected, function correctly falls through to null (fail-closed, same as "nothing found anywhere") — got: ${JSON.stringify(resumePoint)}`);
  }

  console.log('  [D2] multiple UTXOs at one candidate address (should never happen under normal covenant operation — 2+ concurrent UTXOs at a deterministically-derivable address is itself an anomaly) — must be skipped, not blindly resolved to utxos[0]:');
  {
    const marketId = `rdpooltest-d2-${randomUUID().slice(0, 6)}`;
    const genesisBuf = Buffer.alloc(40, 0); genesisBuf.writeBigInt64LE(20000000n, 2);
    const genesisRedeemHex = genesisBuf.toString('hex');
    seedMarket(marketId, { poolMerkleRoot: 'b1'.repeat(32), predicateCommit: 'b2'.repeat(32), consolidatedPoolSeed: '20000000', psOutpoint: `${'77'.repeat(32)}:0` });
    sqlite.prepare(`UPDATE payout_shards SET payout_redeem_hex = ? WHERE logical_market_id = ?`).run(genesisRedeemHex, marketId);
    sqlite.prepare(`UPDATE market_shards SET current_leaf_state = ? WHERE logical_market_id = ? AND shard_index = 0`).run(JSON.stringify({ pool_value: 5000000 }), marketId);
    const ps = sqlite.prepare('SELECT * FROM payout_shards WHERE logical_market_id = ?').get(marketId);
    const splicedBuf = Buffer.from(genesisRedeemHex, 'hex'); splicedBuf.writeBigInt64LE(25000000n, 2);
    const candidateAddr = _p2sh(splicedBuf.toString('hex'));
    // two UTXOs at the same candidate address, one of which HAS the theoretically-correct amount —
    // still must not be trusted, since which one is "real" can't be determined from presence alone.
    const utxoReal = { outpoint: { transactionId: '88'.repeat(32), index: 0 }, amount: '25000000' };
    const utxoDust = { outpoint: { transactionId: '99'.repeat(32), index: 0 }, amount: '1' };
    const stubGetUtxos = async (addr) => (addr === candidateAddr ? [utxoReal, utxoDust] : []);
    const resumePoint = await autoDetectConsolidateResume({
      db: sqlite, getUtxos: stubGetUtxos, p2sh: _p2sh, logicalMarketId: marketId,
      payoutShard: { payout_redeem_hex: genesisRedeemHex, payout_ps_outpoint: ps.payout_ps_outpoint, payout_cov_id: ps.payout_cov_id },
    });
    ok(resumePoint === null, `two UTXOs at the same candidate address is rejected wholesale (not "pick utxos[0] and hope"), falls through to null — got: ${JSON.stringify(resumePoint)}`);
  }
}

console.log('[test] scenario E (#28 line423, Bettor #ubmne2.1): verifyRedeemMatchesChainObservedOutput — the shared helper extracted from Tier1 and reused by settleMarketLive\'s claim-thread consolidatedPool verification. Directly tests the primitive both call sites now depend on: does a candidate redeem\'s p2sh address match what kaspa_tx_log actually observed at a given outpoint:');
{
  const kaspa = await import('kaspa-wasm');
  const _p2sh = (hex) => {
    const sb = kaspa.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(hex, 'hex')));
    return kaspa.addressFromScriptPublicKey(sb.createPayToScriptHashScript(), 'testnet-12').toString();
  };
  await ensureReady();

  console.log('  [E1] match: kaspa_tx_log has a row for the outpoint whose observed output address equals the candidate redeem\'s p2sh address — verified true:');
  {
    const txid = 'aa'.repeat(32);
    const candidateHex = Buffer.from('e1-candidate-bytes-0000000000000000').toString('hex');
    const addr = _p2sh(candidateHex);
    sqlite.prepare(`INSERT INTO kaspa_tx_log (tx_id, outputs_json, observed_at) VALUES (?, ?, datetime('now'))`)
      .run(txid, JSON.stringify([{ address: addr, amount_sompi: '123' }]));
    const result = await verifyRedeemMatchesChainObservedOutput({ db: sqlite, p2sh: _p2sh, candidateRedeemHex: candidateHex, outpointTxid: txid, outpointIdx: 0 });
    ok(result === true, `matching candidate verified true (got: ${result})`);
  }

  console.log('  [E2] mismatch: kaspa_tx_log has a row for the outpoint but the observed address is for a DIFFERENT script than the candidate — verified false, not presence-trusted, and does NOT fall back to getUtxos (confirmed mismatch is not "pick whichever source is convenient"):');
  {
    const txid = 'bb'.repeat(32);
    const candidateHex = Buffer.from('e2-candidate-bytes-0000000000000000').toString('hex');
    sqlite.prepare(`INSERT INTO kaspa_tx_log (tx_id, outputs_json, observed_at) VALUES (?, ?, datetime('now'))`)
      .run(txid, JSON.stringify([{ address: 'kaspatest:some-unrelated-address-not-the-candidate', amount_sompi: '123' }]));
    let fallbackCalls = 0;
    const spyGetUtxos = async () => { fallbackCalls++; return []; };
    const result = await verifyRedeemMatchesChainObservedOutput({ db: sqlite, p2sh: _p2sh, candidateRedeemHex: candidateHex, outpointTxid: txid, outpointIdx: 0, getUtxos: spyGetUtxos });
    ok(result === false, `mismatched candidate verified false, not treated as fresh just because a row exists (got: ${result})`);
    ok(fallbackCalls === 0, `confirmed mismatch must NOT call getUtxos fallback (got ${fallbackCalls} calls)`);
  }

  console.log('  [E3] indexer gap, no getUtxos passed: no kaspa_tx_log row at all for the outpoint — verified false (fail-closed default, matches _inferWinDirectionFromChain\'s "F3 账" convention, never treated as an implicit pass). Backward-compat baseline: identical outcome to before this function had a getUtxos param:');
  {
    const txid = 'cc'.repeat(32);   // never inserted into kaspa_tx_log
    const candidateHex = Buffer.from('e3-candidate-bytes-0000000000000000').toString('hex');
    const result = await verifyRedeemMatchesChainObservedOutput({ db: sqlite, p2sh: _p2sh, candidateRedeemHex: candidateHex, outpointTxid: txid, outpointIdx: 0 });
    ok(result === false, `missing indexer row verified false, not an implicit pass (got: ${result})`);
  }

  console.log('  [E4] indexer gap, getUtxos fallback rescues it: no kaspa_tx_log row (indexer never recorded this txid — permanent miss, not lag), but the candidate address\'s current live UTXO set has exactly this outpoint — verified true, inconclusive is not the same as confirmed-false:');
  {
    const txid = 'dd'.repeat(32);   // never inserted into kaspa_tx_log
    const candidateHex = Buffer.from('e4-candidate-bytes-0000000000000000').toString('hex');
    const candidateAddr = _p2sh(candidateHex);
    const stubGetUtxos = async (addr) => (addr === candidateAddr
      ? [{ entry: { outpoint: { transactionId: txid, index: 0 }, amount: '123' } }] : []);
    const result = await verifyRedeemMatchesChainObservedOutput({ db: sqlite, p2sh: _p2sh, candidateRedeemHex: candidateHex, outpointTxid: txid, outpointIdx: 0, getUtxos: stubGetUtxos });
    ok(result === true, `indexer-gap case rescued by getUtxos fallback finding the exact outpoint (got: ${result})`);
  }

  console.log('  [E5] indexer gap, getUtxos fallback also finds nothing: neither source has this outpoint — verified false, same as before (not worse, not better — fallback only rescues, never makes it stricter):');
  {
    const txid = 'ee'.repeat(32);   // never inserted into kaspa_tx_log
    const candidateHex = Buffer.from('e5-candidate-bytes-0000000000000000').toString('hex');
    const stubGetUtxos = async () => [];   // candidate address has no live UTXOs at all
    const result = await verifyRedeemMatchesChainObservedOutput({ db: sqlite, p2sh: _p2sh, candidateRedeemHex: candidateHex, outpointTxid: txid, outpointIdx: 0, getUtxos: stubGetUtxos });
    ok(result === false, `both sources inconclusive → false, not a hang/crash (got: ${result})`);
  }
}

console.log(fails === 0 ? `\n✅ all checks passed` : `\n❌ ${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);
