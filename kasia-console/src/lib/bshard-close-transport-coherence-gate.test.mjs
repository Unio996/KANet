// bshard-close-transport-coherence-gate.test.mjs — regression guard for P2 batch2 §1 (K-18 §3.3 gate
// wired into buildProposeCloseRequestV2, docs/2026-07-21-p2-batch2-coherence-gate-wiring-design.md):
// the close-transport V2 entry is a low-frequency, pre-spend point → blocking (tier=full). This test
// proves the gate throws BEFORE any relay command/consolidate/signing attempt for an incoherent row —
// it does not attempt the positive (coherent → proceeds to build the real request) path, which needs a
// live relay + committee + real chain state and belongs to live-fire testing (same scope boundary P0's
// test file already documented for its own positive Tier2 path).
//
// Run: cd kasia-console && node src/lib/bshard-close-transport-coherence-gate.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._CLOSEGATE_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j1_closegate_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: {
      ...process.env, DB_PATH: tmpDb, _CLOSEGATE_TEST_BOOTSTRAPPED: '1',
      KASPA_RPC_URL: process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210',
      KASPA_NETWORK: process.env.KASPA_NETWORK || 'testnet-12',
      BROKER_RELAY_ID: process.env.BROKER_RELAY_ID || 'test-broker-relay-id-not-used',
    },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { buildProposeCloseRequestV2 } = await import('./bshard-close-transport.mjs');
const { randomUUID } = await import('node:crypto');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

function seedMinimalMarket(marketId, { covenantFamily }) {
  sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, created_at, updated_at)
    VALUES (?, 'r', 'kaspatest:x', 'h', 999999999, 'v0.7', 'verifying', datetime('now'), datetime('now'))`).run(marketId);
  const outpoint = `${'aa'.repeat(32)}:0`;
  sqlite.prepare(`INSERT INTO payout_shards (logical_market_id, payout_cov_id, payout_ps_addr, payout_ps_outpoint, payout_redeem_hex, pool_merkle_root, predicate_commit, created_at, covenant_family)
    VALUES (?, 'covtest', 'kaspatest:whatever', ?, ?, 'pm', 'pc', strftime('%s','now'), ?)`)
    .run(marketId, outpoint, Buffer.from('not-a-real-covenant-script').toString('hex'), covenantFamily);
}

console.log('[test] covenant_family=unknown → gate FAILs at step(a) before any relay/consolidate attempt, throw carries K-18 §3.3 marker:');
{
  const marketId = `closegatetest-${randomUUID().slice(0, 8)}`;
  seedMinimalMarket(marketId, { covenantFamily: 'unknown' });
  let threw = null;
  try {
    await buildProposeCloseRequestV2(marketId, { winningDirection: 0, endBlockHash: 'bb'.repeat(32), settlerRelayId: 'nonexistent-relay-would-fail-later-if-reached', feeUtxo: null });
  } catch (e) { threw = e; }
  ok(threw != null, `throws (got: ${threw ? 'threw' : 'NO THROW — REGRESSION, gate not wired or bypassed'})`);
  ok(threw && /K-18 §3\.3 coherence gate FAIL/.test(threw.message), `error message carries the coherence-gate marker, not some later relay/DB error (got: ${threw?.message?.slice(0, 160)})`);
  ok(threw && /step=a/.test(threw.message), `fails specifically at step(a) — covenant_family unknown, the cheapest/first check, proving it short-circuits before reaching relay logic (got: ${threw?.message?.slice(0, 200)})`);
}

console.log('[test] covenant_family=v1_committee but redeem bytes are garbage (structural mismatch) → gate FAILs at step(b), same early short-circuit:');
{
  const marketId = `closegatetest-${randomUUID().slice(0, 8)}`;
  seedMinimalMarket(marketId, { covenantFamily: 'v1_committee' });
  let threw = null;
  try {
    await buildProposeCloseRequestV2(marketId, { winningDirection: 1, endBlockHash: 'cc'.repeat(32), settlerRelayId: 'nonexistent-relay', feeUtxo: null });
  } catch (e) { threw = e; }
  ok(threw != null, `throws (got: ${threw ? 'threw' : 'NO THROW — REGRESSION'})`);
  ok(threw && /K-18 §3\.3 coherence gate FAIL/.test(threw.message) && /step=b/.test(threw.message), `fails at step(b) structural signature, not a later relay error (got: ${threw?.message?.slice(0, 200)})`);
}

console.log(fails === 0 ? `\n✅ all checks passed` : `\n❌ ${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);
