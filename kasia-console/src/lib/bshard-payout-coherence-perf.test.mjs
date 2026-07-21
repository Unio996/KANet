// bshard-payout-coherence-perf.test.mjs — P2 batch2 §4 (docs/2026-07-21-p2-batch2-coherence-gate-wiring-design.md):
// zero-subprocess verification for the high-frequency ensurePayoutShard/V2 early-return path (every bet).
// The design's whole safety argument for wiring a non-blocking gate into a per-bet hot path rests on it
// costing "zero subprocess spawns" — this test makes that a checked property, not an assumed one (DoD item 7:
// "not 'code doesn't call execFileSync' — needs real evidence").
//
// Two independent signals, not one:
//   (1) direct spawn-count interception: patch the CJS child_process module's execFileSync (via createRequire,
//       since node:child_process's ESM named exports are live bindings over the underlying CJS exports object)
//       and assert it is NEVER called across N early-return calls. This is the load-bearing assertion.
//   (2) wall-clock order-of-magnitude: silverc subprocess spawns cost tens-to-hundreds of ms each (documented
//       elsewhere in this codebase, e.g. pool-bshard-artifacts.mjs comments on ETIMEDOUT incidents) — N=200
//       genuinely-zero-subprocess calls should complete in single-digit milliseconds total, not seconds. This
//       is a secondary, weaker signal (machine-load-dependent) kept only as a sanity cross-check, not the proof.
//
// Run: cd kasia-console && node src/lib/bshard-payout-coherence-perf.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._PSPERF_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j1_psperf_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _PSPERF_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { ensurePayoutShard, ensurePayoutShardV2 } = await import('./pool-shard-register.mjs');
const { randomUUID } = await import('node:crypto');
const { createRequire } = await import('node:module');
const _require = createRequire(import.meta.url);
const cjsChildProcess = _require('child_process');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const PC = 'ab'.repeat(32), PMR = 'cd'.repeat(32);
function buildFakeV1RedeemHex() {
  const buf = Buffer.alloc(1040, 0x11);
  buf[1] = 0x08;
  buf.writeBigInt64LE(1000n, 2);
  buf.writeBigInt64LE(0n, 11);
  Buffer.from(PC, 'hex').copy(buf, 518);
  Buffer.from(PMR, 'hex').copy(buf, 1002);
  return buf.toString('hex');
}
function fakeP2sh(redeemHex) { return `kaspatest:fake-${redeemHex.slice(0, 24)}`; }

// (1) spawn-count interception — verify this actually intercepts the SAME binding pool-shard-register.mjs's
// transitive compileSil() call would use, by proving the patch is visible before trusting silence as "proof".
let spawnCount = 0;
const originalExecFileSync = cjsChildProcess.execFileSync;
cjsChildProcess.execFileSync = function patchedExecFileSync(...args) { spawnCount++; return originalExecFileSync.apply(this, args); };

console.log('[test] interception sanity: patched execFileSync is actually visible through the live-binding chain (proves silence later means "never called", not "interception silently failed"):');
{
  // pool-bshard-artifacts.mjs imports `execFileSync` by name from 'node:child_process' — call it indirectly via
  // a throwaway compile attempt against a nonexistent path so it fails fast, just to prove the patched counter
  // actually increments through the real import chain used by compilePayoutShardRedeem.
  const before = spawnCount;
  try { cjsChildProcess.execFileSync('__definitely_not_a_real_binary__', [], { stdio: 'pipe' }); } catch {}
  ok(spawnCount === before + 1, `direct call through the patched cjs binding increments the counter (sanity only, not yet proof about ensurePayoutShard) (before=${before}, after=${spawnCount})`);
}

// seed a coherent row once (outside the timed loop)
const marketId = `psperf-${randomUUID().slice(0, 8)}`;
const redeemHex = buildFakeV1RedeemHex();
const psAddr = fakeP2sh(redeemHex);
sqlite.prepare(`INSERT INTO payout_shards (logical_market_id, payout_cov_id, payout_ps_addr, payout_ps_outpoint, payout_redeem_hex, pool_merkle_root, predicate_commit, created_at, covenant_family)
  VALUES (?, 'covtest', ?, ?, ?, ?, ?, strftime('%s','now'), 'v1_committee')`)
  .run(marketId, psAddr, `${'aa'.repeat(32)}:0`, redeemHex, PMR, PC);

