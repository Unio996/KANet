#!/usr/bin/env node
// J2-tn r312 — dry-run cross-node committee sampler verify.
//
// Bypasses settler's 0-bet shortcut by directly invoking the committee sampler
// with explicit inputs. If both nodes (:3200 + :3300) have:
//   - same pool_snapshots.pool_merkle_root (= chain-derived c4f6149f...)
//   - same pool_snapshots.pool_pks / pool_stakes (= chain_view 5-staker subset)
//   - same endBlockHash (= canonical first block past deadlineDaa on Kaspa testnet-12)
// → must produce same VRF seed → same committee_pk_hash → same 5 PKs in same order.
//
// :3200 baseline (J2-tn r309 实证):
//   vrf_seed:          df1f332f69ce52203c1a51ed5507f90275a0821d0f8d688cbfb1812974e6a22d
//   committee_pk_hash: a6143ea9b5ed0d726fff7d491cf9d5250c86cfe571ebf3acf51aa0f305d686ec
//   committee_pks (sample order): [e666239e, 9e2db852, a102fbde, 7212edc7, 7013f118]
//
// USAGE:
//   With explicit endBlock (deterministic guarantee — recommended for cross-node verify):
//     END_BLOCK=<full 64-hex> node scripts/_j2tn_dryrun_committee_sample.mjs
//   Auto-fetch endBlock from chain (= settler-style, deadlineDaa heuristic ±1 DAA noise):
//     node scripts/_j2tn_dryrun_committee_sample.mjs

import { deriveCommitteeSeed, selectCommittee } from '../src/services/pool-committee-sampler.mjs';
import { sqlite } from '../src/db/client.js';
import { createHash } from 'node:crypto';

const MARKET_ID = process.env.MARKET_ID || 'ext-pool-v07-1780412119197-2q1ew';
const END_BLOCK_OVERRIDE = process.env.END_BLOCK || null;

const market = sqlite.prepare('SELECT id, deadline, pool_merkle_root FROM pool_markets WHERE id = ?').get(MARKET_ID);
if (!market) { console.error('market not found:', MARKET_ID); process.exit(1); }
console.log('market:', market.id);
console.log('deadline (unix sec):', market.deadline);
console.log('ctor pool_merkle_root:', market.pool_merkle_root);

const snap = sqlite.prepare('SELECT pool_merkle_root, pool_size, pool_pks_json, pool_stakes_json FROM pool_snapshots WHERE market_id = ?').get(MARKET_ID);
if (!snap) { console.error('no pool_snapshots for market — run _j2tn_backfill_snapshot_v2.mjs first'); process.exit(1); }
const pks = JSON.parse(snap.pool_pks_json);
const stakes = JSON.parse(snap.pool_stakes_json);
console.log('snapshot pool_size:', snap.pool_size, 'root:', snap.pool_merkle_root);
console.log('PKs (sorted ascending):', pks.map(p => p.slice(0,12)));

// Resolve endBlock.
let endBlockHash;
if (END_BLOCK_OVERRIDE) {
  endBlockHash = END_BLOCK_OVERRIDE.toLowerCase();
  console.log('endBlockHash (override):', endBlockHash);
} else {
  // Standalone scripts can't reuse Console's in-process relay-manager (createRelayChainReader
  // needs in-Console IPC state). For cross-node verify, explicit END_BLOCK env override is
  // anyway the only deterministic path (= avoids deadlineDaa wall-clock heuristic noise).
  console.error('\nEND_BLOCK env required. To verify cross-node deterministic:');
  console.error('  1. :3200 baseline endBlock = 9e52d4653ce4299...  (J2-tn pool_committee row);');
  console.error('     full 64-hex extracted via _j2tn_extract_endblock.mjs (separate helper).');
  console.error('  2. Run with: END_BLOCK=<64-hex> node scripts/_j2tn_dryrun_committee_sample.mjs');
  process.exit(1);
}

// Derive VRF seed.
const seed = deriveCommitteeSeed(MARKET_ID, endBlockHash, snap.pool_merkle_root);
const seedHex = seed.toString('hex');
console.log('\n=== VRF seed ===');
console.log('seed:', seedHex);

// Sample committee.
const members = pks.map((pk, i) => ({ pk_hex: pk, stake_sompi: BigInt(stakes[i]) }));
const sampling = selectCommittee(members, seed);
const committeePks = sampling.selected.map(s => s.pk_hex);

// Compute committee_pk_hash = sha256(concat(pk_hex_lower)) over selection order.
const committeePkHash = createHash('sha256').update(Buffer.concat(committeePks.map(pk => Buffer.from(pk.toLowerCase(), 'hex')))).digest('hex');

console.log('\n=== committee (sample order) ===');
sampling.selected.forEach((s, i) => console.log(` round ${i}: pk=${s.pk_hex.slice(0,12)} stake=${s.stake_sompi}`));
console.log('committee_pk_hash:', committeePkHash);

console.log('\n=== expected (:3200 baseline) ===');
console.log('vrf_seed:          df1f332f69ce52203c1a51ed5507f90275a0821d0f8d688cbfb1812974e6a22d');
console.log('committee_pk_hash: a6143ea9b5ed0d726fff7d491cf9d5250c86cfe571ebf3acf51aa0f305d686ec');

const seedMatch = seedHex === 'df1f332f69ce52203c1a51ed5507f90275a0821d0f8d688cbfb1812974e6a22d';
const hashMatch = committeePkHash === 'a6143ea9b5ed0d726fff7d491cf9d5250c86cfe571ebf3acf51aa0f305d686ec';
console.log('\n=== verdict ===');
console.log('seed match:    ', seedMatch ? '✓ deterministic' : '✗ MISMATCH');
console.log('pk_hash match: ', hashMatch ? '✓ deterministic' : '✗ MISMATCH');
if (seedMatch && hashMatch) console.log('\n🎯 cross-node committee sampling deterministic PASS');
else console.log('\n— if endBlock differs → endBlockHash is the divergence root; ask :3200 for its endBlockHash + retry with END_BLOCK= env override');