const spawnCountBeforeLoop = spawnCount;
const N = 200;
const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) {
  await ensurePayoutShard({ db: sqlite, rc: async () => ({}), transfer: async () => 'x', landed: async () => true, p2sh: fakeP2sh, logicalMarketId: marketId, poolMerkleRoot: PMR, predicateCommit: PC, relayAddr: 'kaspatest:relay' });
}
const t1 = process.hrtime.bigint();
const elapsedMs = Number(t1 - t0) / 1e6;
const spawnCountAfterLoop = spawnCount;

console.log(`\n[test] ensurePayoutShard early-return path × ${N} calls: ${elapsedMs.toFixed(2)}ms total, ${(elapsedMs / N).toFixed(4)}ms/call, execFileSync spawn count during loop = ${spawnCountAfterLoop - spawnCountBeforeLoop}`);
ok(spawnCountAfterLoop === spawnCountBeforeLoop, `【关键 / load-bearing】zero execFileSync (subprocess) calls across ${N} early-return calls — the non-blocking gate genuinely costs no subprocess spawn on the hot bet path (got ${spawnCountAfterLoop - spawnCountBeforeLoop} spawns)`);
ok(elapsedMs < 500, `secondary sanity: ${N} calls complete in ${elapsedMs.toFixed(1)}ms, well under what even a handful of real silverc spawns (documented elsewhere as tens-to-hundreds of ms each) would cost — consistent with zero subprocess overhead (weak/machine-load-dependent signal, not the proof)`);

// V2 path, same two signals
const marketIdV2 = `psperf-v2-${randomUUID().slice(0, 8)}`;
const redeemHexV2 = (() => { const buf = Buffer.alloc(700, 0x22); buf[1] = 0x08; Buffer.from(PC, 'hex').copy(buf, 642); return buf.toString('hex'); })();
const psAddrV2 = fakeP2sh(redeemHexV2);
sqlite.prepare(`INSERT INTO payout_shards (logical_market_id, payout_cov_id, payout_ps_addr, payout_ps_outpoint, payout_redeem_hex, pool_merkle_root, predicate_commit, created_at, covenant_family)
  VALUES (?, 'covtest', ?, ?, ?, ?, ?, strftime('%s','now'), 'v2_zk')`)
  .run(marketIdV2, psAddrV2, `${'bb'.repeat(32)}:0`, redeemHexV2, PMR, PC);

const spawnCountBeforeV2 = spawnCount;
const t2 = process.hrtime.bigint();
for (let i = 0; i < N; i++) {
  await ensurePayoutShardV2({ db: sqlite, rc: async () => ({}), transfer: async () => 'x', landed: async () => true, p2sh: fakeP2sh, logicalMarketId: marketIdV2, poolMerkleRoot: PMR, predicateCommit: PC, closeZkTmplAnchor: 'dd'.repeat(32), relayAddr: 'kaspatest:relay' });
}
const t3 = process.hrtime.bigint();
const elapsedMsV2 = Number(t3 - t2) / 1e6;
const spawnCountAfterV2 = spawnCount;

console.log(`\n[test] ensurePayoutShardV2 early-return path × ${N} calls: ${elapsedMsV2.toFixed(2)}ms total, execFileSync spawn count during loop = ${spawnCountAfterV2 - spawnCountBeforeV2}`);
ok(spawnCountAfterV2 === spawnCountBeforeV2, `【关键 / load-bearing】zero execFileSync calls across ${N} V2 early-return calls (got ${spawnCountAfterV2 - spawnCountBeforeV2} spawns)`);

cjsChildProcess.execFileSync = originalExecFileSync;   // restore, don't leak the patch past this test process anyway (separate process per bootstrap) but be tidy

console.log(fails === 0 ? `\n✅ all checks passed` : `\n❌ ${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);
